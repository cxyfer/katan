/**
 * 經濟評估：手牌、成本缺口、資源權重、產能速率與建造計畫。
 */

import { COSTS, RESOURCES, type Resource } from '@catan/rules';
import {
  emptyYield,
  isFreeSpot,
  piecesLeft,
  playerYield,
  roadPath,
  routeLength,
  searchRoads,
  vertexYield,
  yieldTotal,
  type BoardModel,
  type PieceCounts,
  type RoadSearch,
  type Yield,
} from './board.ts';
import type { BotModule } from './modules/types.ts';
import type { BotLevel } from './types.ts';

export type Hand = Record<Resource, number>;
export type Cost = Partial<Record<Resource, number>>;

/** 建造計畫所需的最多新道路數；更遠的空點視為暫時到不了。 */
export const MAX_PLAN_ROADS = 3;

export function handOf(model: BoardModel, playerId: string = model.selfId): Hand {
  const resources = model.view.players.find((player) => player.id === playerId)?.resources;
  return resources ? { ...resources } : { ...emptyYield() };
}

export function handSize(hand: Hand): number {
  return RESOURCES.reduce((sum, resource) => sum + hand[resource], 0);
}

export function addCosts(...costs: Cost[]): Cost {
  const out: Cost = {};
  for (const cost of costs) {
    for (const resource of RESOURCES) {
      const amount = cost[resource] ?? 0;
      if (amount > 0) out[resource] = (out[resource] ?? 0) + amount;
    }
  }
  return out;
}

export function scaleCost(cost: Cost, factor: number): Cost {
  const out: Cost = {};
  for (const resource of RESOURCES) {
    const amount = (cost[resource] ?? 0) * factor;
    if (amount > 0) out[resource] = amount;
  }
  return out;
}

export function deficitOf(hand: Hand, cost: Cost): Hand {
  const out = { ...emptyYield() };
  for (const resource of RESOURCES) out[resource] = Math.max(0, (cost[resource] ?? 0) - hand[resource]);
  return out;
}

export function canAfford(hand: Hand, cost: Cost): boolean {
  return RESOURCES.every((resource) => hand[resource] >= (cost[resource] ?? 0));
}

export function pay(hand: Hand, cost: Cost): Hand {
  const out = { ...hand };
  for (const resource of RESOURCES) out[resource] -= cost[resource] ?? 0;
  return out;
}

/** 依盤面稀有度調整的資源權重：越少見的資源越有價值。 */
export function resourceWeights(model: BoardModel): Record<Resource, number> {
  const totals = emptyYield();
  model.hexResource.forEach((resource, hex) => {
    if (resource) totals[resource] += model.hexPips[hex]!;
  });
  const mean = yieldTotal(totals) / RESOURCES.length;
  const out = { ...emptyYield() };
  for (const resource of RESOURCES) {
    const ratio = totals[resource] > 0 ? mean / totals[resource] : 1.4;
    out[resource] = Math.min(1.3, Math.max(0.8, Math.sqrt(ratio)));
  }
  return out;
}

export function weightedPips(value: Yield, weights: Record<Resource, number>): number {
  return RESOURCES.reduce((sum, resource) => sum + value[resource] * weights[resource], 0);
}

export type BasePlanKind = 'city' | 'settlement' | 'devCard' | 'longestRoad';
/** base 的四種計畫，加上模組計畫（kind 為 `<module id>.<名稱>`）。 */
export type PlanKind = BasePlanKind | `${string}.${string}`;

export interface Plan {
  kind: PlanKind;
  /** 目標路口（城市、聚落）。 */
  vertex: number | null;
  /** 需要先建的道路，依建造順序排列。 */
  roads: number[];
  /**
   * 需要先造的船（edge index），依建造順序排列；base 計畫恆為 `[]`。模組計畫（例如 Seafarers 的
   * 島嶼聚落）才會有值。省略時視為 `[]`：已有的模組計畫字面值不必逐一補上。
   */
  ships?: number[];
  /** 整個計畫的總成本（含道路）。 */
  cost: Cost;
  /** 下一步的成本：道路未完成時為一條道路，否則為目標本身。 */
  nextCost: Cost;
  /** 以勝利分為單位的估計價值。 */
  value: number;
  /** 估計還要幾輪才能湊齊資源。 */
  eta: number;
  score: number;
  /** 下一步完成就得分（主動開價的條件）；省略時：city，或 roads 為空的 settlement。 */
  immediate?: boolean;
}

/** 計畫完成後是否立即得分（見 `Plan.immediate`）。 */
export function isImmediate(plan: Plan): boolean {
  return plan.immediate ?? (plan.kind === 'city' || (plan.kind === 'settlement' && plan.roads.length === 0));
}

export interface Economy {
  readonly model: BoardModel;
  readonly hand: Hand;
  /** 剩餘棋子；模組可加上自己的鍵（例如 ships），也可覆寫 base 的鍵。 */
  readonly left: Readonly<PieceCounts> & Readonly<Record<string, number>>;
  /** base 的四種成本，加上模組的具名成本。 */
  readonly costs: Readonly<Record<string, Cost>>;
  readonly weights: Record<Resource, number>;
  /** 自己目前（排除強盜格）的點數產能。 */
  readonly yield: Yield;
  readonly rates: Record<Resource, number>;
  readonly search: RoadSearch;
  readonly myRoute: number;
  readonly plans: Plan[];
}

export const PIP_VALUE = 0.07;

export function settlementSpotValue(model: BoardModel, vertex: number, weights: Record<Resource, number>, mine: Yield): number {
  const spot = vertexYield(model, vertex);
  let value = weightedPips(spot, weights);
  for (const resource of RESOURCES) {
    if (spot[resource] > 0 && mine[resource] === 0) value += 2.5;
  }
  const harbor = model.harborAt[vertex];
  if (harbor === 'generic') value += 1.5;
  else if (harbor && mine[harbor as Resource] + spot[harbor as Resource] >= 4) value += 2.5;
  return value;
}

/** 依缺口與產能估計湊齊成本需要的輪數；過剩資源可先以銀行匯率換成缺口。 */
export function etaRounds(
  hand: Hand,
  cost: Cost,
  mine: Yield,
  rates: Record<Resource, number>,
  players: number,
): number {
  const missing = deficitOf(hand, cost);
  let total = RESOURCES.reduce((sum, resource) => sum + missing[resource], 0);
  if (total === 0) return 0;
  let tradeable = 0;
  for (const resource of RESOURCES) {
    const surplus = hand[resource] - (cost[resource] ?? 0);
    if (surplus > 0) tradeable += Math.floor(surplus / rates[resource]);
  }
  const covered = Math.min(total, tradeable);
  total -= covered;
  if (total === 0) return 0.25;
  // 每輪有 players 次擲骰；以期望產量估算，換匯能力取最好的匯率。
  const perRound = (resource: Resource) => (mine[resource] * players) / 36;
  const income = RESOURCES.reduce((sum, resource) => sum + perRound(resource), 0);
  const bestRate = Math.min(...RESOURCES.map((resource) => rates[resource]));
  const viaTrade = income / bestRate / 2;
  let rounds = 0;
  let remaining = covered;
  // 換匯先補產量最低的缺口。
  const order = RESOURCES.slice().sort((a, b) => perRound(a) - perRound(b));
  for (const resource of order) {
    let need = missing[resource];
    const used = Math.min(need, remaining);
    need -= used;
    remaining -= used;
    if (need > 0) rounds += need / Math.max(perRound(resource), viaTrade, 0.05);
  }
  return rounds;
}

/** 依序合併；同一個鍵先出現的值優先。 */
function mergeFirstWins<T>(layers: readonly Readonly<Record<string, T>>[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (!Object.hasOwn(out, key)) out[key] = value;
    }
  }
  return out;
}

/**
 * 經濟評估：base 加上各模組的 economy 鉤子。模組清單為空時，結果與只有 base 完全相同。
 * 模組計畫同分時排在 base 種類之後。
 */
export function economyOf(
  model: BoardModel,
  modules: readonly BotModule[] = [],
  level: BotLevel = 'standard',
): Economy {
  const base = baseEconomyOf(model, modules);
  // 不遞迴：scoreExtras 拿不到 TurnContext，只看 base 經濟。
  const extras: Plan[] = [];
  for (const module of modules) extras.push(...(module.economy?.scoreExtras?.({ model, level, base }) ?? []));
  if (extras.length === 0) return base;
  return { ...base, plans: [...base.plans, ...extras].sort(comparePlans) };
}

function baseEconomyOf(model: BoardModel, modules: readonly BotModule[]): Economy {
  const { view, selfId } = model;
  const hand = handOf(model);
  const left = {
    ...piecesLeft(model, selfId),
    ...mergeFirstWins(modules.map((module) => module.economy?.piecesLeft?.(model) ?? {})),
  };
  // base 的鍵不可覆寫：base 計畫直接讀 COSTS。
  const costs = {
    ...mergeFirstWins(modules.map((module) => module.economy?.costs?.(model) ?? {})),
    ...COSTS,
  };
  const weights = resourceWeights(model);
  const mine = playerYield(model, selfId);
  const longTerm = playerYield(model, selfId, true);
  const rates = view.hints?.bankRates ?? { lumber: 4, brick: 4, wool: 4, grain: 4, ore: 4 };
  const search = searchRoads(model, selfId, Math.min(MAX_PLAN_ROADS, Math.max(0, left.roads)));
  const players = view.players.length;
  const me = view.players.find((player) => player.id === selfId);
  const plans: Plan[] = [];
  const push = (plan: Omit<Plan, 'eta' | 'score'>): void => {
    const eta = etaRounds(hand, plan.cost, mine, rates, players);
    plans.push({ ...plan, eta, score: plan.value / (1 + eta) });
  };

  // 城市：選產能最高的聚落升級。
  if (left.cities > 0) {
    let best = -1;
    let bestValue = -Infinity;
    view.board.buildings.forEach((building, vertex) => {
      if (!building || building.player !== selfId || building.city) return;
      const value = weightedPips(vertexYield(model, vertex), weights);
      if (value > bestValue) {
        bestValue = value;
        best = vertex;
      }
    });
    if (best >= 0) {
      push({
        kind: 'city',
        vertex: best,
        roads: [],
        ships: [],
        cost: COSTS.city,
        nextCost: COSTS.city,
        value: 1 + PIP_VALUE * bestValue,
      });
    }
  }

  // 聚落：道路網可達、且符合距離規則的空點。
  if (left.settlements > 0) {
    const legalNow = new Set(view.hints?.legalSettlements ?? []);
    const candidates: Plan[] = [];
    for (let vertex = 0; vertex < model.topo.vertices.length; vertex++) {
      const distance = search.distance[vertex]!;
      if (distance === Infinity || !isFreeSpot(model, vertex)) continue;
      const roads = distance === 0 ? [] : roadPath(search, vertex);
      if (distance === 0 && !legalNow.has(vertex)) continue;
      if (roads.length > left.roads) continue;
      const roadCost = scaleCost(COSTS.road, roads.length);
      const cost = addCosts(COSTS.settlement, roadCost);
      // 越遠越可能被別人搶先，價值打折。
      const value = (1 + PIP_VALUE * settlementSpotValue(model, vertex, weights, longTerm)) * 0.9 ** roads.length;
      const eta = etaRounds(hand, cost, mine, rates, players) + roads.length * 0.35;
      candidates.push({
        kind: 'settlement',
        vertex,
        roads,
        ships: [],
        cost,
        nextCost: roads.length > 0 ? COSTS.road : COSTS.settlement,
        value,
        eta,
        score: value / (1 + eta),
      });
    }
    candidates.sort((a, b) => b.score - a.score || a.vertex! - b.vertex!);
    plans.push(...candidates.slice(0, 3));
  }

  // 發展卡：牌庫非空就是一條穩定的得分路線；接近最大騎士團時加值。
  if (view.devDeckSize > 0) {
    let value = 0.55;
    const myKnights = me?.playedKnights ?? 0;
    const holder = view.awards.largestArmy;
    const holderKnights = holder ? view.players.find((player) => player.id === holder)?.playedKnights ?? 0 : 0;
    if (holder !== selfId && myKnights + 2 >= Math.max(3, holderKnights + 1)) value += 0.25;
    // 沒有聚落點也沒有城市可蓋時，發展卡是剩下的得分路線。
    if (!plans.some((plan) => plan.kind === 'settlement' || plan.kind === 'city')) value += 0.3;
    push({ kind: 'devCard', vertex: null, roads: [], ships: [], cost: COSTS.devCard, nextCost: COSTS.devCard, value });
  }

  // 最長道路：差一兩條就能拿到時才值得專門投資。
  const myRoute = routeLength(model, selfId);
  if (left.roads > 0) {
    const holder = view.awards.longestRoad;
    if (holder !== selfId) {
      const holderLength = holder ? view.players.find((player) => player.id === holder)?.longestRoadLength ?? 0 : 0;
      const needed = Math.max(5, holderLength + 1) - myRoute;
      if (needed >= 1 && needed <= 2 && needed <= left.roads) {
        const edge = bestRouteEdge(model, view.hints?.legalRoads ?? [], myRoute);
        if (edge !== null) {
          push({
            kind: 'longestRoad',
            vertex: null,
            roads: [edge],
            ships: [],
            cost: scaleCost(COSTS.road, needed),
            nextCost: COSTS.road,
            value: needed === 1 ? 1.8 : 1.4,
          });
        }
      }
    }
  }

  plans.sort(comparePlans);
  return { model, hand, left, costs, weights, yield: mine, rates, search, myRoute, plans };
}

function comparePlans(a: Plan, b: Plan): number {
  return b.score - a.score || planOrder(a) - planOrder(b);
}

const BASE_KIND_ORDER: readonly string[] = ['city', 'settlement', 'longestRoad', 'devCard'];

/**
 * base 種類依序為 0–3，再以路口編號打破同分（路口數最多 174，間距 1000 不會重疊）。模組計畫一律
 * 排在後面，而且共用同一個鍵、不加路口編號：同分時靠穩定排序保留串接順序，也就是先依模組順序、
 * 再依模組內的順序；若以路口編號排序，後面模組的計畫可能插到前面模組的計畫之前。
 */
function planOrder(plan: Plan): number {
  const rank = BASE_KIND_ORDER.indexOf(plan.kind);
  if (rank < 0) return BASE_KIND_ORDER.length * 1000;
  return rank * 1000 + (plan.vertex ?? 0);
}

/** 能讓自己最長道路變長的合法道路；沒有則回傳 null。 */
export function bestRouteEdge(model: BoardModel, legalRoads: readonly number[], current: number): number | null {
  let best: number | null = null;
  let bestLength = current;
  for (const edge of legalRoads) {
    const length = routeLength(model, model.selfId, [edge]);
    if (length > bestLength) {
      bestLength = length;
      best = edge;
    }
  }
  return best;
}
