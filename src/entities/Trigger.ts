import type Phaser from 'phaser';
import type { EntitySpec, TriggerType } from '../spec/types';
import { BaseEntity } from './BaseEntity';

export class Trigger extends BaseEntity {
  public readonly triggerType: TriggerType;
  public readonly message?: string;
  public fired = false;

  constructor(scene: Phaser.Scene, spec: EntitySpec) {
    super(scene, spec);
    this.triggerType = spec.triggerType ?? 'message';
    this.message = spec.message;
    // size handling itself now lives in BaseEntity's constructor (any
    // entity type can use it), already applied by the super() call above.
    (this.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
    (this.body as Phaser.Physics.Arcade.Body).moves = false;
    this.setAlpha(0.5);
  }
}
