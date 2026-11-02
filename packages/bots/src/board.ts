/**
 * 由公開投影推導的盤面模型：點數、產能、港口、距離規則與道路搜尋。
 * 只使用 `GameView` 與公開拓樸，不接觸任何隱藏資訊。
 */

import {
  getTopology,
  RESOURCES,
  requireProfile,
  TERRAIN_RESOURCE,
  verticesOfHex,
  type BoardTopology,
  type GameView,
  type HarborType,
  type ProfileDefinition,
  type Resource,
  type Terrain,
} from '@catan/rules';

export type Yield = Record<Resource, number>;

export function emptyYield(): Yield {
  return { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}

export function yieldTotal(value: Yield): number {
  return RESOURCES.reduce((sum, resource) => sum + value[resource], 0);
}

/** 骰出該數字的組合數：2 與 12 為 1，6 與 8 為 5。 */
export function pipsOf(number: number | null | undefined): number {
  if (number === null || number === undefined) return 0;
  return Math.max(0, 6 - Math.abs(7 - number));
}

export interface BoardModel {
  readonly view: GameView;
  readonly selfId: string;
  readonly topo: BoardTopology;
  readonly profile: ProfileDefinition;
  readonly neighbors: readonly (readonly number[])[];
  readonly hexVertices: readonly (readonly number[])[];
  readonly hexPips: readonly number[];
  readonly hexResource: readonly (Resource | null)[];
  readonly harborAt: readonly (HarborType | null)[];
}

interface TopologyTables {
  neighbors: number[][];
  hexVertices: number[][];
}

// 拓樸是由 id 決定的純幾何資料，快取它不影響決策的決定性。
const tableCache = new WeakMap<BoardTopology, TopologyTables>();

function topologyTables(topo: BoardTopology): TopologyTables {
  let tables = tableCache.get(topo);
  if (!tables) {
    tables = {
      neighbors: topo.vertices.map((info, vertex) =>
        info.edges.map((edge) => {
          const [a, b] = topo.edges[edge]!.vertices;
          return a === vertex ? b : a;
        }),
      ),
      hexVertices: topo.hexes.map((_, hex) => verticesOfHex(topo, hex)),
    };
    tableCache.set(topo, tables);
  }
  return tables;
}

export function boardModel(view: GameView, selfId: string): BoardModel {
  const topo = getTopology(view.board.topologyId);
  const tables = topologyTables(topo);
  const harborAt: (HarborType | null)[] = topo.vertices.map(() => null);
  for (const harbor of view.board.harbors) {
    const edge = topo.edges[harbor.edge];
    if (!edge) continue;
    for (const vertex of edge.vertices) harborAt[vertex] = harbor.type as HarborType;
  }
  return {
    view,
    selfId,
    topo,
    profile: requireProfile(view.profileId),
    neighbors: tables.neighbors,
    hexVertices: tables.hexVertices,
    hexPips: view.board.numbers.map((number) => pipsOf(number)),
    hexResource: view.board.terrain.map((terrain) => TERRAIN_RESOURCE[terrain as Terrain] ?? null),
    harborAt,
  };
}

/** 空點且相鄰路口都沒有建築（距離規則）。 */
export function isFreeSpot(model: BoardModel, vertex: number): boolean {
  const buildings = model.view.board.buildings;
  if (buildings[vertex]) return false;
  return model.neighbors[vertex]!.every((neighbor) => !buildings[neighbor]);
}

/** 單一路口的點數產能；`blockedHex` 指定的格子（強盜）不計。 */
export function vertexYield(model: BoardModel, vertex: number, blockedHex: number | null = null): Yield {
  const out = emptyYield();
  for (const hex of model.topo.vertices[vertex]!.hexes) {
    if (hex === blockedHex) continue;
    const resource = model.hexResource[hex];
    if (resource) out[resource] += model.hexPips[hex]!;
  }
  return out;
}

/** 玩家所有建築的點數產能（城市加倍）；預設排除強盜所在格。 */
export function playerYield(model: BoardModel, playerId: string, ignoreRobber = false): Yield {
  const out = emptyYield();
  const blocked = ignoreRobber ? null : model.view.board.robber;
  model.view.board.buildings.forEach((building, vertex) => {
    if (!building || building.player !== playerId) return;
    const factor = building.city ? 2 : 1;
    const single = vertexYield(model, vertex, blocked);
    for (const resource of RESOURCES) out[resource] += single[resource] * factor;
  });
  return out;
}

export interface PieceCounts {
  settlements: number;
  cities: number;
  roads: number;
}

export function piecesOnBoard(model: BoardModel, playerId: string): PieceCounts {
  const counts: PieceCounts = { settlements: 0, cities: 0, roads: 0 };
  for (const building of model.view.board.buildings) {
    if (!building || building.player !== playerId) continue;
    if (building.city) counts.cities += 1;
    else counts.settlements += 1;
  }
  for (const road of model.view.board.roads) {
    if (road && road.player === playerId && !road.ship) counts.roads += 1;
  }
  return counts;
}

export function piecesLeft(model: BoardModel, playerId: string): PieceCounts {
  const used = piecesOnBoard(model, playerId);
  return {
    settlements: model.profile.pieces.settlements - used.settlements,
    cities: model.profile.pieces.cities - used.cities,
    roads: model.profile.pieces.roads - used.roads,
  };
}

function opponentAt(model: BoardModel, vertex: number, playerId: string): boolean {
  const building = model.view.board.buildings[vertex];
  return !!building && building.player !== playerId;
}

export interface RoadSearch {
  /** 從自己的道路網到各路口還需要幾條新道路；到不了為 Infinity。 */
  readonly distance: readonly number[];
  /** 到達該路口的路徑上，最後一條新道路。 */
  readonly viaEdge: readonly number[];
  readonly viaVertex: readonly number[];
}

/**
 * 以 BFS 計算自己的道路網延伸到各路口的成本。與標準規則一致：對手建築會
 * 切斷穿越的路口，但己方道路仍可從未被切斷的一端繼續延伸。
 */
export function searchRoads(model: BoardModel, playerId: string, maxDepth: number): RoadSearch {
  const { topo } = model;
  const { buildings, roads } = model.view.board;
  const distance = topo.vertices.map(() => Infinity);
  const viaEdge = topo.vertices.map(() => -1);
  const viaVertex = topo.vertices.map(() => -1);
  const queue: number[] = [];
  const start = (vertex: number): void => {
    if (distance[vertex] === 0 || opponentAt(model, vertex, playerId)) return;
    distance[vertex] = 0;
    queue.push(vertex);
  };
  buildings.forEach((building, vertex) => {
    if (building && building.player === playerId) start(vertex);
  });
  roads.forEach((road, edge) => {
    if (!road || road.player !== playerId) return;
    for (const vertex of topo.edges[edge]!.vertices) start(vertex);
  });
  for (let head = 0; head < queue.length; head++) {
    const vertex = queue[head]!;
    const depth = distance[vertex]!;
    if (depth >= maxDepth) continue;
    for (const edge of topo.vertices[vertex]!.edges) {
      if (roads[edge]) continue;
      const [a, b] = topo.edges[edge]!.vertices;
      const next = a === vertex ? b : a;
      if (distance[next] !== Infinity || opponentAt(model, next, playerId)) continue;
      distance[next] = depth + 1;
      viaEdge[next] = edge;
      viaVertex[next] = vertex;
      queue.push(next);
    }
  }
  return { distance, viaEdge, viaVertex };
}

/** 依 BFS 結果還原到某路口需要新建的道路，從道路網端開始排列。 */
export function roadPath(search: RoadSearch, vertex: number): number[] {
  const path: number[] = [];
  let cursor = vertex;
  while (search.distance[cursor]! > 0 && search.viaEdge[cursor]! >= 0) {
    path.push(search.viaEdge[cursor]!);
    cursor = search.viaVertex[cursor]!;
  }
  return path.reverse();
}

/**
 * 玩家的最長道路長度（可額外假設幾條新道路）。對手建築會切斷路線，與規則
 * 引擎的計算方式一致。
 */
export function routeLength(model: BoardModel, playerId: string, extraEdges: readonly number[] = []): number {
  const { topo } = model;
  const incident = new Map<number, number[]>();
  const add = (edge: number): void => {
    for (const vertex of topo.edges[edge]!.vertices) {
      const list = incident.get(vertex) ?? [];
      list.push(edge);
      incident.set(vertex, list);
    }
  };
  model.view.board.roads.forEach((road, edge) => {
    if (road && road.player === playerId && !road.ship) add(edge);
  });
  for (const edge of extraEdges) add(edge);
  if (incident.size === 0) return 0;
  const used = new Set<number>();
  const walk = (vertex: number): number => {
    let best = 0;
    for (const edge of incident.get(vertex) ?? []) {
      if (used.has(edge)) continue;
      const [a, b] = topo.edges[edge]!.vertices;
      const next = a === vertex ? b : a;
      used.add(edge);
      const length = 1 + (opponentAt(model, next, playerId) ? 0 : walk(next));
      used.delete(edge);
      if (length > best) best = length;
    }
    return best;
  };
  let longest = 0;
  for (const vertex of incident.keys()) {
    if (opponentAt(model, vertex, playerId)) continue;
    longest = Math.max(longest, walk(vertex));
  }
  return longest;
}
