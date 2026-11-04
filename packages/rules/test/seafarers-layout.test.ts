/**
 * R-SF scenario setup: Heading for New Shores layouts and inventories,
 * checked against the component tables printed next to each map
 * (SF25 p. 4 for 3 players, p. 5 for 4 players; SF56-25 p. 4 for 5–6).
 */

import { describe, expect, it } from 'vitest';
import { topologyOf } from '../src/analysis.ts';
import { getProfile } from '../src/profiles.ts';
import { NEW_SHORES_SOURCE, NS56_PORT_TOKENS } from '../src/seafarers-boards.ts';
import type { GameState } from '../src/types.ts';
import { hex, seafarersGame } from './seafarers-helpers.ts';

function tally<T extends string | number | null>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[String(value)] = (out[String(value)] ?? 0) + 1;
  return out;
}

function islandSizes(state: GameState): Record<string, number> {
  return tally(state.board.layout.islands.filter((island) => island > 0));
}

describe('Heading for New Shores layouts', () => {
  it('3 players: SF25 p. 4 map and component table', () => {
    const { state } = seafarersGame(3);
    const layout = state.board.layout;
    expect(layout.topologyId).toBe('sf-new-shores-3');
    expect(topologyOf(state).hexes).toHaveLength(35);
    expect(tally(layout.terrain)).toEqual({ sea: 13, gold: 2, hills: 4, forest: 3, pasture: 5, fields: 4, mountains: 4 });
    expect(tally(layout.numbers.filter((n) => n !== null))).toEqual({
      2: 1, 3: 2, 4: 3, 5: 3, 6: 2, 8: 3, 9: 2, 10: 3, 11: 2, 12: 1,
    });
    expect(tally(layout.harbors.map((harbor) => harbor.type))).toEqual({
      generic: 3, grain: 1, ore: 1, wool: 1, brick: 1, lumber: 1,
    });
    // Robber on the 12 (no desert in the 3-player map), pirate on the frame.
    expect(layout.robber).toBe(hex(state, 0, -3));
    expect(layout.numbers[layout.robber]).toBe(12);
    expect(layout.pirate).toBeNull();
    expect(state.board.pirate).toBeNull();
    // Main island 14 hexes; small islands of 2, 4 and 2 hexes.
    expect(islandSizes(state)).toEqual({ 1: 14, 2: 2, 3: 4, 4: 2 });
    expect(layout.terrain[hex(state, 1, -3)]).toBe('gold');
    expect(layout.terrain[hex(state, 2, 0)]).toBe('gold');
  });

  it('4 players: SF25 p. 5 map and component table', () => {
    const { state } = seafarersGame(4);
    const layout = state.board.layout;
    expect(layout.topologyId).toBe('sf-new-shores-4');
    expect(topologyOf(state).hexes).toHaveLength(42);
    expect(tally(layout.terrain)).toEqual({ sea: 14, gold: 2, hills: 5, forest: 5, pasture: 5, fields: 5, mountains: 5, desert: 1 });
    expect(tally(layout.numbers.filter((n) => n !== null))).toEqual({
      2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 1,
    });
    expect(tally(layout.harbors.map((harbor) => harbor.type))).toEqual({
      generic: 4, grain: 1, ore: 1, wool: 1, brick: 1, lumber: 1,
    });
    expect(layout.terrain[layout.robber]).toBe('desert');
    expect(layout.robber).toBe(hex(state, -1, 1));
    expect(layout.pirate).toBeNull();
    expect(islandSizes(state)).toEqual({ 1: 19, 2: 2, 3: 5, 4: 2 });
  });

  it('5–6 players: SF56-25 p. 4 fixed small islands, variable main island, random ports', () => {
    for (const players of [5, 6] as const) {
      const { state } = seafarersGame(players, 7);
      const layout = state.board.layout;
      expect(layout.topologyId).toBe('sf-new-shores-56');
      expect(topologyOf(state).hexes).toHaveLength(56);
      expect(tally(layout.terrain)).toEqual({ sea: 16, gold: 3, hills: 7, forest: 7, pasture: 7, fields: 7, mountains: 7, desert: 2 });
      expect(tally(layout.numbers.filter((n) => n !== null))).toEqual({
        2: 3, 3: 4, 4: 4, 5: 4, 6: 4, 8: 4, 9: 4, 10: 4, 11: 4, 12: 3,
      });
      expect(tally(layout.harbors.map((harbor) => harbor.type))).toEqual(tally(NS56_PORT_TOKENS));
      expect(layout.harbors).toHaveLength(11);
      expect(layout.terrain[layout.robber]).toBe('desert');
      expect(layout.islands[layout.robber]).toBe(1);
      expect(layout.pirate).toBeNull();
      // 30-hex main island; the outlined small islands 3 + 3 + 2 + 2.
      expect(islandSizes(state)).toEqual({ 1: 30, 2: 3, 3: 3, 4: 2, 5: 2 });
      for (const small of NEW_SHORES_SOURCE[56].small) {
        const index = hex(state, small.q, small.r);
        expect([layout.terrain[index], layout.numbers[index], layout.islands[index]]).toEqual([small.terrain, small.number, small.island]);
      }
    }
  });

  it('5–6 players: the main island follows the recorded randomness', () => {
    const a = seafarersGame(6, 1).state.board.layout;
    const b = seafarersGame(6, 1).state.board.layout;
    const c = seafarersGame(6, 2).state.board.layout;
    expect(a).toEqual(b);
    expect(a.terrain).not.toEqual(c.terrain);
  });

  it('profiles: 14 VP, 15 ships, B25 / B56-25 supply and decks', () => {
    for (const [players, bank, deck] of [[3, 19, 25], [4, 19, 25], [5, 24, 34], [6, 24, 34]] as const) {
      const { state } = seafarersGame(players);
      const profile = getProfile(state.profileId)!;
      expect(profile.victoryTarget).toBe(14);
      expect(profile.pieces.ships).toBe(15);
      expect(state.bank.ore).toBe(bank);
      expect(state.devDeck).toHaveLength(deck);
      expect(state.engineVersion).toBe('sf-2025.2');
    }
  });
});
