import type Phaser from 'phaser';

// Phaser's camera shake is built in and practically free — this wrapper
// exists only so every call site agrees on a default feel instead of
// hand-tuning duration/intensity in three different places.
export function shakeCamera(scene: Phaser.Scene, duration = 100, intensity = 0.005): void {
  scene.cameras.main.shake(duration, intensity);
}
