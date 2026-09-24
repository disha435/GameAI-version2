import { describe, expect, it } from 'vitest';
import { buildGameSpecOutputSchema } from './outputSchema';

// OpenAI's Structured Outputs strict mode rejects `if`/`then`/`else`
// outright (confirmed live: adding one anywhere in gamespec.schema.json for
// the movementModifiers slice broke every single /generate call immediately
// with an invalid_json_schema API error, not just prompts touching the new
// field — because this schema is derived straight from the same file ajv
// validates against). Any future addition to gamespec.schema.json that
// reaches for if/then to express "field X required only when field Y has
// this value" needs to express that in validate.ts's Gate 3 instead — this
// test exists so that mistake fails fast, locally, before it ever reaches
// the live API.
function collectKeys(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, found);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      found.add(key);
      collectKeys(value, found);
    }
  }
}

describe('buildGameSpecOutputSchema — OpenAI strict-mode compatibility', () => {
  it('never contains if/then/else anywhere in the derived schema', () => {
    const schema = buildGameSpecOutputSchema();
    const keys = new Set<string>();
    collectKeys(schema, keys);
    expect(keys.has('if')).toBe(false);
    expect(keys.has('then')).toBe(false);
    expect(keys.has('else')).toBe(false);
  });
});
