import type Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { InputState, MovementController } from './MovementController';

export const topdown8dir: MovementController = {
  configureWorld(scene: Phaser.Scene) {
    scene.physics.world.gravity.set(0, 0);
  },

  update(player: Player, input: InputState) {
    let vx = 0;
    let vy = 0;
    if (input.left) vx -= 1;
    if (input.right) vx += 1;
    if (input.up) vy -= 1;
    if (input.down) vy += 1;

    if (vx !== 0 && vy !== 0) {
      const norm = Math.SQRT1_2;
      vx *= norm;
      vy *= norm;
    }

    player.setVelocity(vx * player.speed, vy * player.speed);

    if (vx < 0) player.facing = 'left';
    else if (vx > 0) player.facing = 'right';
    else if (vy < 0) player.facing = 'up';
    else if (vy > 0) player.facing = 'down';
  },
};
