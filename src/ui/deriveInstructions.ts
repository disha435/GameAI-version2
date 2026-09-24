import type { GameSpec, MovementType, WinConditionSpec } from '../spec/types';

export interface GameInstructions {
  controls: string[];
  objective: string;
}

// Purely derived from fields the spec already has — no new schema/LLM
// vocabulary, same "don't hand-copy what you can derive" discipline as
// buildVocabularyBlock() in server/systemPrompt.ts. Record<MovementType, …>
// forces this to stay complete if a movement type is ever added.
const MOVEMENT_CONTROLS: Record<MovementType, string[]> = {
  topdown_8dir: ['Arrow keys or WASD — move in any direction'],
  platformer_run_jump: ['Arrow keys or A/D — run left and right', 'Up, W, or Space — jump'],
  shmup_freeaxis: ['Arrow keys or WASD — fly freely'],
};

function describeControls(spec: GameSpec): string[] {
  const controls = [...MOVEMENT_CONTROLS[spec.movementType]];
  const attack = spec.player.attack;
  if (attack && attack.type !== 'none') {
    controls.push(attack.type === 'melee' ? 'Space — melee attack' : 'Space — fire a ranged shot');
  }
  return controls;
}

function describeObjective(wc: WinConditionSpec): string {
  switch (wc.type) {
    case 'defeat_boss':
      return 'Defeat the boss.';
    case 'defeat_all_enemies':
      return 'Defeat every enemy.';
    case 'collect_all_pickups':
      return 'Collect every pickup.';
    case 'reach_trigger':
      return 'Reach the goal.';
    case 'score_threshold':
      return `Score at least ${wc.threshold ?? 0} points.`;
    case 'survive_duration': {
      const seconds = wc.threshold ?? 0;
      return `Survive for ${seconds} second${seconds === 1 ? '' : 's'}.`;
    }
    default: {
      const exhaustive: never = wc.type;
      return exhaustive;
    }
  }
}

export function deriveInstructions(spec: GameSpec): GameInstructions {
  return { controls: describeControls(spec), objective: describeObjective(spec.winCondition) };
}
