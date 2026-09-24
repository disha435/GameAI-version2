import type Phaser from 'phaser';
import type { Player } from '../entities/Player';
import { landingSquash } from '../fx/landingSquash';
import type { InputState, MovementController } from './MovementController';

const GRAVITY_Y = 900;
// Below this, a resting body's frame-to-frame velocity noise (and Arcade
// physics' blocked/touching flicker at rest — see Player.lastVelocityY's
// comment) never counts as "was genuinely falling."
const LANDING_FALL_SPEED_THRESHOLD = 40;

export const platformerRunJump: MovementController = {
  configureWorld(scene: Phaser.Scene) {
    scene.physics.world.gravity.set(0, GRAVITY_Y);
  },

  update(player: Player, input: InputState) {
    let vx = 0;
    if (input.left) vx -= 1;
    if (input.right) vx += 1;
    player.setVelocityX(vx * player.speed);

    const body = player.body as Phaser.Physics.Arcade.Body;
    const onGround = body.blocked.down || body.touching.down;

    // Landing squash fires once per real fall, not once per (flickery)
    // grounded-flag transition — see Player.lastVelocityY's comment for why
    // a boolean wasGrounded edge-check doesn't work here.
    if (onGround && player.lastVelocityY > LANDING_FALL_SPEED_THRESHOLD) {
      landingSquash(player, player.scene);
    }
    player.lastVelocityY = body.velocity.y;

    if (input.jumpJustPressed && onGround) {
      // Math.abs, not a bare negation: confirmed live that an LLM-authored
      // spec can supply a negative jumpVelocity (a defensible reading of
      // "up is negative Y" that the schema/prompt never actually
      // documented) — negating an already-negative value here would apply
      // a *downward* shove that's instantly absorbed by standing on the
      // ground, making the jump key silently do nothing. jumpVelocity is
      // always a magnitude; this controller decides the direction.
      player.setVelocityY(-Math.abs(player.jumpVelocity));
    }

    if (vx < 0) player.facing = 'left';
    else if (vx > 0) player.facing = 'right';
  },
};
