import type Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { CameraController } from './CameraController';

export const followPlayer: CameraController = {
  configure(scene: Phaser.Scene, player: Player) {
    scene.cameras.main.startFollow(player, true, 0.12, 0.12);
  },

  update() {
    // Phaser's own startFollow tracking handles every frame; nothing to do.
  },
};
