import type Phaser from 'phaser';
import type { EntitySpec } from '../spec/types';
import { BaseEntity } from './BaseEntity';

// Enemy and Boss are the same runtime object — a boss is just an enemy with
// higher stats and (conventionally) a `boss` sprite/behaviorParams. Keeping
// one class avoids duplicating behavior-dispatch logic in the interpreter.
export class Enemy extends BaseEntity {
  constructor(scene: Phaser.Scene, spec: EntitySpec) {
    super(scene, spec);
  }
}
