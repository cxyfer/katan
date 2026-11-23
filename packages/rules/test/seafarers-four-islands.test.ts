/**
 * R-SFX-S2：The Four Islands（四島群島）。版圖與配件表對照 SF25 p. 6（3 人）與
 * p. 7（4 人）；規則 fixture 為設置在任何島、home islands、島嶼獎勵與 13 分勝利。
 */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, legalBuildingVertices, legalRoadEdges } from '../src/engine.ts';
import { islandsAt } from '../src/modules/seafarers/islands.ts';
import { projectGame } from '../src/project.ts';
import { getProfile, resolveCombination } from '../src/profiles.ts';
import { seededRng } from '../src/rng.ts';
import { FOUR_ISLANDS_SOURCE } from '../src/seafarers-scenario-boards.ts';
import { getTopology } from '../src/topology-registry.ts';
import type { GameState } from '../src/types.ts';
import { act, setHand } from './helpers.ts';
import { simulateSeafarers } from './seafarers-sim.ts';
import { emptySeafarersGame, hex, seafarersGame, settle } from './seafarers-helpers.ts';

const PROFILE = 'sf-four-islands-2025';

function tally<T extends string | number | null>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[String(value)] = (out[String(value)] ?? 0) + 1;
  return out;
}

const islandSizes = (state: GameState): Record<string, number> => tally(state.board.layout.islands.filter((island) => island > 0));

const four = (players: 3 | 4 = 4, seed = 12345) => seafarersGame(players, seed, PROFILE);

describe('The Four Islands topologies (SF25 pp. 6–7, spec §7.3)', () => {
  it('兩個 topology 都是 35 格外框，港口位置各自登記', () => {
    for (const id of ['sf-four-islands-3', 'sf-four-islands-4']) {
      const topology = getTopology(id);
      expect(topology.hexes).toHaveLength(35);
      expect(topology.edges).toHaveLength(126);
      expect(topology.vertices).toHaveLength(92);
      expect(topology.coastalEdges).toHaveLength(42);
      expect(topology.harborSlots).toHaveLength(9);
    }
    // 外框與 New Shores 3 人圖相同，港口位置不同。
    expect(getTopology('sf-four-islands-3').hexes).toEqual(getTopology('sf-new-shores-3').hexes);
    expect(getTopology('sf-four-islands-3').harborSlots).not.toEqual(getTopology('sf-four-islands-4').harborSlots);
  });
});

describe('The Four Islands layouts', () => {
  it('3 人：SF25 p. 6 版圖與配件表', () => {
    const { state } = four(3);
    const layout = state.board.layout;
    expect(layout.topologyId).toBe('sf-four-islands-3');
    expect(topologyOf(state).hexes).toHaveLength(35);
    expect(tally(layout.terrain)).toEqual({ sea: 15, fields: 4, hills: 4, mountains: 4, pasture: 4, forest: 4 });
    expect(tally(layout.numbers.filter((n) => n !== null))).toEqual({
      2: 1, 3: 2, 4: 2, 5: 3, 6: 2, 8: 2, 9: 3, 10: 2, 11: 2, 12: 1,
    });
    expect(tally(layout.harbors.map((harbor) => harbor.type))).toEqual({ generic: 4, ore: 1, brick: 1, lumber: 1, wool: 1, grain: 1 });
    expect(layout.harbors).toHaveLength(9);
    // 強盜在 12 號圓片格；海盜在框上。
    expect(layout.robber).toBe(hex(state, -3, 3));
    expect(layout.numbers[layout.robber]).toBe(12);
    expect(layout.pirate).toBeNull();
    expect(state.board.pirate).toBeNull();
    // 四座島，沒有主島（編號 1）。
    expect(islandSizes(state)).toEqual({ 2: 4, 3: 6, 4: 6, 5: 4 });
  });

  it('4 人：SF25 p. 7 版圖與配件表', () => {
    const { state } = four(4);
    const layout = state.board.layout;
    expect(layout.topologyId).toBe('sf-four-islands-4');
    expect(topologyOf(state).hexes).toHaveLength(35);
    expect(tally(layout.terrain)).toEqual({ sea: 12, fields: 5, hills: 4, mountains: 4, pasture: 5, forest: 5 });
    expect(tally(layout.numbers.filter((n) => n !== null))).toEqual({
      2: 1, 3: 2, 4: 3, 5: 3, 6: 2, 8: 2, 9: 3, 10: 3, 11: 3, 12: 1,
    });
    expect(tally(layout.harbors.map((harbor) => harbor.type))).toEqual({ generic: 4, ore: 1, brick: 1, lumber: 1, wool: 1, grain: 1 });
    expect(layout.robber).toBe(hex(state, 2, -2));
    expect(layout.numbers[layout.robber]).toBe(12);
    expect(layout.pirate).toBeNull();
    expect(islandSizes(state)).toEqual({ 2: 4, 3: 8, 4: 7, 5: 4 });
  });

  it('港口：5 個 2:1（每種資源各一）與 4 個 3:1，每個港口都在陸地邊上', () => {
    for (const players of [3, 4] as const) {
      const { state } = four(players);
      const { harbors } = state.board.layout;
      expect(harbors.filter((harbor) => harbor.type !== 'generic')).toHaveLength(5);
      expect(harbors.filter((harbor) => harbor.type === 'generic')).toHaveLength(4);
      const topology = topologyOf(state);
      for (const harbor of harbors) {
        const landSides = topology.edges[harbor.edge]!.hexes.filter((h) => state.board.layout.terrain[h] !== 'sea');
        expect(landSides.length, `harbor edge ${harbor.edge}`).toBe(1);
      }
    }
  });

  it('轉錄表與 layout 一致：每格地形、圓片、島編號', () => {
    for (const players of [3, 4] as const) {
      const { state } = four(players);
      for (const land of FOUR_ISLANDS_SOURCE[players].land) {
        const index = hex(state, land.q, land.r);
        expect([state.board.layout.terrain[index], state.board.layout.numbers[index], state.board.layout.islands[index]])
          .toEqual([land.terrain, land.number, land.island]);
      }
    }
  });

  it('profile：13 分、15 艘船、B25 供應與發展牌、規則版本 sf-2025.3', () => {
    const profile = getProfile(PROFILE)!;
    expect(profile).toMatchObject({ victoryTarget: 13, implemented: true, enabled: true, islandBonus: { points: 2, skip: 'home' } });
    expect(profile.pieces.ships).toBe(15);
    for (const players of [3, 4] as const) {
      const { state } = four(players);
      expect(state.bank.ore).toBe(19);
      expect(state.devDeck).toHaveLength(25);
      expect(state.engineVersion).toBe('sf-2025.3');
    }
  });

  it('只接受 3、4 人', () => {
    const base = { expansions: ['seafarers'], scenario: 'four-islands', variants: [], setupMode: 'fixed' as const };
    for (const playerCount of [3, 4]) expect(resolveCombination({ ...base, playerCount })).toMatchObject({ ok: true });
    for (const playerCount of [2, 5, 6]) expect(resolveCombination({ ...base, playerCount })).toEqual({ ok: false, reason: 'bad-player-count' });
  });
});

/** 依序為每個設置步驟挑「只碰到指定島」的第一個合法交叉點，路用第一個合法的邊。 */
function setupOnIslands(state: GameState, islands: readonly number[]): GameState {
  let current = state;
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

describe('SFX-S2 設置、home 與島嶼獎勵', () => {
  it('設置時任何島的交叉點都合法（New Shores 才限主島）', () => {
    for (const players of [3, 4] as const) {
      const { state } = four(players);
      const legal = new Set(legalBuildingVertices(state, 'p1', { setup: true }).flatMap((vertex) => islandsAt(state, vertex)));
      expect([...legal].sort()).toEqual([2, 3, 4, 5]);
    }
  });

  it('兩個起始村落可放在兩座不同的島，也可放在同一座；設置不計分，結束時記 home', () => {
    const { state } = four(3);
    // 順序 p1 p2 p3 p3 p2 p1：p1 在 2 與 5、p2 在 3 與 5、p3 兩個都在 4。
    const done = setupOnIslands(state, [2, 3, 4, 4, 5, 5]);
    expect(done.turn.phase).not.toBe('setup');
    const home = (projectGame(done, 'p1').modules!.seafarers as { home?: Record<string, number[]> }).home;
    expect(home).toEqual({ p1: [2, 5], p2: [3, 5], p3: [4] });
    for (const player of done.players) {
      expect(player.bonusPoints).toBe(0);
      expect(scoreOf(done, player.id, { includeHidden: true })).toBe(2);
    }
    expect(done.log.some((event) => event.type === 'island.bonus')).toBe(false);
  });

  it('home 不得分；非 home 島每位玩家各算各的，同島第二個村落不重複', () => {
    const done = setupOnIslands(four(3).state, [2, 3, 4, 4, 5, 5]);
    done.turn.seat = 0;
    done.turn.phase = 'action';
    done.windowId += 1;
    const bonus = (id: string) => done.players.find((p) => p.id === id)!.bonusPoints;
    const free = (island: number, n = 0): number =>
      done.board.buildings.flatMap((_b, vertex) => (!done.board.buildings[vertex] && islandsAt(done, vertex).length === 1 && islandsAt(done, vertex)[0] === island ? [vertex] : []))[n]!;
    const tick = (): void => {
      // 任何一次棋盤變動都會結算；用 p1 蓋一條合法的路觸發。
      const edge = actionHints(done, 'p1').legalRoads[0]!;
      setHand(done, 'p1', { lumber: 1, brick: 1 });
      const next = act(done, 'p1', { type: 'build.road', edge }).state;
      Object.assign(done, next);
    };
    // p1 在自己的 home（2、5）再蓋：不得分
    settle(done, 'p1', free(2, 3));
    settle(done, 'p1', free(5, 3));
    tick();
    expect(bonus('p1')).toBe(0);
    // p1 在島 3（p2 的 home，但不是 p1 的）得分
    settle(done, 'p1', free(3, 0));
    tick();
    expect(bonus('p1')).toBe(2);
    // p2 在島 3 是 home：不得分；在島 2 得分
    settle(done, 'p2', free(3, 4));
    settle(done, 'p2', free(2, 6));
    tick();
    expect(bonus('p2')).toBe(2);
    // p3 沒有 home 在 3：即使 p1、p2 已在，仍得分
    settle(done, 'p3', free(3, 8));
    tick();
    expect(bonus('p3')).toBe(2);
    // 同一座非 home 島第二個村落：不重複
    settle(done, 'p1', free(3, 10));
    tick();
    expect(bonus('p1')).toBe(2);
    const claims = (projectGame(done, 'p1').modules!.seafarers as { islandClaims: { player: string; island: number }[] }).islandClaims;
    expect(claims.map(({ player, island }) => `${player}:${island}`).sort()).toEqual(['p1:3', 'p2:2', 'p3:3']);
  });

  it('13 分在自己回合勝利；12 分不勝', () => {
    const done = setupOnIslands(four(4).state, [2, 3, 4, 5, 5, 4, 3, 2]);
    done.turn.seat = 0;
    done.turn.phase = 'action';
    done.windowId += 1;
    expect(getProfile(done.profileId)!.victoryTarget).toBe(13);
    const spot = done.board.buildings.flatMap((_b, vertex) => (!done.board.buildings[vertex] && islandsAt(done, vertex).length === 1 && islandsAt(done, vertex)[0] === 4 ? [vertex] : []));
    const play = (bonusPoints: number) => {
      const state: GameState = JSON.parse(JSON.stringify(done));
      state.players[0]!.bonusPoints = bonusPoints;
      settle(state, 'p1', spot[5]!);
      setHand(state, 'p1', { lumber: 1, brick: 1 });
      const edge = actionHints(state, 'p1').legalRoads[0]!;
      const outcome = applyCommand(state, 'p1', { type: 'build.road', edge }, seededRng(1));
      if (!outcome.ok) throw new Error(outcome.error.code);
      return outcome.state;
    };
    // 2 個起始村落 + 1 個 = 3 分；home 之外的島 4 是 p1 的 home（p1 在 2 與 5），所以島 4 的村落 +2。
    // 起始 3 + 村落已計 + 島 4 獎勵 2 = 5 + bonusPoints
    const win = play(8);
    expect(scoreOf(win, 'p1', { includeHidden: true })).toBe(13);
    expect(win.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
    const short = play(7);
    expect(scoreOf(short, 'p1', { includeHidden: true })).toBe(12);
    expect(short.result).toBeNull();
  });
});

describe('SFX-S2 VP 標記供應（SF25 pp. 6–7：3 人 18、4 人 24）', () => {
  it('每位玩家最多 3 座非 home 島 × 2 分 = 6，全桌剛好不超過供應', () => {
    const supply = { 3: 18, 4: 24 } as const;
    for (const players of [3, 4] as const) {
      const { state } = four(players);
      const islands = new Set(state.board.layout.islands.filter((island) => island > 0));
      expect(islands.size).toBe(4);
      const points = getProfile(PROFILE)!.islandBonus!.points;
      // 引擎沒有標記供應上限；每人每座島只記一次，且至少有一座 home，上限即 (島數 - 1) × 分數。
      const perPlayer = (islands.size - 1) * points;
      expect(perPlayer).toBe(6);
      expect(perPlayer * players).toBe(supply[players]);
    }
  });

  it('模擬整局後每位玩家的島嶼獎勵不超過 6，全桌不超過供應', () => {
    for (const [players, supply] of [[3, 18], [4, 24]] as const) {
      const run = simulateSeafarers(players, 40 + players, 30000, PROFILE);
      // 不能空洞通過：每局都要真的完賽，且至少有一次島嶼獎勵。
      expect(run.state.result?.reason).toBe('victory');
      expect(run.islandBonuses).toBeGreaterThan(0);
      const claims = Object.values((run.state.moduleState as unknown as { seafarers: { islands: Record<string, number[]> } }).seafarers.islands);
      expect(claims.every((list) => list.length <= 3)).toBe(true);
      const bonus = run.state.players.reduce((sum, player) => sum + player.bonusPoints, 0);
      expect(bonus).toBeLessThanOrEqual(supply);
    }
  }, 120_000);
});

describe('SFX-S2 空盤工具', () => {
  it('emptySeafarersGame 可指定 profile', () => {
    const state = emptySeafarersGame(3, 0, 'action', PROFILE);
    expect(state.board.layout.topologyId).toBe('sf-four-islands-3');
  });
});
