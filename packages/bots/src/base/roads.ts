/** base 的道路選擇：免費道路、最長道路與開局的路向評分。 */

import type { Command } from '@catan/rules';
import { isFreeSpot, playerYield } from '../board.ts';
import { bestRouteEdge, resourceWeights, settlementSpotValue } from '../economy.ts';
import type { TurnContext } from '../modules/types.ts';

/**
 * 最有用的合法道路：先朝主要聚落目標，再延長最長道路，最後朝附近最好的空點。
 * `anyEdge` 為 true 時（免費道路）至少回傳一條合法道路。
 */
export function usefulRoad(turn: TurnContext, anyEdge: boolean): number | null {
  const { view, model } = turn;
  const legal = view.hints?.legalRoads ?? [];
  if (legal.length === 0) return null;
  const economy = turn.economy;
  for (const plan of economy.plans) {
    if ((plan.kind === 'settlement' || plan.kind === 'longestRoad') && plan.roads.length > 0) {
      if (legal.includes(plan.roads[0]!)) return plan.roads[0]!;
    }
  }
  const longer = bestRouteEdge(model, legal, economy.myRoute);
  if (longer !== null) return longer;
  if (!anyEdge) return null;
  const scored = legal.map((edge) => ({ item: edge, score: roadDirectionScore(turn, edge) }));
  return turn.pick(scored);
}

/** 免費道路（Road Building）的 base 決策；SF-1 在這裡加存量檢查。 */
export function freeRoadDecision(turn: TurnContext): Command | null {
  const edge = usefulRoad(turn, true);
  return edge === null ? null : { type: 'build.road', edge };
}

/** 道路遠端一到兩步內最好的空點價值。 */
export function roadDirectionScore(turn: TurnContext, edge: number): number {
  const { model, ctx } = turn;
  const weights = resourceWeights(model);
  const mine = playerYield(model, ctx.selfId, true);
  const [a, b] = model.topo.edges[edge]!.vertices;
  const ownA = model.view.board.buildings[a]?.player === ctx.selfId || touchesOwnRoad(turn, a, edge);
  const far = ownA ? b : a;
  let best = 0;
  const visit = (vertex: number, factor: number): void => {
    if (isFreeSpot(model, vertex)) {
      best = Math.max(best, settlementSpotValue(model, vertex, weights, mine) * factor);
    }
  };
  visit(far, 1);
  for (const next of model.neighbors[far]!) {
    if (next === a || next === b) continue;
    visit(next, 0.75);
  }
  return best;
}

function touchesOwnRoad(turn: TurnContext, vertex: number, except: number): boolean {
  const { model, ctx } = turn;
  return model.topo.vertices[vertex]!.edges.some(
    (edge) => edge !== except && model.view.board.roads[edge]?.player === ctx.selfId,
  );
}
