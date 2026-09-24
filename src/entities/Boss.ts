import type Phaser from 'phaser';
import type { EntitySpec } from '../spec/types';
import { Enemy } from './Enemy';

// Distinct class purely so WinConditionSystem and the interpreter can tell
// "the boss" apart from rank-and-file enemies without relying on naming
// conventions in the sprite key.
export class Boss extends Enemy {
  constructor(scene: Phaser.Scene, spec: EntitySpec) {
    super(scene, spec);
  }
}
