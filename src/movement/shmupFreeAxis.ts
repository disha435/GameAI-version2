import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { InputState, MovementController } from './MovementController';

// Same free 8-directional feel as topdown8dir, but for genres whose world is
// much taller than the viewport (e.g. a vertically-scrolling shooter): the
// player is additionally clamped to the camera's current viewport rather
// than relying on collideWorldBounds alone, which only stops it at the edges
// of the full (much larger) world.
export const shmupFreeAxis: MovementController = {
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

    const cam = player.scene.cameras.main;
    const margin = player.displayHeight / 2;
    const minY = cam.scrollY + margin;
    const maxY = cam.scrollY + cam.height - margin;
    player.y = Phaser.Math.Clamp(player.y, minY, maxY);
  },
};
