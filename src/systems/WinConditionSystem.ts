import type Phaser from 'phaser';
import type { TriggerType, WinConditionSpec } from '../spec/types';
import { GameEvents } from './GameEvents';
import type { ScoreSystem } from './ScoreSystem';

export interface WinConditionGroups {
  enemies: Phaser.Physics.Arcade.Group;
  bosses: Phaser.Physics.Arcade.Group;
  pickups: Phaser.Physics.Arcade.Group;
}

// Most win conditions are just a per-frame poll over group sizes / score —
// simple and immune to event-ordering bugs. Trigger-based win/lose is the
// one case that has to be discrete (a specific overlap event), so
// CollisionSystem calls `handleTrigger` directly instead of this system
// polling for "is the player standing in a zone".
export class WinConditionSystem {
  private resolved = false;
  private readonly initialBossIds: Set<string>;
  private readonly initialPickupCount: number;
  private readonly initialHostileCount: number;
  // Lazily set on the first real update() tick, NOT captured at
  // construction time — this system is built inside create(), in the same
  // synchronous frame as generatePlaceholderAssets()/generateAnimatedAssets()
  // (which run earlier in that same create() call). scene.time.now is a
  // per-frame snapshot Phaser only refreshes once per game step, not a live
  // clock — so however long create() itself takes to run synchronously
  // (asset baking included) never moves time.now *during* create(), and
  // only shows up as a jump on the NEXT frame's read. Capturing startTime
  // at construction time meant that entire setup cost silently counted as
  // "survived" — confirmed live: a real generated game with a 45s
  // survive_duration threshold won almost immediately, before the player
  // had done anything. Starting the clock on first update() instead means
  // it only ever measures real gameplay time.
  private startTime: number | null = null;

  constructor(
    private scene: Phaser.Scene,
    private spec: WinConditionSpec,
    private groups: WinConditionGroups,
    private score: ScoreSystem,
  ) {
    this.initialBossIds = new Set((groups.bosses.getChildren() as any[]).map((b) => b.entityId));
    this.initialPickupCount = groups.pickups.getLength();
    this.initialHostileCount = groups.enemies.getLength() + groups.bosses.getLength();
  }

  /** Seconds elapsed since the first real update() tick — used by survive_duration and its HUD readout. 0 before that first tick (e.g. the HUD's very first render, called from create() itself). */
  elapsedSeconds(): number {
    if (this.startTime === null) return 0;
    return (this.scene.time.now - this.startTime) / 1000;
  }

  update(): void {
    if (this.startTime === null) this.startTime = this.scene.time.now;
    if (this.resolved) return;

    switch (this.spec.type) {
      case 'defeat_boss': {
        if (this.initialBossIds.size === 0) break; // no boss was ever spawned
        if (this.spec.targetId) {
          const aliveIds = new Set((this.groups.bosses.getChildren() as any[]).map((b) => b.entityId));
          if (!aliveIds.has(this.spec.targetId)) this.win();
        } else if (this.groups.bosses.countActive(true) === 0) {
          this.win();
        }
        break;
      }
      case 'defeat_all_enemies': {
        if (this.initialHostileCount === 0) break; // no enemies were ever spawned
        const hostileCount = this.groups.enemies.countActive(true) + this.groups.bosses.countActive(true);
        if (hostileCount === 0) this.win();
        break;
      }
      case 'collect_all_pickups':
        if (this.initialPickupCount > 0 && this.groups.pickups.countActive(true) === 0) this.win();
        break;
      case 'score_threshold':
        if (this.spec.threshold !== undefined && this.score.get() >= this.spec.threshold) this.win();
        break;
      case 'survive_duration':
        if (this.spec.threshold !== undefined && this.elapsedSeconds() >= this.spec.threshold) this.win();
        break;
      case 'reach_trigger':
        break; // handled via handleTrigger
    }
  }

  handleTrigger(triggerType: TriggerType, triggerId: string, message?: string): void {
    if (this.resolved) return;
    if (triggerType === 'message') {
      this.scene.events.emit(GameEvents.Message, message ?? '');
      return;
    }
    if (triggerType === 'lose') {
      this.lose('trigger');
      return;
    }
    if (triggerType === 'win') {
      if (this.spec.type !== 'reach_trigger') return;
      if (this.spec.targetId && this.spec.targetId !== triggerId) return;
      this.win();
    }
  }

  private win(): void {
    this.resolved = true;
    this.scene.events.emit(GameEvents.Win);
  }

  private lose(reason: string): void {
    this.resolved = true;
    this.scene.events.emit(GameEvents.Lose, reason);
  }
}
