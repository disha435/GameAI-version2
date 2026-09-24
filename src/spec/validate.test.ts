import { describe, expect, it } from 'vitest';
import { validateGameSpec, type ValidationError } from './validate';
import type { EntitySpec, GameSpec } from './types';

// A minimal, valid spec every test mutates a fresh deep clone of, so one
// test's mutation can never leak into another.
function validSpec(): GameSpec {
  return {
    meta: { title: 'Test Game', width: 800, height: 600 },
    movementType: 'topdown_8dir',
    theme: 'dungeon',
    world: {
      tileSize: 32,
      backgroundColor: '#1d1d2b',
      bounds: { width: 800, height: 600 },
    },
    player: {
      start: { x: 50, y: 50 },
      sprite: 'player',
      health: 10,
      speed: 100,
    },
    entities: [
      {
        id: 'boss_1',
        type: 'boss',
        sprite: 'boss',
        position: { x: 400, y: 300 },
        behavior: 'stationary',
        health: 10,
        damage: 1,
        scoreValue: 50,
      },
    ],
    winCondition: { type: 'defeat_boss' },
  };
}

function clone(spec: GameSpec): GameSpec {
  return JSON.parse(JSON.stringify(spec));
}

function findError(errors: ValidationError[], path: string): ValidationError | undefined {
  return errors.find((e) => e.path === path);
}

describe('validateGameSpec — happy path', () => {
  it('accepts a well-formed spec with no errors', () => {
    const result = validateGameSpec(validSpec());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts every declared win condition type when its requirements are met', () => {
    const bases: Array<[GameSpec['winCondition'], EntitySpec[]]> = [
      [{ type: 'defeat_boss' }, [{ id: 'b', type: 'boss', sprite: 'boss', position: { x: 1, y: 1 }, behavior: 'stationary', health: 5 }]],
      [{ type: 'defeat_all_enemies' }, [{ id: 'e', type: 'enemy', sprite: 'enemy_patrol', position: { x: 1, y: 1 }, behavior: 'patrol', health: 5 }]],
      [{ type: 'collect_all_pickups' }, [{ id: 'p', type: 'pickup', sprite: 'pickup_coin', position: { x: 1, y: 1 }, pickupType: 'coin', value: 5 }]],
      [
        { type: 'reach_trigger' },
        [{ id: 't', type: 'trigger', sprite: 'trigger_zone', position: { x: 1, y: 1 }, triggerType: 'win' }],
      ],
      [
        { type: 'score_threshold', threshold: 10 },
        [{ id: 'e', type: 'enemy', sprite: 'enemy_patrol', position: { x: 1, y: 1 }, behavior: 'patrol', health: 5, scoreValue: 20 }],
      ],
    ];
    for (const [winCondition, entities] of bases) {
      const spec = clone(validSpec());
      spec.entities = entities;
      spec.winCondition = winCondition;
      const result = validateGameSpec(spec);
      expect(result.errors, `winCondition ${JSON.stringify(winCondition)}`).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });
});

describe('validateGameSpec — non-object input', () => {
  it.each([null, undefined, 'a string', 42, [1, 2, 3]])('rejects %p without crashing', (bad) => {
    const result = validateGameSpec(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('validateGameSpec — Gate 1: schema conformance', () => {
  it('reports every missing required top-level field', () => {
    const result = validateGameSpec({});
    expect(result.valid).toBe(false);
    for (const field of ['meta', 'movementType', 'theme', 'world', 'player', 'entities', 'winCondition']) {
      expect(findError(result.errors, field), `expected an error at "${field}"`).toBeTruthy();
    }
  });

  it('rejects a movementType outside the closed enum', () => {
    const spec = clone(validSpec());
    (spec as any).movementType = 'flying_carpet';
    const result = validateGameSpec(spec);
    const err = findError(result.errors, 'movementType');
    expect(err?.message).toContain('topdown_8dir');
    expect(err?.message).toContain('platformer_run_jump');
  });

  it('requires theme and rejects a value outside the closed enum', () => {
    const missing: any = clone(validSpec());
    delete missing.theme;
    expect(findError(validateGameSpec(missing).errors, 'theme')).toBeTruthy();

    const invalid = clone(validSpec());
    (invalid as any).theme = 'underwater';
    const err = findError(validateGameSpec(invalid).errors, 'theme');
    expect(err?.message).toContain('dungeon');
    expect(err?.message).toContain('space');
  });

  it('rejects an entity behavior outside the closed enum', () => {
    const spec = clone(validSpec());
    (spec.entities[0] as any).behavior = 'teleport';
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'entities[0].behavior')).toBeTruthy();
  });

  it('rejects wrong field types', () => {
    const spec = clone(validSpec());
    (spec.meta as any).width = 'wide';
    const result = validateGameSpec(spec);
    const err = findError(result.errors, 'meta.width');
    expect(err?.message).toContain('number');
  });

  it('rejects an unrecognized top-level field (typo-catching)', () => {
    const spec: any = clone(validSpec());
    spec.winConditon = spec.winCondition; // typo'd field name
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'winConditon')).toBeTruthy();
  });

  it('rejects a malformed backgroundColor', () => {
    const spec = clone(validSpec());
    spec.world.backgroundColor = 'blue';
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'world.backgroundColor')).toBeTruthy();
  });

  it('rejects a non-positive player.jumpVelocity', () => {
    // Regression test: an LLM-authored platformer spec supplied a negative
    // jumpVelocity (a defensible-but-wrong reading of "up is negative Y"
    // that nothing documented) — the runtime negates it again to decide
    // jump direction, so a negative input silently produced a downward
    // shove absorbed instantly by standing on the ground: pressing jump did
    // nothing, with no error anywhere. jumpVelocity is always a magnitude.
    const spec = clone(validSpec());
    spec.player.jumpVelocity = -600;
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'player.jumpVelocity')).toBeTruthy();

    spec.player.jumpVelocity = 420;
    expect(validateGameSpec(spec).valid).toBe(true);
  });

  it('reports duplicate entity ids', () => {
    const spec = clone(validSpec());
    spec.entities.push({ ...spec.entities[0], id: spec.entities[0].id });
    const result = validateGameSpec(spec);
    const err = findError(result.errors, 'entities[1].id');
    expect(err?.message).toContain('duplicates');
  });
});

describe('validateGameSpec — Gate 2: reference integrity', () => {
  it('rejects a sprite key that is not in the asset registry', () => {
    const spec = clone(validSpec());
    spec.player.sprite = 'made_up_sprite';
    const result = validateGameSpec(spec);
    const err = findError(result.errors, 'player.sprite');
    expect(err?.message).toContain('unknown asset');
  });

  it('rejects an unregistered groundTile', () => {
    const spec = clone(validSpec());
    spec.world.groundTile = 'lava_tiles';
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'world.groundTile')).toBeTruthy();
  });

  it('rejects an unregistered projectileSprite on a behavior', () => {
    const spec = clone(validSpec());
    spec.entities[0].behaviorParams = { projectileSprite: 'laser_beam' };
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'entities[0].behaviorParams.projectileSprite')).toBeTruthy();
  });
});

describe('validateGameSpec — Gate 3: gameplay invariants', () => {
  it('rejects a player start outside world bounds', () => {
    const spec = clone(validSpec());
    spec.player.start = { x: 9999, y: 9999 };
    const result = validateGameSpec(spec);
    const err = findError(result.errors, 'player.start');
    expect(err?.message).toContain('outside world bounds');
  });

  it('rejects an entity position outside world bounds', () => {
    const spec = clone(validSpec());
    spec.entities[0].position = { x: -5, y: 0 };
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'entities[0].position')).toBeTruthy();
  });

  it('rejects non-positive player health and speed', () => {
    const spec = clone(validSpec());
    spec.player.health = 0;
    spec.player.speed = -10;
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'player.health')).toBeTruthy();
    expect(findError(result.errors, 'player.speed')).toBeTruthy();
  });

  it('rejects negative health/damage/scoreValue/value on entities', () => {
    const spec = clone(validSpec());
    spec.entities[0].health = -1;
    spec.entities[0].damage = -1;
    spec.entities[0].scoreValue = -1;
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'entities[0].health')?.message).toContain('negative');
    expect(findError(result.errors, 'entities[0].damage')?.message).toContain('negative');
    expect(findError(result.errors, 'entities[0].scoreValue')?.message).toContain('negative');
  });

  it('rejects an enemy/boss spawned with exactly 0 health', () => {
    const spec = clone(validSpec());
    spec.entities[0].health = 0;
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'entities[0].health')?.message).toContain('dead on spawn');
  });

  it('rejects defeat_boss when no boss entity exists', () => {
    const spec = clone(validSpec());
    spec.entities = [];
    const result = validateGameSpec(spec);
    const err = findError(result.errors, 'winCondition');
    expect(err?.message).toContain('defeat_boss');
  });

  it('rejects defeat_boss targetId that does not match any boss id', () => {
    const spec = clone(validSpec());
    spec.winCondition = { type: 'defeat_boss', targetId: 'nonexistent_boss' };
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'winCondition.targetId')).toBeTruthy();
  });

  it('rejects collect_all_pickups when no pickup entities exist', () => {
    const spec = clone(validSpec());
    spec.winCondition = { type: 'collect_all_pickups' };
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'winCondition')?.message).toContain('collect_all_pickups');
  });

  it('rejects reach_trigger when no win-trigger entity exists', () => {
    const spec = clone(validSpec());
    spec.winCondition = { type: 'reach_trigger' };
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'winCondition')?.message).toContain('reach_trigger');
  });

  it('rejects reach_trigger with auto_scroll_vertical when the win trigger is behind the player start', () => {
    // autoScrollVertical.ts only ever scrolls toward larger y at a fixed
    // rate, and shmup_freeaxis clamps the player to whatever is currently
    // on screen — so a win trigger at or above player.start.y can never be
    // scrolled into reach. Caught the hard way: a live-generated "spaceship
    // racing" spec spawned the player near the world's bottom with the
    // finish line near the top, and the runtime's own spawn-time camera
    // clamp (autoScrollVertical.configure) snapped the player straight onto
    // the trigger on the very first frame — an instant, meaningless win.
    const spec = clone(validSpec());
    spec.camera = 'auto_scroll_vertical';
    spec.player.start = { x: 400, y: 500 };
    spec.entities = [{ id: 't', type: 'trigger', sprite: 'trigger_zone', position: { x: 400, y: 100 }, triggerType: 'win' }];
    spec.winCondition = { type: 'reach_trigger' };
    const result = validateGameSpec(spec);
    const err = findError(result.errors, 'winCondition');
    expect(err?.message).toContain('auto_scroll_vertical');
  });

  it('accepts reach_trigger with auto_scroll_vertical when the win trigger is ahead of the player start', () => {
    const spec = clone(validSpec());
    spec.camera = 'auto_scroll_vertical';
    spec.player.start = { x: 400, y: 100 };
    spec.entities = [{ id: 't', type: 'trigger', sprite: 'trigger_zone', position: { x: 400, y: 500 }, triggerType: 'win' }];
    spec.winCondition = { type: 'reach_trigger' };
    const result = validateGameSpec(spec);
    expect(result.errors).toEqual([]);
  });

  it('rejects an unreachable score_threshold', () => {
    const spec = clone(validSpec());
    spec.winCondition = { type: 'score_threshold', threshold: 999999 };
    const result = validateGameSpec(spec);
    const err = findError(result.errors, 'winCondition.threshold');
    expect(err?.message).toContain('cannot be won');
  });

  it('accepts a reachable score_threshold that sums coin values and enemy scoreValue', () => {
    const spec = clone(validSpec());
    spec.entities = [
      { id: 'e1', type: 'enemy', sprite: 'enemy_patrol', position: { x: 1, y: 1 }, behavior: 'patrol', health: 5, scoreValue: 30 },
      { id: 'c1', type: 'pickup', sprite: 'pickup_coin', position: { x: 2, y: 2 }, pickupType: 'coin', value: 10 },
    ];
    spec.winCondition = { type: 'score_threshold', threshold: 40 };
    const result = validateGameSpec(spec);
    expect(result.errors).toEqual([]);
  });
});

describe('validateGameSpec — movementModifiers', () => {
  it('accepts a spec with no movementModifiers at all — additive, not required', () => {
    const spec = clone(validSpec());
    expect((spec.player as any).movementModifiers).toBeUndefined();
    const result = validateGameSpec(spec);
    expect(result.errors).toEqual([]);
  });

  it('accepts a fully-specified movementModifiers object (Flappy-Bird-style composition)', () => {
    const spec: any = clone(validSpec());
    spec.player.movementModifiers = {
      axisConstraint: 'vertical',
      gravity: { enabled: true, magnitude: 800 },
      inputMode: 'impulse',
      impulseForce: 400,
    };
    const result = validateGameSpec(spec);
    expect(result.errors).toEqual([]);
  });

  it('rejects gravity.enabled=true without a magnitude', () => {
    const spec: any = clone(validSpec());
    spec.player.movementModifiers = { gravity: { enabled: true } };
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'player.movementModifiers.gravity.magnitude')).toBeTruthy();
  });

  it('accepts gravity.enabled=false without a magnitude', () => {
    const spec: any = clone(validSpec());
    spec.player.movementModifiers = { gravity: { enabled: false } };
    const result = validateGameSpec(spec);
    expect(result.errors).toEqual([]);
  });

  it('rejects inputMode="impulse" without an impulseForce', () => {
    const spec: any = clone(validSpec());
    spec.player.movementModifiers = { inputMode: 'impulse' };
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'player.movementModifiers.impulseForce')).toBeTruthy();
  });

  it('rejects an axisConstraint outside the closed enum', () => {
    const spec: any = clone(validSpec());
    spec.player.movementModifiers = { axisConstraint: 'diagonal' };
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'player.movementModifiers.axisConstraint')).toBeTruthy();
  });

  it('rejects a gridSnap cellSize that does not evenly divide world.bounds', () => {
    const spec: any = clone(validSpec()); // world.bounds is 800x600
    spec.player.movementModifiers = { gridSnap: { cellSize: 300 } }; // 800 % 300 !== 0
    const result = validateGameSpec(spec);
    const err = findError(result.errors, 'player.movementModifiers.gridSnap.cellSize');
    expect(err?.message).toContain('evenly divide');
  });

  it('accepts a gridSnap cellSize that evenly divides world.bounds', () => {
    const spec: any = clone(validSpec()); // world.bounds is 800x600
    spec.player.movementModifiers = { gridSnap: { cellSize: 200 } }; // both 800 and 600 divide evenly
    const result = validateGameSpec(spec);
    expect(result.errors).toEqual([]);
  });
});

describe('validateGameSpec — spawners', () => {
  function validSpawner(overrides: Record<string, unknown> = {}) {
    return {
      id: 'hazard_spawner',
      entityTemplate: { type: 'enemy', sprite: 'enemy_patrol', behavior: 'fall_and_despawn' },
      interval: 2,
      spawnEdge: 'top',
      moveDirection: 'down',
      moveSpeed: 100,
      ...overrides,
    };
  }

  it('accepts a spec with no spawners at all — additive, not required', () => {
    const spec: any = clone(validSpec());
    expect(spec.spawners).toBeUndefined();
    const result = validateGameSpec(spec);
    expect(result.errors).toEqual([]);
  });

  it('accepts a well-formed single-entity spawner', () => {
    const spec: any = clone(validSpec());
    spec.spawners = [validSpawner()];
    const result = validateGameSpec(spec);
    expect(result.errors).toEqual([]);
  });

  it('accepts a well-formed paired-gap spawner', () => {
    const spec: any = clone(validSpec());
    spec.spawners = [
      validSpawner({
        spawnEdge: 'right',
        moveDirection: 'left',
        pairedGap: { gapSize: 120, gapPositionRange: { min: 100, max: 400 }, gapScoreValue: 10 },
      }),
    ];
    const result = validateGameSpec(spec);
    expect(result.errors).toEqual([]);
  });

  it('rejects a spawner entityTemplate referencing an unregistered sprite', () => {
    const spec: any = clone(validSpec());
    spec.spawners = [validSpawner({ entityTemplate: { type: 'enemy', sprite: 'nonexistent_sprite' } })];
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'spawners[0].entityTemplate.sprite')).toBeTruthy();
  });

  it('rejects a spawner entityTemplate referencing an unregistered behavior', () => {
    const spec: any = clone(validSpec());
    spec.spawners = [validSpawner({ entityTemplate: { type: 'enemy', sprite: 'enemy_patrol', behavior: 'aggressive' } })];
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'spawners[0].entityTemplate.behavior')).toBeTruthy();
  });

  it('rejects a spawner entityTemplate with negative health/damage/scoreValue', () => {
    const spec: any = clone(validSpec());
    spec.spawners = [
      validSpawner({ entityTemplate: { type: 'enemy', sprite: 'enemy_patrol', health: -1, damage: -1, scoreValue: -1 } }),
    ];
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'spawners[0].entityTemplate.health')?.message).toContain('negative');
    expect(findError(result.errors, 'spawners[0].entityTemplate.damage')?.message).toContain('negative');
    expect(findError(result.errors, 'spawners[0].entityTemplate.scoreValue')?.message).toContain('negative');
  });

  it('rejects defeat_all_enemies paired with any spawner', () => {
    const spec: any = clone(validSpec());
    spec.spawners = [validSpawner()];
    spec.winCondition = { type: 'defeat_all_enemies' };
    const result = validateGameSpec(spec);
    const err = findError(result.errors, 'winCondition');
    expect(err?.message).toContain('defeat_all_enemies');
  });

  it('rejects collect_all_pickups paired with a pairedGap spawner', () => {
    const spec: any = clone(validSpec());
    spec.spawners = [
      validSpawner({
        spawnEdge: 'right',
        moveDirection: 'left',
        pairedGap: { gapSize: 120, gapPositionRange: { min: 100, max: 400 }, gapScoreValue: 10 },
      }),
    ];
    spec.winCondition = { type: 'collect_all_pickups' };
    const result = validateGameSpec(spec);
    const err = findError(result.errors, 'winCondition');
    expect(err?.message).toContain('collect_all_pickups');
  });

  it('accepts collect_all_pickups paired with a non-pairedGap spawner (no pickups implied)', () => {
    const spec: any = clone(validSpec());
    spec.entities.push({ id: 'coin_1', type: 'pickup', sprite: 'pickup_coin', position: { x: 5, y: 5 }, pickupType: 'coin', value: 5 });
    spec.spawners = [validSpawner()]; // no pairedGap — never creates pickups
    spec.winCondition = { type: 'collect_all_pickups' };
    const result = validateGameSpec(spec);
    expect(result.errors).toEqual([]);
  });

  it('accepts survive_duration paired with any spawner (not at-risk)', () => {
    const spec: any = clone(validSpec());
    spec.spawners = [validSpawner()];
    spec.winCondition = { type: 'survive_duration', threshold: 30 };
    const result = validateGameSpec(spec);
    expect(result.errors).toEqual([]);
  });
});

describe('validateGameSpec — reports everything in one pass', () => {
  it('does not stop at the first failing gate', () => {
    const spec = clone(validSpec());
    (spec as any).movementType = 'nonsense'; // Gate 1
    spec.player.sprite = 'made_up_sprite'; // Gate 2
    spec.player.health = -5; // Gate 3
    const result = validateGameSpec(spec);
    expect(findError(result.errors, 'movementType')).toBeTruthy();
    expect(findError(result.errors, 'player.sprite')).toBeTruthy();
    expect(findError(result.errors, 'player.health')).toBeTruthy();
  });
});
