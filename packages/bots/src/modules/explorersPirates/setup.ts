/**
 * E&P 的變動式開局（計畫 §4.3；E3）。三個步驟只讀 `H.setup.*` 的合法目標（P2）：
 *
 * - harbor：起始島上的點數、可放船的邊數、到霧區的期望（以假想的 settler 船規劃）、扣掉對手 harbour 的擠壓；
 * - settlement：base 的點數評分（不含港口項）加上 harbour 缺的資源，沿海再加分；
 * - route：船朝期望最高的霧區出發；道路用 base 的路向，並排除通往霧格與未開放地點的路。
 * easy 從前 3 名挑（`turn.pick`），standard 取最佳。非游標的座位回 null。
 */

import { EP_BASE_MP, RESOURCES } from '@katan/rules';
import { playerYield, vertexYield } from '../../board.ts';
import { resourceWeights, weightedPips } from '../../economy.ts';
import { roadDirectionScore } from '../../base/roads.ts';
import type { BotCommand, Scored, TurnContext } from '../types.ts';
import { closedSite, epGeometry, isCoastalVertex, type EpGeometry } from './geometry.ts';
import { fleetOf, voyagesOf } from './movement.ts';
import { geometryOf } from './plans.ts';
import { epHints, epView, type EpShipView } from './view.ts';

const FRONT_WEIGHT = 4;
const EDGE_WEIGHT = 1;
/** 每座靠近的對手 harbour 的扣分（搶同一片海）。 */
const RIVAL_PENALTY = 1.5;
const RIVAL_RANGE = 2;
const LACK_BONUS = 2;
const COAST_BONUS = 1;

/** 假想一艘載 settler 的船停在 `edge`，取它最佳航程的分數（涵蓋到霧區的距離與探索期望）。 */
function frontScore(turn: TurnContext, g: EpGeometry, edge: number): number {
  const ghost: EpShipView = { id: 'ghost', player: turn.ctx.selfId, edge, cargo: ['settler'] };
  const ghosted = epGeometry(turn.view, { ...g.ep, ships: [...g.ep.ships, ghost] });
  return ghosted ? (voyagesOf(fleetOf(turn, ghosted), ghost, EP_BASE_MP, false)[0]?.score ?? 0) : 0;
}

/** 與 `vertex` 相距不超過 `range` 個路口的對手 harbour 數。 */
function rivalsNear(turn: TurnContext, g: EpGeometry, vertex: number, range: number): number {
  const dist = new Map<number, number>([[vertex, 0]]);
  const queue = [vertex];
  for (const at of queue) {
    if (dist.get(at)! >= range) continue;
    for (const edge of g.topo.vertices[at]!.edges) {
      for (const next of g.topo.edges[edge]!.vertices) {
        if (dist.has(next)) continue;
        dist.set(next, dist.get(at)! + 1);
        queue.push(next);
      }
    }
  }
  return g.ep.harbors.filter((harbor) => harbor.player !== turn.ctx.selfId && dist.has(harbor.vertex)).length;
}

/** harbour 旁可放船的邊（與 rules 的 `setupShipTargets` 同義：海路、沒有船、兩端不碰霧）。 */
function shipEdgesAt(g: EpGeometry, vertex: number): number[] {
  return g.topo.vertices[vertex]!.edges.filter((edge) => {
    const info = g.topo.edges[edge]!;
    return (
      g.view.board.roads[edge] === null &&
      !g.ep.ships.some((ship) => ship.edge === edge) &&
      info.vertices.every((end) => !g.topo.vertices[end]!.hexes.some((hex) => g.fog.has(hex))) &&
      info.hexes.some((hex) => g.view.board.terrain[hex] === 'sea' && !g.fog.has(hex))
    );
  });
}

function harborScore(turn: TurnContext, g: EpGeometry, vertex: number): number {
  const edges = shipEdgesAt(g, vertex);
  const front = Math.max(0, ...edges.map((edge) => frontScore(turn, g, edge)));
  const pips = weightedPips(vertexYield(turn.model, vertex), resourceWeights(turn.model));
  return pips + EDGE_WEIGHT * Math.min(edges.length, 3) + FRONT_WEIGHT * front - RIVAL_PENALTY * rivalsNear(turn, g, vertex, RIVAL_RANGE);
}

function settlementScore(turn: TurnContext, g: EpGeometry, vertex: number): number {
  const spot = vertexYield(turn.model, vertex);
  const mine = playerYield(turn.model, turn.ctx.selfId, true);
  const lacking = RESOURCES.filter((resource) => spot[resource] > 0 && mine[resource] === 0).length;
  return weightedPips(spot, resourceWeights(turn.model)) + LACK_BONUS * lacking + (isCoastalVertex(g, vertex) ? COAST_BONUS : 0);
}

/** 道路不通往霧格與未開放的地點（比照 economy 的 `routeEdge`）。 */
function usableRoad(g: EpGeometry, me: string, edge: number): boolean {
  return g.topo.edges[edge]!.hexes.every((hex) => !g.fog.has(hex) && !closedSite(g, hex, me));
}

export function epSetup(turn: TurnContext): BotCommand | null | undefined {
  if (!epView(turn.view)?.setupStep) return undefined;
  const setup = epHints(turn.view.hints)?.setup;
  const g = geometryOf(turn);
  if (!setup || !g) return null;
  const pick = <T>(items: readonly T[], score: (item: T) => number): T | null => turn.pick(items.map((item): Scored<T> => ({ item, score: score(item) })));
  if (setup.step === 'harbor') {
    const vertex = pick(setup.harbor, (item) => harborScore(turn, g, item));
    return vertex === null ? null : { type: 'ep.setupHarbor', vertex };
  }
  if (setup.step === 'settlement') {
    const vertex = pick(setup.settlement, (item) => settlementScore(turn, g, item));
    return vertex === null ? null : { type: 'ep.setupSettlement', vertex };
  }
  if (setup.ship.length > 0) {
    const edge = pick(setup.ship, (item) => frontScore(turn, g, item));
    return edge === null ? null : { type: 'ep.setupShip', edge };
  }
  const usable = setup.road.filter((edge) => usableRoad(g, turn.ctx.selfId, edge));
  const edge = pick(usable.length > 0 ? usable : setup.road, (item) => roadDirectionScore(turn, item));
  return edge === null ? null : { type: 'ep.setupRoad', edge };
}
