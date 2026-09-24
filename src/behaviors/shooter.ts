import Phaser from 'phaser';
import { playFireFlash } from '../anim/fireFlash';
import type { Enemy } from '../entities/Enemy';
import type { BehaviorContext } from './BehaviorContext';

const DEFAULT_RANGE = 260;
const DEFAULT_FIRE_RATE = 1500;
const DEFAULT_PROJECTILE_SPEED = 220;
const DEFAULT_DAMAGE = 1;

interface ShooterState {
  lastFiredAt: number;
}

// Holds position and fires a projectile at the player at a fixed cadence
// whenever the player is within range. Does not move — combine range/detect
// tuning with map layout (or pair with patrol via a future composite
// behavior) rather than adding movement here.
export function shooter(entity: Enemy, ctx: BehaviorContext, _delta: number): void {
  entity.setVelocity(0, 0);

  const range = entity.behaviorParams.range ?? DEFAULT_RANGE;
  const fireRate = entity.behaviorParams.fireRate ?? DEFAULT_FIRE_RATE;
  const projectileSpeed = entity.behaviorParams.projectileSpeed ?? DEFAULT_PROJECTILE_SPEED;
  const damage = entity.behaviorParams.damage ?? DEFAULT_DAMAGE;
  const sprite = entity.behaviorParams.projectileSprite as string | undefined;

  const dist = Phaser.Math.Distance.Between(entity.x, entity.y, ctx.player.x, ctx.player.y);
  if (dist > range) return;

  const state = entity.behaviorState as Partial<ShooterState>;
  if (state.lastFiredAt !== undefined && ctx.now - state.lastFiredAt < fireRate) return;
  state.lastFiredAt = ctx.now;

  const angle = Phaser.Math.Angle.Between(entity.x, entity.y, ctx.player.x, ctx.player.y);
  ctx.projectiles.spawn(
    entity.x,
    entity.y,
    Math.cos(angle) * projectileSpeed,
    Math.sin(angle) * projectileSpeed,
    'enemy',
    damage,
    sprite,
  );
  playFireFlash(entity, entity.baseSpriteKey);
}
