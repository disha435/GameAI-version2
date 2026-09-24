import type Phaser from 'phaser';

const DEFAULT_AMPLITUDE = 4;
const DEFAULT_DURATION_MS = 900;

// A continuous, always-running yoyo tween on y — deliberately only wired up
// for pickups (see Pickup.ts): they never move via physics/behavior, so a
// tween nudging their y each cycle has nothing to fight. Wiring this into
// anything with its own velocity-driven movement (player, enemies) would
// mean this tween and Arcade physics fighting over the same y each frame —
// out of scope for this pass, not attempted.
export function idleBob(target: Phaser.GameObjects.Sprite, scene: Phaser.Scene, amplitude = DEFAULT_AMPLITUDE, duration = DEFAULT_DURATION_MS): void {
  scene.tweens.add({
    targets: target,
    y: target.y - amplitude,
    duration,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
}
