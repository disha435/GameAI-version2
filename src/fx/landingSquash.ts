import type Phaser from 'phaser';

const SQUASH_X = 1.15;
const SQUASH_Y = 0.8;
const RECOVER_MS = 200;

// Snap into a squashed scale on ground contact, then spring back to 1/1.
// killTweensOf first because — unlike hit/death/pickup effects, which are
// gated to fire exactly once per entity by a dead/dying flag — landing can
// genuinely retrigger many times in a row (rapid hops, a bouncy platform),
// and two overlapping scale tweens on the same target fight each other and
// look worse than no effect at all.
export function landingSquash(target: Phaser.GameObjects.Sprite, scene: Phaser.Scene): void {
  scene.tweens.killTweensOf(target);
  target.setScale(SQUASH_X, SQUASH_Y);
  scene.tweens.add({
    targets: target,
    scaleX: 1,
    scaleY: 1,
    duration: RECOVER_MS,
    ease: 'Back.easeOut',
  });
}
