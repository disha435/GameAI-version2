import { describe, expect, it } from 'vitest';
import { validateGameSpec } from '../../src/spec/validate';
import type { EntitySpec, GameSpec } from '../../src/spec/types';
import { applyPatchSafely } from './jsonPatch';
import { matchIntent } from './intents';

function baseSpec(entities: EntitySpec[] = [], overrides: Partial<GameSpec> = {}): GameSpec {
  return {
    meta: { title: 'Test Game', width: 800, height: 600 },
    movementType: 'topdown_8dir',
    theme: 'dungeon',
    world: { tileSize: 32, backgroundColor: '#1d1d2b', bounds: { width: 1600, height: 1200 } },
    player: { start: { x: 50, y: 50 }, sprite: 'player', health: 10, speed: 150 },
    entities,
    winCondition: { type: 'defeat_all_enemies' },
    ...overrides,
  };
}

function patrolEnemy(overrides: Partial<EntitySpec> = {}): EntitySpec {
  return {
    id: 'patrol_1',
    type: 'enemy',
    sprite: 'enemy_patrol',
    position: { x: 100, y: 100 },
    behavior: 'patrol',
    behaviorParams: { speed: 60, patrolPoints: [{ x: 0, y: 0 }, { x: 100, y: 100 }] },
    health: 2,
    damage: 1,
    scoreValue: 10,
    ...overrides,
  };
}

// Unit tests only — no LLM, no DB. This proves the deterministic path (the
// cheap, zero-cost, fully predictable one editSpec always tries first)
// works in isolation before the LLM fallback path is layered on top.
describe('matchIntent — enemy_speed_multiplier', () => {
  it('bumps a patrol enemy\'s existing behaviorParams.speed for "faster"', () => {
    const spec = baseSpec([patrolEnemy({ behaviorParams: { speed: 60, patrolPoints: [] } })]);
    const result = matchIntent('make the enemies faster', spec);
    expect(result?.name).toBe('enemy_speed_multiplier');
    const candidate = applyPatchSafely(spec, result!.patch);
    expect(candidate.entities[0].behaviorParams?.speed).toBe(96); // 60 * 1.6
    expect(validateGameSpec(candidate).valid).toBe(true);
  });

  it('reduces speed for "slower"', () => {
    const spec = baseSpec([patrolEnemy({ behaviorParams: { speed: 60, patrolPoints: [] } })]);
    const result = matchIntent('make enemies slower', spec);
    const candidate = applyPatchSafely(spec, result!.patch);
    expect(candidate.entities[0].behaviorParams?.speed).toBe(36); // 60 * 0.6
  });

  it('creates behaviorParams from scratch when the entity has none, using the behavior\'s own default speed', () => {
    const spec = baseSpec([patrolEnemy({ behaviorParams: undefined })]);
    const result = matchIntent('make the enemies quicker', spec);
    const candidate = applyPatchSafely(spec, result!.patch);
    expect(candidate.entities[0].behaviorParams?.speed).toBe(96); // patrol's default 60 * 1.6
  });

  it('also scales fleeSpeed when set, alongside speed, for a flee enemy', () => {
    const spec = baseSpec([
      patrolEnemy({ id: 'fleeing_1', behavior: 'flee', behaviorParams: { speed: 100, fleeSpeed: 120 } }),
    ]);
    const result = matchIntent('make the enemies faster', spec);
    const candidate = applyPatchSafely(spec, result!.patch);
    expect(candidate.entities[0].behaviorParams?.speed).toBe(160);
    expect(candidate.entities[0].behaviorParams?.fleeSpeed).toBe(192);
  });

  it('falls through (returns null) when no enemy has a speed-affecting behavior', () => {
    const spec = baseSpec([
      { id: 's1', type: 'enemy', sprite: 'enemy_shooter', position: { x: 0, y: 0 }, behavior: 'shooter', health: 3 },
    ]);
    expect(matchIntent('make the enemies faster', spec)).toBeNull();
  });

  it('does not touch boss or pickup entities', () => {
    const spec = baseSpec([
      patrolEnemy(),
      { id: 'boss_1', type: 'boss', sprite: 'boss', position: { x: 0, y: 0 }, behavior: 'patrol', behaviorParams: { speed: 40 }, health: 20 },
      { id: 'coin_1', type: 'pickup', sprite: 'pickup_coin', position: { x: 0, y: 0 }, pickupType: 'coin', value: 5 },
    ]);
    const result = matchIntent('make enemies faster', spec);
    const candidate = applyPatchSafely(spec, result!.patch);
    expect(candidate.entities[1].behaviorParams?.speed).toBe(40); // boss untouched
  });
});

describe('matchIntent — boss_health_change', () => {
  it('halves boss health for "weaker"', () => {
    const spec = baseSpec([
      { id: 'boss_1', type: 'boss', sprite: 'boss', position: { x: 0, y: 0 }, behavior: 'stationary', health: 20 },
    ]);
    const result = matchIntent('make the boss weaker', spec);
    expect(result?.name).toBe('boss_health_change');
    const candidate = applyPatchSafely(spec, result!.patch);
    expect(candidate.entities[0].health).toBe(10);
  });

  it('increases boss health 1.5x for "stronger"/"tougher"', () => {
    const spec = baseSpec([
      { id: 'boss_1', type: 'boss', sprite: 'boss', position: { x: 0, y: 0 }, behavior: 'stationary', health: 20 },
    ]);
    const candidate1 = applyPatchSafely(spec, matchIntent('make the boss stronger', spec)!.patch);
    expect(candidate1.entities[0].health).toBe(30);
    const candidate2 = applyPatchSafely(spec, matchIntent('make the boss tougher', spec)!.patch);
    expect(candidate2.entities[0].health).toBe(30);
  });

  it('never drops health below 1, and falls through when there is no boss', () => {
    const noBoss = baseSpec([patrolEnemy()]);
    expect(matchIntent('make the boss weaker', noBoss)).toBeNull();

    const lowHealthBoss = baseSpec([
      { id: 'boss_1', type: 'boss', sprite: 'boss', position: { x: 0, y: 0 }, behavior: 'stationary', health: 1 },
    ]);
    const candidate = applyPatchSafely(lowHealthBoss, matchIntent('make the boss weaker', lowHealthBoss)!.patch);
    expect(candidate.entities[0].health).toBe(1); // floored at 1, never 0 or negative
  });
});

describe('matchIntent — player_speed_change and player_health_change', () => {
  it('adjusts player.speed', () => {
    const spec = baseSpec([]);
    const faster = applyPatchSafely(spec, matchIntent('make the player faster', spec)!.patch);
    expect(faster.player.speed).toBe(225); // 150 * 1.5
    const slower = applyPatchSafely(spec, matchIntent('make the player slower', spec)!.patch);
    expect(slower.player.speed).toBe(98); // round(150 * 0.65)
  });

  it('adjusts player.health via either phrasing', () => {
    const spec = baseSpec([]);
    const more = applyPatchSafely(spec, matchIntent('give the player more health', spec)!.patch);
    expect(more.player.health).toBe(15); // 10 * 1.5
    const tougher = applyPatchSafely(spec, matchIntent('make the player tougher', spec)!.patch);
    expect(tougher.player.health).toBe(15);
    const less = applyPatchSafely(spec, matchIntent('give the player less health', spec)!.patch);
    expect(less.player.health).toBe(6); // round(10 * 0.6)
  });
});

describe('matchIntent — add_enemy_count and add_pickup_count', () => {
  it('appends the requested number of enemies, cloned from an existing one', () => {
    const spec = baseSpec([patrolEnemy()]);
    const result = matchIntent('add 2 more enemies', spec);
    expect(result?.patch).toHaveLength(2);
    const candidate = applyPatchSafely(spec, result!.patch);
    expect(candidate.entities).toHaveLength(3);
    expect(candidate.entities[1].type).toBe('enemy');
    expect(candidate.entities[1].id).not.toBe(candidate.entities[2].id);
    expect(validateGameSpec(candidate).valid).toBe(true);
  });

  it('defaults to 3 for vague quantities ("a", "some")', () => {
    const spec = baseSpec([patrolEnemy()]);
    expect(matchIntent('add some enemies', spec)?.patch).toHaveLength(3);
  });

  it('uses a generic template when no enemy exists yet', () => {
    const spec = baseSpec([]);
    const result = matchIntent('add a enemy', spec);
    const candidate = applyPatchSafely(spec, result!.patch);
    expect(candidate.entities).toHaveLength(3);
    expect(validateGameSpec(candidate).valid).toBe(true);
  });

  it('clones pickups independently (no shared object references between clones)', () => {
    const spec = baseSpec(
      [{ id: 'coin_1', type: 'pickup', sprite: 'pickup_coin', position: { x: 10, y: 10 }, pickupType: 'coin', value: 5 }],
      { winCondition: { type: 'collect_all_pickups' } },
    );
    const result = matchIntent('add 2 more coins', spec);
    const candidate = applyPatchSafely(spec, result!.patch);
    const [a, b] = candidate.entities.slice(1);
    expect(a.position).not.toBe(b.position);
    expect(validateGameSpec(candidate).valid).toBe(true);
  });
});

describe('matchIntent — survive_duration_change', () => {
  it('parses seconds and minutes into winCondition.threshold', () => {
    const spec = baseSpec([]);
    const seconds = applyPatchSafely(spec, matchIntent('survive for 45 seconds', spec)!.patch);
    expect(seconds.winCondition).toEqual({ type: 'survive_duration', threshold: 45 });
    const minutes = applyPatchSafely(spec, matchIntent('survive 2 minutes', spec)!.patch);
    expect(minutes.winCondition).toEqual({ type: 'survive_duration', threshold: 120 });
  });
});

describe('matchIntent — no match', () => {
  it('returns null for an instruction outside the deterministic vocabulary', () => {
    const spec = baseSpec([patrolEnemy()]);
    expect(matchIntent('give the player a shield', spec)).toBeNull();
    expect(matchIntent('add a fourth boss', spec)).toBeNull();
  });
});
