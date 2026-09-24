import Phaser from 'phaser';
import type { Enemy } from '../entities/Enemy';
import type { BehaviorContext } from './BehaviorContext';

const DEFAULT_SPEED = 100;
const DEFAULT_DETECT_RADIUS = 180;

export function flee(entity: Enemy, ctx: BehaviorContext, _delta: number): void {
  const speed = entity.behaviorParams.fleeSpeed ?? entity.behaviorParams.speed ?? DEFAULT_SPEED;
  const detectRadius = entity.behaviorParams.detectRadius ?? DEFAULT_DETECT_RADIUS;

  const dist = Phaser.Math.Distance.Between(entity.x, entity.y, ctx.player.x, ctx.player.y);
  if (dist > detectRadius) {
    entity.setVelocity(0, 0);
    return;
  }

  const angle = Phaser.Math.Angle.Between(ctx.player.x, ctx.player.y, entity.x, entity.y);
  entity.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
}
