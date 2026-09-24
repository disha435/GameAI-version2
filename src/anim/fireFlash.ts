import type Phaser from 'phaser';
import { fireAnimKey } from '../assets/AnimatedAssetLibrary';

// Plays the brief "just fired" pop baked for this asset key (see
// AnimatedAssetLibrary.ts) — a 2-frame animation that pops and reverts to
// the base texture on its own, so a single call here is the whole effect;
// no completion callback needed to hand control back to walk/idle.
export function playFireFlash(sprite: Phaser.GameObjects.Sprite, baseSpriteKey: string): void {
  const animKey = fireAnimKey(baseSpriteKey);
  if (!sprite.scene.anims.exists(animKey)) return;
  sprite.play(animKey, true);
}
