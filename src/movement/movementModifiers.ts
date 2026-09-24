import type Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { InputState } from './MovementController';

// Applied once per frame, AFTER a base MovementController's own update() —
// see SceneInterpreter.update(). This is a generic overlay layer, not a
// change to the 3 existing controllers, on purpose: axisConstraint / gravity
// / inputMode compose with ANY base movementType (shmup_freeaxis + gravity +
// impulse + a vertical-only axis constraint is Flappy Bird's actual feel),
// so the logic belongs in exactly one shared place — the same lesson Tier
// 1/2's fx and animation systems already proved (generic and behavior-keyed
// scales across every genre for free; genre-keyed doesn't).
//
// gridSnap is intentionally the simplest possible thing here: continuous
// position rounded to the nearest cell every frame, not true discrete
// step-by-one-cell movement. That's deferred on purpose — see
// spec/types.ts's MovementModifiers comment — to the later slice that adds
// Snake's actual growing/self-colliding body, which needs a fundamentally
// different (turn-based, not continuous-velocity) movement model to feel
// right. This plumbing exists now so that later slice has a schema/registry
// entry to build on, not to make Snake movement feel correct today.
export function applyMovementModifiers(player: Player, input: InputState, preUpdateVelocityY: number): void {
  const modifiers = player.movementModifiers;
  if (!modifiers) return;

  const body = player.body as Phaser.Physics.Arcade.Body;

  // A base controller that sets vy from held input every frame (e.g.
  // shmupFreeAxis) would otherwise reset gravity's own frame-to-frame
  // accumulation to 0 before it ever compounds — exactly how
  // platformerRunJump avoids this today, by simply never touching vy at
  // all. Restoring the pre-controller vy here gives every OTHER
  // movementType that same "gravity owns this axis" behavior without
  // editing them.
  if (modifiers.gravity?.enabled) {
    body.setVelocityY(preUpdateVelocityY);
  }

  if (modifiers.inputMode === 'impulse' && input.jumpJustPressed) {
    // Reuses jumpJustPressed (already OR'd across Up/W in readInputState)
    // as the general "impulse" trigger rather than inventing a second key
    // binding — a flap and a jump are the same physical action (a
    // held-direction press that means "go up"), just with different
    // resulting physics.
    body.setVelocityY(-(modifiers.impulseForce ?? 0));
  }

  if (modifiers.axisConstraint === 'horizontal') {
    body.setVelocityY(0);
  } else if (modifiers.axisConstraint === 'vertical') {
    body.setVelocityX(0);
  }

  if (modifiers.gridSnap) {
    const cell = modifiers.gridSnap.cellSize;
    player.x = Math.round(player.x / cell) * cell;
    player.y = Math.round(player.y / cell) * cell;
  }
}
