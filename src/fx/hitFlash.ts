import type Phaser from 'phaser';

const FLASH_MS = 80;
const DEFAULT_COLOR = 0xffffff;

// A brief tint flash on taking damage — shared by every damageable entity
// (BaseEntity-derived enemies/bosses and the player) so there's one place
// that defines "what does getting hit look like." Timer-based rather than a
// tween: a flash is a single instantaneous swap-then-revert, not something
// that benefits from easing.
export function hitFlash(target: Phaser.GameObjects.Sprite, scene: Phaser.Scene, color = DEFAULT_COLOR): void {
  target.setTintFill(color);
  scene.time.delayedCall(FLASH_MS, () => {
    if (target.active) target.clearTint();
  });
}
