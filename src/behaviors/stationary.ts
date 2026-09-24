import type { Enemy } from '../entities/Enemy';
import type { BehaviorContext } from './BehaviorContext';

export function stationary(entity: Enemy, _ctx: BehaviorContext, _delta: number): void {
  entity.setVelocity(0, 0);
}
