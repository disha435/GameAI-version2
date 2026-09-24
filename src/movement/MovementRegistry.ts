import type { MovementType } from '../spec/types';
import type { MovementController } from './MovementController';
import { platformerRunJump } from './platformerRunJump';
import { shmupFreeAxis } from './shmupFreeAxis';
import { topdown8dir } from './topdown8dir';

// Record<MovementType, MovementController> forces this map to implement
// exactly the closed MOVEMENT_TYPES union from spec/types.ts at compile
// time — see EntityRegistry.ts for why validate.ts leans on that instead of
// importing this (Phaser-dependent) module.
const REGISTRY: Record<MovementType, MovementController> = {
  topdown_8dir: topdown8dir,
  platformer_run_jump: platformerRunJump,
  shmup_freeaxis: shmupFreeAxis,
};

export function getMovementController(type: MovementType): MovementController {
  const controller = REGISTRY[type];
  if (!controller) {
    throw new Error(`Unknown movementType "${type}". Known types: ${Object.keys(REGISTRY).join(', ')}`);
  }
  return controller;
}
