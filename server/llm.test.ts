import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import type { GameSpec } from '../src/spec/types';
import { FALLBACK_SPEC } from './fallbackSpec';
import { generateSpec, type ResponseLike, type ResponsesClientLike } from './llm';

function validSpec(overrides: Partial<GameSpec> = {}): GameSpec {
  return {
    meta: { title: 'Generated Game', width: 800, height: 600 },
    movementType: 'topdown_8dir',
    theme: 'dungeon',
    world: { tileSize: 32, backgroundColor: '#1d1d2b', bounds: { width: 1600, height: 1200 } },
    player: { start: { x: 50, y: 50 }, sprite: 'player', health: 10, speed: 150 },
    entities: [
      {
        id: 'boss_1',
        type: 'boss',
        sprite: 'boss',
        position: { x: 400, y: 300 },
        behavior: 'stationary',
        health: 20,
        damage: 2,
        scoreValue: 100,
      },
    ],
    winCondition: { type: 'defeat_boss' },
    ...overrides,
  };
}

function jsonResponse(value: unknown): ResponseLike {
  return { output_text: JSON.stringify(value) };
}

// Records every `input` array passed to `create`, so tests can assert on
// what got fed back to the model across retries, not just the final result.
function scriptedClient(responses: ResponseLike[]): { client: ResponsesClientLike; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  let i = 0;
  return {
    calls,
    client: {
      responses: {
        create: async (params) => {
          calls.push(params);
          const response = responses[Math.min(i, responses.length - 1)];
          i++;
          return response;
        },
      },
    },
  };
}

describe('generateSpec — happy path', () => {
  it('returns the model spec unchanged when it validates on the first attempt', async () => {
    const spec = validSpec();
    const { client } = scriptedClient([jsonResponse(spec)]);
    const result = await generateSpec('a game about a wizard', client);
    expect(result.usedFallback).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.spec).toEqual(spec);
    expect(result.lastErrors).toBeUndefined();
  });

  it('strips explicit nulls (OpenAI strict-mode nullable-optionals) before validating', async () => {
    const spec: any = validSpec();
    spec.world.groundTile = null; // optional field the model marked "not applicable"
    spec.entities[0].behaviorParams = null;
    const { client } = scriptedClient([jsonResponse(spec)]);
    const result = await generateSpec('a game', client);
    expect(result.usedFallback).toBe(false);
    expect(result.spec.world.groundTile).toBeUndefined();
  });
});

describe('generateSpec — retry loop', () => {
  it('feeds structured validation errors back and succeeds on the second attempt', async () => {
    const broken: any = validSpec();
    broken.entities[0].behavior = 'aggressive'; // not a real behavior
    const fixed = validSpec();

    const { client, calls } = scriptedClient([jsonResponse(broken), jsonResponse(fixed)]);
    const result = await generateSpec('a game', client);

    expect(result.usedFallback).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.spec).toEqual(fixed);

    // A multi-attempt success must still surface what went wrong on the
    // earlier attempt(s) — otherwise a caller can't tell "landed clean" apart
    // from "took N attempts, self-corrected" without adding logging after
    // the fact.
    expect(result.lastErrors?.length).toBeGreaterThan(0);
    expect(result.lastErrors?.[0].path).toBe('entities[0].behavior');

    // The second call's conversation must include feedback naming the
    // specific problem, not a generic "try again".
    const secondCallInput = calls[1].input as Array<{ role: string; content: string }>;
    const feedback = secondCallInput.map((t) => t.content).join('\n');
    expect(feedback).toContain('entities[0].behavior');
    expect(feedback).toContain('aggressive');
  });

  it('treats a missing/refused response as a retryable failure, not a crash', async () => {
    const { client } = scriptedClient([{}, jsonResponse(validSpec())]);
    const result = await generateSpec('a game', client);
    expect(result.usedFallback).toBe(false);
    expect(result.attempts).toBe(2);
  });

  it('treats malformed JSON as a retryable failure', async () => {
    const { client } = scriptedClient([{ output_text: '{not json' }, jsonResponse(validSpec())]);
    const result = await generateSpec('a game', client);
    expect(result.usedFallback).toBe(false);
    expect(result.attempts).toBe(2);
  });

  it('retries after a timeout instead of falling back immediately', async () => {
    // Reproduced directly against a real slow prompt ("Dodge the Falling
    // Objects", conceptually the same "no clean vocabulary fit" gap as
    // Flappy Bird's missing movement type): the OpenAI client can time out
    // on one attempt and then succeed well within the timeout window on a
    // fresh retry — the model was just slow that particular time, not stuck
    // on the input. A timeout is the one transport failure this retries
    // rather than jumping straight to the fallback template for.
    let calls = 0;
    const client: ResponsesClientLike = {
      responses: {
        create: async () => {
          calls++;
          if (calls === 1) throw new OpenAI.APIConnectionTimeoutError();
          return jsonResponse(validSpec());
        },
      },
    };
    const result = await generateSpec('a game', client);
    expect(result.usedFallback).toBe(false);
    expect(result.attempts).toBe(2);
    expect(calls).toBe(2);
  });
});

describe('generateSpec — fallback', () => {
  it('falls back to the template spec after exhausting all attempts on invalid output', async () => {
    const broken: any = validSpec();
    broken.winCondition = { type: 'collect_all_pickups' }; // no pickups exist -> unreachable
    const { client, calls } = scriptedClient([jsonResponse(broken)]); // scriptedClient repeats the last response

    const result = await generateSpec('a game', client);

    expect(result.usedFallback).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.spec).toEqual(FALLBACK_SPEC);
    expect(result.lastErrors?.length).toBeGreaterThan(0);
    expect(calls.length).toBe(3);
  });

  it('falls back immediately without exhausting retries when the API call itself throws', async () => {
    const client: ResponsesClientLike = {
      responses: {
        create: async () => {
          throw new Error('401 unauthorized');
        },
      },
    };
    const result = await generateSpec('a game', client);
    expect(result.usedFallback).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.spec).toEqual(FALLBACK_SPEC);
  });

  it('falls back only after every attempt times out, not on the first one', async () => {
    const client: ResponsesClientLike = {
      responses: {
        create: async () => {
          throw new OpenAI.APIConnectionTimeoutError();
        },
      },
    };
    const result = await generateSpec('a game', client);
    expect(result.usedFallback).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.spec).toEqual(FALLBACK_SPEC);
  });
});
