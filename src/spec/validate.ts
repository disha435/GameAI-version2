import Ajv, { type ErrorObject } from 'ajv';
import { getRegisteredAssetKeys } from '../assets/assetKeys';
import schema from './gamespec.schema.json';
import { BEHAVIORS, ENTITY_TYPES, MOVEMENT_TYPES, type CameraMode, type EntitySpec, type GameSpec, type Vec2, type WinConditionSpec } from './types';

// This is Gate 1 for everything downstream, including a future LLM authoring
// loop: a spec is only ever handed to SceneInterpreter after passing all
// three checks below, and the structured {path, message} errors this
// produces are exactly what a spec-fixing retry loop would feed back to the
// model that generated a broken spec.
export interface ValidationError {
  /** Dot/bracket path into the spec, e.g. "entities[2].behaviorParams", or "(root)". */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

/**
 * Runs all three validation gates and returns every error found across all
 * of them in one pass (rather than stopping at the first failing gate) so a
 * caller — human or LLM retry loop — can fix everything in one round trip.
 *
 * Gate 1 — schema conformance: required fields, correct types, closed enums.
 * Gate 2 — reference integrity: every sprite/entity-type/behavior/movement
 *          string actually exists in the corresponding live registry.
 * Gate 3 — gameplay invariants: win condition is reachable given the
 *          entities present, no negative health/speed/damage, all positions
 *          fall inside the world bounds, a player start exists.
 *
 * Gates 2 and 3 run even when Gate 1 finds problems (using defensive
 * optional-chaining over a Partial<GameSpec>), *unless* the input isn't
 * even an object — at that point there's nothing meaningful left to check.
 */
export function validateGameSpec(spec: unknown): ValidationResult {
  const structuralErrors = validateStructure(spec);

  if (typeof spec !== 'object' || spec === null) {
    return { valid: false, errors: structuralErrors };
  }

  const partial = spec as Partial<GameSpec>;
  const errors = [
    ...structuralErrors,
    ...checkDuplicateIds(partial),
    ...checkReferenceIntegrity(partial),
    ...checkGameplayInvariants(partial),
  ];
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Gate 1: schema conformance (ajv, driven by gamespec.schema.json)
// ---------------------------------------------------------------------------

function validateStructure(spec: unknown): ValidationError[] {
  const ok = validateSchema(spec);
  if (ok) return [];
  return (validateSchema.errors ?? []).map(formatAjvError);
}

function toPath(instancePath: string): string {
  if (!instancePath) return '(root)';
  const segments = instancePath
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let out = '';
  for (const seg of segments) {
    out += /^\d+$/.test(seg) ? `[${seg}]` : out ? `.${seg}` : seg;
  }
  return out;
}

function formatAjvError(err: ErrorObject): ValidationError {
  const base = toPath(err.instancePath);
  switch (err.keyword) {
    case 'required': {
      const missing = String((err.params as { missingProperty: string }).missingProperty);
      return { path: base === '(root)' ? missing : `${base}.${missing}`, message: 'is required' };
    }
    case 'enum': {
      const allowed = (err.params as { allowedValues: unknown[] }).allowedValues;
      return { path: base, message: `must be one of: ${allowed.join(', ')} (got ${JSON.stringify(err.data)})` };
    }
    case 'additionalProperties': {
      const extra = String((err.params as { additionalProperty: string }).additionalProperty);
      return { path: base === '(root)' ? extra : `${base}.${extra}`, message: 'is not a recognized field' };
    }
    case 'type':
      return { path: base, message: `must be of type ${(err.params as { type: string }).type} (got ${JSON.stringify(err.data)})` };
    case 'pattern':
      return { path: base, message: `does not match required pattern ${(err.params as { pattern: string }).pattern}` };
    default:
      return { path: base, message: err.message ?? 'is invalid' };
  }
}

// ---------------------------------------------------------------------------
// Structural extra: duplicate ids (a uniqueness constraint across array items
// keyed by a field, which JSON Schema can't express without custom keywords)
// ---------------------------------------------------------------------------

function checkDuplicateIds(spec: Partial<GameSpec>): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Set<string>();
  (spec.entities ?? []).forEach((e, i) => {
    if (typeof e?.id !== 'string') return;
    if (seen.has(e.id)) {
      errors.push({ path: `entities[${i}].id`, message: `duplicates id "${e.id}" — entity ids must be unique` });
    }
    seen.add(e.id);
  });
  return errors;
}

// ---------------------------------------------------------------------------
// Gate 2: reference integrity — every sprite/entity-type/behavior/movement
// string a spec uses must exist in the corresponding capability registry.
//
// For entity types / behaviors / movement types, that registry check is
// against the ENTITY_TYPES/BEHAVIORS/MOVEMENT_TYPES arrays in spec/types.ts
// rather than against EntityRegistry/BehaviorRegistry/MovementRegistry
// directly. Those two things are provably the same set: each engine
// registry is typed as `Record<ClosedEnum, Impl>`, so the compiler already
// refuses to build if it implements anything other than exactly that enum
// (see the comments in EntityRegistry.ts et al). Going through types.ts
// instead of the engine registries also means validating a spec never has
// to import Phaser, which throws outside a browser/DOM — this stays a pure
// "JSON in, errors out" function usable from a CLI, a test runner, or a
// future LLM-facing validation service, none of which have a `window`.
//
// Sprites are the one case with no closed TS enum (sprite is just `string`,
// since the asset library is an open-ended set rather than a fixed union),
// so ASSET_KEYS in assets/assetKeys.ts is the actual, only registry for it —
// deliberately kept Phaser-free for the same reason.
function checkReferenceIntegrity(spec: Partial<GameSpec>): ValidationError[] {
  const errors: ValidationError[] = [];
  const assetKeys = new Set<string>(getRegisteredAssetKeys());
  const entityTypes = new Set<string>(ENTITY_TYPES);
  const behaviors = new Set<string>(BEHAVIORS);
  const movementTypes = new Set<string>(MOVEMENT_TYPES);

  const checkSprite = (path: string, sprite: unknown) => {
    if (typeof sprite === 'string' && !assetKeys.has(sprite)) {
      errors.push({ path, message: `references unknown asset "${sprite}". Registered assets: ${[...assetKeys].join(', ')}` });
    }
  };

  if (spec.movementType !== undefined && !movementTypes.has(spec.movementType)) {
    errors.push({
      path: 'movementType',
      message: `references unregistered movement controller "${spec.movementType}". Registered: ${[...movementTypes].join(', ')}`,
    });
  }

  if (spec.player?.sprite !== undefined) checkSprite('player.sprite', spec.player.sprite);
  if (spec.player?.attack?.projectileSprite !== undefined) {
    checkSprite('player.attack.projectileSprite', spec.player.attack.projectileSprite);
  }
  if (spec.world?.groundTile !== undefined) checkSprite('world.groundTile', spec.world.groundTile);

  // Shared by both the entities[] loop and spawners[].entityTemplate below —
  // a spawner's template needs exactly the same four reference-integrity
  // checks a placed entity gets, just at a different path prefix.
  const checkEntityLikeRefs = (base: string, e: { type?: string; sprite?: string; behavior?: string; behaviorParams?: EntitySpec['behaviorParams'] }) => {
    if (e.type !== undefined && !entityTypes.has(e.type)) {
      errors.push({
        path: `${base}.type`,
        message: `references unregistered entity type "${e.type}". Registered: ${[...entityTypes].join(', ')}`,
      });
    }
    if (e.sprite !== undefined) checkSprite(`${base}.sprite`, e.sprite);
    if (e.behavior !== undefined && !behaviors.has(e.behavior)) {
      errors.push({
        path: `${base}.behavior`,
        message: `references unregistered behavior "${e.behavior}". Registered: ${[...behaviors].join(', ')}`,
      });
    }
    const projectileSprite = e.behaviorParams?.projectileSprite;
    if (projectileSprite !== undefined) checkSprite(`${base}.behaviorParams.projectileSprite`, projectileSprite);
  };

  (spec.entities ?? []).forEach((e: EntitySpec, i: number) => checkEntityLikeRefs(`entities[${i}]`, e));

  (spec.spawners ?? []).forEach((s, i) => {
    if (s.entityTemplate) checkEntityLikeRefs(`spawners[${i}].entityTemplate`, s.entityTemplate);
  });

  return errors;
}

// ---------------------------------------------------------------------------
// Gate 3: gameplay invariants — the things that make a structurally valid
// spec actually playable and winnable.
// ---------------------------------------------------------------------------

function checkGameplayInvariants(spec: Partial<GameSpec>): ValidationError[] {
  const errors: ValidationError[] = [];
  const bounds = spec.world?.bounds;

  const checkInBounds = (pos: Vec2 | undefined, path: string) => {
    if (!pos || !bounds) return;
    if (pos.x < 0 || pos.y < 0 || pos.x > bounds.width || pos.y > bounds.height) {
      errors.push({
        path,
        message: `position (${pos.x}, ${pos.y}) is outside world bounds (${bounds.width}x${bounds.height})`,
      });
    }
  };

  if (!spec.player?.start) {
    errors.push({ path: 'player.start', message: 'a player start position is required' });
  } else {
    checkInBounds(spec.player.start, 'player.start');
  }

  // movementModifiers' conditional-required rules all live here in Gate 3,
  // not as ajv if/then in the schema — deliberately, not by default. They
  // started as if/then (the natural JSON Schema way to express "field X
  // required only when field Y has this value"), but OpenAI's Structured
  // Outputs strict mode rejects if/then outright ("'if' is not permitted"),
  // and outputSchema.ts derives the model-facing schema straight from this
  // same file — so if/then here doesn't just fail to help, it breaks every
  // real generation, not only ones touching movementModifiers. Confirmed
  // directly: adding it made every /generate call fail immediately with an
  // invalid_json_schema error from the API, regardless of prompt.
  const modifiers = spec.player?.movementModifiers;
  if (modifiers?.gravity?.enabled === true && modifiers.gravity.magnitude === undefined) {
    errors.push({
      path: 'player.movementModifiers.gravity.magnitude',
      message: 'is required when gravity.enabled is true',
    });
  }
  if (modifiers?.inputMode === 'impulse' && modifiers.impulseForce === undefined) {
    errors.push({
      path: 'player.movementModifiers.impulseForce',
      message: 'is required when inputMode is "impulse"',
    });
  }
  // gridSnap's cellSize-vs-bounds check needs Gate 3 regardless of the
  // if/then constraint above — it cross-references world.bounds, a
  // different top-level path entirely, which no same-object conditional
  // could express even if OpenAI allowed if/then at all.
  if (
    modifiers?.gridSnap &&
    bounds &&
    (bounds.width % modifiers.gridSnap.cellSize !== 0 || bounds.height % modifiers.gridSnap.cellSize !== 0)
  ) {
    errors.push({
      path: 'player.movementModifiers.gridSnap.cellSize',
      message: `must evenly divide world.bounds (${bounds.width}x${bounds.height}), or entities can snap to positions outside the grid at the world edge`,
    });
  }

  if (spec.player?.health !== undefined && spec.player.health <= 0) {
    errors.push({ path: 'player.health', message: 'must be greater than 0' });
  }
  if (spec.player?.speed !== undefined && spec.player.speed <= 0) {
    errors.push({ path: 'player.speed', message: 'must be greater than 0' });
  }

  let achievableScore = 0;
  let hasBoss = false;
  let hasEnemyOrBoss = false;
  let hasPickup = false;
  let hasWinTrigger = false;
  const bossIds = new Set<string>();
  const winTriggerIds = new Set<string>();
  const winTriggerYById = new Map<string, number>();

  (spec.entities ?? []).forEach((e: EntitySpec, i: number) => {
    const base = `entities[${i}]`;
    checkInBounds(e.position, `${base}.position`);

    if (e.health !== undefined && e.health < 0) {
      errors.push({ path: `${base}.health`, message: 'must not be negative' });
    } else if (e.health === 0 && (e.type === 'enemy' || e.type === 'boss')) {
      errors.push({ path: `${base}.health`, message: `${e.type} has 0 health and would be dead on spawn` });
    }
    if (e.damage !== undefined && e.damage < 0) {
      errors.push({ path: `${base}.damage`, message: 'must not be negative' });
    }
    if (e.scoreValue !== undefined && e.scoreValue < 0) {
      errors.push({ path: `${base}.scoreValue`, message: 'must not be negative' });
    }
    if (e.value !== undefined && e.value < 0) {
      errors.push({ path: `${base}.value`, message: 'must not be negative' });
    }

    if (e.type === 'boss') {
      hasBoss = true;
      bossIds.add(e.id);
    }
    if (e.type === 'enemy' || e.type === 'boss') {
      hasEnemyOrBoss = true;
      achievableScore += e.scoreValue ?? 0;
    }
    if (e.type === 'pickup') {
      hasPickup = true;
      achievableScore += (e.pickupType === 'coin' ? e.value ?? 0 : 0) + (e.scoreValue ?? 0);
    }
    if (e.type === 'trigger' && e.triggerType === 'win') {
      hasWinTrigger = true;
      winTriggerIds.add(e.id);
      if (e.position) winTriggerYById.set(e.id, e.position.y);
    }
  });

  (spec.spawners ?? []).forEach((s, i) => {
    const base = `spawners[${i}].entityTemplate`;
    const t = s.entityTemplate;
    if (!t) return;
    if (t.health !== undefined && t.health < 0) errors.push({ path: `${base}.health`, message: 'must not be negative' });
    if (t.damage !== undefined && t.damage < 0) errors.push({ path: `${base}.damage`, message: 'must not be negative' });
    if (t.scoreValue !== undefined && t.scoreValue < 0) errors.push({ path: `${base}.scoreValue`, message: 'must not be negative' });
  });

  // A spawner keeps creating fresh entities indefinitely, so pairing one
  // with a win condition whose whole premise is "eventually zero of these
  // exist" is likely unwinnable by construction — not merely unusual the
  // way, say, an atypical camera/movement pairing is, so this is a hard
  // Gate 3 rejection rather than left to prompt guidance. Scoped narrowly:
  // defeat_all_enemies is at risk from ANY spawner (entityTemplate is
  // always enemy/boss-typed); collect_all_pickups only from a spawner whose
  // pairedGap implicitly creates pickups (entityTemplate itself can never be
  // type "pickup" — see SpawnerEntityTemplate's own restriction).
  if (spec.spawners && spec.spawners.length > 0) {
    if (spec.winCondition?.type === 'defeat_all_enemies') {
      errors.push({
        path: 'winCondition',
        message:
          'type is "defeat_all_enemies" but spawners keep creating enemies indefinitely — that condition may never be reachable. Use survive_duration, score_threshold, or reach_trigger instead.',
      });
    }
    if (spec.winCondition?.type === 'collect_all_pickups' && spec.spawners.some((s) => s.pairedGap)) {
      errors.push({
        path: 'winCondition',
        message:
          'type is "collect_all_pickups" but a spawner\'s pairedGap keeps creating new pickups indefinitely — that condition may never be reachable. Use survive_duration, score_threshold, or reach_trigger instead.',
      });
    }
  }

  checkWinConditionReachable(
    spec.winCondition,
    {
      hasBoss,
      hasEnemyOrBoss,
      hasPickup,
      hasWinTrigger,
      bossIds,
      winTriggerIds,
      achievableScore,
      camera: spec.camera,
      playerStartY: spec.player?.start?.y,
      winTriggerYById,
    },
    errors,
  );

  return errors;
}

interface ReachabilityFacts {
  hasBoss: boolean;
  hasEnemyOrBoss: boolean;
  hasPickup: boolean;
  hasWinTrigger: boolean;
  bossIds: Set<string>;
  winTriggerIds: Set<string>;
  achievableScore: number;
  camera: CameraMode | undefined;
  playerStartY: number | undefined;
  winTriggerYById: Map<string, number>;
}

// Reachability here means "the entities needed to satisfy this condition
// exist in the spec at all" — there's no pathfinding in the runtime, so a
// win trigger sealed behind unreachable walls would still pass this check.
function checkWinConditionReachable(
  wc: WinConditionSpec | undefined,
  facts: ReachabilityFacts,
  errors: ValidationError[],
): void {
  if (!wc?.type) return;

  switch (wc.type) {
    case 'defeat_boss':
      if (!facts.hasBoss) {
        errors.push({ path: 'winCondition', message: 'type is "defeat_boss" but no entity of type "boss" exists' });
      } else if (wc.targetId && !facts.bossIds.has(wc.targetId)) {
        errors.push({ path: 'winCondition.targetId', message: `references "${wc.targetId}" but no boss with that id exists` });
      }
      break;
    case 'defeat_all_enemies':
      if (!facts.hasEnemyOrBoss) {
        errors.push({ path: 'winCondition', message: 'type is "defeat_all_enemies" but no enemy or boss entities exist' });
      }
      break;
    case 'collect_all_pickups':
      if (!facts.hasPickup) {
        errors.push({ path: 'winCondition', message: 'type is "collect_all_pickups" but no pickup entities exist' });
      }
      break;
    case 'reach_trigger':
      if (!facts.hasWinTrigger) {
        errors.push({
          path: 'winCondition',
          message: 'type is "reach_trigger" but no trigger entity with triggerType "win" exists',
        });
      } else if (wc.targetId && !facts.winTriggerIds.has(wc.targetId)) {
        errors.push({ path: 'winCondition.targetId', message: `references "${wc.targetId}" but no win trigger with that id exists` });
      } else if (facts.camera === 'auto_scroll_vertical' && facts.playerStartY !== undefined) {
        // The one case here that isn't "no pathfinding available" but a
        // closed-form geometric fact: this camera only ever scrolls toward
        // larger y at a fixed rate (src/camera/autoScrollVertical.ts), and
        // the paired shmup_freeaxis movement clamps the player to whatever
        // is currently on screen — so a win trigger placed at or above the
        // player's own start y can never be scrolled into view. With no
        // targetId, any one win trigger placed ahead is enough to win, so
        // only reject when every win trigger fails that test.
        const relevantIds = wc.targetId ? [wc.targetId] : [...facts.winTriggerIds];
        const reachable = relevantIds.some((id) => {
          const y = facts.winTriggerYById.get(id);
          return y !== undefined && y > facts.playerStartY!;
        });
        if (!reachable) {
          errors.push({
            path: 'winCondition',
            message:
              'camera is "auto_scroll_vertical", which only ever scrolls toward larger y — every win trigger must be positioned at a y greater than player.start.y, or the level can never be won',
          });
        }
      }
      break;
    case 'score_threshold':
      if (wc.threshold !== undefined && facts.achievableScore < wc.threshold) {
        errors.push({
          path: 'winCondition.threshold',
          message: `is ${wc.threshold} but the maximum achievable score from entities in this spec is ${facts.achievableScore} — the level cannot be won`,
        });
      }
      break;
    case 'survive_duration':
      if (wc.threshold === undefined || wc.threshold <= 0) {
        errors.push({
          path: 'winCondition.threshold',
          message: 'type is "survive_duration" but requires threshold to be a positive number of seconds — without it the level can never be won',
        });
      }
      break;
  }
}
