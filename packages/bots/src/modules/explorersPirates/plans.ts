/**
 * E&P 的 economy 鉤子與計畫（計畫 §4.3、§4.6；E2）。
 *
 * - `awards`：沒有最長道路；`piecesLeft`：聚落只剩 plain 供應（上限 5）、城市為 0；
 * - `routeEdge`／`siteBlocked`：霧格與未開放的地點不規劃道路與聚落；
 * - `scoreExtras`：harbour 升級、settler、船三種計畫，讓棄牌保留、銀行交易與開價都以它們為目標。
 *   計畫只讀公開 view（非行動者棄牌時也會用到）；合法性仍由 `action.ts` 依 hints 決定。
 */

import { EP_COSTS, EP_PIECES } from '@katan/rules';
import type { BoardModel } from '../../board.ts';
import { etaRounds, type Plan } from '../../economy.ts';
import type { BotEconomyHooks, PlanInput } from '../types.ts';
import { closedSite, epGeometry, foundVertices, isCoastalVertex, isSeaRoute, vertexTouchesFog, type EpGeometry } from './geometry.ts';
import { landExpected } from './explore.ts';
import { remainingTiles } from './inventory.ts';
import { crewWanted } from './missions/lairs.ts';
import { epPlayer, epView, ownShips, type EpView } from './view.ts';

/** 目標船數（計畫 §4.3）：Land Ho! 為 2，有任務時為 3（`EP_PIECES.ships`）。 */
export const shipTarget = (ep: EpView): number => (ep.missions.length > 0 ? 3 : 2);

const HARBOR_VALUE = 1;
const SETTLER_VALUE = 0.7;
const SHIP_VALUE = 0.3;
const CREW_VALUE = 0.6;

/** 同一份 view 只建一次幾何（view 是不可變的投影）。 */
const geometries = new WeakMap<object, EpGeometry | null>();

export function geometryOf(model: Pick<BoardModel, 'view'>): EpGeometry | undefined {
  const cached = geometries.get(model.view);
  if (cached !== undefined) return cached ?? undefined;
  const g = epGeometry(model.view, epView(model.view));
  geometries.set(model.view, g ?? null);
  return g;
}

/** 自己在船與 harbour 上的 settler 數。 */
export function settlersInPlay(ep: EpView, me: string): number {
  const holders = [...ep.ships.filter((ship) => ship.player === me), ...ep.harbors.filter((harbor) => harbor.player === me)];
  return holders.reduce((sum, holder) => sum + holder.cargo.filter((piece) => piece === 'settler').length, 0);
}

/** 任何一條海路邊上都沒有可定居的路口。 */
export function hasFoundSite(g: EpGeometry, me: string): boolean {
  for (let edge = 0; edge < g.topo.edges.length; edge++) {
    if (isSeaRoute(g, edge) && foundVertices(g, edge, me).length > 0) return true;
  }
  return false;
}

/**
 * 供應感知（§4.6）：再造一個 settler 之前，plain 供應扣掉在場的 settler 後仍有空位，而且有可建點、
 * 或剩餘庫存中還有陸地可探索。否則造出來的 settler 沒有地方定居。
 */
export function settlerWanted(g: EpGeometry, me: string): boolean {
  const player = epPlayer(g.ep, me);
  if (!player) return false;
  const inPlay = settlersInPlay(g.ep, me);
  if (inPlay >= EP_PIECES.settlers || player.supply.settlements - inPlay < 1) return false;
  return hasFoundSite(g, me) || landExpected(g, remainingTiles(g));
}

/** 可以升級成 harbour 的自己的沿海聚落。 */
export function harborCandidates(g: EpGeometry, me: string): number[] {
  const out: number[] = [];
  g.view.board.buildings.forEach((building, vertex) => {
    if (building?.player !== me || g.ep.harbors.some((harbor) => harbor.vertex === vertex)) return;
    if (isCoastalVertex(g, vertex)) out.push(vertex);
  });
  return out;
}

function epPlans({ model, base }: PlanInput): readonly Plan[] {
  const g = geometryOf(model);
  const player = g ? epPlayer(g.ep, model.selfId) : undefined;
  if (!g || !player) return [];
  const players = model.view.players.length;
  const plans: Plan[] = [];
  const push = (kind: Plan['kind'], vertex: number | null, cost: Plan['cost'], value: number, immediate = false): void => {
    const eta = etaRounds(base.hand, cost, base.yield, base.rates, players, base.kinds);
    plans.push({ kind, vertex, roads: [], ships: [], cost, nextCost: cost, value, eta, score: value / (1 + eta), ...(immediate ? { immediate } : {}) });
  };
  const harbors = harborCandidates(g, model.selfId);
  if (player.supply.harbors > 0 && harbors.length > 0) push('explorersPirates.harbor', harbors[0]!, EP_COSTS.harbor, HARBOR_VALUE, true);
  if (settlerWanted(g, model.selfId)) push('explorersPirates.settler', null, EP_COSTS.settler, SETTLER_VALUE);
  const hasHarbor = g.ep.harbors.some((harbor) => harbor.player === model.selfId);
  if (hasHarbor && player.supply.ships > 0 && ownShips(g.ep, model.selfId).length < shipTarget(g.ep)) {
    push('explorersPirates.ship', null, EP_COSTS.ship, SHIP_VALUE);
  }
  if (hasHarbor && crewWanted(g, model.selfId)) push('explorersPirates.crew', null, EP_COSTS.crew, CREW_VALUE);
  return plans;
}

export const explorersPiratesEconomy: BotEconomyHooks = {
  awards: () => ({ longestRoad: false }),
  costs: () => ({ harbor: EP_COSTS.harbor, ship: EP_COSTS.ship, settler: EP_COSTS.settler, crew: EP_COSTS.crew }),
  piecesLeft(model) {
    const player = epPlayer(epView(model.view), model.selfId);
    const left: Record<string, number> = player ? { cities: 0, settlements: player.supply.settlements } : {};
    return left;
  },
  routeEdge(model, edge) {
    const g = geometryOf(model);
    if (!g) return undefined;
    const hexes = g.topo.edges[edge]?.hexes ?? [];
    return hexes.every((hex) => !g.fog.has(hex) && !closedSite(g, hex, model.selfId));
  },
  siteBlocked(model, vertex) {
    const g = geometryOf(model);
    if (!g) return false;
    return vertexTouchesFog(g, vertex) || g.topo.vertices[vertex]!.hexes.some((hex) => closedSite(g, hex, model.selfId));
  },
  scoreExtras: epPlans,
};
