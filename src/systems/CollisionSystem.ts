import Phaser from 'phaser';
import { playFireFlash } from '../anim/fireFlash';
import type { BaseEntity } from '../entities/BaseEntity';
import type { NPC } from '../entities/NPC';
import type { Pickup } from '../entities/Pickup';
import type { Player } from '../entities/Player';
import type { Projectile } from '../entities/Projectile';
import type { Trigger } from '../entities/Trigger';
import { floatingText, pickupPop } from '../fx/pickupPop';
import { GameEvents } from './GameEvents';
import type { InventorySystem } from './InventorySystem';
import type { ProjectileManager } from './ProjectileManager';
import type { ScoreSystem } from './ScoreSystem';
import type { WinConditionSystem } from './WinConditionSystem';

export interface CollisionGroups {
  walls: Phaser.Physics.Arcade.StaticGroup;
  enemies: Phaser.Physics.Arcade.Group;
  bosses: Phaser.Physics.Arcade.Group;
  pickups: Phaser.Physics.Arcade.Group;
  npcs: Phaser.Physics.Arcade.Group;
  triggers: Phaser.Physics.Arcade.Group;
}

// Wires every overlap/collider for the level once, in `setup`. Every
// callback here stays a thin "apply the effect" — scoring, inventory and
// cleanup are delegated to the relevant system so this file only answers
// "what touches what".
export class CollisionSystem {
  constructor(
    private scene: Phaser.Scene,
    private player: Player,
    private groups: CollisionGroups,
    private projectiles: ProjectileManager,
    private score: ScoreSystem,
    private inventory: InventorySystem,
    private winCondition: WinConditionSystem,
  ) {}

  setup(): void {
    const { scene, player, groups, projectiles } = this;

    scene.physics.add.collider(player, groups.walls);
    scene.physics.add.collider(groups.enemies, groups.walls);
    scene.physics.add.collider(groups.bosses, groups.walls);
    scene.physics.add.collider(groups.enemies, groups.enemies);
    scene.physics.add.collider(projectiles.group, groups.walls, (obj) => {
      (obj as Projectile).deactivate();
    });

    scene.physics.add.overlap(player, groups.enemies, (_p, enemy) => this.onPlayerTouchHostile(enemy as BaseEntity));
    scene.physics.add.overlap(player, groups.bosses, (_p, boss) => this.onPlayerTouchHostile(boss as BaseEntity));

    scene.physics.add.overlap(player, groups.pickups, (_p, pickup) => this.onPlayerTouchPickup(pickup as Pickup));

    scene.physics.add.overlap(player, groups.triggers, (_p, trigger) => this.onPlayerTouchTrigger(trigger as Trigger));

    scene.physics.add.overlap(player, groups.npcs, (_p, npc) => this.onPlayerTouchNpc(npc as NPC));

    scene.physics.add.overlap(
      projectiles.group,
      groups.enemies,
      (proj, enemy) => this.onProjectileHitEnemy(proj as Projectile, enemy as BaseEntity),
      (proj) => (proj as Projectile).owner === 'player',
    );
    scene.physics.add.overlap(
      projectiles.group,
      groups.bosses,
      (proj, boss) => this.onProjectileHitEnemy(proj as Projectile, boss as BaseEntity),
      (proj) => (proj as Projectile).owner === 'player',
    );
    scene.physics.add.overlap(
      projectiles.group,
      player,
      (proj) => this.onProjectileHitPlayer(proj as Projectile),
      (proj) => (proj as Projectile).owner === 'enemy',
    );
  }

  private onPlayerTouchHostile(hostile: BaseEntity): void {
    if (hostile.dead || hostile.damage <= 0) return;
    this.player.takeDamage(hostile.damage);
    this.scene.events.emit(GameEvents.HealthChanged, this.player.health, this.player.maxHealth);
  }

  private onPlayerTouchPickup(pickup: Pickup): void {
    if (pickup.dead) return;
    pickup.dead = true;
    (pickup.body as Phaser.Physics.Arcade.Body).enable = false; // stop overlapping again before the pop finishes

    switch (pickup.pickupType) {
      case 'coin':
        this.score.add(pickup.value);
        floatingText(this.scene, pickup.x, pickup.y, `+${pickup.value}`, '#ffd93d');
        break;
      case 'health':
        this.player.heal(pickup.value);
        this.scene.events.emit(GameEvents.HealthChanged, this.player.health, this.player.maxHealth);
        floatingText(this.scene, pickup.x, pickup.y, `+${pickup.value} HP`, '#7ee787');
        break;
      case 'item':
      case 'key':
        this.inventory.add(pickup.entityId, pickup.value);
        break;
    }

    // Owns the pickup's full post-collection lifecycle itself — pop, then
    // deactivate and remove from its group — rather than just hiding it and
    // relying on HealthSystem's combat-death sweep to clean it up later
    // (which it used to, despite a collected pickup having nothing to do
    // with HP/combat; that coupling is gone now that pickups have their
    // own visual-effect lifecycle to run first).
    pickupPop(pickup, this.scene, () => {
      pickup.setActive(false).setVisible(false);
      this.groups.pickups.remove(pickup, true, true);
    });
  }

  private onPlayerTouchTrigger(trigger: Trigger): void {
    if (trigger.fired && trigger.triggerType !== 'message') return;
    trigger.fired = true;
    this.winCondition.handleTrigger(trigger.triggerType, trigger.entityId, trigger.message);
  }

  private onPlayerTouchNpc(npc: NPC): void {
    if (!npc.message) return;
    this.scene.events.emit(GameEvents.Message, npc.message);
  }

  private onProjectileHitEnemy(proj: Projectile, enemy: BaseEntity): void {
    if (!proj.active || enemy.dead) return;
    proj.deactivate();
    enemy.takeDamage(proj.damage);
  }

  private onProjectileHitPlayer(proj: Projectile): void {
    if (!proj.active) return;
    proj.deactivate();
    this.player.takeDamage(proj.damage);
    this.scene.events.emit(GameEvents.HealthChanged, this.player.health, this.player.maxHealth);
  }

  meleeAttack(): void {
    const { player, groups } = this;
    if (!player.attack || player.attack.type !== 'melee') return;
    const range = player.attack.range;
    const targets: BaseEntity[] = [
      ...(groups.enemies.getChildren() as BaseEntity[]),
      ...(groups.bosses.getChildren() as BaseEntity[]),
    ];
    for (const target of targets) {
      if (target.dead) continue;
      const dist = Phaser.Math.Distance.Between(player.x, player.y, target.x, target.y);
      if (dist <= range) {
        target.takeDamage(player.attack.damage);
      }
    }
  }

  rangedAttack(): void {
    const { player, projectiles } = this;
    if (!player.attack || player.attack.type !== 'ranged') return;
    const speed = player.attack.projectileSpeed ?? 300;
    const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[player.facing];
    projectiles.spawn(
      player.x + dir[0] * 20,
      player.y + dir[1] * 20,
      dir[0] * speed,
      dir[1] * speed,
      'player',
      player.attack.damage,
      player.attack.projectileSprite,
    );
    playFireFlash(player, player.baseSpriteKey);
  }
}
