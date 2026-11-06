/**
 * B-POLICY-SEA（SF 計畫 §6.1）：`sea.ts` 的海域模型與 rules 不漂移。
 *
 * 取樣：`simulateSeafarers(n, seed, 1500)` 的終盤（3–6 人 × 種子 1、2），每位玩家都強制成行動者，
 * 比對 `sea.ts` 算出的船位與道路位置和 hints，以及含船的路線長度和 rules 的 `longestRouteLength`。
 * 另外驗證 base 上的修正（G7–G11）是 no-op、在 Seafarers 盤面上確實生效，以及船 BFS 的路徑
 * 確實逐艘可造。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  getTopology,
  isLandEdge as rulesIsLandEdge,
  isSeaEdge as rulesIsSeaEdge,
  longestRouteLength,
  projectGame,
  type GameState,
  type GameView,
} from '@catan/rules';
import { forceTurn, newGame } from '../../rules/test/helpers.ts';
import { corner, emptySeafarersGame, road, seafarersGame, settle, ship, side } from '../../rules/test/seafarers-helpers.ts';
import { simulateSeafarers } from '../../rules/test/seafarers-sim.ts';
import {
  boardModel,
  isFreeSpot,
  isLandEdge,
  roadPath,
  routeLength,
  searchRoads,
  type BoardModel,
  type RoadSearch,
} from '../src/board.ts';
import { moduleHints, moduleView } from '../src/modules/view.ts';
import {
  coastVertices,
  isSeaEdge,
  islandOfVertex,
  islandsAt,
  roadEdgesFrom,
  roadEdgesOf,
  searchShips,
  shipEdgesFrom,
  shipEdgesOf,
  shipsLeft,
  shipsOnBoard,
} from '../src/sea.ts';

// 整局模擬在忙碌的機器上會超過預設的 5 秒。
const SIM_TIMEOUT = 120_000;

/** 本套件不載入 DOM／Node 型別，沒有 structuredClone；狀態與 view 都是純 JSON。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

/** 把回合強制給某個座位的行動階段：沒有 pending、新的行動視窗（hints 會給這位玩家）。 */
function asActor(state: GameState, seat: number): GameState {
  const copy = clone(state);
  copy.result = null;
  forceTurn(copy, seat, 'action');
  copy.windowId += 1;
  return copy;
}

/** 同一局只模擬一次：兩組比對共用終盤。 */
const finals = new Map<string, GameState>();
function finalState(players: 3 | 4 | 5 | 6, seed: number): GameState {
  const key = `${players}:${seed}`;
  let state = finals.get(key);
  if (!state) {
    state = simulateSeafarers(players, seed, 1500).state;
    finals.set(key, state);
  }
  return state;
}

/** 這位玩家此刻可以移動的船（hints 的 `movableShips`）。 */
const moveHints = (view: GameView) => moduleHints(view.hints, 'seafarers')?.movableShips ?? [];

const sorted = (edges: readonly number[]): number[] => edges.slice().sort((a, b) => a - b);

/** 各項比對實際執行了幾次；最後一個 it 確認取樣不是空轉。 */
const coverage = {
  actors: 0,
  shipEdges: 0,
  roadEdges: 0,
  movable: 0,
  routes: 0,
  shipRoutes: 0,
  paths: 0,
  movingSearches: 0,
  movingDropsAStart: 0,
};

/** 獨立推導的船 BFS 起點：自己的建築，與（扣掉 `moving` 的）自己的船的兩端；對手的建築擋住的不算。 */
function expectedStarts(model: BoardModel, playerId: string, moving?: number): number[] {
  const { buildings, roads } = model.view.board;
  const starts = new Set<number>();
  buildings.forEach((building, vertex) => {
    if (building?.player === playerId) starts.add(vertex);
  });
  roads.forEach((road, edge) => {
    if (edge === moving || !road?.ship || road.player !== playerId) return;
    for (const vertex of model.topo.edges[edge]!.vertices) {
      const building = buildings[vertex];
      if (!building || building.player === playerId) starts.add(vertex);
    }
  });
  return [...starts].sort((a, b) => a - b);
}

const zeroOf = (search: RoadSearch): number[] =>
  search.distance.flatMap((distance, vertex) => (distance === 0 ? [vertex] : []));

describe('B-POLICY-SEA: sea.ts equals rules on whole games', () => {
  const cases = ([3, 4, 5, 6] as const).flatMap((players) => ([1, 2] as const).map((seed) => [players, seed] as const));

  it.each(cases)(
    '%i players, seed %i: ship edges, road edges, movable ship targets and route lengths',
    (players, seed) => {
      const state = finalState(players, seed);
      for (const [seat, player] of state.players.entries()) {
        const forced = asActor(state, seat);
        const view = viewOf(forced, player.id);
        const hints = moduleHints(view.hints, 'seafarers')!;
        const model = boardModel(view, player.id);
        coverage.actors += 1;

        // 船位：legalShips 已扣棋子存量，模型本身不扣。
        const ships = shipEdgesFrom(view, player.id);
        expect(sorted(ships), `${player.id} ship edges`).toEqual(shipsLeft(model) > 0 ? hints.legalShips : []);
        expect(shipsLeft(model)).toBe(model.profile.pieces.ships - shipsOnBoard(model));
        coverage.shipEdges += ships.length;

        // 道路位置：legalRoads 同樣不扣存量，兩邊都沒有。
        const roads = roadEdgesFrom(view, player.id);
        expect(roads, `${player.id} road edges`).toEqual(view.hints!.legalRoads);
        coverage.roadEdges += roads.length;

        // 移船目標：每艘可移動的船，目標等於把那艘船視為不在之後的船位。
        for (const movable of hints.movableShips) {
          expect(shipEdgesFrom(view, player.id, { moving: movable.edge }), `${player.id} moves ${movable.edge}`).toEqual(
            movable.targets,
          );
          coverage.movable += 1;
        }

        // 含船的路線長度：每位玩家（不只是行動者）都與 rules 相同。
        for (const other of forced.players) {
          const otherView = viewOf(forced, other.id);
          const length = routeLength(boardModel(otherView, other.id), other.id);
          expect(length, `${other.id} route`).toBe(longestRouteLength(forced, other.id, true));
          expect(length, `${other.id} recorded route`).toBe(otherView.players.find((p) => p.id === other.id)!.longestRoadLength);
          coverage.routes += 1;
          if (forced.board.roads.some((r) => r?.ship && r.player === other.id)) coverage.shipRoutes += 1;
        }
      }
    },
    SIM_TIMEOUT,
  );

  it.each(cases)(
    '%i players, seed %i: every ship BFS path can be built ship by ship',
    (players, seed) => {
      const state = finalState(players, seed);
      for (const [seat, player] of state.players.entries()) {
        const forced = asActor(state, seat);
        const view = viewOf(forced, player.id);
        const model = boardModel(view, player.id);
        const search = searchShips(model, player.id, 3);
        const legal = new Set(shipEdgesOf(model));

        // 一步可達的路口，恰好是合法船位的另一端；第一步的邊一定是合法船位。
        // 對手建築的路口除外：船接得上去，但不能穿越，BFS 不走進去。
        const oneStep = new Set<number>();
        for (const edge of legal) {
          for (const vertex of model.topo.edges[edge]!.vertices) {
            const building = view.board.buildings[vertex];
            if (!building || building.player === player.id) oneStep.add(vertex);
          }
        }
        model.topo.vertices.forEach((_, vertex) => {
          if (search.distance[vertex] === 1) {
            expect(oneStep.has(vertex), `${player.id} vertex ${vertex}`).toBe(true);
            expect(legal.has(search.viaEdge[vertex]!)).toBe(true);
          }
          if (oneStep.has(vertex)) expect(search.distance[vertex]!).toBeLessThanOrEqual(1);
        });

        // 較遠的路口：沿路徑逐艘放下，下一艘都在當下的 legalShips 內（船數存量足夠時）。
        const far = model.topo.vertices
          .map((_, vertex) => vertex)
          .filter((vertex) => search.distance[vertex]! >= 2 && Number.isFinite(search.distance[vertex]!))
          .sort((a, b) => search.distance[b]! - search.distance[a]! || a - b)
          .slice(0, 3);
        for (const vertex of far) {
          const path = roadPath(search, vertex);
          expect(path).toHaveLength(search.distance[vertex]!);
          if (shipsLeft(model) < path.length) continue;
          const replay = clone(forced);
          for (const edge of path) {
            const next = moduleHints(viewOf(replay, player.id).hints, 'seafarers')!;
            expect(next.legalShips, `${player.id} path to ${vertex}`).toContain(edge);
            replay.board.roads[edge] = { player: player.id, ship: true };
          }
          coverage.paths += 1;
        }
      }
    },
    SIM_TIMEOUT,
  );

  it.each(cases)(
    '%i players, seed %i: ship search for a ship being moved starts without the moved ship',
    (players, seed) => {
      const state = finalState(players, seed);
      for (const [seat, player] of state.players.entries()) {
        const forced = asActor(state, seat);
        const view = viewOf(forced, player.id);
        const model = boardModel(view, player.id);
        const { buildings } = view.board;
        const plain = searchShips(model, player.id, 1);
        // 不帶 moving：起點就是建築與船的兩端；{} 與 { moving: undefined } 結果相同。
        expect(zeroOf(plain), `${player.id} plain starts`).toEqual(expectedStarts(model, player.id));
        expect(searchShips(model, player.id, 1, {})).toEqual(plain);
        expect(searchShips(model, player.id, 1, { moving: undefined })).toEqual(plain);

        for (const movable of moveHints(view)) {
          const search = searchShips(model, player.id, 1, { moving: movable.edge });
          coverage.movingSearches += 1;
          expect(zeroOf(search), `${player.id} moving ${movable.edge}`).toEqual(expectedStarts(model, player.id, movable.edge));

          // 規則要求移動的船有一端既沒有自己的建築、也沒有別的自己的船：這一端不再是起點。
          const lonely = model.topo.edges[movable.edge]!.vertices.filter((vertex) => {
            if (buildings[vertex]?.player === player.id) return false;
            return !model.topo.vertices[vertex]!.edges.some((edge) => {
              const road = view.board.roads[edge];
              return edge !== movable.edge && !!road && road.ship && road.player === player.id;
            });
          });
          expect(lonely.length, `${player.id} ${movable.edge} has an open end`).toBeGreaterThan(0);
          for (const vertex of lonely) {
            // 對手的建築擋住的末端本來就不是起點。
            const walled = !!buildings[vertex] && buildings[vertex]!.player !== player.id;
            expect(plain.distance[vertex], `${player.id} ${vertex} starts while the ship stays`).toBe(walled ? Infinity : 0);
            expect(search.distance[vertex], `${player.id} ${vertex} cannot start from the moving ship`).not.toBe(0);
            if (!walled) coverage.movingDropsAStart += 1;
          }

          // 走訪不經過被移的那條邊；第一步的邊都是合法的移船目標，一步可達的路口就是目標的另一端。
          const targets = new Set(movable.targets);
          const oneStep = new Set<number>();
          for (const edge of targets) {
            for (const vertex of model.topo.edges[edge]!.vertices) {
              const building = buildings[vertex];
              if (!building || building.player === player.id) oneStep.add(vertex);
            }
          }
          search.distance.forEach((distance, vertex) => {
            if (distance === 1) {
              expect(search.viaEdge[vertex]).not.toBe(movable.edge);
              expect(targets.has(search.viaEdge[vertex]!), `${player.id} step to ${vertex}`).toBe(true);
            }
            if (oneStep.has(vertex)) expect(distance).toBeLessThanOrEqual(1);
          });
        }
      }
    },
    SIM_TIMEOUT,
  );

  it('the samples were not vacuous', () => {
    expect(coverage.actors).toBe(2 * (3 + 4 + 5 + 6));
    expect(coverage.shipEdges).toBeGreaterThan(100);
    expect(coverage.roadEdges).toBeGreaterThan(100);
    expect(coverage.movable).toBeGreaterThan(0);
    expect(coverage.shipRoutes).toBeGreaterThan(10);
    expect(coverage.paths).toBeGreaterThan(5);
    expect(coverage.movingSearches).toBeGreaterThan(0);
    expect(coverage.movingDropsAStart).toBeGreaterThan(0);
  });
});

describe('geometry predicates', () => {
  it('match rules on every edge of the New Shores board', () => {
    const { state } = seafarersGame(4);
    const view = viewOf(state, 'p1');
    const model = boardModel(view, 'p1');
    for (let edge = 0; edge < model.topo.edges.length; edge++) {
      expect(isLandEdge(model, edge), `land edge ${edge}`).toBe(rulesIsLandEdge(state, edge));
      expect(isSeaEdge(model, edge), `sea edge ${edge}`).toBe(rulesIsSeaEdge(state, edge));
    }
  });

  it('knows the islands and the coast', () => {
    const { state } = seafarersGame(4);
    const model = boardModel(viewOf(state, 'p1'), 'p1');
    // 開局的合法聚落都在主島上；k5 在東北方的小島，海中央的路口不屬於任何島。
    for (const vertex of viewOf(state, 'p1').hints!.legalSettlements) expect(islandOfVertex(model, vertex)).toBe(1);
    const k = (n: number) => corner(state, 2, 0, n);
    expect(islandOfVertex(model, k(3))).toBe(1);
    const small = islandOfVertex(model, k(5));
    expect(small).not.toBeNull();
    expect(small).toBeGreaterThan(1);
    expect(islandsAt(model, k(5))).toEqual([small]);
    expect(islandOfVertex(model, corner(state, 2, -3, 4))).toBeNull();
    expect(islandsAt(model, corner(state, 2, -3, 4))).toEqual([]);
    // 海岸：鄰接陸地、而且有海邊的路口；內陸與海中央都不是。
    const coast = coastVertices(model);
    expect(coast).toEqual(sorted(coast));
    expect(coast).toContain(k(3));
    expect(coast).not.toContain(corner(state, 0, 0, 1));
    expect(coast).not.toContain(corner(state, 2, -3, 4));
  });

  it('are no-ops on a base board: all land, no gold, every edge a land edge', () => {
    const { state } = newGame({ players: 4 });
    const model = boardModel(viewOf(state, 'p1'), 'p1');
    expect(model.hexLand.every(Boolean)).toBe(true);
    expect(model.hexGold.some(Boolean)).toBe(false);
    for (let edge = 0; edge < model.topo.edges.length; edge++) expect(isLandEdge(model, edge)).toBe(true);
    for (let vertex = 0; vertex < model.topo.vertices.length; vertex++) {
      expect(model.topo.vertices[vertex]!.hexes.length).toBeGreaterThan(0);
    }
  });

  it('recognise gold fields', () => {
    const { state } = seafarersGame(4);
    const model = boardModel(viewOf(state, 'p1'), 'p1');
    const gold = state.board.layout.terrain.flatMap((terrain, hex) => (terrain === 'gold' ? [hex] : []));
    expect(gold.length).toBeGreaterThan(0);
    expect(model.hexGold.flatMap((isGold, hex) => (isGold ? [hex] : []))).toEqual(gold);
    for (const hex of gold) {
      expect(model.hexLand[hex]).toBe(true);
      expect(model.hexResource[hex]).toBeNull();
    }
  });
});

describe('road search on a Seafarers board (G7, G8)', () => {
  const ring = (state: GameState) => ({
    k3: corner(state, 2, 0, 3),
    k4: corner(state, 2, 0, 4),
    NW: side(state, 2, 0, 2),
    E1: side(state, 1, 0, 1),
  });

  it('never crosses a sea-only edge, and a ship end is not a road start', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    const r = ring(state);
    settle(state, 'p1', r.k3);
    const viewNoShip = viewOf(state, 'p1');
    const modelNoShip = boardModel(viewNoShip, 'p1');
    expect(isLandEdge(modelNoShip, r.NW)).toBe(false);
    const search = searchRoads(modelNoShip, 'p1', 3);
    // k4 只隔著一條海邊：道路到不了；所有走得到的路口都是經由陸地邊。
    expect(search.distance[r.k4]).toBe(Infinity);
    let reached = 0;
    search.distance.forEach((distance, vertex) => {
      if (!(distance > 0) || distance === Infinity) return;
      reached += 1;
      expect(isLandEdge(modelNoShip, search.viaEdge[vertex]!), `vertex ${vertex}`).toBe(true);
    });
    expect(reached).toBeGreaterThan(0);

    // 船的另一端不是道路的起點：結果與沒有船時相同。
    ship(state, 'p1', r.NW);
    const withShip = boardModel(viewOf(state, 'p1'), 'p1');
    expect(searchRoads(withShip, 'p1', 3)).toEqual(search);
  });

  it('an empty sea vertex is not a free spot', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    const model = boardModel(viewOf(state, 'p1'), 'p1');
    const open = corner(state, 2, -3, 4); // 周圍全是海
    expect(model.view.board.buildings[open]).toBeNull();
    expect(isFreeSpot(model, open)).toBe(false);
    expect(isFreeSpot(model, corner(state, 2, 0, 3))).toBe(true);
    settle(state, 'p2', corner(state, 2, 0, 3));
    const crowded = boardModel(viewOf(state, 'p1'), 'p1');
    expect(isFreeSpot(crowded, corner(state, 2, 0, 3))).toBe(false);
  });
});

describe('route length with ships (G11)', () => {
  const lengths = (state: GameState, playerId: string, extraEdges: number[] = [], extraShips: number[] = []) => ({
    bot: routeLength(boardModel(viewOf(state, playerId), playerId), playerId, extraEdges, extraShips),
    rules: longestRouteLength(state, playerId, true),
  });

  it('joins a ship and a road only at an own building', () => {
    const k3 = (s: GameState) => corner(s, 2, 0, 3);
    const NW = (s: GameState) => side(s, 2, 0, 2);
    const E1 = (s: GameState) => side(s, 1, 0, 1);

    const joined = emptySeafarersGame(4, 0, 'action');
    settle(joined, 'p1', k3(joined));
    ship(joined, 'p1', NW(joined));
    road(joined, 'p1', E1(joined));
    expect(lengths(joined, 'p1')).toEqual({ bot: 2, rules: 2 });

    const unjoined = emptySeafarersGame(4, 0, 'action');
    ship(unjoined, 'p1', NW(unjoined));
    road(unjoined, 'p1', E1(unjoined));
    expect(lengths(unjoined, 'p1')).toEqual({ bot: 1, rules: 1 });

    const cut = emptySeafarersGame(4, 0, 'action');
    settle(cut, 'p2', k3(cut));
    ship(cut, 'p1', NW(cut));
    road(cut, 'p1', E1(cut));
    expect(lengths(cut, 'p1')).toEqual({ bot: 1, rules: 1 });
  });

  it('counts planned roads and planned ships', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    const k3 = corner(state, 2, 0, 3);
    const NW = side(state, 2, 0, 2);
    const W = side(state, 2, 0, 3);
    const E1 = side(state, 1, 0, 1);
    settle(state, 'p1', k3);
    ship(state, 'p1', NW);
    const model = boardModel(viewOf(state, 'p1'), 'p1');
    expect(routeLength(model, 'p1')).toBe(1);
    // 計畫中的一艘船（W 接在自己的建築上）與一條路。
    const withShip = clone(state);
    ship(withShip, 'p1', W);
    expect(routeLength(model, 'p1', [], [W])).toBe(longestRouteLength(withShip, 'p1', true));
    expect(routeLength(model, 'p1', [], [W])).toBe(2);
    const withRoad = clone(state);
    road(withRoad, 'p1', E1);
    expect(routeLength(model, 'p1', [E1])).toBe(longestRouteLength(withRoad, 'p1', true));
    expect(routeLength(model, 'p1', [E1])).toBe(2);
  });

  it('ignores ships when the profile does not count them', () => {
    const { state } = newGame({ players: 4 });
    const topo = getTopology(state.board.layout.topologyId);
    const vertex = topo.vertices.findIndex((info) => info.edges.length === 3);
    const [a, b] = topo.vertices[vertex]!.edges as [number, number];
    settle(state, 'p1', vertex);
    road(state, 'p1', a);
    ship(state, 'p1', b); // base 沒有船；若出現也不計入
    const model = boardModel(viewOf(state, 'p1'), 'p1');
    expect(model.profile.longestRouteIncludesShips).toBe(false);
    expect(routeLength(model, 'p1')).toBe(longestRouteLength(state, 'p1', false));
    expect(routeLength(model, 'p1')).toBe(1);
  });
});

describe('ship search', () => {
  it('starts from buildings and own ships, avoids the pirate and opponent buildings', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    state.board.pirate = null;
    const k3 = corner(state, 2, 0, 3);
    const k4 = corner(state, 2, 0, 4);
    const NW = side(state, 2, 0, 2);
    settle(state, 'p1', k3);
    const open = boardModel(viewOf(state, 'p1'), 'p1');
    const search = searchShips(open, 'p1', 2);
    expect(search.distance[k3]).toBe(0);
    expect(search.distance[k4]).toBe(1);
    expect(search.viaEdge[k4]).toBe(NW);
    expect(search.viaVertex[k4]).toBe(k3);
    expect(roadPath(search, k4)).toEqual([NW]);

    // 對手的建築擋住船：到不了，也不能穿越。
    const blocked = clone(state);
    settle(blocked, 'p2', k4);
    const stopped = searchShips(boardModel(viewOf(blocked, 'p1'), 'p1'), 'p1', 3);
    expect(stopped.distance[k4]).toBe(Infinity);

    // blocker 掛點：別人的棋子擋住路口，自己的不擋；預設不擋。
    const byKnight = searchShips(open, 'p1', 3, { blocker: (vertex) => (vertex === k4 ? 'p2' : null) });
    expect(byKnight.distance[k4]).toBe(Infinity);
    const own = searchShips(open, 'p1', 3, { blocker: (vertex) => (vertex === k4 ? 'p1' : null) });
    expect(own.distance[k4]).toBe(1);
    expect(shipEdgesOf(open)).toContain(NW);
    expect(shipEdgesOf(open, 'p1', { blocker: (vertex) => (vertex === k4 ? 'p2' : null) })).toContain(NW); // k3 的建築仍可接
    expect(shipEdgesOf(open, 'p2')).toEqual([]);

    // 海盜所在 hex 的邊不能放船，BFS 也不走。
    const piracy = clone(state);
    piracy.board.pirate = topoHexTouching(piracy, NW);
    const blockedByPirate = boardModel(viewOf(piracy, 'p1'), 'p1');
    expect(shipEdgesOf(blockedByPirate)).not.toContain(NW);
    expect(searchShips(blockedByPirate, 'p1', 1).distance[k4]).toBe(Infinity);
  });

  it('breaks ties by the lowest edge index and is deterministic', () => {
    const { state } = seafarersGame(4);
    for (const playerId of ['p1', 'p2']) {
      const model = boardModel(viewOf(state, playerId), playerId);
      const again = boardModel(viewOf(clone(state), playerId), playerId);
      expect(searchShips(model, playerId, 4)).toEqual(searchShips(again, playerId, 4));
    }
    // 兩座建築各有一條路到同一個路口：取 edge index 較小的那條。
    const board = emptySeafarersGame(4, 0, 'action');
    board.board.pirate = null;
    const topo = getTopology(board.board.layout.topologyId);
    const target = topo.vertices.findIndex(
      (info) => info.edges.filter((edge) => rulesIsSeaEdge(board, edge)).length === 3,
    );
    expect(target).toBeGreaterThanOrEqual(0);
    const neighbours = topo.vertices[target]!.edges.map((edge) => {
      const [a, b] = topo.edges[edge]!.vertices;
      return { edge, from: a === target ? b : a };
    });
    for (const { from } of neighbours) settle(board, 'p1', from);
    const model = boardModel(viewOf(board, 'p1'), 'p1');
    const search = searchShips(model, 'p1', 1);
    expect(search.distance[target]).toBe(1);
    expect(search.viaEdge[target]).toBe(Math.min(...neighbours.map((n) => n.edge)));
  });
});

describe('ship search with a ship being moved', () => {
  /** p1 的聚落在 k3，船鏈沿著海環 (2,0) 往東：NW（k3–k4）、NE（k4–k5）、E（k5–k0），k0 是開放的末端。 */
  function ringChain(withSettlement = true) {
    const state = emptySeafarersGame(4, 0, 'action');
    state.board.pirate = null;
    const k = (n: number) => corner(state, 2, 0, n);
    const e = { NW: side(state, 2, 0, 2), NE: side(state, 2, 0, 1), E: side(state, 2, 0, 0) };
    if (withSettlement) settle(state, 'p1', k(3));
    for (const edge of Object.values(e)) ship(state, 'p1', edge);
    return { state, e, k3: k(3), k4: k(4), k5: k(5), k0: k(0) };
  }
  const modelOf = (state: GameState) => boardModel(viewOf(state, 'p1'), 'p1');

  it('without moving the result is unchanged: every building and ship end starts', () => {
    const { state, k3, k4, k5, k0 } = ringChain();
    const model = modelOf(state);
    const plain = searchShips(model, 'p1', 3);
    expect(zeroOf(plain)).toEqual([k3, k4, k5, k0].sort((a, b) => a - b));
    expect(searchShips(model, 'p1', 3, {})).toEqual(plain);
    expect(searchShips(model, 'p1', 3, { moving: undefined })).toEqual(plain);
    expect(zeroOf(plain)).toEqual(expectedStarts(model, 'p1'));
  });

  it('a lone ship that moves leaves no start behind', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    state.board.pirate = null;
    const NE = side(state, 2, 0, 1);
    ship(state, 'p1', NE);
    const model = modelOf(state);
    const [a, b] = model.topo.edges[NE]!.vertices;
    expect(zeroOf(searchShips(model, 'p1', 2)).sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y));
    const moved = searchShips(model, 'p1', 2, { moving: NE });
    expect(zeroOf(moved)).toEqual([]);
    expect(moved.distance.every((distance) => distance === Infinity)).toBe(true);
  });

  it('a settlement at one end keeps that end only', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    state.board.pirate = null;
    const NE = side(state, 2, 0, 1);
    const k4 = corner(state, 2, 0, 4);
    const k5 = corner(state, 2, 0, 5);
    settle(state, 'p1', k4);
    ship(state, 'p1', NE);
    const model = modelOf(state);
    expect(zeroOf(searchShips(model, 'p1', 2))).toEqual([k4, k5].sort((x, y) => x - y));
    const moved = searchShips(model, 'p1', 2, { moving: NE });
    expect(zeroOf(moved)).toEqual([k4]);
    // k5 只能繞過被移的邊才到得了，不再是距離 0；一艘船以內到不了（NE 本身不能放）。
    expect(searchShips(model, 'p1', 1, { moving: NE }).distance[k5]).toBe(Infinity);
    expect(moved.distance[k5]).toBeGreaterThan(0);
    expect(moved.viaEdge).not.toContain(NE);
  });

  it('the open end of a chain stops being a start, the connected ends stay', () => {
    const { state, e, k3, k4, k5, k0 } = ringChain();
    const model = modelOf(state);
    const moved = searchShips(model, 'p1', 3, { moving: e.E });
    expect(zeroOf(moved)).toEqual([k3, k4, k5].sort((a, b) => a - b));
    expect(moved.distance[k0]).toBeGreaterThan(0);
    expect(moved.viaEdge).not.toContain(e.E);
    // k0 的另一側繞路也到得了，但要新造船：不經過被移的邊。
    expect(searchShips(model, 'p1', 1, { moving: e.E }).distance[k0]).toBe(Infinity);
  });

  it('a ship in the middle or next to the settlement leaves every end connected', () => {
    const { state, e } = ringChain();
    const model = modelOf(state);
    const plain = searchShips(model, 'p1', 3);
    for (const edge of [e.NE, e.NW]) {
      const moved = searchShips(model, 'p1', 3, { moving: edge });
      expect(zeroOf(moved), `moving ${edge}`).toEqual(zeroOf(plain));
      expect(moved.viaEdge).not.toContain(edge);
      expect(zeroOf(moved)).toEqual(expectedStarts(model, 'p1', edge));
    }
  });

  it('a settlement joining the chain at the open end keeps it a start', () => {
    const { state, e, k0 } = ringChain();
    settle(state, 'p1', k0);
    const model = modelOf(state);
    expect(zeroOf(searchShips(model, 'p1', 2, { moving: e.E }))).toContain(k0);
  });

  it('the moved ship never lets the search or the placement model use its own edge', () => {
    const { state, e } = ringChain();
    const model = modelOf(state);
    for (const edge of Object.values(e)) {
      expect(shipEdgesOf(model, 'p1', { moving: edge })).not.toContain(edge);
      expect(searchShips(model, 'p1', Infinity, { moving: edge }).viaEdge).not.toContain(edge);
    }
    // 即使盤面上沒有那艘船（edge 是空的），moving 指定的邊也不能走。
    const bare = emptySeafarersGame(4, 0, 'action');
    bare.board.pirate = null;
    const k3 = corner(bare, 2, 0, 3);
    const NW = side(bare, 2, 0, 2);
    const k4 = corner(bare, 2, 0, 4);
    settle(bare, 'p1', k3);
    const bareModel = modelOf(bare);
    expect(searchShips(bareModel, 'p1', 1).distance[k4]).toBe(1);
    expect(searchShips(bareModel, 'p1', 1, { moving: NW }).distance[k4]).toBe(Infinity);
  });

  it('roads ignore moving: only the blocker matters', () => {
    const { state, e } = ringChain();
    const model = modelOf(state);
    expect(roadEdgesOf(model, 'p1')).toEqual(roadEdgesFrom(viewOf(state, 'p1'), 'p1'));
    // @ts-expect-error 移船不改變道路，道路的 options 沒有 moving
    expect(roadEdgesOf(model, 'p1', { moving: e.E })).toEqual(roadEdgesOf(model, 'p1'));
  });
});

describe('module accessors', () => {
  it('read the typed view and hints entry of an enabled module', () => {
    const { state } = seafarersGame(4);
    const view = viewOf(state, 'p1');
    expect(moduleView(view, 'seafarers')).toEqual(view.modules!.seafarers);
    expect(Object.keys(moduleView(view, 'seafarers')!)).toContain('islandBonus');
    expect(moduleHints(view.hints, 'seafarers')).toEqual(view.hints!.modules!.seafarers);
    expect(moduleHints(view.hints, 'seafarers')!.goldRequired).toBe(0);
  });

  it('return undefined for a missing or malformed entry', () => {
    const base = viewOf(newGame({ players: 4 }).state, 'p1');
    expect(moduleView(base, 'seafarers')).toBeUndefined();
    expect(moduleHints(base.hints, 'seafarers')).toBeUndefined();
    expect(moduleHints(undefined, 'seafarers')).toBeUndefined();
    expect(moduleView({}, 'seafarers')).toBeUndefined();
    expect(moduleView({ modules: { seafarers: 3 } }, 'seafarers')).toBeUndefined();
    expect(moduleView({ modules: { seafarers: null } }, 'seafarers')).toBeUndefined();
    // 原型鍵不是模組項目。
    expect(moduleView({ modules: Object.create({ seafarers: {} }) }, 'seafarers')).toBeUndefined();
  });
});

/** 與邊相鄰的第一個格子（測試用海盜位置：只要在這條邊上）。 */
function topoHexTouching(state: GameState, edge: number): number {
  const hex = getTopology(state.board.layout.topologyId).edges[edge]!.hexes.find(
    (candidate) => state.board.layout.terrain[candidate] === 'sea',
  );
  if (hex === undefined) throw new Error(`edge ${edge} touches no sea hex`);
  return hex;
}
