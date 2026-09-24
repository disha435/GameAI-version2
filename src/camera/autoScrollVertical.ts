import Phaser from 'phaser';
import type { CameraController } from './CameraController';

const SCROLL_SPEED = 55; // px/sec, downward through the world

// Per-camera true scroll position, tracked as an unrounded float outside of
// Phaser's own scrollY property. Necessary because index.html's `pixelArt:
// true` game config turns on each camera's `roundPixels`, and Phaser's own
// Camera.preRender() floors scrollY AND WRITES THE FLOORED VALUE BACK into
// the camera every single frame (not just for that frame's render). At 55px/
// sec, a frame only advances scrollY by ~0.9px — under 1 — so reading
// `cam.scrollY` back as the running total (the previous `+=` approach) lost
// 100% of each frame's progress to that floor-and-writeback, permanently
// pinning the camera at scrollY 0 no matter how many frames ran. Keeping the
// true position here and assigning (not accumulating from) cam.scrollY each
// frame sidesteps it: Phaser is free to floor its own copy for rendering,
// but the next frame's increment still builds on our untouched float.
const scrollAccum = new WeakMap<Phaser.Cameras.Scene2D.Camera, number>();

// Scrolls the camera down through the world at a constant rate, independent
// of player input — the vertical-shooter "screen keeps moving" camera.
// Phaser's own camera bounds (set once in SceneInterpreter.create()) clamp
// scrollY automatically, so this never has to check for the world's bottom.
export const autoScrollVertical: CameraController = {
  configure(scene: Phaser.Scene, player) {
    const cam = scene.cameras.main;
    cam.stopFollow();
    // Movement controllers paired with this camera (shmup_freeaxis) clamp
    // the player to the *current* viewport every frame — necessary so the
    // player can't drift off the visible screen as the camera scrolls, but
    // it means scrollY has to start centered on player.start before that
    // clamp ever runs. Left at the default scrollY=0, a player.start placed
    // anywhere other than near the world's top would get force-clamped
    // into view on the very first frame — a multi-thousand-pixel teleport,
    // not a real reachability win, and enough on its own to land the
    // player right on top of a trigger meant to be far away.
    const bounds = cam.getBounds();
    const startY = Phaser.Math.Clamp(
      player.y - cam.height / 2,
      bounds.y,
      Math.max(bounds.y, bounds.height - cam.height),
    );
    cam.scrollY = startY;
    scrollAccum.set(cam, startY);
  },

  update(scene: Phaser.Scene, delta: number) {
    const cam = scene.cameras.main;
    const next = (scrollAccum.get(cam) ?? cam.scrollY) + (SCROLL_SPEED * delta) / 1000;
    scrollAccum.set(cam, next);
    cam.scrollY = next;
  },
};
