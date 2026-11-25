/**
 * R-SFX-S7a：The Pirate Islands（海盜巢穴）的版圖、預置棋子、堡壘、beachhead 與西島船線（SF25 pp. 16–17）。
 * 版圖與配件表對照兩份獨立轉錄（s7-A／s7-B，逐格一致）；3 人與 4 人共用同一張 49 格圖。規則 fixture 為預置棋子、
 * 堡壘（不產出、不算分、不能升級）、起始村落只放東島、牌堆組成、西島船線（一條不分叉、最短路徑、被擋繞路、
 * 完全無路的放寬）、beachhead 蓋村落，以及其他劇本不受影響（D7）。巡弋海盜、攻擊與進攻在 S7b、S7c。
 */

import { describe, expect, it } from 'vitest';
import { BASE_AWARD_RULES, isLandEdge, isLandHex, isSeaEdge, scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, createGame, legalBuildingVertices, legalRobberHexes } from '../src/engine.ts';
import { productionForRoll } from '../src/analysis.ts';
import { seafarersModule } from '../src/modules/seafarers/index.ts';
import { goldEntitlements } from '../src/modules/seafarers/gold.ts';
import {
  fortressLocked, isLineEdge, lineBacktrack, lineShipFixed, roadAllowed, lineBacktrackMovable, lineContext, lineShip, lineVertices, pirateIslandsView, villageWalls, wallContext, wallsAnyone,
} from '../src/modules/seafarers/pirateIslands.ts';
import { canPlaceShip, legalShipEdges } from '../src/modules/seafarers/ships.ts';
import { seafarersState } from '../src/modules/seafarers/state.ts';
import { getProfile, resolveCombination } from '../src/profiles.ts';
import { projectGame } from '../src/project.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import {
  PI_PIECES, PI_ROUTE, PIRATE_ISLANDS_SOURCE, cornerVertex, routeHexes, sideEdge,
} from '../src/seafarers-pirate-islands-boards.ts';
import { FT_CELLS } from '../src/seafarers-scenario-boards.ts';
import { getTopology } from '../src/topology-registry.ts';
import type { GameState, PlayerColor } from '../src/types.ts';
import { act, expectRejected, forceTurn, runSetup, scriptedRng, setHand } from './helpers.ts';
import { emptySeafarersGame, road, seafarersGame, settle, ship } from './seafarers-helpers.ts';

const PROFILE = 'sf-pirate-islands-2025';
const SH = PIRATE_ISLANDS_SOURCE.shift;

/** s7-A／s7-B 兩份獨立轉錄（逐格一致）的陸地格：轉錄座標 (q, r) → 地形、圓片、島編號。 */
const TRANSCRIBED_LAND: readonly [q: number, r: number, terrain: string, disc: number | null, island: number][] = [
  [0, 0, 'gold', 11, 2], [1, 0, 'mountains', 6, 2], [4, 0, 'fields', 4, 1], [5, 0, 'hills', 5, 1],
  [-1, 1, 'hills', null, 2], [2, 1, 'desert', null, 3], [4, 1, 'mountains', 9, 1], [5, 1, 'forest', 10, 1],
  [-2, 2, 'fields', 4, 2], [1, 2, 'desert', null, 3], [3, 2, 'forest', 3, 1], [4, 2, 'pasture', 8, 1], [5, 2, 'forest', 5, 1],
  [-1, 3, 'mountains', 8, 4], [2, 3, 'fields', 6, 1], [3, 3, 'hills', 9, 1], [4, 3, 'pasture', 12, 1],
  [-3, 4, 'fields', 10, 5], [0, 4, 'desert', null, 6], [2, 4, 'pasture', 11, 1], [3, 4, 'forest', 8, 1], [4, 4, 'pasture', 9, 1],
  [-3, 5, 'hills', null, 5], [0, 5, 'pasture', null, 6], [2, 5, 'mountains', 5, 1], [3, 5, 'forest', 2, 1],
  [-3, 6, 'gold', 3, 5], [-2, 6, 'mountains', 6, 5], [1, 6, 'fields', 10, 1], [2, 6, 'hills', 4, 1],
];

/** 轉錄的標記（兩份轉錄一致）：共用該交叉點／邊的格（轉錄座標，框外的格省略）。 */
const TRANSCRIBED_MARKERS = {
  red: { settlement: [[3, 1], [4, 0], [4, 1]], ship: [[3, 1], [4, 0]], fortress: [[0, 0]], beachhead: [[1, 0], [2, 0]] },
  white: { settlement: [[2, 2], [2, 3], [3, 2]], ship: [[2, 2], [2, 3]], fortress: [[-2, 2], [-1, 1], [-1, 2]], beachhead: [[-1, 2], [-1, 3], [0, 2]] },
  blue: { settlement: [[1, 4], [2, 3], [2, 4]], ship: [[1, 4], [2, 3]], fortress: [[-3, 4], [-3, 5], [-2, 4]], beachhead: [[-2, 4], [-1, 3], [-1, 4]] },
  orange: { settlement: [[1, 5], [1, 6], [2, 5]], ship: [[1, 5], [1, 6]], fortress: [[-3, 6]], beachhead: [[-2, 6], [-1, 6]] },
} as const;

/** 轉錄的航道（順時針，起點在最前）。 */
const TRANSCRIBED_ROUTE: readonly [number, number][] = [
  [0, 6], [-1, 6], [-1, 5], [-1, 4], [0, 3], [0, 2], [1, 1], [2, 0], [3, 0], [3, 1], [2, 2], [1, 3], [1, 4], [1, 5],
];

function tally<T extends string | number | null>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[String(value)] = (out[String(value)] ?? 0) + 1;
  return out;
}

const game = (players: 3 | 4 = 4, seed = 12345) => seafarersGame(players, seed, PROFILE);
const ready = (players: 3 | 4 = 4, seat = 0) => emptySeafarersGame(players, seat, 'action', PROFILE);
const slot = (state: GameState) => pirateIslandsView(state)!;
const score = (state: GameState, id: string) => scoreOf(state, id, { includeHidden: true });
const idx = (state: GameState, q: number, r: number): number => topologyOf(state).hexes.findIndex((cell) => cell.q === q + SH.dq && cell.r === r + SH.dr);
const sf = (state: GameState, id: string) => actionHints(state, id).modules!.seafarers as {
  legalShips: number[]; setupShips: number[]; movableShips: { edge: number; targets: number[] }[]; pirateLine: { next: string; target: number | null; end: number | null; edges: number[]; stuck: boolean; backtrack: boolean };
};
const clone = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;
const seatOf = (state: GameState, id: string) => state.players.findIndex((player) => player.id === id);

/** 轉錄座標的格集合（框外的略過）。 */
function hexesOf(state: GameState, vertex: number): number[][] {
  const topo = topologyOf(state);
  return topo.vertices[vertex]!.hexes.map((hex) => [topo.hexes[hex]!.q - SH.dq, topo.hexes[hex]!.r - SH.dr]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
}
const sorted = (cells: readonly (readonly number[])[]) => cells.map((cell) => [...cell]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);

/** 蓋一艘船（付 1 木 1 羊，輪到該玩家）。 */
function build(state: GameState, id: string, edge: number): GameState {
  forceTurn(state, seatOf(state, id), 'action');
  setHand(state, id, { lumber: 1, wool: 1 });
  return act(state, id, { type: 'build.ship', edge } as never).state;
}

/** 玩家船線可延伸的邊（一般合法、且是船線的延伸：接在端點、距離減 1）。 */
const lineEdges = (state: GameState, id: string): number[] => legalShipEdges(state, id).filter((edge) => {
  const step = lineShip(state, id, edge);
  return step.kind === 'line' && !step.restart;
});
/** 從另一個海岸建築重新開始船線的第一步（船線只有一艘船時）。 */
const restartEdges = (state: GameState, id: string): number[] => legalShipEdges(state, id).filter((edge) => {
  const step = lineShip(state, id, edge);
  return step.kind === 'line' && step.restart === true;
});

/**
 * 沿船線一艘一艘建到 `until`：`'fortress'` 是到達 beachhead（下一個目標變成堡壘），`'done'` 是到達堡壘。
 * 每一步都檢查新端點的距離恰好少 1。回傳最後的狀態。
 */
function sail(state: GameState, id: string, until: 'fortress' | 'done', pick: (edges: number[]) => number = (edges) => edges[0]!): GameState {
  let current = state;
  for (let guard = 0; guard < 20; guard++) {
    const before = lineContext(current, id)!;
    if (before.next === 'done' || (until === 'fortress' && before.next === 'fortress')) return current;
    const edge = pick(lineEdges(current, id));
    expect(edge, `${id} has a line extension`).toBeDefined();
    const step = lineShip(current, id, edge);
    expect(step.kind).toBe('line');
    current = build(current, id, edge);
    const after = lineContext(current, id)!;
    if (before.end !== null && before.next === after.next) {
      expect(after.dist[after.end!]).toBe(before.dist[before.end]! - 1);
    }
  }
  throw new Error('line never finished');
}

/** 海盜在框上、預置完成的局面（每位玩家的預置船就是船線的第一艘）。 */
function started(players: 3 | 4 = 4): GameState {
  return calm(ready(players));
}

/** 把 p1 的船線端點圍死：端點旁所有空著的邊都被 p4 的船占住（端點到目標在空著的海邊上完全不通）。 */
function wall(state: GameState): number {
  const topo = topologyOf(state);
  const end = lineContext(state, 'p1')!.end!;
  for (const edge of topo.vertices[end]!.edges) if (!state.board.roads[edge]) ship(state, 'p4', edge);
  return end;
}


/**
 * p1 的出發處是起點村落 S 與預置船的另一端 F。把它們旁邊的空邊用 p4 的船占住（直接放），只留下 `keep` 指定的出口；
 * 回傳出口邊 `exit` 與它另一端的頂點 X，並讓 p4 在 X 有一艘自己的船（可以接上去）。
 */
function narrow(keepFrom: 'F' | 'S', extend = false): { state: GameState; exit: number; x: number } {
  // `extend`：先延伸一艘（船線超過預置船之後，起點村落旁的海岸邊才是自由船，不會重新開始船線）。
  const state = extend ? build(started(4), 'p1', lineEdges(started(4), 'p1')[0]!) : started(4);
  const topo = topologyOf(state);
  const line = slot(state).lines.p1!;
  const start = line.start!;
  const far = lineContext(state, 'p1')!.end!;
  const anchor = keepFrom === 'F' ? far : start;
  const exits = topo.vertices[anchor]!.edges.filter((edge) => !state.board.roads[edge] && !isLineEdge(state, edge) && isSeaEdge(state, edge));
  expect(exits.length, 'a coastal exit').toBeGreaterThan(0);
  const exit = exits[0]!;
  for (const vertex of lineVertices(state, line)) {
    for (const edge of topo.vertices[vertex]!.edges) if (!state.board.roads[edge] && edge !== exit) ship(state, 'p4', edge);
  }
  const x = topo.edges[exit]!.vertices.find((vertex) => vertex !== anchor)!;
  // p4 在 X 放一艘自己的船（讓它接得上出口），選一條不切斷 p1 通往目標的邊。
  const attach = topo.vertices[x]!.edges.filter((edge) => edge !== exit && !state.board.roads[edge]).find((edge) => {
    const trial = clone(state);
    ship(trial, 'p4', edge);
    return wallContext(trial)!.players.some((player) => player.id === 'p1');
  });
  expect(attach, 'an attach edge that keeps p1 connected').toBeDefined();
  ship(state, 'p4', attach!);
  expect(wallContext(state)!.players.some((player) => player.id === 'p1')).toBe(true);
  return { state, exit, x };
}


/** 把海盜放到框上（`null`），讓它不擋船。 */
const calm = (state: GameState): GameState => { state.board.pirate = null; return state; };

/** 指定顏色開局（顏色不一定是紅、藍、橙、白）。 */
function createGameWithColors(colors: PlayerColor[], rng: Rng): GameState {
  return createGame({
    profileId: PROFILE,
    players: colors.map((color, index) => ({ id: `p${index + 1}`, nickname: `P${index + 1}`, color })),
    setupMode: 'fixed',
    rng,
  });
}

const seafarersModuleRules = (state: GameState) => seafarersModule.awardRules!(state, BASE_AWARD_RULES, { profile: getProfile(state.profileId)! });

/** 各玩家船線的長度 [到 beachhead 的船數, beachhead 到堡壘的船數]（從預置的船出發，海盜在框上）。 */
const EXPECTED_LINE_LENGTHS: Record<number, Record<string, number[]>> = {
  3: { p1: [6, 3], p2: [6, 3], p3: [6, 3] },
  4: { p1: [6, 3], p2: [6, 3], p3: [6, 3], p4: [6, 3] },
};

describe('Pirate Islands topology (SF25 pp. 16–17, spec §7.3)', () => {
  it('49 格外框 6-7-8-7-8-7-6，與 sf-forgotten-tribe 同形（hex／邊／頂點數）；8 個港口位置', () => {
    const topology = getTopology('sf-pirate-islands');
    const reference = getTopology('sf-forgotten-tribe');
    expect(topology.hexes).toHaveLength(49);
    const key = ({ q, r }: { q: number; r: number }) => `${r},${q}`;
    expect(topology.hexes.map(key).toSorted()).toEqual(FT_CELLS.map(key).toSorted());
    expect(topology.hexes.map(key)).toEqual(reference.hexes.map(key));
    expect([topology.edges.length, topology.vertices.length, topology.coastalEdges.length])
      .toEqual([reference.edges.length, reference.vertices.length, reference.coastalEdges.length]);
    expect(topology.vertices.length - topology.edges.length + topology.hexes.length).toBe(1);
    const rows = tally(topology.hexes.map((cell) => cell.r));
    expect([-3, -2, -1, 0, 1, 2, 3].map((r) => rows[r])).toEqual([6, 7, 8, 7, 8, 7, 6]);
    // 中排兩端的框突出部（WEST、EAST 標籤）不是格：轉錄 (-3,3)、(5,3) = repo (-4,0)、(4,0)。
    for (const q of [-4, 4]) expect(topology.hexes.some((cell) => cell.q === q && cell.r === 0)).toBe(false);
    expect(topology.harborSlots).toHaveLength(8);
    expect(new Set(topology.harborSlots).size).toBe(8);
    for (const edge of topology.harborSlots) expect(topology.coastalEdges).toContain(edge);
  });

  it('平移 (dq, dr) = (-1, -3)：轉錄各排 q 範圍與外框逐排一致（與 S5 同形）', () => {
    expect(PIRATE_ISLANDS_SOURCE.shift).toEqual({ dq: -1, dr: -3 });
    const transcribed: Record<number, [number, number]> = { 0: [0, 5], 1: [-1, 5], 2: [-2, 5], 3: [-2, 4], 4: [-3, 4], 5: [-3, 3], 6: [-3, 2] };
    const topology = getTopology('sf-pirate-islands');
    for (const [r, [from, to]] of Object.entries(transcribed)) {
      const qs = topology.hexes.filter((cell) => cell.r === Number(r) + SH.dr).map((cell) => cell.q - SH.dq).sort((a, b) => a - b);
      expect([qs[0], qs[qs.length - 1], qs.length]).toEqual([from, to, to - from + 1]);
    }
  });
});

describe('Pirate Islands layout checksums (SF25 p. 17 table)', () => {
  it('地形 海 19、沙漠 3、金礦 2、其餘各 5 = 49；圓片 24，6 格沒有圓片', () => {
    const { state } = game();
    const layout = state.board.layout;
    expect(tally(layout.terrain)).toEqual({ sea: 19, desert: 3, gold: 2, fields: 5, hills: 5, mountains: 5, pasture: 5, forest: 5 });
    const discs = layout.numbers.filter((n): n is number => n !== null);
    expect(tally(discs)).toEqual({ 2: 1, 3: 2, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3, 11: 2, 12: 1 });
    expect(discs).toHaveLength(24);
    const bare = layout.terrain.map((terrain, hex) => (terrain !== 'sea' && layout.numbers[hex] === null ? hex : -1)).filter((hex) => hex >= 0);
    expect(bare.toSorted((a, b) => a - b)).toEqual([[-1, 1], [2, 1], [1, 2], [-3, 5], [0, 4], [0, 5]].map(([q, r]) => idx(state, q!, r!)).toSorted((a, b) => a - b));
    // 沒有圓片的格：兩塊小丘、三塊沙漠與一塊草地。
    expect(tally(bare.map((hex) => layout.terrain[hex]!))).toEqual({ hills: 2, desert: 3, pasture: 1 });
  });

  it('逐格與兩份轉錄一致，其餘全是海；島 1 = 東島 17 格，其餘 2–6 為海盜群島', () => {
    const { state } = game();
    const layout = state.board.layout;
    const topo = topologyOf(state);
    expect(TRANSCRIBED_LAND).toHaveLength(30);
    for (const [q, r, terrain, disc, island] of TRANSCRIBED_LAND) {
      const hex = idx(state, q, r);
      expect(hex, `${q},${r}`).toBeGreaterThanOrEqual(0);
      expect([layout.terrain[hex], layout.numbers[hex], layout.islands[hex]], `${q},${r}`).toEqual([terrain, disc, island]);
    }
    const land = new Set(TRANSCRIBED_LAND.map(([q, r]) => idx(state, q, r)));
    topo.hexes.forEach((_, hex) => { if (!land.has(hex)) expect([layout.terrain[hex], layout.islands[hex]]).toEqual(['sea', 0]); });
    expect(tally(layout.islands.filter((island) => island > 0))).toEqual({ 1: 17, 2: 4, 3: 2, 4: 1, 5: 4, 6: 2 });
    // 島的分組就是陸地的連通分量（沒有兩個島編號相鄰）。
    topo.hexes.forEach((cell, hex) => {
      if (!isLandHex(state, hex)) return;
      topo.hexes.forEach((other, otherHex) => {
        const adjacent = Math.hypot(cell.x - other.x, cell.y - other.y) < 1.8;
        if (adjacent && isLandHex(state, otherHex)) expect(layout.islands[otherHex]).toBe(layout.islands[hex]);
      });
    });
  });

  it('8 個港口：5 個 2:1（各一種資源）+ 3 個 3:1，貼在東島朝向框的邊；種類隨 game rng，同 seed 同圖', () => {
    const { state } = game(4, 7);
    const topo = topologyOf(state);
    const harbors = state.board.layout.harbors;
    expect(harbors).toHaveLength(8);
    expect(harbors.map((harbor) => harbor.type).toSorted()).toEqual(['brick', 'generic', 'generic', 'generic', 'grain', 'lumber', 'ore', 'wool']);
    expect(harbors.map((harbor) => harbor.edge)).toEqual(topo.harborSlots);
    for (const { edge } of harbors) {
      expect(topo.edges[edge]!.hexes).toHaveLength(1);
      expect(state.board.layout.islands[topo.edges[edge]!.hexes[0]!]).toBe(1);
    }
    expect(game(4, 7).state.board.layout.harbors).toEqual(harbors);
    const kinds = new Set(Array.from({ length: 6 }, (_, seed) => JSON.stringify(game(4, seed + 1).state.board.layout.harbors.map((harbor) => harbor.type))));
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('航道：14 個海格的封閉單圈，順序與起點同轉錄；海盜在起點，強盜不使用', () => {
    const { state } = game();
    const topo = topologyOf(state);
    const route = routeHexes(topo);
    expect(PI_ROUTE).toHaveLength(14);
    expect(route.map((hex) => [topo.hexes[hex]!.q - SH.dq, topo.hexes[hex]!.r - SH.dr])).toEqual(TRANSCRIBED_ROUTE);
    expect(new Set(route).size).toBe(14);
    route.forEach((hex, index) => {
      expect(state.board.layout.terrain[hex]).toBe('sea');
      const next = route[(index + 1) % route.length]!;
      expect(Math.hypot(topo.hexes[hex]!.x - topo.hexes[next]!.x, topo.hexes[hex]!.y - topo.hexes[next]!.y)).toBeCloseTo(Math.sqrt(3), 5);
    });
    expect(state.board.pirate).toBe(route[0]);
    expect(slot(state).route).toEqual(route);
    expect(state.board.robber).toBe(-1);
    expect(state.board.layout.robber).toBe(-1);
  });
});

describe('Pirate Islands preset pieces (SF25 p. 16)', () => {
  it('預置的村落、船、堡壘與 beachhead 與兩份轉錄一致；東島海岸與海盜群島的位置', () => {
    const { state } = game();
    const topo = topologyOf(state);
    for (const { color, pieces } of PI_PIECES) {
      const expected = TRANSCRIBED_MARKERS[color];
      const settlement = cornerVertex(topo, pieces.settlement);
      const fortress = cornerVertex(topo, pieces.fortress);
      const beachhead = cornerVertex(topo, pieces.beachhead);
      const edge = sideEdge(topo, pieces.ship);
      expect(hexesOf(state, settlement), `${color} settlement`).toEqual(sorted(expected.settlement));
      expect(hexesOf(state, fortress), `${color} fortress`).toEqual(sorted(expected.fortress));
      expect(hexesOf(state, beachhead), `${color} beachhead`).toEqual(sorted(expected.beachhead));
      expect(topo.edges[edge]!.hexes.map((hex) => [topo.hexes[hex]!.q - SH.dq, topo.hexes[hex]!.r - SH.dr]).toSorted((a, b) => a[0]! - b[0]! || a[1]! - b[1]!), `${color} ship`).toEqual(sorted(expected.ship));
      // 村落與船在東島海岸：交叉點只碰東島，船貼在那個村落，且是東島周圍的海路（不是船線的邊）。
      const landIslands = (vertex: number) => topo.vertices[vertex]!.hexes.filter((hex) => isLandHex(state, hex)).map((hex) => state.board.layout.islands[hex]!);
      expect(new Set(landIslands(settlement))).toEqual(new Set([1]));
      expect(topo.edges[edge]!.vertices).toContain(settlement);
      expect(isLineEdge(state, edge)).toBe(false);
      // 堡壘與 beachhead 在海盜群島：碰到的陸地都不是東島。
      for (const vertex of [fortress, beachhead]) {
        expect(landIslands(vertex).length).toBeGreaterThan(0);
        expect(landIslands(vertex).every((island) => island >= 2)).toBe(true);
      }
    }
  });

  it('4 人：每人 1 村落 + 1 船在東島、1 堡壘（3 枚 lair）與 1 beachhead，共 12 枚 lair', () => {
    const { state } = game(4);
    const topo = topologyOf(state);
    expect(slot(state).fortresses).toHaveLength(4);
    expect(slot(state).fortresses.reduce((sum, fortress) => sum + fortress.lairs, 0)).toBe(12);
    expect(slot(state).beachheads).toHaveLength(4);
    state.players.forEach((player, seat) => {
      const { pieces } = PI_PIECES[seat]!;
      expect(player.color).toBe(PI_PIECES[seat]!.color);
      const mine = state.board.buildings.map((b, vertex) => (b?.player === player.id ? vertex : -1)).filter((vertex) => vertex >= 0);
      expect(mine.toSorted((a, b) => a - b)).toEqual([cornerVertex(topo, pieces.settlement), cornerVertex(topo, pieces.fortress)].toSorted((a, b) => a - b));
      expect(state.board.roads.map((road, edge) => (road?.player === player.id ? edge : -1)).filter((edge) => edge >= 0)).toEqual([sideEdge(topo, pieces.ship)]);
      expect(state.board.roads[sideEdge(topo, pieces.ship)]).toEqual({ player: player.id, ship: true });
      expect(slot(state).fortresses.find((fortress) => fortress.player === player.id)).toEqual({ player: player.id, vertex: cornerVertex(topo, pieces.fortress), lairs: 3 });
      expect(slot(state).beachheads.find((beachhead) => beachhead.player === player.id)!.vertex).toBe(cornerVertex(topo, pieces.beachhead));
    });
  });

  it('3 人：不放白色的位置（3 個堡壘、9 枚 lair、3 個 beachhead）', () => {
    const { state } = game(3);
    const topo = topologyOf(state);
    expect(slot(state).fortresses).toHaveLength(3);
    expect(slot(state).fortresses.reduce((sum, fortress) => sum + fortress.lairs, 0)).toBe(9);
    expect(slot(state).beachheads).toHaveLength(3);
    const white = PI_PIECES[3]!.pieces;
    for (const spec of [white.settlement, white.fortress]) expect(state.board.buildings[cornerVertex(topo, spec)]).toBeNull();
    expect(state.board.roads[sideEdge(topo, white.ship)]).toBeNull();
    expect(slot(state).beachheads.some((beachhead) => beachhead.vertex === cornerVertex(topo, white.beachhead))).toBe(false);
    expect(state.board.buildings.filter(Boolean)).toHaveLength(6);
  });

  it('顏色對得上的玩家拿該顏色的組別，其餘玩家依座位順序拿剩下的（3 人：綠、紅、藍）', () => {
    const rng = seededRng(5);
    const state = createGameWithColors(['green', 'red', 'blue'], rng);
    const topo = topologyOf(state);
    const owner = (vertex: number) => state.board.buildings[vertex]?.player;
    expect(owner(cornerVertex(topo, PI_PIECES[0]!.pieces.settlement))).toBe('p2');
    expect(owner(cornerVertex(topo, PI_PIECES[1]!.pieces.settlement))).toBe('p3');
    expect(owner(cornerVertex(topo, PI_PIECES[2]!.pieces.settlement))).toBe('p1');
    expect(state.board.buildings[cornerVertex(topo, PI_PIECES[3]!.pieces.settlement)]).toBeNull();
  });

  it('發展牌：3 人移除分數牌（20 張），4 人分數牌當騎士（25 張，騎士 19）', () => {
    const three = game(3).state.devDeck;
    expect(tally(three)).toEqual({ knight: 14, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 });
    expect(three).toHaveLength(20);
    const four = game(4).state.devDeck;
    expect(tally(four)).toEqual({ knight: 19, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 });
    expect(four).toHaveLength(25);
  });

  it('每人開局 1 村落，設置後 3 個村落、3 分（堡壘不算）；摘要不含堡壘以外的隱藏資訊', () => {
    const { state } = game(4);
    for (const player of state.players) expect(score(state, player.id)).toBe(1);
    const done = runSetup(state, seededRng(9));
    for (const player of done.players) {
      const mine = done.board.buildings.filter((b) => b?.player === player.id).length;
      expect(mine).toBe(4);
      expect(score(done, player.id)).toBe(3);
    }
    expect(done.turn.phase).toBe('preroll');
  });
});

describe('Pirate Islands setup and building rules', () => {
  it('起始村落只放東島：合法位置的陸地格都是東島，beachhead 與海盜群島不行', () => {
    const { state } = game(4);
    const topo = topologyOf(state);
    const legal = legalBuildingVertices(state, 'p1', { setup: true });
    expect(legal.length).toBeGreaterThan(10);
    for (const vertex of legal) {
      const islands = topo.vertices[vertex]!.hexes.filter((hex) => isLandHex(state, hex)).map((hex) => state.board.layout.islands[hex]);
      expect(islands.length).toBeGreaterThan(0);
      expect(islands.every((island) => island === 1)).toBe(true);
    }
    expect(actionHints(state, 'p1').legalSettlements.toSorted()).toEqual(legal.toSorted());
    const beachhead = slot(state).beachheads.find((entry) => entry.player === 'p1')!.vertex;
    expectRejected(state, 'p1', { type: 'setup.placeBuilding', vertex: beachhead }, 'E_ILLEGAL_TARGET');
  });

  it('整個設置都只在東島：每位玩家的 2 個起始村落都在東島（隨機種子多組）', () => {
    for (const seed of [1, 2, 3]) {
      const done = runSetup(game(4, seed).state, seededRng(seed));
      const locked = new Set(slot(done).fortresses.map((fortress) => fortress.vertex));
      done.board.buildings.forEach((building, vertex) => {
        if (!building || locked.has(vertex)) return;
        const islands = topologyOf(done).vertices[vertex]!.hexes.filter((hex) => isLandHex(done, hex)).map((hex) => done.board.layout.islands[hex]);
        expect(islands.every((island) => island === 1)).toBe(true);
      });
    }
  });

  it('不使用最長道路與最大軍隊；強盜不使用（7 只有棄牌，不開強盜步驟）', () => {
    const state = ready(4);
    const profile = getProfile(PROFILE)!;
    const rules = seafarersModuleRules(state);
    expect(rules.minLongestRoad).toBe(Number.POSITIVE_INFINITY);
    expect(rules.minLargestArmy).toBe(Number.POSITIVE_INFINITY);
    expect(profile.hasPirate).toBe(true);
    forceTurn(state, 0, 'preroll');
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng([3, 2])).state;
    expect(rolled.turn.dice).toEqual([4, 3]);
    expect(rolled.pending).toBeNull();
    expect(rolled.turn.phase).toBe('action');
    // 其他 Seafarers 劇本的 7 照舊要移強盜（robberInactive 只在這個劇本）。
    const other = emptySeafarersGame(3, 0, 'preroll', 'sf-forgotten-tribe-2025');
    const sevenOther = act(other, 'p1', { type: 'turn.roll' }, scriptedRng([3, 2])).state;
    expect(sevenOther.pending?.kind).toBe('moveRobber');
  });
});

describe('Pirate Islands robber and knights (agy P2)', () => {
  it('強盜不存在：沒有強盜或海盜目標；騎士牌在 S7c 前不能打出，也不會把強盜放回棋盤', () => {
    const state = ready(4);
    const hints = sf(state, 'p1') as unknown as { robberTargets: number[]; pirateTargets: (number | null)[] };
    expect(hints.robberTargets).toEqual([]);
    expect(hints.pirateTargets).toEqual([]);
    expect(legalRobberHexes(state, 'p1')).toEqual([]);
    state.players[0]!.devCards.push('knight');
    const land = state.board.layout.terrain.findIndex((terrain) => terrain !== 'sea');
    expectRejected(state, 'p1', { type: 'dev.playKnight', hex: land }, 'E_INVALID_COMMAND');
    expectRejected(state, 'p1', { type: 'dev.playKnight', hex: null }, 'E_INVALID_COMMAND');
    expect(state.board.robber).toBe(-1);
    expect(state.players[0]!.devCards).toContain('knight');
    // 其他劇本照舊：布匹產地仍有強盜目標，騎士牌可打。
    const cloth = emptySeafarersGame(3, 0, 'action', 'sf-cloth-for-catan-2025');
    expect((sf(cloth, 'p1') as unknown as { robberTargets: number[] }).robberTargets.length).toBeGreaterThan(0);
  });
});

describe('Pirate Islands fortress (SF25 p. 16: no production; p. 17: recaptured counts as a settlement)', () => {
  it('收復前不產出：資源與金礦都不給；收復（lair 全除）後照一般村落', () => {
    const state = ready(4);
    const blue = slot(state).fortresses.find((fortress) => fortress.player === 'p2')!;
    const fields10 = idx(state, -3, 4);
    const entitlements = () => productionForRoll(state, 10).find((result) => result.hex === fields10)!.entitlements;
    expect(fortressLocked(state, blue.vertex)).toBe(true);
    expect(entitlements()).toEqual([]);
    blue.lairs = 0;
    expect(fortressLocked(state, blue.vertex)).toBe(false);
    expect(entitlements()).toEqual([{ playerId: 'p2', amount: 1, vertex: blue.vertex }]);
    // 紅色堡壘貼著 11 號金礦。
    const red = slot(state).fortresses.find((fortress) => fortress.player === 'p1')!;
    expect(goldEntitlements(state, 11)).toEqual({});
    red.lairs = 1;
    expect(goldEntitlements(state, 11)).toEqual({});
    red.lairs = 0;
    expect(goldEntitlements(state, 11)).toEqual({ p1: 1 });
  });

  it('收復前不算分（村落分 −1）；收復後 +1', () => {
    const state = ready(4);
    expect(score(state, 'p1')).toBe(1);
    slot(state).fortresses.find((fortress) => fortress.player === 'p1')!.lairs = 0;
    expect(score(state, 'p1')).toBe(2);
    // 再蓋一個村落（beachhead 之外在海盜群島不行，所以放在東島）。
    settle(state, 'p1', legalBuildingVertices(state, 'p1', { requireConnection: false })[0]!);
    expect(score(state, 'p1')).toBe(3);
  });

  it('收復前不能升級成城市；收復後可以', () => {
    const state = ready(4);
    const red = slot(state).fortresses.find((fortress) => fortress.player === 'p1')!;
    setHand(state, 'p1', { grain: 2, ore: 3 });
    expect(actionHints(state, 'p1').legalCities).not.toContain(red.vertex);
    expectRejected(state, 'p1', { type: 'build.city', vertex: red.vertex }, 'E_ILLEGAL_TARGET');
    red.lairs = 0;
    expect(actionHints(state, 'p1').legalCities).toContain(red.vertex);
    const upgraded = act(state, 'p1', { type: 'build.city', vertex: red.vertex }).state;
    expect(upgraded.board.buildings[red.vertex]).toEqual({ player: 'p1', city: true });
  });

  it('堡壘是棋盤上的建築：別人的船不能穿過，村落配件照算（開局 2 個，設置後 4 個，剩 1 個）', () => {
    const state = ready(4);
    const red = slot(state).fortresses.find((fortress) => fortress.player === 'p1')!;
    const topo = topologyOf(state);
    expect(state.board.buildings[red.vertex]).toEqual({ player: 'p1', city: false });
    // p2 的船不能接在 p1 的堡壘上（會穿過別人的建築）。
    const touching = topo.vertices[red.vertex]!.edges.filter((edge) => !state.board.roads[edge]);
    expect(touching.length).toBeGreaterThan(0);
    for (const edge of touching) expect(canPlaceShip(state, 'p2', edge)).toBe(false);
    const done = runSetup(game(4).state, seededRng(4));
    const settlements = done.board.buildings.filter((b) => b?.player === 'p1' && !b.city).length;
    expect(settlements).toBe(4);
    expect(getProfile(PROFILE)!.pieces.settlements - settlements).toBe(1);
  });
});

describe('Pirate Islands ship line (SF25 p. 16 Shipbuilding; spec §6.6, OQ-3)', () => {
  it('預置的船是船線的第一艘，起點是預置的海岸村落；大島周圍的其他海路是自由的', () => {
    const state = started(4);
    const topo = topologyOf(state);
    for (const [seat, { pieces }] of PI_PIECES.entries()) {
      const id = `p${seat + 1}`;
      const edge = sideEdge(topo, pieces.ship);
      expect(isLineEdge(state, edge)).toBe(false);
      expect(slot(state).lines[id]).toEqual({ start: cornerVertex(topo, pieces.settlement), edges: [edge] });
    }
    // 沿海岸（碰到東島）的邊不是船線的邊；不是船線的延伸時一律自由，連蓋兩艘不改變船線。
    // 船線延伸超過預置船之後，沿海岸的邊才是自由的（只有一艘船時，從起點村落的最短第一步會重新開始船線）。
    let current = build(state, 'p1', lineEdges(state, 'p1')[0]!);
    const before = JSON.parse(JSON.stringify(slot(current).lines.p1)) as unknown;
    for (let i = 0; i < 2; i++) {
      const free = legalShipEdges(current, 'p1').filter((edge) => lineShip(current, 'p1', edge).kind === 'free');
      expect(free.length).toBeGreaterThan(0);
      current = build(current, 'p1', free[0]!);
    }
    expect(slot(current).lines.p1).toEqual(before);
  });

  it('船線的延伸必須讓到下一個目標的距離減 1：不朝目標的船線邊被拒絕（E_SHIP_LINE）', () => {
    const state = started(4);
    const topo = topologyOf(state);
    const base = legalShipEdges(state, 'p1', { line: null }).filter((edge) => isLineEdge(state, edge));
    const allowed = lineEdges(state, 'p1');
    expect(allowed.length).toBeGreaterThan(0);
    const wrong = base.filter((edge) => !allowed.includes(edge));
    expect(wrong.length).toBeGreaterThan(0);
    for (const edge of wrong) expect(lineShip(state, 'p1', edge).kind).toBe('refused');
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    expectRejected(state, 'p1', { type: 'build.ship', edge: wrong[0]! } as never, 'E_SHIP_LINE');
    const ctx = lineContext(state, 'p1')!;
    for (const edge of allowed) {
      const step = lineShip(state, 'p1', edge);
      expect(step.kind).toBe('line');
      if (step.kind === 'line') {
        expect(step.from).toBe(ctx.end);
        expect(ctx.dist[step.to]).toBe(ctx.dist[step.from]! - 1);
        expect(topo.edges[edge]!.vertices).toContain(step.from);
      }
    }
    // hints 只列合法的船：不含被拒絕的船線邊。
    const hinted = sf(state, 'p1').legalShips;
    for (const edge of wrong) expect(hinted).not.toContain(edge);
    for (const edge of allowed) expect(hinted).toContain(edge);
  });

  it('每位玩家的船線都能一艘一艘走到 beachhead、再到堡壘；每步距離減 1、路徑簡單、不超過 15 艘', () => {
    for (const players of [3, 4] as const) {
      const base = started(players);
      const lengths: Record<string, number[]> = {};
      for (const player of base.players) {
        // 每位玩家在各自的局面上走（別人的船線可能擋住路，那是另一回事，見模擬）。
        const toBeachhead = sail(clone(base), player.id, 'fortress');
        expect(lineContext(toBeachhead, player.id)!.next).toBe('fortress');
        const beachhead = slot(toBeachhead).beachheads.find((entry) => entry.player === player.id)!.vertex;
        expect(lineVertices(toBeachhead, slot(toBeachhead).lines[player.id]!)).toContain(beachhead);
        expect(lineContext(toBeachhead, player.id)!.end).toBe(beachhead);
        const first = slot(toBeachhead).lines[player.id]!.edges.length;
        const state = sail(toBeachhead, player.id, 'done');
        const line = slot(state).lines[player.id]!;
        const vertices = lineVertices(state, line);
        const fortress = slot(state).fortresses.find((entry) => entry.player === player.id)!.vertex;
        expect(lineContext(state, player.id)!.next).toBe('done');
        expect(vertices[vertices.length - 1]).toBe(fortress);
        expect(new Set(vertices).size).toBe(vertices.length);
        // 起點是預置的海岸村落（自己在東島的海岸建築），第一艘是預置的船。
        const topo = topologyOf(state);
        expect(line.start).toBe(slot(base).lines[player.id]!.start);
        expect(line.edges[0]).toBe(slot(base).lines[player.id]!.edges[0]);
        expect(state.board.buildings[line.start!]?.player).toBe(player.id);
        expect(topo.vertices[line.start!]!.hexes.some((hex) => isLandHex(state, hex) && state.board.layout.islands[hex] === 1)).toBe(true);
        const ships = state.board.roads.filter((road) => road?.ship && road.player === player.id).length;
        expect(ships).toBeLessThanOrEqual(15);
        lengths[player.id] = [first, line.edges.length - first];
        // 完成之後不能再延伸船線（不碰東島的邊被拒絕），大島周圍的自由海路仍可。
        expect(lineEdges(state, player.id)).toEqual([]);
        const open = legalShipEdges(state, player.id, { line: null }).filter((edge) => isLineEdge(state, edge));
        for (const edge of open) expect(lineShip(state, player.id, edge)).toEqual({ kind: 'refused', reason: 'done' });
      }
      expect(Object.keys(lengths)).toHaveLength(players);
      expect(JSON.stringify(lengths)).toBe(JSON.stringify(EXPECTED_LINE_LENGTHS[players]));
    }
  });

  it('船線沒有船時第一艘必須從自己在東島的海岸建築出發：只有自由船的交叉點不能起始', () => {
    const state = started(4);
    const topo = topologyOf(state);
    const preset = slot(state).lines.p1!;
    const feeder = topo.edges[preset.edges[0]!]!.vertices.find((vertex) => vertex !== preset.start)!;
    // 船線空了（S7c 輸掉戰鬥後會發生）：預置船留在原處，但已不是船線。
    slot(state).lines.p1 = { start: null, edges: [] };
    // 預置船另一端（只有自己的船、沒有建築）接出去的不碰東島的邊：被拒絕。
    const fromFeeder = topo.vertices[feeder]!.edges.filter((edge) => isLineEdge(state, edge) && canPlaceShip(state, 'p1', edge, { line: null }));
    expect(fromFeeder.length).toBeGreaterThan(0);
    for (const edge of fromFeeder) expect(lineShip(state, 'p1', edge)).toEqual({ kind: 'refused', reason: 'not-at-end' });
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    expectRejected(state, 'p1', { type: 'build.ship', edge: fromFeeder[0]! } as never, 'E_SHIP_LINE');
    // 起始的船線邊都接在自己的建築上。
    for (const edge of lineEdges(state, 'p1')) {
      const step = lineShip(state, 'p1', edge);
      expect(step.kind === 'line' && state.board.buildings[step.from]?.player === 'p1').toBe(true);
    }
    // 在東島海岸再蓋一個村落，從它出發的船線邊合法，船線起點記在那個村落。
    const topoVertices = topo.vertices;
    const spot = legalBuildingVertices(state, 'p1', { requireConnection: false }).find((vertex) =>
      topoVertices[vertex]!.edges.some((edge) => { settle(state, 'p1', vertex); const ok = lineShip(state, 'p1', edge).kind === 'line' && canPlaceShip(state, 'p1', edge, { line: null }); state.board.buildings[vertex] = null; return ok; }));
    expect(spot).toBeDefined();
    settle(state, 'p1', spot!);
    const edge = lineEdges(state, 'p1')[0]!;
    const next = build(state, 'p1', edge);
    expect(slot(next).lines.p1!.start).toBe(spot);
    expect(slot(next).lines.p1!.edges).toEqual([edge]);
  });

  it('只能有一條不分叉的線：船線上只能接在端點，其他的船線邊被拒絕；沿海岸的邊仍自由', () => {
    let state = started(4);
    for (let i = 0; i < 3; i++) state = build(state, 'p1', lineEdges(state, 'p1')[0]!);
    const ctx = lineContext(state, 'p1')!;
    const line = slot(state).lines.p1!;
    expect(line.edges).toHaveLength(4);
    expect(ctx.end).not.toBe(line.start);
    const topo = topologyOf(state);
    const inner = lineVertices(state, line).filter((vertex) => vertex !== ctx.end);
    // 距離與 `lineShip` 用同一套可走的頂點：自己船線上除了端點以外的頂點到不了（不會繞回自己的線）。
    for (const vertex of inner) expect(ctx.dist[vertex]).toBe(-1);
    expect(ctx.dist[ctx.end!]).toBeGreaterThan(0);
    const branch = inner.flatMap((vertex) => topo.vertices[vertex]!.edges.filter((edge) => canPlaceShip(state, 'p1', edge, { line: null })));
    expect(branch.length).toBeGreaterThan(0);
    for (const edge of branch) {
      if (isLineEdge(state, edge)) {
        expect(lineShip(state, 'p1', edge)).toEqual({ kind: 'refused', reason: 'not-at-end' });
        expectRejected(state, 'p1', { type: 'build.ship', edge } as never, 'E_SHIP_LINE');
      } else {
        expect(lineShip(state, 'p1', edge).kind).toBe('free');
      }
    }
    for (const edge of lineEdges(state, 'p1')) expect(topo.edges[edge]!.vertices).toContain(ctx.end!);
  });

  it('別人的船擋住最短路徑時，繞路上的每一步仍合法（距離減 1）；別人的建築擋住的交叉點不能經過', () => {
    // 找一個被擋後還有繞路的情況：沿某位玩家的最短路徑走，每一步試著用別人的船占住其中一個候選邊。
    let found: { state: GameState; id: string; before: number; after: number } | null = null;
    for (const id of ['p1', 'p2', 'p3']) {
      let state = started(4);
      for (let step = 0; step < 6 && !found; step++) {
        const ctx = lineContext(state, id)!;
        if (ctx.next !== 'beachhead') break;
        for (const edge of lineEdges(state, id)) {
          const trial = clone(state);
          ship(trial, id === 'p4' ? 'p3' : 'p4', edge);
          const blocked = lineContext(trial, id)!;
          if (blocked.dist[ctx.end!]! > ctx.dist[ctx.end!]!) { found = { state: trial, id, before: ctx.dist[ctx.end!]!, after: blocked.dist[ctx.end!]! }; break; }
        }
        state = build(state, id, lineEdges(state, id)[0]!);
      }
      if (found) break;
    }
    expect(found, 'some blocked step has a detour').not.toBeNull();
    const { state: detour, id, before, after } = found!;
    expect(after).toBeGreaterThan(before);
    const reached = sail(detour, id, 'fortress');
    expect(lineContext(reached, id)!.next).toBe('fortress');
    // 建築：目標旁的交叉點全被 p2 的建築占住，距離表到不了任何地方。
    const clean = started(4);
    const topo = topologyOf(clean);
    const target = lineContext(clean, 'p1')!.targetVertex!;
    for (const edge of topo.vertices[target]!.edges) {
      const [a, b] = topo.edges[edge]!.vertices;
      settle(clean, 'p2', a === target ? b : a);
    }
    expect(lineContext(clean, 'p1')!.dist.filter((distance) => distance > 0)).toHaveLength(0);
  });

  it('被圍死時末端的船可以移動（退回），沒被圍死時不行；hint 標出被圍住', () => {
    let state = started(4);
    for (let i = 0; i < 2; i++) state = build(state, 'p1', lineEdges(state, 'p1')[0]!);
    state.windowId += 1;
    forceTurn(state, 0, 'action');
    const line = slot(state).lines.p1!;
    expect(line.edges).toHaveLength(3);
    expect(sf(state, 'p1').pirateLine.stuck).toBe(false);
    expect(sf(state, 'p1').movableShips.some((entry) => line.edges.includes(entry.edge))).toBe(false);
    wall(state);
    expect(lineContext(state, 'p1')!.dist[lineContext(state, 'p1')!.end!]).toBe(-1);
    const movable = sf(state, 'p1').movableShips.filter((entry) => line.edges.includes(entry.edge));
    // 只有末端那一艘（不是起點的預置船，也不是中間的船）。
    expect(movable.map((entry) => entry.edge)).toEqual([line.edges[2]]);
    expect(sf(state, 'p1').pirateLine.stuck).toBe(true);
    expectRejected(state, 'p1', { type: 'ship.move', from: line.edges[1]!, to: movable[0]!.targets[0]! } as never, 'E_SHIP_NOT_MOVABLE');
    // 旗標關掉：照舊不可移動，hint 也不標。
    const profile = getProfile(PROFILE)!;
    try {
      profile.stuckLineBacktrack = false;
      expect(sf(state, 'p1').movableShips.some((entry) => line.edges.includes(entry.edge))).toBe(false);
      expect(sf(state, 'p1').pirateLine.stuck).toBe(false);
    } finally {
      profile.stuckLineBacktrack = true;
    }
  });

  it('末端船的遠端接著自己的自由船時不能退回（會留下與建築斷開的孤立船）；接著自己的建築可以', () => {
    let state = started(4);
    for (let i = 0; i < 2; i++) state = build(state, 'p1', lineEdges(state, 'p1')[0]!);
    state.windowId += 1;
    forceTurn(state, 0, 'action');
    const line = slot(state).lines.p1!;
    const last = line.edges[line.edges.length - 1]!;
    const topo = topologyOf(state);
    const end = lineContext(state, 'p1')!.end!;
    // 端點 V 上再接一艘自己的自由船 F1，第三條邊被對手的船占住：被圍死，但 E1 不可移動。
    const spare = topo.vertices[end]!.edges.find((edge) => !state.board.roads[edge])!;
    ship(state, 'p1', spare);
    wall(state);
    expect(lineBacktrack(state, 'p1', last)).toBe(true);
    expect(lineBacktrackMovable(state, 'p1', last)).toBe(false);
    expect(sf(state, 'p1').movableShips.some((entry) => entry.edge === last)).toBe(false);
    // 被圍住（stuck），但此刻末端船不能動（backtrack 為假）。
    expect(sf(state, 'p1').pirateLine).toMatchObject({ stuck: true, backtrack: false });
    expectRejected(state, 'p1', { type: 'ship.move', from: last, to: spare } as never, 'E_SHIP_NOT_MOVABLE');
    // 遠端只接著自己的建築（沒有其他自己的船）：可以退回。
    let built = started(4);
    for (let i = 0; i < 2; i++) built = build(built, 'p1', lineEdges(built, 'p1')[0]!);
    built.windowId += 1;
    forceTurn(built, 0, 'action');
    const end2 = wall(built);
    settle(built, 'p1', end2);
    expect(lineBacktrackMovable(built, 'p1', slot(built).lines.p1!.edges.at(-1)!)).toBe(true);
  });

  it('移走末端的船後船線截短（端點退一格）；移走之後仍不通就可以再退，一路退到沒有船線', () => {
    let state = started(4);
    for (let i = 0; i < 2; i++) state = build(state, 'p1', lineEdges(state, 'p1')[0]!);
    const topo = topologyOf(state);
    const first = [...slot(state).lines.p1!.edges];
    const firstVertices = lineVertices(state, slot(state).lines.p1!);
    // 把目標圍死（目標旁的交叉點被 p2 的建築占住）：不論退到哪一格都不通。
    const target = lineContext(state, 'p1')!.targetVertex!;
    for (const edge of topo.vertices[target]!.edges) {
      const [a, b] = topo.edges[edge]!.vertices;
      settle(state, 'p2', a === target ? b : a);
    }
    expect(lineContext(state, 'p1')!.dist[lineContext(state, 'p1')!.end!]).toBe(-1);
    for (let remaining = first.length; remaining > 0; remaining--) {
      state.windowId += 1;
      forceTurn(state, 0, 'action');
      const line = slot(state).lines.p1!;
      expect(line.edges).toEqual(first.slice(0, remaining));
      const movable = sf(state, 'p1').movableShips.filter((entry) => line.edges.includes(entry.edge));
      expect(movable.map((entry) => entry.edge)).toEqual([line.edges[remaining - 1]]);
      const end = lineContext(state, 'p1')!.end;
      // 自由的位置不碰船線上除了起點建築以外的頂點（否則那艘自由船會接在端點上，下一艘末端船就不能退了）。
      const free = movable[0]!.targets.find((edge) => lineShip(state, 'p1', edge, { moving: movable[0]!.edge }).kind === 'free'
        && !topologyOf(state).edges[edge]!.vertices.some((vertex) => firstVertices.slice(1).includes(vertex)));
      expect(free, 'a free coastal place to put the ship').toBeDefined();
      state = act(state, 'p1', { type: 'ship.move', from: movable[0]!.edge, to: free! } as never).state;
      const after = slot(state).lines.p1!;
      expect(after.edges).toEqual(first.slice(0, remaining - 1));
      expect(after.start).toBe(remaining > 1 ? slot(started(4)).lines.p1!.start : null);
      // 新的端點是被移走那艘船的另一端。
      if (remaining > 1) expect(lineContext(state, 'p1')!.end).not.toBe(end);
    }
    // 一艘都不剩：沒有船線，只能從東島的海岸建築重新起頭。
    expect(slot(state).lines.p1).toEqual({ start: null, edges: [] });
  });

  it('退回後回到嚴格的最短路徑，並找得到新路到達目標', () => {
    let state = started(4);
    for (let i = 0; i < 2; i++) state = build(state, 'p1', lineEdges(state, 'p1')[0]!);
    state.windowId += 1;
    forceTurn(state, 0, 'action');
    const line = [...slot(state).lines.p1!.edges];
    wall(state);
    const last = line[2]!;
    const movable = sf(state, 'p1').movableShips.find((entry) => entry.edge === last)!;
    // 目標：把船線上最後一艘換個位置，繼續走（嚴格規則：接在新端點、距離減 1）。
    const extension = movable.targets.find((edge) => lineShip(state, 'p1', edge, { moving: last }).kind === 'line');
    expect(extension, 'a strict extension from the new end').toBeDefined();
    const ctxAfterTruncation = lineContext(state, 'p1', last)!;
    state = act(state, 'p1', { type: 'ship.move', from: last, to: extension! } as never).state;
    const moved = slot(state).lines.p1!;
    expect(moved.edges.slice(0, 2)).toEqual(line.slice(0, 2));
    expect(moved.edges).toHaveLength(3);
    const step = topologyOf(state).edges[extension!]!.vertices;
    expect(step).toContain(ctxAfterTruncation.end!);
    // 之後每一步都是嚴格規則（sail 檢查距離恰好 −1），走到 beachhead。
    const reached = sail(state, 'p1', 'fortress');
    expect(lineContext(reached, 'p1')!.next).toBe('fortress');
  });

  it('其他劇本沒有退回：布匹產地的船照一般規則，hints 沒有 pirateLine（D7）', () => {
    const cloth = emptySeafarersGame(3, 0, 'action', 'sf-cloth-for-catan-2025');
    expect(Object.keys(actionHints(cloth, 'p1').modules!.seafarers as object)).not.toContain('pirateLine');
    expect(lineBacktrack(cloth, 'p1', 0)).toBe(false);
  });

  it('beachhead：自己的船線（船）到達後才可蓋村落（照常付費）；只有自己的 beachhead，海盜群島其餘處不行', () => {
    let state = started(4);
    const beachhead = slot(state).beachheads.find((entry) => entry.player === 'p1')!.vertex;
    expect(legalBuildingVertices(state, 'p1')).not.toContain(beachhead);
    state = sail(state, 'p1', 'fortress');
    forceTurn(state, 0, 'action');
    setHand(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    expect(legalBuildingVertices(state, 'p1')).toContain(beachhead);
    const topo = topologyOf(state);
    const west = legalBuildingVertices(state, 'p1').filter((vertex) => topo.vertices[vertex]!.hexes.some((hex) => isLandHex(state, hex) && state.board.layout.islands[hex] !== 1));
    expect(west).toEqual([beachhead]);
    const bankBefore = { ...state.bank };
    const built = act(state, 'p1', { type: 'build.settlement', vertex: beachhead }).state;
    expect(built.board.buildings[beachhead]).toEqual({ player: 'p1', city: false });
    expect(built.players[0]!.resources).toEqual({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
    expect(built.bank.lumber).toBe(bankBefore.lumber + 1);
    expect(score(built, 'p1')).toBe(score(state, 'p1') + 1);
    // 蓋了村落之後船線照樣能接到堡壘；從這個合法取得的村落可以接路。
    const roadsFromIt = actionHints(built, 'p1').legalRoads.filter((edge) => topo.edges[edge]!.vertices.includes(beachhead));
    expect(roadsFromIt.length).toBeGreaterThan(0);
    expect(lineContext(sail(built, 'p1', 'done'), 'p1')!.next).toBe('done');
    // 別人的 beachhead 不行：p2 的船到了 p1 的 beachhead 也不能蓋。
    const other = started(4);
    const edge = topo.vertices[beachhead]!.edges.find((candidate) => !other.board.roads[candidate])!;
    ship(other, 'p2', edge);
    expect(legalBuildingVertices(other, 'p2')).not.toContain(beachhead);
  });

  it('船線上的船（含預置的船）不可移動；自由船照一般規則，移到船線的邊時也受最短路徑限制', () => {
    let state = started(4);
    state = build(state, 'p1', lineEdges(state, 'p1')[0]!);
    const line = slot(state).lines.p1!;
    state.windowId += 1;
    forceTurn(state, 0, 'action');
    expect(sf(state, 'p1').movableShips.some((entry) => line.edges.includes(entry.edge))).toBe(false);
    expectRejected(state, 'p1', { type: 'ship.move', from: line.edges[0]!, to: lineEdges(state, 'p1')[0]! } as never, 'E_SHIP_NOT_MOVABLE');
    // 自由的沿海岸船：下一個行動窗口可以移動；移到不合規的船線邊被拒絕。
    const fresh = build(started(4), 'p1', lineEdges(started(4), 'p1')[0]!);
    const free = legalShipEdges(fresh, 'p1').find((edge) => lineShip(fresh, 'p1', edge).kind === 'free')!;
    let moved = build(fresh, 'p1', free);
    moved.windowId += 1;
    forceTurn(moved, 0, 'action');
    const entry = sf(moved, 'p1').movableShips.find((candidate) => candidate.edge === free);
    expect(entry).toBeDefined();
    for (const target of entry!.targets) {
      if (isLineEdge(moved, target)) expect(lineShip(moved, 'p1', target, { moving: free }).kind).toBe('line');
    }
    const wrong = legalShipEdges(moved, 'p1', { moving: free, line: null }).filter((edge) => isLineEdge(moved, edge) && !entry!.targets.includes(edge));
    expect(wrong.length).toBeGreaterThan(0);
    expectRejected(moved, 'p1', { type: 'ship.move', from: free, to: wrong[0]! } as never, 'E_SHIP_LINE');
    moved = clone(moved);
    expect(slot(moved).lines.p1!.edges).toHaveLength(2);
  });

  it('設置的船：接在新村落上的船線邊不是船線的延伸，一律被拒絕；沿海岸的船自由', () => {
    const { state, rng } = game(4, 21);
    calm(state);
    const topo = topologyOf(state);
    const legal = legalBuildingVertices(state, 'p1', { setup: true });
    const vertex = legal.find((candidate) => topo.vertices[candidate]!.edges.some((edge) => isLineEdge(state, edge) && !state.board.roads[edge]
      && canPlaceShip(state, 'p1', edge, { setupVertex: candidate, line: null })))!;
    expect(vertex).toBeDefined();
    const placed = act(state, 'p1', { type: 'setup.placeBuilding', vertex }, rng).state;
    const ships = sf(placed, 'p1').setupShips;
    const baseline = legalShipEdges(placed, 'p1', { setupVertex: vertex, line: null });
    const lineOnly = baseline.filter((edge) => isLineEdge(placed, edge));
    expect(lineOnly.length).toBeGreaterThan(0);
    const steps = new Map(baseline.map((edge) => [edge, lineShip(placed, 'p1', edge, { setupVertex: vertex })]));
    const kinds = new Map([...steps].map(([edge, step]) => [edge, step.kind]));
    // 只有接在船線端點、距離減 1 的才是延伸；其餘不碰東島的邊一律拒絕（E_SHIP_LINE），沿海岸的自由。
    for (const edge of lineOnly) {
      if (kinds.get(edge) === 'refused') {
        expect(ships).not.toContain(edge);
        expectRejected(placed, 'p1', { type: 'setup.placeShip', edge } as never, 'E_SHIP_LINE', rng);
      }
    }
    expect(ships.toSorted()).toEqual(baseline.filter((edge) => kinds.get(edge) !== 'refused').toSorted());
    const accepted = ships[0];
    if (accepted !== undefined) {
      const next = act(placed, 'p1', { type: 'setup.placeShip', edge: accepted } as never, rng).state;
      const step = steps.get(accepted)!;
      // 重新開始的船線只有這一艘；延伸多一艘；其餘不變。
      const expected = step.kind === 'line' ? (step.restart ? 1 : slot(placed).lines.p1!.edges.length + 1) : slot(placed).lines.p1!.edges.length;
      expect(slot(next).lines.p1!.edges).toHaveLength(expected);
    }
  });
});

describe('Pirate Islands: nobody may wall off a target (user decision 2026-11-24)', () => {
  it('放船會把別人的目標完全擋住時被拒（E_LINE_WALLED），hints 與 legalShipEdges 都不列', () => {
    const { state, exit } = narrow('F');
    forceTurn(state, 3, 'action');
    setHand(state, 'p4', { lumber: 1, wool: 1 });
    expect(wallContext(state)!.players.map((player) => player.id)).toContain('p1');
    expect(wallsAnyone(state, { edge: exit, owner: 'p4' })).toBe(true);
    expect(canPlaceShip(state, 'p4', exit)).toBe(false);
    expect(canPlaceShip(state, 'p4', exit, { walls: null })).toBe(true);
    expect(legalShipEdges(state, 'p4')).not.toContain(exit);
    expect(sf(state, 'p4').legalShips).not.toContain(exit);
    expectRejected(state, 'p4', { type: 'build.ship', edge: exit } as never, 'E_LINE_WALLED');
    // 沒有被圍住時同一條邊合法（回到沒有別的出口被占住的局面）。
    const open = started(4);
    expect(canPlaceShip(open, 'p4', exit, { walls: null })).toBe(canPlaceShip(open, 'p4', exit));
  });

  it('把自己的目標圍死也被拒；原本就不通時不擋其他動作', () => {
    const { state, exit, x } = narrow('S', true);
    // 自己的自由船放在唯一的出口上：p1 自己也到不了目標了。
    expect(canPlaceShip(state, 'p1', exit, { walls: null })).toBe(true);
    expect(canPlaceShip(state, 'p1', exit)).toBe(false);
    forceTurn(state, 0, 'action');
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    expectRejected(state, 'p1', { type: 'build.ship', edge: exit } as never, 'E_LINE_WALLED');
    // 出口也被占住：p1 原本就不通，不因此禁止其他玩家的動作。
    ship(state, 'p4', exit);
    expect(wallContext(state)!.players.map((player) => player.id)).not.toContain('p1');
    const topo = topologyOf(state);
    const elsewhere = legalShipEdges(state, 'p4').filter((edge) => !topo.edges[edge]!.vertices.includes(x));
    expect(elsewhere.length).toBeGreaterThan(0);
    for (const edge of elsewhere.slice(0, 5)) expect(wallsAnyone(state, { edge, owner: 'p4' })).toBe(false);
  });

  it('兩條船線搶同一條窄路：先動的一方走自己的嚴格最短延伸，即使會圍住對方（使用者決定 2026-11-24）', () => {
    let state = started(4);
    for (let i = 0; i < 2; i++) state = build(state, 'p1', lineEdges(state, 'p1')[0]!);
    const topo = topologyOf(state);
    const e = lineEdges(state, 'p1')[0]!;
    const end = lineContext(state, 'p1')!.end!;
    const to = topo.edges[e]!.vertices.find((vertex) => vertex !== end)!;
    // p2 的 beachhead 搬到 `to`（測試用的改動）；p2 的船線只有 f（接在 `end` 上），它的出發處 x 與 `end` 其他的邊都被封住：
    // p2 只能經過 e 走到它的目標。
    slot(state).beachheads.find((entry) => entry.player === 'p2')!.vertex = to;
    const f = topo.vertices[end]!.edges.find((edge) => edge !== e && !state.board.roads[edge])!;
    ship(state, 'p2', f);
    const x = topo.edges[f]!.vertices.find((vertex) => vertex !== end)!;
    slot(state).lines.p2 = { start: x, edges: [f] };
    for (const vertex of [end, x]) {
      for (const edge of topo.vertices[vertex]!.edges) if (edge !== e && !state.board.roads[edge]) ship(state, 'p4', edge);
    }
    expect(wallContext(state)!.players.map((player) => player.id)).toContain('p2');
    // 規則本身會說這條邊圍住 p2；但它是 p1 自己的嚴格最短延伸，所以合法。
    expect(wallsAnyone(state, { edge: e, owner: 'p1' })).toBe(true);
    expect(lineShip(state, 'p1', e).kind).toBe('line');
    expect(lineEdges(state, 'p1')).toContain(e);
    expect(canPlaceShip(state, 'p1', e)).toBe(true);
    expect(legalShipEdges(state, 'p1')).toContain(e);
    const next = build(state, 'p1', e);
    expect(slot(next).lines.p1!.edges).toContain(e);
    // 非最短延伸的放置（移船落在同一條邊）仍被檢查：同一條邊用移動的方式放就被拒。
    expect(canPlaceShip(state, 'p1', e, { moving: f, walls: undefined })).toBe(false);
  });

  it('自己的船線延伸走到 beachhead 不算圍死自己；移船也要檢查', () => {
    const state = started(4);
    state.windowId += 1;
    const sailed = sail(state, 'p1', 'fortress');
    expect(lineContext(sailed, 'p1')!.next).toBe('fortress');
    // 每一步延伸都是合法的（sail 內部用 build 並要求被接受）；移船：圍死別人的位置同樣被拒。
    const { state: moved, exit } = narrow('F');
    moved.windowId += 1;
    const free = legalShipEdges(moved, 'p4', { line: null, walls: null }).find((edge) => {
      if (isLineEdge(moved, edge) || edge === exit) return false;
      const trial = clone(moved);
      ship(trial, 'p4', edge);
      return wallContext(trial)!.players.some((player) => player.id === 'p1');
    })!;
    expect(free).toBeDefined();
    ship(moved, 'p4', free);
    moved.windowId += 1;
    forceTurn(moved, 3, 'action');
    expect(canPlaceShip(moved, 'p4', exit, { moving: free, line: null, walls: null })).toBe(true);
    expect(canPlaceShip(moved, 'p4', exit, { moving: free, line: null })).toBe(false);
  });

  it('村落蓋在唯一通路的海岸交叉點上，會圍死別人時不能蓋', () => {
    const { state, x } = narrow('F');
    const ctx = { profile: getProfile(PROFILE)! };
    const hook = seafarersModule.allowBuilding!;
    // X 是 p1 唯一出口的另一端（碰東島的海岸交叉點）：p2 的村落擋住它就圍死 p1。
    expect(topologyOf(state).vertices[x]!.hexes.some((hex) => isLandHex(state, hex))).toBe(true);
    expect(wallsAnyone(state, { vertex: x, owner: 'p2' })).toBe(true);
    expect(hook(state, 'p2', x, { setup: false }, ctx)).toBe(false);
    // p1 自己蓋不會擋住自己。
    expect(wallsAnyone(state, { vertex: x, owner: 'p1' })).toBe(false);
  });

  it('其他劇本不受影響（D7）', () => {
    const cloth = emptySeafarersGame(3, 0, 'action', 'sf-cloth-for-catan-2025');
    expect(wallContext(cloth)).toBeNull();
    expect(wallsAnyone(cloth, { edge: 0, owner: 'p1' })).toBe(false);
    expect(wallsAnyone(cloth, { vertex: 0, owner: 'p1' })).toBe(false);
  });

  it('hints 耗時：一次列出所有合法的船（含 hints 整包）在一般局面下很快', () => {
    const state = started(4);
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      const t0 = Date.now();
      for (let i = 0; i < 20; i++) legalShipEdges(state, id);
      const per = (Date.now() - t0) / 20;
      expect(per).toBeLessThan(50);
    }
    const t1 = Date.now();
    for (let i = 0; i < 10; i++) actionHints(state, 'p1');
    expect((Date.now() - t1) / 10).toBeLessThan(200);
  });
});

describe('Pirate Islands round 4 review fixes', () => {
  it('船線還沒延伸超過預置船時，可以從任一自己的東島海岸建築以最短第一步重新開始；預置船變自由船（codex）', () => {
    const { state } = seafarersGame(4, 7, PROFILE);
    forceTurn(state, 0, 'action');
    calm(state);
    const topo = topologyOf(state);
    const preset = [...slot(state).lines.p1!.edges];
    expect(preset).toHaveLength(1);
    // 原本鎖定的規則下，從別的海岸建築出發的船線邊都被拒絕；現在合法（codex：頂點 17 的村落、邊 19）。
    const candidates = legalBuildingVertices(state, 'p1', { requireConnection: false }).filter((vertex) => topo.vertices[vertex]!.edges.some((edge) => {
      settle(state, 'p1', vertex);
      const ok = restartEdges(state, 'p1').includes(edge) && topo.edges[edge]!.vertices.includes(vertex);
      state.board.buildings[vertex] = null;
      return ok;
    }));
    expect(candidates.length).toBeGreaterThan(0);
    const vertex = candidates.includes(17) ? 17 : candidates[0]!;
    settle(state, 'p1', vertex);
    const edge = restartEdges(state, 'p1').find((candidate) => topo.edges[candidate]!.vertices.includes(vertex))!;
    expect(sf(state, 'p1').legalShips).toContain(edge);
    expect(lineShip(state, 'p1', edge)).toMatchObject({ kind: 'line', from: vertex, restart: true });
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    const next = act(state, 'p1', { type: 'build.ship', edge } as never).state;
    expect(slot(next).lines.p1).toEqual({ start: vertex, edges: [edge] });
    // 預置船不再屬於船線：不再固定，下一個行動窗口可以照一般規則移動。
    expect(lineShipFixed(next, 'p1', preset[0]!)).toBe(false);
    expect(isLineEdge(next, preset[0]!)).toBe(false);
    // 船線一旦延伸超過一艘，就不能再重新開始。
    const longer = build(next, 'p1', lineEdges(next, 'p1')[0]!);
    expect(restartEdges(longer, 'p1')).toEqual([]);
  });

  it('船線必須先到 beachhead 才能到堡壘：到達 beachhead 之前堡壘頂點不能當經過點（codex）', () => {
    const state = started(4);
    const topo = topologyOf(state);
    // codex 的 fixture：邊 67、90、111 被占住。
    for (const edge of [67, 90, 111]) if (!state.board.roads[edge]) ship(state, 'p4', edge);
    for (const id of ['p1', 'p2', 'p3']) {
      const ctx = lineContext(state, id)!;
      const fortress = slot(state).fortresses.find((entry) => entry.player === id)!.vertex;
      const beachhead = slot(state).beachheads.find((entry) => entry.player === id)!.vertex;
      expect(ctx.next).toBe('beachhead');
      // 堡壘的頂點不能當經過點：到不了。
      expect(ctx.dist[fortress]).toBe(-1);
      // 走到 beachhead 的路上沒有經過堡壘；之後才輪到堡壘。
      const reached = sail(clone(state), id, 'fortress');
      const vertices = lineVertices(reached, slot(reached).lines[id]!);
      expect(vertices[vertices.length - 1]).toBe(beachhead);
      expect(vertices).not.toContain(fortress);
      expect(lineContext(reached, id)!.next).toBe('fortress');
      expect(topo.vertices[fortress]).toBeDefined();
    }
  });

  it('退回時用截短後的船線判定：從 beachhead 退回（目標變回 beachhead）與退回唯一的一艘（出發處是所有海岸建築）', () => {
    // 從 beachhead 退回：船線已到 beachhead（目標是堡壘），端點被圍死，末端那艘可以移走。
    let state = sail(started(4), 'p1', 'fortress');
    state.windowId += 1;
    forceTurn(state, 0, 'action');
    const last = slot(state).lines.p1!.edges.at(-1)!;
    wall(state);
    expect(lineBacktrackMovable(state, 'p1', last)).toBe(true);
    const entry = sf(state, 'p1').movableShips.find((candidate) => candidate.edge === last)!;
    expect(entry.targets.length).toBeGreaterThan(0);
    // 截短之後目標變回 beachhead，端點是前一個頂點。
    const truncated = lineContext(state, 'p1', last)!;
    expect(truncated.next).toBe('beachhead');
    expect(canPlaceShip(state, 'p1', entry.targets[0]!, { moving: last })).toBe(true);
    state = act(state, 'p1', { type: 'ship.move', from: last, to: entry.targets[0]! } as never).state;
    expect(lineContext(state, 'p1')!.next).toBe('beachhead');
    // 退回唯一的一艘：船線清空，出發處是所有海岸建築。
    const only = started(4);
    only.windowId += 1;
    forceTurn(only, 0, 'action');
    const preset = slot(only).lines.p1!.edges[0]!;
    wall(only);
    const move = sf(only, 'p1').movableShips.find((candidate) => candidate.edge === preset);
    expect(move).toBeDefined();
    expect(canPlaceShip(only, 'p1', move!.targets[0]!, { moving: preset })).toBe(true);
    const after = act(only, 'p1', { type: 'ship.move', from: preset, to: move!.targets[0]! } as never).state;
    expect(slot(after).lines.p1!.edges.length).toBeLessThanOrEqual(1);
  });

  it('hints：stuck 只表示被圍住，backtrack 與 movableShips 一致（此刻末端船真的能動）', () => {
    const state = started(4);
    state.windowId += 1;
    forceTurn(state, 0, 'action');
    const preset = slot(state).lines.p1!.edges[0]!;
    wall(state);
    expect(sf(state, 'p1').pirateLine).toMatchObject({ stuck: true, backtrack: true });
    expect(sf(state, 'p1').movableShips.some((entry) => entry.edge === preset)).toBe(true);
    // 不是行動階段：還是被圍住，但此刻不能移。
    const preroll = clone(state);
    forceTurn(preroll, 0, 'preroll');
    expect(sf(preroll, 'p1').pirateLine).toMatchObject({ stuck: true, backtrack: false });
    // 這個行動窗口已經移過一艘船：不能再移。
    const moved = clone(state);
    seafarersState(moved).moved = true;
    expect(sf(moved, 'p1').pirateLine).toMatchObject({ stuck: true, backtrack: false });
    // 不是自己的回合。
    expect(sf(state, 'p2').pirateLine.backtrack).toBe(false);
  });

  it('海岸的路若會圍死別人（或自己）的目標，roadAllowed 拒絕', () => {
    const { state, exit, x } = narrow('F');
    // p1 在 X 有村落，路接在它上面：路占住唯一的出口就圍死 p1 自己。
    settle(state, 'p1', x);
    expect(wallContext(state)!.players.some((player) => player.id === 'p1')).toBe(true);
    forceTurn(state, 0, 'action');
    setHand(state, 'p1', { lumber: 1, brick: 1 });
    expect(wallsAnyone(state, { edge: exit })).toBe(true);
    expect(roadAllowed(state, 'p1', exit)).toBe(false);
    expect(actionHints(state, 'p1').legalRoads).not.toContain(exit);
    expectRejected(state, 'p1', { type: 'build.road', edge: exit }, 'E_ILLEGAL_TARGET');
    // 沒有圍住時同一條路合法。
    const open = started(4);
    expect(roadAllowed(open, 'p1', exit)).toBe(true);
  });

  it('3 人與 4 人都是同一張圖：逐人數的檢查和（地形、圓片、島、港口、海盜起點、預置組別、lair 數）', () => {
    for (const players of [3, 4] as const) {
      const { state } = game(players, 11);
      const layout = state.board.layout;
      expect(tally(layout.terrain), `${players}p terrain`).toEqual({ sea: 19, desert: 3, gold: 2, fields: 5, hills: 5, mountains: 5, pasture: 5, forest: 5 });
      expect(layout.numbers.filter((n) => n !== null), `${players}p discs`).toHaveLength(24);
      expect(tally(layout.islands.filter((island) => island > 0)), `${players}p islands`).toEqual({ 1: 17, 2: 4, 3: 2, 4: 1, 5: 4, 6: 2 });
      expect(layout.harbors.map((harbor) => harbor.type).toSorted(), `${players}p harbors`).toEqual(['brick', 'generic', 'generic', 'generic', 'grain', 'lumber', 'ore', 'wool']);
      expect(state.board.pirate).toBe(routeHexes(topologyOf(state))[0]);
      expect(state.board.robber).toBe(-1);
      // 預置組別：3 人用紅、藍、橙，4 人再加白；每人 1 艘預置船與 3 枚 lair。
      expect(slot(state).fortresses).toHaveLength(players);
      expect(slot(state).fortresses.reduce((sum, fortress) => sum + fortress.lairs, 0), `${players}p lairs`).toBe(players * 3);
      expect(state.board.roads.filter((road) => road?.ship), `${players}p preset ships`).toHaveLength(players);
      expect(state.board.buildings.filter(Boolean), `${players}p buildings`).toHaveLength(players * 2);
      expect(state.devDeck, `${players}p deck`).toHaveLength(players === 3 ? 20 : 25);
    }
  });
});

describe('Pirate Islands round 5 review fixes', () => {
  /** 一個合法的海岸村落位置，旁邊有一條「不碰東島」的重新開始第一步（外海船）；`avoid` 是不能用的位置。 */
  function offshoreRestart(state: GameState, avoid: number[] = []): { vertex: number; edge: number } | null {
    const topo = topologyOf(state);
    for (const vertex of legalBuildingVertices(state, 'p1', { requireConnection: false })) {
      if (avoid.includes(vertex)) continue;
      settle(state, 'p1', vertex);
      const edge = restartEdges(state, 'p1').find((candidate) => isLineEdge(state, candidate) && topo.edges[candidate]!.vertices.includes(vertex));
      state.board.buildings[vertex] = null;
      if (edge !== undefined) return { vertex, edge };
    }
    return null;
  }

  it('舊的那艘船是外海船時不能重新開始（會留下船線外的孤兒外海船）：設置的兩次放置（4 人 seed 1，頂點 17／邊 19，頂點 21／邊 24）', () => {
    const { state: fresh, rng } = game(4, 1);
    let state = calm(fresh);
    const mine: { vertex: number; edge: number }[] = [{ vertex: 17, edge: 19 }, { vertex: 21, edge: 24 }];
    let turn = 0;
    let secondShip: number | null = null;
    for (let guard = 0; state.turn.phase === 'setup' && guard < 40; guard++) {
      const setup = state.turn.setup!;
      const actor = state.players[setup.order[setup.index]!]!.id;
      if (setup.stage === 'building') {
        const wanted = actor === 'p1' ? mine[turn]!.vertex : legalBuildingVertices(state, actor, { setup: true }).at(-1)!;
        state = act(state, actor, { type: 'setup.placeBuilding', vertex: wanted }, rng).state;
      } else if (actor === 'p1') {
        const edge = mine[turn]!.edge;
        if (turn === 1) {
          // 第二次：舊的那艘（邊 19）已是船線唯一的外海船，不能再重新開始（否則它變成船線外的孤兒外海船）；
          // 邊 24 是沿岸邊，所以只是一艘自由船，船線不變。
          secondShip = edge;
          expect(lineShip(state, 'p1', edge, { setupVertex: setup.lastVertex }).kind).toBe('free');
          expect(canPlaceShip(state, 'p1', edge, { setupVertex: setup.lastVertex })).toBe(true);
          state = act(state, 'p1', { type: 'setup.placeShip', edge } as never, rng).state;
        } else {
          expect(lineShip(state, 'p1', edge, { setupVertex: setup.lastVertex })).toMatchObject({ kind: 'line', restart: true });
          state = act(state, 'p1', { type: 'setup.placeShip', edge } as never, rng).state;
          expect(slot(state).lines.p1).toEqual({ start: 17, edges: [19] });
        }
        turn++;
      } else {
        state = act(state, actor, { type: 'setup.placeRoad', edge: actionHints(state, actor).legalRoads[0]! }, rng).state;
      }
    }
    expect(secondShip).toBe(24);
    // 邊 19 的船仍在船線記錄裡，沒有孤兒外海船。
    expect(slot(state).lines.p1!.edges).toEqual([19]);
    expect(state.board.roads[24]).toEqual({ player: 'p1', ship: true });
    // 建造的路徑：同樣的第二個位置在遊戲中也被拒。
    const built = calm(clone(state));
    forceTurn(built, 0, 'action');
    setHand(built, 'p1', { lumber: 1, wool: 1 });
    expect(restartEdges(built, 'p1')).toEqual([]);
    expect(lineShip(built, 'p1', 24).kind).toBe('free');
  });

  it('不得在別人船線上的頂點蓋村落（建造與設置、hints、訊息）', () => {
    const state = sail(started(4), 'p1', 'fortress');
    const line = slot(state).lines.p1!;
    const topo = topologyOf(state);
    const vertices = lineVertices(state, line);
    const landVertex = vertices.find((vertex, index) => index > 0 && index < vertices.length - 1 && topo.vertices[vertex]!.hexes.some((hex) => isLandHex(state, hex)) && !state.board.buildings[vertex]);
    expect(landVertex, 'an interior land vertex of the line').toBeDefined();
    expect(villageWalls(state, 'p3', landVertex!)).toBe(true);
    // 自己的船線上不受限制（它是自己的建築位置）。
    expect(villageWalls(state, 'p1', landVertex!)).toBe(false);
    const ctx = { profile: getProfile(PROFILE)! };
    expect(seafarersModule.allowBuilding!(state, 'p3', landVertex!, { setup: false }, ctx)).toBe(false);
    expect(seafarersModule.allowBuilding!(state, 'p3', landVertex!, { setup: true }, ctx)).toBe(false);
    expect(seafarersModule.vetoCommand!(state, 'p3', { type: 'build.settlement', vertex: landVertex! }, ctx)).toMatchObject({ ok: false, error: { code: 'E_LINE_WALLED' } });
    expect(seafarersModule.vetoCommand!(state, 'p3', { type: 'setup.placeBuilding', vertex: landVertex! }, ctx)).toMatchObject({ ok: false, error: { code: 'E_LINE_WALLED' } });
    expect(legalBuildingVertices(state, 'p3', { requireConnection: false })).not.toContain(landVertex!);
    // 其他劇本沒有這條限制。
    const cloth = emptySeafarersGame(3, 0, 'action', 'sf-cloth-for-catan-2025');
    expect(villageWalls(cloth, 'p1', 0)).toBe(false);
  });

  it('重新開始船線也走不得圍死的檢查（只豁免現有船線末端的嚴格延伸）；起點是自己的建築，別人本來就走不過去', () => {
    const state = started(4);
    const found = offshoreRestart(state);
    expect(found).not.toBeNull();
    settle(state, 'p1', found!.vertex);
    expect(lineShip(state, 'p1', found!.edge)).toMatchObject({ kind: 'line', restart: true });
    // 重新開始的第一步不會圍死任何人（出發點是自己的建築，別人過不了）：兩種判定一致，且合法。
    expect(canPlaceShip(state, 'p1', found!.edge, { walls: null })).toBe(true);
    expect(canPlaceShip(state, 'p1', found!.edge)).toBe(true);
    // 檢查確實執行：把 p1 自己的路徑封死（出發點旁其他邊都占住、目標遠端也占住），重新開始就會圍死自己而被拒。
    const topo = topologyOf(state);
    const to = (lineShip(state, 'p1', found!.edge) as { to: number }).to;
    const target = lineContext(state, 'p1', undefined, { start: null, edges: [] })!.targetVertex!;
    for (const edge of topo.vertices[target]!.edges) if (!state.board.roads[edge]) ship(state, 'p4', edge);
    expect(topo.vertices[to]).toBeDefined();
    expect(canPlaceShip(state, 'p1', found!.edge)).toBe(canPlaceShip(state, 'p1', found!.edge, { walls: null }) && !wallsAnyone(state, { edge: found!.edge, owner: 'p1', extend: to, from: found!.vertex, restart: true }));
  });

  it('hints 說明為什麼被圍住卻不能移末端船（backtrackBlocked）', () => {
    const base = started(4);
    base.windowId += 1;
    forceTurn(base, 0, 'action');
    const last = slot(base).lines.p1!.edges.at(-1)!;
    wall(base);
    const reason = (state: GameState) => (sf(state, 'p1').pirateLine as unknown as { backtrack: boolean; backtrackBlocked: string | null });
    expect(reason(base)).toMatchObject({ backtrack: true, backtrackBlocked: null });
    const preroll = clone(base);
    forceTurn(preroll, 0, 'preroll');
    expect(reason(preroll).backtrackBlocked).toBe('phase');
    const moved = clone(base);
    seafarersState(moved).moved = true;
    expect(reason(moved).backtrackBlocked).toBe('moved');
    const built = clone(base);
    seafarersState(built).built.push(last);
    expect(reason(built).backtrackBlocked).toBe('builtThisTurn');
    const pirate = clone(base);
    pirate.board.pirate = topologyOf(pirate).edges[last]!.hexes.find((hex) => !isLandHex(pirate, hex)) ?? null;
    expect(reason(pirate).backtrackBlocked).toBe('pirate');
    // 遠端接著自己的自由船：attached。
    const attached = clone(base);
    const end = lineContext(attached, 'p1')!.end!;
    const spare = topologyOf(attached).vertices[end]!.edges.find((edge) => !attached.board.roads[edge]);
    if (spare !== undefined) ship(attached, 'p1', spare);
    else {
      const own = topologyOf(attached).vertices[end]!.edges.find((edge) => edge !== last && attached.board.roads[edge]?.player === 'p4')!;
      attached.board.roads[own] = { player: 'p1', ship: true };
    }
    expect(reason(attached).backtrackBlocked).toBe('attached');
    // 沒被圍住時沒有原因。
    expect(reason(started(4))).toMatchObject({ backtrack: false, backtrackBlocked: null });
  });
});

describe('Pirate Islands roads and beachhead settlements (agy P1)', () => {
  const landEdgesAt = (state: GameState, vertex: number): number[] =>
    topologyOf(state).vertices[vertex]!.edges.filter((edge) => isLandEdge(state, edge));

  it('未收復的堡壘不能當路的起點：紅色從 (0,0) 上角的堡壘沿島 2 蓋路被拒，沿路走到 beachhead 也不能蓋村落', () => {
    const state = ready(4);
    calm(state);
    const topo = topologyOf(state);
    const fortress = slot(state).fortresses.find((entry) => entry.player === 'p1')!.vertex;
    const beachhead = slot(state).beachheads.find((entry) => entry.player === 'p1')!.vertex;
    expect(fortress).toBe(cornerVertex(topo, PI_PIECES[0]!.pieces.fortress));
    setHand(state, 'p1', { lumber: 5, brick: 5, wool: 5, grain: 5 });
    const atFortress = landEdgesAt(state, fortress);
    expect(atFortress.length).toBeGreaterThan(0);
    for (const edge of atFortress) expectRejected(state, 'p1', { type: 'build.road', edge }, 'E_ILLEGAL_TARGET');
    // 提示裡也沒有任何海盜群島上的路。
    for (const edge of actionHints(state, 'p1').legalRoads) {
      expect(topo.edges[edge]!.hexes.some((hex) => isLandHex(state, hex) && state.board.layout.islands[hex] !== 1)).toBe(false);
    }
    // 即使路硬放在堡壘到 beachhead 的陸地邊上（繞過規則），beachhead 也不能蓋：要的是船線（船）到達。
    const parent = new Map<number, number | null>([[fortress, null]]);
    const queue = [fortress];
    const via = new Map<number, number>();
    for (let head = 0; head < queue.length; head++) {
      const vertex = queue[head]!;
      for (const edge of landEdgesAt(state, vertex)) {
        const [a, b] = topo.edges[edge]!.vertices;
        const next = a === vertex ? b : a;
        if (parent.has(next)) continue;
        parent.set(next, vertex);
        via.set(next, edge);
        queue.push(next);
      }
    }
    expect(parent.has(beachhead)).toBe(true);
    const path: number[] = [];
    for (let vertex = beachhead; vertex !== fortress; vertex = parent.get(vertex)!) path.push(via.get(vertex)!);
    expect(path.length).toBeGreaterThanOrEqual(3);
    for (const edge of path) road(state, 'p1', edge);
    expect(legalBuildingVertices(state, 'p1')).not.toContain(beachhead);
    expectRejected(state, 'p1', { type: 'build.settlement', vertex: beachhead }, 'E_ILLEGAL_TARGET');
  });

  it('藍色從堡壘沿 (-3,4)／(-2,4) 的海岸邊蓋路佔邊被拒；堡壘旁的船也不能起頭', () => {
    const state = ready(4);
    calm(state);
    const topo = topologyOf(state);
    const fortress = slot(state).fortresses.find((entry) => entry.player === 'p2')!.vertex;
    expect(hexesOf(state, fortress)).toEqual(sorted(TRANSCRIBED_MARKERS.blue.fortress));
    forceTurn(state, 1, 'action');
    setHand(state, 'p2', { lumber: 5, brick: 5, wool: 5, grain: 5 });
    const edges = landEdgesAt(state, fortress);
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) expectRejected(state, 'p2', { type: 'build.road', edge }, 'E_ILLEGAL_TARGET');
    // 船：堡壘旁的海邊接在建築上、一般規則合法，但船線規則拒絕（不是船線的端點）。
    const ships = topo.vertices[fortress]!.edges.filter((edge) => canPlaceShip(state, 'p2', edge, { line: null }));
    expect(ships.length).toBeGreaterThan(0);
    for (const edge of ships) {
      expect(lineShip(state, 'p2', edge)).toMatchObject({ kind: 'refused' });
      expectRejected(state, 'p2', { type: 'build.ship', edge } as never, 'E_SHIP_LINE');
    }
  });

  it('合法取得的建築可以接路：收復的堡壘，或船線到達後蓋的 beachhead 村落', () => {
    const state = ready(4);
    calm(state);
    const red = slot(state).fortresses.find((entry) => entry.player === 'p1')!;
    const before = actionHints(state, 'p1').legalRoads.filter((edge) => topologyOf(state).edges[edge]!.vertices.includes(red.vertex));
    expect(before).toEqual([]);
    red.lairs = 0;
    const after = actionHints(state, 'p1').legalRoads.filter((edge) => topologyOf(state).edges[edge]!.vertices.includes(red.vertex));
    expect(after.length).toBeGreaterThan(0);
  });
});

describe('Pirate Islands views and isolation (D7)', () => {
  it('公開狀態 pirateIslands：堡壘（lair 數）、beachhead、各玩家船線、航道；每位觀看者相同', () => {
    let state = started(3);
    state = build(state, 'p2', lineEdges(state, 'p2')[0]!);
    const view = (viewer: string) => (projectGame(state, viewer).modules!.seafarers as { pirateIslands: Record<string, unknown> }).pirateIslands;
    expect(view('p1')).toEqual(view('p2'));
    expect(view('p3')).toEqual(view('p1'));
    const shared = view('p1') as { fortresses: { player: string; lairs: number }[]; beachheads: unknown[]; lines: Record<string, { edges: number[]; next: string }>; route: number[] };
    expect(shared.fortresses.map((fortress) => fortress.lairs)).toEqual([3, 3, 3]);
    expect(shared.beachheads).toHaveLength(3);
    expect(shared.lines.p2!.edges).toHaveLength(2);
    expect(shared.lines.p2!.next).toBe('beachhead');
    expect(shared.lines.p1!.edges).toHaveLength(1);
    expect(shared.route).toHaveLength(14);
    expect(sf(state, 'p2').pirateLine).toMatchObject({ next: 'beachhead', edges: shared.lines.p2!.edges });
  });

  it('其他劇本沒有 pirateIslands 狀態、提示與船線限制（New Shores 與 Cloth for Catan 的船規則不變）', () => {
    for (const profileId of ['sf-new-shores-2025', 'sf-cloth-for-catan-2025']) {
      const state = emptySeafarersGame(3, 0, 'action', profileId);
      expect(seafarersState(state).pirateIslands).toBeUndefined();
      expect(Object.keys(actionHints(state, 'p1').modules!.seafarers as object)).not.toContain('pirateLine');
      expect(Object.keys(projectGame(state, 'p1').modules!.seafarers as object)).not.toContain('pirateIslands');
      const topo = topologyOf(state);
      for (let edge = 0; edge < topo.edges.length; edge++) expect(lineShip(state, 'p1', edge)).toEqual({ kind: 'free' });
    }
  });

  it('profile：實作但未啟用（S7c 才啟用）；3–4 人，目標 10 分，旗標 stuckLineBacktrack', () => {
    expect(getProfile(PROFILE)).toMatchObject({
      scenario: 'pirate-islands', victoryTarget: 10, playerCounts: [3, 4], ruleVersion: 'sf-2025.3', topologyId: 'sf-pirate-islands',
      layoutId: 'sf-pirate-islands', implemented: true, enabled: false, stuckLineBacktrack: true, setupModes: ['fixed'],
    });
    expect(getProfile(PROFILE)!.islandBonus).toBeUndefined();
    for (const playerCount of [3, 4]) {
      expect(resolveCombination({ expansions: ['seafarers'], scenario: 'pirate-islands', variants: [], setupMode: 'fixed', playerCount })).toEqual({ ok: false, reason: 'disabled' });
    }
    for (const playerCount of [2, 5, 6]) {
      expect(resolveCombination({ expansions: ['seafarers'], scenario: 'pirate-islands', variants: [], setupMode: 'fixed', playerCount })).toEqual({ ok: false, reason: 'bad-player-count' });
    }
    expect(() => seafarersGame(3, 1, PROFILE)).not.toThrow();
  });

  it('狀態可序列化、重播：同 seed 同預置；整份 state 經 JSON 來回後行為相同', () => {
    const a = game(4, 5).state;
    const b = game(4, 5).state;
    expect(slot(a)).toEqual(slot(b));
    const copy = clone(started(4));
    const edge = lineEdges(copy, 'p1')[0]!;
    expect(build(copy, 'p1', edge).board.roads[edge]).toEqual({ player: 'p1', ship: true });
  });
});
