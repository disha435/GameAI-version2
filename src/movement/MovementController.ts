import Phaser from 'phaser';
import type { Player } from '../entities/Player';

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jumpJustPressed: boolean;
}

// A movement controller owns exactly two things: one-time world/physics
// setup (gravity, drag) and the per-frame translation from InputState into
// player velocity + facing. Behaviors and systems never touch player
// velocity directly so there's a single place that defines "how movement
// feels" per movementType.
export interface MovementController {
  configureWorld(scene: Phaser.Scene): void;
  update(player: Player, input: InputState, delta: number): void;
}

export function readInputState(
  cursors: Phaser.Types.Input.Keyboard.CursorKeys,
  wasd: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>,
): InputState {
  return {
    left: cursors.left.isDown || wasd.left.isDown,
    right: cursors.right.isDown || wasd.right.isDown,
    up: cursors.up.isDown || wasd.up.isDown,
    down: cursors.down.isDown || wasd.down.isDown,
    jumpJustPressed:
      Phaser.Input.Keyboard.JustDown(cursors.up) || Phaser.Input.Keyboard.JustDown(wasd.up),
  };
}
