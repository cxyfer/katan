/**
 * R-SFX-S7a：The Pirate Islands（海盜巢穴）的版圖、預置棋子、堡壘、beachhead 與西島船線（SF25 pp. 16–17）。
 * 版圖與配件表對照兩份獨立轉錄（s7-A／s7-B，逐格一致）；3 人與 4 人共用同一張 49 格圖。規則 fixture 為預置棋子、
 * 堡壘（不產出、不算分、不能升級）、起始村落只放東島、牌堆組成、西島船線（一條不分叉、最短路徑、被擋繞路、
 * 完全無路的放寬）、beachhead 蓋村落，以及其他劇本不受影響（D7）。巡弋海盜、攻擊與進攻在 S7b、S7c。
 */

import { describe, expect, it } from 'vitest';
import { BASE_AWARD_RULES, isLandEdge, isLandHex, scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, createGame, legalBuildingVertices } from '../src/engine.ts';
import { productionForRoll } from '../src/analysis.ts';
import { seafarersModule } from '../src/modules/seafarers/index.ts';
import { goldEntitlements } from '../src/modules/seafarers/gold.ts';
import {
  fortressLocked, isLineEdge, lineContext, lineShip, lineVertices, pirateIslandsView,
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
  legalShips: number[]; setupShips: number[]; movableShips: { edge: number; targets: number[] }[]; pirateLine: { next: string; target: number | null; end: number | null; edges: number[] };
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
const lineEdges = (state: GameState, id: string): number[] => legalShipEdges(state, id).filter((edge) => lineShip(state, id, edge).kind === 'line');

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
    const before = JSON.parse(JSON.stringify(slot(state).lines.p1)) as unknown;
    let current = state;
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

  it('完全無路時放寬（shortestPathFallback）：往任何合法方向延伸；旗標關掉就拒絕', () => {
    const state = started(4);
    const topo = topologyOf(state);
    const target = lineContext(state, 'p1')!.targetVertex!;
    for (const edge of topo.vertices[target]!.edges) {
      const [a, b] = topo.edges[edge]!.vertices;
      settle(state, 'p2', a === target ? b : a);
    }
    const ctx = lineContext(state, 'p1')!;
    expect(ctx.dist[ctx.end!]).toBe(-1);
    const base = legalShipEdges(state, 'p1', { line: null }).filter((edge) => topo.edges[edge]!.vertices.includes(ctx.end!));
    expect(base.length).toBeGreaterThan(0);
    for (const edge of base) expect(lineShip(state, 'p1', edge)).toMatchObject({ kind: 'line', relaxed: true });
    const next = build(state, 'p1', base[0]!);
    expect(slot(next).lines.p1!.edges).toHaveLength(2);
    // 放寬之後仍是同一條不分叉的線：下一步只能接在新的端點。
    const end = lineContext(next, 'p1')!.end!;
    expect(end).not.toBe(ctx.end);
    for (const edge of lineEdges(next, 'p1')) expect(topo.edges[edge]!.vertices).toContain(end);
    // 旗標關掉：沒有放寬，被擋死的船線不能再延伸不碰東島的邊。
    const profile = getProfile(PROFILE)!;
    try {
      profile.shortestPathFallback = false;
      for (const edge of base.filter((candidate) => isLineEdge(state, candidate))) expect(lineShip(state, 'p1', edge)).toMatchObject({ kind: 'refused' });
    } finally {
      profile.shortestPathFallback = true;
    }
    // 有路的時候不放寬。
    const open = started(4);
    for (const edge of lineEdges(open, 'p1')) expect(lineShip(open, 'p1', edge)).toMatchObject({ relaxed: false });
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
    const fresh = started(4);
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
    expect(slot(moved).lines.p1!.edges).toHaveLength(1);
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
    const kinds = new Map(baseline.map((edge) => [edge, lineShip(placed, 'p1', edge, { setupVertex: vertex }).kind]));
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
      expect(slot(next).lines.p1!.edges).toHaveLength(slot(placed).lines.p1!.edges.length + (kinds.get(accepted) === 'line' ? 1 : 0));
    }
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

  it('profile：實作但未啟用（S7c 才啟用）；3–4 人，目標 10 分，旗標 shortestPathFallback', () => {
    expect(getProfile(PROFILE)).toMatchObject({
      scenario: 'pirate-islands', victoryTarget: 10, playerCounts: [3, 4], ruleVersion: 'sf-2025.3', topologyId: 'sf-pirate-islands',
      layoutId: 'sf-pirate-islands', implemented: true, enabled: false, shortestPathFallback: true, setupModes: ['fixed'],
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
