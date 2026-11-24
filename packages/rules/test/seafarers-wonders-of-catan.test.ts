/**
 * R-SFX-S8：The Wonders of Catan（卡坦奇觀）。版圖與配件表對照 SF25 pp. 18–19（3 人與 4 人共用同一張
 * 49 格圖）、五張奇觀牌對照 SF25 p. 1；規則 fixture 為禁設點、小島第一個村落 1 分、五張牌的施工條件
 * （各正反例）、每人一座與別人不可選、每層費用、marker 進度、兩種結束條件、海盜關閉與 D7 隔離。
 */

import { describe, expect, it } from 'vitest';
import { isSeaEdge, isLandEdge, scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, legalBuildingVertices } from '../src/engine.ts';
import { allowBuilding } from '../src/modules/seafarers/islands.ts';
import { seafarersState } from '../src/modules/seafarers/state.ts';
import {
  WONDER_IDS, WONDER_LEVELS, WONDERS, claimableWonders, wonderCause, wonderDef,
} from '../src/modules/seafarers/wonders.ts';
import { getProfile, resolveCombination } from '../src/profiles.ts';
import { projectGame } from '../src/project.ts';
import { RESOURCES, type GameState, type Resource } from '../src/types.ts';
import {
  FT_CELLS, WC_PORT_TOKENS, WONDERS_OF_CATAN_SOURCE, wonderMarkerVertices,
} from '../src/seafarers-scenario-boards.ts';
import { getTopology } from '../src/topology-registry.ts';
import { act, expectRejected, scriptedRng, setHand } from './helpers.ts';
import { emptySeafarersGame, hex, seafarersGame, settle, ship, road } from './seafarers-helpers.ts';

const PROFILE = 'sf-wonders-of-catan-2025';
const profile = getProfile(PROFILE)!;

function tally<T extends string | number | null>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[String(value)] = (out[String(value)] ?? 0) + 1;
  return out;
}

const game = (players: 3 | 4 = 3, seed = 12345) => seafarersGame(players, seed, PROFILE);
const ready = (players: 3 | 4 = 3, seat = 0) => emptySeafarersGame(players, seat, 'action', PROFILE);
const slot = (state: GameState) => seafarersState(state).wonders!;
const score = (state: GameState, id: string) => scoreOf(state, id, { includeHidden: true });
const player = (state: GameState, id: string) => state.players.find((candidate) => candidate.id === id)!;
const sf = (state: GameState, id: string) => actionHints(state, id).modules!.seafarers as {
  pirateTargets: (number | null)[]; robberTargets: number[]; wonders: { claimable: string[]; buildable: boolean };
};
const choose = (state: GameState, id: string, wonder: string): GameState => act(state, id, { type: 'wonder.choose', wonder } as never).state;
const buildLevel = (state: GameState, id: string) => act(state, id, { type: 'wonder.build' } as never);
const reject = (state: GameState, id: string, command: Record<string, unknown>, code: string) =>
  expectRejected(state, id, command as never, code, scriptedRng([]));
const clone = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;
const ctxOf = (state: GameState) => ({ profile: getProfile(state.profileId)! });

/** 轉錄座標（原點在左上）到 repo 座標。 */
const rp = (q: number, r: number): [number, number] => [q - 1, r - 3];

const markerOf = (state: GameState, kind: 'greatWall' | 'greatBridge' | 'x', index = 0): number => slot(state).markers[kind][index]!;

/** 把 `cost` 乘 `times` 放進手牌。 */
const fund = (state: GameState, id: string, cost: Partial<Record<Resource, number>>, times = 1): void => {
  const hand: Partial<Record<Resource, number>> = {};
  for (const [resource, amount] of Object.entries(cost)) hand[resource as Resource] = (amount ?? 0) * times;
  setHand(state, id, hand);
};

/** 在港口交叉點放城市，回傳該頂點（可指定第幾個港口）。 */
function portVertex(state: GameState, index = 0): number {
  const topo = topologyOf(state);
  return topo.edges[state.board.layout.harbors[index]!.edge]!.vertices.find((vertex) =>
    topo.vertices[vertex]!.hexes.some((hexIndex) => state.board.layout.terrain[hexIndex] !== 'sea'))!;
}

/** 從 `from` 沿海岸走 `length` 條空的邊（簡單路徑），回傳邊與沿途頂點。 */
function coastChain(state: GameState, from: number, length: number): { edges: number[]; vertices: number[] } {
  const topo = topologyOf(state);
  const walk = (vertex: number, edges: number[], vertices: number[]): { edges: number[]; vertices: number[] } | null => {
    if (edges.length === length) return { edges, vertices };
    for (const edge of topo.vertices[vertex]!.edges) {
      if (edges.includes(edge) || state.board.roads[edge] || !isSeaEdge(state, edge) || !isLandEdge(state, edge)) continue;
      const info = topo.edges[edge]!;
      const next = info.vertices[0] === vertex ? info.vertices[1]! : info.vertices[0]!;
      if (vertices.includes(next) || state.board.buildings[next]) continue;
      const found = walk(next, [...edges, edge], [...vertices, next]);
      if (found) return found;
    }
    return null;
  };
  const found = walk(from, [], [from]);
  if (!found) throw new Error(`no coast chain of ${length} from ${from}`);
  return found;
}

describe('Wonders of Catan topology (SF25 pp. 18–19, spec §7.3)', () => {
  it('49 格外框 6-7-8-7-8-7-6，與 sf-forgotten-tribe 同形（hex／邊／頂點數），9 個港口位置', () => {
    const topology = getTopology('sf-wonders-of-catan');
    const reference = getTopology('sf-forgotten-tribe');
    expect(topology.hexes).toHaveLength(49);
    expect(topology.hexes.map(({ q, r }) => [q, r])).toEqual(reference.hexes.map(({ q, r }) => [q, r]));
    expect([topology.edges.length, topology.vertices.length, topology.coastalEdges.length, topology.harborSlots.length])
      .toEqual([reference.edges.length, reference.vertices.length, reference.coastalEdges.length, 9]);
    expect(topology.vertices.length - topology.edges.length + topology.hexes.length).toBe(1);
    const rows = tally(topology.hexes.map((cell) => cell.r));
    expect([-3, -2, -1, 0, 1, 2, 3].map((r) => rows[r])).toEqual([6, 7, 8, 7, 8, 7, 6]);
    // 中排兩端的框突出部 (-4,0)、(4,0) 不是格。
    for (const q of [-4, 4]) expect(topology.hexes.some((cell) => cell.q === q && cell.r === 0)).toBe(false);
    expect(new Set(topology.harborSlots).size).toBe(9);
    // 每個港口位置貼在一格陸地與海（或框）之間的邊上（SF25 圖上港口都在陸地的海岸）。
    const probe = game().state;
    for (const edge of topology.harborSlots) {
      const info = topology.edges[edge]!;
      const land = info.hexes.filter((h) => probe.board.layout.terrain[h] !== 'sea');
      expect(land, `edge ${edge}`).toHaveLength(1);
    }
    expect(FT_CELLS).toHaveLength(49);
  });

  it('平移 (dq, dr) = (-1, -3)：轉錄各排 q 範圍 0..5、-1..5、-2..5、-2..4、-3..4、-3..3、-3..2', () => {
    expect(WONDERS_OF_CATAN_SOURCE.shift).toEqual({ dq: -1, dr: -3 });
    const transcribed: Record<number, [number, number]> = { 0: [0, 5], 1: [-1, 5], 2: [-2, 5], 3: [-2, 4], 4: [-3, 4], 5: [-3, 3], 6: [-3, 2] };
    const topology = getTopology('sf-wonders-of-catan');
    for (const [r, [from, to]] of Object.entries(transcribed)) {
      const qs = topology.hexes.filter((cell) => cell.r === Number(r) - 3).map((cell) => cell.q).sort((a, b) => a - b);
      expect([qs[0], qs[qs.length - 1], qs.length]).toEqual([from - 1, to - 1, to - from + 1]);
    }
  });

  it('標記：Great Wall 5、Great Bridge 2、X 4，各在不同的交叉點；Great Bridge 兩個相鄰，每個 X 緊鄰一個 Great Bridge', () => {
    const { state } = game();
    const topo = topologyOf(state);
    const markers = slot(state).markers;
    expect([markers.greatWall.length, markers.greatBridge.length, markers.x.length]).toEqual([5, 2, 4]);
    const all = [...markers.greatWall, ...markers.greatBridge, ...markers.x];
    expect(new Set(all).size).toBe(11);
    expect(wonderMarkerVertices(topo)).toEqual(markers);
    const adjacent = (a: number, b: number) => topo.vertices[a]!.edges.some((edge) => topo.edges[edge]!.vertices.includes(b));
    expect(adjacent(markers.greatBridge[0]!, markers.greatBridge[1]!)).toBe(true);
    for (const x of markers.x) expect(markers.greatBridge.some((bridge) => adjacent(x, bridge))).toBe(true);
    // Great Wall 五點沿 (3,2) 森林與沙漠的交界依序相鄰成一條鏈。
    const chain = markers.greatWall.filter((vertex) => markers.greatWall.filter((other) => other !== vertex && adjacent(vertex, other)).length === 1);
    expect(chain).toHaveLength(2);
    for (const vertex of markers.greatWall) {
      expect(topo.vertices[vertex]!.hexes.some((h) => state.board.layout.terrain[h] === 'desert')).toBe(true);
    }
    // 轉錄座標：Great Bridge 的兩點在 (-2,5)/(-1,5)/(-2,6) 與 (-1,6)/(-2,6)/(-1,5)。
    const [aq, ar] = rp(-2, 5);
    expect(topo.vertices[markers.greatBridge[0]!]!.hexes).toContain(hex(state, aq, ar));
  });
});

describe('Wonders of Catan layout (SF25 p. 19 配件表)', () => {
  it('地形 海 19、沙漠 3、金礦 2、田野／小丘／高山／草地／森林各 5 = 49；3 人與 4 人同一張圖', () => {
    for (const players of [3, 4] as const) {
      const { state } = game(players);
      const layout = state.board.layout;
      expect(layout.topologyId).toBe('sf-wonders-of-catan');
      expect(layout.terrain).toHaveLength(49);
      expect(tally(layout.terrain)).toEqual({ sea: 19, desert: 3, gold: 2, fields: 5, hills: 5, mountains: 5, pasture: 5, forest: 5 });
    }
    expect(game(3).state.board.layout.terrain).toEqual(game(4).state.board.layout.terrain);
  });

  it('圓片 27 枚（2:2、3:3、4:3、5:3、6:3、8:3、9:3、10:3、11:3、12:1），沙漠沒有圓片，沒有 7', () => {
    const { state } = game();
    const numbers = state.board.layout.numbers.filter((n): n is number => n !== null);
    expect(numbers).toHaveLength(27);
    expect(tally(numbers)).toEqual({ 2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 1 });
    state.board.layout.terrain.forEach((terrain, index) => {
      if (terrain === 'desert') expect(state.board.layout.numbers[index]).toBeNull();
    });
  });

  it('島：大島 25 格（含 3 沙漠）、西北小島 2 格（金礦 8、小丘 2）、東南小島 3 格（金礦 6、森林 4、田野 5）', () => {
    const { state } = game();
    const { islands, terrain, numbers } = state.board.layout;
    expect(tally(islands.filter((island) => island > 0))).toEqual({ 1: 25, 2: 2, 3: 3 });
    const of = (island: number) => islands.flatMap((value, index) => (value === island ? [`${terrain[index]}${numbers[index]}`] : [])).sort();
    expect(of(2)).toEqual(['gold8', 'hills2']);
    expect(of(3)).toEqual(['fields5', 'forest4', 'gold6']);
    expect(islands.map((island, index) => (island === 1 && terrain[index] === 'desert' ? 1 : 0)).reduce((a: number, b) => a + b, 0)).toBe(3);
  });

  it('轉錄表與 layout 一致（逐格地形、圓片、島編號），強盜在任一沙漠，海盜不使用', () => {
    const { state } = game(4);
    expect(WONDERS_OF_CATAN_SOURCE.land).toHaveLength(30);
    for (const land of WONDERS_OF_CATAN_SOURCE.land) {
      const index = hex(state, land.q, land.r);
      expect([state.board.layout.terrain[index], state.board.layout.numbers[index], state.board.layout.islands[index]])
        .toEqual([land.terrain, land.number, land.island]);
    }
    expect(state.board.layout.terrain[state.board.robber]).toBe('desert');
    expect(state.board.pirate).toBeNull();
    expect(state.board.layout.pirate).toBeNull();
  });

  it('強盜的沙漠由 layout rng 決定：多個種子都落在三塊沙漠之一，且三塊都出現過；寫進 layout，不是固定', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const { state } = game(3, seed);
      expect(state.board.layout.terrain[state.board.robber]).toBe('desert');
      seen.add(state.board.robber);
    }
    expect(seen.size).toBe(3);
  });

  it('9 個港口固定位置、種類洗牌：5 個 2:1（各一種資源）+ 4 個 3:1；不同種子排列不同', () => {
    expect(tally(WC_PORT_TOKENS)).toEqual({ lumber: 1, brick: 1, wool: 1, grain: 1, ore: 1, generic: 4 });
    const orders = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const harbors = game(3, seed).state.board.layout.harbors;
      expect(harbors).toHaveLength(9);
      expect(tally(harbors.map((harbor) => harbor.type))).toEqual({ lumber: 1, brick: 1, wool: 1, grain: 1, ore: 1, generic: 4 });
      expect(harbors.map((harbor) => harbor.edge)).toEqual(getTopology('sf-wonders-of-catan').harborSlots);
      orders.add(harbors.map((harbor) => harbor.type).join());
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('同種子同圖（確定性）', () => {
    expect(game(3, 7).state.board.layout).toEqual(game(3, 7).state.board.layout);
  });
});

describe('Wonders of Catan profile', () => {
  it('3、4 人啟用，sf-2025.3，海盜與 VP 標記規則：每座小島 1 分、跳過主島', () => {
    expect(profile).toMatchObject({ ruleVersion: 'sf-2025.3', scenario: 'wonders-of-catan', playerCounts: [3, 4], enabled: true, implemented: true, victoryTarget: 10, islandBonus: { points: 1, skip: 'main' } });
    expect(profile.setupModes).toEqual(['fixed']);
    const base = { expansions: ['seafarers'], scenario: 'wonders-of-catan', variants: [], setupMode: 'fixed' as const };
    for (const playerCount of [3, 4]) expect(resolveCombination({ ...base, playerCount })).toMatchObject({ ok: true });
    for (const playerCount of [2, 5, 6]) expect(resolveCombination({ ...base, playerCount })).toEqual({ ok: false, reason: 'bad-player-count' });
  });

  it('奇觀資料表：五張牌，每張的條件與每層費用都在資料裡（SF25 p. 1）', () => {
    expect(WONDER_IDS).toEqual(['greatWall', 'greatBridge', 'grandTheater', 'grandCastle', 'grandMonument']);
    expect(WONDER_LEVELS).toBe(4);
    expect(Object.fromEntries(WONDERS.map((def) => [def.id, def.cost]))).toEqual({
      greatWall: { brick: 3, lumber: 1, grain: 1 },
      greatBridge: { lumber: 3, wool: 1, grain: 1 },
      grandTheater: { wool: 3, brick: 1, lumber: 1 },
      grandCastle: { ore: 3, brick: 1, grain: 1 },
      grandMonument: { grain: 3, ore: 2 },
    });
    expect(Object.fromEntries(WONDERS.map((def) => [def.id, def.condition]))).toEqual({
      greatWall: { marker: 'greatWall' },
      greatBridge: { marker: 'greatBridge' },
      grandTheater: { cities: 2 },
      grandCastle: { cities: 1, score: 6 },
      grandMonument: { portCities: 1, route: 5 },
    });
    // 每層都是 5 張資源。
    for (const def of WONDERS) expect(Object.values(def.cost).reduce((sum, amount) => sum + (amount ?? 0), 0)).toBe(5);
    expect(wonderDef('nope')).toBeUndefined();
  });
});

describe('Wonders of Catan setup (SF25 p. 18)', () => {
  it('起始村落只能放大島，不在 Great Bridge／Great Wall／X 標記的交叉點；小島與標記點都被排除', () => {
    for (const players of [3, 4] as const) {
      const { state } = game(players);
      const markers = slot(state).markers;
      const forbidden = new Set([...markers.greatWall, ...markers.greatBridge, ...markers.x]);
      const legal = legalBuildingVertices(state, 'p1', { setup: true });
      expect(legal.length).toBeGreaterThan(20);
      const topo = topologyOf(state);
      for (const vertex of legal) {
        expect(forbidden.has(vertex)).toBe(false);
        const islands = topo.vertices[vertex]!.hexes.filter((h) => state.board.layout.terrain[h] !== 'sea').map((h) => state.board.layout.islands[h]);
        expect(islands).toContain(1);
      }
      // 小島的頂點完全不在清單上。
      topo.vertices.forEach((info, vertex) => {
        if (info.hexes.some((h) => [2, 3].includes(state.board.layout.islands[h]!))) expect(legal).not.toContain(vertex);
      });
      for (const vertex of forbidden) reject(state, 'p1', { type: 'setup.placeBuilding', vertex }, 'E_ILLEGAL_TARGET');
    }
  });

  it('禁設點只限設置階段：設置之後同一批交叉點在 allowBuilding 放行（Great Wall／Bridge 是施工條件）', () => {
    const { state } = game();
    const markers = slot(state).markers;
    const ctx = ctxOf(state);
    for (const vertex of [...markers.greatWall, ...markers.greatBridge, ...markers.x]) {
      expect(allowBuilding(state, 'p1', vertex, { setup: true }, ctx)).toBe(false);
      expect(allowBuilding(state, 'p1', vertex, { setup: false }, ctx)).toBe(true);
    }
  });

  it('設置階段在大島的起始村落不得分；每人只有一個 wonder marker 位置（層數 0、無奇觀）', () => {
    const { state } = game();
    expect(slot(state).owned).toEqual({ p1: null, p2: null, p3: null });
    expect(slot(state).levels).toEqual({ p1: 0, p2: 0, p3: 0 });
    expect(state.turn.phase).toBe('setup');
  });

  it('一局完整設置：兩輪、起始資源在第二輪發，之後進入行動階段', () => {
    let { state } = game(4);
    for (let step = 0; step < 40 && state.turn.phase === 'setup'; step++) {
      const setup = state.turn.setup!;
      const actor = state.players[setup.order[setup.index]!]!.id;
      const hints = actionHints(state, actor);
      state = setup.stage === 'building'
        ? act(state, actor, { type: 'setup.placeBuilding', vertex: hints.legalSettlements[0]! }).state
        : act(state, actor, { type: 'setup.placeRoad', edge: hints.legalRoads[0]! }).state;
    }
    expect(state.turn.phase).not.toBe('setup');
    for (const p of state.players) expect(p.bonusPoints).toBe(0);
  });
});

describe('Wonders of Catan small island bonus (1 VP, SF25 p. 18)', () => {
  /** 從大島的 `from` 沿空海邊走到小島 `island` 的某個頂點，回傳邊與終點。 */
  function sailTo(state: GameState, from: number, island: number): { edges: number[]; target: number } {
    const topo = topologyOf(state);
    const crowded = (vertex: number) => topo.vertices[vertex]!.edges.some((edge) => {
      const [a, b] = topo.edges[edge]!.vertices;
      return !!state.board.buildings[a === vertex ? b : a];
    });
    const onIsland = (vertex: number) => topo.vertices[vertex]!.hexes.some((h) => state.board.layout.islands[h] === island) && !crowded(vertex);
    const queue: { vertex: number; edges: number[] }[] = [{ vertex: from, edges: [] }];
    const seen = new Set([from]);
    for (let head = 0; head < queue.length; head++) {
      const { vertex, edges } = queue[head]!;
      if (edges.length > 0 && onIsland(vertex)) return { edges, target: vertex };
      for (const edge of topo.vertices[vertex]!.edges) {
        if (state.board.roads[edge] || !isSeaEdge(state, edge)) continue;
        const info = topo.edges[edge]!;
        const next = info.vertices[0] === vertex ? info.vertices[1]! : info.vertices[0]!;
        if (seen.has(next) || state.board.buildings[next]) continue;
        seen.add(next);
        queue.push({ vertex: next, edges: [...edges, edge] });
      }
    }
    throw new Error('no route');
  }

  /** 玩家在 `from` 蓋村落（大島），船到小島，蓋村落。回傳狀態。 */
  function settleIsland(state: GameState, id: string, from: number, island: number): { state: GameState; target: number; events: { type: string; params?: Record<string, unknown> }[] } {
    settle(state, id, from);
    const route = sailTo(state, from, island);
    for (const edge of route.edges) ship(state, id, edge);
    setHand(state, id, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    const result = act(state, id, { type: 'build.settlement', vertex: route.target });
    return { state: result.state, target: route.target, events: result.events };
  }

  const coast = (state: GameState): number[] => {
    const topo = topologyOf(state);
    return topo.vertices.flatMap((info, vertex) =>
      (info.hexes.some((h) => state.board.layout.islands[h] === 1) && info.hexes.some((h) => state.board.layout.terrain[h] === 'sea')
        && !slot(state).markers.greatWall.includes(vertex) ? [vertex] : []));
  };

  it('每位玩家在每座小島蓋第一個村落得 1 分（第二個不再得分），事件與 claims 記下', () => {
    const state = ready();
    const start = coast(state)[0]!;
    const { state: after, events } = settleIsland(state, 'p1', start, 2);
    expect(player(after, 'p1').bonusPoints).toBe(1);
    expect(score(after, 'p1')).toBe(2 + 1); // 大島村落 1 + 小島村落 1 + 獎勵 1
    expect(events.filter((event) => event.type === 'island.bonus')).toHaveLength(1);
    expect(events.find((event) => event.type === 'island.bonus')!.params).toMatchObject({ playerId: 'p1', island: 2, points: 1 });
    expect(seafarersState(after).islands.p1).toEqual([2]);
    expect(seafarersState(after).claims).toHaveLength(1);
  });

  it('別人已在該島也一樣得分（各算各的）；大島的村落不得分；兩座小島各 1 分', () => {
    const state = ready(4);
    const starts = coast(state);
    const first = settleIsland(state, 'p1', starts[0]!, 2);
    expect(player(first.state, 'p1').bonusPoints).toBe(1);
    // 大島上的村落沒有獎勵：p1 在大島的起點沒有 claim。
    expect(seafarersState(first.state).claims.every((claim) => claim.island !== 1)).toBe(true);
    // p2 在同一座島也得 1 分。
    first.state.turn.seat = 1;
    first.state.windowId += 1;
    const secondStart = [...starts].reverse().find((vertex) => !first.state.board.buildings[vertex] && (() => { try { sailTo(first.state, vertex, 2); return true; } catch { return false; } })())!;
    const second = settleIsland(first.state, 'p2', secondStart, 2);
    expect(player(second.state, 'p2').bonusPoints).toBe(1);
    expect(player(second.state, 'p1').bonusPoints).toBe(1);
    expect(seafarersState(second.state).claims.map((claim) => [claim.player, claim.island])).toEqual([['p1', 2], ['p2', 2]]);
    // p1 再去東南小島：再得 1 分，共 2 分。
    second.state.turn.seat = 0;
    second.state.windowId += 1;
    const thirdStart = starts.find((vertex) => !second.state.board.buildings[vertex] && (() => { try { sailTo(second.state, vertex, 3); return true; } catch { return false; } })())!;
    const third = settleIsland(second.state, 'p1', thirdStart, 3);
    expect(player(third.state, 'p1').bonusPoints).toBe(2);
    expect(seafarersState(third.state).islands.p1).toEqual([2, 3]);
  });

  it('VP 標記供應 8 枚：2 座小島 × 4 位玩家剛好夠，總獎勵分不超過 8', () => {
    expect(2 * 4).toBe(8);
    const { state } = game(4);
    expect(profile.islandBonus).toEqual({ points: 1, skip: 'main' });
    const total = (seafarersState(state).claims ?? []).length;
    expect(total).toBe(0);
  });
});

describe('Wonders of Catan claiming (wonder.choose)', () => {
  it('Great Wall：需要自己的村落或城市在 Great Wall 標記上；沒有建築、在別的交叉點、在 Great Bridge 標記上都不行', () => {
    const state = ready();
    reject(state, 'p1', { type: 'wonder.choose', wonder: 'greatWall' }, 'E_WONDER_REQUIREMENT');
    settle(state, 'p1', markerOf(state, 'greatBridge'));
    settle(state, 'p1', markerOf(state, 'x', 0));
    reject(state, 'p1', { type: 'wonder.choose', wonder: 'greatWall' }, 'E_WONDER_REQUIREMENT');
    // 別人在標記上也不算。
    settle(state, 'p2', markerOf(state, 'greatWall', 2));
    reject(state, 'p1', { type: 'wonder.choose', wonder: 'greatWall' }, 'E_WONDER_REQUIREMENT');
    expect(sf(state, 'p1').wonders.claimable).not.toContain('greatWall');
    for (const index of [0, 1, 2, 3, 4]) {
      const fresh = ready();
      settle(fresh, 'p1', markerOf(fresh, 'greatWall', index));
      expect(sf(fresh, 'p1').wonders.claimable).toEqual(['greatWall']);
      const done = choose(fresh, 'p1', 'greatWall');
      expect(slot(done).owned.p1).toBe('greatWall');
      expect(done.log.at(-1)).toMatchObject({ type: 'wonder.chosen', params: { playerId: 'p1', wonder: 'greatWall' } });
    }
  });

  it('Great Wall：城市也算（村落或城市）', () => {
    const state = ready();
    settle(state, 'p1', markerOf(state, 'greatWall', 1), true);
    expect(slot(choose(state, 'p1', 'greatWall')).owned.p1).toBe('greatWall');
  });

  it('Great Bridge：需要自己的建築在 Great Bridge 標記上（兩個標記都可以）；Great Wall 標記不算', () => {
    const state = ready();
    settle(state, 'p1', markerOf(state, 'greatWall'));
    reject(state, 'p1', { type: 'wonder.choose', wonder: 'greatBridge' }, 'E_WONDER_REQUIREMENT');
    for (const index of [0, 1]) {
      const fresh = ready();
      settle(fresh, 'p1', markerOf(fresh, 'greatBridge', index));
      expect(slot(choose(fresh, 'p1', 'greatBridge')).owned.p1).toBe('greatBridge');
    }
  });

  it('Grand Theater：需要 2 座城市；1 座城市、2 座村落、城市加村落都不行', () => {
    const state = ready();
    settle(state, 'p1', corner0(state, 0), true);
    reject(state, 'p1', { type: 'wonder.choose', wonder: 'grandTheater' }, 'E_WONDER_REQUIREMENT');
    settle(state, 'p1', corner0(state, 1));
    settle(state, 'p1', corner0(state, 2));
    reject(state, 'p1', { type: 'wonder.choose', wonder: 'grandTheater' }, 'E_WONDER_REQUIREMENT');
    settle(state, 'p1', corner0(state, 3), true);
    expect(sf(state, 'p1').wonders.claimable).toContain('grandTheater');
    expect(slot(choose(state, 'p1', 'grandTheater')).owned.p1).toBe('grandTheater');
  });

  it('Grand Castle：需要 1 座城市且 6 分以上；5 分不行、沒有城市的 6 分以上不行、含自己的隱藏分數牌', () => {
    const state = ready();
    settle(state, 'p1', corner0(state, 0), true); // 2 分
    player(state, 'p1').bonusPoints = 3; // 5 分
    expect(score(state, 'p1')).toBe(5);
    reject(state, 'p1', { type: 'wonder.choose', wonder: 'grandCastle' }, 'E_WONDER_REQUIREMENT');
    player(state, 'p1').bonusPoints = 4; // 6 分
    expect(score(state, 'p1')).toBe(6);
    expect(sf(state, 'p1').wonders.claimable).toContain('grandCastle');
    // 隱藏的分數牌也算（自己知道）。
    const hidden = ready();
    settle(hidden, 'p1', corner0(hidden, 0), true);
    player(hidden, 'p1').bonusPoints = 3;
    player(hidden, 'p1').hiddenBonusPoints = 1;
    expect(slot(choose(hidden, 'p1', 'grandCastle')).owned.p1).toBe('grandCastle');
    expect(slot(choose(state, 'p1', 'grandCastle')).owned.p1).toBe('grandCastle');
    // 只有村落（沒有城市）：6 分以上也不行。
    const villages = ready();
    settle(villages, 'p1', corner0(villages, 0));
    player(villages, 'p1').bonusPoints = 9;
    reject(villages, 'p1', { type: 'wonder.choose', wonder: 'grandCastle' }, 'E_WONDER_REQUIREMENT');
  });

  it('Grand Monument：需要港口上的城市 + 5 條以上的路／船連續路線；少一條、城市不在港口、港口上只是村落都不行', () => {
    const base = ready();
    const port = portVertex(base);
    const chain = coastChain(base, port, 5);

    // 港口城市 + 4 艘船：不夠。
    const short = ready();
    settle(short, 'p1', port, true);
    chain.edges.slice(0, 4).forEach((edge) => ship(short, 'p1', edge));
    reject(short, 'p1', { type: 'wonder.choose', wonder: 'grandMonument' }, 'E_WONDER_REQUIREMENT');
    // 第 5 艘：成立。
    ship(short, 'p1', chain.edges[4]!);
    expect(sf(short, 'p1').wonders.claimable).toEqual(['grandMonument']);
    expect(slot(choose(short, 'p1', 'grandMonument')).owned.p1).toBe('grandMonument');

    // 5 艘船但港口上是村落：不行。
    const village = ready();
    settle(village, 'p1', port);
    chain.edges.forEach((edge) => ship(village, 'p1', edge));
    reject(village, 'p1', { type: 'wonder.choose', wonder: 'grandMonument' }, 'E_WONDER_REQUIREMENT');

    // 港口外的城市 + 5 艘船：不行。
    const inland = ready();
    const nonPort = topologyOf(inland).vertices.findIndex((info, vertex) =>
      info.hexes.some((h) => inland.board.layout.terrain[h] !== 'sea') && !state0Ports(inland).has(vertex) && vertex !== port
      && (() => { try { coastChain(inland, vertex, 5); return true; } catch { return false; } })());
    settle(inland, 'p1', nonPort, true);
    coastChain(inland, nonPort, 5).edges.forEach((edge) => ship(inland, 'p1', edge));
    reject(inland, 'p1', { type: 'wonder.choose', wonder: 'grandMonument' }, 'E_WONDER_REQUIREMENT');
  });

  it('Grand Monument：路與船只在自己的建築相接；中間隔著空交叉點的 2 船 + 3 路只算 3，接在自己的村落上才算 5', () => {
    const base = ready();
    const port = portVertex(base);
    const chain = coastChain(base, port, 5);
    const junction = chain.vertices[2]!;
    const mixed = (withBuilding: boolean): GameState => {
      const state = ready();
      settle(state, 'p1', port, true);
      chain.edges.slice(0, 2).forEach((edge) => ship(state, 'p1', edge));
      chain.edges.slice(2).forEach((edge) => road(state, 'p1', edge));
      if (withBuilding) settle(state, 'p1', junction);
      return state;
    };
    reject(mixed(false), 'p1', { type: 'wonder.choose', wonder: 'grandMonument' }, 'E_WONDER_REQUIREMENT');
    expect(slot(choose(mixed(true), 'p1', 'grandMonument')).owned.p1).toBe('grandMonument');
  });

  it('每人只能認領 1 座（E_WONDER_HELD）；別人認領後不能再選（E_WONDER_TAKEN）；未知牌是 E_INVALID_COMMAND', () => {
    let state = ready(3);
    settle(state, 'p1', markerOf(state, 'greatWall'));
    settle(state, 'p1', markerOf(state, 'greatBridge'), true);
    settle(state, 'p2', markerOf(state, 'greatWall', 3));
    state = choose(state, 'p1', 'greatWall');
    reject(state, 'p1', { type: 'wonder.choose', wonder: 'greatBridge' }, 'E_WONDER_HELD');
    reject(state, 'p1', { type: 'wonder.choose', wonder: 'greatWall' }, 'E_WONDER_HELD');
    expect(sf(state, 'p1').wonders.claimable).toEqual([]);
    // p2 的回合：條件成立，但 Great Wall 已被 p1 拿走。
    state.turn.seat = 1;
    state.windowId += 1;
    reject(state, 'p2', { type: 'wonder.choose', wonder: 'greatWall' }, 'E_WONDER_TAKEN');
    expect(sf(state, 'p2').wonders.claimable).toEqual([]);
    reject(state, 'p2', { type: 'wonder.choose', wonder: 'nope' }, 'E_INVALID_COMMAND');
    reject(state, 'p2', { type: 'wonder.choose' }, 'E_INVALID_COMMAND');
    // 持有者以外的別人也不能蓋這座奇觀（p2 沒有奇觀）。
    reject(state, 'p2', { type: 'wonder.build' }, 'E_WONDER_NOT_CHOSEN');
  });

  it('只能在自己回合的行動階段：不是自己的回合、擲骰前、有 pending 時都被拒絕', () => {
    const state = ready();
    settle(state, 'p1', markerOf(state, 'greatWall'));
    reject(state, 'p2', { type: 'wonder.choose', wonder: 'greatWall' }, 'E_NOT_YOUR_TURN');
    const preroll = emptySeafarersGame(3, 0, 'preroll', PROFILE);
    settle(preroll, 'p1', markerOf(preroll, 'greatWall'));
    reject(preroll, 'p1', { type: 'wonder.choose', wonder: 'greatWall' }, 'E_WRONG_PHASE');
    expect(sf(preroll, 'p1').wonders).toEqual({ claimable: [], buildable: false });
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
    reject(state, 'p1', { type: 'wonder.choose', wonder: 'greatWall' }, 'E_PENDING_EFFECT');
  });

  it('條件只在認領時檢查：之後失去條件（建築被拆）仍可繼續施工', () => {
    let state = ready();
    settle(state, 'p1', markerOf(state, 'greatWall'));
    state = choose(state, 'p1', 'greatWall');
    state.board.buildings[markerOf(state, 'greatWall')] = null;
    fund(state, 'p1', { brick: 3, lumber: 1, grain: 1 });
    state = buildLevel(state, 'p1').state;
    expect(slot(state).levels.p1).toBe(1);
  });

  it('認領不花資源；claimableWonders 只回傳尚未被拿走且條件成立的牌', () => {
    let state = ready();
    settle(state, 'p1', markerOf(state, 'greatWall'));
    setHand(state, 'p1', { brick: 1 });
    state = choose(state, 'p1', 'greatWall');
    expect(player(state, 'p1').resources.brick).toBe(1);
    expect(claimableWonders(state, 'p1', ctxOf(state))).toEqual([]);
  });
});

/** 一個大島內部的村落位置（互不相鄰、方便當作 2 座城市等）。 */
function corner0(state: GameState, index: number): number {
  const topo = topologyOf(state);
  const picks: number[] = [];
  for (let vertex = 0; vertex < topo.vertices.length && picks.length <= index; vertex++) {
    const info = topo.vertices[vertex]!;
    if (info.hexes.length !== 3 || !info.hexes.every((h) => state.board.layout.islands[h] === 1)) continue;
    if (picks.some((other) => topo.vertices[other]!.edges.some((edge) => topo.edges[edge]!.vertices.includes(vertex)))) continue;
    if (slot(state).markers.greatWall.includes(vertex) || slot(state).markers.greatBridge.includes(vertex)) continue;
    picks.push(vertex);
  }
  return picks[index]!;
}

function state0Ports(state: GameState): Set<number> {
  const topo = topologyOf(state);
  return new Set(state.board.layout.harbors.flatMap((harbor) => topo.edges[harbor.edge]!.vertices));
}

describe('Wonders of Catan building (wonder.build)', () => {
  /** 每張牌的認領前置：給 p1 一個符合條件的位置。回傳認領後的狀態。 */
  function claimed(id: (typeof WONDER_IDS)[number], players: 3 | 4 = 3): GameState {
    let state = ready(players);
    switch (id) {
      case 'greatWall': settle(state, 'p1', markerOf(state, 'greatWall')); break;
      case 'greatBridge': settle(state, 'p1', markerOf(state, 'greatBridge')); break;
      case 'grandTheater': settle(state, 'p1', corner0(state, 0), true); settle(state, 'p1', corner0(state, 1), true); break;
      case 'grandCastle': settle(state, 'p1', corner0(state, 0), true); player(state, 'p1').bonusPoints = 4; break;
      case 'grandMonument': {
        const port = portVertex(state);
        settle(state, 'p1', port, true);
        coastChain(state, port, 5).edges.forEach((edge) => ship(state, 'p1', edge));
        break;
      }
    }
    state = choose(state, 'p1', id);
    return state;
  }

  for (const def of WONDERS) {
    it(`${def.id}：每層付牌上費用（四層相同），資源回到銀行，marker 依序 1、2、3、4`, () => {
      let state = claimed(def.id);
      const bankBefore = { ...state.bank };
      fund(state, 'p1', def.cost, 3);
      for (let level = 1; level <= 3; level++) {
        const before = { ...player(state, 'p1').resources };
        const result = buildLevel(state, 'p1');
        state = result.state;
        for (const resource of RESOURCES) {
          expect(before[resource] - player(state, 'p1').resources[resource], `${def.id} L${level} ${resource}`).toBe(def.cost[resource] ?? 0);
        }
        expect(slot(state).levels.p1).toBe(level);
        expect(result.events.find((event) => event.type === 'wonder.built')!.params).toEqual({ playerId: 'p1', wonder: def.id, level });
      }
      for (const resource of RESOURCES) expect(state.bank[resource] - bankBefore[resource]).toBe((def.cost[resource] ?? 0) * 3);
      expect(state.result).toBeNull();
      // 第 4 層：完成，遊戲結束（自己的回合完成奇觀）。
      fund(state, 'p1', def.cost);
      const done = buildLevel(state, 'p1');
      expect(slot(done.state).levels.p1).toBe(4);
      expect(done.state.result).toMatchObject({ playerId: 'p1', playerIds: ['p1'], reason: 'victory', cause: 'wonderComplete' });
      expect(done.state.turn.phase).toBe('gameOver');
    });
  }

  it('費用不足：缺任何一種都被拒絕（E_INSUFFICIENT_RESOURCES），手牌不變', () => {
    for (const def of WONDERS) {
      const state = claimed(def.id);
      for (const resource of Object.keys(def.cost) as Resource[]) {
        const hand: Partial<Record<Resource, number>> = { ...def.cost };
        hand[resource] = (def.cost[resource] ?? 0) - 1;
        setHand(state, 'p1', hand);
        reject(state, 'p1', { type: 'wonder.build' }, 'E_INSUFFICIENT_RESOURCES');
        expect(slot(state).levels.p1).toBe(0);
      }
    }
  });

  it('一回合可以蓋多層（付得起就一層接一層）；marker 逐格前進，第一次付費才放在 1', () => {
    let state = claimed('grandMonument');
    expect(slot(state).levels.p1).toBe(0);
    fund(state, 'p1', WONDERS[4]!.cost, 2);
    state = buildLevel(state, 'p1').state;
    state = buildLevel(state, 'p1').state;
    expect(slot(state).levels.p1).toBe(2);
    expect(state.turn.seat).toBe(0);
    reject(state, 'p1', { type: 'wonder.build' }, 'E_INSUFFICIENT_RESOURCES');
  });

  it('沒有認領就不能蓋（E_WONDER_NOT_CHOSEN）；hints.buildable 反映付不付得起與回合階段', () => {
    const state = ready();
    fund(state, 'p1', WONDERS[0]!.cost);
    reject(state, 'p1', { type: 'wonder.build' }, 'E_WONDER_NOT_CHOSEN');
    const own = claimed('greatWall');
    expect(sf(own, 'p1').wonders.buildable).toBe(false);
    fund(own, 'p1', WONDERS[0]!.cost);
    expect(sf(own, 'p1').wonders.buildable).toBe(true);
    expect(sf(own, 'p2').wonders.buildable).toBe(false);
    reject(own, 'p2', { type: 'wonder.build' }, 'E_NOT_YOUR_TURN');
  });

  it('每座奇觀歸屬與層數全部公開：任何視角看到的 wonders 投影相同', () => {
    let state = claimed('greatWall');
    fund(state, 'p1', WONDERS[0]!.cost);
    state = buildLevel(state, 'p1').state;
    const views = ['p1', 'p2', 'p3'].map((viewer) => (projectGame(state, viewer).modules!.seafarers as { wonders: unknown }).wonders);
    expect(views[1]).toEqual(views[0]);
    expect(views[2]).toEqual(views[0]);
    expect(views[0]).toMatchObject({ owned: { p1: 'greatWall', p2: null, p3: null }, levels: { p1: 1, p2: 0, p3: 0 } });
  });

  it('中途重啟：JSON 快照還原後可以繼續施工到完成', () => {
    let state = claimed('grandTheater');
    fund(state, 'p1', WONDERS[2]!.cost);
    state = buildLevel(state, 'p1').state;
    const restored = clone(state);
    expect(slot(restored)).toEqual(slot(state));
    fund(restored, 'p1', WONDERS[2]!.cost, 3);
    let next = restored;
    for (let i = 0; i < 3; i++) next = buildLevel(next, 'p1').state;
    expect(next.result).toMatchObject({ playerId: 'p1', cause: 'wonderComplete' });
  });
});

describe('Wonders of Catan victory (SF25 p. 18)', () => {
  /** p1 持有 greatWall 在 `level`；p2 持有 greatBridge 在 `p2Level`；p1 有 `points` 分。 */
  function race(level: number, p2Level: number, points: number, p3Level = 0): GameState {
    const state = ready(3);
    settle(state, 'p1', corner0(state, 0));
    player(state, 'p1').bonusPoints = points - 1;
    const wonders = slot(state);
    wonders.owned.p1 = 'greatWall';
    wonders.owned.p2 = 'greatBridge';
    wonders.levels.p1 = level;
    wonders.levels.p2 = p2Level;
    wonders.levels.p3 = p3Level;
    return state;
  }

  it('10 分且層數嚴格多於其他每位玩家：蓋下那一層時立即獲勝，cause 是 wonderLead（不是達到目標分）', () => {
    const state = race(1, 1, 10);
    fund(state, 'p1', WONDERS[0]!.cost);
    const done = buildLevel(state, 'p1');
    expect(slot(done.state).levels).toEqual({ p1: 2, p2: 1, p3: 0 });
    expect(done.state.result).toMatchObject({ playerId: 'p1', playerIds: ['p1'], reason: 'victory', cause: 'wonderLead' });
    const finished = done.events.find((event) => event.type === 'game.finished')!;
    expect(finished.params).toMatchObject({ playerId: 'p1', playerIds: ['p1'], cause: 'wonderLead', score: 10 });
    expect(finished.params).not.toHaveProperty('target');
    const view = projectGame(done.state, 'p2').result!;
    expect(view).toMatchObject({ playerId: 'p1', playerIds: ['p1'], cause: 'wonderLead', score: 10 });
  });

  it('層數平手不算「更高」：10 分、與最高的對手同層，不結束；對手更高也不結束', () => {
    const tie = race(0, 1, 10);
    fund(tie, 'p1', WONDERS[0]!.cost);
    const afterTie = buildLevel(tie, 'p1').state;
    expect(slot(afterTie).levels.p1).toBe(1);
    expect(afterTie.result).toBeNull();
    const behind = race(1, 2, 12);
    fund(behind, 'p1', WONDERS[0]!.cost);
    expect(buildLevel(behind, 'p1').state.result).toBeNull();
    // 第三位玩家同層：嚴格多於「其他每位」才行。
    const third = race(1, 0, 10, 2);
    fund(third, 'p1', WONDERS[0]!.cost);
    expect(buildLevel(third, 'p1').state.result).toBeNull();
  });

  it('9 分不夠；達到 10 分的那一刻（蓋城市）才結束；層數 0 的 10 分以上不結束', () => {
    const nine = race(1, 0, 9);
    expect(nine.result).toBeNull();
    // 升級 p1 的村落為城市：+1 分到 10，且 1 > 0。
    setHand(nine, 'p1', { ore: 3, grain: 2 });
    const city = act(nine, 'p1', { type: 'build.city', vertex: corner0(nine, 0) });
    expect(city.state.result).toMatchObject({ playerId: 'p1', cause: 'wonderLead' });
    // 沒有任何層數：就算 12 分也不結束（目標分單獨不足以獲勝）。
    const none = race(0, 0, 12);
    setHand(none, 'p1', { ore: 3, grain: 2 });
    const upgraded = act(none, 'p1', { type: 'build.city', vertex: corner0(none, 0) }).state;
    expect(score(upgraded, 'p1')).toBeGreaterThanOrEqual(13);
    expect(upgraded.result).toBeNull();
    expect(act(upgraded, 'p1', { type: 'turn.end' }).state.result).toBeNull();
  });

  it('隱藏的分數牌也算 10 分（自己的回合判定與目標分一致）', () => {
    const state = race(1, 0, 9);
    player(state, 'p1').hiddenBonusPoints = 1;
    setHand(state, 'p1', WONDERS[0]!.cost);
    const done = buildLevel(state, 'p1');
    expect(done.state.result).toMatchObject({ cause: 'wonderLead', playerId: 'p1' });
  });

  it('完成第 4 層即使分數很低、對手層數更高也獲勝：cause 是 wonderComplete', () => {
    const state = race(3, 3, 2);
    fund(state, 'p1', WONDERS[0]!.cost);
    const done = buildLevel(state, 'p1');
    expect(done.state.result).toMatchObject({ playerId: 'p1', playerIds: ['p1'], cause: 'wonderComplete' });
    const finished = done.events.find((event) => event.type === 'game.finished')!;
    expect(finished.params).toMatchObject({ cause: 'wonderComplete', score: 2 });
    expect(finished.params).not.toHaveProperty('target');
  });

  it('只在自己的回合判定：對手 10 分且層數最高也不會在別人的回合結束；輪到他的回合開始時才判定', () => {
    const state = race(0, 2, 10);
    // p2 持有最高層，但分數只有 0；p1 的回合 p1 層數 0：無人獲勝。
    expect(act(state, 'p1', { type: 'turn.end' }).state.result).toBeNull();
    const next = ready(3, 1);
    settle(next, 'p2', corner0(next, 0));
    player(next, 'p2').bonusPoints = 9;
    slot(next).owned.p2 = 'greatBridge';
    slot(next).levels.p2 = 2;
    // 輪到 p2 的行動窗口：開窗時判定（turn.started 之後的 checkVictory）。
    const after = act(next, 'p2', { type: 'turn.end' }).state;
    expect(after.result).toBeNull();
    expect(wonderCause(next, 'p2', 10, ctxOf(next))).toBe('wonderLead');
    expect(wonderCause(next, 'p1', 10, ctxOf(next))).toBeNull();
  });

  it('wonderCause 只看奇觀層數與分數：未達目標分、層數 0 都是 null', () => {
    const state = race(2, 1, 10);
    expect(wonderCause(state, 'p1', 10, ctxOf(state))).toBe('wonderLead');
    expect(wonderCause(state, 'p1', 9, ctxOf(state))).toBeNull();
    expect(wonderCause(state, 'p3', 30, ctxOf(state))).toBeNull();
    slot(state).levels.p3 = 4;
    expect(wonderCause(state, 'p3', 0, ctxOf(state))).toBe('wonderComplete');
  });
});

describe('Wonders of Catan without a pirate (SF25 p. 18)', () => {
  it('海盜不使用：hints 沒有海盜目標；7／騎士只能移強盜，海格與框都被拒絕', () => {
    const state = ready();
    expect(sf(state, 'p1').pirateTargets).toEqual([]);
    expect(sf(state, 'p1').robberTargets.length).toBeGreaterThan(0);
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
    const seaHex = state.board.layout.terrain.findIndex((terrain) => terrain === 'sea');
    expect(sf(state, 'p1').pirateTargets).toEqual([]);
    reject(state, 'p1', { type: 'pending.moveRobber', hex: seaHex }, 'E_ILLEGAL_TARGET');
    reject(state, 'p1', { type: 'pending.moveRobber', hex: null }, 'E_ILLEGAL_TARGET');
    const landTarget = sf(state, 'p1').robberTargets[0]!;
    const moved = act(state, 'p1', { type: 'pending.moveRobber', hex: landTarget } as never).state;
    expect(moved.board.robber).toBe(landTarget);
    expect(moved.board.pirate).toBeNull();
  });
});

describe('Wonders of Catan D7 isolation', () => {
  it('其他劇本的 module state 沒有 wonders 欄位；S8 的 module state 有', () => {
    for (const [profileId, players] of [['sf-new-shores-2025', 4], ['sf-four-islands-2025', 3], ['sf-forgotten-tribe-2025', 3], ['sf-cloth-for-catan-2025', 3]] as const) {
      const { state } = seafarersGame(players, 3, profileId);
      expect(seafarersState(state)).not.toHaveProperty('wonders');
    }
    expect(seafarersState(game().state)).toHaveProperty('wonders');
    expect(RESOURCES).toHaveLength(5);
  });

  it('目標分路徑不變：New Shores 達到 14 分的單一勝者輸出沒有 playerIds 與 cause', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    settle(state, 'p1', corner0Any(state));
    player(state, 'p1').bonusPoints = 13;
    setHand(state, 'p1', { ore: 3, grain: 2 });
    const done = act(state, 'p1', { type: 'build.city', vertex: corner0Any(state) });
    expect(done.state.result).toEqual({ playerId: 'p1', reason: 'victory', atSeq: done.events.find((event) => event.type === 'game.finished')!.seq - 1 });
    const params = done.events.find((event) => event.type === 'game.finished')!.params;
    expect(Object.keys(params).sort()).toEqual(['playerId', 'reason', 'score', 'target']);
    expect(params).toMatchObject({ playerId: 'p1', reason: 'victory', target: 14 });
  });
});

function corner0Any(state: GameState): number {
  const topo = topologyOf(state);
  return topo.vertices.findIndex((info) => info.hexes.length === 3 && info.hexes.every((h) => state.board.layout.terrain[h] !== 'sea'));
}
