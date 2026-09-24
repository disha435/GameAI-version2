import type { BehaviorName, EntitySpec, GameSpec } from '../../src/spec/types';
import type { EditPatchOp } from './jsonPatch';

// The effective speed a behavior uses when behaviorParams.speed is omitted
// — mirrors each behavior module's own DEFAULT_SPEED constant (src/behaviors/
// {patrol,chase,flee,melee,flyingSine}.ts). Kept here, not imported, since
// those modules import Phaser (via Enemy/BehaviorContext types) and this
// file has to stay usable from a plain Node test/server context. shooter
// and stationary are absent on purpose — neither one moves, so "make
// enemies faster" has nothing to change on them.
const BEHAVIOR_DEFAULT_SPEED: Partial<Record<BehaviorName, number>> = {
  patrol: 60,
  chase: 90,
  flee: 100,
  melee: 110,
  flying_sine: 70,
};

// Every "set a field that might not already exist" op below uses 'add', not
// 'replace' — RFC 6902 replace requires the target to already exist, and
// most of the fields these intents touch (entities[].health,
// behaviorParams.speed, ...) are optional in GameSpec and often absent,
// relying on a runtime default instead. 'add' on an existing object member
// overwrites it, so it's a safe upsert either way.
function setBehaviorParam(entityIndex: number, entity: EntitySpec, key: 'speed' | 'fleeSpeed', value: number): EditPatchOp {
  const rounded = Math.round(value * 100) / 100;
  if (entity.behaviorParams) {
    return { op: 'add', path: `/entities/${entityIndex}/behaviorParams/${key}`, value: rounded };
  }
  return { op: 'add', path: `/entities/${entityIndex}/behaviorParams`, value: { [key]: rounded } };
}

function speedMultiplierOps(spec: GameSpec, multiplier: number): EditPatchOp[] {
  const ops: EditPatchOp[] = [];
  spec.entities.forEach((entity, i) => {
    if (entity.type !== 'enemy' || !entity.behavior) return;
    const defaultSpeed = BEHAVIOR_DEFAULT_SPEED[entity.behavior];
    if (defaultSpeed === undefined) return;
    ops.push(setBehaviorParam(i, entity, 'speed', (entity.behaviorParams?.speed ?? defaultSpeed) * multiplier));
    if (entity.behavior === 'flee' && entity.behaviorParams?.fleeSpeed !== undefined) {
      ops.push(setBehaviorParam(i, entity, 'fleeSpeed', entity.behaviorParams.fleeSpeed * multiplier));
    }
  });
  return ops;
}

function bossHealthOps(spec: GameSpec, multiplier: number): EditPatchOp[] {
  const idx = spec.entities.findIndex((e) => e.type === 'boss');
  if (idx === -1) return []; // no boss to modify — matchIntent treats an empty patch as a miss
  const current = spec.entities[idx].health ?? 1;
  const value = Math.max(1, Math.round(current * multiplier));
  return [{ op: 'add', path: `/entities/${idx}/health`, value }];
}

function wrapCoord(value: number, bound: number): number {
  if (bound <= 0) return 0;
  const wrapped = value % bound;
  return wrapped < 0 ? wrapped + bound : wrapped;
}

const DEFAULT_ENEMY_TEMPLATE: EntitySpec = {
  id: 'template',
  type: 'enemy',
  sprite: 'enemy_patrol',
  position: { x: 0, y: 0 },
  behavior: 'patrol',
  behaviorParams: { speed: 60 },
  health: 2,
  damage: 1,
  scoreValue: 10,
};

const DEFAULT_PICKUP_TEMPLATE: EntitySpec = {
  id: 'template',
  type: 'pickup',
  sprite: 'pickup_coin',
  position: { x: 0, y: 0 },
  pickupType: 'coin',
  value: 5,
};

// Clones an existing entity of `type` (or a generic default template if
// none exists yet) `count` times, appended via RFC 6902's "-" end-of-array
// token — applying several `{op: 'add', path: '/entities/-', ...}` ops in
// one patch, in order, is standard: each one appends after whatever the
// previous op just added. structuredClone before spreading so each new
// entity gets its own independent behaviorParams/position objects, never
// sharing a reference with the template (or with each other).
function cloneEntitiesOps(spec: GameSpec, type: 'enemy' | 'pickup', count: number): EditPatchOp[] {
  const template = spec.entities.find((e) => e.type === type) ?? (type === 'enemy' ? DEFAULT_ENEMY_TEMPLATE : DEFAULT_PICKUP_TEMPLATE);
  const ops: EditPatchOp[] = [];
  for (let i = 0; i < count; i++) {
    const clone = structuredClone(template);
    clone.id = `edit_${type}_${Date.now()}_${i}`;
    clone.position = {
      x: wrapCoord(template.position.x + 40 * (i + 1), spec.world.bounds.width),
      y: wrapCoord(template.position.y + 40 * (i + 1), spec.world.bounds.height),
    };
    ops.push({ op: 'add', path: '/entities/-', value: clone });
  }
  return ops;
}

function surviveDurationOps(seconds: number): EditPatchOp[] {
  return [{ op: 'add', path: '/winCondition', value: { type: 'survive_duration', threshold: seconds } }];
}

interface IntentMatch {
  name: string;
  pattern: RegExp;
  buildPatch: (spec: GameSpec, match: RegExpMatchArray) => EditPatchOp[];
}

const FASTER_WORDS = new Set(['faster', 'quicker']);

// Ordered list, first match wins. Deliberately small — 6-10 intents
// covering the most common phrasings is the point; everything else falls
// through to the LLM patch path by design, not as a gap to keep filling.
const INTENTS: IntentMatch[] = [
  {
    name: 'enemy_speed_multiplier',
    pattern: /make (the )?enem(y|ies) (faster|slower|quicker)/i,
    buildPatch: (spec, match) => speedMultiplierOps(spec, FASTER_WORDS.has(match[3].toLowerCase()) ? 1.6 : 0.6),
  },
  {
    name: 'boss_health_change',
    pattern: /make (the )?boss (weaker|stronger|tougher)/i,
    buildPatch: (spec, match) => bossHealthOps(spec, match[2].toLowerCase() === 'weaker' ? 0.5 : 1.5),
  },
  {
    name: 'player_speed_change',
    pattern: /make (the )?player (faster|slower|quicker)/i,
    buildPatch: (spec, match) => [
      { op: 'add', path: '/player/speed', value: Math.max(1, Math.round(spec.player.speed * (FASTER_WORDS.has(match[2].toLowerCase()) ? 1.5 : 0.65))) },
    ],
  },
  {
    name: 'player_health_change',
    pattern: /(?:give (?:the )?player (more|less) health|make (?:the )?player (tougher|weaker))/i,
    buildPatch: (spec, match) => {
      const weaker = match[1] === 'less' || match[2] === 'weaker';
      return [{ op: 'add', path: '/player/health', value: Math.max(1, Math.round(spec.player.health * (weaker ? 0.6 : 1.5))) }];
    },
  },
  {
    name: 'add_enemy_count',
    pattern: /add (\d+|a|some) (more )?enem(y|ies)/i,
    buildPatch: (spec, match) => cloneEntitiesOps(spec, 'enemy', /^\d+$/.test(match[1]) ? parseInt(match[1], 10) : 3),
  },
  {
    name: 'add_pickup_count',
    pattern: /add (\d+|a|some) (more )?(pickups?|coins?|crystals?)/i,
    buildPatch: (spec, match) => cloneEntitiesOps(spec, 'pickup', /^\d+$/.test(match[1]) ? parseInt(match[1], 10) : 3),
  },
  {
    name: 'survive_duration_change',
    pattern: /surviv\w*\s*(?:for\s*)?(\d+)\s*(second|sec|minute|min)/i,
    buildPatch: (_spec, match) => {
      const amount = parseInt(match[1], 10);
      const seconds = match[2].toLowerCase().startsWith('min') ? amount * 60 : amount;
      return surviveDurationOps(seconds);
    },
  },
];

// Returns null (never an empty array) when nothing matches or the matched
// intent had nothing to act on (e.g. "make the boss weaker" with no boss in
// the spec) — either way the caller falls through to the LLM patch path.
export function matchIntent(instruction: string, spec: GameSpec): { name: string; patch: EditPatchOp[] } | null {
  for (const intent of INTENTS) {
    const match = instruction.match(intent.pattern);
    if (!match) continue;
    const patch = intent.buildPatch(spec, match);
    if (patch.length > 0) return { name: intent.name, patch };
  }
  return null;
}
