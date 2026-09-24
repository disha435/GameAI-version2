import Phaser from 'phaser';
import { ASSET_KEYS, type AssetKey } from './assetKeys';

// Phase 0 placeholder art: everything is a procedurally-drawn texture baked
// once via Graphics.generateTexture, so the runtime never depends on image
// files existing on disk. Swapping in real spritesheets later only means
// changing how these keys are populated — nothing downstream (entities,
// behaviors, the interpreter) needs to know the difference.

// Exported (not just the generation function) so AnimatedAssetLibrary.ts
// can reuse the exact same draw functions to build walk/fire frame
// variants — one shape definition per entity, animated and static
// renderings both derived from it, never two copies to fall out of sync.
export interface TextureDef {
  size: number;
  draw: (g: Phaser.GameObjects.Graphics, size: number) => void;
}

const size32 = 32;
const size48 = 48;

export const DEFS: Record<AssetKey, TextureDef> = {
  [ASSET_KEYS.player]: {
    size: size32,
    draw: (g, s) => {
      g.fillStyle(0x4fd1ff, 1);
      g.fillCircle(s / 2, s / 2, s / 2 - 2);
      g.lineStyle(2, 0xffffff, 1);
      g.strokeCircle(s / 2, s / 2, s / 2 - 2);
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(s / 2, 4, s / 2 - 5, s / 2, s / 2 + 5, s / 2);
    },
  },
  [ASSET_KEYS.enemyPatrol]: {
    size: size32,
    draw: (g, s) => {
      g.fillStyle(0xff6b6b, 1);
      g.fillRoundedRect(2, 2, s - 4, s - 4, 6);
    },
  },
  [ASSET_KEYS.enemyChase]: {
    size: size32,
    draw: (g, s) => {
      g.fillStyle(0xff9f43, 1);
      g.fillTriangle(s / 2, 2, 2, s - 2, s - 2, s - 2);
    },
  },
  [ASSET_KEYS.enemyFlyer]: {
    size: size32,
    draw: (g, s) => {
      g.fillStyle(0xa29bfe, 1);
      g.fillEllipse(s / 2, s / 2, s - 4, (s - 4) * 0.6);
    },
  },
  [ASSET_KEYS.enemyShooter]: {
    size: size32,
    draw: (g, s) => {
      g.fillStyle(0xff4d4d, 1);
      g.fillRect(4, 4, s - 8, s - 8);
      g.fillStyle(0x2d2d2d, 1);
      g.fillCircle(s / 2, s / 2, 4);
    },
  },
  [ASSET_KEYS.boss]: {
    size: size48,
    draw: (g, s) => {
      g.fillStyle(0x8e2de2, 1);
      g.fillRoundedRect(2, 2, s - 4, s - 4, 10);
      g.lineStyle(3, 0xffd93d, 1);
      g.strokeRoundedRect(2, 2, s - 4, s - 4, 10);
    },
  },
  [ASSET_KEYS.npc]: {
    size: size32,
    draw: (g, s) => {
      g.fillStyle(0x55efc4, 1);
      g.fillCircle(s / 2, s / 2, s / 2 - 2);
    },
  },
  [ASSET_KEYS.pickupCoin]: {
    size: 20,
    draw: (g, s) => {
      g.fillStyle(0xffd93d, 1);
      g.fillCircle(s / 2, s / 2, s / 2 - 2);
      g.lineStyle(2, 0xb8860b, 1);
      g.strokeCircle(s / 2, s / 2, s / 2 - 2);
    },
  },
  [ASSET_KEYS.pickupHealth]: {
    size: 20,
    draw: (g, s) => {
      g.fillStyle(0xff6b6b, 1);
      g.fillRect(s / 2 - 2, 3, 4, s - 6);
      g.fillRect(3, s / 2 - 2, s - 6, 4);
    },
  },
  [ASSET_KEYS.pickupItem]: {
    size: 20,
    draw: (g, s) => {
      g.fillStyle(0x74b9ff, 1);
      g.fillRoundedRect(2, 2, s - 4, s - 4, 4);
    },
  },
  [ASSET_KEYS.projectile]: {
    size: 10,
    draw: (g, s) => {
      g.fillStyle(0xffffff, 1);
      g.fillCircle(s / 2, s / 2, s / 2 - 1);
    },
  },
  [ASSET_KEYS.tileGround]: {
    size: size32,
    draw: (g, s) => {
      g.fillStyle(0x2f3542, 1);
      g.fillRect(0, 0, s, s);
      g.lineStyle(1, 0x3d4454, 1);
      g.strokeRect(0, 0, s, s);
    },
  },
  [ASSET_KEYS.tileWall]: {
    size: size32,
    draw: (g, s) => {
      g.fillStyle(0x57606f, 1);
      g.fillRect(0, 0, s, s);
      g.lineStyle(1, 0x2f3542, 1);
      g.strokeRect(0, 0, s, s);
    },
  },
  [ASSET_KEYS.triggerZone]: {
    size: size32,
    draw: (g, s) => {
      g.fillStyle(0x00ffcc, 0.25);
      g.fillRect(0, 0, s, s);
      g.lineStyle(2, 0x00ffcc, 0.8);
      g.strokeRect(0, 0, s, s);
    },
  },
  [ASSET_KEYS.playerShip]: {
    size: size32,
    draw: (g, s) => {
      g.fillStyle(0x4fd1ff, 1);
      g.fillTriangle(s / 2, 2, 4, s - 4, s - 4, s - 4);
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(s / 2, 8, s / 2 - 4, s - 10, s / 2 + 4, s - 10);
    },
  },
  [ASSET_KEYS.enemyShipA]: {
    size: size32,
    draw: (g, s) => {
      g.fillStyle(0xff6b6b, 1);
      g.fillTriangle(s / 2, s - 2, 4, 4, s - 4, 4);
      g.fillStyle(0x2d2d2d, 1);
      g.fillCircle(s / 2, s / 2 + 4, 4);
    },
  },
  [ASSET_KEYS.enemyShipB]: {
    size: size32,
    draw: (g, s) => {
      g.fillStyle(0xa29bfe, 1);
      g.fillTriangle(s / 2, s - 2, 2, s / 2, s / 2 - 4, 4);
      g.fillTriangle(s / 2, s - 2, s - 2, s / 2, s / 2 + 4, 4);
      g.fillStyle(0xffd93d, 1);
      g.fillCircle(s / 2, s / 2, 3);
    },
  },
  [ASSET_KEYS.tileSpace]: {
    size: size32,
    draw: (g, s) => {
      g.fillStyle(0x05060f, 1);
      g.fillRect(0, 0, s, s);
      g.fillStyle(0xffffff, 0.8);
      g.fillRect(6, 8, 1, 1);
      g.fillRect(20, 22, 1, 1);
      g.fillRect(26, 6, 1, 1);
      g.fillRect(12, 26, 1, 1);
    },
  },
};

export function generatePlaceholderAssets(scene: Phaser.Scene): void {
  for (const key of Object.keys(DEFS) as AssetKey[]) {
    if (scene.textures.exists(key)) continue;
    const def = DEFS[key];
    const g = scene.add.graphics();
    def.draw(g, def.size);
    g.generateTexture(key, def.size, def.size);
    g.destroy();
  }
}
