// Unlike outputSchema.ts's GameSpec schema, this is deliberately *not*
// strict-mode: a patch op's `value` can legitimately be a number, string,
// boolean, object, or array (an entity's health vs. its pickupType vs. a
// whole cloned entity), and OpenAI's strict Structured Outputs has no way
// to express "any JSON value" — every property must be fully enumerated
// (see outputSchema.ts's own comment on behaviorParams for the same
// constraint at smaller scale). Rather than force a fake enumeration here,
// this uses a loose (non-strict) json_schema format: still a real schema
// that shapes what the model reaches for, but not a hard guarantee — the
// actual gate is downstream (applyPatchSafely + validateGameSpec), which
// treats a malformed patch as a retryable failure exactly like a malformed
// full-spec generation already was in Phase 2.
//
// The schema root is an object wrapping a `patch` array, not a bare array —
// confirmed live, the hard way: OpenAI's Responses API rejects a top-level
// `type: "array"` schema for `text.format` outright ("schema must be a JSON
// Schema of 'type: object'"), regardless of `strict`. llmPatch.ts unwraps
// `.patch` after parsing.
export const EDIT_PATCH_OUTPUT_FORMAT = {
  type: 'json_schema' as const,
  name: 'game_spec_patch',
  strict: false,
  schema: {
    type: 'object',
    properties: {
      patch: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['add', 'replace', 'remove'] },
            path: { type: 'string' },
            value: {},
          },
          required: ['op', 'path'],
        },
      },
    },
    required: ['patch'],
  },
};
