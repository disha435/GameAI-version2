import type { BehaviorName, EntitySpec, PickupType, Theme } from '../spec/types';
import { ASSET_KEYS, type AssetKey } from './assetKeys';

// The real schema has no "entity subtype" concept distinct from `type` +
// `behavior` — themes are keyed off those, not an abstract role enum that
// doesn't exist here. `Record<BehaviorName, AssetKey>` (not Partial) forces
// every theme to map every behavior — the same compile-checked-completeness
// idiom as MovementRegistry/CameraRegistry: adding a theme without fully
// populating it is a type error, not a silent runtime gap.
export interface ThemeAssets {
  tileset: AssetKey;
  player: AssetKey;
  boss: AssetKey;
  enemyByBehavior: Record<BehaviorName, AssetKey>;
  pickupByType: Record<PickupType, AssetKey>;
}

// Design decision, made explicitly rather than left to default: pickups and
// the boss reuse the *same* sprite across both themes below, because no
// theme-specific pickup/boss art exists in AssetLibrary.ts yet — Tier 3
// does zero new art/animation work, it only reorganizes what Tier 0-2
// already drew. That's a real, visible gap (a "space" boss still looks
// like the generic purple boss, not a ship) — flagged here and in the
// README rather than silently accepted, and it's exactly the kind of thing
// a future asset-expansion pass would fill in without touching this
// registry's shape at all.
export const ThemeRegistry: Record<Theme, ThemeAssets> = {
  dungeon: {
    tileset: ASSET_KEYS.tileGround,
    player: ASSET_KEYS.player,
    boss: ASSET_KEYS.boss,
    enemyByBehavior: {
      patrol: ASSET_KEYS.enemyPatrol,
      chase: ASSET_KEYS.enemyChase,
      flee: ASSET_KEYS.enemyChase,
      melee: ASSET_KEYS.enemyChase,
      flying_sine: ASSET_KEYS.enemyFlyer,
      shooter: ASSET_KEYS.enemyShooter,
      stationary: ASSET_KEYS.enemyPatrol,
      fall_and_despawn: ASSET_KEYS.enemyPatrol, // no dedicated hazard/rock sprite yet — see comment above
    },
    pickupByType: {
      coin: ASSET_KEYS.pickupCoin,
      health: ASSET_KEYS.pickupHealth,
      item: ASSET_KEYS.pickupItem,
      key: ASSET_KEYS.pickupItem,
    },
  },
  space: {
    tileset: ASSET_KEYS.tileSpace,
    player: ASSET_KEYS.playerShip,
    boss: ASSET_KEYS.boss, // no dedicated space boss sprite yet — see comment above
    enemyByBehavior: {
      patrol: ASSET_KEYS.enemyShipA,
      chase: ASSET_KEYS.enemyShipB,
      flee: ASSET_KEYS.enemyShipA,
      melee: ASSET_KEYS.enemyShipB,
      flying_sine: ASSET_KEYS.enemyShipA,
      shooter: ASSET_KEYS.enemyShipB,
      stationary: ASSET_KEYS.enemyShipA,
      fall_and_despawn: ASSET_KEYS.enemyShipA, // no dedicated hazard/debris sprite yet — see comment above
    },
    pickupByType: {
      coin: ASSET_KEYS.pickupCoin, // no theme-specific pickup art yet either — see comment above
      health: ASSET_KEYS.pickupHealth,
      item: ASSET_KEYS.pickupItem,
      key: ASSET_KEYS.pickupItem,
    },
  },
};

// Design decision, made explicitly: theme always wins over whatever the
// spec's own `sprite`/`pickupType`-implied sprite says, for every role it
// covers (player, boss, enemy-by-behavior, pickup-by-type). This is what
// makes "theme: space, sprite: forest_monster" — a real inconsistency this
// tier would otherwise introduce — impossible to actually render, without
// needing a Gate 2 check for it: the mismatch can exist in the spec's JSON,
// but it never reaches the screen. `sprite` stays in the schema unchanged
// (still validated against the full asset registry by Gate 2) rather than
// being removed, so every existing spec/test/fallback stays valid; it's
// just no longer the final word for the roles ThemeRegistry covers. NPCs
// and triggers are NOT covered (no theme-specific art exists for them, and
// they're narrative/structural rather than thematically loaded) — their
// explicit `sprite` value always renders as-is, unchanged from before this
// tier.
export function resolveEntitySprite(theme: Theme, spec: EntitySpec): string {
  const assets = ThemeRegistry[theme];
  if (spec.type === 'boss') return assets.boss;
  if (spec.type === 'enemy' && spec.behavior) return assets.enemyByBehavior[spec.behavior];
  if (spec.type === 'pickup' && spec.pickupType) return assets.pickupByType[spec.pickupType];
  return spec.sprite;
}

export function resolvePlayerSprite(theme: Theme): string {
  return ThemeRegistry[theme].player;
}

export function resolveTileset(theme: Theme): string {
  return ThemeRegistry[theme].tileset;
}
