import type Phaser from 'phaser';
import { idleBob } from '../fx/idleBob';
import type { EntitySpec } from '../spec/types';
import { BaseEntity } from './BaseEntity';

export class Pickup extends BaseEntity {
  public readonly pickupType: NonNullable<EntitySpec['pickupType']>;
  public readonly value: number;

  constructor(scene: Phaser.Scene, spec: EntitySpec) {
    super(scene, spec);
    this.pickupType = spec.pickupType ?? 'item';
    this.value = spec.value ?? 1;
    (this.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
    // Safe here specifically because nothing else ever drives a pickup's Y
    // via physics or a behavior, so this tween has nothing to fight (see
    // idleBob.ts) — true even for a SpawnerSystem-created pickup carried
    // along at a constant X velocity (a paired-gap reward): only X moves
    // there, Y stays exactly as untouched as any other pickup's.
    idleBob(this, scene);
  }
}
