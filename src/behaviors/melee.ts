import Phaser from 'phaser';
import type { Enemy } from '../entities/Enemy';
import type { BehaviorContext } from './BehaviorContext';

const DEFAULT_SPEED = 110;
const DEFAULT_DETECT_RADIUS = 200;
const DEFAULT_RANGE = 28;

// Chases into contact range and stops; the actual damage-on-touch is
// applied generically by CollisionSystem for any entity with damage > 0
// overlapping the player, so melee's only job here is closing the distance.
export function melee(entity: Enemy, ctx: BehaviorContext, _delta: number): void {
  const speed = entity.behaviorParams.speed ?? DEFAULT_SPEED;
  const detectRadius = entity.behaviorParams.detectRadius ?? DEFAULT_DETECT_RADIUS;
  const range = entity.behaviorParams.range ?? DEFAULT_RANGE;

  const dist = Phaser.Math.Distance.Between(entity.x, entity.y, ctx.player.x, ctx.player.y);
  if (dist > detectRadius || dist <= range) {
    entity.setVelocity(0, 0);
    return;
  }

  const angle = Phaser.Math.Angle.Between(entity.x, entity.y, ctx.player.x, ctx.player.y);
  entity.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
}
