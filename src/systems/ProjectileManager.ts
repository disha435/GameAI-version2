import Phaser from 'phaser';
import { Projectile, type ProjectileOwner } from '../entities/Projectile';
import { spawnTrailGhost } from '../fx/projectileTrail';

const POOL_SIZE = 32;
const OFFSCREEN_MARGIN = 64;

// Owns a fixed-size pool of Projectile sprites shared by every shooter
// enemy and the player's ranged attack, so firing never allocates. Behaviors
// and the player attack call `spawn`; SceneInterpreter calls `update` once
// per frame to reclaim anything that flew off the world.
export class ProjectileManager {
  public readonly group: Phaser.Physics.Arcade.Group;
  private pool: Projectile[] = [];
  private worldWidth: number;
  private worldHeight: number;

  constructor(scene: Phaser.Scene, worldWidth: number, worldHeight: number) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.group = scene.physics.add.group({ runChildUpdate: false });
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = new Projectile(scene, -1000, -1000, 'projectile');
      p.deactivate();
      this.group.add(p);
      this.pool.push(p);
    }
  }

  spawn(x: number, y: number, vx: number, vy: number, owner: ProjectileOwner, damage: number, sprite = 'projectile'): void {
    const free = this.pool.find((p) => !p.active);
    if (!free) return;
    free.setTexture(sprite);
    free.fire(x, y, vx, vy, owner, damage);
  }

  update(): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      spawnTrailGhost(p.scene, p.x, p.y, p.texture.key);
      if (p.x < -OFFSCREEN_MARGIN || p.x > this.worldWidth + OFFSCREEN_MARGIN || p.y < -OFFSCREEN_MARGIN || p.y > this.worldHeight + OFFSCREEN_MARGIN) {
        p.deactivate();
      }
    }
  }
}
