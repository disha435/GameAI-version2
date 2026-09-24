import type Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { ProjectileManager } from '../systems/ProjectileManager';

// Everything a behavior is allowed to read or act through. Behaviors never
// hold a reference to the scene beyond what's exposed here, and never reach
// into other entities directly — this keeps each behavior module testable
// and keeps "what a monster can do" auditable in one small surface.
export interface BehaviorContext {
  scene: Phaser.Scene;
  player: Player;
  now: number;
  projectiles: ProjectileManager;
}
