import type Phaser from 'phaser';

const DEATH_MS = 300;

// Scale-and-fade a dying entity out over DEATH_MS, then run onComplete —
// HealthSystem uses that to actually remove it from its group. A kill
// should read as an event (something happened here) rather than an
// instant disappearance.
export function deathTween(target: Phaser.GameObjects.Sprite, scene: Phaser.Scene, onComplete: () => void): void {
  scene.tweens.add({
    targets: target,
    scale: 0,
    alpha: 0,
    duration: DEATH_MS,
    ease: 'Cubic.easeIn',
    onComplete,
  });
}
