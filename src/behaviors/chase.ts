import Phaser from 'phaser';
import type { Enemy } from '../entities/Enemy';
import type { BehaviorContext } from './BehaviorContext';

const DEFAULT_SPEED = 90;
const DEFAULT_DETECT_RADIUS = 220;

// Moves straight at the player once within detectRadius; otherwise holds
// position. loseRadius (if set, and larger than detectRadius) adds
// hysteresis so a chaser doesn't flicker on/off at the detection boundary.
export function chase(entity: Enemy, ctx: BehaviorContext, _delta: number): void {
  const speed = entity.behaviorParams.speed ?? DEFAULT_SPEED;
  const detectRadius = entity.behaviorParams.detectRadius ?? DEFAULT_DETECT_RADIUS;
  const loseRadius = entity.behaviorParams.loseRadius ?? detectRadius;

  const dist = Phaser.Math.Distance.Between(entity.x, entity.y, ctx.player.x, ctx.player.y);
  const state = entity.behaviorState as { chasing?: boolean };

  if (state.chasing) {
    if (dist > loseRadius) state.chasing = false;
  } else if (dist <= detectRadius) {
    state.chasing = true;
  }

  if (!state.chasing) {
    entity.setVelocity(0, 0);
    return;
  }

  const angle = Phaser.Math.Angle.Between(entity.x, entity.y, ctx.player.x, ctx.player.y);
  entity.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
}
