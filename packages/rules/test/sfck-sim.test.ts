/**
 * Whole simulated Seafarers + Cities & Knights games (Heading for New Shores)
 * for 3, 4, 5 and 6 players: each finishes with a 16-point winner (COMB-7)
 * and conserves every supply — resources, commodities, the 54 progress
 * cards, buildings, knights, 15 roads and 15 ships (CK25 pp. 2–3, SF25 p. 2).
 */

import { describe, expect, it } from 'vitest';
import { countRoads, scoreOf, topologyOf } from '../src/analysis.ts';
import { ckView } from '../src/modules/citiesKnights/state.ts';
import { getProfile } from '../src/profiles.ts';
import { countShips } from '../src/modules/seafarers/ships.ts';
import type { GameState } from '../src/types.ts';
import { checkPieces, checkSupplies } from './ck-checks.ts';
import { simulateSeafarersCitiesKnights } from './sfck-sim.ts';

function checkRoutes(state: GameState): void {
  const profile = getProfile(state.profileId)!;
  for (const player of state.players) {
    expect(countRoads(state, player.id)).toBeLessThanOrEqual(profile.pieces.roads);
    expect(countShips(state, player.id)).toBeLessThanOrEqual(profile.pieces.ships!);
  }
  // Every knight still touches a road or ship of its colour (COMB-4, CK12-6).
  const topo = topologyOf(state);
  for (const knight of ckView(state).knights) {
    expect(topo.vertices[knight.vertex]!.edges.some((edge) => state.board.roads[edge]?.player === knight.player), `knight at ${knight.vertex}`).toBe(true);
  }
}

describe('simulated Seafarers + Cities & Knights games', () => {
  // Seeds picked so that every game also earns an island bonus.
  for (const [players, seed] of [[3, 4], [4, 4], [5, 1], [6, 2]] as const) {
    it(`${players} players finish with a 16-point winner and conserved supplies`, () => {
      const { state, counters, sea } = simulateSeafarersCitiesKnights(players, seed);
      expect(state.result?.reason).toBe('victory');
      expect(getProfile(state.profileId)!.victoryTarget).toBe(16);
      expect(scoreOf(state, state.result!.playerId!, { includeHidden: true })).toBeGreaterThanOrEqual(16);
      checkSupplies(state);
      checkPieces(state);
      checkRoutes(state);
      // Both expansions were exercised.
      expect(counters.attacks).toBeGreaterThan(0);
      expect(counters.knightsRecruited).toBeGreaterThan(0);
      expect(counters.progressPlayed).toBeGreaterThan(0);
      expect(counters.improvements).toBeGreaterThan(0);
      expect(sea.shipsBuilt).toBeGreaterThan(0);
      expect(sea.islandBonuses).toBeGreaterThan(0);
    }, 180_000);
  }

  it('across seeds the games reach gold, ship moves, the pirate and its chase', () => {
    const totals = { gold: 0, moved: 0, pirate: 0, chased: 0, merchant: 0 };
    for (const [players, seed] of [[4, 1], [5, 1], [3, 2]] as const) {
      const { state, counters, sea } = simulateSeafarersCitiesKnights(players, seed);
      expect(state.result?.reason).toBe('victory');
      checkSupplies(state);
      checkPieces(state);
      checkRoutes(state);
      totals.gold += sea.goldChoices;
      totals.moved += sea.shipsMoved;
      totals.pirate += sea.pirateMoves;
      totals.chased += sea.pirateChased;
      totals.merchant += counters.merchantPlaced;
    }
    for (const [key, value] of Object.entries(totals)) expect(value, key).toBeGreaterThan(0);
  }, 360_000);
});
