/**
 * 海域模型（Seafarers 計畫 §4.3；SF+CK 整套重用，E&P 只重用判定函式與海路 BFS 的幾何）。
 *
 * 這裡的一切都只用於規劃與估值，**不判定合法性**（原則 P2）：送出前一律以 hints 過濾
 * （`legalShips`、`legalRoads`、`movableShips`…）。`test/sf-sea.test.ts` 在 rules 的完整對局上比對
 * 本檔與 hints，確保兩者不漂移。
 *
 * - 判定函式（陸地、海邊、島嶼、海岸）：陸海幾何是通用的，base 沒有海格，所以對 base 全是 no-op。
 *   基本的 `isLandHex`／`isLandEdge`／`isSeaEdge` 定義在 `board.ts`（道路 BFS 與空點判定要用），
 *   這裡再匯出。
 * - 船位模擬 `shipEdgesFrom`：對應 rules 的 `canPlaceShip`。騎士等模組擋住路口的 callback
 *   `blocker` 是保留的掛點，預設回 null；SF+CK 在 0.4.3 用 view 中的騎士位置實作。
 * - 道路與船是兩套獨立的搜尋：道路 BFS 在 `board.ts` 的 `searchRoads`（只走陸地邊，只從建築與
 *   非船道路出發）；船 BFS 是這裡的 `searchShips`（只走海邊，只從建築與船出發）。含船的路線長度是
 *   `board.ts` 的 `routeLength`，只在 `profile.longestRouteIncludesShips` 時計入船。
 * - 決定性（P4）：不讀事件、不消耗亂數；船 BFS 的 tie-break 一律取 edge index 較小者。
 */

import type { GameView } from '@catan/rules';
import {
  boardModel,
  isLandEdge,
  isLandHex,
  isLandVertex,
  isSeaEdge,
  type BoardModel,
  type RoadSearch,
} from './board.ts';

export { isLandEdge, isLandHex, isLandVertex, isSeaEdge };

/** 騎士等模組擋住路口的 callback：回傳擋住的玩家 id，沒有則回 null。擁有者自己不受影響。 */
export type VertexBlocker = (vertex: number) => string | null;

export interface ShipOptions {
  /** 保留給 SF+CK（0.4.3）的掛點；預設回 null。 */
  readonly blocker?: VertexBlocker;
  /** 移船：這條邊目前的船視為不在，也不能當作連接點（對應 rules 的 `moving`）。 */
  readonly moving?: number;
}

// ---------------------------------------------------------------------------
// 島嶼與海岸
// ---------------------------------------------------------------------------

/** 路口周圍陸地格的島嶼 id（>0，由小到大）；與 rules 的 `islandsAt` 相同。 */
export function islandsAt(model: BoardModel, vertex: number): number[] {
  const out = new Set<number>();
  for (const hex of model.topo.vertices[vertex]?.hexes ?? []) {
    if (!isLandHex(model, hex)) continue;
    const island = model.view.board.islands[hex] ?? 0;
    if (island > 0) out.add(island);
  }
  return [...out].sort((a, b) => a - b);
}

/** 路口所在的島嶼（最小的 id）；不鄰接陸地時回 null。 */
export function islandOfVertex(model: BoardModel, vertex: number): number | null {
  return islandsAt(model, vertex)[0] ?? null;
}

/** 鄰接陸地、而且有至少一條海邊的路口（船能靠岸的位置），由小到大。 */
export function coastVertices(model: BoardModel): number[] {
  const out: number[] = [];
  model.topo.vertices.forEach((info, vertex) => {
    if (!isLandVertex(model, vertex)) return;
    if (info.edges.some((edge) => isSeaEdge(model, edge))) out.push(vertex);
  });
  return out;
}

// ---------------------------------------------------------------------------
// 棋子存量
// ---------------------------------------------------------------------------

/** 自己盤面上的船數。 */
export function shipsOnBoard(model: BoardModel, playerId: string = model.selfId): number {
  let count = 0;
  for (const road of model.view.board.roads) if (road && road.ship && road.player === playerId) count += 1;
  return count;
}

/** 還能放幾艘船；`legalShips` 已扣存量，但模型與策略要自行知道還剩多少。 */
export function shipsLeft(model: BoardModel, playerId: string = model.selfId): number {
  return model.profile.pieces.ships - shipsOnBoard(model, playerId);
}

// ---------------------------------------------------------------------------
// 船位模擬
// ---------------------------------------------------------------------------

function touchesPirate(model: BoardModel, edge: number): boolean {
  const pirate = model.view.board.pirate;
  return pirate !== null && model.topo.edges[edge]!.hexes.includes(pirate);
}

/** 路口是否被別人擋住：對手的建築，或 blocker 回報的別人的棋子。自己的不算。 */
function blockedFor(model: BoardModel, vertex: number, playerId: string, blocker: VertexBlocker | undefined): boolean {
  const building = model.view.board.buildings[vertex];
  if (building) return building.player !== playerId;
  const owner = blocker?.(vertex) ?? null;
  return owner !== null && owner !== playerId;
}

function ownShipAt(model: BoardModel, playerId: string, vertex: number, except: readonly number[]): boolean {
  const { roads } = model.view.board;
  return model.topo.vertices[vertex]!.edges.some((edge) => {
    if (except.includes(edge)) return false;
    const road = roads[edge];
    return !!road && road.ship && road.player === playerId;
  });
}

/** 對應 rules 的 `canPlaceShip`（非開局）：空的海邊，避開海盜，接在自己的建築或船上。 */
function canPlaceShip(model: BoardModel, playerId: string, edge: number, options: ShipOptions): boolean {
  const { moving, blocker } = options;
  if (edge === moving) return false;
  if (model.view.board.roads[edge]) return false;
  if (!isSeaEdge(model, edge)) return false;
  if (touchesPirate(model, edge)) return false;
  const except = moving === undefined ? [edge] : [edge, moving];
  return model.topo.edges[edge]!.vertices.some((vertex) => {
    const building = model.view.board.buildings[vertex];
    if (building) return building.player === playerId;
    if (blockedFor(model, vertex, playerId, blocker)) return false;
    return ownShipAt(model, playerId, vertex, except);
  });
}

/**
 * 玩家現在能放船的邊（不含棋子存量與費用），由小到大。`moving` 指定時是移船的目標。
 * 與 rules 的 `legalShipEdges` 一致，但只是模型：合法性以 `hints.modules.seafarers` 為準。
 */
export function shipEdgesOf(model: BoardModel, playerId: string = model.selfId, options: ShipOptions = {}): number[] {
  const out: number[] = [];
  for (let edge = 0; edge < model.topo.edges.length; edge++) {
    if (canPlaceShip(model, playerId, edge, options)) out.push(edge);
  }
  return out;
}

/** `shipEdgesOf` 的 view 版本。 */
export function shipEdgesFrom(view: GameView, selfId: string, options: ShipOptions = {}): number[] {
  return shipEdgesOf(boardModel(view, selfId), selfId, options);
}

/**
 * 玩家現在能放道路的邊（不含棋子存量與費用），由小到大；對應 rules 的 `canPlaceRoad`（非開局）。
 * 只有陸地邊，只從建築與非船道路延伸：船在自己的建築處才與道路相接。
 */
export function roadEdgesOf(model: BoardModel, playerId: string = model.selfId, options: ShipOptions = {}): number[] {
  const { buildings, roads } = model.view.board;
  const canExtendFrom = (vertex: number): boolean => {
    const building = buildings[vertex];
    if (building) return building.player === playerId;
    if (blockedFor(model, vertex, playerId, options.blocker)) return false;
    return model.topo.vertices[vertex]!.edges.some((edge) => {
      const road = roads[edge];
      return !!road && road.player === playerId && !road.ship;
    });
  };
  const out: number[] = [];
  for (let edge = 0; edge < model.topo.edges.length; edge++) {
    if (roads[edge] || !isLandEdge(model, edge)) continue;
    if (model.topo.edges[edge]!.vertices.some(canExtendFrom)) out.push(edge);
  }
  return out;
}

/** `roadEdgesOf` 的 view 版本。 */
export function roadEdgesFrom(view: GameView, selfId: string, options: ShipOptions = {}): number[] {
  return roadEdgesOf(boardModel(view, selfId), selfId, options);
}

// ---------------------------------------------------------------------------
// 船 BFS
// ---------------------------------------------------------------------------

/**
 * 自己的船網延伸到各路口還需要幾艘新船（到不了為 Infinity），結構與道路的 `RoadSearch` 相同，
 * 所以可以用 `board.ts` 的 `roadPath` 還原路徑。
 *
 * - 起點：自己的建築，與自己的船的兩端；被對手建築或 blocker 擋住的路口不是起點，也不會被走到
 *   （船不能穿越它）。
 * - 只走空的海邊，避開海盜所在 hex 的邊。
 * - 決定性：逐層擴張，同一層有多條路徑到同一個路口時取 edge index 最小的那條；每層的路口由小到大。
 * - `maxDepth` 是最多幾艘新船；自己的船數存量由呼叫端另行限制（`shipsLeft`）。
 */
export function searchShips(
  model: BoardModel,
  playerId: string = model.selfId,
  maxDepth = Infinity,
  options: ShipOptions = {},
): RoadSearch {
  const { topo } = model;
  const { buildings, roads } = model.view.board;
  const distance = topo.vertices.map(() => Infinity);
  const viaEdge = topo.vertices.map(() => -1);
  const viaVertex = topo.vertices.map(() => -1);
  const starts = new Set<number>();
  buildings.forEach((building, vertex) => {
    if (building && building.player === playerId) starts.add(vertex);
  });
  roads.forEach((road, edge) => {
    if (!road || !road.ship || road.player !== playerId) return;
    for (const vertex of topo.edges[edge]!.vertices) {
      if (!blockedFor(model, vertex, playerId, options.blocker)) starts.add(vertex);
    }
  });
  let frontier = [...starts].sort((a, b) => a - b);
  for (const vertex of frontier) distance[vertex] = 0;
  for (let depth = 0; frontier.length > 0 && depth < maxDepth; depth++) {
    const reached = new Map<number, { edge: number; from: number }>();
    for (const vertex of frontier) {
      for (const edge of topo.vertices[vertex]!.edges) {
        if (roads[edge] || !isSeaEdge(model, edge) || touchesPirate(model, edge)) continue;
        const [a, b] = topo.edges[edge]!.vertices;
        const next = a === vertex ? b : a;
        if (distance[next] !== Infinity || blockedFor(model, next, playerId, options.blocker)) continue;
        const known = reached.get(next);
        if (!known || edge < known.edge) reached.set(next, { edge, from: vertex });
      }
    }
    frontier = [...reached.keys()].sort((a, b) => a - b);
    for (const vertex of frontier) {
      const { edge, from } = reached.get(vertex)!;
      distance[vertex] = depth + 1;
      viaEdge[vertex] = edge;
      viaVertex[vertex] = from;
    }
  }
  return { distance, viaEdge, viaVertex };
}
