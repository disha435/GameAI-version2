import type { GameSpec } from '../../src/spec/types';
import { validateGameSpec, type ValidationError } from '../../src/spec/validate';
import { extractJsonText, getDefaultClient, type ResponseLike, type ResponsesClientLike, type Turn } from '../llm';
import { formatValidationFeedback } from '../systemPrompt';
import { EDIT_PATCH_OUTPUT_FORMAT } from './editOutputSchema';
import { buildEditUserMessage, EDIT_SYSTEM_PROMPT } from './editSystemPrompt';
import { applyPatchSafely, type EditPatchOp } from './jsonPatch';

const MODEL_ID = 'gpt-6-astra';

// Same retry budget as generateSpec (1 initial attempt + 2 retries).
const MAX_ATTEMPTS = 3;
const MAX_OUTPUT_TOKENS = 2048;

export interface LlmPatchResult {
  spec: GameSpec; // the ORIGINAL spec, untouched, when applied is false
  applied: boolean;
  attempts: number;
  lastErrors?: ValidationError[];
}

function parsePatchOps(jsonText: string): EditPatchOp[] {
  const parsed = JSON.parse(jsonText);
  // The model responds with {"patch": [...]}, not a bare array — see
  // editOutputSchema.ts for why (OpenAI rejects a top-level array schema).
  const patch = (parsed as { patch?: unknown })?.patch;
  if (!Array.isArray(patch)) throw new Error('expected a JSON object of the form {"patch": [...]}');
  for (const op of patch) {
    if (!op || typeof op !== 'object' || typeof (op as { op?: unknown }).op !== 'string' || typeof (op as { path?: unknown }).path !== 'string') {
      throw new Error('every patch operation must be an object with string "op" and "path" fields');
    }
    const opName = (op as { op: string }).op;
    if (opName !== 'add' && opName !== 'replace' && opName !== 'remove') {
      throw new Error(`unsupported patch op "${opName}" — only add, replace, remove are allowed`);
    }
  }
  return patch as EditPatchOp[];
}

/**
 * instruction + current spec -> a validated GameSpec, produced by an LLM-
 * authored JSON Patch rather than a full spec rewrite — same structured-
 * error-feedback retry shape as generateSpec (server/llm.ts), reusing its
 * client plumbing directly. Never throws: every failure mode (API error,
 * malformed patch JSON, a patch that fails to apply, a patch that applies
 * but produces an invalid spec) either feeds back into the next attempt or
 * — once attempts are exhausted — resolves with `applied: false` and the
 * *original* spec, since an edit that can't be safely applied should leave
 * the game exactly as it was, never swap in something unrelated the way
 * generateSpec's fallback-to-template does for a from-scratch generation.
 */
export async function generateEditPatch(
  spec: GameSpec,
  instruction: string,
  client: ResponsesClientLike = getDefaultClient(),
): Promise<LlmPatchResult> {
  const input: Turn[] = [
    { role: 'system', content: EDIT_SYSTEM_PROMPT },
    { role: 'user', content: buildEditUserMessage(spec, instruction) },
  ];
  let lastErrors: ValidationError[] | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: ResponseLike;
    try {
      response = await client.responses.create({
        model: MODEL_ID,
        input,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        text: { format: EDIT_PATCH_OUTPUT_FORMAT },
      });
    } catch (err) {
      console.error(`generateEditPatch: OpenAI call failed on attempt ${attempt}:`, err);
      return { spec, applied: false, attempts: attempt, lastErrors };
    }

    const jsonText = extractJsonText(response);
    if (!jsonText) {
      lastErrors = [{ path: '(root)', message: 'model returned no structured output (possible refusal or truncated response)' }];
      input.push({ role: 'assistant', content: '(no structured output returned)' });
      input.push({ role: 'user', content: 'You must respond with a JSON Patch array. Please try again.' });
      continue;
    }

    let candidate: GameSpec;
    try {
      const patch = parsePatchOps(jsonText);
      candidate = applyPatchSafely(spec, patch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastErrors = [{ path: '(root)', message: `patch could not be applied: ${message}` }];
      input.push({ role: 'assistant', content: jsonText });
      input.push({ role: 'user', content: `That patch failed to apply: ${message}\n\nRespond with a corrected JSON Patch array, nothing else.` });
      continue;
    }

    const result = validateGameSpec(candidate);
    if (result.valid) {
      return { spec: candidate, applied: true, attempts: attempt, ...(lastErrors ? { lastErrors } : {}) };
    }

    lastErrors = result.errors;
    input.push({ role: 'assistant', content: jsonText });
    input.push({ role: 'user', content: formatValidationFeedback(result.errors) });
  }

  return { spec, applied: false, attempts: MAX_ATTEMPTS, lastErrors };
}
