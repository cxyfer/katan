/**
 * R-SFX-S9：New World（新世界）。配件表對照 SF25 p. 20；規則 fixture 為隨機版圖產生器
 * （1,000 個種子：配件數量、紅色圓片分開、必定終止、確定性）、設置階段的輪流放港口（隨機抽、
 * 間隔一條邊、無合法邊的處理）、重新產生版圖、home islands 與島嶼獎勵、12 分勝利與隱私。
 */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, legalBuildingVertices, legalRoadEdges, regenerateBoard, type Command } from '../src/engine.ts';
import { islandsAt } from '../src/modules/seafarers/islands.ts';
import { seafarersState } from '../src/modules/seafarers/state.ts';
import { getProfile, resolveCombination } from '../src/profiles.ts';
import { projectEvent, projectGame } from '../src/project.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import { buildProfileLayout } from '../src/layout-registry.ts';
import {
  NEW_WORLD_TOPOLOGY_ID, NW_DISC_COUNTS, NW_HEX_COUNTS, NW_PORT_TOKENS, NW_VP_TOKENS, generateNewWorldBoard,
  hexNeighbors, islandsOf, separateRedDiscs,
} from '../src/seafarers-new-world-boards.ts';
import { getTopology } from '../src/topology-registry.ts';
import type { GameState, HarborType } from '../src/types.ts';
import { act, setHand } from './helpers.ts';
import { seafarersGame, settle } from './seafarers-helpers.ts';

const PROFILE = 'sf-new-world-2025';

function tally<T extends string | number | null>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[String(value)] = (out[String(value)] ?? 0) + 1;
  return out;
}

const world = (players: 3 | 4 = 4, seed = 12345) => seafarersGame(players, seed, PROFILE);
const topology = getTopology(NEW_WORLD_TOPOLOGY_ID);
const neighbors = hexNeighbors(topology);
const isRed = (disc: number | null) => disc === 6 || disc === 8;
const slotWorld = (state: GameState) => seafarersState(state).world!;
const sf = (state: GameState, id: string) => actionHints(state, id).modules!.seafarers as {
  harborChoices: { harbors: HarborType[]; edges: number[] };
  targets: Record<string, number[]>;
  board: { commandType: string; targets: number[] } | null;
};
const cmd = (type: string, fields: Record<string, unknown> = {}) => ({ type, ...fields }) as unknown as Command;
const seatId = (state: GameState) => state.players[state.turn.seat]!.id;
const placeHarbor = (state: GameState, edge: number, rng: Rng = seededRng(1)) => act(state, seatId(state), cmd('world.harbor', { edge }), rng).state;
const reject = (state: GameState, id: string, command: Command): string => {
  const outcome = applyCommand(state, id, command, seededRng(1));
  if (outcome.ok) throw new Error('expected rejection');
  return outcome.error.code;
};

/** 每次都選第一個合法邊，放完整個港口階段。 */
function placeAllHarbors(state: GameState, pick = 0): GameState {
  let current = state;
  while (current.turn.setup?.stage === 'harbor') {
    const edges = sf(current, seatId(current)).harborChoices.edges;
    current = placeHarbor(current, edges[pick % edges.length]!);
  }
  return current;
}

describe('New World 版圖產生器（SF25 p. 20）', () => {
  it('配件表：42 格 = 海洋 19、田野 5、小丘 4、高山 4、草地 5、森林 5；圓片 23；海港 10；VP 標記 16', () => {
    expect(Object.values(NW_HEX_COUNTS).reduce((sum, n) => sum + n!, 0)).toBe(42);
    expect(Object.values(NW_DISC_COUNTS).reduce((sum, n) => sum + n, 0)).toBe(23);
    expect(NW_PORT_TOKENS.filter((type) => type === 'generic')).toHaveLength(5);
    expect(NW_PORT_TOKENS.filter((type) => type !== 'generic').sort()).toEqual(['brick', 'grain', 'lumber', 'ore', 'wool']);
    expect(NW_VP_TOKENS).toBe(16);
    expect(topology.hexes).toHaveLength(42);
    expect(topology.harborSlots).toEqual([]);
    const rows = tally(topology.hexes.map((cell) => cell.r));
    expect([-3, -2, -1, 0, 1, 2, 3].map((r) => rows[r])).toEqual([5, 6, 7, 6, 7, 6, 5]);
  });

  it('1,000 個種子：配件數量正確、圓片只在陸地、紅色圓片全部分開、島編號是連通分量', () => {
    let swapped = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const board = generateNewWorldBoard(topology, seededRng(seed));
      expect(tally(board.terrain), `seed ${seed}`).toEqual({ sea: 19, fields: 5, hills: 4, mountains: 4, pasture: 5, forest: 5 });
      const discs = board.numbers.filter((disc): disc is number => disc !== null);
      expect(tally(discs), `seed ${seed}`).toEqual({ 2: 1, 3: 3, 4: 3, 5: 3, 6: 2, 8: 2, 9: 3, 10: 3, 11: 2, 12: 1 });
      board.numbers.forEach((disc, hex) => {
        expect(disc !== null, `seed ${seed} hex ${hex}`).toBe(board.terrain[hex] !== 'sea');
        if (isRed(disc)) for (const other of neighbors[hex]!) expect(isRed(board.numbers[other]!), `seed ${seed} red ${hex}-${other}`).toBe(false);
      });
      expect(board.islands).toEqual(islandsOf(board.terrain, neighbors));
      board.terrain.forEach((tile, hex) => {
        expect(board.islands[hex]! > 0).toBe(tile !== 'sea');
        for (const other of neighbors[hex]!) if (tile !== 'sea' && board.terrain[other] !== 'sea') expect(board.islands[other]).toBe(board.islands[hex]);
      });
      if (board.swaps > 0) swapped += 1;
    }
    // 隨機放置之後常有紅色相鄰，對調路徑真的被走過。
    expect(swapped).toBeGreaterThan(50);
  }, 60_000);

  it('同種子同圖，不同種子不同圖（確定性）', () => {
    for (const seed of [1, 7, 99, 12345]) {
      expect(generateNewWorldBoard(topology, seededRng(seed))).toEqual(generateNewWorldBoard(topology, seededRng(seed)));
    }
    const a = generateNewWorldBoard(topology, seededRng(1));
    const b = generateNewWorldBoard(topology, seededRng(2));
    expect(a.terrain).not.toEqual(b.terrain);
    const layout = (seed: number) => buildProfileLayout(getProfile(PROFILE)!, { mode: 'variable', playerCount: 4, rng: seededRng(seed) });
    expect(layout(5)).toEqual(layout(5));
  });

  it('紅色圓片對調必定終止：把四枚紅色圓片全擠在相鄰的格子也能分開', () => {
    let clustered = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const rng = seededRng(seed);
      const board = generateNewWorldBoard(topology, rng);
      const land = board.terrain.flatMap((tile, hex) => (tile === 'sea' ? [] : [hex]));
      // 在陸地上找一個 4 格相連的團（沒有就退而求其次取最相鄰的），放上全部紅色圓片。
      const start = land[rng.int(land.length)]!;
      const cluster = [start];
      for (const hex of cluster) for (const other of neighbors[hex]!) if (land.includes(other) && !cluster.includes(other) && cluster.length < 4) cluster.push(other);
      const reds = board.numbers.filter(isRed);
      const blacks = board.numbers.filter((disc) => disc !== null && !isRed(disc));
      const numbers: (number | null)[] = board.terrain.map(() => null);
      const spots = [...cluster, ...land.filter((hex) => !cluster.includes(hex))];
      spots.forEach((hex, index) => { numbers[hex] = index < reds.length ? reds[index]! : blacks[index - reds.length]!; });
      const before = tally(numbers.filter((disc) => disc !== null));
      const swaps = separateRedDiscs(numbers, neighbors, rng);
      if (cluster.length >= 2) {
        clustered += 1;
        expect(swaps).toBeGreaterThan(0);
      }
      expect(tally(numbers.filter((disc) => disc !== null))).toEqual(before);
      numbers.forEach((disc, hex) => {
        if (isRed(disc)) for (const other of neighbors[hex]!) expect(isRed(numbers[other]!)).toBe(false);
      });
    }
    expect(clustered).toBeGreaterThan(250);
  });

  it('layout：沒有港口、沒有沙漠與金礦、強盜在框旁（-1）、海盜在框上（null）；3、4 人同一個 topology', () => {
    for (const players of [3, 4] as const) {
      const { state } = world(players);
      const layout = state.board.layout;
      expect(layout.topologyId).toBe(NEW_WORLD_TOPOLOGY_ID);
      expect(layout.harbors).toEqual([]);
      expect(layout.terrain.some((tile) => tile === 'desert' || tile === 'gold')).toBe(false);
      expect(state.board.robber).toBe(-1);
      expect(state.board.pirate).toBeNull();
    }
  });
});

describe('SFX-S9 profile', () => {
  it('12 分、規則版本 sf-2025.3、島嶼獎勵每座非 home 島 1 分、只接受 3、4 人', () => {
    const profile = getProfile(PROFILE)!;
    expect(profile).toMatchObject({ victoryTarget: 12, ruleVersion: 'sf-2025.3', implemented: true, enabled: true, islandBonus: { points: 1, skip: 'home' }, setupModes: ['variable'], topologyId: NEW_WORLD_TOPOLOGY_ID });
    const base = { expansions: ['seafarers'], scenario: 'new-world', variants: [], setupMode: 'variable' as const };
    for (const playerCount of [3, 4]) expect(resolveCombination({ ...base, playerCount })).toMatchObject({ ok: true });
    for (const playerCount of [2, 5, 6]) expect(resolveCombination({ ...base, playerCount })).toEqual({ ok: false, reason: 'bad-player-count' });
  });
});

describe('SFX-S9 設置階段：輪流放港口', () => {
  it('開局在 harbor 階段，起始玩家先放；抽到的港口只對輪到的玩家出現在提示裡', () => {
    const { state } = world(4);
    expect(state.turn.phase).toBe('setup');
    expect(state.turn.setup).toMatchObject({ stage: 'harbor', index: 0 });
    expect(seatId(state)).toBe('p1');
    const drawn = slotWorld(state).drawn!;
    expect(NW_PORT_TOKENS).toContain(drawn);
    const hints = sf(state, 'p1');
    expect(hints.harborChoices.harbors).toEqual([drawn]);
    expect(hints.harborChoices.edges.length).toBeGreaterThan(10);
    expect(hints.board).toMatchObject({ commandType: 'world.harbor' });
    expect(sf(state, 'p2').harborChoices).toEqual({ harbors: [], edges: [] });
    expect(sf(state, 'p2').board).toBeNull();
    // 此時還不能放起始村落。
    expect(actionHints(state, 'p1').legalSettlements).toEqual([]);
    expect(reject(state, 'p1', cmd('setup.placeBuilding', { vertex: 0 }))).toBe('E_WRONG_PHASE');
  });

  it('玩家順時針輪流（p1 p2 p3 p4 p1 …）放 10 個港口，每個都是當下抽到的那個，放完才進入起始村落', () => {
    for (const players of [3, 4] as const) {
      let state = world(players, 77).state;
      const placedBy: string[] = [];
      const placedTypes: HarborType[] = [];
      for (let step = 0; step < 10; step++) {
        expect(state.turn.setup!.stage).toBe('harbor');
        const id = seatId(state);
        expect(id).toBe(`p${(step % players) + 1}`);
        const drawn = slotWorld(state).drawn!;
        const edges = sf(state, id).harborChoices.edges;
        state = placeHarbor(state, edges[(step * 3) % edges.length]!);
        placedBy.push(id);
        placedTypes.push(drawn);
        expect(state.board.layout.harbors).toHaveLength(step + 1);
        expect(state.board.layout.harbors.at(-1)).toMatchObject({ type: drawn });
      }
      expect(placedTypes.slice().sort()).toEqual(NW_PORT_TOKENS.slice().sort());
      expect(state.turn.setup).toMatchObject({ stage: 'building', index: 0 });
      expect(state.turn.seat).toBe(0);
      expect(slotWorld(state)).toMatchObject({ drawn: null, placed: 10, pool: [] });
      expect(actionHints(state, 'p1').legalSettlements.length).toBeGreaterThan(0);
    }
  });

  it('港口放在陸與海或陸與框之間的邊，彼此至少隔一條邊（不共用交叉點）', () => {
    const topo = (s: GameState) => topologyOf(s);
    for (const seed of [3, 4, 5, 6]) {
      const done = placeAllHarbors(world(4, seed).state, seed);
      const harbors = done.board.layout.harbors;
      expect(harbors).toHaveLength(10);
      for (const harbor of harbors) {
        const info = topo(done).edges[harbor.edge]!;
        const hexes = info.hexes.map((hex) => done.board.layout.terrain[hex]!);
        expect(hexes.some((tile) => tile !== 'sea')).toBe(true);
        expect(info.hexes.length === 1 || hexes.some((tile) => tile === 'sea')).toBe(true);
      }
      const vertices = harbors.flatMap((harbor) => topo(done).edges[harbor.edge]!.vertices);
      expect(new Set(vertices).size).toBe(vertices.length);
    }
  });

  it('非輪到的玩家、非法的邊、重複的邊、緊鄰港口的邊、非整數都被拒絕', () => {
    const { state } = world(4);
    const edges = sf(state, 'p1').harborChoices.edges;
    expect(reject(state, 'p2', cmd('world.harbor', { edge: edges[0] }))).toBe('E_NOT_YOUR_TURN');
    // 一條內部（陸陸）邊與一條純海邊。
    const topo = topologyOf(state);
    const landLand = topo.edges.findIndex((info) => info.hexes.length === 2 && info.hexes.every((hex) => state.board.layout.terrain[hex] !== 'sea'));
    const seaSea = topo.edges.findIndex((info) => info.hexes.length === 2 && info.hexes.every((hex) => state.board.layout.terrain[hex] === 'sea'));
    for (const edge of [landLand, seaSea].filter((value) => value >= 0)) expect(reject(state, 'p1', cmd('world.harbor', { edge }))).toBe('E_ILLEGAL_TARGET');
    expect(reject(state, 'p1', cmd('world.harbor', { edge: 1.5 }))).toBe('E_INVALID_COMMAND');
    expect(reject(state, 'p1', cmd('world.harbor', {}))).toBe('E_INVALID_COMMAND');
    const first = edges[0]!;
    const next = placeHarbor(state, first);
    // 同一條邊與共用交叉點的鄰邊都不合法。
    expect(sf(next, 'p2').harborChoices.edges).not.toContain(first);
    const touching = topo.edges.flatMap((info, edge) => (edge !== first && info.vertices.some((vertex) => topo.edges[first]!.vertices.includes(vertex)) ? [edge] : []));
    for (const edge of touching) {
      expect(sf(next, 'p2').harborChoices.edges).not.toContain(edge);
      expect(reject(next, 'p2', cmd('world.harbor', { edge }))).toBe('E_ILLEGAL_TARGET');
    }
    // 隔一條邊的邊仍然合法。
    const gap = sf(next, 'p2').harborChoices.edges.filter((edge) => topo.edges[edge]!.vertices.some((vertex) => touching.some((other) => topo.edges[other]!.vertices.includes(vertex))));
    expect(gap.length).toBeGreaterThan(0);
  });

  it('設置之後的 world.harbor 被拒絕；其他劇本不認得這個指令', () => {
    const done = placeAllHarbors(world(4).state);
    expect(reject(done, 'p1', cmd('world.harbor', { edge: 0 }))).toBe('E_WRONG_PHASE');
    const other = seafarersGame(4, 1).state;
    expect(reject(other, 'p1', cmd('world.harbor', { edge: 0 }))).toBe('E_INVALID_COMMAND');
    const tb = seafarersGame(4, 1, 'sf-forgotten-tribe-2025').state;
    expect(reject(tb, 'p1', cmd('world.harbor', { edge: 0 }))).toBe('E_INVALID_COMMAND');
  });

  it('沒有合法邊時剩下的港口放回盒子，港口階段提前結束並進入起始村落', () => {
    const { state } = world(3, 5);
    // 只留一格陸地：海岸 6 條邊，放 3 個之後就沒有合法邊（每個港口封鎖相鄰兩邊）。
    const lone = state.board.layout.terrain.findIndex((tile) => tile !== 'sea');
    state.board.layout.terrain = state.board.layout.terrain.map((_, hex) => (hex === lone ? 'forest' : 'sea'));
    state.board.layout.numbers = state.board.layout.numbers.map((_, hex) => (hex === lone ? 8 : null));
    state.board.layout.islands = state.board.layout.islands.map((_, hex) => (hex === lone ? 1 : 0));
    let current = state;
    let placed = 0;
    while (current.turn.setup?.stage === 'harbor') {
      const edges = sf(current, seatId(current)).harborChoices.edges;
      expect(edges.length).toBeGreaterThan(0);
      current = placeHarbor(current, edges[0]!);
      placed += 1;
    }
    expect(placed).toBeLessThan(10);
    expect(current.board.layout.harbors).toHaveLength(placed);
    expect(current.turn.setup).toMatchObject({ stage: 'building' });
    expect(current.turn.seat).toBe(0);
    expect(current.log.filter((event) => event.type === 'world.harborsSkipped')).toEqual([
      expect.objectContaining({ params: { remaining: 10 - placed } }),
    ]);
    expect(slotWorld(current).pool).toEqual([]);
  });
});

describe('SFX-S9 重新產生版圖（服務在全體真人同意後呼叫）', () => {
  it('第一個港口放下前可以重新產生：地形、圓片、島編號重抽，配件數量仍正確，港口重新抽', () => {
    const { state } = world(4, 9);
    const before = JSON.stringify(state.board.layout);
    const outcome = regenerateBoard(state, seededRng(4242));
    if (!outcome.ok) throw new Error(outcome.error.code);
    const next = outcome.state;
    expect(JSON.stringify(next.board.layout)).not.toBe(before);
    expect(tally(next.board.layout.terrain)).toEqual({ sea: 19, fields: 5, hills: 4, mountains: 4, pasture: 5, forest: 5 });
    expect(tally(next.board.layout.numbers.filter((disc) => disc !== null))).toEqual({ 2: 1, 3: 3, 4: 3, 5: 3, 6: 2, 8: 2, 9: 3, 10: 3, 11: 2, 12: 1 });
    expect(next.board.layout.islands).toEqual(islandsOf(next.board.layout.terrain, neighbors));
    expect(next.board.layout.harbors).toEqual([]);
    expect(next.turn.setup).toMatchObject({ stage: 'harbor' });
    expect(seatId(next)).toBe('p1');
    expect(slotWorld(next)).toMatchObject({ placed: 0, rerolls: 1 });
    expect(slotWorld(next).pool).toHaveLength(9);
    expect(outcome.events.map((event) => event.type)).toEqual(['world.regenerated', 'world.harborDrawn']);
    // 原狀態不變（純函式）。
    expect(JSON.stringify(state.board.layout)).toBe(before);
    // 可以再重抽，不限次數。
    const again = regenerateBoard(next, seededRng(99));
    expect(again.ok && slotWorld(again.state).rerolls).toBe(2);
    expect(projectGame(next, 'p1').modules!.seafarers).toMatchObject({ world: { placed: 0, rerolls: 1, canRegenerate: true } });
  });

  it('第一個港口放下後、設置之後、其他劇本都不能重新產生', () => {
    const { state } = world(4, 9);
    const placed = placeHarbor(state, sf(state, 'p1').harborChoices.edges[0]!);
    const late = regenerateBoard(placed, seededRng(1));
    expect(late).toMatchObject({ ok: false, error: { code: 'E_WRONG_PHASE' } });
    expect(projectGame(placed, 'p1').modules!.seafarers).toMatchObject({ world: { canRegenerate: false } });
    const done = placeAllHarbors(state);
    expect(regenerateBoard(done, seededRng(1))).toMatchObject({ ok: false });
    expect(regenerateBoard(seafarersGame(4, 1).state, seededRng(1))).toMatchObject({ ok: false, error: { code: 'E_INVALID_COMMAND' } });
    // 它不是玩家指令。
    expect(reject(state, 'p1', cmd('world.regenerate'))).toBe('E_INVALID_COMMAND');
  });
});

/** 為每個設置步驟挑「只碰到指定島」的第一個合法交叉點。 */
function setupOnIslands(state: GameState, islands: readonly number[]): GameState {
  let current = placeAllHarbors(state);
  let step = 0;
  while (current.turn.phase === 'setup') {
    const setup = current.turn.setup!;
    const actor = current.players[setup.order[setup.index]!]!.id;
    if (setup.stage === 'building') {
      const wanted = islands[step]!;
      const vertex = legalBuildingVertices(current, actor, { setup: true })
        .find((candidate) => islandsAt(current, candidate).length === 1 && islandsAt(current, candidate)[0] === wanted);
      if (vertex === undefined) throw new Error(`no legal vertex on island ${wanted}`);
      current = act(current, actor, { type: 'setup.placeBuilding', vertex }).state;
    } else {
      const edge = legalRoadEdges(current, actor, { setup: true, lastVertex: setup.lastVertex })[0]!;
      current = act(current, actor, { type: 'setup.placeRoad', edge }).state;
      step += 1;
    }
  }
  return current;
}

/** 找一個至少有三座各有 6 個以上交叉點的島的種子（隨機版圖不保證）。 */
function threeIslandGame(players: 3 | 4): { state: GameState; islands: number[] } {
  for (let seed = 1; seed < 500; seed++) {
    const { state } = world(players, seed);
    const sizes = tally(state.board.layout.islands.filter((island) => island > 0));
    const big = Object.entries(sizes).filter(([, size]) => size! >= 3).map(([island]) => Number(island));
    if (big.length >= 3) return { state, islands: big };
  }
  throw new Error('no seed with three islands');
}

describe('SFX-S9 起始村落、home islands 與島嶼獎勵', () => {
  it('設置時任何島都合法；結束時記 home（一座或兩座），設置不計分', () => {
    const { state, islands } = threeIslandGame(3);
    const [a, b, c] = islands as [number, number, number];
    // 順序 p1 p2 p3 p3 p2 p1：p1 在 a 與 b、p2 在 b 與 b、p3 在 c 與 c。
    const done = setupOnIslands(state, [a, b, c, c, b, b]);
    expect(done.turn.phase).not.toBe('setup');
    const home = (projectGame(done, 'p1').modules!.seafarers as { home?: Record<string, number[]> }).home!;
    expect(home).toEqual({ p1: [a, b].sort((x, y) => x - y), p2: [b], p3: [c] });
    for (const player of done.players) {
      expect(player.bonusPoints).toBe(0);
      expect(scoreOf(done, player.id, { includeHidden: true })).toBe(2);
    }
    expect(done.log.some((event) => event.type === 'island.bonus')).toBe(false);
  });

  it('home 不得分；非 home 島每位玩家各 1 分、別人已在也一樣，同島第二個村落不重複', () => {
    const { state, islands } = threeIslandGame(3);
    const [a, b, c] = islands as [number, number, number];
    const done = setupOnIslands(state, [a, b, c, c, b, a]);
    done.turn.seat = 0;
    done.turn.phase = 'action';
    done.windowId += 1;
    const bonus = (id: string) => done.players.find((p) => p.id === id)!.bonusPoints;
    const free = (island: number, n = 0): number =>
      done.board.buildings.flatMap((_b, vertex) => (!done.board.buildings[vertex] && islandsAt(done, vertex).length === 1 && islandsAt(done, vertex)[0] === island ? [vertex] : []))[n]!;
    const tick = (): void => {
      const edge = actionHints(done, 'p1').legalRoads[0]!;
      setHand(done, 'p1', { lumber: 1, brick: 1 });
      Object.assign(done, act(done, 'p1', { type: 'build.road', edge }).state);
    };
    // p1 的 home 是 a；在 a 再蓋不得分。
    settle(done, 'p1', free(a, 3));
    tick();
    expect(bonus('p1')).toBe(0);
    // p1 在 b（p2 的 home）得 1 分，不是 2 分。
    settle(done, 'p1', free(b, 0));
    tick();
    expect(bonus('p1')).toBe(1);
    // p2 在 b 是 home：不得分；在 a 得分（p1 已在 a 也一樣）。
    settle(done, 'p2', free(b, 4));
    settle(done, 'p2', free(a, 5));
    tick();
    expect(bonus('p2')).toBe(1);
    // p3 的 home 是 c、a；b 有 p1、p2 也仍得分。
    settle(done, 'p3', free(b, 6));
    tick();
    expect(bonus('p3')).toBe(1);
    // 同一座非 home 島的第二個村落不重複。
    settle(done, 'p1', free(b, 8));
    tick();
    expect(bonus('p1')).toBe(1);
    const claims = (projectGame(done, 'p1').modules!.seafarers as { islandClaims: { player: string; island: number }[] }).islandClaims;
    expect(claims.map(({ player, island }) => `${player}:${island}`).sort()).toEqual([`p1:${b}`, `p2:${a}`, `p3:${b}`].sort());
  });

  it('12 分在自己的回合勝利；11 分不勝', () => {
    // p1 的 home 是 a；其餘玩家把六個起始村落擠在最大的島 L 上。
    let found: { done: GameState; a: number; b: number } | null = null;
    for (let seed = 1; seed < 400 && !found; seed++) {
      const { state } = world(4, seed);
      const sizes = Object.entries(tally(state.board.layout.islands.filter((island) => island > 0))).map(([island, size]) => ({ island: Number(island), size: size! })).sort((x, y) => y.size - x.size);
      if (sizes.length < 3) continue;
      const [big, a, b] = sizes as [typeof sizes[0], typeof sizes[0], typeof sizes[0]];
      try {
        found = { done: setupOnIslands(state, [a.island, big.island, big.island, big.island, big.island, big.island, big.island, a.island]), a: a.island, b: b.island };
      } catch { /* 這張圖的大島放不下六個村落，換下一張 */ }
    }
    const { done, b } = found!;
    done.turn.seat = 0;
    done.turn.phase = 'action';
    done.windowId += 1;
    expect(getProfile(done.profileId)!.victoryTarget).toBe(12);
    const spot = done.board.buildings.flatMap((_b, vertex) => (!done.board.buildings[vertex] && islandsAt(done, vertex).length === 1 && islandsAt(done, vertex)[0] === b ? [vertex] : []));
    const play = (bonusPoints: number) => {
      const next: GameState = JSON.parse(JSON.stringify(done));
      next.players[0]!.bonusPoints = bonusPoints;
      settle(next, 'p1', spot[0]!);
      setHand(next, 'p1', { lumber: 1, brick: 1 });
      const edge = actionHints(next, 'p1').legalRoads[0]!;
      const outcome = applyCommand(next, 'p1', { type: 'build.road', edge }, seededRng(1));
      if (!outcome.ok) throw new Error(outcome.error.code);
      return outcome.state;
    };
    // 2 個起始村落 + 島 b 的村落 1 + 島嶼獎勵 1 = 4，再加 bonusPoints。
    const win = play(8);
    expect(scoreOf(win, 'p1', { includeHidden: true })).toBe(12);
    expect(win.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
    const short = play(7);
    expect(scoreOf(short, 'p1', { includeHidden: true })).toBe(11);
    expect(short.result).toBeNull();
  });

  it('強盜在框旁起手：7 之後可以移到任何陸地格，海盜移到海格', () => {
    const done = placeAllHarbors(world(4, 31).state);
    expect(done.board.robber).toBe(-1);
    const hints = actionHints(placeAllHarbors(world(4, 31).state), 'p1').modules!.seafarers as { robberTargets: number[]; pirateTargets: (number | null)[] };
    expect(hints.robberTargets.length).toBe(23);
    expect(hints.robberTargets.every((hex) => done.board.layout.terrain[hex] !== 'sea')).toBe(true);
    expect(hints.pirateTargets.filter((hex) => hex !== null).length).toBe(19);
  });
});

describe('SFX-S9 隱私', () => {
  it('投影只含目前抽到的港口與數量，不含尚未抽的港口；事件只公開已抽出的', () => {
    const { state } = world(4, 21);
    const drawn = slotWorld(state).drawn!;
    for (const viewer of ['p1', 'p2', 'p3', 'p4']) {
      const view = projectGame(state, viewer).modules!.seafarers as { world: Record<string, unknown> };
      expect(view.world).toEqual({ drawn, placed: 0, total: 10, rerolls: 0, canRegenerate: true });
      expect(JSON.stringify(projectGame(state, viewer))).not.toContain('"pool"');
    }
    // 事件裡只有抽到的那一個。
    const draws = state.log.filter((event) => event.type === 'world.harborDrawn');
    expect(draws).toHaveLength(1);
    expect(draws[0]!.params).toEqual({ playerId: 'p1', harbor: drawn, number: 1 });
    expect(projectEvent(draws[0]!, 'p3')).toEqual(expect.objectContaining({ type: 'world.harborDrawn' }));
    // 放下之前，下一個港口尚未抽出：狀態裡 drawn 是 null 後才抽下一個，從事件序列看不到未來。
    const next = placeHarbor(state, sf(state, 'p1').harborChoices.edges[0]!);
    const types = next.log.filter((event) => event.type.startsWith('world.')).map((event) => event.type);
    expect(types).toEqual(['world.harborDrawn', 'world.harborPlaced', 'world.harborDrawn']);
  });
});
