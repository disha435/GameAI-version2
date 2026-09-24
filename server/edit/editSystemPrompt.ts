import type { GameSpec } from '../../src/spec/types';
import { BEHAVIOR_FIELD_GUIDE, buildVocabularyBlock } from '../systemPrompt';

// Reuses the exact same derived vocabulary block generateSpec's prompt
// uses — never a second hand-copy of the enum lists.
function buildEditSystemPrompt(): string {
  return `
You edit an existing GameSpec JSON object for a 2D game runtime by producing a JSON Patch (RFC 6902), not a full spec rewrite. The runtime only understands a fixed, closed vocabulary — do not invent values outside these lists, they will be rejected:

${buildVocabularyBlock()}

${BEHAVIOR_FIELD_GUIDE}

Output format: respond with ONLY a JSON object of the form {"patch": [...]} — an object wrapping the patch array, not a bare array — no prose, no markdown fences. Each entry in "patch" is one of:
- {"op": "add", "path": "<json pointer>", "value": <any JSON value>} — creates the value at path, or overwrites it if already present. Use path "/entities/-" to append a new entity to the end of the entities array (you can use this op more than once in the same patch to append several).
- {"op": "replace", "path": "<json pointer>", "value": <any JSON value>} — the target path must already exist in the current spec; prefer "add" instead for any field that might currently be absent (e.g. an optional behaviorParams field).
- {"op": "remove", "path": "<json pointer>"} — the target path must already exist.

Path rules: paths are JSON Pointers (RFC 6901) into the CURRENT spec given to you below — e.g. "/entities/2/health", "/player/speed", "/entities/0/behaviorParams/speed". Array indices are 0-based and refer to that spec's arrays as given, not one you're imagining.

Only change what the requested edit actually needs — leave every other field exactly as it is in the current spec. Every entity id must stay unique; never reuse an id that already exists elsewhere in the spec.

Respond with only the {"patch": [...]} JSON object — no prose, no markdown code fences, no explanation before or after it.
`.trim();
}

export const EDIT_SYSTEM_PROMPT = buildEditSystemPrompt();

export function buildEditUserMessage(spec: GameSpec, instruction: string): string {
  return `Current game spec:\n${JSON.stringify(spec)}\n\nRequested change: "${instruction}"\n\nProduce a JSON Patch (RFC 6902) as {"patch": [...]} that applies this change.`;
}
