import Phaser from 'phaser';
import type { AssetKey } from './assetKeys';
import { DEFS, type TextureDef } from './AssetLibrary';

// Tier 2: real multi-frame animation, built the same procedural way as
// every static texture already is — draw N slight variations of the exact
// same shape instead of one. Deliberately generic over *every* entry in
// AssetLibrary.ts's DEFS, not a hand-picked list of "animatable" sprites:
// the transform (a squash/stretch/bob wobble, or a brief scale-pop for
// "fire") is applied identically regardless of shape, so any asset key —
// existing or added later, in any genre/theme — gets walk/fire frames for
// free with zero per-entity art. Whichever behavior/movement actually
// plays them (src/anim/) is a separate, later decision; this module only
// ever answers "what do N frames of this shape look like."
//
// Implementation note: the task sketch this was built from describes a
// packed sprite-sheet + Phaser.Animations.generateFrameNumbers(). This
// uses N separate baked textures (`${key}_walk_0`, `${key}_walk_1`, ...)
// plus an explicit `frames: [{key: ...}, ...]` array instead — Phaser's
// animation system supports either shape equally (AnimationFrame.key can
// point at any texture, not just a slice of one shared sheet). Separate
// textures reuse generatePlaceholderAssets' exact existing
// draw-then-generateTexture idiom with zero new packing/atlas logic, at
// the cost of a few more small baked textures — a fine trade at this
// asset count and size.

const WALK_FRAME_COUNT = 4;
const WALK_FRAME_RATE = 8;
const WALK_SQUASH = 0.1; // vertical compression at the cycle's extremes
const WALK_STRETCH = 0.06; // horizontal compensation, so it reads as a bounce, not a flatten
const WALK_BOB_FRACTION = 0.05; // vertical offset as a fraction of the sprite's own size

const FIRE_SCALE = 1.3;
const FIRE_FRAME_RATE = 10;

export function walkAnimKey(assetKey: string): string {
  return `${assetKey}_walk`;
}

export function fireAnimKey(assetKey: string): string {
  return `${assetKey}_fire`;
}

interface FrameTransform {
  scaleX: number;
  scaleY: number;
  offsetY: number;
}

// Renders `def.draw` through a scale/offset applied about the sprite's own
// center — the same "translate to pivot, scale, translate back" recipe
// Canvas 2D transforms always use — onto a fresh Graphics object, exactly
// mirroring generatePlaceholderAssets' bake-then-destroy pattern.
function bakeTransformedFrame(scene: Phaser.Scene, textureKey: string, def: TextureDef, t: FrameTransform): void {
  if (scene.textures.exists(textureKey)) return;
  const g = scene.add.graphics();
  const c = def.size / 2;
  g.translateCanvas(c, c + t.offsetY);
  g.scaleCanvas(t.scaleX, t.scaleY);
  g.translateCanvas(-c, -c);
  def.draw(g, def.size);
  g.generateTexture(textureKey, def.size, def.size);
  g.destroy();
}

function buildWalkFrames(scene: Phaser.Scene, assetKey: string, def: TextureDef): void {
  const animKey = walkAnimKey(assetKey);
  const frameKeys: string[] = [];
  for (let i = 0; i < WALK_FRAME_COUNT; i++) {
    const phase = (i / WALK_FRAME_COUNT) * Math.PI * 2;
    const wobble = Math.sin(phase);
    const key = `${assetKey}_walk_${i}`;
    bakeTransformedFrame(scene, key, def, {
      scaleX: 1 + Math.abs(wobble) * WALK_STRETCH,
      scaleY: 1 - Math.abs(wobble) * WALK_SQUASH,
      offsetY: wobble * def.size * WALK_BOB_FRACTION,
    });
    frameKeys.push(key);
  }
  if (scene.anims.exists(animKey)) return;
  scene.anims.create({
    key: animKey,
    frames: frameKeys.map((key) => ({ key })),
    frameRate: WALK_FRAME_RATE,
    repeat: -1,
  });
}

// A single scaled-up "pop" frame, then back to the static base texture —
// a brief flash read as "this just fired," generic over any shape for the
// same reason walk frames are (no color-recoloring trickery needed, which
// would require intercepting each draw function's own hardcoded fillStyle
// calls; a scale pulse works identically regardless of what's underneath).
function buildFireFrames(scene: Phaser.Scene, assetKey: string, def: TextureDef): void {
  const animKey = fireAnimKey(assetKey);
  const flashKey = `${assetKey}_fire_0`;
  bakeTransformedFrame(scene, flashKey, def, { scaleX: FIRE_SCALE, scaleY: FIRE_SCALE, offsetY: 0 });
  if (scene.anims.exists(animKey)) return;
  scene.anims.create({
    key: animKey,
    frames: [{ key: flashKey }, { key: assetKey }],
    frameRate: FIRE_FRAME_RATE,
    repeat: 0,
  });
}

// Called once per scene alongside generatePlaceholderAssets — builds a
// walk cycle and a fire flash for every registered asset key, uniformly.
// Whether a given entity ever actually plays either is decided at runtime
// by src/anim/ (velocity for walk, the shooter behavior for fire); an
// unused animation here costs a handful of tiny baked textures and nothing
// else.
export function generateAnimatedAssets(scene: Phaser.Scene): void {
  for (const key of Object.keys(DEFS) as AssetKey[]) {
    const def = DEFS[key];
    buildWalkFrames(scene, key, def);
    buildFireFrames(scene, key, def);
  }
}
