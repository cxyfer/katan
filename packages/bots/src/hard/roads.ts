import { COSTS, type Command } from '@katan/rules';
import { freeRoadDecision } from '../base/roads.ts';
import { isFreeSpot, isLandEdge, roadStockLeft } from '../board.ts';
import { canAfford } from '../economy.ts';
import { positionOf, routeOf, tableOf } from './position.ts';
import type { HardTurn } from './turn.ts';

export function scoringRoad(turn: HardTurn): Command | null {
  const { view, model, ctx } = turn;
  if (view.awards.longestRoad === ctx.selfId || !canAfford(turn.economy.hand, COSTS.road)) return null;
  const legal = view.hints?.legalRoads ?? [];
  if (legal.length === 0 || turn.economy.left.roads <= 0) return null;
  const table = tableOf(view, ctx.selfId, model);
  const position = positionOf(view, ctx.selfId);
  const needed = Math.max(5, table.rivalRoute + 1);
  if (position.roads.length + 1 < needed) return null;
  const edge = legal.find((candidate) => routeOf(table, [...position.roads, candidate]) >= needed);
  return edge === undefined ? null : { type: 'build.road', edge };
}

export function roadBuildingEdge(turn: HardTurn, remaining: number): number | null {
  const { view, model, ctx, me } = turn;
  const legal = view.hints?.legalRoads ?? [];
  const count = Math.min(remaining, roadStockLeft(view, ctx.selfId));
  if (legal.length === 0 || count <= 0) return null;

  const { buildings, roads } = view.board;
  const { vertices, edges } = model.topo;
  const table = tableOf(view, ctx.selfId, model);
  const position = positionOf(view, ctx.selfId);
  const ownsRoadAt = (vertex: number): boolean =>
    vertices[vertex]!.edges.some((edge) => roads[edge]?.player === ctx.selfId);
  const rivalAt = (vertex: number): boolean => {
    const building = buildings[vertex];
    if (building) return building.player !== ctx.selfId;
    return vertices[vertex]!.edges.some((edge) => !!roads[edge] && roads[edge]!.player !== ctx.selfId);
  };
  const canSettle = turn.economy.left.settlements > 0;
  const canPaySettlement = canSettle && canAfford(position.hand, COSTS.settlement);
  const siteScores = new Map<number, number>();
  const siteValue = (vertex: number): number => {
    if (!canSettle) return 0;
    const known = siteScores.get(vertex);
    if (known !== undefined) return known;
    let score = 0;
    if (isFreeSpot(model, vertex) && !ownsRoadAt(vertex)) {
      const contested = rivalAt(vertex) || vertices[vertex]!.edges.some((edge) =>
        !roads[edge] && isLandEdge(model, edge) && rivalAt(edges[edge]!.vertices.find((end) => end !== vertex)!),
      );
      score = (canPaySettlement ? 1 : 0) | (contested ? 2 : 0);
    }
    siteScores.set(vertex, score);
    return score;
  };

  const gap = view.victoryTarget - (me.ownScore ?? me.publicScore);
  const holdsRoad = table.longestRoad === ctx.selfId;
  const needed = Math.max(5, table.rivalRoute + 1);
  const defending = holdsRoad && table.rivalRoute >= me.longestRoadLength - 1;
  const checkRoute = defending || (!holdsRoad && position.roads.length + count >= needed);
  let bestEdge: number | null = null;
  let bestScore = 0;
  const consider = (first: number, second?: number): void => {
    const route = checkRoute ? routeOf(table, second === undefined
      ? [...position.roads, first]
      : [...position.roads, first, second]) : 0;
    const takesRoad = !holdsRoad && route >= needed;
    const sites = second === undefined ? edges[first]!.vertices : [...edges[first]!.vertices, ...edges[second]!.vertices];
    const reachable = sites.reduce((mask, vertex) => mask | siteValue(vertex), 0);
    const wins = (takesRoad ? 2 : 0) + (reachable & 1) >= gap;
    const goal = wins ? 4 : takesRoad ? 3 : (reachable & 2) ? 2 : defending && route > me.longestRoadLength ? 1 : 0;
    if (goal > bestScore) {
      bestEdge = first;
      bestScore = goal;
    }
  };

  for (const edge of legal) consider(edge);
  if (count > 1 && bestScore < 4) {
    const seen = new Set<number>();
    for (const first of legal) {
      const next = new Set(legal);
      for (const vertex of edges[first]!.vertices) {
        if (buildings[vertex] || ownsRoadAt(vertex)) continue;
        for (const edge of vertices[vertex]!.edges) {
          if (!roads[edge] && isLandEdge(model, edge)) next.add(edge);
        }
      }
      for (const second of next) {
        if (first !== second && !seen.has(second)) consider(first, second);
      }
      if (bestScore === 4) break;
      seen.add(first);
    }
  }
  return bestEdge;
}

export function hardFreeRoadDecision(turn: HardTurn, remaining: number): Command | null {
  const edge = roadBuildingEdge(turn, remaining);
  return edge === null ? freeRoadDecision(turn) : { type: 'build.road', edge };
}
