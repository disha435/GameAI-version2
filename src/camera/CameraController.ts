import type Phaser from 'phaser';
import type { Player } from '../entities/Player';

// A camera controller owns exactly two things: one-time setup once the
// player exists and the world/camera bounds are already configured, and a
// per-frame update. Mirrors the shape of movement/MovementController.ts —
// SceneInterpreter never manipulates the camera directly, so "how the
// camera behaves" per cameraMode stays in one place per mode.
export interface CameraController {
  configure(scene: Phaser.Scene, player: Player): void;
  update(scene: Phaser.Scene, delta: number): void;
}
