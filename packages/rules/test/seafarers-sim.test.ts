/**
 * Whole simulated New Shores games for 3, 4, 5 and 6 players: each finishes
 * with a 14-point winner, conserves the resource supply (bank + hands per
 * resource stays at the profile's bank size) and keeps every piece legal.
 */

import { describe, expect, it } from 'vitest';
import { isLandEdge, isLandVertex, isSeaEdge, neighborsOfVertex, scoreOf, topologyOf } from '../src/analysis.ts';
import { getProfile } from '../src/profiles.ts';
import { RESOURCES, type GameState } from '../src/types.ts';
import { simulateSeafarers } from './seafarers-sim.ts';

function checkBoard(state: GameState): void {
  const topo = topologyOf(state);
  const profile = getProfile(state.profileId)!;
  state.board.buildings.forEach((building, vertex) => {
    if (!building) return;
    expect(isLandVertex(state, vertex)).toBe(true);
    for (const neighbor of neighborsOfVertex(topo, vertex)) expect(state.board.buildings[neighbor]).toBeNull();
  });
  state.board.roads.forEach((road, edge) => {
    if (!road) return;
    expect(road.ship ? isSeaEdge(state, edge) : isLandEdge(state, edge)).toBe(true);
  });
  for (const player of state.players) {
    const ships = state.board.roads.filter((road) => road?.ship && road.player === player.id).length;
    const roads = state.board.roads.filter((road) => road && !road.ship && road.player === player.id).length;
    expect(ships).toBeLessThanOrEqual(profile.pieces.ships);
    expect(roads).toBeLessThanOrEqual(profile.pieces.roads);
  }
  if (state.board.pirate !== null) expect(state.board.layout.terrain[state.board.pirate]).toBe('sea');
  expect(state.board.layout.terrain[state.board.robber]).not.toBe('sea');
}

describe('simulated New Shores games', () => {
  for (const players of [3, 4, 5, 6] as const) {
    it(`${players} players finish with a 14-point winner and a conserved supply`, () => {
      const run = simulateSeafarers(players, 11 + players);
      const { state } = run;
      expect(state.result?.reason).toBe('victory');
      const winner = state.result!.playerId!;
      expect(scoreOf(state, winner, { includeHidden: true })).toBeGreaterThanOrEqual(14);
      const bank = getProfile(state.profileId)!.bankPerResource;
      for (const resource of RESOURCES) {
        const total = state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
        expect(total, resource).toBe(bank);
      }
      checkBoard(state);
      // The game actually exercised the expansion.
      expect(run.shipsBuilt).toBeGreaterThan(0);
      expect(run.islandBonuses).toBeGreaterThan(0);
    }, 60_000);
  }

  it('across seeds the simulation reaches gold, the pirate and ship moves', () => {
    const totals = { gold: 0, pirate: 0, moves: 0 };
    for (const seed of [1, 2, 3]) {
      const run = simulateSeafarers(4, seed);
      expect(run.state.result?.reason).toBe('victory');
      totals.gold += run.goldChoices;
      totals.pirate += run.pirateMoves;
      totals.moves += run.shipsMoved;
    }
    expect(totals.gold).toBeGreaterThan(0);
    expect(totals.pirate).toBeGreaterThan(0);
    expect(totals.moves).toBeGreaterThan(0);
  }, 120_000);
});

describe('simulated Four Islands games (SFX-S2)', () => {
  for (const players of [3, 4] as const) {
    it(`${players} players finish with a 13-point winner, a conserved supply and legal pieces`, () => {
      const run = simulateSeafarers(players, 21 + players, 30000, 'sf-four-islands-2025');
      const { state } = run;
      expect(state.result?.reason).toBe('victory');
      expect(scoreOf(state, state.result!.playerId!, { includeHidden: true })).toBeGreaterThanOrEqual(13);
      const bank = getProfile(state.profileId)!.bankPerResource;
      for (const resource of RESOURCES) {
        const total = state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
        expect(total, resource).toBe(bank);
      }
      checkBoard(state);
      expect(run.shipsBuilt).toBeGreaterThan(0);
    }, 60_000);
  }

  it('across seeds the simulation earns island bonuses (non-home islands)', () => {
    let bonuses = 0;
    for (const seed of [1, 2, 3, 4]) {
      const run = simulateSeafarers(4, seed, 30000, 'sf-four-islands-2025');
      expect(run.state.result?.reason).toBe('victory');
      bonuses += run.islandBonuses;
    }
    expect(bonuses).toBeGreaterThan(0);
  }, 120_000);
});

describe('simulated Through the Desert games (SFX-S4)', () => {
  for (const players of [3, 4] as const) {
    it(`${players} players finish with a 14-point winner, a conserved supply and legal pieces`, () => {
      const run = simulateSeafarers(players, 31 + players, 30000, 'sf-through-the-desert-2025');
      const { state } = run;
      expect(state.result?.reason).toBe('victory');
      expect(scoreOf(state, state.result!.playerId!, { includeHidden: true })).toBeGreaterThanOrEqual(14);
      const bank = getProfile(state.profileId)!.bankPerResource;
      for (const resource of RESOURCES) {
        const total = state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
        expect(total, resource).toBe(bank);
      }
      checkBoard(state);
      expect(run.shipsBuilt).toBeGreaterThan(0);
    }, 60_000);
  }

  it('across seeds the simulation earns unexplored-region bonuses and reaches gold', () => {
    let bonuses = 0;
    let gold = 0;
    for (const seed of [1, 2, 3, 4]) {
      const run = simulateSeafarers(4, seed, 30000, 'sf-through-the-desert-2025');
      expect(run.state.result?.reason).toBe('victory');
      bonuses += run.islandBonuses;
      gold += run.goldChoices;
    }
    expect(bonuses).toBeGreaterThan(0);
    expect(gold).toBeGreaterThan(0);
  }, 120_000);
});

describe('simulated Fog Islands games (SFX-S3)', () => {
  for (const players of [3, 4] as const) {
    it(`${players} players finish with a 12-point winner after revealing fog, with a conserved supply`, () => {
      const run = simulateSeafarers(players, 31 + players, 30000, 'sf-fog-islands-2025');
      const { state } = run;
      expect(state.result?.reason).toBe('victory');
      expect(scoreOf(state, state.result!.playerId!, { includeHidden: true })).toBeGreaterThanOrEqual(12);
      const bank = getProfile(state.profileId)!.bankPerResource;
      for (const resource of RESOURCES) {
        const total = state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
        expect(total, resource).toBe(bank);
      }
      checkBoard(state);
      // 不能空洞通過：真的有空格被翻開，且翻開數 = 12 − 剩餘空格。
      expect(run.fogReveals).toBeGreaterThan(0);
      const slot = (state.moduleState as unknown as { seafarers: { fog: { hexes: number[] } } }).seafarers.fog;
      expect(12 - slot.hexes.length).toBe(run.fogReveals);
    }, 60_000);
  }
});

describe('simulated Forgotten Tribe games (SFX-S5)', () => {
  for (const players of [3, 4] as const) {
    it(`${players} players finish with a 13-point winner, a conserved supply and legal pieces`, () => {
      const run = simulateSeafarers(players, 41 + players, 40000, 'sf-forgotten-tribe-2025');
      const { state } = run;
      expect(state.result?.reason).toBe('victory');
      expect(scoreOf(state, state.result!.playerId!, { includeHidden: true })).toBeGreaterThanOrEqual(13);
      const bank = getProfile(state.profileId)!.bankPerResource;
      for (const resource of RESOURCES) {
        const total = state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
        expect(total, resource).toBe(bank);
      }
      checkBoard(state);
      expect(run.shipsBuilt).toBeGreaterThan(0);
    }, 120_000);
  }

  it('across seeds ships collect gifts and place harbours', () => {
    let gifts = 0;
    let harbors = 0;
    for (const seed of [1, 2, 3, 4]) {
      const run = simulateSeafarers(4, seed, 40000, 'sf-forgotten-tribe-2025');
      expect(run.state.result?.reason).toBe('victory');
      gifts += run.gifts;
      harbors += run.harborsPlaced;
    }
    expect(gifts).toBeGreaterThan(0);
    expect(harbors).toBeGreaterThan(0);
  }, 240_000);
});
