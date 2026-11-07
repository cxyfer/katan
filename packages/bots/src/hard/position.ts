/**
 * hard 的輕量局面：自己一方會在回合內變動的部分（手牌、建築、道路），加上一次決策內固定的
 * 盤面與對手資訊。終盤搜尋在這個模型上展開，不經過規則引擎（規格 §7：引擎展開一個節點要
 * 0.6 ms，這個模型的複製只要微秒級）。
 */

import type { GameView } from '@catan/rules';
import { emptyYield, type BoardModel } from '../board.ts';
import type { Hand } from '../economy.ts';

/** 自己一方在回合內會變動的部分。 */
export interface Position {
  readonly hand: Hand;
  /** 自己的聚落與城市（路口）。 */
  readonly settlements: readonly number[];
  readonly cities: readonly number[];
  /** 自己的道路（邊）。 */
  readonly roads: readonly number[];
  /** 手上的分數卡（自己知道的）。 */
  readonly victoryCards: number;
}

/** 一次決策內固定的部分。 */
export interface Table {
  readonly model: BoardModel;
  readonly selfId: string;
  readonly longestRoad: string | null;
  readonly largestArmy: string | null;
  /** 對手最長道路的最大值。 */
  readonly rivalRoute: number;
}

export function positionOf(view: GameView, selfId: string): Position {
  const me = view.players.find((player) => player.id === selfId)!;
  const settlements: number[] = [];
  const cities: number[] = [];
  view.board.buildings.forEach((building, vertex) => {
    if (building?.player !== selfId) return;
    (building.city ? cities : settlements).push(vertex);
  });
  const roads: number[] = [];
  view.board.roads.forEach((road, edge) => {
    if (road?.player === selfId && !road.ship) roads.push(edge);
  });
  const cards = [...(me.devCards ?? []), ...(me.newDevCards ?? [])];
  return {
    hand: { ...(me.resources ?? emptyYield()) },
    settlements,
    cities,
    roads,
    victoryCards: cards.filter((card) => card === 'victoryPoint').length,
  };
}

export function tableOf(view: GameView, selfId: string, model: BoardModel): Table {
  const rivals = view.players.filter((player) => player.id !== selfId);
  return {
    model,
    selfId,
    longestRoad: view.awards.longestRoad,
    largestArmy: view.awards.largestArmy,
    rivalRoute: Math.max(0, ...rivals.map((player) => player.longestRoadLength)),
  };
}

/** 最長道路（與規則引擎相同：對手的建築切斷路線）。 */
export function routeOf(table: Table, roads: readonly number[]): number {
  const { model, selfId } = table;
  const { topo } = model;
  const { buildings } = model.view.board;
  const incident = new Map<number, number[]>();
  for (const edge of roads) {
    for (const vertex of topo.edges[edge]!.vertices) {
      const list = incident.get(vertex);
      if (list) list.push(edge);
      else incident.set(vertex, [edge]);
    }
  }
  const blocked = (vertex: number): boolean => !!buildings[vertex] && buildings[vertex]!.player !== selfId;
  const used = new Set<number>();
  const walk = (vertex: number): number => {
    let best = 0;
    for (const edge of incident.get(vertex) ?? []) {
      if (used.has(edge)) continue;
      const [a, b] = topo.edges[edge]!.vertices;
      const next = a === vertex ? b : a;
      used.add(edge);
      const length = 1 + (blocked(next) ? 0 : walk(next));
      used.delete(edge);
      if (length > best) best = length;
    }
    return best;
  };
  let longest = 0;
  for (const vertex of incident.keys()) if (!blocked(vertex)) longest = Math.max(longest, walk(vertex));
  return longest;
}

/** 局面的確定分數：建築、最長道路、最大騎士團（回合內不變）與手上的分數卡。 */
export function victoryPointsOf(table: Table, position: Position): number {
  const route = routeOf(table, position.roads);
  const holdsRoad =
    table.longestRoad === table.selfId ? route >= table.rivalRoute : route >= 5 && route > table.rivalRoute;
  return (
    position.settlements.length +
    2 * position.cities.length +
    (holdsRoad ? 2 : 0) +
    (table.largestArmy === table.selfId ? 2 : 0) +
    position.victoryCards
  );
}
