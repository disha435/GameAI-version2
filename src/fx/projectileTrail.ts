import type Phaser from 'phaser';

const TRAIL_FADE_MS = 180;
const TRAIL_ALPHA = 0.35;

// A lightweight, shape-agnostic trail: drop a fading ghost of the
// projectile's current texture/position behind it. Chosen over rotating
// the sprite to match its velocity angle (the other option for this slot)
// because the actual projectile texture is a plain circle — rotating a
// circle is invisible. A trail reads regardless of sprite shape.
export function spawnTrailGhost(scene: Phaser.Scene, x: number, y: number, textureKey: string): void {
  const ghost = scene.add.image(x, y, textureKey).setAlpha(TRAIL_ALPHA).setDepth(-1);
  scene.tweens.add({
    targets: ghost,
    alpha: 0,
    duration: TRAIL_FADE_MS,
    onComplete: () => ghost.destroy(),
  });
}
