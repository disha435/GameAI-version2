// A default import, not a named one: fast-json-patch's CommonJS build
// assembles its exports via `Object.assign(exports, core)` rather than
// static `exports.applyPatch = ...` assignments, which Node's CJS->ESM
// named-export interop can't see (confirmed the hard way — this passed
// under vitest/Vite's own resolution, which respects the package's
// "module" field, then threw `does not provide an export named
// 'applyPatch'` under real Node/tsx at runtime). A default import always
// gets the whole `module.exports` object regardless of how it was built,
// so `jsonpatch.applyPatch` below is resolved at runtime, not statically.
import jsonpatch from 'fast-json-patch';
import type { GameSpec } from '../../src/spec/types';

// Deliberately narrower than fast-json-patch's own Operation union (which
// also allows move/copy/test) — every edit this app produces, deterministic
// or LLM-authored, is expressible as add/remove/replace, and a smaller
// vocabulary is a smaller thing for the LLM patch prompt to get wrong.
export type EditPatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown };

export class PatchApplyError extends Error {}

// Applies a patch to a clone of spec — mutateDocument: false means the
// original is never touched, matching the functional style of the rest of
// the pipeline (generateSpec/validateGameSpec never touch their inputs
// either). validateOperation: true turns on fast-json-patch's own
// structural checks (bad path, replace/remove on something that doesn't
// exist, etc.), so a malformed patch — hand-built or LLM-authored — throws
// PatchApplyError here instead of silently producing a corrupted spec. The
// caller treats that exactly like a validateGameSpec failure: retry with
// the LLM, or give up and leave the current spec untouched.
export function applyPatchSafely(spec: GameSpec, patch: EditPatchOp[]): GameSpec {
  try {
    const result = jsonpatch.applyPatch(spec, patch, true, false);
    return result.newDocument;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PatchApplyError(message);
  }
}
