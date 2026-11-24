/**
 * R-SFX-S10a：四島群島（SF25 p. 7）、未知海域（p. 9）、穿越荒漠（p. 11）的 variable setup。
 * 1,000 個種子：配件數量、約束、確定性；fixed 不變；variable 的整局模擬。
 */

import { describe, expect, it } from 'vitest';
import { isLandEdge, isLandVertex, isSeaEdge, neighborsOfVertex, scoreOf, topologyOf } from '../src/analysis.ts';
import { buildProfileLayout } from '../src/layout-registry.ts';
import { getProfile, resolveCombination } from '../src/profiles.ts';
import { seededRng } from '../src/rng.ts';
import { fixedLayout, type LandHex, type PortSpec } from '../src/seafarers-boards.ts';
import { FOG_ISLANDS_SOURCE } from '../src/seafarers-fog-islands-boards.ts';
import { FOUR_ISLANDS_SOURCE, THROUGH_THE_DESERT_SOURCE } from '../src/seafarers-scenario-boards.ts';
import { DESERT_MAX_ATTEMPTS, variableDesertBoard } from '../src/seafarers-variable-boards.ts';
import { getTopology } from '../src/topology-registry.ts';
import { NEIGHBOR_DIRS } from '../src/topology.ts';
import { RESOURCES, type BoardLayout, type GameState } from '../src/types.ts';
import { simulateSeafarers } from './seafarers-sim.ts';

const SEEDS = 1000;
const PLAYERS = [3, 4] as const;

const sorted = <T extends string | number | null>(values: readonly T[]): string[] => values.map(String).sort();

type Scenario = 'four-islands' | 'fog-islands' | 'through-the-desert';
const PROFILES: Record<Scenario, string> = {
  'four-islands': 'sf-four-islands-2025',
  'fog-islands': 'sf-fog-islands-2025',
  'through-the-desert': 'sf-through-the-desert-2025',
};
const SOURCES = {
  'four-islands': FOUR_ISLANDS_SOURCE,
  'fog-islands': FOG_ISLANDS_SOURCE,
  'through-the-desert': THROUGH_THE_DESERT_SOURCE,
} as const;

const layoutOf = (scenario: Scenario, players: 3 | 4, mode: 'fixed' | 'variable', seed: number): BoardLayout =>
  buildProfileLayout(getProfile(PROFILES[scenario])!, { mode, playerCount: players, rng: seededRng(seed) });

/** 版圖的陸地格（含圓片、島編號），用 hex 索引。 */
function landOf(layout: BoardLayout) {
  const topology = getTopology(layout.topologyId);
  return layout.terrain.flatMap((terrain, index) => terrain === 'sea' ? [] : [{
    index, terrain, number: layout.numbers[index]!, island: layout.islands[index]!, cell: topology.hexes[index]!,
  }]);
}

function adjacency(layout: BoardLayout): number[][] {
  const topology = getTopology(layout.topologyId);
  const byKey = new Map(topology.hexes.map((cell, index) => [`${cell.q},${cell.r}`, index]));
  return topology.hexes.map((cell) =>
    NEIGHBOR_DIRS.map((dir) => byKey.get(`${cell.q + dir.q},${cell.r + dir.r}`)).filter((index): index is number => index !== undefined));
}

const isRed = (disc: number | null): boolean => disc === 6 || disc === 8;

describe('profile 登記', () => {
  it('三個劇本的 setupModes 是 fixed + variable，resolveCombination 接受 variable', () => {
    for (const scenario of Object.keys(PROFILES) as Scenario[]) {
      const profile = getProfile(PROFILES[scenario])!;
      expect(profile.setupModes).toEqual(['fixed', 'variable']);
      for (const playerCount of PLAYERS) {
        expect(resolveCombination({ expansions: ['seafarers'], scenario, variants: [], playerCount, setupMode: 'variable' }).ok).toBe(true);
      }
    }
  });
});

describe('fixed 版圖逐位元不變，且不消耗 rng', () => {
  for (const scenario of Object.keys(PROFILES) as Scenario[]) {
    for (const players of PLAYERS) {
      it(`${scenario} ${players} 人`, () => {
        const source = SOURCES[scenario][players] as { land: readonly LandHex[]; ports: readonly PortSpec[] };
        const topologyId = layoutOf(scenario, players, 'fixed', 1).topologyId;
        const robber = layoutOf(scenario, players, 'fixed', 1).robber;
        const expected = fixedLayout(getTopology(topologyId), source.land, source.ports, getTopology(topologyId).hexes[robber]!);
        for (const seed of [1, 2, 3]) expect(layoutOf(scenario, players, 'fixed', seed)).toEqual(expected);
        const rng = seededRng(7);
        buildProfileLayout(getProfile(PROFILES[scenario])!, { mode: 'fixed', playerCount: players, rng });
        expect(rng.int(1_000_000)).toBe(seededRng(7).int(1_000_000));
      });
    }
  }
});

describe('variable 版圖：配件數量與確定性（1,000 種子）', () => {
  for (const scenario of Object.keys(PROFILES) as Scenario[]) {
    for (const players of PLAYERS) {
      it(`${scenario} ${players} 人：地形、圓片、港口種類數量與 fixed（SF25 配件表）相同，同種子同圖`, () => {
        const source = SOURCES[scenario][players] as { land: readonly LandHex[]; ports: readonly PortSpec[] };
        const fixed = layoutOf(scenario, players, 'fixed', 1);
        const terrain = sorted(source.land.map((hex) => hex.terrain));
        const discs = sorted(source.land.map((hex) => hex.number));
        const ports = sorted(source.ports.map((port) => port.type));
        const seen = new Set<string>();
        for (let seed = 1; seed <= SEEDS; seed++) {
          const layout = layoutOf(scenario, players, 'variable', seed);
          expect(layout.topologyId).toBe(fixed.topologyId);
          expect(layout.terrain.length).toBe(fixed.terrain.length);
          const land = landOf(layout);
          expect(sorted(land.map((hex) => hex.terrain))).toEqual(terrain);
          expect(sorted(land.map((hex) => hex.number))).toEqual(discs);
          expect(land.every((hex) => (hex.terrain === 'desert') === (hex.number === null))).toBe(true);
          expect(sorted(layout.harbors.map((harbor) => harbor.type))).toEqual(ports);
          // 港口位置不變（S2、S3 明文；S4 的港口位置也沿用 fixed）。
          expect(layout.harbors.map((harbor) => harbor.edge)).toEqual(fixed.harbors.map((harbor) => harbor.edge));
          // 強盜：S2、S3 在 12 號圓片；S4 在沙漠 (0,-2)。
          if (scenario === 'through-the-desert') expect(layout.robber).toBe(fixed.robber);
          else expect(layout.numbers[layout.robber]).toBe(12);
          expect(layout.pirate).toBeNull();
          expect(layoutOf(scenario, players, 'variable', seed)).toEqual(layout);
          seen.add(JSON.stringify([layout.terrain, layout.numbers]));
        }
        // 不是常數：1,000 個種子應產生大量不同的版圖。
        expect(seen.size).toBeGreaterThan(900);
      }, 120_000);
    }
  }
});

describe('S2 四島群島 variable 約束（SF25 p. 7）', () => {
  for (const players of PLAYERS) {
    it(`${players} 人：森林與草地沒有 2、3、11、12；陸地格仍在四個島區，島編號不變`, () => {
      const fixed = layoutOf('four-islands', players, 'fixed', 1);
      for (let seed = 1; seed <= SEEDS; seed++) {
        const layout = layoutOf('four-islands', players, 'variable', seed);
        expect(layout.islands).toEqual(fixed.islands);
        expect(layout.terrain.map((t) => t === 'sea')).toEqual(fixed.terrain.map((t) => t === 'sea'));
        for (const hex of landOf(layout)) {
          if (hex.terrain === 'forest' || hex.terrain === 'pasture') expect([2, 3, 11, 12]).not.toContain(hex.number);
        }
      }
    }, 120_000);
  }
});

describe('S3 未知海域 variable 約束（SF25 p. 9）', () => {
  for (const players of PLAYERS) {
    it(`${players} 人：已知陸地只在兩座島區、空格與迷霧數量不變、港口位置不變`, () => {
      const fixed = layoutOf('fog-islands', players, 'fixed', 1);
      const map = FOG_ISLANDS_SOURCE[players];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const layout = layoutOf('fog-islands', players, 'variable', seed);
        expect(layout.islands).toEqual(fixed.islands);
        expect(layout.terrain.map((t) => t === 'sea')).toEqual(fixed.terrain.map((t) => t === 'sea'));
        expect(new Set(layout.islands.filter((island) => island > 0))).toEqual(new Set([2, 3]));
        expect(map.fog).toHaveLength(12);
      }
    }, 120_000);
  }

  it('紅色圓片可以相鄰：1,000 個種子中確實出現過', () => {
    let adjacentSeeds = 0;
    for (const players of PLAYERS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const layout = layoutOf('fog-islands', players, 'variable', seed);
        const near = adjacency(layout);
        if (layout.numbers.some((disc, hex) => isRed(disc) && near[hex]!.some((other) => isRed(layout.numbers[other]!)))) adjacentSeeds++;
      }
    }
    expect(adjacentSeeds).toBeGreaterThan(0);
  }, 120_000);
});

describe('S4 穿越荒漠 variable 約束（SF25 p. 11）', () => {
  for (const players of PLAYERS) {
    it(`${players} 人：沙漠、海洋與四個外地區固定；紅色圓片不相鄰、不在金礦；主島與外地的配件分區數量不變`, () => {
      const fixed = layoutOf('through-the-desert', players, 'fixed', 1);
      const fixedLand = landOf(fixed);
      const fixedMain = fixedLand.filter((hex) => hex.island === 1);
      const fixedUnexplored = fixedLand.filter((hex) => hex.island !== 1);
      for (let seed = 1; seed <= SEEDS; seed++) {
        const layout = layoutOf('through-the-desert', players, 'variable', seed);
        const near = adjacency(layout);
        // 沙漠位置固定。
        expect(layout.terrain.map((t) => t === 'desert')).toEqual(fixed.terrain.map((t) => t === 'desert'));
        // 紅色圓片：不相鄰、不在金礦上。
        layout.numbers.forEach((disc, hex) => {
          if (!isRed(disc)) return;
          expect(layout.terrain[hex]).not.toBe('gold');
          for (const other of near[hex]!) expect(isRed(layout.numbers[other]!)).toBe(false);
        });
        const land = landOf(layout);
        const main = land.filter((hex) => hex.island === 1);
        const unexplored = land.filter((hex) => hex.island !== 1);
        // 主島區就是 fixed 的主島格（沙漠與非沙漠位置不變），主島與外地各自的地形與圓片多重集不變。
        expect(main.map((hex) => hex.index).sort((a, b) => a - b)).toEqual(fixedMain.map((hex) => hex.index).sort((a, b) => a - b));
        expect(sorted(main.map((hex) => hex.terrain))).toEqual(sorted(fixedMain.map((hex) => hex.terrain)));
        expect(sorted(main.map((hex) => hex.number))).toEqual(sorted(fixedMain.map((hex) => hex.number)));
        expect(sorted(unexplored.map((hex) => hex.terrain))).toEqual(sorted(fixedUnexplored.map((hex) => hex.terrain)));
        expect(sorted(unexplored.map((hex) => hex.number))).toEqual(sorted(fixedUnexplored.map((hex) => hex.number)));
        // 外地仍是印刷圖的四個外地區：格位與島編號（2–5）不變、海洋格不變。
        expect(layout.islands).toEqual(fixed.islands);
        expect(layout.terrain.map((t) => t === 'sea')).toEqual(fixed.terrain.map((t) => t === 'sea'));
        expect(new Set(unexplored.map((hex) => hex.island))).toEqual(new Set([2, 3, 4, 5]));
        // 主島港口交叉點不碰外地陸地（外地不會與主島港口相連）。
        const topology = getTopology(layout.topologyId);
        for (const harbor of layout.harbors) {
          for (const vertex of topology.edges[harbor.edge]!.vertices) {
            for (const hex of topology.vertices[vertex]!.hexes) {
              if (layout.terrain[hex] !== 'sea') expect(layout.islands[hex]).toBe(1);
            }
          }
        }
        // 設置用的起始位置仍存在：主島有可用的內陸交叉點。
        expect(land.some((hex) => hex.island === 1 && hex.terrain !== 'desert')).toBe(true);
      }
    }, 120_000);

    it(`${players} 人：fixed 印刷版圖本身符合約束（退回排列合法），重抽最大嘗試次數遠低於上限`, () => {
      const source = THROUGH_THE_DESERT_SOURCE[players];
      const fixed = layoutOf('through-the-desert', players, 'fixed', 1);
      const near = adjacency(fixed);
      fixed.numbers.forEach((disc, hex) => {
        if (!isRed(disc)) return;
        expect(fixed.terrain[hex]).not.toBe('gold');
        for (const other of near[hex]!) expect(isRed(fixed.numbers[other]!)).toBe(false);
      });
      let max = 0;
      let total = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const board = variableDesertBoard(source.land, source.ports, seededRng(seed));
        expect(board.fellBack).toBe(false);
        max = Math.max(max, board.attempts);
        total += board.attempts;
      }
      // 實測 3 人最大 3、4 人最大 1（平均約 1.01、1.00）；留餘裕但遠低於上限。
      expect(max).toBeLessThanOrEqual(5);
      expect(total / SEEDS).toBeLessThan(1.5);
      expect(max).toBeLessThan(DESERT_MAX_ATTEMPTS);
    }, 120_000);
  }
});

/** 棋盤合法性（同 `seafarers-sim.test.ts` 的 `checkBoard`）：建築在陸地且不相鄰、路與船在對的邊、棋子數不超過、強盜在陸地。 */
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
    expect(state.board.roads.filter((road) => road?.ship && road.player === player.id).length).toBeLessThanOrEqual(profile.pieces.ships);
    expect(state.board.roads.filter((road) => road && !road.ship && road.player === player.id).length).toBeLessThanOrEqual(profile.pieces.roads);
  }
  if (state.board.pirate !== null) expect(state.board.layout.terrain[state.board.pirate]).toBe('sea');
  expect(state.board.layout.terrain[state.board.robber]).not.toBe('sea');
}

describe('variable 整局模擬到有贏家', () => {
  const TARGET = { 'four-islands': 13, 'fog-islands': 12, 'through-the-desert': 14 } as const;
  for (const scenario of Object.keys(PROFILES) as Scenario[]) {
    for (const players of PLAYERS) {
      it(`${scenario} ${players} 人`, () => {
        const run = simulateSeafarers(players, 51 + players, 40000, PROFILES[scenario], 'variable');
        const { state } = run;
        // 版圖確實是 variable（與 fixed 的印刷版圖不同）。
        expect(state.board.layout.numbers).not.toEqual(layoutOf(scenario, players, 'fixed', 1).numbers);
        expect(state.result?.reason).toBe('victory');
        expect(scoreOf(state, state.result!.playerId!, { includeHidden: true })).toBeGreaterThanOrEqual(TARGET[scenario]);
        // 供應守恆：每種資源 bank + 玩家手牌 = bankPerResource；船不超過 15；棋盤合法。
        const bank = getProfile(state.profileId)!.bankPerResource;
        for (const resource of RESOURCES) {
          const total = state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
          expect(total, resource).toBe(bank);
        }
        expect(getProfile(state.profileId)!.pieces.ships).toBe(15);
        checkBoard(state);
        if (scenario === 'fog-islands') expect(run.fogReveals).toBeGreaterThan(0);
      }, 120_000);
    }
  }
});
