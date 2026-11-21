/**
 * `tb-rivers` 的子 kit：
 * - conservation：每人最多 `BRIDGES_PER_PLAYER` 座橋，橋只蓋在橋位上（rules `tb-rivers.test.ts` 的模擬局斷言）。
 * - mechanics（Q2，§6.3）：策略發出、被接受的 `tb.buildBridge`，依難度分（`bridge.standard`、`bridge.easy`）。
 * Rivers 沒有隱藏資訊（橋、河與 gold 都公開），所以沒有 `hideDifferently`；gold 的擾動在 coins 的 kit。
 */

import { BRIDGES_PER_PLAYER, type GameState } from '@katan/rules';
import type { MechanicsTally } from '../types.ts';
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

function mechanics(): MechanicsTally {
  const counts: Record<string, number> = {};
  return {
    observe(step) {
      if (step.source !== 'policy' || step.command.type !== 'tb.buildBridge') return;
      counts[`bridge.${step.level}`] = (counts[`bridge.${step.level}`] ?? 0) + 1;
    },
    snapshot: () => ({ ...counts }),
  };
}

export const riversPartKit: TbPartKit = { id: 'tb-rivers', conservation, mechanics };
