import type { Enemy } from '../entities/Enemy';
import type { MoveDirection } from '../spec/types';
import type { BehaviorContext } from './BehaviorContext';

const DEFAULT_SPEED = 100;
const DEFAULT_DIRECTION: MoveDirection = 'down';

// Exported so SpawnerSystem can apply the same direction→vector mapping to
// a paired-gap pickup, which moves via a one-time velocity set rather than
// a per-frame behavior tick (pickups aren't behavior-driven — see
// SpawnerSystem.ts's own comment).
export const DIRECTION_VECTORS: Record<MoveDirection, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

// Constant-velocity mover with no steering/AI at all — the "falling hazard"
// / "incoming obstacle" primitive. Deliberately does NOT destroy itself when
// off-bounds — every existing behavior only ever sets velocity, never
// removes an entity from its group (that's always a System's job: see
// HealthSystem's dead/dying sweep, CollisionSystem's pickup-collection
// path). SpawnerSystem's own per-frame sweep owns despawning anything it
// created, the same split.
export function fallAndDespawn(entity: Enemy, _ctx: BehaviorContext, _delta: number): void {
  const direction = (entity.behaviorParams.direction as MoveDirection | undefined) ?? DEFAULT_DIRECTION;
  const speed = entity.behaviorParams.speed ?? DEFAULT_SPEED;
  const vec = DIRECTION_VECTORS[direction] ?? DIRECTION_VECTORS[DEFAULT_DIRECTION];
  entity.setVelocity(vec.x * speed, vec.y * speed);
}
