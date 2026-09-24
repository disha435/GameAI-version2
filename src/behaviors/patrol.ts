import Phaser from 'phaser';
import type { Enemy } from '../entities/Enemy';
import type { BehaviorContext } from './BehaviorContext';

const DEFAULT_SPEED = 60;
const ARRIVE_THRESHOLD = 4;

interface PatrolState {
  targetIndex: number;
}

// Walks a closed loop through behaviorParams.patrolPoints. With no points
// given, falls back to holding position (equivalent to `stationary`) rather
// than throwing, so a spec author forgetting patrolPoints degrades gracefully.
export function patrol(entity: Enemy, _ctx: BehaviorContext, _delta: number): void {
  const points = entity.behaviorParams.patrolPoints;
  if (!points || points.length === 0) {
    entity.setVelocity(0, 0);
    return;
  }

  const state = entity.behaviorState as Partial<PatrolState>;
  if (state.targetIndex === undefined) state.targetIndex = 0;

  const speed = entity.behaviorParams.speed ?? DEFAULT_SPEED;
  const target = points[state.targetIndex];
  const dist = Phaser.Math.Distance.Between(entity.x, entity.y, target.x, target.y);

  if (dist < ARRIVE_THRESHOLD) {
    state.targetIndex = (state.targetIndex + 1) % points.length;
  }

  const angle = Phaser.Math.Angle.Between(entity.x, entity.y, target.x, target.y);
  entity.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
}
