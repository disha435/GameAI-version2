import { describe, expect, it } from 'vitest';
import type { GameSpec } from '../../src/spec/types';
import type { ResponseLike, ResponsesClientLike } from '../llm';
import { editSpec } from './editSpec';

function baseSpec(overrides: Partial<GameSpec> = {}): GameSpec {
  return {
    meta: { title: 'Test Game', width: 800, height: 600 },
    movementType: 'topdown_8dir',
    theme: 'dungeon',
    world: { tileSize: 32, backgroundColor: '#1d1d2b', bounds: { width: 1600, height: 1200 } },
    player: { start: { x: 50, y: 50 }, sprite: 'player', health: 10, speed: 150 },
    entities: [
      {
        id: 'patrol_1',
        type: 'enemy',
        sprite: 'enemy_patrol',
        position: { x: 100, y: 100 },
        behavior: 'patrol',
        behaviorParams: { speed: 60 },
        health: 2,
        damage: 1,
        scoreValue: 10,
      },
    ],
    winCondition: { type: 'defeat_all_enemies' },
    ...overrides,
  };
}

function jsonResponse(value: unknown): ResponseLike {
  return { output_text: JSON.stringify(value) };
}

// The model's expected wire shape is {"patch": [...]}, not a bare array —
// see editOutputSchema.ts (OpenAI rejects a top-level array schema).
function patchResponse(ops: unknown[]): ResponseLike {
  return jsonResponse({ patch: ops });
}

// Same fake-client shape as llm.test.ts's scriptedClient — records every
// `input` array passed to `create` so a test can assert on retry feedback,
// not just the final result.
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

// A client that throws if it's ever called — proves the deterministic path
// really does skip the LLM entirely rather than calling it "just in case".
function unreachableClient(): ResponsesClientLike {
  return {
    responses: {
      create: async () => {
        throw new Error('LLM should not have been called for this instruction');
      },
    },
  };
}

describe('editSpec — deterministic path', () => {
  it('resolves "make enemies faster" without touching the LLM at all', async () => {
    const spec = baseSpec();
    const result = await editSpec(spec, 'make the enemies faster', unreachableClient());

    expect(result.source).toBe('deterministic');
    expect(result.attemptCount).toBe(0);
    expect(result.usedFallback).toBe(false);
    expect(result.spec.entities[0].behaviorParams?.speed).toBe(96);
  });

  it('falls through to the LLM path when the deterministic patch would produce an invalid spec', async () => {
    // "survive for 0 seconds" matches the deterministic survive_duration
    // intent, but a 0 threshold fails Gate 3 (must be positive) — this must
    // fall through rather than silently commit an unwinnable game.
    const spec = baseSpec();
    const fixedPatch = [{ op: 'add', path: '/winCondition', value: { type: 'survive_duration', threshold: 30 } }];
    const { client, calls } = scriptedClient([patchResponse(fixedPatch)]);

    const result = await editSpec(spec, 'survive for 0 seconds', client);

    expect(result.source).toBe('llm_patch');
    expect(result.spec.winCondition).toEqual({ type: 'survive_duration', threshold: 30 });
    expect(calls.length).toBe(1); // did fall through to the LLM, exactly once
  });
});

describe('editSpec — LLM patch path', () => {
  it('applies a valid LLM-authored patch on the first attempt for a non-deterministic instruction', async () => {
    const spec = baseSpec();
    const patch = [{ op: 'add', path: '/player/attack', value: { type: 'ranged', damage: 3, range: 200, cooldown: 400 } }];
    const { client } = scriptedClient([patchResponse(patch)]);

    const result = await editSpec(spec, 'give the player a ranged shield attack', client);

    expect(result.source).toBe('llm_patch');
    expect(result.attemptCount).toBe(1);
    expect(result.usedFallback).toBe(false);
    expect(result.spec.player.attack).toEqual({ type: 'ranged', damage: 3, range: 200, cooldown: 400 });
  });

  it('feeds structured validation errors back and succeeds on the second attempt', async () => {
    const spec = baseSpec();
    const broken = [{ op: 'add', path: '/entities/0/behavior', value: 'aggressive' }]; // not a real behavior
    const fixed = [{ op: 'add', path: '/entities/0/behavior', value: 'chase' }];
    const { client, calls } = scriptedClient([patchResponse(broken), patchResponse(fixed)]);

    const result = await editSpec(spec, 'make the patrol enemy chase the player instead', client);

    expect(result.source).toBe('llm_patch');
    expect(result.attemptCount).toBe(2);
    expect(result.spec.entities[0].behavior).toBe('chase');

    const secondCallInput = calls[1].input as Array<{ role: string; content: string }>;
    const feedback = secondCallInput.map((t) => t.content).join('\n');
    expect(feedback).toContain('entities[0].behavior');
  });

  it('treats a malformed (missing "patch" array) response as a retryable failure', async () => {
    const spec = baseSpec();
    const fixed = [{ op: 'add', path: '/player/speed', value: 200 }];
    const { client } = scriptedClient([{ output_text: '{"not": "a patch"}' }, patchResponse(fixed)]);

    const result = await editSpec(spec, 'make the player noticeably quicker to control', client);

    expect(result.source).toBe('llm_patch');
    expect(result.attemptCount).toBe(2);
    expect(result.spec.player.speed).toBe(200);
  });

  it('leaves the spec completely unchanged when every attempt fails, and reports why', async () => {
    const spec = baseSpec();
    const alwaysBroken = [{ op: 'add', path: '/winCondition', value: { type: 'collect_all_pickups' } }]; // no pickups exist
    const { client, calls } = scriptedClient([patchResponse(alwaysBroken)]); // scriptedClient repeats the last response

    const result = await editSpec(spec, 'change the goal to collecting everything', client);

    expect(result.source).toBe('unchanged');
    expect(result.usedFallback).toBe(true);
    expect(result.attemptCount).toBe(3);
    expect(result.spec).toEqual(spec); // byte-for-byte the original, never a swapped-in template
    expect(result.error).toBeTruthy();
    expect(result.lastErrors?.length).toBeGreaterThan(0);
    expect(calls.length).toBe(3);
  });
});
