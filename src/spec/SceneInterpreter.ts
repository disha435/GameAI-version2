import Phaser from 'phaser';
import { updateMovementAnimation } from '../anim/movementAnim';
import { generateAnimatedAssets } from '../assets/AnimatedAssetLibrary';
import { generatePlaceholderAssets } from '../assets/AssetLibrary';
import { resolveEntitySprite, resolvePlayerSprite, resolveTileset } from '../assets/ThemeRegistry';
import { runBehavior } from '../behaviors/BehaviorRegistry';
import type { BehaviorContext } from '../behaviors/BehaviorContext';
import { getCameraController } from '../camera/CameraRegistry';
import type { CameraController } from '../camera/CameraController';
import { Boss } from '../entities/Boss';
import { createEntity } from '../entities/EntityRegistry';
import { Enemy } from '../entities/Enemy';
import { NPC } from '../entities/NPC';
import { Pickup } from '../entities/Pickup';
import { Player } from '../entities/Player';
import { Trigger } from '../entities/Trigger';
import { startTumble } from '../fx/tumble';
import { applyMovementModifiers } from '../movement/movementModifiers';
import { getMovementController } from '../movement/MovementRegistry';
import { readInputState, type MovementController } from '../movement/MovementController';
import { CollisionSystem } from '../systems/CollisionSystem';
import { GameEvents } from '../systems/GameEvents';
import { HealthSystem } from '../systems/HealthSystem';
import { InventorySystem } from '../systems/InventorySystem';
import { ProjectileManager } from '../systems/ProjectileManager';
import { ScoreSystem } from '../systems/ScoreSystem';
import { SpawnerSystem } from '../systems/SpawnerSystem';
import { WinConditionSystem } from '../systems/WinConditionSystem';
import type { GameSpec } from './types';
import { validateGameSpec } from './validate';

export interface SceneInterpreterInitData {
  spec: GameSpec;
  // Optional: main.ts's DOM-level end screen hooks in through init data
  // rather than the scene's own event emitter, deliberately — Phaser's
  // SceneManager.add() returns null whenever the SceneManager itself isn't
  // booted yet, which it reliably wasn't immediately after `new
  // Phaser.Game(...)` in practice, so relying on that return value to
  // attach a listener was a real race, not a hypothetical one.
  onGameEnd?: (result: 'win' | 'lose') => void;
}

// The one and only Phaser.Scene subclass in the runtime. It never contains
// game-specific logic — everything it does is driven by the GameSpec it
// receives via `init`. A new game is a new spec, never a new Scene class.
export class SceneInterpreter extends Phaser.Scene {
  private spec!: GameSpec;

  private player!: Player;
  private movementController!: MovementController;
  private cameraController!: CameraController;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private attackKey!: Phaser.Input.Keyboard.Key;

  private wallsGroup!: Phaser.Physics.Arcade.StaticGroup;
  private enemiesGroup!: Phaser.Physics.Arcade.Group;
  private bossesGroup!: Phaser.Physics.Arcade.Group;
  private pickupsGroup!: Phaser.Physics.Arcade.Group;
  private npcsGroup!: Phaser.Physics.Arcade.Group;
  private triggersGroup!: Phaser.Physics.Arcade.Group;

  private spawners!: SpawnerSystem;
  private projectiles!: ProjectileManager;
  private score!: ScoreSystem;
  private inventory!: InventorySystem;
  private health!: HealthSystem;
  private collisions!: CollisionSystem;
  private winCondition!: WinConditionSystem;

  private hudEl: HTMLElement | null = null;
  private ended = false;
  private onGameEnd?: (result: 'win' | 'lose') => void;

  constructor() {
    super('SceneInterpreter');
  }

  init(data: SceneInterpreterInitData): void {
    const { valid, errors } = validateGameSpec(data.spec);
    if (!valid) {
      throw new Error(`Invalid GameSpec:\n- ${errors.map((e) => `${e.path}: ${e.message}`).join('\n- ')}`);
    }
    this.spec = data.spec;
    this.ended = false;
    this.onGameEnd = data.onGameEnd;
  }

  create(): void {
    generatePlaceholderAssets(this);
    generateAnimatedAssets(this);
    this.hudEl = document.getElementById('hud');

    const { world } = this.spec;
    this.physics.world.setBounds(0, 0, world.bounds.width, world.bounds.height);
    this.cameras.main.setBounds(0, 0, world.bounds.width, world.bounds.height);
    this.cameras.main.setBackgroundColor(world.backgroundColor);

    this.buildGround();
    this.wallsGroup = this.physics.add.staticGroup();
    this.buildWalls();

    this.movementController = getMovementController(this.spec.movementType);
    this.movementController.configureWorld(this);

    this.player = new Player(this, { ...this.spec.player, sprite: resolvePlayerSprite(this.spec.theme) });

    // Gravity stays a world-level setting (this codebase has never set it
    // per-body — see movementController.configureWorld() above), so a
    // movementModifiers.gravity override replaces whatever the movementType
    // itself just configured, rather than layering per-body. Absent
    // entirely, this changes nothing: every spec written before
    // movementModifiers existed keeps whatever gravity its own movementType
    // already set.
    const gravityModifier = this.player.movementModifiers?.gravity;
    if (gravityModifier) {
      this.physics.world.gravity.set(0, gravityModifier.enabled ? gravityModifier.magnitude! : 0);
    }
    this.cameraController = getCameraController(this.spec.camera ?? 'follow_player');
    this.cameraController.configure(this, this.player);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up: this.input.keyboard!.addKey('W'),
      down: this.input.keyboard!.addKey('S'),
      left: this.input.keyboard!.addKey('A'),
      right: this.input.keyboard!.addKey('D'),
    };
    this.attackKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.enemiesGroup = this.physics.add.group();
    this.bossesGroup = this.physics.add.group();
    this.pickupsGroup = this.physics.add.group();
    this.npcsGroup = this.physics.add.group();
    this.triggersGroup = this.physics.add.group();

    this.spawnEntities();

    this.spawners = new SpawnerSystem(
      this,
      this.spec.spawners ?? [],
      world.bounds.width,
      world.bounds.height,
      this.spec.theme,
      this.enemiesGroup,
      this.bossesGroup,
      this.pickupsGroup,
    );

    this.projectiles = new ProjectileManager(this, world.bounds.width, world.bounds.height);
    this.score = new ScoreSystem(this);
    this.inventory = new InventorySystem(this);
    this.health = new HealthSystem(this, this.score);
    this.winCondition = new WinConditionSystem(this, this.spec.winCondition, {
      enemies: this.enemiesGroup,
      bosses: this.bossesGroup,
      pickups: this.pickupsGroup,
    }, this.score);

    this.collisions = new CollisionSystem(
      this,
      this.player,
      {
        walls: this.wallsGroup,
        enemies: this.enemiesGroup,
        bosses: this.bossesGroup,
        pickups: this.pickupsGroup,
        npcs: this.npcsGroup,
        triggers: this.triggersGroup,
      },
      this.projectiles,
      this.score,
      this.inventory,
      this.winCondition,
    );
    this.collisions.setup();

    this.events.on(GameEvents.Win, () => {
      this.endGame();
      this.onGameEnd?.('win');
    });
    this.events.on(GameEvents.Lose, () => {
      this.endGame();
      this.onGameEnd?.('lose');
    });
    this.events.on(GameEvents.Message, (msg: string) => this.flashMessage(msg));

    this.renderHud();
  }

  update(time: number, delta: number): void {
    if (this.ended) return;

    const input = readInputState(this.cursors, this.wasd);
    const preUpdateVelocityY = (this.player.body as Phaser.Physics.Arcade.Body).velocity.y;
    this.movementController.update(this.player, input, delta);
    applyMovementModifiers(this.player, input, preUpdateVelocityY);
    this.cameraController.update(this, delta);
    updateMovementAnimation(this.player, this.player.baseSpriteKey);

    if (Phaser.Input.Keyboard.JustDown(this.attackKey) && this.player.canAttack()) {
      this.player.lastAttackAt = time;
      if (this.player.attack?.type === 'melee') this.collisions.meleeAttack();
      else if (this.player.attack?.type === 'ranged') this.collisions.rangedAttack();
    }

    // Before the behavior loop below, not after — anything spawned this
    // frame gets its own first fall_and_despawn tick in the same frame it
    // appears, rather than sitting one frame behind.
    this.spawners.update(delta);

    const ctx: BehaviorContext = { scene: this, player: this.player, now: time, projectiles: this.projectiles };
    for (const group of [this.enemiesGroup, this.bossesGroup]) {
      for (const child of group.getChildren()) {
        const enemy = child as Enemy;
        if (enemy.dead) continue;
        if (enemy.behavior) runBehavior(enemy.behavior, enemy, ctx, delta);
        updateMovementAnimation(enemy, enemy.baseSpriteKey);
      }
    }

    this.projectiles.update();
    this.health.update([this.enemiesGroup, this.bossesGroup]);
    this.health.checkPlayerDeath(this.player);
    this.winCondition.update();

    this.renderHud();
  }

  private buildGround(): void {
    const { world } = this.spec;
    // Whether to show a tiled background at all is still the spec's own
    // choice; which texture to use when it does is theme's, unconditionally
    // — same "theme always wins" precedence as entity sprites, and for the
    // same reason: a spec with theme "space" but a leftover dungeon
    // groundTile value should never actually render dungeon stone.
    if (!world.groundTile) return;
    const tile = resolveTileset(this.spec.theme);
    this.add.tileSprite(0, 0, world.bounds.width, world.bounds.height, tile).setOrigin(0, 0).setDepth(-10);
  }

  private buildWalls(): void {
    for (const wall of this.spec.world.walls ?? []) {
      const rect = this.add.rectangle(
        wall.x + wall.width / 2,
        wall.y + wall.height / 2,
        wall.width,
        wall.height,
        0x57606f,
      );
      this.wallsGroup.add(rect);
      const body = rect.body as Phaser.Physics.Arcade.StaticBody;
      body.setSize(wall.width, wall.height);
    }
  }

  private spawnEntities(): void {
    for (const entitySpec of this.spec.entities) {
      // Theme resolution happens here, before construction — Phaser sets a
      // sprite's texture at construction time, so the final key has to be
      // decided before createEntity ever runs. Everything downstream
      // (BaseEntity, EntityRegistry, individual entity classes) is
      // unchanged and still just trusts `spec.sprite` blindly; the themed
      // override lives in exactly one place.
      const themedSpec = { ...entitySpec, sprite: resolveEntitySprite(this.spec.theme, entitySpec) };
      const entity = createEntity(this, themedSpec);
      if (entity instanceof Boss) this.bossesGroup.add(entity);
      else if (entity instanceof Enemy) this.enemiesGroup.add(entity);
      else if (entity instanceof Pickup) this.pickupsGroup.add(entity);
      else if (entity instanceof NPC) this.npcsGroup.add(entity);
      else if (entity instanceof Trigger) this.triggersGroup.add(entity);

      // flying_sine already means "floats freely, unaffected by ground
      // contact" regardless of theme (a bat, a UFO, a drifting rock,
      // whatever sprite the entity actually got) — a continuous tumble is
      // the generic, behavior-keyed hook for that, not a sprite-specific
      // special case. See fx/tumble.ts.
      if (entity instanceof Enemy && entitySpec.behavior === 'flying_sine') {
        startTumble(entity, this);
      }
    }
  }

  // Stops gameplay only — the win/lose message itself is now the DOM-level
  // end screen main.ts renders via onGameEnd (a real headline + the
  // objective recap + Play Again / New Game actions), not an in-canvas
  // Phaser text object. Drawing both was redundant and the DOM overlay's
  // translucent background let this one bleed through underneath it.
  private endGame(): void {
    this.ended = true;
    this.physics.pause();
  }

  private flashMessage(msg: string): void {
    if (!msg) return;
    const cam = this.cameras.main;
    const text = this.add
      .text(cam.width / 2, cam.height - 60, msg, {
        fontSize: '18px',
        color: '#ffffff',
        fontFamily: 'monospace',
        backgroundColor: '#000000aa',
        padding: { x: 10, y: 6 },
      })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setDepth(1000);
    this.time.delayedCall(2200, () => text.destroy());
  }

  private renderHud(): void {
    if (!this.hudEl) return;
    const hud = this.spec.hud ?? {};
    const lines: string[] = [];
    if (hud.showHealth !== false) lines.push(`HP: ${Math.max(0, this.player.health)}/${this.player.maxHealth}`);
    if (hud.showScore !== false) lines.push(`Score: ${this.score.get()}`);
    if (hud.showInventory) {
      const inv = this.inventory.snapshot();
      const entries = Object.entries(inv);
      if (entries.length) lines.push(`Items: ${entries.map(([k, v]) => `${k}x${v}`).join(', ')}`);
    }
    if (hud.showTimer && this.spec.winCondition.type === 'survive_duration' && this.spec.winCondition.threshold !== undefined) {
      const remaining = Math.max(0, this.spec.winCondition.threshold - this.winCondition.elapsedSeconds());
      lines.push(`Survive: ${remaining.toFixed(1)}s`);
    }
    this.hudEl.textContent = lines.join('\n');
  }
}
