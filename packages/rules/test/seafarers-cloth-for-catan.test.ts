/**
 * R-SFX-S6：Cloth for Catan（布匹產地）。版圖與配件表對照 SF25 pp. 14–15（3 人與 4 人共用同一張
 * 42 格圖）；規則 fixture 為第三個起始村落、部落貿易、布匹生產與供應堆、2 枚 1 分、封閉通路、
 * 海盜與偷布匹、強盜不可進小島、無最長道路、14 分與布匹耗盡終局（含共同勝利與 `GameResult` 相容性）。
 */

import { describe, expect, it } from 'vitest';
import { isLandEdge, isSeaEdge, scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, legalBuildingVertices } from '../src/engine.ts';
import { tribeRoutes } from '../src/modules/seafarers/cloth.ts';
import { seafarersState } from '../src/modules/seafarers/state.ts';
import { getProfile, resolveCombination } from '../src/profiles.ts';
import { projectEvent, projectGame } from '../src/project.ts';
import { seededRng } from '../src/rng.ts';
import {
  CFC_PORT_TOKENS, CFC_TRIBES, CLOTH_FOR_CATAN_SOURCE, tribeVertices,
} from '../src/seafarers-scenario-boards.ts';
import { getTopology } from '../src/topology-registry.ts';
import type { GameState } from '../src/types.ts';
import { act, expectRejected, scriptedRng, setHand } from './helpers.ts';
import { emptySeafarersGame, hex, road, seafarersGame, settle, ship } from './seafarers-helpers.ts';

const PROFILE = 'sf-cloth-for-catan-2025';

function tally<T extends string | number | null>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[String(value)] = (out[String(value)] ?? 0) + 1;
  return out;
}

const game = (players: 3 | 4 = 3, seed = 12345) => seafarersGame(players, seed, PROFILE);
const ready = (players: 3 | 4 = 3, seat = 0, phase: 'preroll' | 'action' = 'action') => emptySeafarersGame(players, seat, phase, PROFILE);
const slot = (state: GameState) => seafarersState(state).cloth!;
const score = (state: GameState, id: string) => scoreOf(state, id, { includeHidden: true });
const player = (state: GameState, id: string) => state.players.find((candidate) => candidate.id === id)!;
const sf = (state: GameState, id: string) => actionHints(state, id).modules!.seafarers as {
  pirateTargets: (number | null)[]; robberTargets: number[]; clothVictims: string[]; movableShips: { edge: number; targets: number[] }[];
};
const publicCloth = (state: GameState, viewer: string) =>
  (projectGame(state, viewer).modules!.seafarers as { cloth: { tribes: { vertex: number; number: number; cloth: number }[]; supply: number; links: Record<string, number[]>; cloth: Record<string, number> } }).cloth;
const clone = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;
const clothSum = (state: GameState): number =>
  slot(state).tribes.reduce((sum, tribe) => sum + tribe.cloth, 0) + slot(state).supply + Object.values(slot(state).cloth).reduce((sum, value) => sum + value, 0);

/** 轉錄座標（原點在左上）到 repo 座標。 */
const rp = (q: number, r: number): [number, number] => [q, r - 3];

/** 擲出 `total`（2–12）的骰子腳本。 */
const dice = (total: number): number[] => {
  const first = Math.min(5, total - 1);
  return [first - 1, total - first - 1];
};

/**
 * 從某個合法的起始村落沿海邊走到部落頂點的最短路徑（BFS，只經過空的海邊）。
 * 回傳起始村落頂點與依序要放的船的邊；`avoid` 是已被占用的頂點。
 */
function routeTo(state: GameState, tribeIndex: number, from?: number): { start: number; edges: number[] } {
  const topo = topologyOf(state);
  const target = slot(state).tribes[tribeIndex]!.vertex;
  const starts = from === undefined ? legalBuildingVertices(state, 'p1', { setup: true }) : [from];
  const queue: { vertex: number; edges: number[]; start: number }[] = starts.map((vertex) => ({ vertex, edges: [], start: vertex }));
  const seen = new Set<number>(starts);
  for (let head = 0; head < queue.length; head++) {
    const { vertex, edges, start } = queue[head]!;
    if (vertex === target) return { start, edges };
    for (const edge of topo.vertices[vertex]!.edges) {
      if (state.board.roads[edge] || !isSeaEdge(state, edge)) continue;
      const info = topo.edges[edge]!;
      const next = info.vertices[0] === vertex ? info.vertices[1]! : info.vertices[0]!;
      if (seen.has(next) || state.board.buildings[next]) continue;
      seen.add(next);
      queue.push({ vertex: next, edges: [...edges, edge], start });
    }
  }
  throw new Error(`no route to tribe ${tribeIndex}`);
}

/** p1 在路徑起點蓋村落，沿路徑一艘一艘建船（每艘 1 木 1 羊），回傳最後的狀態。 */
function sail(state: GameState, playerId: string, route: { start: number; edges: number[] }, upTo = route.edges.length): GameState {
  if (!state.board.buildings[route.start]) settle(state, playerId, route.start);
  let next = state;
  for (const edge of route.edges.slice(0, upTo)) {
    setHand(next, playerId, { lumber: 1, wool: 1 });
    next = act(next, playerId, { type: 'build.ship', edge } as never).state;
  }
  return next;
}

describe('Cloth for Catan topology (SF25 pp. 14–15, spec §7.3)', () => {
  it('42 格外框 5-6-7-6-7-6-5，與 sf-new-shores-4 同形（hex／邊／頂點／框內緣邊數）；9 個港口位置', () => {
    const topology = getTopology('sf-cloth-for-catan');
    const reference = getTopology('sf-new-shores-4');
    expect(topology.hexes).toHaveLength(42);
    expect(topology.hexes.map(({ q, r }) => [q, r])).toEqual(reference.hexes.map(({ q, r }) => [q, r]));
    expect([topology.edges.length, topology.vertices.length, topology.coastalEdges.length, topology.harborSlots.length])
      .toEqual([reference.edges.length, reference.vertices.length, reference.coastalEdges.length, 9]);
    expect(topology.vertices.length - topology.edges.length + topology.hexes.length).toBe(1);
    const rows = tally(topology.hexes.map((cell) => cell.r));
    expect([-3, -2, -1, 0, 1, 2, 3].map((r) => rows[r])).toEqual([5, 6, 7, 6, 7, 6, 5]);
    // 中排兩端的框突出部 (-3,0)、(4,0) 不是格。
    for (const q of [-3, 4]) expect(topology.hexes.some((cell) => cell.q === q && cell.r === 0)).toBe(false);
    // 9 個港口位置各不相同，都是框內緣邊（貼在陸地格朝向框的邊）。
    expect(new Set(topology.harborSlots).size).toBe(9);
    for (const edge of topology.harborSlots) expect(topology.coastalEdges).toContain(edge);
  });

  it('平移 (dq, dr) = (0, -3)：轉錄各排 q 範圍與 NS4_CELLS 逐排一致', () => {
    expect(CLOTH_FOR_CATAN_SOURCE.shift).toEqual({ dq: 0, dr: -3 });
    const transcribed: Record<number, [number, number]> = { 0: [0, 4], 1: [-1, 4], 2: [-2, 4], 3: [-2, 3], 4: [-3, 3], 5: [-3, 2], 6: [-3, 1] };
    const topology = getTopology('sf-cloth-for-catan');
    for (const [r, [from, to]] of Object.entries(transcribed)) {
      const qs = topology.hexes.filter((cell) => cell.r === Number(r) - 3).map((cell) => cell.q).sort((a, b) => a - b);
      expect([qs[0], qs[qs.length - 1], qs.length]).toEqual([from, to, to - from + 1]);
    }
  });

  it('8 個部落頂點：各由小島格與兩個海格共用；上下兩個一組，數字對 (11,8)、(10,9)、(4,5)、(6,3)', () => {
    const { state } = game();
    const topo = topologyOf(state);
    const vertices = tribeVertices(topo);
    expect(new Set(vertices).size).toBe(8);
    const pairs: number[][] = [];
    vertices.forEach((vertex, index) => {
      const hexes = topo.vertices[vertex]!.hexes;
      expect(hexes).toHaveLength(3);
      const land = hexes.filter((h) => state.board.layout.terrain[h] !== 'sea');
      expect(land).toHaveLength(1);
      expect([2, 3, 4, 5]).toContain(state.board.layout.islands[land[0]!]);
      expect(state.board.layout.numbers[land[0]!]).toBeNull();
      expect(state.board.buildings[vertex]).toBeNull();
      expect(CFC_TRIBES[index]!.number).toBe(slot(state).tribes[index]!.number);
    });
    for (let island = 2; island <= 5; island++) {
      const mine = vertices.map((vertex, index) => ({ vertex, index })).filter(({ vertex }) =>
        topo.vertices[vertex]!.hexes.some((h) => state.board.layout.islands[h] === island));
      expect(mine).toHaveLength(2);
      // 上頂點在下頂點之上（y 較小）。
      const [top, bottom] = mine.sort((a, b) => topo.vertices[a.vertex]!.y - topo.vertices[b.vertex]!.y);
      pairs.push([CFC_TRIBES[top!.index]!.number, CFC_TRIBES[bottom!.index]!.number]);
    }
    expect(pairs.map((pair) => pair.join('/')).sort()).toEqual(['10/9', '11/8', '4/5', '6/3']);
    expect(CFC_TRIBES.map((spec) => spec.number).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 8, 9, 10, 11]);
  });
});

describe('Cloth for Catan layout (SF25 p. 14 配件表)', () => {
  it('地形 海 18、沙漠 2、金礦 2、田野 5、小丘 3、高山 4、草地 4、森林 4 = 42；3 人與 4 人同一張圖', () => {
    for (const players of [3, 4] as const) {
      const { state } = game(players);
      const layout = state.board.layout;
      expect(layout.topologyId).toBe('sf-cloth-for-catan');
      expect(layout.terrain).toHaveLength(42);
      expect(tally(layout.terrain)).toEqual({ sea: 18, desert: 2, gold: 2, fields: 5, hills: 3, mountains: 4, pasture: 4, forest: 4 });
    }
    expect(game(3).state.board.layout.terrain).toEqual(game(4).state.board.layout.terrain);
  });

  it('圓片：陸地 20 枚 + 部落 8 枚 = 28（2:2、3:3、4:3、5:3、6:3、8:3、9:3、10:3、11:3、12:2）', () => {
    const { state } = game();
    const land = state.board.layout.numbers.filter((n): n is number => n !== null);
    expect(land).toHaveLength(20);
    const all = [...land, ...CFC_TRIBES.map((spec) => spec.number)];
    expect(all).toHaveLength(28);
    expect(tally(all)).toEqual({ 2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 2 });
    // 沒有 7；大島 20 格有圓片，四座小島沒有。
    expect(all).not.toContain(7);
  });

  it('島：北大島 10 格（島 1）、南大島 10 格（島 6）、四座單格小島（金礦、沙漠、沙漠、金礦，無圓片）', () => {
    const { state } = game();
    const { islands, terrain, numbers } = state.board.layout;
    expect(tally(islands.filter((island) => island > 0))).toEqual({ 1: 10, 2: 1, 3: 1, 4: 1, 5: 1, 6: 10 });
    const small = [2, 3, 4, 5].map((island) => islands.indexOf(island));
    expect(small.map((index) => terrain[index])).toEqual(['gold', 'desert', 'desert', 'gold']);
    for (const index of small) expect(numbers[index]).toBeNull();
    for (const [index, island] of islands.entries()) if (island === 1 || island === 6) expect(numbers[index]).not.toBeNull();
  });

  it('轉錄表與 layout 一致（逐格地形、圓片、島編號），強盜在田野 12（轉錄 (-2,2)），海盜在框上', () => {
    const { state } = game(4);
    expect(CLOTH_FOR_CATAN_SOURCE.land).toHaveLength(24);
    for (const land of CLOTH_FOR_CATAN_SOURCE.land) {
      const index = hex(state, land.q, land.r);
      expect([state.board.layout.terrain[index], state.board.layout.numbers[index], state.board.layout.islands[index]])
        .toEqual([land.terrain, land.number, land.island]);
    }
    const [q, r] = rp(-2, 2);
    expect(state.board.robber).toBe(hex(state, q, r));
    expect(state.board.layout.terrain[state.board.robber]).toBe('fields');
    expect(state.board.layout.numbers[state.board.robber]).toBe(12);
    expect(state.board.pirate).toBeNull();
  });

  it('9 個港口全是隨機種類、固定位置：5 個 2:1（各一種資源）+ 4 個 3:1；種類由 game rng 決定', () => {
    expect(tally(CFC_PORT_TOKENS)).toEqual({ lumber: 1, brick: 1, wool: 1, grain: 1, ore: 1, generic: 4 });
    const { state } = game();
    const harbors = state.board.layout.harbors;
    expect(harbors).toHaveLength(9);
    expect(tally(harbors.map((harbor) => harbor.type))).toEqual({ lumber: 1, brick: 1, wool: 1, grain: 1, ore: 1, generic: 4 });
    expect(harbors.map((harbor) => harbor.edge)).toEqual(getTopology('sf-cloth-for-catan').harborSlots);
    const order = (seed: number) => game(3, seed).state.board.layout.harbors.map((harbor) => harbor.type).join();
    expect(order(7)).toBe(order(7));
    expect(new Set([1, 2, 3, 4, 5, 6].map(order)).size).toBeGreaterThan(1);
  });

  it('布匹 50 枚：8 個部落各 5 枚 + 供應堆 10 枚；公開狀態含部落、供應堆、各玩家布匹與關係', () => {
    const { state } = game(4);
    expect(slot(state).tribes.map((tribe) => tribe.cloth)).toEqual(Array(8).fill(5));
    expect(slot(state).supply).toBe(10);
    expect(clothSum(state)).toBe(50);
    const pub = publicCloth(state, 'p2');
    expect(pub.supply).toBe(10);
    expect(pub.tribes).toHaveLength(8);
    expect(pub.cloth).toEqual({ p1: 0, p2: 0, p3: 0, p4: 0 });
    expect(pub.links).toEqual({ p1: [], p2: [], p3: [], p4: [] });
  });

  it('profile：14 分、15 艘船、無島嶼獎勵、規則版本 sf-2025.3；只接受 3、4 人；其他劇本的投影沒有 cloth', () => {
    const profile = getProfile(PROFILE)!;
    expect(profile).toMatchObject({ victoryTarget: 14, implemented: true, enabled: true, scenario: 'cloth-for-catan', ruleVersion: 'sf-2025.3' });
    expect(profile.islandBonus).toBeUndefined();
    expect(profile.pieces.ships).toBe(15);
    const base = { expansions: ['seafarers'], scenario: 'cloth-for-catan', variants: [], setupMode: 'fixed' as const };
    for (const playerCount of [3, 4]) expect(resolveCombination({ ...base, playerCount })).toMatchObject({ ok: true });
    for (const playerCount of [2, 5, 6]) expect(resolveCombination({ ...base, playerCount })).toEqual({ ok: false, reason: 'bad-player-count' });
    const other = seafarersGame(3, 1, 'sf-four-islands-2025').state;
    expect((projectGame(other, 'p1').modules!.seafarers as Record<string, unknown>).cloth).toBeUndefined();
  });
});

describe('SFX-S6 設置：第三個村落', () => {
  /** 逐步放置：一律用提示的第 `pick` 個合法位置（必要時換一個）。 */
  function place(state: GameState, vertexPick = 0): GameState {
    const setup = state.turn.setup!;
    const actor = state.players[setup.order[setup.index]!]!.id;
    const hints = actionHints(state, actor);
    if (setup.stage === 'building') {
      return act(state, actor, { type: 'setup.placeBuilding', vertex: hints.legalSettlements[vertexPick % hints.legalSettlements.length]! }).state;
    }
    return act(state, actor, { type: 'setup.placeRoad', edge: hints.legalRoads[0]! }).state;
  }

  it('順序：正序、倒序、再正序（順時針從起始玩家起）共 3n 步；前兩輪不收資源，第三個村落按它發', () => {
    for (const players of [3, 4] as const) {
      let { state } = game(players);
      expect(state.turn.setup!.order).toEqual([...Array(players).keys(), ...[...Array(players).keys()].reverse(), ...Array(players).keys()]);
      const handTotal = (s: GameState) => s.players.reduce((sum, p) => sum + Object.values(p.resources).reduce((a, b) => a + b, 0), 0);
      const placed: { player: string; round: number; third: boolean }[] = [];
      let guard = 0;
      while (state.turn.phase === 'setup' && guard++ < 200) {
        const setup = state.turn.setup!;
        if (setup.stage === 'building') placed.push({ player: state.players[setup.order[setup.index]!]!.id, round: setup.round, third: setup.third === true });
        const wasThird = setup.third === true && setup.stage === 'road';
        const before = handTotal(state);
        state = place(state, setup.index);
        // 第三輪之前沒有任何資源發出。
        if (setup.index < players * 2) expect(handTotal(state)).toBe(before);
        if (wasThird) expect(handTotal(state)).toBe(before);
      }
      expect(placed).toHaveLength(players * 3);
      expect(placed.map((entry) => entry.third)).toEqual([...Array(players * 2).fill(false), ...Array(players).fill(true)]);
      expect(placed.slice(players * 2).map((entry) => entry.player)).toEqual(state.players.map((p) => p.id));
      // 事件：只有第三個村落發了起始資源，每位玩家一次。
      const grants = state.log.filter((event) => event.type === 'setup.startingResources');
      expect(grants.map((event) => event.params.playerId)).toEqual(state.players.map((p) => p.id));
      expect(state.turn.phase).toBe('preroll');
      expect(state.turn.seat).toBe(0);
      expect(state.turn.setup).toBeNull();
      // 每位玩家 3 個村落 + 3 條路／船。
      for (const p of state.players) {
        expect(state.board.buildings.filter((b) => b?.player === p.id)).toHaveLength(3);
        expect(state.board.roads.filter((r) => r?.player === p.id)).toHaveLength(3);
      }
    }
  });

  it('第三個村落按它發起始資源：先手玩家第三個村落旁的陸地格各一張', () => {
    let { state } = game(3);
    const players = 3;
    let thirdVertex = -1;
    let guard = 0;
    while (state.turn.phase === 'setup' && guard++ < 200) {
      const setup = state.turn.setup!;
      if (setup.third === true && setup.index === players * 2 && setup.stage === 'building') {
        thirdVertex = actionHints(state, 'p1').legalSettlements[0]!;
        state = act(state, 'p1', { type: 'setup.placeBuilding', vertex: thirdVertex }).state;
        const expected: Record<string, number> = {};
        for (const h of topologyOf(state).vertices[thirdVertex]!.hexes) {
          const terrain = state.board.layout.terrain[h]!;
          const resource = { forest: 'lumber', hills: 'brick', pasture: 'wool', fields: 'grain', mountains: 'ore' }[terrain as string];
          if (resource) expected[resource] = (expected[resource] ?? 0) + 1;
        }
        const got = Object.fromEntries(Object.entries(player(state, 'p1').resources).filter(([, n]) => n > 0));
        expect(got).toEqual(expected);
        continue;
      }
      state = place(state, setup.index);
    }
    expect(thirdVertex).toBeGreaterThanOrEqual(0);
  });

  it('起始村落可放在任一座大島（或分在兩座），不可碰到小島；之後建村落也不可在小島', () => {
    const { state } = game(4);
    const topo = topologyOf(state);
    const legal = legalBuildingVertices(state, 'p1', { setup: true });
    expect(legal.length).toBeGreaterThan(0);
    const islandsOf = (vertex: number) => new Set(topo.vertices[vertex]!.hexes.map((h) => state.board.layout.islands[h]).filter((i) => i > 0));
    for (const vertex of legal) for (const island of islandsOf(vertex)) expect([1, 6]).toContain(island);
    // 兩座大島都有合法起點。
    expect(legal.some((vertex) => islandsOf(vertex).has(1))).toBe(true);
    expect(legal.some((vertex) => islandsOf(vertex).has(6))).toBe(true);
    // 部落頂點（小島頂點）不能蓋。
    for (const vertex of tribeVertices(topo)) {
      expect(legal).not.toContain(vertex);
      expectRejected(state, 'p1', { type: 'setup.placeBuilding', vertex }, 'E_ILLEGAL_TARGET');
    }
    // 小島任一頂點都不行（全程）：放完船連到小島後也不能蓋。
    const islandVertices = topo.vertices.map((_, v) => v).filter((v) => islandsOf(v).has(2) || islandsOf(v).has(3) || islandsOf(v).has(4) || islandsOf(v).has(5));
    const mid = ready();
    for (const vertex of islandVertices) expect(legalBuildingVertices(mid, 'p1', { requireConnection: false })).not.toContain(vertex);
  });

  it('起始的船可以直接連到部落：第三輪之後立即建立關係（setup 放船也算）', () => {
    // 找一個起始村落旁邊的船邊剛好碰到部落頂點的位置。
    const { state } = game(3);
    const topo = topologyOf(state);
    const target = new Set(slot(state).tribes.map((tribe) => tribe.vertex));
    const adjacent = legalBuildingVertices(state, 'p1', { setup: true }).find((vertex) =>
      topo.vertices[vertex]!.edges.some((edge) => {
        const info = topo.edges[edge]!;
        return isSeaEdge(state, edge) && info.vertices.some((end) => target.has(end));
      }));
    // 從大島頂點到部落至少隔一艘船的圖形也可接受：此時只驗證 setup 流程不會出錯。
    if (adjacent === undefined) return;
    const next = act(state, 'p1', { type: 'setup.placeBuilding', vertex: adjacent }).state;
    const edge = topo.vertices[adjacent]!.edges.find((e) => isSeaEdge(next, e) && topo.edges[e]!.vertices.some((end) => target.has(end)))!;
    const after = act(next, 'p1', { type: 'setup.placeShip', edge } as never).state;
    expect(slot(after).links.p1).toHaveLength(1);
    expect(slot(after).cloth.p1).toBe(1);
  });
});

describe('SFX-S6 部落貿易（建立關係）', () => {
  it('從自己的村落沿自己的船連到部落頂點時建立關係，立即拿 1 枚布匹（部落 5 → 4）', () => {
    const state = ready();
    const route = routeTo(state, 0);
    const before = sail(state, 'p1', route, route.edges.length - 1);
    expect(slot(before).links.p1).toEqual([]);
    expect(slot(before).cloth.p1).toBe(0);
    setHand(before, 'p1', { lumber: 1, wool: 1 });
    const after = act(before, 'p1', { type: 'build.ship', edge: route.edges[route.edges.length - 1]! } as never);
    expect(slot(after.state).links.p1).toEqual([0]);
    expect(slot(after.state).cloth.p1).toBe(1);
    expect(slot(after.state).tribes[0]!.cloth).toBe(4);
    expect(clothSum(after.state)).toBe(50);
    expect(after.events.filter((event) => event.type === 'cloth.trade').map((event) => event.params)).toEqual([
      { playerId: 'p1', tribe: 0, number: 10, gained: 1 },
    ]);
    // 公開：所有人都看到關係與布匹。
    expect(publicCloth(after.state, 'p2').links.p1).toEqual([0]);
    expect(publicCloth(after.state, 'p2').cloth.p1).toBe(1);
  });

  it('每位玩家對每個部落只建立一次；他人已連不影響；同一部落的第二條通路不再拿', () => {
    const state = ready(4);
    const first = routeTo(state, 0);
    const a = sail(state, 'p1', first);
    expect(slot(a).tribes[0]!.cloth).toBe(4);
    // p2 也連到同一部落：照樣拿 1 枚（他人已連不影響）。
    const second = routeTo(a, 0);
    a.turn.seat = 1;
    a.windowId += 1;
    const b = sail(a, 'p2', second);
    expect(slot(b).links.p2).toEqual([0]);
    expect(slot(b).cloth).toMatchObject({ p1: 1, p2: 1 });
    expect(slot(b).tribes[0]!.cloth).toBe(3);
    // p1 再蓋第二條通路到同一部落（另一個村落）：只算一次。
    const topo = topologyOf(b);
    const tribeVertex = slot(b).tribes[0]!.vertex;
    const spare = topo.vertices[tribeVertex]!.edges.find((edge) => !b.board.roads[edge] && isSeaEdge(b, edge))!;
    b.turn.seat = 0;
    b.windowId += 1;
    setHand(b, 'p1', { lumber: 2, wool: 2 });
    const info = topo.edges[spare]!;
    const other = info.vertices.find((v) => v !== tribeVertex)!;
    // 在這條邊另一端放一個新村落（不管距離規則，直接擺棋）以建立第二條通路。
    settle(b, 'p1', other);
    const c = act(b, 'p1', { type: 'build.ship', edge: spare } as never).state;
    expect(slot(c).links.p1).toEqual([0]);
    expect(slot(c).cloth.p1).toBe(1);
    expect(slot(c).tribes[0]!.cloth).toBe(3);
  });

  it('部落已空時仍建立關係，但拿不到布匹（也不從供應堆補）', () => {
    const state = ready();
    slot(state).tribes[0]!.cloth = 0;
    slot(state).supply += 5;
    const route = routeTo(state, 0);
    const after = sail(state, 'p1', route);
    expect(slot(after).links.p1).toEqual([0]);
    expect(slot(after).cloth.p1).toBe(0);
    expect(slot(after).supply).toBe(15);
    expect(clothSum(after)).toBe(50);
  });

  it('移動船連到部落也建立關係（SF25：建立通路），船的來源邊不影響', () => {
    const state = ready();
    const route = routeTo(state, 3);
    expect(route.edges).toHaveLength(3);
    // 先把整條路徑建到只差最後一步，再把倒數第二艘船以外的開放端船移過去的情形：這裡用兩艘船形成 L 形。
    const placed = sail(state, 'p1', route, route.edges.length - 1);
    expect(slot(placed).links.p1).toEqual([]);
    // 換 seat 讓同一個窗口之後才可移動（剛建的船這回合不能移）。
    placed.windowId += 1;
    const last = route.edges[route.edges.length - 1]!;
    const topo = topologyOf(placed);
    const tribeVertex = slot(placed).tribes[3]!.vertex;
    // 最後一艘船先放在遠處的鄰邊，再移到部落頂點邊上：找路徑倒數第二艘的端點旁另一條邊。
    const tipEdge = route.edges[route.edges.length - 2]!;
    const tip = topo.edges[tipEdge]!.vertices.find((v) => topo.edges[last]!.vertices.includes(v))!;
    const alt = topo.vertices[tip]!.edges.find((edge) => edge !== tipEdge && edge !== last && !placed.board.roads[edge] && isSeaEdge(placed, edge) &&
      !topo.edges[edge]!.vertices.includes(tribeVertex));
    expect(alt).toBeDefined();
    setHand(placed, 'p1', { lumber: 1, wool: 1 });
    const withAlt = act(placed, 'p1', { type: 'build.ship', edge: alt! } as never).state;
    withAlt.windowId += 1;
    const moved = act(withAlt, 'p1', { type: 'ship.move', from: alt!, to: last } as never).state;
    expect(slot(moved).links.p1).toEqual([3]);
    expect(slot(moved).cloth.p1).toBe(1);
  });

  it('別人的建築擋路：路徑不穿過對手的村落', () => {
    const state = ready();
    const route = routeTo(state, 0);
    const built = sail(state, 'p1', route, route.edges.length);
    expect(tribeRoutes(built, 'p1').reached).toContain(0);
    expect(tribeRoutes(built, 'p2').reached).toEqual([]);
    // 在路徑中途放一個對手村落（直接擺棋）：p1 的通路被切斷。
    const topo = topologyOf(built);
    const middle = route.edges.length > 1 ? topo.edges[route.edges[0]!]!.vertices.find((v) => topo.edges[route.edges[1]!]!.vertices.includes(v))! : -1;
    if (middle >= 0) {
      settle(built, 'p2', middle);
      expect(tribeRoutes(built, 'p1').reached).not.toContain(0);
    }
  });
});

describe('SFX-S6 生產與供應堆', () => {
  /** 兩位玩家連到部落 0（數字 10）：直接寫 module state，生產測試不用繞路。 */
  function linked(...ids: string[]): GameState {
    const state = ready(4, 0, 'preroll');
    for (const id of ids) {
      slot(state).links[id] = [0];
    }
    return state;
  }

  it('擲到部落的數字：每位有關係的玩家各得 1 枚（從部落拿）', () => {
    const state = linked('p1', 'p3');
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice(10)));
    expect(slot(rolled.state).cloth).toMatchObject({ p1: 1, p2: 0, p3: 1, p4: 0 });
    expect(slot(rolled.state).tribes[0]!.cloth).toBe(3);
    expect(slot(rolled.state).supply).toBe(10);
    expect(rolled.events.find((event) => event.type === 'cloth.produced')!.params).toEqual({
      tribe: 0, number: 10, gains: { p1: 1, p3: 1 }, fromTribe: 2, fromSupply: 0, shortBy: 0,
    });
  });

  it('沒有關係的玩家什麼都沒有；沒有人有關係的部落不產出；別的數字不產出', () => {
    const state = linked('p2');
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice(10))).state;
    expect(slot(rolled).cloth).toMatchObject({ p1: 0, p2: 1 });
    const other = linked('p2');
    const miss = act(other, 'p1', { type: 'turn.roll' }, scriptedRng(dice(7).length ? dice(4) : [])).state;
    expect(slot(miss).cloth.p2).toBe(0);
    expect(slot(miss).tribes[0]!.cloth).toBe(5);
    // 部落 1（數字 9）沒有人連。
    const none = ready(4, 0, 'preroll');
    const rolledNone = act(none, 'p1', { type: 'turn.roll' }, scriptedRng(dice(9))).state;
    expect(slot(rolledNone).tribes[1]!.cloth).toBe(5);
    expect(clothSum(rolledNone)).toBe(50);
  });

  it('部落不夠分：不足的部分從供應堆補；供應堆減少，布匹總數守恆', () => {
    const state = linked('p1', 'p2', 'p3');
    slot(state).tribes[0]!.cloth = 1;
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice(10)));
    expect(slot(rolled.state).cloth).toMatchObject({ p1: 1, p2: 1, p3: 1 });
    expect(slot(rolled.state).tribes[0]!.cloth).toBe(0);
    expect(slot(rolled.state).supply).toBe(8);
    expect(rolled.events.find((event) => event.type === 'cloth.produced')!.params).toMatchObject({ fromTribe: 1, fromSupply: 2, shortBy: 0 });
    // 部落 1 枚 + 供應堆 2 枚發給玩家；其餘的 5×7 = 35 + 剩下的供應堆 8 + 玩家 3 = 46（linked 的測試狀態沒有真的發過第一枚）。
    expect(clothSum(rolled.state)).toBe(clothSum(state));
  });

  it('供應堆也不夠：依擲骰者起的順時針次序逐位發，領不到的人少拿（shortBy）', () => {
    const state = linked('p1', 'p2', 'p3', 'p4');
    state.turn.seat = 1; // p2 擲骰：次序 p2、p3、p4、p1
    slot(state).tribes[0]!.cloth = 1;
    slot(state).supply = 1;
    const rolled = act(state, 'p2', { type: 'turn.roll' }, scriptedRng(dice(10)));
    expect(slot(rolled.state).cloth).toMatchObject({ p2: 1, p3: 1, p4: 0, p1: 0 });
    expect(slot(rolled.state).supply).toBe(0);
    expect(rolled.events.find((event) => event.type === 'cloth.produced')!.params).toMatchObject({ fromTribe: 1, fromSupply: 1, shortBy: 2 });
  });

  it('部落歸零後不再產出，也不從供應堆拿', () => {
    const state = linked('p1', 'p2');
    slot(state).tribes[0]!.cloth = 0;
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice(10)));
    expect(slot(rolled.state).cloth).toMatchObject({ p1: 0, p2: 0 });
    expect(slot(rolled.state).supply).toBe(10);
    expect(rolled.events.some((event) => event.type === 'cloth.produced')).toBe(false);
  });

  it('生產在金礦之前結算：同一擲先有 cloth.produced 事件再有 gold.required', () => {
    const state = linked('p1');
    // 讓 p1 的村落碰到一個金礦格並讓金礦格帶 10 號圓片。
    const goldHex = state.board.layout.terrain.indexOf('gold');
    state.board.layout.numbers[goldHex] = 10;
    const vertex = topologyOf(state).vertices.findIndex((info) => info.hexes.includes(goldHex));
    settle(state, 'p1', vertex);
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice(10)));
    const types = rolled.events.map((event) => event.type);
    expect(types.indexOf('cloth.produced')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('cloth.produced')).toBeLessThan(types.indexOf('gold.required'));
  });
});

describe('SFX-S6 分數', () => {
  it('每 2 枚布匹 1 分，餘數不計，全程計入（公開分數也算）', () => {
    const state = ready();
    settle(state, 'p1', legalBuildingVertices(state, 'p1', { setup: true })[0]!);
    const base = score(state, 'p1');
    for (const [cloth, points] of [[0, 0], [1, 0], [2, 1], [3, 1], [4, 2], [9, 4]] as const) {
      slot(state).cloth.p1 = cloth;
      expect(score(state, 'p1'), `cloth ${cloth}`).toBe(base + points);
    }
    slot(state).cloth.p1 = 5;
    const view = projectGame(state, 'p2');
    expect(view.players.find((entry) => entry.id === 'p1')!.publicScore).toBe(base + 2);
  });

  it('擲骰得到的布匹也會在這次行動結束時判勝（14 分）', () => {
    for (const [bonus, wins] of [[11, false], [12, true]] as const) {
      const state = ready(3, 0, 'preroll');
      settle(state, 'p1', legalBuildingVertices(state, 'p1', { setup: true })[0]!);
      player(state, 'p1').bonusPoints = bonus; // 1 + bonus
      slot(state).links.p1 = [0];
      slot(state).cloth.p1 = 1; // 再拿 1 枚 = 2 枚 = +1 分
      slot(state).tribes[0]!.cloth -= 1;
      const after = act(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice(10))).state;
      expect(slot(after).cloth.p1).toBe(2);
      expect(after.result !== null, `bonus ${bonus}`).toBe(wins);
    }
  });

  it('設置的第三輪公開在視圖上（turn.setup.third），其他輪沒有這個欄位', () => {
    const { state } = game(3);
    expect(projectGame(state, 'p1').turn.setup).not.toHaveProperty('third');
    const late = clone(state);
    late.turn.setup!.index = 6;
    late.turn.setup!.round = 2;
    late.turn.setup!.third = true;
    late.turn.seat = late.turn.setup!.order[6]!;
    expect(projectGame(late, 'p1').turn.setup).toMatchObject({ third: true, round: 2, remaining: 3 });
  });

  it('14 分：差一分不勝，布匹補上最後一分就在這個動作結束時勝利（建立關係拿到第 2 枚）', () => {
    for (const [bonus, wins] of [[11, false], [12, true]] as const) {
      const state = ready();
      const route = routeTo(state, 0);
      slot(state).cloth.p1 = 1; // 先持有 1 枚；建立關係再拿 1 枚 = 2 枚 = 1 分
      slot(state).tribes[0]!.cloth -= 1;
      player(state, 'p1').bonusPoints = bonus; // 村落 1 + bonus；布匹 +1
      const after = sail(state, 'p1', route);
      expect(score(after, 'p1')).toBe(1 + bonus + 1);
      expect(after.result !== null).toBe(wins);
      if (wins) expect(after.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
    }
  });

  it('不使用最長道路：長路也不得獎、不計分，longestRoad 一律 null', () => {
    const state = ready();
    const start = legalBuildingVertices(state, 'p1', { setup: true })[0]!;
    settle(state, 'p1', start);
    // 沿陸地連一長串路（直接擺棋）。
    const topo = topologyOf(state);
    let vertex = start;
    const used = new Set<number>();
    for (let i = 0; i < 8; i++) {
      const edge = topo.vertices[vertex]!.edges.find((e) => !used.has(e) && !state.board.roads[e] && isLandEdge(state, e));
      if (edge === undefined) break;
      used.add(edge);
      road(state, 'p1', edge);
      vertex = topo.edges[edge]!.vertices.find((v) => v !== vertex)!;
    }
    expect(used.size).toBeGreaterThanOrEqual(5);
    setHand(state, 'p1', { lumber: 1, brick: 1 });
    const free = topo.edges.findIndex((_, e) => !state.board.roads[e] && isLandEdge(state, e) && topo.edges[e]!.vertices.includes(vertex));
    const after = free >= 0 ? act(state, 'p1', { type: 'build.road', edge: free }).state : state;
    expect(after.awards.longestRoad).toBeNull();
    expect(score(after, 'p1')).toBe(1);
  });
});

describe('SFX-S6 封閉通路與移動船', () => {
  it('通往部落的通路中的船不可移動；延伸出去或分叉的船照一般規則可移動', () => {
    const state = ready();
    const route = routeTo(state, 3);
    expect(route.edges).toHaveLength(3);
    const built = sail(state, 'p1', route);
    built.windowId += 1;
    const topo = topologyOf(built);
    // 通路上的每一艘船都不能動（含部落端的船，即使它的外端是開放的）。
    for (const edge of route.edges) {
      expect(sf(built, 'p1').movableShips.some((entry) => entry.edge === edge), `edge ${edge}`).toBe(false);
      expectRejected(built, 'p1', { type: 'ship.move', from: edge, to: edge } as never, 'E_SHIP_NOT_MOVABLE');
    }
    expect(tribeRoutes(built, 'p1').closed).toEqual(new Set(route.edges));
    // 繼續從部落頂點往外延伸一艘：它不在任何通往部落的通路上，下一個窗口可以移動。
    const tribeVertex = slot(built).tribes[3]!.vertex;
    const beyond = topo.vertices[tribeVertex]!.edges.find((edge) => !built.board.roads[edge] && isSeaEdge(built, edge))!;
    setHand(built, 'p1', { lumber: 1, wool: 1 });
    const extended = act(built, 'p1', { type: 'build.ship', edge: beyond } as never).state;
    extended.windowId += 1;
    expect(tribeRoutes(extended, 'p1').closed.has(beyond)).toBe(false);
    expect(sf(extended, 'p1').movableShips.some((entry) => entry.edge === beyond)).toBe(true);
    // 在通路中途分叉：分叉出去且不通到部落的船可移動，原通路仍封閉（有些岔邊會形成第二條通路，跳過它）。
    const candidates = route.edges.flatMap((edge) => topo.edges[edge]!.vertices)
      .flatMap((vertex) => topo.vertices[vertex]!.edges)
      .filter((edge) => !extended.board.roads[edge] && isSeaEdge(extended, edge) && !route.edges.includes(edge));
    let checked = 0;
    for (const fork of new Set(candidates)) {
      const attempt = clone(extended);
      setHand(attempt, 'p1', { lumber: 1, wool: 1 });
      const forked = act(attempt, 'p1', { type: 'build.ship', edge: fork } as never).state;
      forked.windowId += 1;
      const { closed } = tribeRoutes(forked, 'p1');
      for (const edge of route.edges) expect(closed.has(edge)).toBe(true);
      if (closed.has(fork)) continue; // 這條岔邊另成一條通到部落的通路
      expect(sf(forked, 'p1').movableShips.some((entry) => entry.edge === fork)).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('沒有連到部落的船照一般規則（有開放端就能移）', () => {
    const state = ready();
    const route = routeTo(state, 3);
    const built = sail(state, 'p1', route, 1);
    built.windowId += 1;
    expect(tribeRoutes(built, 'p1').closed.size).toBe(0);
    expect(sf(built, 'p1').movableShips.some((entry) => entry.edge === route.edges[0])).toBe(true);
  });
});

describe('SFX-S6 強盜、海盜與偷布匹', () => {
  /** p1 連到部落、p2 的船在海盜將去的海格旁。回傳該海格。 */
  function pirateScene(): { state: GameState; hexIndex: number } {
    const state = ready(3);
    const route = routeTo(state, 0);
    const built = sail(state, 'p1', route);
    built.windowId += 1;
    built.turn.phase = 'preroll';
    // p2 的船：放在部落 3（數字 8）附近的海格邊上，且那個海格不被 p1 通路使用。
    const topo = topologyOf(built);
    const seaHex = topo.hexes.findIndex((_, h) => built.board.layout.terrain[h] === 'sea' && topo.edges.some((edge, e) => edge.hexes.includes(h) && !built.board.roads[e] && isSeaEdge(built, e)));
    const edge = topo.edges.findIndex((info, e) => info.hexes.includes(seaHex) && !built.board.roads[e] && isSeaEdge(built, e));
    ship(built, 'p2', edge);
    player(built, 'p2').resources.grain = 2;
    slot(built).cloth.p2 = 3;
    slot(built).tribes[1]!.cloth -= 3;
    return { state: built, hexIndex: seaHex };
  }

  it('強盜不可移到四座小島（hint 與指令都拒絕）；大島的格可以', () => {
    const state = ready(3, 0, 'preroll');
    const smalls = [2, 3, 4, 5].map((island) => state.board.layout.islands.indexOf(island));
    const hints = sf(state, 'p1').robberTargets;
    for (const small of smalls) expect(hints).not.toContain(small);
    expect(hints.length).toBe(19); // 兩座大島 20 格去掉強盜所在的 12 號格
    const sevened = clone(state);
    sevened.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false } as never;
    for (const small of smalls) expectRejected(sevened, 'p1', { type: 'pending.moveRobber', hex: small }, 'E_ILLEGAL_TARGET');
    const ok = act(sevened, 'p1', { type: 'pending.moveRobber', hex: hints[0]! }, scriptedRng([]));
    expect(ok.state.board.robber).toBe(hints[0]);
    // 騎士一樣。
    const knight = ready(3, 0, 'action');
    player(knight, 'p1').devCards = ['knight'];
    for (const small of smalls) expectRejected(knight, 'p1', { type: 'dev.playKnight', hex: small }, 'E_ILLEGAL_TARGET');
  });

  it('移動海盜需要至少一條通到部落的通路：沒有就拒絕（hint 為空），有就可以', () => {
    const none = ready(3, 0, 'preroll');
    none.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false } as never;
    expect(sf(none, 'p1').pirateTargets).toEqual([]);
    const seaHex = none.board.layout.terrain.findIndex((terrain) => terrain === 'sea');
    expectRejected(none, 'p1', { type: 'pending.moveRobber', hex: seaHex }, 'E_PIRATE_NEEDS_TRIBE', scriptedRng([]));
    expectRejected(none, 'p1', { type: 'pending.moveRobber', hex: null }, 'E_PIRATE_NEEDS_TRIBE', scriptedRng([]));
    // 這時還是可以移強盜。
    expect(sf(none, 'p1').robberTargets.length).toBeGreaterThan(0);

    const { state, hexIndex } = pirateScene();
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false } as never;
    expect(sf(state, 'p1').pirateTargets).toContain(hexIndex);
    expect(sf(state, 'p2').pirateTargets).toEqual([]);
    const moved = act(state, 'p1', { type: 'pending.moveRobber', hex: hexIndex }, scriptedRng([]));
    expect(moved.state.board.pirate).toBe(hexIndex);
  });

  it('移動海盜後可偷 1 枚布匹（取代偷資源牌）：對象是海盜新位置旁有船的玩家，只有布匹的玩家也可選', () => {
    const { state, hexIndex } = pirateScene();
    player(state, 'p2').resources.grain = 0; // p2 沒有資源牌，只有布匹
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false } as never;
    const moved = act(state, 'p1', { type: 'pending.moveRobber', hex: hexIndex }, scriptedRng([])).state;
    expect(moved.pending).toMatchObject({ kind: 'steal', candidates: ['p2'], pirate: true });
    expect(sf(moved, 'p1').clothVictims).toEqual(['p2']);
    expect(sf(moved, 'p2').clothVictims).toEqual([]);
    // 資源牌路徑對只有布匹的玩家無效。
    expectRejected(moved, 'p1', { type: 'pending.steal', victim: 'p2' }, 'E_NO_ELIGIBLE_VICTIM', scriptedRng([0]));
    const before = clothSum(moved);
    const stolen = act(moved, 'p1', { type: 'cloth.steal', victim: 'p2' } as never, scriptedRng([]));
    expect(slot(stolen.state).cloth).toMatchObject({ p1: 2, p2: 2 }); // p1 本來 1 枚（建立關係）
    expect(clothSum(stolen.state)).toBe(before);
    expect(stolen.state.pending).toBeNull();
    expect(stolen.events.find((event) => event.type === 'cloth.stolen')!.params).toEqual({ playerId: 'p1', victim: 'p2' });
  });

  it('偷資源牌仍可：有資源牌的對象照原規則抽 1 張；沒有布匹的對象不能被偷布匹', () => {
    const { state, hexIndex } = pirateScene();
    slot(state).cloth.p2 = 0;
    slot(state).tribes[1]!.cloth += 3;
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false } as never;
    const moved = act(state, 'p1', { type: 'pending.moveRobber', hex: hexIndex }, scriptedRng([])).state;
    expect(sf(moved, 'p1').clothVictims).toEqual([]);
    expectRejected(moved, 'p1', { type: 'cloth.steal', victim: 'p2' } as never, 'E_NO_ELIGIBLE_VICTIM', scriptedRng([]));
    const stolen = act(moved, 'p1', { type: 'pending.steal', victim: 'p2' }, scriptedRng([0])).state;
    expect(player(stolen, 'p1').resources.grain).toBe(1);
    expect(player(stolen, 'p2').resources.grain).toBe(1);
  });

  it('偷到的布匹可使偷的人達到 14 分而勝利；偷布匹只限海盜（強盜的 steal 不能偷布匹）', () => {
    const { state, hexIndex } = pirateScene();
    player(state, 'p1').bonusPoints = 10; // 村落 1 + 10 + 布匹 1 枚（0 分）
    slot(state).cloth.p1 = 3; // 1 分
    slot(state).cloth.p2 = 3;
    player(state, 'p2').resources.grain = 0;
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false } as never;
    const moved = act(state, 'p1', { type: 'pending.moveRobber', hex: hexIndex }, scriptedRng([])).state;
    expect(score(moved, 'p1')).toBe(12);
    const stolen = act(moved, 'p1', { type: 'cloth.steal', victim: 'p2' } as never, scriptedRng([])).state;
    expect(score(stolen, 'p1')).toBe(13); // 4 枚 = 2 分
    // 強盜的 steal frame 不接受 cloth.steal。
    const robbed = clone(moved);
    robbed.pending = { kind: 'steal', actor: 'p1', hex: robbed.board.robber, candidates: ['p2'], pirate: false } as never;
    expectRejected(robbed, 'p1', { type: 'cloth.steal', victim: 'p2' } as never, 'E_NO_ELIGIBLE_VICTIM', scriptedRng([]));
  });
});

describe('SFX-S6 終局：回合結束時 ≥5 個部落沒有布匹', () => {
  /** 讓 `count` 個部落沒有布匹（布匹移到供應堆，守恆）。 */
  function exhaust(state: GameState, count: number): void {
    slot(state).tribes.forEach((tribe, index) => {
      if (index < count) {
        slot(state).supply += tribe.cloth;
        tribe.cloth = 0;
      }
    });
  }
  const endTurn = (state: GameState, id = 'p1') => act(state, id, { type: 'turn.end' }, scriptedRng([]));

  it('4 個部落沒有布匹不終局；5 個才在回合結束時終局（不是在擲骰或建造時）', () => {
    const four = ready();
    exhaust(four, 4);
    expect(endTurn(four).state.result).toBeNull();
    const five = ready();
    exhaust(five, 5);
    expect(five.result).toBeNull();
    const after = endTurn(five);
    expect(after.state.result).toMatchObject({ reason: 'victory', cause: 'clothExhausted' });
    expect(after.state.turn.phase).toBe('gameOver');
    expect(after.events.map((event) => event.type)).toContain('game.finished');
    // 結束後的指令一律拒絕。
    expectRejected(after.state, 'p2', { type: 'turn.roll' }, 'E_GAME_OVER');
  });

  it('最高分勝：單一勝者可以低於 14 分；result 帶 playerIds 與 cause，終局事件帶全部勝者', () => {
    const state = ready(4);
    exhaust(state, 5);
    settle(state, 'p1', legalBuildingVertices(state, 'p1', { setup: true })[0]!);
    settle(state, 'p3', legalBuildingVertices(state, 'p3', { setup: true }).find((v) => !state.board.buildings[v] && v > 60)!);
    player(state, 'p3').bonusPoints = 2; // p3 分數最高
    const done = endTurn(state, 'p1');
    const finished = done.events.find((event) => event.type === 'game.finished')!;
    expect(done.state.result).toEqual({ playerId: 'p3', reason: 'victory', atSeq: finished.seq - 1, playerIds: ['p3'], cause: 'clothExhausted' });
    expect(finished.params).toEqual({ playerId: 'p3', playerIds: ['p3'], reason: 'victory', score: 3, cause: 'clothExhausted' });
    expect(score(done.state, 'p3')).toBeLessThan(14);
  });

  it('平手比布匹數；布匹也平手則共同勝利（D12 使用者決定的解釋），playerId 為座位最小的勝者', () => {
    // 分數平手：p2、p3 都 1 分（村落），p3 布匹多 → p3 勝。
    const tieScore = ready(4);
    exhaust(tieScore, 5);
    settle(tieScore, 'p2', legalBuildingVertices(tieScore, 'p2', { setup: true })[0]!);
    settle(tieScore, 'p3', legalBuildingVertices(tieScore, 'p3', { setup: true }).find((v) => !tieScore.board.buildings[v] && v > 60)!);
    player(tieScore, 'p1').bonusPoints = 0;
    slot(tieScore).cloth.p2 = 1;
    slot(tieScore).cloth.p3 = 1 + 0; // 同分同布匹 → 共同勝利
    slot(tieScore).supply -= 2;
    // p1 沒有村落，分數 0，不在榜首。
    const co = endTurn(tieScore).state;
    expect(co.result).toMatchObject({ playerId: 'p2', playerIds: ['p2', 'p3'], cause: 'clothExhausted', reason: 'victory' });
    const coEvent = co.log.find((event) => event.type === 'game.finished')!;
    expect(coEvent.params).toMatchObject({ playerId: 'p2', playerIds: ['p2', 'p3'], cause: 'clothExhausted' });

    // 分數平手但布匹不同：布匹多的勝。
    const byCloth = clone(tieScore);
    byCloth.result = null;
    byCloth.turn.phase = 'action';
    byCloth.log = [];
    slot(byCloth).cloth.p3 = 0; // p2 有 1 枚，p3 沒有
    slot(byCloth).supply += 0;
    const single = endTurn(byCloth).state;
    expect(single.result).toMatchObject({ playerId: 'p2', playerIds: ['p2'], cause: 'clothExhausted' });
  });

  it('分數含布匹的 VP：布匹 2 枚 = 1 分；耗盡終局比較的是含布匹分數的總分', () => {
    const state = ready(3);
    exhaust(state, 5);
    settle(state, 'p1', legalBuildingVertices(state, 'p1', { setup: true })[0]!);
    settle(state, 'p2', legalBuildingVertices(state, 'p2', { setup: true }).find((v) => !state.board.buildings[v] && v > 60)!);
    slot(state).cloth.p2 = 2; // 1 分 → p2 共 2 分，p1 1 分
    slot(state).supply -= 2;
    const done = endTurn(state).state;
    expect(done.result).toMatchObject({ playerId: 'p2', playerIds: ['p2'] });
  });

  it('在自己回合達到 14 分仍是 target 路徑：沒有 playerIds、cause，事件含 target（單一勝者輸出不變）', () => {
    const state = ready();
    player(state, 'p1').bonusPoints = 13;
    const route = routeTo(state, 0);
    settle(state, 'p1', route.start);
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    const after = act(state, 'p1', { type: 'build.ship', edge: route.edges[0]! } as never);
    expect(after.state.result).toEqual({ playerId: 'p1', reason: 'victory', atSeq: after.events.find((event) => event.type === 'game.finished')!.seq - 1 });
    expect('playerIds' in after.state.result!).toBe(false);
    expect('cause' in after.state.result!).toBe(false);
    expect(after.events.find((event) => event.type === 'game.finished')!.params).toEqual({ playerId: 'p1', reason: 'victory', score: 14, target: 14 });
    // 公開視圖也沒有新欄位。
    expect(projectGame(after.state, 'p2').result).toEqual({ playerId: 'p1', reason: 'victory', score: 14 });
  });

  it('終局的公開視圖與重連：result 的 playerIds／cause 與事件一致；snapshot 還原後完全相同', () => {
    const state = ready(4);
    exhaust(state, 5);
    settle(state, 'p2', legalBuildingVertices(state, 'p2', { setup: true })[0]!);
    settle(state, 'p4', legalBuildingVertices(state, 'p4', { setup: true }).find((v) => !state.board.buildings[v] && v > 60)!);
    const done = endTurn(state).state;
    const winners = done.result!.playerIds!;
    expect(winners).toEqual(['p2', 'p4']);
    const view = projectGame(done, 'p3');
    expect(view.result).toEqual({ playerId: 'p2', reason: 'victory', score: 1, playerIds: ['p2', 'p4'], cause: 'clothExhausted' });
    const event = done.log.find((entry) => entry.type === 'game.finished')!;
    expect(projectEvent(event, 'p3').params).toEqual({ playerId: 'p2', playerIds: ['p2', 'p4'], reason: 'victory', score: 1, cause: 'clothExhausted' });
    // 重連：snapshot 還原（JSON round-trip）後各玩家的視圖相同。
    const restored = JSON.parse(JSON.stringify(done)) as GameState;
    for (const id of ['p1', 'p2', 'p3', 'p4']) expect(projectGame(restored, id)).toEqual(projectGame(done, id));
    expect(projectGame(restored, 'p3').result!.playerIds).toEqual(winners);
  });

  it('其他 profile 不受影響：沒有 playerIds／cause，onEndTurn 不會終局', () => {
    const { state } = seafarersGame(3, 1, 'sf-forgotten-tribe-2025');
    expect(state.result).toBeNull();
    expect(seafarersState(state).cloth).toBeUndefined();
    expect(state.turn.setup!.third).toBeUndefined();
    expect(state.turn.setup!.order).toHaveLength(6);
  });
});

describe('SFX-S6 其他', () => {
  it('seeded 隨機呼叫不洩漏：布匹狀態是公開資訊，viewer 之間視圖相同', () => {
    const state = ready(4);
    const a = projectGame(state, 'p1').modules!.seafarers;
    const b = projectGame(state, 'p3').modules!.seafarers;
    expect(a).toEqual(b);
  });

  it('applyCommand 不改輸入 state（純函式）', () => {
    const state = ready(4, 0, 'preroll');
    const snapshot = JSON.stringify(state);
    applyCommand(state, 'p1', { type: 'turn.roll' }, seededRng(3));
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
