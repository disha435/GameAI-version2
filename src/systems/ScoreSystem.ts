import type Phaser from 'phaser';
import { GameEvents } from './GameEvents';

export class ScoreSystem {
  private score = 0;

  constructor(private scene: Phaser.Scene) {}

  add(amount: number): void {
    this.score += amount;
    this.scene.events.emit(GameEvents.ScoreChanged, this.score);
  }

  get(): number {
    return this.score;
  }
}
