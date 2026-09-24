import Phaser from 'phaser';
import { shakeCamera } from '../fx/cameraShake';
import { hitFlash } from '../fx/hitFlash';
import type { MovementModifiers, PlayerSpec } from '../spec/types';

export class Player extends Phaser.Physics.Arcade.Sprite {
  // See BaseEntity's identical field for why this is kept separately from
  // whatever texture is currently displayed.
  public readonly baseSpriteKey: string;
  public maxHealth: number;
  public health: number;
  public speed: number;
  public jumpVelocity: number;
  public attack: PlayerSpec['attack'];
  // Raw passthrough, same convention as `attack` — no runtime default here;
  // src/movement/movementModifiers.ts treats an absent object (or an absent
  // sub-field within it) as "this modifier isn't active" at the point of use.
  public movementModifiers: MovementModifiers | undefined;
  public lastAttackAt = -Infinity;
  public facing: 'up' | 'down' | 'left' | 'right' = 'down';
  public invulnerableUntil = 0;
  // Read/written by platformerRunJump.ts to detect "just landed after a
  // real fall" for the landing squash. Deliberately velocity-based, not a
  // wasGrounded boolean edge-check: confirmed live (dense scene polling
  // during an actual landing) that Arcade physics' body.blocked.down /
  // touching.down flicker false/true frame-to-frame for a body resting
  // under constant gravity on a static floor — a boolean edge-detector
  // reads that flicker as "left and re-landed" many times a second and the
  // squash tween never gets a chance to finish. Comparing against the
  // actual fall speed from the previous frame is immune to that flicker:
  // resting-state velocity never gets anywhere near a real fall's.
  public lastVelocityY = 0;

  constructor(scene: Phaser.Scene, spec: PlayerSpec) {
    super(scene, spec.start.x, spec.start.y, spec.sprite);
    this.baseSpriteKey = spec.sprite;
    this.maxHealth = spec.health;
    this.health = spec.health;
    this.speed = spec.speed;
    this.jumpVelocity = spec.jumpVelocity ?? 420;
    this.attack = spec.attack;
    this.movementModifiers = spec.movementModifiers;

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setCollideWorldBounds(true);
  }

  takeDamage(amount: number, invulnMs = 800): void {
    if (this.scene.time.now < this.invulnerableUntil) return;
    this.health = Math.max(0, this.health - amount);
    this.invulnerableUntil = this.scene.time.now + invulnMs;
    hitFlash(this, this.scene, 0xff0000);
    shakeCamera(this.scene);
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  canAttack(): boolean {
    if (!this.attack || this.attack.type === 'none') return false;
    return this.scene.time.now - this.lastAttackAt >= this.attack.cooldown;
  }
}
