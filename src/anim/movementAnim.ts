import type Phaser from 'phaser';
import { walkAnimKey } from '../assets/AnimatedAssetLibrary';

// Below this, residual/rounding velocity noise on an otherwise-still body
// shouldn't read as "walking" — same reasoning as Tier 1's landing-squash
// fall-speed threshold, just for the opposite transition.
const MOVE_EPSILON = 4;

// Switches a physics-backed sprite between its walk cycle and its static
// base texture from actual velocity — no behavior/movement-type lookup
// table needed, since "is this thing currently moving" is exactly what its
// own physics body already tracks. Safe to call every frame on anything
// with a body (player, enemies, bosses, NPCs): a sprite whose asset key
// has no walk animation registered just no-ops via the `anims.exists`
// check, so nothing needs to know in advance which entities animate.
export function updateMovementAnimation(sprite: Phaser.GameObjects.Sprite, baseSpriteKey: string): void {
  const body = sprite.body as Phaser.Physics.Arcade.Body | null;
  if (!body) return;

  const animKey = walkAnimKey(baseSpriteKey);
  if (!sprite.scene.anims.exists(animKey)) return;

  const moving = Math.abs(body.velocity.x) > MOVE_EPSILON || Math.abs(body.velocity.y) > MOVE_EPSILON;
  if (moving) {
    sprite.play(animKey, true); // ignoreIfPlaying — don't restart the cycle every frame while continuously moving
    return;
  }

  // Only ever stop/revert *our own* animation — confirmed live that
  // stopping whatever happens to be playing was a real bug: this runs
  // every frame right after the behavior loop, so a stationary shooter's
  // fire-flash (started that same frame, a couple of lines earlier in
  // SceneInterpreter.update()) was being killed before it ever rendered a
  // single frame, every single shot. Checking which animation is actually
  // current means an unrelated one-shot effect like fire-flash is left
  // alone to finish (and it's self-terminating — its own second frame is
  // the base texture — so there's nothing left to revert once it's done).
  if (sprite.anims.currentAnim?.key === animKey) {
    sprite.anims.stop();
    sprite.setTexture(baseSpriteKey);
  }
}
