import type Phaser from 'phaser';
import type { EntitySpec, EntityType } from '../spec/types';
import { BaseEntity } from './BaseEntity';
import { Boss } from './Boss';
import { Enemy } from './Enemy';
import { NPC } from './NPC';
import { Pickup } from './Pickup';
import { Trigger } from './Trigger';

// The interpreter never `new`s an entity class directly — it goes through
// here so adding a new entity type means touching exactly one place.
//
// Typing this as Record<EntityType, EntityCtor> (rather than Record<string,
// ...>) makes the compiler enforce that this map implements *exactly* the
// closed EntityType union from spec/types.ts — adding a literal there
// without registering it here (or vice versa) fails `npm run typecheck`.
// That's what lets validate.ts check reference integrity against the
// Phaser-free ENTITY_TYPES array in spec/types.ts instead of importing this
// module (and therefore Phaser, which can't load outside a browser/DOM).
type EntityCtor = new (scene: Phaser.Scene, spec: EntitySpec) => BaseEntity;

const REGISTRY: Record<EntityType, EntityCtor> = {
  enemy: Enemy,
  boss: Boss,
  pickup: Pickup,
  npc: NPC,
  trigger: Trigger,
};

export function createEntity(scene: Phaser.Scene, spec: EntitySpec): BaseEntity {
  const Ctor = REGISTRY[spec.type];
  if (!Ctor) {
    throw new Error(
      `Unknown entity type "${spec.type}" for entity "${spec.id}". Known types: ${Object.keys(REGISTRY).join(', ')}`,
    );
  }
  return new Ctor(scene, spec);
}
