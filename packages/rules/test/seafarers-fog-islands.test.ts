/**
 * R-SFX-S3：The Fog Islands（未知海域）。版圖與配件表對照 SF25 p. 8（3 人）與
 * p. 9（4 人）；規則 fixture 為探索觸發（路、船、移動船不觸發、多空格選一）、
 * 陸地加圓片加資源、金礦自選、翻海洋、強盜與海盜限制、12 分，以及隱私（SFX-S3-P）。
 */

import { describe, expect, it } from 'vitest';
import { isLandHex, scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, legalBuildingVertices, type Command } from '../src/engine.ts';
import { fogHexesAtEdge } from '../src/modules/seafarers/fog.ts';
import { seafarersState } from '../src/modules/seafarers/state.ts';
import { projectGame } from '../src/project.ts';
import { getProfile, resolveCombination } from '../src/profiles.ts';
import { seededRng } from '../src/rng.ts';
import { FOG_ISLANDS_SOURCE, FOG_TILES } from '../src/seafarers-fog-islands-boards.ts';
import { getTopology } from '../src/topology-registry.ts';
import type { GameState } from '../src/types.ts';
import { act, expectRejected, scriptedRng, setHand } from './helpers.ts';
import { emptySeafarersGame, hex, road, seafarersGame, settle, ship } from './seafarers-helpers.ts';

const PROFILE = 'sf-fog-islands-2025';

const cmd = (command: { type: string; [field: string]: unknown }): Command => command as unknown as Command;

function tally<T extends string | number | null>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[String(value)] = (out[String(value)] ?? 0) + 1;
  return out;
}

const fogGame = (players: 3 | 4 = 3, seed = 12345) => seafarersGame(players, seed, PROFILE);
const fogOf = (state: GameState): number[] => seafarersState(state).fog!.hexes;
const view = (state: GameState, viewer = 'p1') => projectGame(state, viewer);

describe('The Fog Islands topologies (SF25 pp. 8–9, spec §7.3)', () => {
  it('兩個 topology 都是 42 格外框（= New Shores 4 人外框），港口位置各自登記', () => {
    for (const [id, harbors] of [['sf-fog-islands-3', 8], ['sf-fog-islands-4', 9]] as const) {
      const topology = getTopology(id);
      expect(topology.hexes).toHaveLength(42);
      expect(topology.harborSlots).toHaveLength(harbors);
      expect(topology.hexes).toEqual(getTopology('sf-new-shores-4').hexes);
    }
    // 海框內緣邊（§7.3）與 harborSlots 一併檢查。
    for (const id of ['sf-fog-islands-3', 'sf-fog-islands-4']) expect(getTopology(id).coastalEdges).toHaveLength(46);
    expect(getTopology('sf-fog-islands-3').edges).toHaveLength(getTopology('sf-new-shores-4').edges.length);
    expect(getTopology('sf-fog-islands-3').vertices).toHaveLength(getTopology('sf-new-shores-4').vertices.length);
  });
});

describe('The Fog Islands layouts', () => {
  it('3 人：SF25 p. 8 已知區加 12 個空格 = 配件表（逐值）', () => {
    const { state } = fogGame(3);
    const layout = state.board.layout;
    expect(layout.topologyId).toBe('sf-fog-islands-3');
    // 已知區：海 16、田 2、丘 2、山 2、草 4、林 4（共 30）；空格存成海，所以 layout 的海 = 16 + 12。
    expect(tally(layout.terrain)).toEqual({ sea: 28, fields: 2, hills: 2, mountains: 2, pasture: 4, forest: 4 });
    expect(tally(layout.numbers.filter((n) => n !== null))).toEqual({ 3: 1, 4: 1, 5: 2, 6: 2, 8: 2, 9: 2, 10: 1, 11: 2, 12: 1 });
    expect(tally(layout.harbors.map((harbor) => harbor.type))).toEqual({ generic: 3, ore: 1, brick: 1, lumber: 1, wool: 1, grain: 1 });
    expect(layout.robber).toBe(hex(state, -2, 3));
    expect(layout.numbers[layout.robber]).toBe(12);
    expect(layout.pirate).toBeNull();
    expect(state.board.pirate).toBeNull();
    expect(tally(layout.islands.filter((island) => island > 0))).toEqual({ 2: 7, 3: 7 });
  });

  it('4 人：SF25 p. 9 已知區加 12 個空格 = 配件表（逐值）', () => {
    const { state } = fogGame(4);
    const layout = state.board.layout;
    expect(layout.topologyId).toBe('sf-fog-islands-4');
    // 已知區：海 13、田 3、丘 3、山 3、草 4、林 4（共 30）。
    expect(tally(layout.terrain)).toEqual({ sea: 25, fields: 3, hills: 3, mountains: 3, pasture: 4, forest: 4 });
    expect(tally(layout.numbers.filter((n) => n !== null))).toEqual({ 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 1, 12: 1 });
    expect(tally(layout.harbors.map((harbor) => harbor.type))).toEqual({ generic: 4, ore: 1, brick: 1, lumber: 1, wool: 1, grain: 1 });
    expect(layout.robber).toBe(hex(state, 4, -2));
    expect(layout.numbers[layout.robber]).toBe(12);
    expect(layout.pirate).toBeNull();
    expect(tally(layout.islands.filter((island) => island > 0))).toEqual({ 2: 10, 3: 7 });
  });

  it('未知牌庫：板塊 海 2、金 2、田 2、丘 2、山 2、草 1、林 1；圓片 3 人 3:2…、4 人 11:2…（逐值）', () => {
    expect(FOG_TILES).toEqual({ sea: 2, gold: 2, fields: 2, hills: 2, mountains: 2, pasture: 1, forest: 1 });
    expect(Object.values(FOG_TILES).reduce((a, b) => a + b, 0)).toBe(12);
    for (const [players, discs] of [
      [3, { 3: 2, 4: 1, 5: 1, 6: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1 }],
      [4, { 3: 1, 4: 1, 5: 1, 6: 1, 8: 1, 9: 1, 10: 1, 11: 2, 12: 1 }],
    ] as const) {
      const { state } = fogGame(players);
      const fog = seafarersState(state).fog!;
      expect(fog.hexes).toHaveLength(12);
      expect(fog.tiles).toEqual(FOG_TILES);
      expect(tally(fog.discs)).toEqual(discs);
      expect(fog.discs).toHaveLength(10);
    }
  });

  it('空格是海、沒有數字、也不屬於任何島；與已知格不重疊', () => {
    for (const players of [3, 4] as const) {
      const { state } = fogGame(players);
      for (const cell of FOG_ISLANDS_SOURCE[players].fog) {
        const index = hex(state, cell.q, cell.r);
        expect([state.board.layout.terrain[index], state.board.layout.numbers[index], state.board.layout.islands[index]]).toEqual(['sea', null, 0]);
        expect(fogOf(state)).toContain(index);
      }
      expect(new Set(fogOf(state)).size).toBe(12);
      for (const land of FOG_ISLANDS_SOURCE[players].land) {
        expect(fogOf(state)).not.toContain(hex(state, land.q, land.r));
      }
    }
  });

  it('港口：5 個 2:1 與 3 或 4 個 3:1，每個都貼在已知陸地、外側不是空格', () => {
    for (const players of [3, 4] as const) {
      const { state } = fogGame(players);
      const { harbors } = state.board.layout;
      expect(harbors.filter((harbor) => harbor.type !== 'generic')).toHaveLength(5);
      expect(harbors.filter((harbor) => harbor.type === 'generic')).toHaveLength(players === 3 ? 3 : 4);
      const topology = topologyOf(state);
      for (const harbor of harbors) {
        const hexes = topology.edges[harbor.edge]!.hexes;
        expect(hexes.filter((h) => state.board.layout.terrain[h] !== 'sea'), `harbor edge ${harbor.edge}`).toHaveLength(1);
        expect(hexes.some((h) => fogOf(state).includes(h))).toBe(false);
      }
    }
  });

  it('轉錄表與 layout 一致：每格地形、圓片、島編號', () => {
    for (const players of [3, 4] as const) {
      const { state } = fogGame(players);
      for (const land of FOG_ISLANDS_SOURCE[players].land) {
        const index = hex(state, land.q, land.r);
        expect([state.board.layout.terrain[index], state.board.layout.numbers[index], state.board.layout.islands[index]])
          .toEqual([land.terrain, land.number, land.island]);
      }
    }
  });

  it('profile：12 分、沒有島嶼獎勵、移動船不翻開、15 艘船、規則版本 sf-2025.3；只接受 3、4 人', () => {
    const profile = getProfile(PROFILE)!;
    expect(profile).toMatchObject({ victoryTarget: 12, implemented: true, enabled: true, fogOnMove: false });
    expect(profile.islandBonus).toBeUndefined();
    expect(profile.pieces.ships).toBe(15);
    expect(fogGame(3).state.engineVersion).toBe('sf-2025.3');
    const base = { expansions: ['seafarers'], scenario: 'fog-islands', variants: [], setupMode: 'fixed' as const };
    for (const playerCount of [3, 4]) expect(resolveCombination({ ...base, playerCount })).toMatchObject({ ok: true });
    for (const playerCount of [2, 5, 6]) expect(resolveCombination({ ...base, playerCount })).toEqual({ ok: false, reason: 'bad-player-count' });
  });
});

// ---------------------------------------------------------------------------
// 探索觸發
// ---------------------------------------------------------------------------

/** 邊的兩個端點中，離這條邊最遠（不碰空格）的那個，用來放自己的村落讓船連得上。 */
function edgesWithFog(state: GameState, count: number): number[] {
  const topo = topologyOf(state);
  return topo.edges.flatMap((edge, index) => {
    if (state.board.roads[index] || fogHexesAtEdge(state, index).length !== count) return [];
    // 必須是海邊（船）：兩側都不是陸地。
    return edge.hexes.every((h) => !isLandHex(state, h)) ? [index] : [];
  });
}

/** 以 p1 在 `edge` 的一端放村落後建造船；`rng` 供翻開時抽牌。 */
function buildShipAt(state: GameState, edge: number, rng = seededRng(1)) {
  const vertex = topologyOf(state).edges[edge]!.vertices[0];
  settle(state, 'p1', vertex);
  setHand(state, 'p1', { lumber: 1, wool: 1 });
  return act(state, 'p1', cmd({ type: 'build.ship', edge }), rng);
}

const ready = (players: 3 | 4 = 3) => emptySeafarersGame(players, 0, 'action', PROFILE);

describe('SFX-S3 探索：建造船', () => {
  it('船的端點碰到一個空格：翻開那一格（hex 離開 fog、事件公開）', () => {
    const state = ready();
    const edge = edgesWithFog(state, 1)[0]!;
    const target = fogHexesAtEdge(state, edge)[0]!;
    // 抽第 7 張板塊（丘）與第 0 枚圓片（3）。
    const { state: next, events } = buildShipAt(state, edge, scriptedRng([6, 0]));
    expect(fogOf(next)).not.toContain(target);
    expect(fogOf(next)).toHaveLength(11);
    const revealed = events.filter((event) => event.type === 'fog.revealed');
    expect(revealed).toHaveLength(1);
    expect(revealed[0]!.params).toMatchObject({ playerId: 'p1', hex: target, tile: 'hills', number: 3, resource: 'brick' });
    expect(next.pending).toBeNull();
  });

  it('船不碰空格就不翻開', () => {
    const state = ready();
    const quiet = topologyOf(state).edges.findIndex((edge, index) =>
      !state.board.roads[index] && fogHexesAtEdge(state, index).length === 0 && edge.hexes.every((h) => !isLandHex(state, h)));
    const { state: next, events } = buildShipAt(state, quiet, seededRng(1));
    expect(events.some((event) => event.type === 'fog.revealed')).toBe(false);
    expect(fogOf(next)).toHaveLength(12);
  });

  it('陸地：圓片放上、探索者拿 1 張資源（銀行少 1 張）；強盜與村落規則隨之改變', () => {
    const state = ready();
    const edge = edgesWithFog(state, 1)[0]!;
    const hexIndex = fogHexesAtEdge(state, edge)[0]!;
    const bankBefore = state.bank.grain;
    // 第 4 張（田）、圓片第 9 枚（12）。
    const { state: next } = buildShipAt(state, edge, scriptedRng([4, 9]));
    expect(next.board.layout.terrain[hexIndex]).toBe('fields');
    expect(next.board.layout.numbers[hexIndex]).toBe(12);
    expect(next.players[0]!.resources.grain).toBe(1);
    expect(next.bank.grain).toBe(bankBefore - 1);
    expect(isLandHex(next, hexIndex)).toBe(true);
    expect(seafarersState(next).fog!.discs).toHaveLength(9);
    expect(seafarersState(next).fog!.tiles.fields).toBe(1);
  });

  it('陸地但供應堆沒有該資源：拿不到（圓片照放）', () => {
    const state = ready();
    const edge = edgesWithFog(state, 1)[0]!;
    state.bank.brick = 0;
    const { state: next, events } = buildShipAt(state, edge, scriptedRng([6, 0]));
    expect(next.players[0]!.resources.brick).toBe(0);
    expect(events.find((event) => event.type === 'fog.revealed')!.params).not.toHaveProperty('resource');
    expect(next.board.layout.numbers[fogHexesAtEdge(state, edge)[0]!]).toBe(3);
  });

  it('海洋：沒有圓片、沒有資源，仍是海，只是不再是空格', () => {
    const state = ready();
    const edge = edgesWithFog(state, 1)[0]!;
    const hexIndex = fogHexesAtEdge(state, edge)[0]!;
    const { state: next, events } = buildShipAt(state, edge, scriptedRng([0]));
    expect(next.board.layout.terrain[hexIndex]).toBe('sea');
    expect(next.board.layout.numbers[hexIndex]).toBeNull();
    expect(fogOf(next)).not.toContain(hexIndex);
    expect(events.find((event) => event.type === 'fog.revealed')!.params).toEqual({ playerId: 'p1', hex: hexIndex, tile: 'sea' });
    expect(next.players[0]!.resources).toEqual({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
    expect(seafarersState(next).fog!.discs).toHaveLength(10);
    expect(seafarersState(next).fog!.tiles.sea).toBe(1);
  });

  it('金礦：探索者自選一種資源（沿用金礦 frame）；數量不對被拒、供應沒有的拿不到', () => {
    const state = ready();
    const edge = edgesWithFog(state, 1)[0]!;
    const hexIndex = fogHexesAtEdge(state, edge)[0]!;
    // 第 2 張是金礦。
    const { state: next } = buildShipAt(state, edge, scriptedRng([2, 5]));
    expect(next.board.layout.terrain[hexIndex]).toBe('gold');
    expect(next.board.layout.numbers[hexIndex]).not.toBeNull();
    expect(next.pending).toMatchObject({ kind: 'seafarers.gold', responders: ['p1'] });
    expectRejected(next, 'p1', cmd({ type: 'gold.choose', resources: ['ore', 'ore'] }), 'E_INVALID_SELECTION');
    expectRejected(next, 'p2', cmd({ type: 'gold.choose', resources: ['ore'] }), 'E_NOT_ACTOR');
    const done = act(next, 'p1', cmd({ type: 'gold.choose', resources: ['ore'] })).state;
    expect(done.players[0]!.resources.ore).toBe(1);
    expect(done.pending).toBeNull();
  });

  it('金礦：供應堆沒有的資源拿不到（付船費退回銀行的 1 木 1 羊以外全空時只能選它們）', () => {
    const state = ready();
    const edge = edgesWithFog(state, 1)[0]!;
    for (const resource of ['lumber', 'brick', 'wool', 'grain', 'ore'] as const) state.bank[resource] = 0;
    const { state: next } = buildShipAt(state, edge, scriptedRng([2, 5]));
    expect(next.pending).toMatchObject({ kind: 'seafarers.gold', responders: ['p1'] });
    expectRejected(next, 'p1', cmd({ type: 'gold.choose', resources: ['ore'] }), 'E_BANK_EMPTY');
    expect(act(next, 'p1', cmd({ type: 'gold.choose', resources: ['wool'] })).state.players[0]!.resources.wool).toBe(1);
  });

  it('同時碰到多個空格：放置者選一個（frame 只有放置者可答、只能選候選）', () => {
    const state = ready();
    const edge = edgesWithFog(state, 2)[0]!;
    const candidates = fogHexesAtEdge(state, edge);
    expect(candidates).toHaveLength(2);
    const { state: waiting, events } = buildShipAt(state, edge, scriptedRng([]));
    expect(events.some((event) => event.type === 'fog.revealed')).toBe(false);
    expect(waiting.pending).toMatchObject({ kind: 'seafarers.fog', responders: ['p1'], data: { hexes: candidates } });
    expect(fogOf(waiting)).toHaveLength(12);
    // 公開視圖的 frame 帶候選空格
    expect(view(waiting, 'p2').pending).toMatchObject({ kind: 'seafarers.fog', data: { hexes: candidates } });
    // 別人、非候選、其他指令都被擋
    expectRejected(waiting, 'p2', cmd({ type: 'fog.choose', hex: candidates[0]! }), 'E_NOT_ACTOR');
    const notCandidate = fogOf(waiting).find((h) => !candidates.includes(h))!;
    expectRejected(waiting, 'p1', cmd({ type: 'fog.choose', hex: notCandidate }), 'E_ILLEGAL_TARGET');
    expectRejected(waiting, 'p1', { type: 'turn.end' }, 'E_PENDING_EFFECT');
    // 選第二個
    const chosen = act(waiting, 'p1', cmd({ type: 'fog.choose', hex: candidates[1]! }), scriptedRng([0])).state;
    expect(chosen.pending).toBeNull();
    expect(fogOf(chosen)).not.toContain(candidates[1]!);
    expect(fogOf(chosen)).toContain(candidates[0]!);
  });

  it('多空格且選到金礦：先翻開，再輪到金礦 frame', () => {
    const state = ready();
    const edge = edgesWithFog(state, 2)[0]!;
    const candidates = fogHexesAtEdge(state, edge);
    const { state: waiting } = buildShipAt(state, edge);
    const chosen = act(waiting, 'p1', cmd({ type: 'fog.choose', hex: candidates[0]! }), scriptedRng([3, 0])).state;
    expect(chosen.board.layout.terrain[candidates[0]!]).toBe('gold');
    expect(chosen.pending).toMatchObject({ kind: 'seafarers.gold', responders: ['p1'] });
  });
});

/** 把空格旁一格海改成陸地，造出「路的端點碰到空格」的局面（固定版圖上已知陸地不鄰空格）。 */
function landNextToFog(state: GameState): { land: number; edge: number; start: number } {
  const topo = topologyOf(state);
  for (const fogHex of fogOf(state)) {
    for (const edgeIndex of topo.edges.keys()) {
      const edge = topo.edges[edgeIndex]!;
      if (edge.hexes.length !== 2 || !edge.hexes.includes(fogHex)) continue;
      const land = edge.hexes.find((h) => h !== fogHex)!;
      if (state.board.layout.terrain[land] !== 'sea' || fogOf(state).includes(land)) continue;
      // `land` 的一條邊，其中一個端點碰到 fogHex：路放在那條邊上。
      for (const own of topo.edges.keys()) {
        const candidate = topo.edges[own]!;
        if (!candidate.hexes.includes(land) || candidate.hexes.length !== 2) continue;
        const touchesFog = candidate.vertices.some((v) => topo.vertices[v]!.hexes.includes(fogHex));
        const startsClear = candidate.vertices.some((v) => !topo.vertices[v]!.hexes.includes(fogHex));
        if (touchesFog && startsClear && fogHexesAtEdge(state, own).length === 1) {
          const start = candidate.vertices.find((v) => !topo.vertices[v]!.hexes.includes(fogHex))!;
          return { land, edge: own, start };
        }
      }
    }
  }
  throw new Error('no land-next-to-fog spot');
}

describe('SFX-S3 探索：建造路與村落', () => {
  it('路的端點碰到空格：翻開；村落不觸發', () => {
    const state = ready();
    const { land, edge, start } = landNextToFog(state);
    state.board.layout.terrain[land] = 'fields';
    state.board.layout.numbers[land] = 6;
    state.board.layout.islands[land] = 2;
    const fogHex = fogHexesAtEdge(state, edge)[0]!;
    settle(state, 'p1', start);
    setHand(state, 'p1', { lumber: 1, brick: 1 });
    const placed = act(state, 'p1', { type: 'build.road', edge }, scriptedRng([6, 0]));
    expect(placed.events.filter((event) => event.type === 'fog.revealed')).toHaveLength(1);
    expect(fogOf(placed.state)).not.toContain(fogHex);

    // 村落：沿自己的路蓋到碰到空格的交叉點，不觸發。
    const fresh = ready();
    const spot = landNextToFog(fresh);
    fresh.board.layout.terrain[spot.land] = 'fields';
    fresh.board.layout.numbers[spot.land] = 6;
    fresh.board.layout.islands[spot.land] = 2;
    const topo = topologyOf(fresh);
    const info = topo.edges[spot.edge]!;
    const far = info.vertices.find((v) => v !== spot.start)!;
    // 從 far 反向再走兩條邊到 A，使 A–M–far 兩條路，村落蓋在 far。
    settle(fresh, 'p1', spot.start);
    road(fresh, 'p1', spot.edge);
    // 直接改成在 start 放村落、在 far 蓋第二個需要距離 2：改用另一側。
    const other = topo.vertices[far]!.edges.find((e) => e !== spot.edge && !fresh.board.roads[e])!;
    const mid = topo.edges[other]!.vertices.find((v) => v !== far)!;
    // 需要 mid 到 far 之間有路，且 start 與 far 之間隔 mid：重新擺。
    fresh.board.buildings[spot.start] = null;
    const third = topo.vertices[mid]!.edges.find((e) => e !== other && !fresh.board.roads[e] && e !== spot.edge)!;
    const a = topo.edges[third]!.vertices.find((v) => v !== mid)!;
    fresh.board.roads[spot.edge] = null;
    settle(fresh, 'p1', a);
    road(fresh, 'p1', third);
    road(fresh, 'p1', other);
    setHand(fresh, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    expect(legalBuildingVertices(fresh, 'p1')).toContain(far);
    const built = act(fresh, 'p1', { type: 'build.settlement', vertex: far });
    expect(built.events.some((event) => event.type === 'fog.revealed')).toBe(false);
    expect(fogOf(built.state)).toHaveLength(12);
  });
});

describe('SFX-S3 移動船不觸發（fogOnMove，OQ-2）', () => {
  /** p1 的船從不碰空格的海邊，移到碰到一個空格的海邊；兩端各有自己的村落。 */
  function moveSetup() {
    const state = ready();
    const topo = topologyOf(state);
    const target = edgesWithFog(state, 1)[0]!;
    const targetVertex = topo.edges[target]!.vertices[0];
    const from = topo.edges.findIndex((edge, index) =>
      !state.board.roads[index] && fogHexesAtEdge(state, index).length === 0 && edge.hexes.every((h) => !isLandHex(state, h))
      && index !== target && edge.vertices.every((v) => v !== targetVertex)
      && edge.vertices.every((v) => !topo.vertices[v]!.edges.includes(target)));
    settle(state, 'p1', targetVertex);
    settle(state, 'p1', topo.edges[from]!.vertices[0]);
    ship(state, 'p1', from);
    return { state, from, target };
  }

  it('預設：移動船到碰空格的邊，不翻開', () => {
    const { state, from, target } = moveSetup();
    const { state: next, events } = act(state, 'p1', cmd({ type: 'ship.move', from, to: target }));
    expect(events.some((event) => event.type === 'ship.moved')).toBe(true);
    expect(events.some((event) => event.type === 'fog.revealed')).toBe(false);
    expect(fogOf(next)).toHaveLength(12);
  });

  it('fogOnMove 旗標開啟時才翻開（旗標是 profile 層的，其他規則不動）', () => {
    const { state, from, target } = moveSetup();
    const profile = getProfile(PROFILE)!;
    profile.fogOnMove = true;
    try {
      const { state: next, events } = act(state, 'p1', cmd({ type: 'ship.move', from, to: target }), scriptedRng([0]));
      expect(events.filter((event) => event.type === 'fog.revealed')).toHaveLength(1);
      expect(fogOf(next)).toHaveLength(11);
    } finally {
      profile.fogOnMove = false;
    }
  });
});

describe('SFX-S3 設置階段', () => {
  it('設置階段放碰到空格的船不翻開；開局後第一次建造鄰接的船才翻開', () => {
    for (const players of [3, 4] as const) {
      let state = fogGame(players, 7).state;
      let touching = 0;
      let guard = 0;
      while (state.turn.phase === 'setup' && guard++ < 40) {
        const setup = state.turn.setup!;
        const actor = state.players[setup.order[setup.index]!]!.id;
        expect(state.pending).toBeNull();
        if (setup.stage === 'building') {
          // 偏好有碰空格的海邊的海岸交叉點，讓設置船有機會鄰接空格。
          const hints = actionHints(state, actor);
          const vertex = hints.legalSettlements.find((candidate) => topologyOf(state).vertices[candidate]!.edges.some((edge) =>
            edgesWithFog(state, 1).includes(edge) || edgesWithFog(state, 2).includes(edge))) ?? hints.legalSettlements[0]!;
          state = act(state, actor, { type: 'setup.placeBuilding', vertex }).state;
          continue;
        }
        const sea = (actionHints(state, actor).modules!.seafarers as { setupShips: number[] }).setupShips;
        const edge = sea.find((candidate) => fogHexesAtEdge(state, candidate).length > 0);
        if (edge !== undefined) {
          touching++;
          state = act(state, actor, cmd({ type: 'setup.placeShip', edge }), seededRng(guard)).state;
        } else {
          state = act(state, actor, { type: 'setup.placeRoad', edge: actionHints(state, actor).legalRoads[0]! }).state;
        }
      }
      expect(state.turn.phase).not.toBe('setup');
      // 不能空洞通過：真的放過鄰接空格的設置船，卻沒有任何翻開、也沒有待處理的 frame。
      expect(touching).toBeGreaterThan(0);
      expect(state.log.some((event) => event.type === 'fog.revealed')).toBe(false);
      expect(fogOf(state)).toHaveLength(12);
      expect(state.pending).toBeNull();
      // 開局後第一次建造鄰接的船：翻開。確定性地準備盤面：挑一條只碰一個空格的海邊，行動者在一端有村落。
      const actor = state.players[state.turn.seat]!.id;
      state.turn.phase = 'action';
      state.windowId += 1;
      const edge = edgesWithFog(state, 1)[0];
      expect(edge).toBeDefined();
      settle(state, actor, topologyOf(state).edges[edge!]!.vertices[0]);
      setHand(state, actor, { lumber: 1, wool: 1 });
      const built = act(state, actor, cmd({ type: 'build.ship', edge: edge! }), seededRng(3));
      expect(built.events.filter((event) => event.type === 'fog.revealed')).toHaveLength(1);
    }
  });

  it('設置中翻開的新陸地不是已知島：起始村落不能放在上面', () => {
    const state = fogGame(3).state;
    const edge = edgesWithFog(state, 1)[0]!;
    const hexIndex = fogHexesAtEdge(state, edge)[0]!;
    // 直接把這格翻成陸地（模擬設置中翻開），不改島編號。
    state.board.layout.terrain[hexIndex] = 'fields';
    state.board.layout.numbers[hexIndex] = 6;
    const spots = topologyOf(state).vertices.map((_v, vertex) => vertex).filter((vertex) => topologyOf(state).vertices[vertex]!.hexes.includes(hexIndex));
    const legal = new Set(legalBuildingVertices(state, 'p1', { setup: true }));
    expect(spots.some((vertex) => legal.has(vertex))).toBe(false);
  });

  it('設置的村落可放在一座或兩座島（沒有主島限制）', () => {
    const { state } = fogGame(3);
    const islands = new Set(legalBuildingVertices(state, 'p1', { setup: true }).flatMap((vertex) =>
      topologyOf(state).vertices[vertex]!.hexes.map((h) => state.board.layout.islands[h]).filter((island) => island! > 0)));
    expect([...islands].sort()).toEqual([2, 3]);
  });
});

// ---------------------------------------------------------------------------
// 強盜、海盜、勝利
// ---------------------------------------------------------------------------

describe('SFX-S3 強盜與海盜', () => {
  it('強盜只上陸地（不含空格）、海盜只上已翻開的海格（不含空格）', () => {
    const state = ready();
    const hints = actionHints(state, 'p1').modules!.seafarers as { pirateTargets: (number | null)[]; robberTargets: number[] };
    for (const fogHex of fogOf(state)) {
      expect(hints.robberTargets).not.toContain(fogHex);
      expect(hints.pirateTargets).not.toContain(fogHex);
    }
    // 一般海格仍可。
    expect(hints.pirateTargets.some((h) => h !== null && !fogOf(state).includes(h))).toBe(true);
  });

  it('騎士牌把強盜或海盜送進空格被拒絕', () => {
    const state = ready();
    state.players[0]!.devCards = ['knight'];
    const fogHex = fogOf(state)[0]!;
    expectRejected(state, 'p1', { type: 'dev.playKnight', hex: fogHex }, 'E_ILLEGAL_TARGET');
  });

  it('翻開後：翻成陸地的格強盜可上，翻成海的格海盜可上', () => {
    const land = ready();
    const edgeLand = edgesWithFog(land, 1)[0]!;
    const landHex = fogHexesAtEdge(land, edgeLand)[0]!;
    const { state: afterLand } = buildShipAt(land, edgeLand, scriptedRng([6, 0]));
    const hintsLand = actionHints(afterLand, 'p1').modules!.seafarers as { pirateTargets: (number | null)[]; robberTargets: number[] };
    expect(hintsLand.robberTargets).toContain(landHex);
    expect(hintsLand.pirateTargets).not.toContain(landHex);

    const sea = ready();
    const edgeSea = edgesWithFog(sea, 1)[0]!;
    const seaHex = fogHexesAtEdge(sea, edgeSea)[0]!;
    const { state: afterSea } = buildShipAt(sea, edgeSea, scriptedRng([0]));
    const hintsSea = actionHints(afterSea, 'p1').modules!.seafarers as { pirateTargets: (number | null)[]; robberTargets: number[] };
    expect(hintsSea.pirateTargets).toContain(seaHex);
    expect(hintsSea.robberTargets).not.toContain(seaHex);
  });
});

describe('SFX-S3 12 分', () => {
  it('12 分在自己回合勝利、11 分不勝；沒有島嶼獎勵', () => {
    const state = ready();
    state.turn.seat = 0;
    const topo = topologyOf(state);
    const islandVertices = state.board.buildings.map((_b, vertex) => vertex).filter((vertex) =>
      topo.vertices[vertex]!.hexes.some((h) => (state.board.layout.islands[h] ?? 0) === 3));
    const play = (bonusPoints: number) => {
      const copy: GameState = JSON.parse(JSON.stringify(state));
      copy.players[0]!.bonusPoints = bonusPoints;
      settle(copy, 'p1', islandVertices[0]!);
      setHand(copy, 'p1', { lumber: 1, brick: 1 });
      const road2 = actionHints(copy, 'p1').legalRoads[0]!;
      const outcome = applyCommand(copy, 'p1', { type: 'build.road', edge: road2 }, seededRng(1));
      if (!outcome.ok) throw new Error(outcome.error.code);
      return outcome.state;
    };
    const win = play(11);
    expect(scoreOf(win, 'p1', { includeHidden: true })).toBe(12);
    expect(win.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
    const short = play(10);
    expect(scoreOf(short, 'p1', { includeHidden: true })).toBe(11);
    expect(short.result).toBeNull();
    // 島上的第一個村落不得分。
    expect(win.log.some((event) => event.type === 'island.bonus')).toBe(false);
    expect(seafarersState(win).islands.p1).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SFX-S3-P 隱私
// ---------------------------------------------------------------------------

/** 檢查序列化內容不含牌庫欄位名。 */
const LEAK_KEYS = ['"tiles"', '"discs"', '"deck"'];

describe('SFX-S3-P 翻開前後都不洩漏未翻開格的身分', () => {
  it('翻開前：projection 與事件不含牌庫；空格是無數字的海，只有 `fog` 列出位置', () => {
    for (const viewer of ['p1', 'p2', 'p3']) {
      const state = fogGame(3).state;
      const projected = view(state, viewer);
      const json = JSON.stringify(projected);
      for (const key of LEAK_KEYS) expect(json).not.toContain(key);
      expect((projected.modules!.seafarers as { fog: number[] }).fog).toEqual(fogOf(state));
      for (const fogHex of fogOf(state)) {
        expect(projected.board.terrain[fogHex]).toBe('sea');
        expect(projected.board.numbers[fogHex]).toBeNull();
      }
      expect(JSON.stringify(state.log)).not.toContain('fog.revealed');
    }
  });

  it('翻開前的 snapshot 沒有牌庫順序：不同種子的牌庫狀態完全相同（沒有預先抽好的結果）', () => {
    const one = seafarersState(fogGame(3, 1).state).fog!;
    const two = seafarersState(fogGame(3, 999).state).fog!;
    expect(two).toEqual(one);
    // 圓片以升冪的多重集存放，沒有洗牌順序。
    expect(one.discs).toEqual(one.discs.slice().sort((a, b) => a - b));
    // 沒有任何「某格 → 板塊」的記錄：fog 只有三個欄位。
    expect(Object.keys(one).sort()).toEqual(['discs', 'hexes', 'tiles']);
  });

  it('同一個翻開前狀態在不同 rng 下翻出不同結果：身分是翻開當下才抽的', () => {
    const state = ready();
    const edge = edgesWithFog(state, 1)[0]!;
    const hexIndex = fogHexesAtEdge(state, edge)[0]!;
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      const copy: GameState = JSON.parse(JSON.stringify(state));
      const { state: next } = buildShipAt(copy, edge, seededRng(seed));
      outcomes.add(`${next.board.layout.terrain[hexIndex]}:${next.board.layout.numbers[hexIndex]}`);
    }
    expect(outcomes.size).toBeGreaterThan(3);
  });

  it('翻開後：只有被翻開的那一格公開；其餘空格仍是無數字的海，事件只帶該格', () => {
    const state = ready();
    const edge = edgesWithFog(state, 1)[0]!;
    const hexIndex = fogHexesAtEdge(state, edge)[0]!;
    const { state: next, events } = buildShipAt(state, edge, scriptedRng([4, 9]));
    expect(next.log.filter((event) => event.type === 'fog.revealed')).toHaveLength(1);
    expect(events.find((event) => event.type === 'fog.revealed')!.params.hex).toBe(hexIndex);
    for (const viewer of ['p1', 'p2']) {
      const projected = view(next, viewer);
      const json = JSON.stringify(projected);
      for (const key of LEAK_KEYS) expect(json).not.toContain(key);
      expect(projected.board.terrain[hexIndex]).toBe('fields');
      for (const rest of fogOf(next)) {
        expect(projected.board.terrain[rest]).toBe('sea');
        expect(projected.board.numbers[rest]).toBeNull();
      }
      expect((projected.modules!.seafarers as { fog: number[] }).fog).toEqual(fogOf(next));
    }
    const fog = seafarersState(next).fog!;
    expect(Object.keys(fog).sort()).toEqual(['discs', 'hexes', 'tiles']);
    expect(Object.values(fog.tiles).reduce<number>((a, b) => a + (b ?? 0), 0)).toBe(11);
  });

  it('多空格選擇 frame 不洩漏：候選只是位置，選擇前沒有任何翻開事件', () => {
    const state = ready();
    const edge = edgesWithFog(state, 2)[0]!;
    const { state: waiting } = buildShipAt(state, edge);
    const json = JSON.stringify(view(waiting, 'p2'));
    for (const key of LEAK_KEYS) expect(json).not.toContain(key);
    expect(JSON.stringify(waiting.log)).not.toContain('fog.revealed');
  });

  it('snapshot 還原與重播：JSON 往返後再翻開的結果與直接繼續一致；同種子重播同一局相同', () => {
    const state = ready();
    const edge = edgesWithFog(state, 1)[0]!;
    const restored: GameState = JSON.parse(JSON.stringify(state));
    const direct = buildShipAt(state, edge, seededRng(5)).state;
    const afterRestore = buildShipAt(restored, edge, seededRng(5)).state;
    expect(afterRestore).toEqual(direct);
    // 中途（翻開一格之後）再還原，繼續翻開第二格也一致。
    const second = edgesWithFog(direct, 1).find((candidate) => candidate !== edge);
    if (second !== undefined) {
      const resumed: GameState = JSON.parse(JSON.stringify(direct));
      expect(buildShipAt(resumed, second, seededRng(8)).state).toEqual(buildShipAt(direct, second, seededRng(8)).state);
    }
  });
});

// ---------------------------------------------------------------------------
// 築路卡與排隊的 fog frame、指令限定、重播隱私
// ---------------------------------------------------------------------------

describe('SFX-S3 築路卡兩艘船各鄰兩個空格、共用一格', () => {
  it('第一個 fog frame 選定後，翻開先於結束；第二個 frame 啟用時已濾掉那格，只剩一格就直接翻開', () => {
    const state = ready();
    const topo = topologyOf(state);
    const twos = edgesWithFog(state, 2);
    let pair: [number, number] | null = null;
    for (const a of twos) for (const b of twos) {
      const ha = fogHexesAtEdge(state, a);
      const hb = fogHexesAtEdge(state, b);
      if (a !== b && ha.filter((h) => hb.includes(h)).length === 1 && !topo.edges[a]!.vertices.some((v) => topo.edges[b]!.vertices.includes(v))) pair = [a, b];
    }
    expect(pair).not.toBeNull();
    const [a, b] = pair!;
    const shared = fogHexesAtEdge(state, a).find((h) => fogHexesAtEdge(state, b).includes(h))!;
    const lastOfB = fogHexesAtEdge(state, b).find((h) => h !== shared)!;
    settle(state, 'p1', topo.edges[a]!.vertices[0]);
    settle(state, 'p1', topo.edges[b]!.vertices[0]);
    state.players[0]!.devCards = ['roadBuilding'];
    let next = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    next = act(next, 'p1', cmd({ type: 'build.ship', edge: a })).state;
    expect(next.pending).toMatchObject({ kind: 'freeRoads' });
    next = act(next, 'p1', cmd({ type: 'build.ship', edge: b })).state;
    // 兩個 frame 都排在築路卡之後；築路卡結束時第一個啟用。
    expect(next.pending).toMatchObject({ kind: 'seafarers.fog', data: { hexes: fogHexesAtEdge(state, a) } });
    expect(fogOf(next)).toHaveLength(12);
    const chosen = act(next, 'p1', cmd({ type: 'fog.choose', hex: shared }), seededRng(2));
    // 共用的那格被翻開，第二個 frame 只剩 B 的另一格，沒有選擇可做，直接翻開：兩次翻開、無 pending。
    expect(chosen.events.filter((event) => event.type === 'fog.revealed').map((event) => event.params.hex)).toEqual([shared, lastOfB]);
    expect(fogOf(chosen.state)).toHaveLength(10);
    expect(chosen.state.pending === null || chosen.state.pending.kind === 'seafarers.gold').toBe(true);
  });

  it('選到金礦：金礦 frame 排在這個 frame 之後、下一個 fog frame 之前不被吃掉', () => {
    const state = ready();
    const edge = edgesWithFog(state, 2)[0]!;
    const hexes = fogHexesAtEdge(state, edge);
    const { state: waiting } = buildShipAt(state, edge);
    const chosen = act(waiting, 'p1', cmd({ type: 'fog.choose', hex: hexes[0]! }), scriptedRng([2, 0]));
    expect(chosen.events.map((event) => event.type).filter((type) => type === 'fog.revealed' || type === 'gold.required')).toEqual(['fog.revealed', 'gold.required']);
    expect(chosen.state.pending).toMatchObject({ kind: 'seafarers.gold', responders: ['p1'] });
  });
});

describe('SFX-S3 fog.choose 只在未知海域', () => {
  const unknown = (state: GameState, type: string) => {
    const outcome = applyCommand(state, 'p1', cmd({ type, hex: 0 }), seededRng(1));
    return outcome.ok ? 'ok' : `${outcome.error.code}:${JSON.stringify(outcome.error.params ?? {})}`;
  };

  it('New Shores：沒有 pending 與有 pending（移動強盜）時，fog.choose 與任何未知指令的錯誤一致', () => {
    const idle = emptySeafarersGame(4, 0, 'action');
    expect(unknown(idle, 'fog.choose')).toBe(unknown(idle, 'no.such.command'));
    expect(unknown(idle, 'fog.choose')).toMatch(/^E_INVALID_COMMAND/);
    const busy = emptySeafarersGame(4, 0, 'action');
    busy.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven' } as never;
    expect(unknown(busy, 'fog.choose')).toBe(unknown(busy, 'no.such.command'));
    expect(unknown(busy, 'fog.choose')).toMatch(/^E_PENDING_EFFECT/);
  });

  it('未知海域沒有 fog frame 時，fog.choose 是 E_PENDING_EFFECT（沒有待答的選擇）', () => {
    const state = ready();
    expectRejected(state, 'p1', cmd({ type: 'fog.choose', hex: fogOf(state)[0]! }), 'E_PENDING_EFFECT');
  });
});

describe('SFX-S3 金礦選擇緊接在目前的 frame 之後', () => {
  it('築路卡兩艘船各鄰兩個不重疊空格：第一個選擇翻到金礦，下一個啟用的是金礦選擇；銀行只剩 1 張也拿得到', () => {
    const state = ready();
    const topo = topologyOf(state);
    const twos = edgesWithFog(state, 2);
    let pair: [number, number] | null = null;
    for (const a of twos) for (const b of twos) {
      const ha = fogHexesAtEdge(state, a);
      const hb = fogHexesAtEdge(state, b);
      if (a !== b && ha.every((h) => !hb.includes(h)) && !topo.edges[a]!.vertices.some((v) => topo.edges[b]!.vertices.includes(v))) pair = [a, b];
    }
    expect(pair).not.toBeNull();
    const [a, b] = pair!;
    settle(state, 'p1', topo.edges[a]!.vertices[0]);
    settle(state, 'p1', topo.edges[b]!.vertices[0]);
    state.players[0]!.devCards = ['roadBuilding'];
    let next = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    next = act(next, 'p1', cmd({ type: 'build.ship', edge: a })).state;
    next = act(next, 'p1', cmd({ type: 'build.ship', edge: b })).state;
    expect(next.pending).toMatchObject({ kind: 'seafarers.fog' });
    // 銀行只剩 1 張礦：後面的 fog frame 翻到陸地也不能先把它拿走。
    for (const resource of ['lumber', 'brick', 'wool', 'grain', 'ore'] as const) next.bank[resource] = resource === 'ore' ? 1 : 0;
    const first = fogHexesAtEdge(state, a)[0]!;
    const gold = act(next, 'p1', cmd({ type: 'fog.choose', hex: first }), scriptedRng([2, 0]));
    expect(gold.state.board.layout.terrain[first]).toBe('gold');
    // 下一個啟用的是金礦選擇，第二個 fog frame 還在隊列裡。
    expect(gold.state.pending).toMatchObject({ kind: 'seafarers.gold', responders: ['p1'] });
    expect((gold.state.pendingQueue ?? []).map((frame) => frame.kind)).toEqual(['seafarers.fog']);
    const picked = act(gold.state, 'p1', cmd({ type: 'gold.choose', resources: ['ore'] }));
    expect(picked.state.players[0]!.resources.ore).toBe(1);
    expect(picked.state.pending).toMatchObject({ kind: 'seafarers.fog' });
    // 第二個 fog frame：翻到陸地（供應已空）不拿資源，也不出錯。
    const second = act(picked.state, 'p1', cmd({ type: 'fog.choose', hex: fogHexesAtEdge(state, b)[0]! }), scriptedRng([6, 0]));
    expect(second.state.players[0]!.resources.brick).toBe(0);
    expect(second.state.pending).toBeNull();
  });
});

describe('SFX-S3-P 逐步重播', () => {
  // repo 沒有「由歷史重建每一步」的機制：快照原樣存檔，指令以 receipt 冪等，引擎是決定性的
  // （同一個初始狀態、同一串指令與 rng 必得同一串狀態）。這裡就以這個決定性重播逐步檢查。
  type Step = { actor: string; command: Command; seed: number };

  it('逐步重播一局（含翻開）：每一步每位觀看者的公開視圖都與原局相同，翻開前不含任何空格的地形與數字', () => {
    const first = fogGame(3, 11).state;
    const initial: GameState = JSON.parse(JSON.stringify(first));
    const hidden = fogOf(first).slice();
    const steps: Step[] = [];
    let state = first;
    const apply = (actor: string, command: Command) => {
      const seed = steps.length + 100;
      steps.push({ actor, command, seed });
      state = act(state, actor, command, seededRng(seed)).state;
    };
    let guard = 0;
    while (state.turn.phase === 'setup' && guard++ < 40) {
      const setup = state.turn.setup!;
      const actor = state.players[setup.order[setup.index]!]!.id;
      const hints = actionHints(state, actor);
      if (setup.stage === 'building') apply(actor, { type: 'setup.placeBuilding', vertex: hints.legalSettlements[0]! });
      else apply(actor, { type: 'setup.placeRoad', edge: hints.legalRoads[0]! });
    }
    const actor = state.players[state.turn.seat]!.id;
    state.turn.phase = 'action';
    state.windowId += 1;
    const edge = edgesWithFog(state, 1)[0]!;
    settle(state, actor, topologyOf(state).edges[edge]!.vertices[0]);
    setHand(state, actor, { lumber: 1, wool: 1 });
    const prepared: GameState = JSON.parse(JSON.stringify(state));
    apply(actor, cmd({ type: 'build.ship', edge }));
    const revealed = fogHexesAtEdge(prepared, edge)[0]!;

    // 重播：從同一個初始狀態與同一串指令逐步再走一遍（在「準備盤面」那一刻接上同一份快照）。
    let replay: GameState = initial;
    const outputs = (s: GameState) => ['p1', 'p2', 'p3'].map((viewer) => view(s, viewer));
    const publicHidden = (projected: ReturnType<typeof view>) => hidden.map((h) => [projected.board.terrain[h], projected.board.numbers[h]]);
    const base = publicHidden(view(initial, 'p1'));
    let index = 0;
    for (const step of steps) {
      const isShip = (step.command as { type: string }).type === 'build.ship';
      if (isShip) replay = JSON.parse(JSON.stringify(prepared));
      const outcome = applyCommand(replay, step.actor, step.command, seededRng(step.seed));
      if (!outcome.ok) throw new Error(outcome.error.code);
      const before = replay;
      replay = outcome.state;
      for (const projected of outputs(replay)) {
        const json = JSON.stringify(projected);
        for (const key of LEAK_KEYS) expect(json).not.toContain(key);
        const now = publicHidden(projected);
        // 翻開前的每一步：所有空格仍是無數字的海；翻開那一步：只有被翻開的那一格變了。
        now.forEach((cell, i) => {
          if (hidden[i] === revealed && isShip) return;
          expect(cell, `step ${index} hex ${hidden[i]}`).toEqual(base[i]);
        });
      }
      expect(before.log.some((event) => event.type === 'fog.revealed')).toBe(false);
      index++;
    }
    // 重播的最終狀態與原局逐位元相同，被翻開的那一格公開、其餘不變。
    expect(replay).toEqual(state);
    const after = view(replay, 'p2');
    expect(after.board.terrain[revealed]).toBe(state.board.layout.terrain[revealed]);
    expect(replay.log.filter((event) => event.type === 'fog.revealed')).toHaveLength(1);
  });
});
