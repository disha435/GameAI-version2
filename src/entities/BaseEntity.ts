import Phaser from 'phaser';
import { shakeCamera } from '../fx/cameraShake';
import { hitFlash } from '../fx/hitFlash';
import type { BehaviorName, BehaviorParams, EntitySpec, EntityType } from '../spec/types';

// Every spawned game object — player included — is an Arcade sprite carrying
// its spec-derived data plus a free-form `behaviorState` bag that behavior
// modules use for their own per-entity memory (patrol index, fire timers,
// sine phase, etc). Behaviors never reach into another entity's state.
export class BaseEntity extends Phaser.Physics.Arcade.Sprite {
  public readonly entityId: string;
  public readonly entityType: EntityType;
  // The asset key this entity was spawned with (spec.sprite) — kept
  // separately from whatever texture is currently showing, since Tier 2's
  // walk/fire animations swap the live texture through several generated
  // frame keys (`${sprite}_walk_0`, etc). Animation code needs a stable
  // reference back to "what's the base/idle texture" regardless of which
  // frame is currently playing.
  public readonly baseSpriteKey: string;
  public readonly behavior?: BehaviorName;
  public readonly behaviorParams: BehaviorParams;
  public readonly behaviorState: Record<string, unknown> = {};

  public maxHealth: number;
  public health: number;
  public damage: number;
  public scoreValue: number;
  public dead = false;
  // True once its death tween has started — distinct from `dead` so
  // HealthSystem's per-frame sweep (which keeps seeing this entity in its
  // group until the tween's onComplete actually removes it) triggers the
  // tween exactly once instead of restarting it every frame.
  public dying = false;

  constructor(scene: Phaser.Scene, spec: EntitySpec) {
    super(scene, spec.position.x, spec.position.y, spec.sprite);
    this.entityId = spec.id;
    this.entityType = spec.type;
    this.baseSpriteKey = spec.sprite;
    this.behavior = spec.behavior;
    this.behaviorParams = spec.behaviorParams ?? {};
    this.maxHealth = spec.health ?? 1;
    this.health = this.maxHealth;
    this.damage = spec.damage ?? 0;
    this.scoreValue = spec.scoreValue ?? 0;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Originally Trigger-only (a zone stretched to an arbitrary box); moved
    // here so any entity type can use it — a spawner-created hazard is the
    // other real user, stretching a small sprite into a tall pipe-segment
    // shape. Harmless for the vast majority of entities that never set it.
    if (spec.size) {
      this.setDisplaySize(spec.size.width, spec.size.height);
      (this.body as Phaser.Physics.Arcade.Body).setSize(spec.size.width, spec.size.height);
    }
  }

  takeDamage(amount: number): void {
    if (this.dead) return;
    this.health -= amount;
    hitFlash(this, this.scene);
    if (this.entityType === 'boss') shakeCamera(this.scene, 120, 0.006);
    if (this.health <= 0) {
      this.dead = true;
    }
  }
}
