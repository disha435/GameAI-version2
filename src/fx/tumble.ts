import type Phaser from 'phaser';

const TUMBLE_DURATION_MS = 2200;

// A continuous full rotation — the "you don't even need drawn frames, just
// rotate the sprite" case, cheapest effect in the whole plan. Deliberately
// generic: wired up wherever a behavior implies free, gravity-unaffected
// floating movement (flying_sine — see SceneInterpreter.ts), not hardcoded
// to any one sprite or theme. A rock, a bat, a UFO, a spore — whatever the
// LLM actually drew this entity as — all tumble identically.
export function startTumble(target: Phaser.GameObjects.Sprite, scene: Phaser.Scene, durationMs = TUMBLE_DURATION_MS): void {
  scene.tweens.add({
    targets: target,
    rotation: target.rotation + Math.PI * 2,
    duration: durationMs,
    repeat: -1,
    ease: 'Linear',
  });
}
