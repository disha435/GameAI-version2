// The GameSpec is the single source of truth the runtime interprets.
// Every enum here is closed on purpose: the interpreter (and later, the LLM
// that authors specs) is only ever allowed to pick from a known-good set of
// behaviors/movement types/entity kinds. Never widen these to freeform strings.

export type Vec2 = { x: number; y: number };

// 'projectile' is deliberately excluded: projectiles are only ever spawned
// at runtime by shooter behaviors and the player's ranged attack, never
// placed directly in a spec. See EntityRegistry.getRegisteredEntityTypes,
// which is the actual reference-integrity source of truth for this enum.
export const ENTITY_TYPES = ['enemy', 'pickup', 'boss', 'npc', 'trigger'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const BEHAVIORS = [
  'patrol',
  'chase',
  'flee',
  'stationary',
  'flying_sine',
  'shooter',
  'melee',
  'fall_and_despawn',
] as const;
export type BehaviorName = (typeof BEHAVIORS)[number];

export const MOVEMENT_TYPES = ['topdown_8dir', 'platformer_run_jump', 'shmup_freeaxis'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const CAMERA_MODES = ['follow_player', 'auto_scroll_vertical'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

// Required, not optional-with-a-default like `camera` — theme is more
// visually consequential than camera turned out to be, and the camera
// slice's own lesson was that an optional field with a default is exactly
// what a model quietly stops reasoning about. See src/assets/ThemeRegistry.ts
// for what each value actually resolves to.
export const THEMES = ['dungeon', 'space'] as const;
export type Theme = (typeof THEMES)[number];

export const PICKUP_TYPES = ['coin', 'health', 'item', 'key'] as const;
export type PickupType = (typeof PICKUP_TYPES)[number];

export const TRIGGER_TYPES = ['win', 'checkpoint', 'message', 'lose'] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const WIN_CONDITION_TYPES = [
  'defeat_boss',
  'defeat_all_enemies',
  'collect_all_pickups',
  'reach_trigger',
  'score_threshold',
  'survive_duration',
] as const;
export type WinConditionType = (typeof WIN_CONDITION_TYPES)[number];

export const MOVE_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
export type MoveDirection = (typeof MOVE_DIRECTIONS)[number];

// Behavior params are intentionally a loose bag — each behavior module reads
// the fields it needs and applies its own defaults for anything missing.
// See src/behaviors/*.ts for the fields each behavior actually consumes.
export interface BehaviorParams {
  patrolPoints?: Vec2[];
  speed?: number;
  detectRadius?: number;
  loseRadius?: number;
  amplitude?: number;
  frequency?: number;
  fireRate?: number; // ms between shots
  projectileSpeed?: number;
  projectileSprite?: string;
  damage?: number;
  range?: number;
  fleeSpeed?: number;
  direction?: MoveDirection; // fall_and_despawn only
  [key: string]: unknown;
}

export interface EntitySpec {
  id: string;
  type: EntityType;
  sprite: string;
  position: Vec2;
  behavior?: BehaviorName;
  behaviorParams?: BehaviorParams;
  health?: number;
  damage?: number;
  scoreValue?: number;
  // pickup-specific
  pickupType?: PickupType;
  value?: number;
  // trigger-specific
  triggerType?: TriggerType;
  // Was trigger-only originally (stretches the sprite to fill an arbitrary
  // box); BaseEntity now applies it to any entity type — a spawner-created
  // hazard is the other real user, stretching a small sprite into a tall
  // pipe-segment shape. See BaseEntity.ts.
  size?: { width: number; height: number };
  message?: string;
}

export interface PlayerAttackSpec {
  type: 'melee' | 'ranged' | 'none';
  damage: number;
  range: number;
  cooldown: number;
  projectileSpeed?: number;
  projectileSprite?: string;
}

// Orthogonal knobs any movementType can carry, layered on top of it rather
// than replacing it — see src/movement/movementModifiers.ts, applied once
// per frame after the base MovementController runs. This is deliberately
// additive: every field is optional and the object itself is optional, so
// every spec written before this existed keeps validating and playing
// identically with movementModifiers entirely absent.
export const AXIS_CONSTRAINTS = ['none', 'horizontal', 'vertical'] as const;
export type AxisConstraint = (typeof AXIS_CONSTRAINTS)[number];

export const INPUT_MODES = ['continuous', 'impulse'] as const;
export type InputMode = (typeof INPUT_MODES)[number];

export interface GravityModifier {
  enabled: boolean;
  magnitude?: number; // required when enabled is true — see gamespec.schema.json's if/then
}

export interface GridSnapModifier {
  cellSize: number;
}

export interface MovementModifiers {
  // The axis that stays under player control; the other is forced to 0 every
  // frame (or, when gravity owns the vertical axis — see below — left to
  // gravity/impulse instead of being zeroed).
  axisConstraint?: AxisConstraint;
  gravity?: GravityModifier;
  inputMode?: InputMode;
  impulseForce?: number; // required when inputMode is 'impulse'
  // Continuous-position rounding only in this slice — true discrete
  // step-by-one-cell movement (and the growing/self-colliding body Snake
  // actually needs) is deliberately deferred to a later slice, not attempted
  // here. See README's "Not in this slice" notes.
  gridSnap?: GridSnapModifier;
}

export interface PlayerSpec {
  start: Vec2;
  sprite: string;
  health: number;
  speed: number;
  jumpVelocity?: number; // platformer only
  attack?: PlayerAttackSpec;
  movementModifiers?: MovementModifiers;
}

// Generic "entities periodically appear from a world edge, move in a fixed
// direction, and despawn off-bounds" primitive — src/systems/SpawnerSystem.ts.
// Exists so requests needing this shape (falling hazards, incoming
// obstacles, meteor showers) compose from one reusable mechanism instead of
// each becoming its own bespoke system, the same "parameters over named
// modes" lesson movementModifiers already applied to movement.
export const SPAWN_EDGES = ['top', 'bottom', 'left', 'right'] as const;
export type SpawnEdge = (typeof SPAWN_EDGES)[number];

// Restricted to enemy/boss on purpose, not the full EntityType union: those
// are the only two types SceneInterpreter's per-frame loop actually runs
// behaviors on and adds to a group CollisionSystem already wires player
// collision against — see SpawnerSystem.ts's own comment for the full
// reasoning. A spawned hazard is functionally just a runtime-created enemy.
export interface SpawnerEntityTemplate {
  type: 'enemy' | 'boss';
  sprite: string;
  behavior?: BehaviorName;
  behaviorParams?: BehaviorParams;
  health?: number;
  damage?: number;
  scoreValue?: number;
  size?: { width: number; height: number };
}

// Optional: when present, each spawn creates TWO entities from the same
// template — one above a randomized gap, one below it — instead of one, the
// same generic primitive expressing Flappy Bird's pipes as a variant rather
// than a separate concept. gapScoreValue, when set, also places a coin
// pickup at the gap's center (reusing ordinary pickup collection for
// "reward for passing through" — no new scoring mechanism needed).
export interface PairedGapSpec {
  gapSize: number;
  gapPositionRange: { min: number; max: number };
  gapScoreValue?: number;
}

export interface SpawnerSpec {
  id: string;
  entityTemplate: SpawnerEntityTemplate;
  interval: number; // seconds between spawns
  spawnEdge: SpawnEdge;
  moveDirection: MoveDirection;
  moveSpeed: number;
  pairedGap?: PairedGapSpec;
}

export interface WallSpec {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorldSpec {
  tileSize: number;
  backgroundColor: string; // hex string e.g. "#1d1d2b"
  bounds: { width: number; height: number };
  groundTile?: string; // asset key tiled across bounds
  walls?: WallSpec[];
}

export interface WinConditionSpec {
  type: WinConditionType;
  targetId?: string; // for reach_trigger / defeat_boss (specific boss id)
  threshold?: number; // for score_threshold (score) or survive_duration (seconds)
}

export interface HudSpec {
  showHealth?: boolean;
  showScore?: boolean;
  showInventory?: boolean;
  showTimer?: boolean; // survive_duration progress readout
}

export interface GameSpecMeta {
  title: string;
  width: number;
  height: number;
}

export interface GameSpec {
  meta: GameSpecMeta;
  movementType: MovementType;
  camera?: CameraMode; // defaults to 'follow_player' when omitted
  theme: Theme; // required — governs entity/tileset sprite resolution, see ThemeRegistry
  world: WorldSpec;
  player: PlayerSpec;
  entities: EntitySpec[];
  spawners?: SpawnerSpec[];
  winCondition: WinConditionSpec;
  hud?: HudSpec;
}
