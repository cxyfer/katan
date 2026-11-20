/** `tb-rivers` 的子 kit：每人最多 `BRIDGES_PER_PLAYER` 座橋，橋只蓋在橋位上（rules `tb-rivers.test.ts` 的模擬局斷言）。 */

import { BRIDGES_PER_PLAYER, type GameState } from '@catan/rules';
import { partStateOf, type TbPartKit } from './part.ts';

interface RiversSlot {
  bridgeSites: number[];
}

function conservation(state: GameState): readonly string[] {
  const slot = partStateOf<RiversSlot>(state, 'tb-rivers');
  if (!slot) return ['tb-rivers state missing'];
  const problems: string[] = [];
  const sites = new Set(slot.bridgeSites);
  const bridges = new Map<string, number>();
  state.board.roads.forEach((road, edge) => {
    if (!road?.bridge) return;
    bridges.set(road.player, (bridges.get(road.player) ?? 0) + 1);
    if (!sites.has(edge)) problems.push(`bridge on edge ${edge} is not a bridge site`);
  });
  for (const [id, count] of bridges) if (count > BRIDGES_PER_PLAYER) problems.push(`${id} has ${count} bridges > ${BRIDGES_PER_PLAYER}`);
  return problems;
}

export const riversPartKit: TbPartKit = { id: 'tb-rivers', conservation };
