/**
 * R-EP scenario setup: the five CN3085 maps, region inventories, the fixed
 * starting island and the Land Ho! starting pieces, checked against the
 * transcription in docs/aegis/work/2026-11-02-explorers-pirates.md
 * (EP25 pp. 2–7, EP25-M pp. 2, 4, 8, 14, 16).
 */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { epScenario, type EpScenarioId } from '../src/explorers-pirates-boards.ts';
import { getProfile } from '../src/profiles.ts';
import { epState } from '../src/modules/explorersPirates/state.ts';
import type { GameState, Resource } from '../src/types.ts';
import { epGame } from './ep-helpers.ts';
import { corner, hex, side } from './seafarers-helpers.ts';

function tally<T extends string | number | null>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[String(value)] = (out[String(value)] ?? 0) + 1;
  return out;
}

const START_DISCS: [number, number, number][] = [
  [0, -3, 11], [1, -3, 9], [-1, -2, 3], [0, -2, 8], [-2, -1, 4], [-1, -1, 10], [-3, 0, 6], [-2, 0, 12],
  [-1, 0, 8], [-3, 1, 10], [-2, 1, 4], [-3, 2, 11], [-2, 2, 6], [-3, 3, 3], [-2, 3, 5],
];

const CELLS: Record<EpScenarioId, { cells: number; seas: number; parrot: number; goose: number; council: boolean; target: number }> = {
  'land-ho': { cells: 50, seas: 19, parrot: 8, goose: 8, council: false, target: 8 },
  'pirate-lairs': { cells: 57, seas: 20, parrot: 11, goose: 11, council: false, target: 12 },
  fish: { cells: 57, seas: 19, parrot: 11, goose: 11, council: true, target: 15 },
  spices: { cells: 64, seas: 22, parrot: 13, goose: 13, council: true, target: 15 },
  'explorers-pirates': { cells: 71, seas: 23, parrot: 16, goose: 16, council: true, target: 17 },
};

function regionCount(state: GameState, region: 'parrot' | 'goose'): number {
  return epState(state).fog.filter((entry) => entry.region === region).length;
}

describe('Explorers & Pirates maps', () => {
  for (const [id, expected] of Object.entries(CELLS) as [EpScenarioId, (typeof CELLS)[EpScenarioId]][]) {
    it(`${id}: cell counts, regions, discs and target`, () => {
      const { state } = epGame(id, 4);
      const slot = epState(state);
      const layout = state.board.layout;
      expect(topologyOf(state).hexes).toHaveLength(expected.cells);
      // Unexplored hexes are plain sea in the layout until revealed.
      expect(regionCount(state, 'parrot')).toBe(expected.parrot);
      expect(regionCount(state, 'goose')).toBe(expected.goose);
      const land = layout.terrain.filter((terrain) => terrain !== 'sea').length;
      expect(land).toBe(15);
      const fog = new Set(slot.fog.map((entry) => entry.hex));
      const seas = layout.terrain.filter((terrain, index) => terrain === 'sea' && !fog.has(index) && index !== slot.council).length;
      expect(seas).toBe(expected.seas);
      expect(slot.council !== null).toBe(expected.council);
      if (expected.council) expect(slot.council).toBe(hex(state, 0, 0));
      for (const [q, r, disc] of START_DISCS) expect(layout.numbers[hex(state, q, r)], `${q},${r}`).toBe(disc);
      // No desert, no robber, no ports.
      expect(layout.terrain).not.toContain('desert');
      expect(layout.robber).toBe(-1);
      expect(layout.harbors).toHaveLength(0);
      expect(layout.terrain[hex(state, -3, 0)]).toBe('pasture');
      expect(epScenario(id).victoryTarget).toBe(expected.target);
      expect(getProfile(state.profileId)!.victoryTarget).toBe(expected.target);
      // Every hex number on the board belongs to the starting island.
      expect(layout.numbers.filter((n) => n !== null)).toHaveLength(15);
    });
  }

  it('the shuffled starting island uses the 14 CATAN terrain hexes', () => {
    for (const id of ['fish', 'spices', 'explorers-pirates'] as const) {
      for (const seed of [1, 2]) {
        const { state } = epGame(id, 3, seed);
        const terrain = START_DISCS.map(([q, r]) => state.board.layout.terrain[hex(state, q, r)]!);
        expect(tally(terrain)).toEqual({ hills: 2, forest: 4, pasture: 4, fields: 2, mountains: 3 });
      }
    }
  });

  it('Land Ho! and Pirate Lairs print the starting-island terrain', () => {
    const landHo = epGame('land-ho').state;
    expect(landHo.board.layout.terrain[hex(landHo, 0, -3)]).toBe('mountains');
    expect(landHo.board.layout.terrain[hex(landHo, -1, -1)]).toBe('pasture');
    expect(landHo.board.layout.terrain[hex(landHo, -3, 3)]).toBe('mountains');
    const lairs = epGame('pirate-lairs').state;
    expect(lairs.board.layout.terrain[hex(lairs, 0, -3)]).toBe('pasture');
    expect(lairs.board.layout.terrain[hex(lairs, -1, -1)]).toBe('mountains');
    expect(lairs.board.layout.terrain[hex(lairs, -3, 3)]).toBe('hills');
  });

  it('region inventories match the hex tables (EP25 p. 3, EP25-M pp. 4, 8, 14, 16)', () => {
    const tiles = (id: EpScenarioId) => {
      const regions = epScenario(id).regions;
      return { parrot: regions.parrot.tiles, goose: regions.goose.tiles };
    };
    const sum = (record: Partial<Record<string, number>>) => Object.values(record).reduce<number>((a, b) => a + (b ?? 0), 0);
    for (const [id, expected] of Object.entries(CELLS) as [EpScenarioId, (typeof CELLS)[EpScenarioId]][]) {
      expect(sum(tiles(id).parrot), id).toBe(expected.parrot);
      expect(sum(tiles(id).goose), id).toBe(expected.goose);
    }
    expect(tiles('land-ho').parrot).toMatchObject({ sea: 2, hills: 1, forest: 1, pasture: 1, fields: 1, mountains: 2 });
    expect(tiles('land-ho').goose).toMatchObject({ sea: 2, hills: 1, forest: 1, pasture: 1, fields: 2, mountains: 1 });
    expect(tiles('pirate-lairs').parrot.gold).toBe(3);
    expect(tiles('fish').goose).toMatchObject({ gold: 2, shoal: 3 });
    expect(tiles('spices').parrot).toMatchObject({ sea: 1, shoal: 3, spice: 3 });
    expect(tiles('spices').parrot.gold ?? 0).toBe(0);
    expect(epScenario('spices').regions.parrot.pirateBonus).toBe(5);
    expect(epScenario('spices').regions.goose.pirateBonus).toBe(4);
    expect(epScenario('explorers-pirates').regions.parrot.shoals).toEqual([1, 2, 3]);
    expect(epScenario('explorers-pirates').regions.goose.shoals).toEqual([4, 5, 6]);
  });

  it('variable setups list the 14 harbour-settlement marks (EP25 p. 7)', () => {
    const { state } = epGame('pirate-lairs');
    const marks = [[1, -3], [0, -2], [-1, -1], [-1, 0], [-2, 1], [-2, 2], [-2, 3]]
      .flatMap(([q, r]) => [corner(state, q!, r!, 5), corner(state, q!, r!, 0)]);
    expect(epState(state).harborMarks.slice().sort((a, b) => a - b)).toEqual([...new Set(marks)].sort((a, b) => a - b));
  });
});

describe('Land Ho! starting pieces (EP25-M p. 4)', () => {
  const PIECES: Record<string, { settlement: [number, number, number]; road: [number, number, number]; harbor: [number, number, number]; ship: [number, number, number]; resources: Resource[] }> = {
    blue: { settlement: [0, -3, 1], road: [0, -3, 5], harbor: [-2, 2, 0], ship: [-2, 3, 1], resources: ['ore', 'grain', 'wool'] },
    red: { settlement: [-3, 2, 0], road: [-2, 2, 4], harbor: [1, -3, 1], ship: [1, -3, 5], resources: ['lumber', 'brick', 'ore'] },
    white: { settlement: [-3, 0, 0], road: [-2, 0, 4], harbor: [-1, 0, 1], ship: [-1, 0, 5], resources: ['wool', 'ore', 'grain'] },
    orange: { settlement: [-2, -1, 2], road: [-2, -1, 4], harbor: [-1, -1, 0], ship: [-1, 0, 1], resources: ['brick', 'wool'] },
  };

  it('places every colour’s pieces, a settler on each ship, the resources and 2 gold', () => {
    const { state } = epGame('land-ho', 4);
    const slot = epState(state);
    expect(state.turn.phase).toBe('preroll');
    expect(state.turn.setup).toBeNull();
    for (const player of state.players) {
      const spec = PIECES[player.color]!;
      const [sq, sr, sk] = spec.settlement;
      expect(state.board.buildings[corner(state, sq, sr, sk)]).toEqual({ player: player.id, city: false });
      const [rq, rr, rk] = spec.road;
      expect(state.board.roads[side(state, rq, rr, rk)]).toMatchObject({ player: player.id, ship: false });
      const [hq, hr, hk] = spec.harbor;
      const harborVertex = corner(state, hq, hr, hk);
      expect(slot.harbors.find((harbor) => harbor.vertex === harborVertex)?.player).toBe(player.id);
      expect(state.board.buildings[harborVertex]).toEqual({ player: player.id, city: false });
      const [pq, pr, pk] = spec.ship;
      const ship = slot.ships.find((candidate) => candidate.player === player.id)!;
      expect(ship.edge).toBe(side(state, pq, pr, pk));
      expect(ship.cargo).toEqual(['settler']);
      const hand = Object.entries(player.resources).filter(([, n]) => n > 0).map(([resource]) => resource).sort();
      expect(hand).toEqual(spec.resources.slice().sort());
      expect(slot.gold[player.id]).toBe(2);
      // Settlement 1 + harbour settlement 2.
      expect(scoreOf(state, player.id, { includeHidden: true })).toBe(3);
    }
    expect(slot.goldSupply).toBe(148 - 8);
  });

  it('3 players use the printed colours of their seats', () => {
    const { state } = epGame('land-ho', 3);
    expect(epState(state).ships).toHaveLength(3);
    expect(epState(state).harbors).toHaveLength(3);
  });
});
