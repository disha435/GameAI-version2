import type Phaser from 'phaser';
import type { BaseEntity } from '../entities/BaseEntity';
import type { Player } from '../entities/Player';
import { deathTween } from '../fx/deathTween';
import { GameEvents } from './GameEvents';
import type { ScoreSystem } from './ScoreSystem';

// Sweeps killable groups (enemies/bosses — pickup collection is its own
// lifecycle, owned end-to-end by CollisionSystem, see onPlayerTouchPickup)
// once per frame for entities that crossed the health <= 0 threshold
// (BaseEntity.takeDamage sets `dead` but never destroys itself —
// destruction/score/events are HealthSystem's job so CollisionSystem's
// overlap callbacks stay pure "apply damage" calls).
export class HealthSystem {
  constructor(
    private scene: Phaser.Scene,
    private score: ScoreSystem,
  ) {}

  update(killableGroups: Phaser.Physics.Arcade.Group[]): void {
    for (const group of killableGroups) {
      for (const child of group.getChildren().slice()) {
        const entity = child as BaseEntity;
        // `dying` guards against restarting the tween every frame between
        // now and when its onComplete actually removes the entity from
        // `group` — until then, `dead` stays true and this loop keeps
        // seeing it.
        if (entity.dead && !entity.dying) {
          entity.dying = true;
          this.score.add(entity.scoreValue);
          this.scene.events.emit(GameEvents.EntityKilled, entity.entityId, entity.entityType);
          const body = entity.body as Phaser.Physics.Arcade.Body;
          body.enable = false; // stop colliding/getting pushed around while it fades out
          deathTween(entity, this.scene, () => group.remove(entity, true, true));
        }
      }
    }
  }

  checkPlayerDeath(player: Player): void {
    if (player.health <= 0) {
      this.scene.events.emit(GameEvents.Lose, 'defeated');
    }
  }
}
