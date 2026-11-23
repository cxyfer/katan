/**
 * R-SFX-S4：Through the Desert（穿越荒漠）。版圖與配件表對照 SF25 p. 10（3 人，35 格外框）
 * 與 p. 11（4 人，42 格外框）；規則 fixture 為起始村落只放主島且不碰外地、四處 unexplored
 * region 各 +2、沙漠與外地之間的交叉點歸外地、14 分勝利。
 */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, legalBuildingVertices, legalRoadEdges } from '../src/engine.ts';
import { islandsAt } from '../src/modules/seafarers/islands.ts';
import { projectGame } from '../src/project.ts';
import { getProfile, resolveCombination } from '../src/profiles.ts';
import { seededRng } from '../src/rng.ts';
import { THROUGH_THE_DESERT_SOURCE } from '../src/seafarers-scenario-boards.ts';
import { getTopology } from '../src/topology-registry.ts';
import type { GameState } from '../src/types.ts';
import { act, setHand } from './helpers.ts';
import { simulateSeafarers } from './seafarers-sim.ts';
import { hex, seafarersGame, settle } from './seafarers-helpers.ts';

const PROFILE = 'sf-through-the-desert-2025';

function tally<T extends string | number | null>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[String(value)] = (out[String(value)] ?? 0) + 1;
  return out;
}

const desert = (players: 3 | 4 = 4, seed = 12345) => seafarersGame(players, seed, PROFILE);

/** 某區域（島編號集合）的陸地格：地形與圓片數量。 */
function region(state: GameState, inRegion: (island: number) => boolean) {
  const { terrain, numbers, islands } = state.board.layout;
  const indexes = terrain.map((_t, index) => index).filter((index) => terrain[index] !== 'sea' && inRegion(islands[index]!));
  return {
    terrain: tally(indexes.map((index) => terrain[index]!)),
    discs: indexes.filter((index) => numbers[index] !== null).length,
    hexes: indexes.length,
  };
}

describe('Through the Desert topologies (SF25 pp. 10–11, spec §7.3)', () => {
  it('3 人是 35 格外框、4 人是 42 格外框（依人數，不是依劇本），港口位置各自登記', () => {
    const three = getTopology('sf-through-the-desert-3');
    expect([three.hexes.length, three.edges.length, three.vertices.length, three.coastalEdges.length, three.harborSlots.length])
      .toEqual([35, 126, 92, 42, 8]);
    const four = getTopology('sf-through-the-desert-4');
    expect([four.hexes.length, four.edges.length, four.vertices.length, four.coastalEdges.length, four.harborSlots.length])
      .toEqual([42, 149, 108, 46, 9]);
    // 外框與 New Shores 同人數的圖相同，港口位置不同。
    expect(three.hexes).toEqual(getTopology('sf-new-shores-3').hexes);
    expect(four.hexes).toEqual(getTopology('sf-new-shores-4').hexes);
    expect(three.harborSlots).not.toEqual(getTopology('sf-four-islands-3').harborSlots);
  });
});

describe('Through the Desert layouts', () => {
  it('3 人：SF25 p. 10 版圖與配件表（35 格、圓片 22、海港 5 + 3）', () => {
    const { state } = desert(3);
    const layout = state.board.layout;
    expect(layout.topologyId).toBe('sf-through-the-desert-3');
    expect(topologyOf(state).hexes).toHaveLength(35);
    expect(tally(layout.terrain)).toEqual({ sea: 10, desert: 3, gold: 2, hills: 3, forest: 5, pasture: 4, fields: 4, mountains: 4 });
    expect(tally(layout.numbers.filter((n) => n !== null))).toEqual({ 2: 1, 3: 2, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 2, 11: 1, 12: 1 });
    expect(layout.numbers.filter((n) => n !== null)).toHaveLength(22);
    expect(tally(layout.harbors.map((harbor) => harbor.type))).toEqual({ generic: 3, ore: 1, brick: 1, lumber: 1, wool: 1, grain: 1 });
    expect(layout.harbors).toHaveLength(8);
  });

  it('4 人：SF25 p. 11 版圖與配件表（42 格、圓片 27、海港 5 + 4）', () => {
    const { state } = desert(4);
    const layout = state.board.layout;
    expect(layout.topologyId).toBe('sf-through-the-desert-4');
    expect(topologyOf(state).hexes).toHaveLength(42);
    expect(tally(layout.terrain)).toEqual({ sea: 12, desert: 3, gold: 2, hills: 5, forest: 5, pasture: 5, fields: 5, mountains: 5 });
    expect(tally(layout.numbers.filter((n) => n !== null))).toEqual({ 2: 1, 3: 3, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 2 });
    expect(layout.numbers.filter((n) => n !== null)).toHaveLength(27);
    expect(tally(layout.harbors.map((harbor) => harbor.type))).toEqual({ generic: 4, ore: 1, brick: 1, lumber: 1, wool: 1, grain: 1 });
    expect(layout.harbors).toHaveLength(9);
  });

  it('分區子表（SFCN-20）：主島 25／30 格含 8／10 海、外地 10／12 格含 2 海；陸地與圓片逐項對', () => {
    const expected = {
      3: {
        main: { terrain: { desert: 3, fields: 2, hills: 3, mountains: 2, pasture: 3, forest: 4 }, discs: 14, sea: 8 },
        outlying: { terrain: { gold: 2, fields: 2, mountains: 2, pasture: 1, forest: 1 }, discs: 8, sea: 2 },
        total: 35,
      },
      4: {
        main: { terrain: { desert: 3, fields: 2, hills: 4, mountains: 2, pasture: 4, forest: 5 }, discs: 17, sea: 10 },
        outlying: { terrain: { gold: 2, fields: 3, hills: 1, mountains: 3, pasture: 1 }, discs: 10, sea: 2 },
        total: 42,
      },
    } as const;
    for (const players of [3, 4] as const) {
      const { state } = desert(players);
      const main = region(state, (island) => island === 1);
      const outlying = region(state, (island) => island > 1);
      expect({ terrain: main.terrain, discs: main.discs }).toEqual({ terrain: expected[players].main.terrain, discs: expected[players].main.discs });
      expect({ terrain: outlying.terrain, discs: outlying.discs }).toEqual({ terrain: expected[players].outlying.terrain, discs: expected[players].outlying.discs });
      // 圓片數 = 各區陸地格數（沙漠不放圓片）。
      expect(main.discs).toBe(main.hexes - 3);
      expect(outlying.discs).toBe(outlying.hexes);
      // 海洋格：頁面看不出海洋格的區域歸屬，只能核對總和（主島海 + 外地海 = 版圖海格數）。
      const sea = state.board.layout.terrain.filter((tile) => tile === 'sea').length;
      expect(expected[players].main.sea + expected[players].outlying.sea).toBe(sea);
      expect(main.hexes + expected[players].main.sea + outlying.hexes + expected[players].outlying.sea).toBe(expected[players].total);
    }
  });

  it('島編號：主島 1 含三塊沙漠，外地四處 2–5；強盜在沙漠 (0,-2)，海盜在框上', () => {
    const sizes = { 3: { 1: 17, 2: 3, 3: 2, 4: 1, 5: 2 }, 4: { 1: 20, 2: 3, 3: 3, 4: 2, 5: 2 } } as const;
    for (const players of [3, 4] as const) {
      const { state } = desert(players);
      const { islands, terrain } = state.board.layout;
      expect(tally(islands.filter((island) => island > 0))).toEqual(sizes[players]);
      // 三塊沙漠都是主島。
      for (const [q, r] of [[1, -3], [0, -2], [-1, -1]] as const) {
        const index = hex(state, q, r);
        expect([terrain[index], islands[index]]).toEqual(['desert', 1]);
      }
      expect(state.board.layout.robber).toBe(hex(state, 0, -2));
      expect(state.board.robber).toBe(hex(state, 0, -2));
      expect(state.board.layout.pirate).toBeNull();
      expect(state.board.pirate).toBeNull();
      // 兩塊金礦都在外地；被沙漠隔出的陸地帶是島 2。
      expect(terrain.flatMap((tile, index) => (tile === 'gold' ? [islands[index]] : [])).every((island) => island! > 1)).toBe(true);
      for (const [q, r] of [[0, -3], [-1, -2], [-2, -1]] as const) expect(islands[hex(state, q, r)]).toBe(2);
    }
  });

  it('港口：5 個 2:1（每種資源各一）與 3／4 個 3:1，每個港口邊恰有一側是陸地', () => {
    for (const players of [3, 4] as const) {
      const { state } = desert(players);
      const { harbors } = state.board.layout;
      expect(harbors.filter((harbor) => harbor.type !== 'generic')).toHaveLength(5);
      expect(harbors.filter((harbor) => harbor.type === 'generic')).toHaveLength(players === 3 ? 3 : 4);
      const topology = topologyOf(state);
      for (const harbor of harbors) {
        const landSides = topology.edges[harbor.edge]!.hexes.filter((h) => state.board.layout.terrain[h] !== 'sea');
        expect(landSides.length, `harbor edge ${harbor.edge}`).toBe(1);
      }
      // 有一格陸地有兩個港口（頁面上相鄰兩邊各一）。
      const perHex = tally(harbors.map((harbor) => topology.edges[harbor.edge]!.hexes.find((h) => state.board.layout.terrain[h] !== 'sea')!));
      expect(Object.values(perHex).some((count) => count === 2)).toBe(true);
    }
  });

  it('轉錄表與 layout 一致：每格地形、圓片、島編號', () => {
    for (const players of [3, 4] as const) {
      const { state } = desert(players);
      expect(THROUGH_THE_DESERT_SOURCE[players].land).toHaveLength(players === 3 ? 25 : 30);
      for (const land of THROUGH_THE_DESERT_SOURCE[players].land) {
        const index = hex(state, land.q, land.r);
        expect([state.board.layout.terrain[index], state.board.layout.numbers[index], state.board.layout.islands[index]])
          .toEqual([land.terrain, land.number, land.island]);
      }
    }
  });

  it('profile：14 分、15 艘船、島嶼獎勵 2 分且主島不計、規則版本 sf-2025.3', () => {
    const profile = getProfile(PROFILE)!;
    expect(profile).toMatchObject({ victoryTarget: 14, implemented: true, enabled: true, islandBonus: { points: 2, skip: 'main' } });
    expect(profile.pieces.ships).toBe(15);
    for (const players of [3, 4] as const) {
      const { state } = desert(players);
      expect(state.bank.ore).toBe(19);
      expect(state.devDeck).toHaveLength(25);
      expect(state.engineVersion).toBe('sf-2025.3');
    }
  });

  it('只接受 3、4 人', () => {
    const base = { expansions: ['seafarers'], scenario: 'through-the-desert', variants: [], setupMode: 'fixed' as const };
    for (const playerCount of [3, 4]) expect(resolveCombination({ ...base, playerCount })).toMatchObject({ ok: true });
    for (const playerCount of [2, 5, 6]) expect(resolveCombination({ ...base, playerCount })).toEqual({ ok: false, reason: 'bad-player-count' });
  });
});

/** 設置：每步挑第一個合法交叉點與第一條合法路。 */
function setupFirstLegal(state: GameState): GameState {
  let current = state;
  while (current.turn.phase === 'setup') {
    const setup = current.turn.setup!;
    const actor = current.players[setup.order[setup.index]!]!.id;
    if (setup.stage === 'building') {
      const vertex = legalBuildingVertices(current, actor, { setup: true })[0]!;
      current = act(current, actor, { type: 'setup.placeBuilding', vertex }).state;
    } else {
      const edge = legalRoadEdges(current, actor, { setup: true, lastVertex: setup.lastVertex })[0]!;
      current = act(current, actor, { type: 'setup.placeRoad', edge }).state;
    }
  }
  return current;
}

describe('SFX-S4 設置排除外地', () => {
  it('起始村落只放主島：交叉點碰到的任何格都不得屬於島 2–5', () => {
    for (const players of [3, 4] as const) {
      const { state } = desert(players);
      const topology = topologyOf(state);
      const legal = new Set(legalBuildingVertices(state, 'p1', { setup: true }));
      expect(legal.size).toBeGreaterThan(0);
      let excludedNextToMain = 0;
      topology.vertices.forEach((_vertex, vertex) => {
        const islands = islandsAt(state, vertex);
        const onlyMain = islands.length > 0 && islands.every((island) => island === 1);
        // 空盤上唯一的限制就是島嶼條件：合法 ⇔ 只碰到主島。
        expect(legal.has(vertex), `vertex ${vertex} islands ${islands}`).toBe(onlyMain);
        if (islands.includes(1) && islands.some((island) => island > 1)) excludedNextToMain += 1;
      });
      // 與外地相鄰的主島交叉點（尤其沙漠與島 2 之間）確實存在並被排除。
      expect(excludedNextToMain).toBeGreaterThan(0);
      const seen = new Set([...legal].flatMap((vertex) => islandsAt(state, vertex)));
      expect([...seen]).toEqual([1]);
    }
  });

  it('設置全程只放主島；設置結束不計島嶼獎勵，也不記 home', () => {
    for (const players of [3, 4] as const) {
      const done = setupFirstLegal(desert(players).state);
      expect(done.turn.phase).not.toBe('setup');
      done.board.buildings.forEach((building, vertex) => {
        if (building) expect(islandsAt(done, vertex).every((island) => island === 1)).toBe(true);
      });
      for (const player of done.players) {
        expect(player.bonusPoints).toBe(0);
        expect(scoreOf(done, player.id, { includeHidden: true })).toBe(2);
      }
      expect(done.log.some((event) => event.type === 'island.bonus')).toBe(false);
      // 只有 skip: 'home' 的劇本才記 home。
      expect((projectGame(done, 'p1').modules!.seafarers as { home?: unknown }).home).toBeUndefined();
    }
  });

  it('遊戲中（非設置）可在沙漠、外地蓋村落：設置限制只套用在設置階段', () => {
    const { state } = desert(3);
    const vertex = state.board.buildings.findIndex((_b, index) => islandsAt(state, index).join() === '1,2');
    expect(vertex).toBeGreaterThanOrEqual(0);
    expect(legalBuildingVertices(state, 'p1', { setup: true })).not.toContain(vertex);
    // 非設置階段的合法性只受道路連接與距離規則限制，不受島嶼限制。
    const control = legalBuildingVertices(state, 'p1', { setup: false });
    expect(control).not.toContain(vertex); // 空盤沒有連到的路，所以不在其中
    state.board.roads[topologyOf(state).vertices[vertex]!.edges.find((edge) => topologyOf(state).edges[edge]!.hexes.some((h) => state.board.layout.terrain[h] !== 'sea'))!] = { player: 'p1', ship: false };
    expect(legalBuildingVertices(state, 'p1', { setup: false })).toContain(vertex);
  });
});

/** 取 `index` 號（從 0 起）自由交叉點：碰到的島編號恰為 `islands`，且沒有建築。 */
function free(state: GameState, islands: readonly number[], index = 0): number {
  const found = state.board.buildings.flatMap((building, vertex) => (!building && islandsAt(state, vertex).join() === islands.join() ? [vertex] : []));
  if (found[index] === undefined) throw new Error(`no free vertex on ${islands.join()} #${index}`);
  return found[index]!;
}

/** 設置完成、輪到 p1 行動的 3 人局，另附「蓋一條路」的觸發函式（任何棋盤變動都會結算島嶼獎勵）。 */
function readyGame(players: 3 | 4 = 3) {
  const done = setupFirstLegal(desert(players).state);
  done.turn.seat = 0;
  done.turn.phase = 'action';
  done.windowId += 1;
  const bonus = (id: string) => done.players.find((p) => p.id === id)!.bonusPoints;
  const tick = (): void => {
    const edge = actionHints(done, 'p1').legalRoads[0]!;
    setHand(done, 'p1', { lumber: 1, brick: 1 });
    Object.assign(done, act(done, 'p1', { type: 'build.road', edge }).state);
  };
  const claims = () => (projectGame(done, 'p1').modules!.seafarers as { islandClaims: { player: string; island: number }[] }).islandClaims
    .map(({ player, island }) => `${player}:${island}`).sort();
  return { done, bonus, tick, claims };
}

describe('SFX-S4 四處 unexplored region 各 +2', () => {
  it('四處各 +2：一位玩家走遍四處共 8 分，加 2 個起始與 4 個外地村落達 14 分勝利', () => {
    for (const players of [3, 4] as const) {
      const { done, bonus, tick, claims } = readyGame(players);
      for (const [step, island] of [3, 4, 5].entries()) {
        settle(done, 'p1', free(done, [island], 0));
        tick();
        expect(bonus('p1'), `island ${island}`).toBe(2 * (step + 1));
      }
      expect(done.result).toBeNull(); // 2 + 3 + 6 = 11（路尚未連成最長道路）
      settle(done, 'p1', free(done, [2], 0));
      tick();
      expect(bonus('p1')).toBe(8);
      expect(claims()).toEqual(['p1:2', 'p1:3', 'p1:4', 'p1:5']);
      // 6 個村落 + 8 分獎勵 = 14；觸發用的路可能已連成最長道路（+2），所以不低於 14。
      expect(scoreOf(done, 'p1', { includeHidden: true })).toBeGreaterThanOrEqual(14);
      expect(done.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
    }
  });

  it('每位玩家各算各的：同處第二個村落不重複，別人晚到仍各得 +2，主島（含沙漠）不計分', () => {
    for (const players of [3, 4] as const) {
      const { done, bonus, tick, claims } = readyGame(players);
      // 主島（只碰到沙漠與主島的交叉點）：不得分
      settle(done, 'p1', free(done, [1], 20));
      tick();
      expect(bonus('p1')).toBe(0);
      settle(done, 'p1', free(done, [3], 0));
      tick();
      expect(bonus('p1')).toBe(2);
      // 同一處第二個村落：不重複
      settle(done, 'p1', free(done, [3], 0));
      tick();
      expect(bonus('p1')).toBe(2);
      // 別的玩家即使晚到仍各得 +2（不是全域先到先得），自己兩處各算各的
      settle(done, 'p2', free(done, [3], 0));
      settle(done, 'p2', free(done, [2], 0));
      tick();
      expect(bonus('p2')).toBe(4);
      settle(done, 'p3', free(done, [3], 0));
      tick();
      expect(bonus('p3')).toBe(2);
      expect(claims()).toEqual(['p1:3', 'p2:2', 'p2:3', 'p3:3']);
    }
  });

  it('沙漠與島 2 之間的交叉點歸島 2：碰到 {1,2} 兩個島編號，只記島 2', () => {
    for (const players of [3, 4] as const) {
      const { done, bonus, tick, claims } = readyGame(players);
      const between = done.board.buildings.flatMap((_b, vertex) => (islandsAt(done, vertex).join() === '1,2' ? [vertex] : []));
      expect(between.length).toBeGreaterThan(0);
      // 其中一個交叉點碰到沙漠 (0,-2) 與島 2 的 (-1,-2)／(0,-3)：確認真的是沙漠。
      const topology = topologyOf(done);
      const touchesDesert = (vertex: number) => topology.vertices[vertex]!.hexes.some((h) => done.board.layout.terrain[h] === 'desert');
      expect(between.some(touchesDesert)).toBe(true);
      settle(done, 'p1', between[0]!);
      tick();
      expect(bonus('p1')).toBe(2);
      expect(claims()).toEqual(['p1:2']);
      // 島 2 已經算過：同一處的其他沙漠邊交叉點、陸地帶本身都不重複。
      settle(done, 'p1', between[between.length - 1]!);
      settle(done, 'p1', free(done, [2], 0));
      tick();
      expect(bonus('p1')).toBe(2);
      expect(claims()).toEqual(['p1:2']);
    }
  });

  it('設置階段在主島，所以設置完成時不領任何獎勵；首次進入外地才領', () => {
    const { done, bonus, tick } = readyGame(3);
    tick();
    expect(done.players.every((player) => player.bonusPoints === 0)).toBe(true);
    settle(done, 'p3', free(done, [4], 0));
    tick();
    expect(bonus('p3')).toBe(2);
  });
});

describe('SFX-S4 14 分勝利', () => {
  it('在自己回合 14 分勝利；13 分不勝', () => {
    const { done } = readyGame(4);
    expect(getProfile(done.profileId)!.victoryTarget).toBe(14);
    const spot = free(done, [3], 2);
    const play = (bonusPoints: number) => {
      const state: GameState = JSON.parse(JSON.stringify(done));
      state.players[0]!.bonusPoints = bonusPoints;
      settle(state, 'p1', spot);
      setHand(state, 'p1', { lumber: 1, brick: 1 });
      const edge = actionHints(state, 'p1').legalRoads[0]!;
      const outcome = applyCommand(state, 'p1', { type: 'build.road', edge }, seededRng(1));
      if (!outcome.ok) throw new Error(outcome.error.code);
      return outcome.state;
    };
    // 2 個起始村落 + 外地村落 1 = 3，島 3 獎勵 +2 = 5，再加 bonusPoints。
    const win = play(9);
    expect(scoreOf(win, 'p1', { includeHidden: true })).toBe(14);
    expect(win.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
    const short = play(8);
    expect(scoreOf(short, 'p1', { includeHidden: true })).toBe(13);
    expect(short.result).toBeNull();
  });
});

describe('SFX-S4 VP 標記供應（SF25 pp. 10–11：3 人 24、4 人 32）', () => {
  it('每位玩家最多 4 處 unexplored region × 2 分 = 8，全桌剛好不超過供應', () => {
    const supply = { 3: 24, 4: 32 } as const;
    for (const players of [3, 4] as const) {
      const { state } = desert(players);
      const regions = new Set(state.board.layout.islands.filter((island) => island > 1));
      expect(regions.size).toBe(4);
      const points = getProfile(PROFILE)!.islandBonus!.points;
      // 引擎沒有標記供應上限；每人每處只記一次且主島不計，上限即 外地數 × 分數。
      const perPlayer = regions.size * points;
      expect(perPlayer).toBe(8);
      expect(perPlayer * players).toBe(supply[players]);
    }
  });

  it('模擬整局後每位玩家的獎勵不超過 8、主島從不入帳，全桌不超過供應', () => {
    for (const [players, supply] of [[3, 24], [4, 32]] as const) {
      const run = simulateSeafarers(players, 40 + players, 30000, PROFILE);
      const claims = Object.values((run.state.moduleState as unknown as { seafarers: { islands: Record<string, number[]> } }).seafarers.islands);
      expect(claims.every((list) => list.length <= 4 && !list.includes(1))).toBe(true);
      const bonus = run.state.players.reduce((sum, player) => sum + player.bonusPoints, 0);
      expect(bonus).toBeLessThanOrEqual(supply);
    }
  }, 120_000);
});
