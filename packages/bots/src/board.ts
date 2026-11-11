/**
 * 由公開投影推導的盤面模型：點數、產能、港口、距離規則與道路搜尋。
 * 只使用 `GameView` 與公開拓樸，不接觸任何隱藏資訊。
 */

import {
  CARD_KINDS,
  getProfile,
  getTopology,
  RESOURCES,
  requireProfile,
  TERRAIN_RESOURCE,
  verticesOfHex,
  type BoardTopology,
  type CardKind,
  type Commodity,
  type GameView,
  type HarborType,
  type ProfileDefinition,
  type Resource,
  type Terrain,
} from '@catan/rules';
import type { BotModule } from './modules/types.ts';

/**
 * 各卡種的數量（點數、產能、權重、匯率都用它）。資源恆有值；commodity 只在模組讓它存在且非 0 時才寫入，
 * 讀取一律 `?? 0`，base 的物件形狀因此與只有資源時相同。
 */
export type Yield = Record<Resource, number> & Partial<Record<Commodity, number>>;

export function emptyYield(): Yield {
  return { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}

/** 只加五種資源的張數（不含 commodity）；用在只關心資源的盤面統計。 */
export function resourceTotal(value: Yield): number {
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
  /** 陸地格（沙漠與金礦也算）；海格為 false。base 沒有海格，全部為 true。 */
  readonly hexLand: readonly boolean[];
  /** 金礦格（Seafarers）：任何一張資源，不在 `hexResource` 內。base 全部為 false。 */
  readonly hexGold: readonly boolean[];
  readonly harborAt: readonly (HarborType | null)[];
  /**
   * 組合後的盤面掛點（各模組的 economy 鉤子，E-2）。只有至少一個模組提供對應鉤子時才存在；沒有傳入模組的
   * 模型（tracker、hard）與 base 完全相同。掛點在呼叫時收 model（不閉包綁住建模時的 view）：展開後換了 `view`
   * 的模型（`{ ...model, view: hypothetical }`）傳進去，讀到的就是假設盤面。語意見 `BotEconomyHooks`。
   */
  /** 擋住路口的非建築棋子擁有者（第一個非 null 勝出）。 */
  readonly blocker?: (model: BoardModel, vertex: number) => string | null;
  /** 路口不能蓋建築（任一模組為 true）。 */
  readonly siteBlocked?: (model: BoardModel, vertex: number) => boolean;
  /** 一座建築在 `hex` 擲中時拿到的張數（第一個非 undefined 勝出）；undefined 表示沿用 base。 */
  readonly hexYield?: (
    model: BoardModel,
    hex: number,
    vertex: number,
    city: boolean,
  ) => Readonly<Partial<Record<CardKind, number>>> | undefined;
  /** 建模時的模組清單；沒有模組時省略。`economyOf` 預設讀它，讓模型與經濟用同一份清單。 */
  readonly modules?: readonly BotModule[];
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

/**
 * `modules` 提供的盤面鉤子會組合進模型（見 `BoardModel`）；省略或沒有任何模組提供鉤子時，結果與 base 相同。
 * 鉤子拿到的是最終模型（含組合後的掛點），可以呼叫本檔的 `isFreeSpot`、`vertexYield` 等函式。
 */
export function boardModel(view: GameView, selfId: string, modules: readonly BotModule[] = []): BoardModel {
  const topo = getTopology(view.board.topologyId);
  const tables = topologyTables(topo);
  const harborAt: (HarborType | null)[] = topo.vertices.map(() => null);
  for (const harbor of view.board.harbors) {
    const edge = topo.edges[harbor.edge];
    if (!edge) continue;
    for (const vertex of edge.vertices) harborAt[vertex] = harbor.type as HarborType;
  }
  const base: BoardModel = {
    view,
    selfId,
    topo,
    profile: requireProfile(view.profileId),
    neighbors: tables.neighbors,
    hexVertices: tables.hexVertices,
    hexPips: view.board.numbers.map((number) => pipsOf(number)),
    hexResource: view.board.terrain.map((terrain) => TERRAIN_RESOURCE[terrain as Terrain] ?? null),
    hexLand: view.board.terrain.map((terrain) => terrain !== 'sea'),
    hexGold: view.board.terrain.map((terrain) => terrain === 'gold'),
    harborAt,
  };
  const hooks = modules.flatMap((module) => (module.economy ? [module.economy] : []));
  const blockers = hooks.filter((hook) => hook.vertexBlocker);
  const sites = hooks.filter((hook) => hook.siteBlocked);
  const yields = hooks.filter((hook) => hook.hexYield);
  // 模組清單跟著模型走；沒有模組（tracker、hard）時不加欄位，物件形狀與 base 相同。
  const model: BoardModel = modules.length > 0 ? { ...base, modules } : base;
  if (blockers.length === 0 && sites.length === 0 && yields.length === 0) return model;
  // 鉤子拿到的是呼叫端傳入的 model（可能是展開後換了 view 的模型），不是這裡建的那一個。
  return {
    ...model,
    ...(blockers.length > 0 && {
      blocker: (at: BoardModel, vertex: number) => {
        for (const hook of blockers) {
          const owner = hook.vertexBlocker!(at, vertex);
          if (owner !== null) return owner;
        }
        return null;
      },
    }),
    ...(sites.length > 0 && {
      siteBlocked: (at: BoardModel, vertex: number) => sites.some((hook) => hook.siteBlocked!(at, vertex)),
    }),
    ...(yields.length > 0 && {
      hexYield: (at: BoardModel, hex: number, vertex: number, city: boolean) => {
        for (const hook of yields) {
          const amounts = hook.hexYield!(at, hex, vertex, city);
          if (amounts !== undefined) return amounts;
        }
        return undefined;
      },
    }),
  };
}

export function isLandHex(model: BoardModel, hex: number): boolean {
  return model.hexLand[hex] === true;
}

/** 路口至少鄰接一個陸地格（建築需要陸地）。base 的每個路口都成立。 */
export function isLandVertex(model: BoardModel, vertex: number): boolean {
  return model.topo.vertices[vertex]!.hexes.some((hex) => model.hexLand[hex]);
}

/** 道路需要陸地：任一側是陸地格的邊。base 的每條邊都成立。 */
export function isLandEdge(model: BoardModel, edge: number): boolean {
  return model.topo.edges[edge]!.hexes.some((hex) => model.hexLand[hex]);
}

/** 船只走海邊：外框邊（只有一側有格子），或任一側是海格；與 rules 的 `isSeaEdge` 相同。 */
export function isSeaEdge(model: BoardModel, edge: number): boolean {
  const { hexes } = model.topo.edges[edge]!;
  return hexes.length === 1 || hexes.some((hex) => !model.hexLand[hex]);
}

/** 陸地上的空點且相鄰路口都沒有建築（距離規則）；模組可以另外封住路口（C&K 的騎士）。 */
export function isFreeSpot(model: BoardModel, vertex: number): boolean {
  const buildings = model.view.board.buildings;
  if (buildings[vertex]) return false;
  if (!isLandVertex(model, vertex)) return false;
  if (model.siteBlocked?.(model, vertex)) return false;
  return model.neighbors[vertex]!.every((neighbor) => !buildings[neighbor]);
}

/**
 * 單一路口的點數產能；`blockedHex` 指定的格子（強盜）不計。`city` 為 true 時是城市的產能（預設聚落）。
 * 模組的 `hexYield` 回答時，各卡種依它給的張數加總；否則 base：資源 `city ? 2 : 1` 張。
 */
export function vertexYield(model: BoardModel, vertex: number, blockedHex: number | null = null, city = false): Yield {
  const out = emptyYield();
  for (const hex of model.topo.vertices[vertex]!.hexes) {
    if (hex === blockedHex) continue;
    const pips = model.hexPips[hex]!;
    const amounts = model.hexYield?.(model, hex, vertex, city);
    if (amounts !== undefined) {
      for (const kind of CARD_KINDS) {
        const amount = amounts[kind];
        if (amount) out[kind] = (out[kind] ?? 0) + pips * amount;
      }
      continue;
    }
    const resource = model.hexResource[hex];
    if (resource) out[resource] += city ? pips * 2 : pips;
  }
  return out;
}

/**
 * 聚落升成城市多得的產能。沒有模組的產出鉤子時就是聚落的產能（城市恆為兩倍）；有鉤子時以城市減聚落逐卡種計算。
 */
export function cityUpgradeYield(model: BoardModel, vertex: number): Yield {
  if (!model.hexYield) return vertexYield(model, vertex);
  const city = vertexYield(model, vertex, null, true);
  const settlement = vertexYield(model, vertex);
  const out = emptyYield();
  for (const kind of CARD_KINDS) {
    const gain = (city[kind] ?? 0) - (settlement[kind] ?? 0);
    if (gain > 0) out[kind] = gain;
  }
  return out;
}

/** 玩家所有建築的點數產能（城市依地形加倍或換成 commodity）；預設排除強盜所在格。 */
export function playerYield(model: BoardModel, playerId: string, ignoreRobber = false): Yield {
  const out = emptyYield();
  const blocked = ignoreRobber ? null : model.view.board.robber;
  model.view.board.buildings.forEach((building, vertex) => {
    if (!building || building.player !== playerId) return;
    const single = vertexYield(model, vertex, blocked, building.city);
    for (const kind of CARD_KINDS) {
      const amount = single[kind];
      if (amount) out[kind] = (out[kind] ?? 0) + amount;
    }
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

/**
 * 自己還能放幾條道路：profile 的道路數減去盤面上自己的非船道路（橋也不算，與規則引擎的
 * `countRoads` 相同）。`legalRoads` 不扣存量，保底與策略要自行檢查。查不到 profile 時不設上限；
 * 盤面缺漏（沒有 `board` 或 `roads`）視為沒有任何道路。不得 throw：保底路徑不在 try 裡。
 */
export function roadStockLeft(view: GameView, playerId: string): number {
  const profile = getProfile(view.profileId);
  if (!profile) return Infinity;
  const roads: unknown = view.board?.roads;
  let used = 0;
  if (Array.isArray(roads)) {
    for (const road of roads as GameView['board']['roads']) {
      if (road && road.player === playerId && !road.ship && !road.bridge) used += 1;
    }
  }
  return profile.pieces.roads - used;
}

/** 路口上有別人的建築，或別人的非建築棋子（模組的 `vertexBlocker`，C&K 的騎士）；自己的不擋。 */
function opponentAt(model: BoardModel, vertex: number, playerId: string): boolean {
  const building = model.view.board.buildings[vertex];
  if (building) return building.player !== playerId;
  const blocker = model.blocker?.(model, vertex);
  return blocker !== undefined && blocker !== null && blocker !== playerId;
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
 * 切斷穿越的路口，但己方道路仍可從未被切斷的一端繼續延伸。只走陸地邊，也只從建築與
 * 非船道路的端點出發：船只在自己的建築處與道路相接（Seafarers）。
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
    if (!road || road.player !== playerId || road.ship) return;
    for (const vertex of topo.edges[edge]!.vertices) start(vertex);
  });
  for (let head = 0; head < queue.length; head++) {
    const vertex = queue[head]!;
    const depth = distance[vertex]!;
    if (depth >= maxDepth) continue;
    for (const edge of topo.vertices[vertex]!.edges) {
      if (roads[edge] || !isLandEdge(model, edge)) continue;
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
 * 玩家的最長道路長度（可額外假設幾條新道路或新船）。對手建築會切斷路線，與規則
 * 引擎的 `longestRouteLength` 相同。只有 `profile.longestRouteIncludesShips` 時才計入船
 * （Seafarers 的最長貿易路線）：道路與船只在自己的建築處相接。
 */
export function routeLength(
  model: BoardModel,
  playerId: string,
  extraEdges: readonly number[] = [],
  extraShips: readonly number[] = [],
): number {
  const { topo } = model;
  const { buildings, roads } = model.view.board;
  const withShips = model.profile.longestRouteIncludesShips;
  const shipEdges = new Set<number>();
  const incident = new Map<number, number[]>();
  const add = (edge: number): void => {
    for (const vertex of topo.edges[edge]!.vertices) {
      const list = incident.get(vertex) ?? [];
      list.push(edge);
      incident.set(vertex, list);
    }
  };
  roads.forEach((road, edge) => {
    if (!road || road.player !== playerId) return;
    if (road.ship) {
      if (!withShips) return;
      shipEdges.add(edge);
    }
    add(edge);
  });
  for (const edge of extraEdges) add(edge);
  if (withShips) {
    for (const edge of extraShips) {
      shipEdges.add(edge);
      add(edge);
    }
  }
  if (incident.size === 0) return 0;
  const used = new Set<number>();
  const walk = (vertex: number, arrivedByShip: boolean | null): number => {
    let best = 0;
    for (const edge of incident.get(vertex) ?? []) {
      if (used.has(edge)) continue;
      const ship = shipEdges.has(edge);
      // 道路與船只在自己的建築處相接。
      if (arrivedByShip !== null && ship !== arrivedByShip && buildings[vertex]?.player !== playerId) continue;
      const [a, b] = topo.edges[edge]!.vertices;
      const next = a === vertex ? b : a;
      used.add(edge);
      const length = 1 + (opponentAt(model, next, playerId) ? 0 : walk(next, ship));
      used.delete(edge);
      if (length > best) best = length;
    }
    return best;
  };
  let longest = 0;
  for (const vertex of incident.keys()) {
    if (opponentAt(model, vertex, playerId)) continue;
    longest = Math.max(longest, walk(vertex, null));
  }
  return longest;
}
