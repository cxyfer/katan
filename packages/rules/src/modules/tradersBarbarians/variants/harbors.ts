/**
 * Harbors of Catan (TB25 p. 4). The Strongest Ports tile (2 VP) goes to the
 * first player with 3 VP in buildings on ports and moves to a player who has
 * strictly more. The profile's target already includes the variant's +1 VP.
 */

import { topologyOf } from '../../../analysis.ts';
import type { GameState } from '../../../types.ts';
import type { TbPart } from '../part.ts';
import { partState, setPartState } from '../state.ts';

export const HARBORS = 'harbors';

const MINIMUM = 3;
export const STRONGEST_PORTS_POINTS = 2;

export interface HarborsState {
  holder: string | null;
}

/** VP each player has in buildings on harbour intersections. */
export function portPoints(state: GameState): Record<string, number> {
  const topology = topologyOf(state);
  const vertices = new Set<number>();
  for (const harbor of state.board.layout.harbors) {
    for (const vertex of topology.edges[harbor.edge]?.vertices ?? []) vertices.add(vertex);
  }
  const out: Record<string, number> = Object.fromEntries(state.players.map((player) => [player.id, 0]));
  for (const vertex of vertices) {
    const building = state.board.buildings[vertex];
    if (building) out[building.player] = (out[building.player] ?? 0) + (building.city ? 2 : 1);
  }
  return out;
}

function holderOf(state: GameState): string | null {
  return partState<HarborsState>(state, HARBORS)?.holder ?? null;
}

export const harborsPart: TbPart = {
  id: HARBORS,
  initGame(state) {
    setPartState<HarborsState>(state, HARBORS, { holder: null });
  },
  afterBuild(state, _build, ctx) {
    const points = portPoints(state);
    const slot = partState<HarborsState>(state, HARBORS) ?? setPartState<HarborsState>(state, HARBORS, { holder: null });
    const current = slot.holder;
    const held = current ? (points[current] ?? 0) : 0;
    let next = current && held >= MINIMUM ? current : null;
    const best = Math.max(...Object.values(points));
    const leaders = Object.keys(points).filter((id) => points[id] === best);
    if (best >= MINIMUM && (!next || best > held) && leaders.length === 1) next = leaders[0]!;
    if (next !== current) {
      slot.holder = next;
      ctx.kit.emit(state, 'tb.strongestPorts', { playerId: next, previous: current, points: next ? points[next] : 0 });
    }
  },
  score(state, playerId) {
    return holderOf(state) === playerId ? STRONGEST_PORTS_POINTS : 0;
  },
  project(state) {
    const points = portPoints(state);
    return { holder: holderOf(state), portPoints: points, minimum: MINIMUM };
  },
};
