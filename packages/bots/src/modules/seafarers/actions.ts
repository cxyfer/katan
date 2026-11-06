/**
 * Seafarers 的行動候選（SF 計畫 §4.2）。
 *
 * - `actions`：移船。只有 standard 會移（easy 不移船，D-SF2）。條件：有一艘不在任何島嶼計畫路徑上的
 *   葉端船（拿掉它，所有島嶼計畫所需的船數都不變），而且它的 `targets` 含最佳計畫的下一條邊，就把它移到
 *   那條邊，讓計畫少造一艘。`from` 與 `to` 只取自 `hints.movableShips`（D-SF6：船圈與迴路的判定
 *   留給 rules，日後改判時只有 hints 會變）。
 * - `freeRouteCandidates`：免費路線（Road Building）。計畫路徑的下一步在 `legalShips` 就造船，下一步
 *   是路（道路存量 > 0 而且在 `legalRoads` 中）就造路，否則挑最能延伸計畫的一步。候選非空時會取代
 *   base 的選路，所以道路候選也由這裡提供。行動階段（還沒打出 Road Building）只回傳船的候選：骨架以
 *   「任一模組的候選非空」決定要不要打出，道路由 base 判斷。easy 的「取前 3 名」由骨架的 topK 完成。
 *
 * 決定性（P4）：候選依 edge index 遞增產生，分數相同時保留這個順序；不消耗亂數。
 */

import { roadDirectionScore } from '../../base/roads.ts';
import { isFreeSpot, roadStockLeft, type BoardModel } from '../../board.ts';
import { bestRouteEdge } from '../../economy.ts';
import { isSeaEdge, searchShips } from '../../sea.ts';
import type { BotCommand, BotModule, Scored, TurnContext } from '../types.ts';
import { moduleHints } from '../view.ts';
import { claimedIslands, ISLAND_SETTLEMENT, unclaimedIslandsAt } from './plan.ts';

/** 移船是免費的，分數低於 base 的立即建造（城市、聚落 ≥ 1），所以建造先做、移船隨後；兩者都在同一個視窗內完成。 */
const SHIP_MOVE_SCORE = 0.9;

/** 計畫路徑的下一步：基準分，加上該計畫的分數（越好的計畫越先）。 */
const PLAN_STEP_SCORE = 100;
/** 延長最長路線的道路（與 base 的 `usefulRoad` 順序相同，排在計畫之後）。 */
const LONGER_ROUTE_SCORE = 50;
/** 不在計畫路徑上的船：離目標越近越好，最高 8，與 `roadDirectionScore`（空點價值）同量級。 */
const SHIP_APPROACH_SCORE = 8;
const SHIP_APPROACH_STEP = 1.5;
const SHIP_APPROACH_REACH = 5;

export const seafarersActions: NonNullable<BotModule['actions']> = (turn) => {
  if (turn.level === 'easy') return [];
  const movable = moduleHints(turn.view.hints, 'seafarers')?.movableShips ?? [];
  if (movable.length === 0) return [];
  const plans = turn.economy.plans.filter((plan) => plan.kind === ISLAND_SETTLEMENT);
  const goal = plans.find((plan) => (plan.ships?.length ?? 0) > 0);
  if (!goal) return [];
  const next = goal.ships![0]!;
  const depth = Math.max(...plans.map((plan) => plan.ships?.length ?? 0));
  const out: Scored<BotCommand>[] = [];
  // movableShips 依 edge 遞增（rules 逐邊掃描）。
  for (const ship of movable) {
    if (!ship.targets.includes(next)) continue;
    // 拿掉這艘船後，每個島嶼計畫的船數都不變：它不在任何計畫路徑上。
    const lifted = searchShips(turn.model, turn.ctx.selfId, depth, { moving: ship.edge });
    if (plans.some((plan) => lifted.distance[plan.vertex!]! > (plan.ships?.length ?? 0))) continue;
    out.push({ item: { type: 'ship.move', from: ship.edge, to: next }, score: SHIP_MOVE_SCORE });
  }
  return out;
};

export const seafarersFreeRouteCandidates: NonNullable<BotModule['freeRouteCandidates']> = (turn) => {
  const stage = freeRouteStage(turn);
  const hints = turn.view.hints;
  if (stage === null || !hints) return [];
  const ships = moduleHints(hints, 'seafarers')?.legalShips ?? [];
  // `legalRoads` 不扣道路存量；行動階段不提供道路（base 的條件已涵蓋）。
  const roads = stage === 'pending' && roadStockLeft(turn.view, turn.ctx.selfId) > 0 ? hints.legalRoads : [];
  if (ships.length === 0 && roads.length === 0) return [];

  const { economy, model } = turn;
  // 計畫路徑的下一步，依計畫分數（economy.plans 已排序）；同一條邊取最好的計畫。
  const shipSteps = new Map<number, number>();
  const roadSteps = new Map<number, number>();
  for (const plan of economy.plans) {
    const tier = PLAN_STEP_SCORE + plan.score;
    if (plan.kind === ISLAND_SETTLEMENT) {
      const edge = plan.ships?.[0];
      if (edge !== undefined && ships.includes(edge) && !shipSteps.has(edge)) shipSteps.set(edge, tier);
    } else if (plan.kind === 'settlement' || plan.kind === 'longestRoad') {
      const edge = plan.roads[0];
      if (edge !== undefined && roads.includes(edge) && !roadSteps.has(edge)) roadSteps.set(edge, tier);
    }
  }
  const longer = roads.length > 0 ? bestRouteEdge(model, roads, economy.myRoute) : null;
  const seaDistance = ships.length > 0 ? approachDistances(turn) : [];

  const out: Scored<BotCommand>[] = [];
  for (const edge of ships) {
    const near = Math.min(...model.topo.edges[edge]!.vertices.map((vertex) => seaDistance[vertex] ?? Infinity));
    const approach =
      near === Infinity ? 0 : SHIP_APPROACH_SCORE - SHIP_APPROACH_STEP * Math.min(near, SHIP_APPROACH_REACH);
    out.push({ item: { type: 'build.ship', edge }, score: shipSteps.get(edge) ?? approach });
  }
  for (const edge of roads) {
    const score = roadSteps.get(edge) ?? (edge === longer ? LONGER_ROUTE_SCORE : roadDirectionScore(turn, edge));
    out.push({ item: { type: 'build.road', edge }, score });
  }
  return out;
};

/** 自己正在 Road Building 的 frame 中（'pending'），或自己的行動階段（'action'，打出之前）。 */
function freeRouteStage(turn: TurnContext): 'pending' | 'action' | null {
  const { view, ctx } = turn;
  const pending = view.pending;
  if (pending) return pending.kind === 'freeRoads' && pending.actor === ctx.selfId ? 'pending' : null;
  return view.turn.phase === 'action' && view.turn.playerId === ctx.selfId ? 'action' : null;
}

/**
 * 各路口沿海邊走到最近目標還要幾條邊（到不了為 Infinity）。目標是島嶼計畫的路口；沒有計畫時，
 * 是還沒領過加分的小島上的空點。只是接近程度的估計，不判定合法性。
 */
function approachDistances(turn: TurnContext): number[] {
  const { model, economy } = turn;
  let goals = economy.plans.filter((plan) => plan.kind === ISLAND_SETTLEMENT).map((plan) => plan.vertex!);
  if (goals.length === 0) goals = unclaimedIslandSpots(model);
  const distance = model.topo.vertices.map(() => Infinity);
  let frontier = [...new Set(goals)].sort((a, b) => a - b);
  for (const vertex of frontier) distance[vertex] = 0;
  for (let depth = 1; frontier.length > 0; depth++) {
    const reached: number[] = [];
    for (const vertex of frontier) {
      for (const edge of model.topo.vertices[vertex]!.edges) {
        if (!isSeaEdge(model, edge)) continue;
        const [a, b] = model.topo.edges[edge]!.vertices;
        const other = a === vertex ? b : a;
        if (distance[other] !== Infinity) continue;
        distance[other] = depth;
        reached.push(other);
      }
    }
    frontier = reached.sort((a, b) => a - b);
  }
  return distance;
}

function unclaimedIslandSpots(model: BoardModel): number[] {
  const claimed = claimedIslands(model);
  const out: number[] = [];
  for (let vertex = 0; vertex < model.topo.vertices.length; vertex++) {
    if (isFreeSpot(model, vertex) && unclaimedIslandsAt(model, vertex, claimed) > 0) out.push(vertex);
  }
  return out;
}
