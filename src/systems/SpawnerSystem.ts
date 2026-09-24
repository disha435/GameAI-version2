import Phaser from 'phaser';
import { DIRECTION_VECTORS } from '../behaviors/fallAndDespawn';
import { resolveEntitySprite } from '../assets/ThemeRegistry';
import { Boss } from '../entities/Boss';
import type { BaseEntity } from '../entities/BaseEntity';
import { createEntity } from '../entities/EntityRegistry';
import type { Enemy } from '../entities/Enemy';
import type { Pickup } from '../entities/Pickup';
import type { EntitySpec, PairedGapSpec, SpawnEdge, SpawnerSpec, Theme } from '../spec/types';

// Just off the visible edge — where new entities actually appear.
const SPAWN_MARGIN = 50;
// Must be bigger than SPAWN_MARGIN, not equal: an entity spawns already
// "outside world bounds" by definition (that's the point — it enters from
// off-screen), so checking despawn at the SAME margin would remove it the
// very first frame it exists, before it's ever visible. This is the gap
// between "just spawned, still off-screen" and "has genuinely traveled all
// the way through and past the far side."
const DESPAWN_MARGIN = 200;

// Generic "entities periodically appear from a world edge, move in a fixed
// direction, and despawn once they've traveled past the far side" — the
// falling-hazard / incoming-obstacle primitive. Not folded into
// EntityRegistry/spawnEntities()'s scene-init path on purpose: every other
// entity in this engine is placed once, from the spec's own entities array,
// at scene creation — this is the one thing that creates entities during
// gameplay, so it owns its own creation, group-membership, and cleanup
// logic rather than complicating that already-simple initial-placement path.
export class SpawnerSystem {
  private elapsedMs = new Map<string, number>();
  private spawnCounter = 0;
  // Tracks only entities THIS system created, alongside which group each
  // lives in — never touches groups.enemies/pickups wholesale, so a
  // hand-placed static entity that happens to end up near a world edge
  // (camera scroll, knockback, whatever) is never at risk of being swept up
  // by the despawn check below.
  private spawned = new Map<BaseEntity, Phaser.Physics.Arcade.Group>();

  constructor(
    private scene: Phaser.Scene,
    private spawners: SpawnerSpec[],
    private worldWidth: number,
    private worldHeight: number,
    private theme: Theme,
    private enemiesGroup: Phaser.Physics.Arcade.Group,
    private bossesGroup: Phaser.Physics.Arcade.Group,
    private pickupsGroup: Phaser.Physics.Arcade.Group,
  ) {
    for (const spawner of spawners) this.elapsedMs.set(spawner.id, 0);
  }

  update(delta: number): void {
    for (const spawner of this.spawners) {
      const elapsed = (this.elapsedMs.get(spawner.id) ?? 0) + delta;
      if (elapsed >= spawner.interval * 1000) {
        this.spawn(spawner);
        this.elapsedMs.set(spawner.id, 0);
      } else {
        this.elapsedMs.set(spawner.id, elapsed);
      }
    }
    this.despawnOffBounds();
  }

  private spawn(spawner: SpawnerSpec): void {
    if (spawner.pairedGap) {
      this.spawnPair(spawner, spawner.pairedGap);
    } else {
      this.spawnFromTemplate(spawner, this.resolveEdgePosition(spawner.spawnEdge));
    }
  }

  private resolveEdgePosition(edge: SpawnEdge): { x: number; y: number } {
    switch (edge) {
      case 'top':
        return { x: Phaser.Math.Between(0, this.worldWidth), y: -SPAWN_MARGIN };
      case 'bottom':
        return { x: Phaser.Math.Between(0, this.worldWidth), y: this.worldHeight + SPAWN_MARGIN };
      case 'left':
        return { x: -SPAWN_MARGIN, y: Phaser.Math.Between(0, this.worldHeight) };
      case 'right':
        return { x: this.worldWidth + SPAWN_MARGIN, y: Phaser.Math.Between(0, this.worldHeight) };
    }
  }

  // One spawn event creates two entities from the same template — one on
  // each side of a randomized gap — instead of one. Flappy Bird's pipes,
  // expressed as a variant of the single-entity spawn above rather than a
  // separate concept: same template, same interval/speed/direction, just
  // two positions computed from a gap instead of one edge position.
  private spawnPair(spawner: SpawnerSpec, gap: PairedGapSpec): void {
    const vertical = spawner.spawnEdge === 'left' || spawner.spawnEdge === 'right';
    const crossFixed =
      spawner.spawnEdge === 'left'
        ? -SPAWN_MARGIN
        : spawner.spawnEdge === 'right'
          ? this.worldWidth + SPAWN_MARGIN
          : spawner.spawnEdge === 'top'
            ? -SPAWN_MARGIN
            : this.worldHeight + SPAWN_MARGIN;
    const primaryExtent = vertical ? this.worldHeight : this.worldWidth;
    const gapCenter = Phaser.Math.Between(gap.gapPositionRange.min, gap.gapPositionRange.max);
    const halfGap = gap.gapSize / 2;

    this.spawnSegment(spawner, vertical, crossFixed, 0, Math.max(0, gapCenter - halfGap));
    this.spawnSegment(spawner, vertical, crossFixed, Math.min(primaryExtent, gapCenter + halfGap), primaryExtent);

    if (gap.gapScoreValue) {
      const position = vertical ? { x: crossFixed, y: gapCenter } : { x: gapCenter, y: crossFixed };
      this.spawnGapPickup(spawner, position, gap.gapScoreValue);
    }
  }

  private spawnSegment(
    spawner: SpawnerSpec,
    vertical: boolean,
    crossFixed: number,
    primaryStart: number,
    primaryEnd: number,
  ): void {
    const length = primaryEnd - primaryStart;
    if (length <= 0) return; // gap covers this whole side — nothing to spawn here
    const primaryCenter = primaryStart + length / 2;
    const position = vertical ? { x: crossFixed, y: primaryCenter } : { x: primaryCenter, y: crossFixed };
    const thickness = spawner.entityTemplate.size?.width ?? 60;
    // The template's own `size`, if any, is a default THICKNESS, not a
    // fixed box — the segment's length along the gap's axis is always
    // computed here, since it varies every spawn with the randomized gap.
    const size = vertical ? { width: thickness, height: length } : { width: length, height: thickness };
    this.spawnFromTemplate(spawner, position, size);
  }

  private spawnFromTemplate(
    spawner: SpawnerSpec,
    position: { x: number; y: number },
    sizeOverride?: { width: number; height: number },
  ): void {
    const template = spawner.entityTemplate;
    const rawSpec: EntitySpec = {
      id: `${spawner.id}_${this.spawnCounter++}`,
      type: template.type,
      sprite: template.sprite,
      position,
      behavior: template.behavior,
      // moveDirection/moveSpeed flow from the spawner, not the template —
      // a spec author sets them once, at the spawner level, instead of
      // duplicating them into every template's behaviorParams by hand.
      behaviorParams: { ...template.behaviorParams, direction: spawner.moveDirection, speed: spawner.moveSpeed },
      health: template.health,
      damage: template.damage,
      scoreValue: template.scoreValue,
      size: sizeOverride ?? template.size,
    };
    const themedSpec = { ...rawSpec, sprite: resolveEntitySprite(this.theme, rawSpec) };
    const entity = createEntity(this.scene, themedSpec) as Enemy;
    const group = entity instanceof Boss ? this.bossesGroup : this.enemiesGroup;
    group.add(entity);
    this.spawned.set(entity, group);
  }

  // A reward for passing through the gap, not a hazard — reuses ordinary
  // pickup collection (CollisionSystem's existing coin-touch path) rather
  // than inventing a new "gap passed" scoring mechanism. Pickups aren't
  // behavior-driven (SceneInterpreter's per-frame loop only runs behaviors
  // on enemies/bosses), so its velocity is set once here rather than every
  // frame — Arcade physics carries a body at constant velocity on its own
  // once set, no per-frame re-application needed.
  private spawnGapPickup(spawner: SpawnerSpec, position: { x: number; y: number }, scoreValue: number): void {
    const rawSpec: EntitySpec = {
      id: `${spawner.id}_gap_${this.spawnCounter++}`,
      type: 'pickup',
      sprite: 'pickup_coin',
      position,
      pickupType: 'coin',
      value: scoreValue,
    };
    const themedSpec = { ...rawSpec, sprite: resolveEntitySprite(this.theme, rawSpec) };
    const pickup = createEntity(this.scene, themedSpec) as Pickup;
    this.pickupsGroup.add(pickup);
    const vec = DIRECTION_VECTORS[spawner.moveDirection];
    (pickup.body as Phaser.Physics.Arcade.Body).setVelocity(vec.x * spawner.moveSpeed, vec.y * spawner.moveSpeed);
    this.spawned.set(pickup, this.pickupsGroup);
  }

  private despawnOffBounds(): void {
    for (const [entity, group] of this.spawned) {
      // Already gone some other way (a gap pickup actually collected, most
      // commonly) — CollisionSystem's own removal already handled it, this
      // just stops tracking a now-invalid reference.
      if (!entity.active) {
        this.spawned.delete(entity);
        continue;
      }
      const offBounds =
        entity.x < -DESPAWN_MARGIN ||
        entity.x > this.worldWidth + DESPAWN_MARGIN ||
        entity.y < -DESPAWN_MARGIN ||
        entity.y > this.worldHeight + DESPAWN_MARGIN;
      if (offBounds) {
        group.remove(entity, true, true);
        this.spawned.delete(entity);
      }
    }
  }
}
