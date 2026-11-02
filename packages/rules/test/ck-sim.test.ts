/**
 * Whole simulated Cities & Knights games for 3, 4, 5 and 6 players with
 * progress-card play disabled (P3): each finishes with a 13-point winner and
 * conserves every supply — resources, commodities, the 54 progress cards and
 * the pieces (CK25 pp. 2–3, CK56-25 pp. 2–3).
 */

import { describe, expect, it } from 'vitest';
import { neighborsOfVertex, scoreOf, topologyOf } from '../src/analysis.ts';
import { getProfile } from '../src/profiles.ts';
import { PROGRESS_DECKS, TRACKS, trackOfCard } from '../src/modules/citiesKnights/constants.ts';
import { ckView } from '../src/modules/citiesKnights/state.ts';
import { COMMODITIES, RESOURCES, type GameState } from '../src/types.ts';
import { simulateCitiesKnights } from './ck-sim.ts';

function checkSupplies(state: GameState): void {
  const profile = getProfile(state.profileId)!;
  for (const resource of RESOURCES) {
    const total = state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
    expect(total, resource).toBe(profile.bankPerResource);
  }
  for (const commodity of COMMODITIES) {
    const total = state.commodityBank[commodity] + state.players.reduce((sum, player) => sum + player.commodities[commodity], 0);
    expect(total, commodity).toBe(profile.commodityBankPerType);
  }
  const view = ckView(state);
  for (const track of TRACKS) {
    const held = state.players.flatMap((player) => [...player.progressCards, ...(view.progressVp[player.id] ?? [])]).filter((card) => trackOfCard(card) === track);
    const all = [...state.progressDecks[track], ...held].sort();
    expect(all, track).toEqual(PROGRESS_DECKS[track].slice().sort());
  }
}

function checkPieces(state: GameState): void {
  const profile = getProfile(state.profileId)!;
  const topo = topologyOf(state);
  const view = ckView(state);
  state.board.buildings.forEach((building, vertex) => {
    if (!building) return;
    for (const neighbor of neighborsOfVertex(topo, vertex)) expect(state.board.buildings[neighbor]).toBeNull();
    expect(view.knights.some((knight) => knight.vertex === vertex)).toBe(false);
  });
  for (const player of state.players) {
    const mine = state.board.buildings.filter((building) => building?.player === player.id);
    // A toppled city stands in for a settlement piece (CK25 p. 11).
    const toppled = view.toppled.filter((vertex) => state.board.buildings[vertex]?.player === player.id).length;
    expect(mine.filter((building) => !building!.city).length - toppled).toBeLessThanOrEqual(profile.pieces.settlements);
    expect(mine.filter((building) => building!.city).length).toBeLessThanOrEqual(profile.pieces.cities);
    const knights = view.knights.filter((knight) => knight.player === player.id);
    expect(knights.length).toBeLessThanOrEqual(profile.pieces.knights);
    for (const level of [1, 2, 3]) expect(knights.filter((knight) => knight.level === level).length).toBeLessThanOrEqual(2);
    expect(player.cityWalls).toBeLessThanOrEqual(3);
    expect(player.improvements.science + player.improvements.trade + player.improvements.politics).toBeLessThanOrEqual(15);
  }
  for (const vertex of view.walls) expect(state.board.buildings[vertex]?.city).toBe(true);
  const knightVertices = view.knights.map((knight) => knight.vertex);
  expect(new Set(knightVertices).size).toBe(knightVertices.length);
  for (const track of TRACKS) {
    const metropolis = view.metropolises[track];
    if (!metropolis) continue;
    const building = state.board.buildings[metropolis.vertex];
    expect(building?.city && building.player === metropolis.player).toBe(true);
    expect(state.players.find((player) => player.id === metropolis.player)!.improvements[track]).toBeGreaterThanOrEqual(4);
  }
  const metropolisVertices = TRACKS.map((track) => view.metropolises[track]?.vertex).filter((vertex) => vertex !== undefined);
  expect(new Set(metropolisVertices).size).toBe(metropolisVertices.length);
}

describe('simulated Cities & Knights games (progress play disabled)', () => {
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
});
