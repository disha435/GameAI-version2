import type { CameraMode } from '../spec/types';
import { autoScrollVertical } from './autoScrollVertical';
import type { CameraController } from './CameraController';
import { followPlayer } from './followPlayer';

// Record<CameraMode, CameraController> forces this map to implement exactly
// the closed CAMERA_MODES union from spec/types.ts at compile time — same
// enforcement shape as movement/MovementRegistry.ts.
const REGISTRY: Record<CameraMode, CameraController> = {
  follow_player: followPlayer,
  auto_scroll_vertical: autoScrollVertical,
};

export function getCameraController(mode: CameraMode): CameraController {
  const controller = REGISTRY[mode];
  if (!controller) {
    throw new Error(`Unknown camera mode "${mode}". Known modes: ${Object.keys(REGISTRY).join(', ')}`);
  }
  return controller;
}
