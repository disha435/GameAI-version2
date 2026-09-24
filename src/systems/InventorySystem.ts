import type Phaser from 'phaser';
import { GameEvents } from './GameEvents';

export class InventorySystem {
  private counts = new Map<string, number>();

  constructor(private scene: Phaser.Scene) {}

  add(key: string, amount = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + amount);
    this.scene.events.emit(GameEvents.InventoryChanged, this.snapshot());
  }

  has(key: string, amount = 1): boolean {
    return (this.counts.get(key) ?? 0) >= amount;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}
