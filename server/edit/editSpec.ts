import type { GameSpec } from '../../src/spec/types';
import { validateGameSpec, type ValidationError } from '../../src/spec/validate';
import type { ResponsesClientLike } from '../llm';
import { applyPatchSafely, PatchApplyError } from './jsonPatch';
import { matchIntent } from './intents';
import { generateEditPatch } from './llmPatch';

export type EditSource = 'deterministic' | 'llm_patch' | 'unchanged';

export interface EditResult {
  spec: GameSpec;
  source: EditSource;
  attemptCount: number;
  usedFallback: boolean; // true only when source === 'unchanged'
  lastErrors?: ValidationError[];
  error?: string;
}

/**
 * instruction + current spec -> a new, validated GameSpec, resolved
 * cheapest-first: try the small set of deterministic pattern-matched
 * intents (server/edit/intents.ts — zero LLM calls, zero cost, fully
 * predictable) before ever falling through to an LLM-authored JSON Patch.
 * Both paths are gated through the exact same validateGameSpec three gates
 * generation uses — a hand-built patch template is just as capable of
 * producing an invalid spec (e.g. "make the boss weaker" on a boss already
 * at 1 HP) as an LLM one, so there's no special-cased trust for the
 * deterministic path.
 *
 * Never throws, and — unlike generateSpec's template fallback — never
 * swaps in an unrelated spec on total failure: if nothing can be safely
 * applied, the result is the *original* spec, unchanged, since a broken
 * mid-edit swap would be far more confusing than the edit simply not
 * taking effect.
 */
export async function editSpec(spec: GameSpec, instruction: string, client?: ResponsesClientLike): Promise<EditResult> {
  const deterministic = matchIntent(instruction, spec);
  if (deterministic) {
    try {
      const candidate = applyPatchSafely(spec, deterministic.patch);
      const result = validateGameSpec(candidate);
      if (result.valid) {
        return { spec: candidate, source: 'deterministic', attemptCount: 0, usedFallback: false };
      }
      // Deterministic patch produced an invalid spec (e.g. a health
      // multiplier pushing a boss below 1) — fall through to the LLM path
      // below rather than silently failing. The LLM sees the original,
      // still-valid spec, never the broken candidate.
    } catch (err) {
      if (!(err instanceof PatchApplyError)) throw err;
      // A malformed deterministic patch is a bug in intents.ts, not
      // something to surface to the user — fall through exactly as if no
      // deterministic intent had matched at all.
    }
  }

  const llmResult = await generateEditPatch(spec, instruction, client);
  if (llmResult.applied) {
    return {
      spec: llmResult.spec,
      source: 'llm_patch',
      attemptCount: llmResult.attempts,
      usedFallback: false,
      ...(llmResult.lastErrors ? { lastErrors: llmResult.lastErrors } : {}),
    };
  }

  const lastReason = llmResult.lastErrors?.at(-1)?.message;
  return {
    spec, // unchanged
    source: 'unchanged',
    attemptCount: llmResult.attempts,
    usedFallback: true,
    lastErrors: llmResult.lastErrors,
    error: lastReason ? `Could not apply "${instruction}": ${lastReason}` : `Could not apply "${instruction}".`,
  };
}
