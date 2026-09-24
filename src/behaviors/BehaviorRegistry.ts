import type { Enemy } from '../entities/Enemy';
import type { BehaviorName } from '../spec/types';
import type { BehaviorContext } from './BehaviorContext';
import { chase } from './chase';
import { fallAndDespawn } from './fallAndDespawn';
import { flee } from './flee';
import { flyingSine } from './flyingSine';
import { melee } from './melee';
import { patrol } from './patrol';
import { shooter } from './shooter';
import { stationary } from './stationary';

export type BehaviorFn = (entity: Enemy, ctx: BehaviorContext, delta: number) => void;

// Record<BehaviorName, BehaviorFn> forces this map to implement exactly the
// closed BEHAVIORS union from spec/types.ts at compile time, so
// validate.ts's reference-integrity gate checks against that Phaser-free
// array instead of importing this module (see EntityRegistry.ts for the
// full rationale — same pattern, applied here too).
const REGISTRY: Record<BehaviorName, BehaviorFn> = {
  patrol,
  chase,
  flee,
  stationary,
  flying_sine: flyingSine,
  shooter,
  melee,
  fall_and_despawn: fallAndDespawn,
};

export function runBehavior(name: BehaviorName, entity: Enemy, ctx: BehaviorContext, delta: number): void {
  const fn = REGISTRY[name];
  if (!fn) {
    throw new Error(`Unknown behavior "${name}". Known behaviors: ${Object.keys(REGISTRY).join(', ')}`);
  }
  fn(entity, ctx, delta);
}
