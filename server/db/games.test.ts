import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { GameSpec } from '../../src/spec/types';
import { db } from './client';
import { createGameVersion, getGame, getGameWithCurrentVersion, getVersionById, listVersions, rollbackGameVersion } from './games';
import { games } from './schema';

// Integration tests against a real local Postgres (see docker-compose.yml /
// `npm run db:up` + `npm run db:migrate`) rather than an in-memory
// substitute — this project is committed to Postgres, so testing against
// the real thing (including its JSONB storage, its FK cascade, its CHECK
// constraint) is more honest than a stand-in that wouldn't catch a real
// migration mistake.

const PLACEHOLDER_USER_ID = '00000000-0000-0000-0000-000000000001';

function spec(overrides: Partial<GameSpec> = {}): GameSpec {
  return {
    meta: { title: 'Test Game', width: 800, height: 600 },
    movementType: 'topdown_8dir',
    theme: 'dungeon',
    world: { tileSize: 32, backgroundColor: '#1d1d2b', bounds: { width: 1600, height: 1200 } },
    player: { start: { x: 50, y: 50 }, sprite: 'player', health: 10, speed: 150 },
    entities: [],
    winCondition: { type: 'defeat_all_enemies' },
    ...overrides,
  };
}

// Every game created by a test is tracked here and deleted in afterAll —
// deleting the game cascades to its versions (ON DELETE CASCADE), so this
// is the only cleanup a test needs to do, and it means repeated test runs
// never accumulate rows in the shared dev database.
const createdGameIds: string[] = [];

afterAll(async () => {
  if (createdGameIds.length > 0) {
    await db.delete(games).where(inArray(games.id, createdGameIds));
  }
});

describe('createGameVersion', () => {
  it('creates a new game and version 1 when gameId is omitted', async () => {
    const { gameId, version } = await createGameVersion({
      userId: PLACEHOLDER_USER_ID,
      title: 'My Game',
      specJson: spec(),
      source: 'generate',
      prompt: 'a game about a wizard',
      attemptCount: 1,
      usedFallback: false,
      validationErrors: null,
    });
    createdGameIds.push(gameId);

    expect(version.versionNumber).toBe(1);
    expect(version.source).toBe('generate');

    const game = await getGame(gameId);
    expect(game?.title).toBe('My Game');
    expect(game?.currentVersionId).toBe(version.id);
  });

  it('increments version_number on the same game and repoints current_version_id', async () => {
    const first = await createGameVersion({
      userId: PLACEHOLDER_USER_ID,
      title: 'Regenerated Game',
      specJson: spec(),
      source: 'generate',
      prompt: 'first prompt',
      attemptCount: 1,
      usedFallback: false,
      validationErrors: null,
    });
    createdGameIds.push(first.gameId);

    const second = await createGameVersion({
      gameId: first.gameId,
      userId: PLACEHOLDER_USER_ID,
      specJson: spec({ movementType: 'platformer_run_jump' }),
      source: 'generate',
      prompt: 'second prompt',
      attemptCount: 2,
      usedFallback: false,
      validationErrors: [{ path: 'entities[0].behavior', message: 'must be one of: patrol, chase' }],
    });

    expect(second.gameId).toBe(first.gameId);
    expect(second.version.versionNumber).toBe(2);

    const game = await getGame(first.gameId);
    expect(game?.currentVersionId).toBe(second.version.id);

    const current = await getGameWithCurrentVersion(first.gameId);
    expect(current?.versionNumber).toBe(2);
    expect((current?.specJson as GameSpec).movementType).toBe('platformer_run_jump');

    const history = await listVersions(first.gameId);
    expect(history.map((v) => v.versionNumber)).toEqual([2, 1]); // desc order
    expect(history[0].attemptCount).toBe(2);
    expect(history[0].validationErrors).toEqual([{ path: 'entities[0].behavior', message: 'must be one of: patrol, chase' }]);
    expect(history[1].attemptCount).toBe(1);
    expect(history[1].validationErrors).toBeNull();
  });
});

describe('rollbackGameVersion', () => {
  it('appends a new version copying an old spec forward, without mutating history', async () => {
    const v1 = await createGameVersion({
      userId: PLACEHOLDER_USER_ID,
      title: 'Rollback Test',
      specJson: spec({ meta: { title: 'v1 spec', width: 800, height: 600 } }),
      source: 'generate',
      prompt: 'v1 prompt',
      attemptCount: 1,
      usedFallback: false,
      validationErrors: null,
    });
    createdGameIds.push(v1.gameId);

    await createGameVersion({
      gameId: v1.gameId,
      userId: PLACEHOLDER_USER_ID,
      specJson: spec({ meta: { title: 'v2 spec', width: 800, height: 600 } }),
      source: 'generate',
      prompt: 'v2 prompt',
      attemptCount: 1,
      usedFallback: false,
      validationErrors: null,
    });

    const rolledBack = await rollbackGameVersion(v1.gameId, v1.version.id);
    expect(rolledBack?.versionNumber).toBe(3);
    expect(rolledBack?.source).toBe('rollback');
    expect((rolledBack?.specJson as GameSpec).meta.title).toBe('v1 spec');

    // v1's original row is untouched — history is append-only, never rewound.
    const original = await getVersionById(v1.gameId, v1.version.id);
    expect(original?.versionNumber).toBe(1);
    expect(original?.source).toBe('generate');

    const game = await getGame(v1.gameId);
    expect(game?.currentVersionId).toBe(rolledBack?.id);

    const current = await getGameWithCurrentVersion(v1.gameId);
    expect(current?.versionNumber).toBe(3);
    expect((current?.specJson as GameSpec).meta.title).toBe('v1 spec');

    const history = await listVersions(v1.gameId);
    expect(history.map((v) => [v.versionNumber, v.source])).toEqual([
      [3, 'rollback'],
      [2, 'generate'],
      [1, 'generate'],
    ]);
  });

  it('returns undefined when toVersionId does not belong to the game', async () => {
    const gameA = await createGameVersion({
      userId: PLACEHOLDER_USER_ID,
      title: 'Game A',
      specJson: spec(),
      source: 'generate',
      prompt: 'a',
      attemptCount: 1,
      usedFallback: false,
      validationErrors: null,
    });
    createdGameIds.push(gameA.gameId);

    const gameB = await createGameVersion({
      userId: PLACEHOLDER_USER_ID,
      title: 'Game B',
      specJson: spec(),
      source: 'generate',
      prompt: 'b',
      attemptCount: 1,
      usedFallback: false,
      validationErrors: null,
    });
    createdGameIds.push(gameB.gameId);

    const result = await rollbackGameVersion(gameA.gameId, gameB.version.id);
    expect(result).toBeUndefined();
  });
});

describe('getGameWithCurrentVersion', () => {
  it('returns undefined for a game id that does not exist', async () => {
    const row = await getGameWithCurrentVersion('00000000-0000-0000-0000-000000000000');
    expect(row).toBeUndefined();
  });
});

// Phase 4: an 'edit' version additionally records *how* it was resolved
// (deterministic vs. llm_patch) — this is the diagnostic signal that
// answers "are edits mostly hitting the cheap path or falling through to
// the LLM" without re-running anything.
describe('createGameVersion — editSource (Phase 4)', () => {
  it('persists and round-trips edit_source through listVersions and getVersionById', async () => {
    const gen = await createGameVersion({
      userId: PLACEHOLDER_USER_ID,
      title: 'Edit Source Test',
      specJson: spec(),
      source: 'generate',
      prompt: 'a game',
      attemptCount: 1,
      usedFallback: false,
      validationErrors: null,
    });
    createdGameIds.push(gen.gameId);

    const deterministicEdit = await createGameVersion({
      gameId: gen.gameId,
      userId: PLACEHOLDER_USER_ID,
      specJson: spec({ player: { ...spec().player, speed: 240 } }),
      source: 'edit',
      editSource: 'deterministic',
      prompt: 'make the player faster',
      attemptCount: 0,
      usedFallback: false,
      validationErrors: null,
    });

    const llmEdit = await createGameVersion({
      gameId: gen.gameId,
      userId: PLACEHOLDER_USER_ID,
      specJson: spec({ player: { ...spec().player, health: 20 } }),
      source: 'edit',
      editSource: 'llm_patch',
      prompt: 'give the player a shield',
      attemptCount: 2,
      usedFallback: false,
      validationErrors: null,
    });

    expect(deterministicEdit.version.editSource).toBe('deterministic');
    expect(llmEdit.version.editSource).toBe('llm_patch');

    const history = await listVersions(gen.gameId);
    expect(history.map((v) => [v.source, v.editSource])).toEqual([
      ['edit', 'llm_patch'],
      ['edit', 'deterministic'],
      ['generate', null],
    ]);

    const fetched = await getVersionById(gen.gameId, deterministicEdit.version.id);
    expect(fetched?.editSource).toBe('deterministic');
  });

  it('rejects an edit_source value outside the allowed set at the database level', async () => {
    const gen = await createGameVersion({
      userId: PLACEHOLDER_USER_ID,
      title: 'Edit Source Check Constraint Test',
      specJson: spec(),
      source: 'generate',
      prompt: 'a game',
      attemptCount: 1,
      usedFallback: false,
      validationErrors: null,
    });
    createdGameIds.push(gen.gameId);

    await expect(
      createGameVersion({
        gameId: gen.gameId,
        userId: PLACEHOLDER_USER_ID,
        specJson: spec(),
        source: 'edit',
        editSource: 'not_a_real_source' as never,
        prompt: 'bad',
        attemptCount: 0,
        usedFallback: false,
        validationErrors: null,
      }),
    ).rejects.toThrow();
  });

  it('rejects edit_source being set on a non-edit version at the database level', async () => {
    const gen = await createGameVersion({
      userId: PLACEHOLDER_USER_ID,
      title: 'Edit Source Scope Check Test',
      specJson: spec(),
      source: 'generate',
      prompt: 'a game',
      attemptCount: 1,
      usedFallback: false,
      validationErrors: null,
    });
    createdGameIds.push(gen.gameId);

    await expect(
      createGameVersion({
        gameId: gen.gameId,
        userId: PLACEHOLDER_USER_ID,
        specJson: spec(),
        source: 'rollback',
        editSource: 'deterministic',
        prompt: null,
        attemptCount: 0,
        usedFallback: false,
        validationErrors: null,
      }),
    ).rejects.toThrow();
  });
});
