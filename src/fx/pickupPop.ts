import type Phaser from 'phaser';

const POP_MS = 180;
const FLOAT_MS = 600;
const FLOAT_DISTANCE = 28;

// Quick scale-up-and-fade on the pickup sprite itself, then onComplete —
// CollisionSystem uses that to actually deactivate/remove it, so the pop is
// always fully visible before the sprite disappears.
export function pickupPop(target: Phaser.GameObjects.Sprite, scene: Phaser.Scene, onComplete: () => void): void {
  scene.tweens.add({
    targets: target,
    scale: { from: target.scale, to: target.scale * 1.6 },
    alpha: { from: 1, to: 0 },
    duration: POP_MS,
    ease: 'Cubic.easeOut',
    onComplete,
  });
}

// A small floating "+N" (or "+N HP") label that rises and fades — the
// standard "you gained something" readout, independent of the pickup
// sprite's own pop so it stays legible even after the sprite is gone.
export function floatingText(scene: Phaser.Scene, x: number, y: number, text: string, color = '#ffd93d'): void {
  const label = scene.add
    .text(x, y, text, { fontSize: '14px', fontFamily: 'monospace', color })
    .setOrigin(0.5)
    .setDepth(500);
  scene.tweens.add({
    targets: label,
    y: y - FLOAT_DISTANCE,
    alpha: 0,
    duration: FLOAT_MS,
    ease: 'Cubic.easeOut',
    onComplete: () => label.destroy(),
  });
}
