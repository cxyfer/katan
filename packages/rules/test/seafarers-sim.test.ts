/**
 * Whole simulated New Shores games for 3, 4, 5 and 6 players: each finishes
 * with a 14-point winner, conserves the resource supply (bank + hands per
 * resource stays at the profile's bank size) and keeps every piece legal.
 */

import { describe, expect, it } from 'vitest';
import { isLandEdge, isLandVertex, isSeaEdge, neighborsOfVertex, scoreOf, topologyOf } from '../src/analysis.ts';
import { seafarersState } from '../src/modules/seafarers/state.ts';
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

describe('simulated Cloth for Catan games (SFX-S6)', () => {
  /** 50 枚布匹守恆：部落 + 供應堆 + 玩家手上。 */
  const clothTotal = (state: GameState): number => {
    const cloth = seafarersState(state).cloth!;
    return cloth.tribes.reduce((sum, tribe) => sum + tribe.cloth, 0) + cloth.supply + Object.values(cloth.cloth).reduce((sum, value) => sum + value, 0);
  };

  for (const players of [3, 4] as const) {
    it(`${players} players finish with a winner, a conserved supply (resources and 50 cloth) and legal pieces`, () => {
      const run = simulateSeafarers(players, 61 + players, 60000, 'sf-cloth-for-catan-2025');
      const { state } = run;
      expect(state.result?.reason).toBe('victory');
      const winners = state.result!.playerIds ?? [state.result!.playerId!];
      if (state.result!.cause === 'clothExhausted') {
        expect(seafarersState(state).cloth!.tribes.filter((tribe) => tribe.cloth === 0).length).toBeGreaterThanOrEqual(5);
      } else {
        expect(scoreOf(state, winners[0]!, { includeHidden: true })).toBeGreaterThanOrEqual(14);
      }
      const bank = getProfile(state.profileId)!.bankPerResource;
      for (const resource of RESOURCES) {
        const total = state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
        expect(total, resource).toBe(bank);
      }
      expect(clothTotal(state)).toBe(50);
      checkBoard(state);
      expect(run.shipsBuilt).toBeGreaterThan(0);
    }, 120_000);
  }

  it('across seeds ships reach tribes, cloth is produced and stolen, and the supply stays at 50', () => {
    let trades = 0;
    let produced = 0;
    for (const seed of [1, 2, 3, 4]) {
      const run = simulateSeafarers(seed % 2 === 0 ? 4 : 3, seed, 60000, 'sf-cloth-for-catan-2025');
      expect(run.state.result?.reason).toBe('victory');
      expect(clothTotal(run.state)).toBe(50);
      trades += run.clothTrades;
      produced += run.clothProduced;
    }
    expect(trades).toBeGreaterThan(0);
    expect(produced).toBeGreaterThan(0);
  }, 300_000);
});

describe('simulated New World games (SFX-S9)', () => {
  for (const players of [3, 4] as const) {
    it(`${players} players place ten ports, then finish with a 12-point winner, a conserved supply and legal pieces`, () => {
      const run = simulateSeafarers(players, 51 + players, 40000, 'sf-new-world-2025');
      const { state } = run;
      expect(state.result?.reason).toBe('victory');
      expect(scoreOf(state, state.result!.playerId!, { includeHidden: true })).toBeGreaterThanOrEqual(12);
      const bank = getProfile(state.profileId)!.bankPerResource;
      for (const resource of RESOURCES) {
        const total = state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
        expect(total, resource).toBe(bank);
      }
      checkBoard(state);
      expect(run.harborsPlaced).toBe(10);
      expect(state.board.layout.harbors).toHaveLength(10);
    }, 120_000);
  }

  it('across seeds the simulation earns 1-point island bonuses', () => {
    let bonuses = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const run = simulateSeafarers(4, seed, 40000, 'sf-new-world-2025');
      expect(run.state.result?.reason).toBe('victory');
      bonuses += run.islandBonuses;
    }
    expect(bonuses).toBeGreaterThan(0);
  }, 240_000);
});

describe('simulated Wonders of Catan games (SFX-S8)', () => {
  for (const players of [3, 4] as const) {
    it(`${players} players finish with a wonder winner, a conserved supply and legal pieces`, () => {
      const run = simulateSeafarers(players, 81 + players, 80000, 'sf-wonders-of-catan-2025');
      const { state } = run;
      expect(state.result?.reason).toBe('victory');
      const winner = state.result!.playerId!;
      const wonders = seafarersState(state).wonders!;
      expect(['wonderComplete', 'wonderLead']).toContain(state.result!.cause);
      if (state.result!.cause === 'wonderComplete') expect(wonders.levels[winner]).toBe(4);
      else {
        expect(scoreOf(state, winner, { includeHidden: true })).toBeGreaterThanOrEqual(10);
        for (const player of state.players) if (player.id !== winner) expect(wonders.levels[winner]!).toBeGreaterThan(wonders.levels[player.id]!);
      }
      const bank = getProfile(state.profileId)!.bankPerResource;
      for (const resource of RESOURCES) {
        const total = state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
        expect(total, resource).toBe(bank);
      }
      // 每位玩家最多一座奇觀、同一座奇觀不被兩人持有；層數不超過 4。
      const held = Object.values(wonders.owned).filter((id) => id !== null);
      expect(new Set(held).size).toBe(held.length);
      for (const level of Object.values(wonders.levels)) expect(level).toBeLessThanOrEqual(4);
      checkBoard(state);
      expect(state.board.pirate).toBeNull();
      expect(run.wonderClaims).toBeGreaterThan(0);
      expect(run.wonderLevels).toBeGreaterThan(0);
    }, 120_000);
  }

  it('across seeds wonders get claimed and built and both endings are reachable games', () => {
    let claims = 0;
    let levels = 0;
    const causes = new Set<string | undefined>();
    for (const seed of [1, 2, 3, 4]) {
      const run = simulateSeafarers(seed % 2 === 0 ? 4 : 3, seed, 80000, 'sf-wonders-of-catan-2025');
      expect(run.state.result?.reason).toBe('victory');
      causes.add(run.state.result?.cause);
      claims += run.wonderClaims;
      levels += run.wonderLevels;
    }
    expect(claims).toBeGreaterThan(0);
    expect(levels).toBeGreaterThan(0);
    // 種子 1 是 10 分且層數最高（wonderLead），種子 3 是完成第 4 層（wonderComplete）：兩種結局都在模擬中出現。
    expect([...causes].sort()).toEqual(['wonderComplete', 'wonderLead']);
  }, 300_000);
});
