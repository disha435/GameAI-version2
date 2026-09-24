// Central event name registry. Systems talk to each other and to the HUD
// exclusively through scene.events with these names — nothing holds a direct
// reference to another system beyond what's needed to set up collisions.
export const GameEvents = {
  ScoreChanged: 'score:changed',
  InventoryChanged: 'inventory:changed',
  HealthChanged: 'health:changed',
  EntityKilled: 'entity:killed',
  Win: 'game:win',
  Lose: 'game:lose',
  Message: 'game:message',
} as const;
