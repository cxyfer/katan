/**
 * The Friendly Robber (TB25 p. 4). The robber may not be moved to a hex with
 * a building of a player who only has 2 VP; with no valid hex it goes to the
 * desert and may only rob players with more than 2 VP there.
 *
 * VP are the public points (hidden Victory Point cards are not visible to
 * the player moving the robber), and "only 2 VP" is read as at most 2.
 */

import { scoreOf, topologyOf } from '../../../analysis.ts';
import { verticesOfHex } from '../../../topology.ts';
import type { GameState } from '../../../types.ts';
import type { TbPart } from '../part.ts';

export const FRIENDLY_ROBBER = 'friendly-robber';

const PROTECTED_MAX = 2;

function isProtected(state: GameState, playerId: string): boolean {
  return scoreOf(state, playerId, { includeHidden: false }) <= PROTECTED_MAX;
}

/** Hexes touching a building of a protected player. */
function protectedHex(state: GameState, hex: number): boolean {
  const topology = topologyOf(state);
  return verticesOfHex(topology, hex).some((vertex) => {
    const building = state.board.buildings[vertex];
    return !!building && isProtected(state, building.player);
  });
}

export const friendlyRobberPart: TbPart = {
  id: FRIENDLY_ROBBER,
  robberTargets(state, _actorId, targets) {
    const allowed = targets.filter((hex) => !protectedHex(state, hex));
    if (allowed.length > 0) return allowed;
    // No valid hex: the robber goes to the desert, even when it stands there.
    return state.board.layout.terrain
      .map((terrain, hex) => (terrain === 'desert' ? hex : -1))
      .filter((hex) => hex >= 0);
  },
  stealCandidates(state, _hex, _actorId, candidates) {
    return candidates.filter((playerId) => !isProtected(state, playerId));
  },
};
