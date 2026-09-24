import type { Enemy } from '../entities/Enemy';
import type { BehaviorContext } from './BehaviorContext';

const DEFAULT_SPEED = 70;
const DEFAULT_AMPLITUDE = 40;
const DEFAULT_FREQUENCY = 2; // radians per second

interface FlyingState {
  spawnY: number;
  elapsedMs: number;
  direction: 1 | -1;
  minX: number;
  maxX: number;
}

// Flies back and forth horizontally between minX/maxX (derived from
// patrolPoints[0]/[1].x if given, else a fixed sweep around the spawn point)
// while bobbing vertically on a sine wave around its spawn height.
export function flyingSine(entity: Enemy, _ctx: BehaviorContext, delta: number): void {
  const state = entity.behaviorState as Partial<FlyingState>;
  if (state.spawnY === undefined) {
    state.spawnY = entity.y;
    state.elapsedMs = 0;
    state.direction = 1;
    const points = entity.behaviorParams.patrolPoints;
    if (points && points.length >= 2) {
      state.minX = Math.min(points[0].x, points[1].x);
      state.maxX = Math.max(points[0].x, points[1].x);
    } else {
      state.minX = entity.x - 150;
      state.maxX = entity.x + 150;
    }
  }

  const speed = entity.behaviorParams.speed ?? DEFAULT_SPEED;
  const amplitude = entity.behaviorParams.amplitude ?? DEFAULT_AMPLITUDE;
  const frequency = entity.behaviorParams.frequency ?? DEFAULT_FREQUENCY;

  state.elapsedMs = (state.elapsedMs ?? 0) + delta;

  if (entity.x <= state.minX!) state.direction = 1;
  else if (entity.x >= state.maxX!) state.direction = -1;

  const vx = (state.direction ?? 1) * speed;
  const targetY = state.spawnY! + Math.sin((state.elapsedMs / 1000) * frequency) * amplitude;
  const vy = (targetY - entity.y) * 6;

  entity.setVelocity(vx, vy);
}
