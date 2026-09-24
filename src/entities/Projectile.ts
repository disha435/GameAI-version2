import Phaser from 'phaser';

export type ProjectileOwner = 'player' | 'enemy';

// Projectiles are pooled per-scene by CollisionSystem/behaviors rather than
// created ad hoc, but the class itself stays a plain Arcade sprite so it can
// be added to any Phaser physics group.
export class Projectile extends Phaser.Physics.Arcade.Sprite {
  public owner: ProjectileOwner = 'enemy';
  public damage = 1;

  constructor(scene: Phaser.Scene, x: number, y: number, sprite: string) {
    super(scene, x, y, sprite);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    (this.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
  }

  fire(x: number, y: number, vx: number, vy: number, owner: ProjectileOwner, damage: number): void {
    this.owner = owner;
    this.damage = damage;
    this.setPosition(x, y);
    this.setActive(true);
    this.setVisible(true);
    (this.body as Phaser.Physics.Arcade.Body).enable = true;
    this.setVelocity(vx, vy);
  }

  deactivate(): void {
    this.setActive(false);
    this.setVisible(false);
    this.setVelocity(0, 0);
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (body) body.enable = false;
  }
}
