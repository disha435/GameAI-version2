import { getRegisteredAssetKeys } from '../src/assets/assetKeys';
import {
  AXIS_CONSTRAINTS,
  BEHAVIORS,
  CAMERA_MODES,
  ENTITY_TYPES,
  INPUT_MODES,
  MOVE_DIRECTIONS,
  MOVEMENT_TYPES,
  PICKUP_TYPES,
  SPAWN_EDGES,
  THEMES,
  TRIGGER_TYPES,
  WIN_CONDITION_TYPES,
  type CameraMode,
  type MovementType,
} from '../src/spec/types';
import type { ValidationError } from '../src/spec/validate';

// Every list below comes straight from the same Phaser-free sources
// validate.ts checks reference integrity against (spec/types.ts's closed
// enums, assets/assetKeys.ts's ASSET_KEYS) — never hand-copied, so the
// vocabulary the model is told about can't silently drift from what the
// validator actually accepts.
// Exported so the edit-patch prompt (server/edit/editPrompt.ts) can reuse
// the exact same derived vocabulary instead of hand-copying it — the same
// "no second copy to fall out of sync" discipline as everywhere else here.
export function buildVocabularyBlock(): string {
  return [
    `- movementType: ${MOVEMENT_TYPES.join(', ')}`,
    `- camera (optional, defaults to "follow_player" if omitted): ${CAMERA_MODES.join(', ')}`,
    `- theme (required — no default, you must always pick one): ${THEMES.join(', ')}`,
    `- entities[].type: ${ENTITY_TYPES.join(', ')} (the player is NOT one of these — configure it via the top-level "player" field instead)`,
    `- entities[].behavior (required for "enemy" and "boss" entities): ${BEHAVIORS.join(', ')}`,
    `- entities[].pickupType (only when type is "pickup"): ${PICKUP_TYPES.join(', ')}`,
    `- entities[].triggerType (only when type is "trigger"): ${TRIGGER_TYPES.join(', ')}`,
    `- winCondition.type: ${WIN_CONDITION_TYPES.join(', ')}`,
    `- player.movementModifiers.axisConstraint (optional): ${AXIS_CONSTRAINTS.join(', ')}`,
    `- player.movementModifiers.inputMode (optional, defaults to "continuous"): ${INPUT_MODES.join(', ')}`,
    `- spawners[].entityTemplate.type (optional array, top-level "spawners"): enemy, boss only — never pickup/npc/trigger`,
    `- spawners[].spawnEdge: ${SPAWN_EDGES.join(', ')}`,
    `- spawners[].moveDirection: ${MOVE_DIRECTIONS.join(', ')}`,
    `- every sprite / groundTile / projectileSprite value must be exactly one of: ${getRegisteredAssetKeys().join(', ')} (note: for the player and for "enemy"/"boss"/"pickup" entities, the runtime automatically re-skins the sprite to match your chosen theme regardless of what you put here — pick any valid value, it won't be wasted effort, but it also won't override theme)`,
  ].join('\n');
}

// Movement types with a strongly-typical camera/world pairing. Kept as a
// compile-checked Record<MovementType, CameraMode> (same enforcement shape
// as movement/MovementRegistry.ts et al) rather than hand-typed into the
// guidance sentence below — if either enum literal referenced here is ever
// renamed, this fails to typecheck instead of silently going stale the way
// the old "no dedicated space genre" prompt line did.
const CAMERA_AFFINITY: Partial<Record<MovementType, CameraMode>> = {
  shmup_freeaxis: 'auto_scroll_vertical',
};

// Bidirectional on purpose: a model can lock onto either half of the pairing
// first depending on how the prompt is phrased (a movement-flavored request
// vs. a scrolling/vertical-flavored one), so the guidance has to be pickable
// up from either direction rather than assuming movementType is decided
// before camera.
function buildCameraAffinityGuidance(): string {
  return Object.entries(CAMERA_AFFINITY)
    .map(
      ([movement, camera]) =>
        `if movementType is "${movement}", camera should typically be "${camera}" with world.bounds.height much larger than width — and conversely, if the request implies vertical/scrolling gameplay, prefer "${movement}" + "${camera}" together.`,
    )
    .join('\n');
}

// Theme's own correlation guidance, added proactively rather than after
// discovering (the way camera's was) that it's needed — theme is a
// required field, so the "gets silently skipped" failure mode camera had
// structurally can't happen here, but *which* value gets picked still
// benefits from the same kind of explicit steer. Necessarily hand-typed
// prose (unlike CAMERA_AFFINITY's compile-checked mapping): "keywords that
// imply a setting" isn't a closed enum anything can iterate, the same
// reason the win-condition reachability rules below are hand-written too.
const THEME_GUIDANCE = `
theme should reflect the setting implied by the request, not be picked arbitrarily:
- "space" for space/sci-fi settings — ships, asteroids, stars, galaxies, aliens, lasers.
- "dungeon" for forest/dungeon/fantasy settings — wizards, crystals, dragons, monsters, medieval or magical settings.
- If genuinely ambiguous (the request gives no setting cues either way), default to "dungeon".
`.trim();

// player.movementModifiers layers orthogonal parameters on top of whatever
// movementType you already picked — it lets a handful of genuinely distinct
// game feels (tap-to-flap games, axis-locked dodging games) be expressed as
// compositions of existing pieces instead of needing a new movementType each
// time. Added proactively — same "don't wait for a live-prompt gap to prove
// it's needed" reasoning as theme's guidance — because these two request
// shapes (a classic tap-to-fly game, a classic dodge-along-one-axis game)
// are common enough to be worth naming explicitly rather than leaving the
// model to rediscover the composition from the vocabulary block alone.
// Necessarily hand-typed prose, like THEME_GUIDANCE: "which real request
// shapes call for which composition" isn't itself a closed enum.
const MOVEMENT_MODIFIERS_GUIDANCE = `
player.movementModifiers composes with any movementType — it's how to build a few classic, specific game feels without a dedicated movementType for each:
- A tap-to-fly / flap game (e.g. "Flappy Bird"): use movementType "shmup_freeaxis" with movementModifiers.gravity = {"enabled": true, "magnitude": <e.g. 700-900>}, movementModifiers.inputMode = "impulse" with an movementModifiers.impulseForce (e.g. 350-450), and movementModifiers.axisConstraint = "vertical" (the player never moves left/right; only up via the impulse and down via gravity). Pair this with a "spawners" entry using pairedGap for the incoming pipes — see the spawners guidance below — and camera "follow_player" (the player's own x never changes, so there's nothing for the camera to scroll horizontally; the pipes provide all the forward-motion feel by moving toward the player instead).
- A game about dodging things along one axis (e.g. "dodge the falling rocks by moving left and right"): use movementModifiers.axisConstraint = "horizontal" (or "vertical" for a horizontally-scrolling equivalent) so the player can't drift off the axis the hazards actually threaten, together with a "spawners" entry (no pairedGap needed) for the falling hazards themselves.
- Leave movementModifiers out entirely for every other, more ordinary request — it exists for these specific classic-game-feel cases, not as a default extra step.
- IMPORTANT exception to the general world.bounds rule below: whenever axisConstraint locks an axis AND camera is "follow_player", keep world.bounds equal to meta's matching dimension on that locked axis specifically (e.g. axisConstraint "vertical" -> world.bounds.width should equal meta.width, not be larger). The player's position on a locked axis never changes, so the camera never scrolls along it — anything spawned further out on that axis (a wider world than viewport) stays completely off-screen, invisible, for most or all of its travel before it ever becomes reachable. This overrides "world.bounds should be meaningfully larger than the viewport" for that one axis only; the OTHER axis (the one still under player control, or the one a spawner's pairedGap spans) can and should still be larger/generous as usual.
`.trim();

// spawners' own guidance, same proactive reasoning as movement modifiers'
// above: added before ever seeing a live prompt need it, because "things
// periodically enter from an edge and move across the screen" is common
// enough (falling hazards, incoming obstacles, Flappy Bird's pipes) to name
// explicitly. Hand-typed prose for the same reason as everywhere else here:
// which request shapes call for a spawner, and which for pairedGap
// specifically, isn't itself expressible as a closed enum.
const SPAWNER_GUIDANCE = `
Top-level "spawners" (optional array) is how entities appear DURING gameplay instead of only at the start — for hazards/obstacles that keep coming, not for anything that should just be placed once (use "entities" for that, as always):
- Each spawner needs: id, entityTemplate ({type: "enemy" or "boss", sprite, and optionally behavior/behaviorParams/health/damage/scoreValue/size}), interval (seconds between spawns), spawnEdge, moveDirection, and moveSpeed. Give entityTemplate.behavior "fall_and_despawn" so it actually moves — moveDirection/moveSpeed come from the spawner itself, not behaviorParams, and apply automatically to whatever it spawns.
- Plain spawner (no pairedGap): one entity appears at spawnEdge and travels in moveDirection until it's off-bounds, then disappears. This is "meteors fall from the top," "obstacles come from the right," etc. — moveDirection should normally point INTO the world from spawnEdge (spawnEdge "top" + moveDirection "down", spawnEdge "right" + moveDirection "left", and so on).
- pairedGap (optional, on a spawner): each spawn creates TWO entities from entityTemplate instead of one — spanning the full opposite side of spawnEdge with a randomized gap between them (gapSize, gapPositionRange: {min, max} bounded within world.bounds). This is Flappy Bird's pipes: spawnEdge "right" + moveDirection "left" + pairedGap. Set pairedGap.gapScoreValue to also place a collectible coin in the gap's center as a reward for passing through — no separate pickup entity or scoring logic needed.
- Never pair a spawner with winCondition "defeat_all_enemies" (spawners keep creating enemies, so it may never be reachable) — use survive_duration, score_threshold, or reach_trigger instead. Same for "collect_all_pickups" if any spawner uses pairedGap with a gapScoreValue.
`.trim();

// Unlike the vocabulary above, this per-behavior field guide isn't enum data
// the validator checks — behaviorParams is an intentionally loose bag (see
// spec/types.ts) — so it's hand-maintained prose, kept next to the behavior
// name list so it's easy to notice if a behavior gets added without updating
// this too.
export const BEHAVIOR_FIELD_GUIDE = `
Field guide for behaviorParams by behavior (all fields optional; the runtime applies sensible defaults for anything omitted):
- patrol: patrolPoints (array of {x,y} waypoints — required for the enemy to actually move, it otherwise stands still), speed
- chase: speed, detectRadius, loseRadius
- flee: fleeSpeed (falls back to speed if omitted), detectRadius
- stationary: (no params)
- flying_sine: patrolPoints (exactly 2 points define the horizontal sweep range it flies between), speed, amplitude, frequency
- shooter: range, fireRate (milliseconds between shots), projectileSpeed, damage, projectileSprite
- melee: speed, detectRadius, range (distance at which it stops closing in and can land a hit)
`.trim();

function buildSystemPrompt(): string {
  return `
You generate a single GameSpec JSON object for a 2D game runtime. The runtime only understands a fixed, closed vocabulary — do not invent values outside these lists, they will be rejected:

${buildVocabularyBlock()}

${THEME_GUIDANCE}

${MOVEMENT_MODIFIERS_GUIDANCE}

${SPAWNER_GUIDANCE}

${BEHAVIOR_FIELD_GUIDE}

Rules the runtime enforces (violating these gets your output rejected and sent back to you to fix, so get them right the first time):
- world.bounds should be meaningfully larger than meta.width/meta.height so the camera has room to follow the player around a level bigger than the viewport (e.g. bounds 2-4x the viewport size in each dimension).
- player.start and every entities[].position must fall within [0, world.bounds.width] x [0, world.bounds.height].
- player.health and player.speed must be greater than 0.
- player.jumpVelocity (movementType "platformer_run_jump" only), if set, must be a positive number — it's always a magnitude, the runtime applies it upward automatically. Omit it to use the runtime's own default.
- player.movementModifiers.gravity, if included, requires "enabled"; when enabled is true it also requires a positive "magnitude". player.movementModifiers.inputMode "impulse" requires a positive "impulseForce". player.movementModifiers.gridSnap.cellSize, if set, must evenly divide both world.bounds.width and world.bounds.height.
- No entity's health, damage, scoreValue, or value may be negative, and an "enemy" or "boss" must have health strictly greater than 0.
- Every "enemy" and "boss" entity must have a behavior.
- winCondition must be reachable given the entities you create:
  - "defeat_boss" requires at least one entity of type "boss" (and if you set winCondition.targetId, it must equal that boss's id).
  - "defeat_all_enemies" requires at least one "enemy" or "boss" entity.
  - "collect_all_pickups" requires at least one "pickup" entity.
  - "reach_trigger" requires a "trigger" entity with triggerType "win" (and if you set winCondition.targetId, it must equal that trigger's id). If camera is "auto_scroll_vertical", that camera only ever scrolls toward larger y at a fixed rate and the player can never move outside the current view — so the win trigger's position.y must be greater than player.start.y, or it can never be scrolled into reach.
  - "score_threshold" requires the threshold to be no greater than the total score obtainable from all coin-type pickups' value plus every enemy/boss's scoreValue.
  - "survive_duration" requires threshold to be set to a positive number of seconds the player must stay alive.
- If any "spawners" entry exists: winCondition cannot be "defeat_all_enemies" (spawners keep creating more), and cannot be "collect_all_pickups" if any spawner uses pairedGap with a gapScoreValue (same reason).
- Every entity id must be a unique string.

Design guidance (not enforced by the runtime, but makes for a better game): interpret the user's request creatively using only the vocabulary above rather than refusing when it doesn't map exactly onto a supported genre or behavior. Build a level with a handful of enemies using varied behaviors, a few pickups, and a title/ids that reflect what the user described. Make sure the level is actually winnable by a player who only has movement plus one attack. ${buildCameraAffinityGuidance()}

Respond with only the GameSpec JSON object — no prose, no markdown code fences, no explanation before or after it.
`.trim();
}

export const SYSTEM_PROMPT = buildSystemPrompt();

export function formatValidationFeedback(errors: ValidationError[]): string {
  const lines = errors.map((e) => `- ${e.path}: ${e.message}`);
  return `Your previous output failed validation:\n${lines.join('\n')}\n\nFix these specific problems and resubmit the complete GameSpec JSON object (the full spec, not just the changed fields).`;
}
