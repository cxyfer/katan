/**
 * R-SFX-S10b：世外部落（SF25 p. 13）、布匹產地（p. 15）、卡坦奇觀（p. 18）的 variable setup。
 * 1,000 個種子：配件數量、約束、固定元素不變、確定性；fixed 不變；S6 選強盜步驟；variable 整局模擬。
 */

import { describe, expect, it } from 'vitest';
import { actionHints, applyCommand, createGame } from '../src/engine.ts';
import { isLandEdge, isLandVertex, isSeaEdge, neighborsOfVertex, scoreOf, topologyOf } from '../src/analysis.ts';
import { buildProfileLayout } from '../src/layout-registry.ts';
import { getProfile, resolveCombination } from '../src/profiles.ts';
import { projectGame } from '../src/project.ts';
import { seededRng } from '../src/rng.ts';
import { CLOTH_FOR_CATAN_SOURCE, FORGOTTEN_TRIBE_SOURCE, FT_VARIABLE_RESTRICTED, WC_VARIABLE_NO_RED, WONDERS_OF_CATAN_SOURCE } from '../src/seafarers-scenario-boards.ts';
import { giftEdges } from '../src/seafarers-scenario-boards.ts';
import { getTopology } from '../src/topology-registry.ts';
import { NEIGHBOR_DIRS } from '../src/topology.ts';
import { RESOURCES, type BoardLayout, type GameState } from '../src/types.ts';
import { scriptedRng } from './helpers.ts';
import { seafarersGame } from './seafarers-helpers.ts';
import { simulateSeafarers } from './seafarers-sim.ts';

const SEEDS = 1000;
const sorted = <T extends string | number | null>(values: readonly T[]): string[] => values.map(String).sort();

type Scenario = 'forgotten-tribe' | 'cloth-for-catan' | 'wonders-of-catan';
const PROFILES: Record<Scenario, string> = {
  'forgotten-tribe': 'sf-forgotten-tribe-2025',
  'cloth-for-catan': 'sf-cloth-for-catan-2025',
  'wonders-of-catan': 'sf-wonders-of-catan-2025',
};
const SOURCES = { 'forgotten-tribe': FORGOTTEN_TRIBE_SOURCE, 'cloth-for-catan': CLOTH_FOR_CATAN_SOURCE, 'wonders-of-catan': WONDERS_OF_CATAN_SOURCE } as const;
const SCENARIOS = Object.keys(PROFILES) as Scenario[];

const layoutOf = (scenario: Scenario, players: 3 | 4, mode: 'fixed' | 'variable', seed: number): BoardLayout =>
  buildProfileLayout(getProfile(PROFILES[scenario])!, { mode, playerCount: players, rng: seededRng(seed) });

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

const indexOfCell = (layout: BoardLayout, cell: { q: number; r: number }): number =>
  getTopology(layout.topologyId).hexes.findIndex((hex) => hex.q === cell.q && hex.r === cell.r);

describe('profile 登記', () => {
  it('三個劇本的 setupModes 是 fixed + variable，resolveCombination 接受 variable（3、4 人）', () => {
    for (const scenario of SCENARIOS) {
      expect(getProfile(PROFILES[scenario])!.setupModes).toEqual(['fixed', 'variable']);
      for (const playerCount of [3, 4]) {
        expect(resolveCombination({ expansions: ['seafarers'], scenario, variants: [], playerCount, setupMode: 'variable' }).ok).toBe(true);
        expect(resolveCombination({ expansions: ['seafarers'], scenario, variants: [], playerCount, setupMode: 'fixed' }).ok).toBe(true);
      }
    }
  });
});

describe('頁面圖判定的約束格（work record V10、V15）', () => {
  it('S5：大島每排最右端的 3 格（第 1、2、3 排）就是藍線框出的 3 格', () => {
    const layout = layoutOf('forgotten-tribe', 3, 'fixed', 1);
    const near = landOf(layout).filter((hex) => hex.island === 1);
    const rows = new Map<number, typeof near>();
    for (const hex of near) rows.set(hex.cell.r, [...(rows.get(hex.cell.r) ?? []), hex]);
    const rightmost = [...rows.values()].map((row) => row.reduce((best, hex) => hex.cell.q > best.cell.q ? hex : best));
    expect(rightmost.map((hex) => hex.index).sort()).toEqual(FT_VARIABLE_RESTRICTED.map((cell) => indexOfCell(layout, cell)).sort());
    // 圖上的內容：山脈 4、牧草 2、田野 3。
    expect(rightmost.map((hex) => `${hex.terrain}${hex.number}`).sort()).toEqual(['fields3', 'mountains4', 'pasture2']);
  });

  it('S8：緊鄰三塊沙漠的陸地恰是 2 格（森林 9、丘陵 4），與 WC_VARIABLE_NO_RED 相同', () => {
    const layout = layoutOf('wonders-of-catan', 3, 'fixed', 1);
    const near = adjacency(layout);
    const touching = new Set<number>();
    layout.terrain.forEach((terrain, hex) => {
      if (terrain !== 'desert') return;
      for (const other of near[hex]!) if (layout.terrain[other] !== 'sea' && layout.terrain[other] !== 'desert') touching.add(other);
    });
    expect([...touching].sort()).toEqual(WC_VARIABLE_NO_RED.map((cell) => indexOfCell(layout, cell)).sort());
    expect([...touching].map((hex) => `${layout.terrain[hex]}${layout.numbers[hex]}`).sort()).toEqual(['forest9', 'hills4']);
  });
});

describe('fixed 版圖不變，且不消耗新的 rng', () => {
  for (const scenario of SCENARIOS) {
    it(scenario, () => {
      const source = SOURCES[scenario].land as readonly { q: number; r: number; terrain: string; number: number | null; island: number }[];
      for (const seed of [1, 2, 3, 99]) {
        const layout = layoutOf(scenario, 3, 'fixed', seed);
        const topology = getTopology(layout.topologyId);
        const byKey = new Map(source.map((hex) => [`${hex.q},${hex.r}`, hex]));
        topology.hexes.forEach((cell, index) => {
          const tile = byKey.get(`${cell.q},${cell.r}`);
          expect(layout.terrain[index]).toBe(tile?.terrain ?? 'sea');
          expect(layout.numbers[index]).toBe(tile?.number ?? null);
          expect(layout.islands[index]).toBe(tile?.island ?? 0);
        });
        expect(layoutOf(scenario, 4, 'fixed', seed)).toEqual(layout);
      }
      // fixed 的 rng 消耗：S5 只抽一次沙漠（3 選 1）；S6 只洗港口；S8 先洗港口再抽沙漠。
      const used = seededRng(7);
      buildProfileLayout(getProfile(PROFILES[scenario])!, { mode: 'fixed', playerCount: 3, rng: used });
      const expected = seededRng(7);
      if (scenario === 'forgotten-tribe') expected.int(3);
      else {
        // 兩者都先洗 9 個港口標記：洗牌 n 個元素抽 n-1 次（Fisher–Yates，與 `shuffle` 一致）。
        const draws = 9;
        const array = Array.from({ length: draws }, (_, i) => i);
        for (let i = draws - 1; i > 0; i--) { const j = expected.int(i + 1); [array[i], array[j]] = [array[j]!, array[i]!]; }
        if (scenario === 'wonders-of-catan') expected.int(3);
      }
      expect(used.int(1_000_000)).toBe(expected.int(1_000_000));
    });
  }

  it('S6 fixed：強盜在 12 號格 (-2,-1)，沒有選強盜階段', () => {
    const { state } = seafarersGame(4, 5, PROFILES['cloth-for-catan'], 'fixed');
    expect(state.turn.setup!.stage).toBe('building');
    expect(state.board.layout.numbers[state.board.robber]).toBe(12);
    expect(state.board.layout.numbers.filter((n) => n === 12)).toHaveLength(2);
  });
});

describe('S5 世外部落 variable（SF25 p. 13，1,000 種子）', () => {
  it('小島、海洋、海盜不變；大島 18 格洗牌；右側 3 格不放 5、6、8、9；強盜在沙漠', () => {
    const fixed = layoutOf('forgotten-tribe', 3, 'fixed', 1);
    const fixedLand = landOf(fixed);
    const restricted = FT_VARIABLE_RESTRICTED.map((cell) => indexOfCell(fixed, cell));
    const terrain = sorted(fixedLand.filter((hex) => hex.island === 1).map((hex) => hex.terrain));
    const discs = sorted(fixedLand.filter((hex) => hex.island === 1).map((hex) => hex.number));
    const seen = new Set<string>();
    const robbers = new Set<number>();
    const atCell = new Map<number, Set<number>>(); // 某個大島格出現過的紅色圓片
    for (let seed = 1; seed <= SEEDS; seed++) {
      const layout = layoutOf('forgotten-tribe', 4, 'variable', seed);
      expect(layout.islands).toEqual(fixed.islands);
      expect(layout.pirate).toBe(fixed.pirate);
      expect(layout.harbors).toEqual(fixed.harbors);
      const land = landOf(layout);
      const main = land.filter((hex) => hex.island === 1);
      expect(main).toHaveLength(18);
      expect(sorted(main.map((hex) => hex.terrain))).toEqual(terrain);
      expect(sorted(main.map((hex) => hex.number))).toEqual(discs);
      for (const hex of land.filter((candidate) => candidate.island !== 1)) {
        const was = fixedLand.find((candidate) => candidate.index === hex.index)!;
        expect([hex.terrain, hex.number]).toEqual([was.terrain, was.number]);
      }
      for (const cell of restricted) expect([5, 6, 8, 9]).not.toContain(layout.numbers[cell]);
      expect(layout.terrain[layout.robber]).toBe('desert');
      robbers.add(layout.robber);
      for (const hex of main) if (hex.number === 6 || hex.number === 8) atCell.set(hex.index, (atCell.get(hex.index) ?? new Set()).add(hex.number));
      expect(layoutOf('forgotten-tribe', 4, 'variable', seed)).toEqual(layout);
      seen.add(JSON.stringify([layout.terrain, layout.numbers]));
    }
    expect(seen.size).toBeGreaterThan(900);
    expect(robbers.size).toBe(3);
    // 6 與 8 也會洗牌：大島內部至少有一格兩種紅色圓片都出現過。
    expect([...atCell.values()].some((set) => set.size === 2)).toBe(true);
  }, 120_000);

  it('禮物（VP、發展牌、港口）的邊位置在 variable 與 fixed 相同', () => {
    const topology = getTopology('sf-forgotten-tribe');
    const edges = giftEdges(topology);
    for (const seed of [1, 2, 3]) {
      const { state } = seafarersGame(3, seed, PROFILES['forgotten-tribe'], 'variable');
      const tribe = (state.moduleState as { seafarers: { tribe: { gifts: { edge: number; kind: string }[] } } }).seafarers.tribe;
      expect(tribe.gifts.map(({ edge, kind }) => ({ edge, kind }))).toEqual(edges);
    }
  });
});

describe('S6 布匹產地 variable（SF25 p. 15，1,000 種子）', () => {
  it('框、四座小島、海洋、港口位置不變；兩座大島 20 格合併洗牌；港口種類 5×2:1 + 4×3:1', () => {
    const fixed = layoutOf('cloth-for-catan', 3, 'fixed', 1);
    const fixedLand = landOf(fixed);
    const large = fixedLand.filter((hex) => hex.island === 1 || hex.island === 6);
    expect(large).toHaveLength(20);
    const terrain = sorted(large.map((hex) => hex.terrain));
    const discs = sorted(large.map((hex) => hex.number));
    const portTypes = sorted(fixed.harbors.map((harbor) => harbor.type));
    const seen = new Set<string>();
    let twelvesSouth = 0;
    let twelvesNorth = 0;
    let split = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const layout = layoutOf('cloth-for-catan', 4, 'variable', seed);
      expect(layout.islands).toEqual(fixed.islands);
      expect(layout.terrain.map((t) => t === 'sea')).toEqual(fixed.terrain.map((t) => t === 'sea'));
      expect(layout.harbors.map((harbor) => harbor.edge)).toEqual(fixed.harbors.map((harbor) => harbor.edge));
      expect(sorted(layout.harbors.map((harbor) => harbor.type))).toEqual(portTypes);
      const land = landOf(layout);
      const area = land.filter((hex) => hex.island === 1 || hex.island === 6);
      expect(sorted(area.map((hex) => hex.terrain))).toEqual(terrain);
      expect(sorted(area.map((hex) => hex.number))).toEqual(discs);
      for (const hex of land.filter((candidate) => candidate.island >= 2 && candidate.island <= 5)) {
        const was = fixedLand.find((candidate) => candidate.index === hex.index)!;
        expect([hex.terrain, hex.number]).toEqual([was.terrain, was.number]);
      }
      // 兩個 12 號圓片都在大島；強盜初值在其中一個；不在小島。
      const twelves = area.filter((hex) => hex.number === 12);
      expect(twelves).toHaveLength(2);
      expect(twelves.map((hex) => hex.index)).toContain(layout.robber);
      const islandsOf12 = twelves.map((hex) => hex.island).sort();
      if (islandsOf12[0] !== islandsOf12[1]) split++;
      else if (islandsOf12[0] === 1) twelvesNorth++;
      else twelvesSouth++;
      expect(layout.pirate).toBeNull();
      expect(layoutOf('cloth-for-catan', 4, 'variable', seed)).toEqual(layout);
      seen.add(JSON.stringify([layout.terrain, layout.numbers, layout.harbors]));
    }
    expect(seen.size).toBeGreaterThan(900);
    // 兩區合併洗牌：12 號圓片會分在兩區，也會同在一區。
    expect(split).toBeGreaterThan(0);
    expect(twelvesNorth).toBeGreaterThan(0);
    expect(twelvesSouth).toBeGreaterThan(0);
  }, 120_000);
});

describe('S6 選強盜步驟（variable，SF25 p. 15）', () => {
  const start = (seed = 11) => seafarersGame(4, seed, PROFILES['cloth-for-catan'], 'variable');
  const twelveHexes = (state: GameState): number[] => state.board.layout.numbers.flatMap((n, hex) => n === 12 ? [hex] : []);

  it('開局在 robber 階段；起始玩家有 2 個可選格，其他人沒有；投影出 stage robber', () => {
    const { state } = start();
    const setup = state.turn.setup!;
    expect(setup.stage).toBe('robber');
    const starter = state.players[setup.order[0]!]!.id;
    const hintsOf = (id: string) => (actionHints(state, id).modules as { seafarers: { robberChoice?: number[]; board?: { kind: string; commandType: string; targets: number[] } | null } }).seafarers;
    expect(hintsOf(starter).robberChoice).toEqual(twelveHexes(state));
    expect(hintsOf(starter).board).toMatchObject({ kind: 'hex', commandType: 'cloth.robber', targets: twelveHexes(state) });
    for (const player of state.players) if (player.id !== starter) expect(hintsOf(player.id).robberChoice).toEqual([]);
    expect(actionHints(state, starter).legalSettlements).toEqual([]);
    const view = projectGame(state, starter);
    expect(view.turn.setup).toMatchObject({ stage: 'robber', seat: setup.order[0] });
  });

  it('選擇前不能放村落；非起始玩家不能選；只能選 12 號格；選完才進起始村落', () => {
    const { state } = start();
    const setup = state.turn.setup!;
    const starter = state.players[setup.order[0]!]!.id;
    const other = state.players.find((player) => player.id !== starter)!.id;
    const twelves = twelveHexes(state);
    const vertex = actionHints(state, starter).legalSettlements[0] ?? 0;
    expect(applyCommand(state, starter, { type: 'setup.placeBuilding', vertex }, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_WRONG_PHASE' } });
    expect(applyCommand(state, other, { type: 'cloth.robber', hex: twelves[0]! } as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_NOT_YOUR_TURN' } });
    const notTwelve = state.board.layout.terrain.findIndex((t, hex) => t !== 'sea' && state.board.layout.numbers[hex] !== 12);
    expect(applyCommand(state, starter, { type: 'cloth.robber', hex: notTwelve } as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_ILLEGAL_TARGET' } });
    expect(applyCommand(state, starter, { type: 'cloth.robber', hex: 'x' } as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_ILLEGAL_TARGET' } });
    // 選另一個 12（不是 layout 預設的那個）；不消耗 rng（空腳本 rng 不得被抽）。
    const target = twelves.find((hex) => hex !== state.board.robber)!;
    const outcome = applyCommand(state, starter, { type: 'cloth.robber', hex: target } as never, scriptedRng([]));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.state.board.robber).toBe(target);
    expect(outcome.state.turn.setup!.stage).toBe('building');
    expect(outcome.state.turn.setup!.index).toBe(0);
    expect(outcome.events.map((event) => event.type)).toEqual(['cloth.robberChosen']);
    // 選完不能再選；起始玩家現在可放村落，hints 不再有 robberChoice。
    expect(applyCommand(outcome.state, starter, { type: 'cloth.robber', hex: target } as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_WRONG_PHASE' } });
    expect(actionHints(outcome.state, starter).legalSettlements.length).toBeGreaterThan(0);
    const placed = applyCommand(outcome.state, starter, { type: 'setup.placeBuilding', vertex: actionHints(outcome.state, starter).legalSettlements[0]! }, scriptedRng([]));
    expect(placed.ok).toBe(true);
  });

  it('兩個 12 號格都能選；fixed 沒有這個指令；JSON 往返後（重啟還原）仍在 robber 階段且可繼續', () => {
    for (const pick of [0, 1]) {
      const { state } = start(20 + pick);
      const restored = JSON.parse(JSON.stringify(state)) as GameState;
      expect(restored.turn.setup!.stage).toBe('robber');
      const starter = restored.players[restored.turn.setup!.order[0]!]!.id;
      const hex = twelveHexes(restored)[pick]!;
      const outcome = applyCommand(restored, starter, { type: 'cloth.robber', hex } as never, scriptedRng([]));
      expect(outcome.ok && outcome.state.board.robber).toBe(hex);
    }
    const fixed = seafarersGame(4, 5, PROFILES['cloth-for-catan'], 'fixed').state;
    const id = fixed.players[fixed.turn.setup!.order[0]!]!.id;
    expect(applyCommand(fixed, id, { type: 'cloth.robber', hex: twelveHexes(fixed)[0]! } as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_WRONG_PHASE' } });
  });

  it('其他劇本沒有選強盜階段（S5、S8 variable 開局直接是 building）', () => {
    for (const scenario of ['forgotten-tribe', 'wonders-of-catan'] as const) {
      expect(seafarersGame(3, 3, PROFILES[scenario], 'variable').state.turn.setup!.stage).toBe('building');
    }
  });
});

describe('S8 卡坦奇觀 variable（SF25 p. 18，1,000 種子）', () => {
  it('沙漠、小島、海洋、港口位置不變；大島 21 格洗牌；緊鄰沙漠的 2 格沒有 6、8；強盜在沙漠', () => {
    const fixed = layoutOf('wonders-of-catan', 3, 'fixed', 1);
    const fixedLand = landOf(fixed);
    const main = fixedLand.filter((hex) => hex.island === 1 && hex.terrain !== 'desert');
    const terrain = sorted(main.map((hex) => hex.terrain));
    const discs = sorted(main.map((hex) => hex.number));
    const portTypes = sorted(fixed.harbors.map((harbor) => harbor.type));
    const noRed = WC_VARIABLE_NO_RED.map((cell) => indexOfCell(fixed, cell));
    const seen = new Set<string>();
    const robbers = new Set<number>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const layout = layoutOf('wonders-of-catan', 4, 'variable', seed);
      expect(layout.islands).toEqual(fixed.islands);
      expect(layout.terrain.map((t) => t === 'sea' || t === 'desert' ? t : 'land')).toEqual(fixed.terrain.map((t) => t === 'sea' || t === 'desert' ? t : 'land'));
      expect(layout.harbors.map((harbor) => harbor.edge)).toEqual(fixed.harbors.map((harbor) => harbor.edge));
      expect(sorted(layout.harbors.map((harbor) => harbor.type))).toEqual(portTypes);
      const land = landOf(layout);
      const area = land.filter((hex) => hex.island === 1 && hex.terrain !== 'desert');
      expect(area.map((hex) => hex.index).sort()).toEqual(main.map((hex) => hex.index).sort());
      expect(sorted(area.map((hex) => hex.terrain))).toEqual(terrain);
      expect(sorted(area.map((hex) => hex.number))).toEqual(discs);
      for (const hex of land.filter((candidate) => candidate.island !== 1)) {
        const was = fixedLand.find((candidate) => candidate.index === hex.index)!;
        expect([hex.terrain, hex.number]).toEqual([was.terrain, was.number]);
      }
      for (const cell of noRed) expect([6, 8]).not.toContain(layout.numbers[cell]);
      expect(layout.terrain[layout.robber]).toBe('desert');
      robbers.add(layout.robber);
      expect(layout.pirate).toBeNull();
      expect(layoutOf('wonders-of-catan', 4, 'variable', seed)).toEqual(layout);
      seen.add(JSON.stringify([layout.terrain, layout.numbers, layout.harbors]));
    }
    expect(seen.size).toBeGreaterThan(900);
    expect(robbers.size).toBe(3);
  }, 120_000);
});

/** 棋盤合法性（同 S10a）：建築在陸地且不相鄰、路與船在對的邊、棋子數不超過、強盜在陸地。 */
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
  for (const scenario of SCENARIOS) {
    for (const players of [3, 4] as const) {
      it(`${scenario} ${players} 人`, () => {
        const run = simulateSeafarers(players, 61 + players, 40000, PROFILES[scenario], 'variable');
        const { state } = run;
        expect(state.board.layout.numbers).not.toEqual(layoutOf(scenario, players, 'fixed', 1).numbers);
        expect(state.result?.reason).toBe('victory');
        // 目標分終局才檢查分數（布匹耗盡與奇觀完成是另一種終局原因）。
        if (state.result!.cause === undefined) {
          expect(scoreOf(state, state.result!.playerId!, { includeHidden: true })).toBeGreaterThanOrEqual(getProfile(state.profileId)!.victoryTarget);
        }
        const bank = getProfile(state.profileId)!.bankPerResource;
        for (const resource of RESOURCES) {
          const total = state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
          expect(total, resource).toBe(bank);
        }
        // 布匹產地：布匹守恆 50（部落 + 供應堆 + 玩家持有）。
        if (scenario === 'cloth-for-catan') {
          const cloth = (state.moduleState as { seafarers: { cloth: { tribes: { cloth: number }[]; supply: number; cloth: Record<string, number> } } }).seafarers.cloth;
          // 部落產出不足時從供應堆補，玩家持有的布匹不離開遊戲：總量恆為 50。
          const total = cloth.tribes.reduce((sum, tribe) => sum + tribe.cloth, 0) + cloth.supply + Object.values(cloth.cloth).reduce((a, b) => a + b, 0);
          expect(total).toBe(50);
          expect(run.state.turn.setup).toBeNull();
        }
        expect(getProfile(state.profileId)!.pieces.ships).toBe(15);
        checkBoard(state);
      }, 120_000);
    }
  }
});

// createGame 在三個劇本上不因 variable 而拋錯（確保 profile 接受 setupMode）。
describe('createGame', () => {
  it('variable 版圖可開局（3 與 4 人）', () => {
    for (const scenario of SCENARIOS) {
      for (const count of [3, 4]) {
        const state = createGame({
          profileId: PROFILES[scenario],
          players: Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, nickname: `P${i + 1}`, color: (['red', 'blue', 'white', 'orange'] as const)[i]! })),
          setupMode: 'variable',
          rng: seededRng(4),
        });
        expect(state.turn.setup!.stage).toBe(scenario === 'cloth-for-catan' ? 'robber' : 'building');
      }
    }
  });
});
