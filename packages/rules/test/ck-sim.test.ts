/**
 * Whole simulated Cities & Knights games for 3, 4, 5 and 6 players that play
 * progress cards and answer their frames: each finishes with a 13-point winner
 * and conserves every supply — resources, commodities, the 54 progress cards
 * and the pieces (CK25 pp. 2–3, CK56-25 pp. 2–3).
 */

import { describe, expect, it } from 'vitest';
import { scoreOf } from '../src/analysis.ts';
import { getProfile } from '../src/profiles.ts';
import { CARD_RULES } from '../src/modules/citiesKnights/cards.ts';
import { checkPieces, checkSupplies } from './ck-checks.ts';
import { simulateCitiesKnights } from './ck-sim.ts';

describe('simulated Cities & Knights games', () => {
  for (const players of [3, 4, 5, 6] as const) {
    it(`${players} players finish with a 13-point winner and conserved supplies`, () => {
      const { state, counters } = simulateCitiesKnights(players, 11 + players);
      expect(state.result?.reason).toBe('victory');
      expect(getProfile(state.profileId)!.victoryTarget).toBe(13);
      expect(scoreOf(state, state.result!.playerId!, { includeHidden: true })).toBeGreaterThanOrEqual(13);
      checkSupplies(state);
      checkPieces(state);
      // The game actually exercised the expansion.
      expect(counters.events).toBeGreaterThan(0);
      expect(counters.attacks).toBeGreaterThan(0);
      expect(counters.knightsRecruited).toBeGreaterThan(0);
      expect(counters.knightsActivated).toBeGreaterThan(0);
      expect(counters.progressDrawn).toBeGreaterThan(0);
      expect(counters.commodities).toBeGreaterThan(0);
      expect(counters.improvements).toBeGreaterThan(0);
      expect(counters.progressPlayed).toBeGreaterThan(0);
    }, 120_000);
  }

  it('across seeds the simulation reaches metropolises, walls, pillage and knight actions', () => {
    const totals = { metropolises: 0, walls: 0, pillaged: 0, defenders: 0, promoted: 0, moved: 0, displaced: 0, chased: 0, discards: 0 };
    for (const seed of [1, 2, 3]) {
      const { state, counters } = simulateCitiesKnights(4, seed);
      expect(state.result?.reason).toBe('victory');
      checkSupplies(state);
      checkPieces(state);
      totals.metropolises += counters.metropolises;
      totals.walls += counters.walls;
      totals.pillaged += counters.pillaged;
      totals.defenders += counters.defenders;
      totals.promoted += counters.knightsPromoted;
      totals.moved += counters.knightsMoved;
      totals.displaced += counters.knightsDisplaced;
      totals.chased += counters.robberChased;
      totals.discards += counters.progressDiscards;
    }
    // Displacement needs two networks to meet; R-CK fixtures cover it (ck-knights.test.ts).
    for (const [key, value] of Object.entries(totals)) if (key !== 'displaced') expect(value, key).toBeGreaterThan(0);
  }, 240_000);

  it('across seeds every progress card type is played, with Alchemy, harbor exchanges and the merchant', () => {
    const played = new Set<string>();
    const totals = { alchemy: 0, harbor: 0, merchant: 0, frames: 0 };
    for (const [players, seed] of [[4, 42], [5, 52], [5, 53]] as const) {
      const { state, counters } = simulateCitiesKnights(players, seed);
      expect(state.result?.reason).toBe('victory');
      checkSupplies(state);
      checkPieces(state);
      for (const card of counters.played) played.add(card);
      totals.alchemy += counters.alchemy;
      totals.harbor += counters.harborExchanges;
      totals.merchant += counters.merchantPlaced;
      totals.frames += counters.cardFrames;
    }
    expect([...played].sort()).toEqual(Object.keys(CARD_RULES).sort());
    for (const [key, value] of Object.entries(totals)) expect(value, key).toBeGreaterThan(0);
  }, 240_000);
});
