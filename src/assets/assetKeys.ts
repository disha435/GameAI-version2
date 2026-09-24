// Deliberately Phaser-free: this is the reference-integrity source of truth
// for every string a spec can use as a sprite/tile key (player.sprite,
// entities[].sprite, world.groundTile, behaviorParams.projectileSprite,
// player.attack.projectileSprite). validate.ts imports it directly so
// validating a spec never has to load the Phaser/rendering stack — Phaser's
// bundle touches `window` at import time and throws outside a browser/DOM,
// which would otherwise make the "pure JSON in, errors out" validator only
// runnable inside a game engine.
export const ASSET_KEYS = {
  player: 'player',
  enemyPatrol: 'enemy_patrol',
  enemyChase: 'enemy_chase',
  enemyFlyer: 'enemy_flyer',
  enemyShooter: 'enemy_shooter',
  boss: 'boss',
  npc: 'npc',
  pickupCoin: 'pickup_coin',
  pickupHealth: 'pickup_health',
  pickupItem: 'pickup_item',
  projectile: 'projectile',
  tileGround: 'tile_ground',
  tileWall: 'tile_wall',
  triggerZone: 'trigger_zone',
  playerShip: 'player_ship',
  enemyShipA: 'enemy_ship_a',
  enemyShipB: 'enemy_ship_b',
  tileSpace: 'tile_space',
} as const;

export type AssetKey = (typeof ASSET_KEYS)[keyof typeof ASSET_KEYS];

export function getRegisteredAssetKeys(): AssetKey[] {
  return Object.values(ASSET_KEYS);
}
