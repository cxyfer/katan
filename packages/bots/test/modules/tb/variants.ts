/**
 * 變體的子 kit。Friendly Robber 沒有自己的狀態；Harbors 的 Strongest Ports 持有者必須是在場的玩家，而且港口建築分數
 * 至少 `STRONGEST_PORTS_MINIMUM`（持有者跌破下限時板塊回到中央）。
 */

import { STRONGEST_PORTS_MINIMUM, topologyOf, type GameState } from '@catan/rules';
import { partStateOf, type TbPartKit } from './part.ts';

interface HarborsSlot {
  holder: string | null;
}

/** 港口路口上的建築分數（與 rules 的 `portPoints` 相同）。 */
function portPoints(state: GameState, playerId: string): number {
  const topology = topologyOf(state);
  const vertices = new Set<number>();
  for (const harbor of state.board.layout.harbors) for (const vertex of topology.edges[harbor.edge]?.vertices ?? []) vertices.add(vertex);
  let points = 0;
  for (const vertex of vertices) {
    const building = state.board.buildings[vertex];
    if (building?.player === playerId) points += building.city ? 2 : 1;
  }
  return points;
}

function harborsConservation(state: GameState): readonly string[] {
  const holder = partStateOf<HarborsSlot>(state, 'harbors')?.holder ?? null;
  if (holder === null) return [];
  if (!state.players.some((player) => player.id === holder)) return [`Strongest Ports holder ${holder} is not seated`];
  const points = portPoints(state, holder);
  return points >= STRONGEST_PORTS_MINIMUM ? [] : [`Strongest Ports holder ${holder} has ${points} < ${STRONGEST_PORTS_MINIMUM} port points`];
}

export const friendlyRobberPartKit: TbPartKit = { id: 'friendly-robber' };
export const harborsPartKit: TbPartKit = { id: 'harbors', conservation: harborsConservation };
