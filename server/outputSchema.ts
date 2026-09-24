import rawSchema from '../src/spec/gamespec.schema.json';

// Derives the OpenAI Structured Outputs schema straight from
// gamespec.schema.json — the same file ajv validates against in
// src/spec/validate.ts — so the vocabulary/shape the model is constrained to
// can never drift from what the validator actually accepts. Nothing here is
// hand-copied; every enum, required field, and object shape flows from that
// one JSON file.
//
// OpenAI's Structured Outputs strict mode (`strict: true`) has two rules our
// canonical schema doesn't follow out of the box, so this module transforms
// a clone of it before handing it to the API:
//   1. Every property must appear in the object's `required` array — there
//      is no such thing as an optional property in strict mode. A field
//      that's conceptually optional (e.g. `world.groundTile`) is instead
//      made *nullable* (its type gains `"null"`), and the model is expected
//      to emit `null` rather than omit the key.
//   2. `additionalProperties: false` must be set on every object schema
//      (already true throughout gamespec.schema.json, preserved here).
// server/llm.ts strips `null`-valued keys back out of the model's output
// before handing it to validateGameSpec, since the *validator's* schema
// still uses ordinary optional properties (absent, not null).

function renameDefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(renameDefs);
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === '$ref' && typeof value === 'string') {
        out[key] = value.replace('#/definitions/', '#/$defs/');
      } else if (key === 'definitions') {
        out.$defs = renameDefs(value);
      } else {
        out[key] = renameDefs(value);
      }
    }
    return out;
  }
  return node;
}

function toNullable(node: unknown): unknown {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const obj = node as Record<string, unknown>;
    if (typeof obj.$ref === 'string') {
      return { anyOf: [obj, { type: 'null' }] };
    }
    if (typeof obj.type === 'string') {
      return { ...obj, type: [obj.type, 'null'] };
    }
    if (Array.isArray(obj.type)) {
      return { ...obj, type: [...new Set([...(obj.type as string[]), 'null'])] };
    }
  }
  return { anyOf: [node, { type: 'null' }] };
}

function makeStrict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(makeStrict);
  if (!node || typeof node !== 'object') return node;

  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'properties') continue; // rebuilt below alongside `required`
    out[key] = makeStrict(value);
  }

  // additionalProperties: false is required on *every* object schema in
  // strict mode, even one with no `properties` at all (an object schema
  // with nothing else is otherwise read as "any object, any shape").
  if (obj.type === 'object') {
    const hasProperties = obj.properties && typeof obj.properties === 'object';
    const properties = hasProperties ? (obj.properties as Record<string, unknown>) : {};
    const originalRequired = new Set(Array.isArray(obj.required) ? (obj.required as string[]) : []);
    const propKeys = Object.keys(properties);
    const newProperties: Record<string, unknown> = {};
    for (const key of propKeys) {
      const propSchema = makeStrict(properties[key]);
      newProperties[key] = originalRequired.has(key) ? propSchema : toNullable(propSchema);
    }
    out.properties = newProperties;
    out.required = propKeys;
    out.additionalProperties = false;
  }

  return out;
}

// gamespec.schema.json deliberately leaves entities[].behaviorParams as a
// bare `{"type": "object"}` — see spec/types.ts's BehaviorParams interface,
// a loose bag with an index signature, since different behaviors read
// different fields and ajv doesn't need it any more specific than that.
// OpenAI's strict mode has no concept of "any-shaped object" at all — every
// property has to be enumerated — so this is the one place in this file
// that can't be purely derived from gamespec.schema.json: the known
// behaviorParams fields are spelled out by hand, mirroring
// server/systemPrompt.ts's BEHAVIOR_FIELD_GUIDE and spec/types.ts's
// BehaviorParams interface. If you add a field to BehaviorParams, add it
// here too (nothing enforces that link automatically — a genuine tradeoff
// forced by the API, not an oversight).
const BEHAVIOR_PARAMS_SCHEMA = {
  type: 'object',
  properties: {
    patrolPoints: { type: 'array', items: { $ref: '#/$defs/vec2' } },
    speed: { type: 'number' },
    detectRadius: { type: 'number' },
    loseRadius: { type: 'number' },
    fleeSpeed: { type: 'number' },
    amplitude: { type: 'number' },
    frequency: { type: 'number' },
    fireRate: { type: 'number' },
    projectileSpeed: { type: 'number' },
    projectileSprite: { type: 'string' },
    damage: { type: 'number' },
    range: { type: 'number' },
  },
};

function overrideBehaviorParams(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(overrideBehaviorParams);
  if (!node || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = key === 'behaviorParams' ? BEHAVIOR_PARAMS_SCHEMA : overrideBehaviorParams(value);
  }
  return out;
}

export function buildGameSpecOutputSchema(): object {
  const renamed = renameDefs(rawSchema) as Record<string, unknown>;
  const { $schema: _schema, $id: _id, title: _title, description: _description, ...rest } = renamed;
  return makeStrict(overrideBehaviorParams(rest)) as object;
}

export const GAME_SPEC_OUTPUT_FORMAT = {
  type: 'json_schema' as const,
  name: 'game_spec',
  strict: true,
  schema: buildGameSpecOutputSchema(),
};
