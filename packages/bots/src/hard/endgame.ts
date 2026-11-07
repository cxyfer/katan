/**
 * hard 的終盤搜尋（規格 §4 第 7 點、§7）：分數接近勝利時，在輕量局面上展開本回合的
 * 建造與銀行交易序列，找出這回合就能拿到勝利分數的序列，回傳第一步。
 *
 * standard 只補齊第一順位計畫；例如主要計畫是遠處的聚落時，它不會發現「換兩張牌蓋城市就贏」。
 * 搜尋以節點數設上限（不看時間），廣度優先，相同局面只展開一次；同一 view 與 context 一定
 * 得到同一指令。
 */

import { COSTS, RESOURCES, type Resource } from '@catan/rules';
import { isLandEdge } from '../board.ts';
import { canAfford, pay, type Cost, type Hand } from '../economy.ts';
import type { BotCommand } from '../types.ts';
import { positionOf, routeOf, tableOf, victoryPointsOf, type Position, type Table } from './position.ts';
import type { HardTurn } from './turn.ts';

/** 每次搜尋最多展開的節點數。 */
export const NODE_LIMIT = 600;
/** 一個序列最多幾筆銀行交易。 */
const MAX_TRADES = 3;
/** 每個節點最多考慮幾條道路。 */
const ROAD_CANDIDATES = 4;
/** 分數離勝利還差幾分以內才搜尋。 */
const ENDGAME_GAP = 3;

interface Node {
  readonly position: Position;
  readonly left: { readonly settlements: number; readonly cities: number; readonly roads: number };
  readonly bank: Readonly<Record<Resource, number>>;
  readonly trades: number;
}

interface Child {
  readonly node: Node;
  readonly command: BotCommand;
}

function keyOf(position: Position): string {
  const sorted = (list: readonly number[]): string => list.slice().sort((a, b) => a - b).join('.');
  return [
    RESOURCES.map((resource) => position.hand[resource]).join(','),
    sorted(position.settlements),
    sorted(position.cities),
    sorted(position.roads),
  ].join('|');
}

function owns(position: Position, vertex: number): boolean {
  return position.settlements.includes(vertex) || position.cities.includes(vertex);
}

/** 路口是否還能蓋聚落（距離規則，含自己這回合新蓋的建築）。 */
function freeSpot(table: Table, position: Position, vertex: number): boolean {
  const { model } = table;
  const { buildings } = model.view.board;
  if (buildings[vertex] || owns(position, vertex)) return false;
  return model.neighbors[vertex]!.every((neighbor) => !buildings[neighbor] && !owns(position, neighbor));
}

function rivalAt(table: Table, vertex: number): boolean {
  const building = table.model.view.board.buildings[vertex];
  return !!building && building.player !== table.selfId;
}

/** 這回合新鋪的道路接到的空點（第一步改用 hints 的合法位置）。 */
function settlementTargets(table: Table, node: Node): number[] {
  if (node.left.settlements <= 0) return [];
  const out = new Set<number>();
  for (const edge of node.position.roads) {
    for (const vertex of table.model.topo.edges[edge]!.vertices) {
      if (freeSpot(table, node.position, vertex) && !rivalAt(table, vertex)) out.add(vertex);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** 接得上自己道路網的空邊（第一步改用 hints 的合法位置）。 */
function adjacentRoads(table: Table, position: Position): number[] {
  const { model } = table;
  const { topo } = model;
  const boardRoads = model.view.board.roads;
  const ends = new Set<number>([...position.settlements, ...position.cities]);
  for (const edge of position.roads) for (const vertex of topo.edges[edge]!.vertices) ends.add(vertex);
  const out = new Set<number>();
  for (const vertex of ends) {
    if (rivalAt(table, vertex)) continue;
    for (const edge of topo.vertices[vertex]!.edges) {
      if (!boardRoads[edge] && !position.roads.includes(edge) && isLandEdge(model, edge)) out.add(edge);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** 修剪道路：能延長最長道路的優先，其次是通往空點的。 */
function roadTargets(table: Table, node: Node, candidates: readonly number[]): number[] {
  if (node.left.roads <= 0) return [];
  const { model } = table;
  const route = routeOf(table, node.position.roads);
  const scored = candidates.map((edge) => {
    let score = routeOf(table, [...node.position.roads, edge]) > route ? 100 : 0;
    for (const end of model.topo.edges[edge]!.vertices) {
      if (freeSpot(table, node.position, end)) score += 10;
    }
    return { edge, score };
  });
  scored.sort((a, b) => b.score - a.score || a.edge - b.edge);
  return scored
    .filter((item) => item.score > 0)
    .slice(0, ROAD_CANDIDATES)
    .map((item) => item.edge);
}

function moved(position: Position, hand: Hand, changes: Partial<Position>): Position {
  return { ...position, ...changes, hand };
}

function expand(turn: HardTurn, table: Table, node: Node, isRoot: boolean): Child[] {
  const hints = turn.view.hints!;
  const rates = hints.bankRates;
  const { position } = node;
  const hand = position.hand;
  const children: Child[] = [];
  if (node.left.cities > 0 && canAfford(hand, COSTS.city)) {
    for (const vertex of isRoot ? hints.legalCities : position.settlements) {
      if (!position.settlements.includes(vertex)) continue;
      children.push({
        node: {
          ...node,
          left: { ...node.left, cities: node.left.cities - 1, settlements: node.left.settlements + 1 },
          position: moved(position, pay(hand, COSTS.city), {
            settlements: position.settlements.filter((other) => other !== vertex),
            cities: [...position.cities, vertex],
          }),
        },
        command: { type: 'build.city', vertex },
      });
    }
  }
  if (canAfford(hand, COSTS.settlement)) {
    const targets = isRoot ? (node.left.settlements > 0 ? hints.legalSettlements : []) : settlementTargets(table, node);
    for (const vertex of targets) {
      children.push({
        node: {
          ...node,
          left: { ...node.left, settlements: node.left.settlements - 1 },
          position: moved(position, pay(hand, COSTS.settlement), { settlements: [...position.settlements, vertex] }),
        },
        command: { type: 'build.settlement', vertex },
      });
    }
  }
  if (canAfford(hand, COSTS.road)) {
    for (const edge of roadTargets(table, node, isRoot ? hints.legalRoads : adjacentRoads(table, position))) {
      children.push({
        node: {
          ...node,
          left: { ...node.left, roads: node.left.roads - 1 },
          position: moved(position, pay(hand, COSTS.road), { roads: [...position.roads, edge] }),
        },
        command: { type: 'build.road', edge },
      });
    }
  }
  // 銀行交易：只為了某個建造換它缺的資源，拿出該建造用不到、剩最多的資源。
  if (node.trades < MAX_TRADES) {
    const added = new Set<string>();
    for (const cost of [COSTS.city, COSTS.settlement, COSTS.road] as Cost[]) {
      let missing = 0;
      for (const resource of RESOURCES) missing += Math.max(0, (cost[resource] ?? 0) - hand[resource]);
      if (missing === 0 || missing > MAX_TRADES - node.trades) continue;
      let give: Resource | null = null;
      let spare = -1;
      for (const resource of RESOURCES) {
        const extra = hand[resource] - (cost[resource] ?? 0) - rates[resource];
        if (extra >= 0 && extra > spare) {
          spare = extra;
          give = resource;
        }
      }
      if (!give) continue;
      for (const receive of RESOURCES) {
        if ((cost[receive] ?? 0) <= hand[receive] || node.bank[receive] <= 0 || added.has(`${give}>${receive}`)) continue;
        added.add(`${give}>${receive}`);
        const next = { ...hand };
        next[give] -= rates[give];
        next[receive] += 1;
        children.push({
          node: {
            ...node,
            trades: node.trades + 1,
            bank: { ...node.bank, [receive]: node.bank[receive] - 1, [give]: node.bank[give] + rates[give] },
            position: moved(position, next, {}),
          },
          command: { type: 'trade.bank', give, receive },
        });
      }
    }
  }
  return children;
}

export interface WinningLine {
  readonly first: BotCommand;
  readonly nodes: number;
}

/** 這回合就能拿到勝利分數的序列；找不到時回傳 null。 */
export function winningLine(turn: HardTurn): WinningLine | null {
  const { view, ctx } = turn;
  const target = view.victoryTarget;
  if (turn.scoreOf(ctx.selfId) < target - ENDGAME_GAP) return null;
  const table = tableOf(view, ctx.selfId, turn.model);
  const left = turn.economy.left;
  const root: Node = {
    position: positionOf(view, ctx.selfId),
    left: { settlements: left.settlements, cities: left.cities, roads: left.roads },
    bank: { ...view.bank },
    trades: 0,
  };
  const seen = new Set<string>([keyOf(root.position)]);
  const queue: { node: Node; first: BotCommand | null }[] = [{ node: root, first: null }];
  let nodes = 1;
  for (let head = 0; head < queue.length && nodes < NODE_LIMIT; head++) {
    const { node, first } = queue[head]!;
    for (const child of expand(turn, table, node, head === 0)) {
      if (nodes >= NODE_LIMIT) break;
      const key = keyOf(child.node.position);
      if (seen.has(key)) continue;
      seen.add(key);
      nodes += 1;
      const line = first ?? child.command;
      if (victoryPointsOf(table, child.node.position) >= target) return { first: line, nodes };
      queue.push({ node: child.node, first: line });
    }
  }
  return null;
}
