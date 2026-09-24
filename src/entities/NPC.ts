import type Phaser from 'phaser';
import type { EntitySpec } from '../spec/types';
import { BaseEntity } from './BaseEntity';

// NPCs use the same behavior set as enemies (an NPC can "patrol" a town
// square, or sit "stationary") but never deal damage on touch — that's
// enforced in CollisionSystem, not here.
export class NPC extends BaseEntity {
  public readonly message?: string;

  constructor(scene: Phaser.Scene, spec: EntitySpec) {
    super(scene, spec);
    this.message = spec.message;
    // Matches Pickup/Trigger, not Enemy: an NPC has no wall collider
    // registered (CollisionSystem only overlaps it with the player), so
    // under a movementType that sets real gravity (platformer_run_jump) it
    // would otherwise fall straight through the level with nothing to stop
    // it — this was never exercised until the platformer genre put real
    // gravity in play.
    (this.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
  }
}
