import OpenAI from 'openai';
import type { GameSpec } from '../src/spec/types';
import { validateGameSpec, type ValidationError } from '../src/spec/validate';
import { FALLBACK_SPEC } from './fallbackSpec';
import { GAME_SPEC_OUTPUT_FORMAT } from './outputSchema';
import { formatValidationFeedback, SYSTEM_PROMPT } from './systemPrompt';

const MODEL_ID = 'gpt-6-astra';

// 1 initial attempt + 2 structured-error-feedback retries, then fall back —
// matches the Phase 2 spec's retry budget exactly.
const MAX_ATTEMPTS = 3;
const MAX_OUTPUT_TOKENS = 4096;

export interface GenerateResult {
  spec: GameSpec;
  usedFallback: boolean;
  attempts: number;
  // Present whenever attempts > 1, on a fallback *or* an eventual success —
  // the validation errors from the attempt(s) that failed before landing on
  // the spec actually returned. Without this, a caller can't tell "landed
  // clean on attempt 1" apart from "took N attempts, self-corrected" without
  // adding manual logging after the fact — exactly the blind spot that made
  // an actual multi-attempt success un-diagnosable during the shooter-genre
  // verification pass.
  lastErrors?: ValidationError[];
}

export type Role = 'system' | 'user' | 'assistant';
export interface Turn {
  role: Role;
  content: string;
}

// Minimal shape we actually use from the OpenAI SDK's response object, so
// generateSpec can be unit-tested against a hand-built fake client instead
// of hitting the real API (see llm.test.ts) without needing to construct a
// full `OpenAI.Responses.Response`.
// `params` is deliberately untyped rather than pinned to the SDK's own
// ResponseCreateParams: this interface exists so llm.test.ts can substitute
// a hand-built fake without importing the real SDK, and a real `OpenAI`
// instance's `responses.create` (whose params type is far more specific)
// needs to satisfy it structurally.
export interface ResponsesClientLike {
  responses: {
    create(params: any): Promise<ResponseLike>;
  };
}

export interface ResponseLike {
  output_text?: string;
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
}

// Exported so server/edit/llmPatch.ts (Phase 4's edit path) can reuse the
// exact same client construction and response-shape handling instead of
// duplicating it for a second OpenAI call site.
//
// Both options below matter together, not separately — reproduced directly
// against the real system prompt + structured schema with a genuinely slow
// prompt ("Dodge the Falling Objects", which doesn't map cleanly onto any
// existing movementType/camera archetype, the same class of gap as Flappy
// Bird's missing movement type): a single attempt can take well over a
// minute to respond at all, not just occasionally but consistently.
//   - timeout: the SDK's own default is 10 minutes; 60s is comfortably
//     above every OTHER attempt observed completing normally in this app's
//     testing, while still bounding the worst case to "one slow attempt,
//     then move on" instead of an effectively unbounded wait.
//   - maxRetries: 0 — the SDK's own default (2) silently retries a timed-out
//     request up to twice more, each retry taking up to the full timeout
//     again — so the *effective* wait before an error ever surfaced was
//     really timeout*3 (confirmed: a 60s-configured timeout took ~181s to
//     actually fail). generateSpec()'s own MAX_ATTEMPTS loop already retries
//     with structured validation feedback, which is strictly more useful
//     than the SDK blindly repeating the identical request — so the SDK's
//     own retry layer is redundant on top of it, not complementary.
export function getDefaultClient(): ResponsesClientLike {
  return new OpenAI({ timeout: 60_000, maxRetries: 0 });
}

export function extractJsonText(response: ResponseLike): string | null {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }
  const message = (response.output ?? []).find((item) => item.type === 'message');
  const content = message?.content?.[0];
  if (content?.type === 'output_text' && typeof content.text === 'string') {
    return content.text;
  }
  return null;
}

// OpenAI's strict Structured Outputs mode has no concept of an optional
// property — every field the model could omit is instead typed nullable
// (see outputSchema.ts), so the model emits explicit `null`s for anything
// not applicable. Our canonical schema (and validateGameSpec) expects those
// fields simply absent, so this bridges the two conventions back before
// validation ever sees the candidate.
function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripNulls(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;
      out[key] = stripNulls(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Prompt -> validated GameSpec, via OpenAI Structured Outputs, with up to
 * two structured-error-feedback retries before giving up and returning the
 * hand-written fallback template. This function never throws: every failure
 * mode (API error, refusal/empty output, invalid JSON, failed validation)
 * either feeds back into the next attempt or — once attempts are exhausted —
 * resolves to FALLBACK_SPEC, because a broken game is a worse UX than one
 * that doesn't match the prompt.
 */
export async function generateSpec(
  userPrompt: string,
  client: ResponsesClientLike = getDefaultClient(),
): Promise<GenerateResult> {
  const input: Turn[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
  let lastErrors: ValidationError[] | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: ResponseLike;
    try {
      response = await client.responses.create({
        model: MODEL_ID,
        input,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        text: { format: GAME_SPEC_OUTPUT_FORMAT },
      });
    } catch (err) {
      // A timeout is the one transport failure worth retrying rather than
      // falling back on immediately: reproduced directly against a real
      // slow prompt, a fresh identical request after a timed-out one
      // succeeded in well under the timeout window on its own — the model
      // was just slow that particular time, not stuck on the input. There's
      // no assistant turn to push (nothing came back to reference), so the
      // next loop iteration is simply the same request again.
      if (err instanceof OpenAI.APIConnectionTimeoutError) {
        console.error(`generateSpec: attempt ${attempt} timed out, retrying`);
        lastErrors = [{ path: '(root)', message: 'the model took too long to respond' }];
        continue;
      }
      // Anything else (auth, network unreachable, rate limit) can't be
      // fixed by feeding structured errors back into the conversation, and
      // isn't the kind of transient slowness a bare retry fixes either —
      // stop here rather than burning the remaining retry budget on a call
      // that will fail the same way every time.
      console.error(`generateSpec: OpenAI call failed on attempt ${attempt}:`, err);
      return { spec: FALLBACK_SPEC, usedFallback: true, attempts: attempt, lastErrors };
    }

    const jsonText = extractJsonText(response);
    if (!jsonText) {
      lastErrors = [{ path: '(root)', message: 'model returned no structured output (possible refusal or truncated response)' }];
      input.push({ role: 'assistant', content: '(no structured output returned)' });
      input.push({ role: 'user', content: 'You must respond with a complete GameSpec JSON object matching the schema. Please try again.' });
      continue;
    }

    let candidate: unknown;
    try {
      candidate = stripNulls(JSON.parse(jsonText));
    } catch {
      lastErrors = [{ path: '(root)', message: 'model output was not valid JSON' }];
      input.push({ role: 'assistant', content: jsonText });
      input.push({ role: 'user', content: 'That was not valid JSON. Respond with a single valid JSON object matching the schema, nothing else.' });
      continue;
    }

    const result = validateGameSpec(candidate);
    if (result.valid) {
      return {
        spec: candidate as GameSpec,
        usedFallback: false,
        attempts: attempt,
        ...(lastErrors ? { lastErrors } : {}),
      };
    }

    lastErrors = result.errors;
    input.push({ role: 'assistant', content: jsonText });
    input.push({ role: 'user', content: formatValidationFeedback(result.errors) });
  }

  return { spec: FALLBACK_SPEC, usedFallback: true, attempts: MAX_ATTEMPTS, lastErrors };
}
