/**
 * Rivers of Catan 的策略（T&B 計畫 §4.2 rivers 列；S8）。
 *
 * 規則重點（`TB/rivers/index.ts`）：河上有 7 個橋位，道路不能蓋在橋位上，只能蓋橋（`tb.buildBridge`，`BRIDGE_COST` brick 2、
 * lumber 1，每人 `BRIDGES_PER_PLAYER` 座）。橋接上自己的道路網、算路線但不佔道路存量（S1 已處理 G7）。蓋橋得
 * `BRIDGE_GOLD` gold；在河邊（河流格的路口與邊）蓋聚落或道路得 `RIVER_BUILD_GOLD` gold。財富板塊依目前的 gold：唯一最多者
 * +1，最少者（含並列）−2。12 那一格另有一個 2（`extraNumbers`），S1 已讓 `hexPips` 計入。
 *
 * - 橋以道路計畫評估（`actions`）：base 的道路搜尋會經過空的橋位（它只是一條沒有道路的邊），所以聚落或最長道路計畫的路線上
 *   可能有橋。主要計畫的下一步是橋時：付得起就蓋（`PLAN_BRIDGE_SCORE`，低於立即得分的建造）；付不起時先以銀行交易或 gold
 *   補齊橋的成本（骨架只會照道路的成本補，差一張 brick）。
 * - 其他橋位：付得起時，價值是 gold（每枚 0.5 張資源）加上路線價值（在任一計畫的路線上、或延長最長道路），減去付出的牌，
 *   淨值為正才列為候選。不動用主要計畫已持有的牌時，付出的是過剩的牌，以銀行匯率折價：3 枚 gold 能買 1.5 張指定的牌，比
 *   4:1 換掉 3 張過剩的牌划算，所以過剩的 brick 幾乎總是值得蓋橋。會動用時牌全額計價，淨值還要與立即建造同級
 *   （`HURTING_BRIDGE_MIN`，例如終局時靠 gold 脫離 Poor 或立即獲勝）。
 * - 橋用完之後（`economy.routeEdge`）：道路搜尋不再經過空的橋位，計畫改走陸路，不會停在蓋不了的橋位上。最後一座橋
 *   留給計畫路線：不在任何路線上、只靠 gold 的橋位要有立即建造等級的淨值才蓋。
 * - 河邊的聚落：base 的立即建造分數加上 1 gold 的價值（同一個指令去重後取高分）。河邊的道路不另外估值：道路只為計畫而鋪。
 * - 財富板塊（standard）：gold 的變化另外計入 `wealthValue`（coins 的加權排名價值：離勝利越近權重越高，立即達標時是
 *   `WIN_VALUE`）。排名估值與 coins 共用：買資源不讓自己失分、賣牌脫離 Poor、付出 gold 的報價，都在 `coins.ts`。
 * - easy：有橋位、付得起、不動用主要計畫的牌時照樣蓋，計畫路線上的橋同樣處理；不估排名（§4.2）。
 *
 * 只讀投影與 hints（`targets['tb.buildBridge']` 已檢查連接、橋數與行動階段），合法性以 hints 為準（P2）；回傳候選的鉤子
 * 不消耗亂數，同分依橋位編號（hints 的順序）決勝。
 */

import {
  BRIDGE_COST,
  BRIDGE_GOLD,
  COSTS,
  RIVER_BUILD_GOLD,
  RESOURCES,
  type GameView,
  type TbRiversView,
} from '@catan/rules';
import { playerYield, routeLength, type BoardModel } from '../../board.ts';
import {
  addCosts,
  canAfford,
  longestRoadAwarded,
  PIP_VALUE,
  settlementSpotValue,
  type Cost,
  type Economy,
  type Plan,
} from '../../economy.ts';
import { bankTradeToward } from '../../trade.ts';
import type { BotCommand, Scored, TurnContext } from '../types.ts';
import { CARD_VP, coinsStatus, GOLD_RESOURCE_VALUE, purchaseToward, wealthValue } from './coins.ts';
import type { TbPartBot } from './part.ts';
import { integers, TB_PART_IDS, tbPartView, tbTargets } from './view.ts';

const RIVERS = TB_PART_IDS.rivers;
const BRIDGE = 'tb.buildBridge';

/** 主要計畫路線上的橋：推進計畫的一步，低於立即得分的建造（base 的立即建造 ≥ 1）。 */
export const PLAN_BRIDGE_SCORE = 0.6;
/** 其他計畫路線上的橋：等同一條計畫內的道路（兩張資源）。 */
export const ROUTE_PLAN_VALUE = 2 * CARD_VP;
/** 延長最長道路的橋（profile 有最長道路時）。 */
export const ROUTE_LENGTH_VALUE = 0.1;
/** 動用主要計畫已持有的牌蓋橋時，淨值的下限（勝利分當量，與立即得分的建造同級）。 */
export const HURTING_BRIDGE_MIN = 1;
/** 為主要計畫的橋交易：與 coins 的買資源同級，只是補齊計畫的手段。 */
const BRIDGE_TRADE_SCORE = 0.3;

const command = (type: string, fields: Record<string, unknown>): BotCommand => ({ type, ...fields }) as BotCommand;

function riversView(view: Pick<GameView, 'modules'>): TbRiversView | undefined {
  const slot = tbPartView(view, RIVERS);
  return slot && Array.isArray(slot.bridgeSites) ? slot : undefined;
}

/** 河上的橋位（rules 的 `bridgeSites`）；不是 Rivers 時是空的。 */
export function bridgeSites(view: Pick<GameView, 'modules'>): readonly number[] {
  const slot = riversView(view);
  return slot ? (integers(slot.bridgeSites) ?? []) : [];
}

/** 此刻能蓋橋的橋位（hints；只在自己的行動階段、橋還沒用完時才有）。 */
export function bridgeTargets(view: GameView): readonly number[] {
  return tbTargets(view.hints, BRIDGE);
}

/** 自己還能蓋幾座橋（view 的 `bridges`）；缺漏時視為用完。 */
export function bridgesLeft(view: Pick<GameView, 'modules'>, playerId: string): number {
  const left = riversView(view)?.bridges?.[playerId];
  return typeof left === 'number' && Number.isFinite(left) ? left : 0;
}

/**
 * 道路搜尋能不能經過這條空邊（`economy.routeEdge`）：橋位只能蓋橋，自己的橋用完時回 false，否則計畫的下一步會停在
 * 一個誰都蓋不了的橋位上（rivers、骨架的 `planStep` 與 coins 都不會動手，(c) 又為主要計畫保留著牌）。其他邊回 undefined。
 */
export function bridgeRouteEdge(model: BoardModel, edge: number): boolean | undefined {
  if (!bridgeSites(model.view).includes(edge)) return undefined;
  return bridgesLeft(model.view, model.selfId) > 0 ? undefined : false;
}

/** 河邊的路口（蓋聚落得 gold）。 */
function riverVertices(view: Pick<GameView, 'modules'>): ReadonlySet<number> {
  const slot = riversView(view);
  return new Set(slot ? (integers(slot.vertices) ?? []) : []);
}

/**
 * 收進 `amount` gold 的價值（勝利分當量）：supply 不夠時只拿得到剩下的；每枚 0.5 張資源，standard 另外加上財富板塊的
 * 排名價值。
 */
export function goldGainValue(turn: TurnContext, amount: number): number {
  const { view, ctx } = turn;
  const status = coinsStatus(view, ctx.selfId);
  if (!status) return 0;
  const paid = Math.max(0, Math.min(amount, status.supply));
  if (paid === 0) return 0;
  const cards = paid * GOLD_RESOURCE_VALUE * CARD_VP;
  return turn.level === 'easy' ? cards : cards + wealthValue(view, ctx.selfId, paid);
}

/** 付出 `cost` 之後，主要計畫已持有的牌會不會減少（與骨架的 `hurts` 相同）。 */
function hurtsPrimary(economy: Economy, cost: Cost): boolean {
  const primary = economy.plans[0]?.cost ?? {};
  return RESOURCES.some((resource) => {
    const held = economy.hand[resource];
    return held - (cost[resource] ?? 0) < Math.min(held, primary[resource] ?? 0);
  });
}

/** 付出的過剩牌的價值：每張以銀行匯率折成一張用得上的牌。 */
function surplusCost(economy: Economy, cost: Cost): number {
  return RESOURCES.reduce((sum, resource) => sum + ((cost[resource] ?? 0) * CARD_VP) / (economy.rates[resource] ?? 4), 0);
}

function cardTotal(cost: Cost): number {
  return RESOURCES.reduce((sum, resource) => sum + (cost[resource] ?? 0), 0);
}

/** 計畫的下一條路是橋位：回傳那個橋位。 */
function nextBridgeOf(plan: Plan | undefined, sites: ReadonlySet<number>): number | null {
  if (!plan || (plan.kind !== 'settlement' && plan.kind !== 'longestRoad')) return null;
  const edge = plan.roads[0];
  return edge !== undefined && sites.has(edge) ? edge : null;
}

/** 計畫的總成本換成以橋代替那一條道路（多一張 brick）。 */
function withBridge(plan: Plan): Cost {
  const extra: Cost = {};
  for (const resource of RESOURCES) {
    const more = (BRIDGE_COST[resource] ?? 0) - (COSTS.road[resource] ?? 0);
    if (more > 0) extra[resource] = more;
  }
  return addCosts(plan.cost, extra);
}

/**
 * 主要計畫的下一步是橋：付得起就蓋；付不起時先買或銀行交易補齊橋的成本（一次只回一個指令，下一個決策再看）。
 * 橋位不在 hints 時（沒接上、橋用完）不處理，交給骨架。
 */
function primaryBridgeCandidates(turn: TurnContext, targets: ReadonlySet<number>, sites: ReadonlySet<number>): Scored<BotCommand>[] {
  const economy = turn.economy;
  const plan = economy.plans[0];
  const edge = nextBridgeOf(plan, sites);
  if (!plan || edge === null || !targets.has(edge)) return [];
  if (canAfford(economy.hand, BRIDGE_COST)) {
    return [{ item: command(BRIDGE, { edge }), score: PLAN_BRIDGE_SCORE + goldGainValue(turn, BRIDGE_GOLD) }];
  }
  const total = withBridge(plan);
  const buy = purchaseToward(turn, BRIDGE_COST, total);
  if (buy) return [buy];
  const trade = bankTradeToward(turn.view, economy, BRIDGE_COST, total);
  return trade ? [{ item: trade as BotCommand, score: BRIDGE_TRADE_SCORE }] : [];
}

/** 橋位的路線價值：在任一計畫的路線上，或延長最長道路。 */
function routeValue(turn: TurnContext, edge: number): number {
  const economy = turn.economy;
  if (economy.plans.some((plan) => plan.roads.includes(edge))) return ROUTE_PLAN_VALUE;
  if (!longestRoadAwarded(turn.model, turn.modules)) return 0;
  return routeLength(turn.model, turn.ctx.selfId, [edge]) > economy.myRoute ? ROUTE_LENGTH_VALUE : 0;
}

/**
 * 其他橋位：付得起，淨值（gold + 路線 − 付出的牌）為正。不動用主要計畫已持有的牌時，付出的牌以銀行匯率折價（過剩的牌）；
 * 會動用時每張牌全額計價，而且淨值至少要有 `HURTING_BRIDGE_MIN`（與立即得分的建造同級，例如終局時靠 gold 脫離 Poor
 * 或立即獲勝），否則留給主要計畫。只剩最後一座橋時，不在任何計畫路線上的橋位也要有同樣的淨值，把橋留給路線。
 */
function spareBridgeCandidates(turn: TurnContext, targets: readonly number[], skip: number | null): Scored<BotCommand>[] {
  const economy = turn.economy;
  if (!canAfford(economy.hand, BRIDGE_COST)) return [];
  const hurts = hurtsPrimary(economy, BRIDGE_COST);
  const gold = goldGainValue(turn, BRIDGE_GOLD);
  const cost = hurts ? cardTotal(BRIDGE_COST) * CARD_VP : surplusCost(economy, BRIDGE_COST);
  const last = bridgesLeft(turn.view, turn.ctx.selfId) <= 1;
  const out: Scored<BotCommand>[] = [];
  for (const edge of targets) {
    if (edge === skip) continue;
    const route = routeValue(turn, edge);
    // 最後一座橋留給計畫路線：只靠 gold 的橋（淨值約 +0.15）要有立即建造等級的價值才蓋。
    const floor = hurts || (last && route === 0) ? HURTING_BRIDGE_MIN : 0;
    const net = gold + route - cost;
    if (net > floor) out.push({ item: command(BRIDGE, { edge }), score: net });
  }
  return out;
}

/** 河邊的聚落：base 的立即建造分數（`buildDecision` 的公式）加上 1 gold 的價值；去重後取高分。 */
function riverSettlementCandidates(turn: TurnContext): Scored<BotCommand>[] {
  const { view, model, ctx } = turn;
  const economy = turn.economy;
  if (economy.left.settlements <= 0 || !canAfford(economy.hand, COSTS.settlement)) return [];
  const river = riverVertices(view);
  const legal = (view.hints?.legalSettlements ?? []).filter((vertex) => river.has(vertex));
  if (legal.length === 0) return [];
  const gold = goldGainValue(turn, RIVER_BUILD_GOLD);
  if (gold <= 0) return [];
  const mine = playerYield(model, ctx.selfId, true);
  return legal.map((vertex) => ({
    item: command('build.settlement', { vertex }),
    score: 1 + PIP_VALUE * settlementSpotValue(model, vertex, economy.weights, mine) + gold,
  }));
}

/** `tb.buildBridge` 與河邊建造的候選。 */
export function riversCandidates(turn: TurnContext): Scored<BotCommand>[] {
  if (!riversView(turn.view)) return [];
  const sites = new Set(bridgeSites(turn.view));
  const targets = bridgeTargets(turn.view);
  const out: Scored<BotCommand>[] = [];
  if (targets.length > 0) {
    out.push(...primaryBridgeCandidates(turn, new Set(targets), sites));
    out.push(...spareBridgeCandidates(turn, targets, nextBridgeOf(turn.economy.plans[0], sites)));
  }
  out.push(...riverSettlementCandidates(turn));
  return out;
}

export const riversBot: TbPartBot = {
  id: RIVERS,
  actions: riversCandidates,
  economy: { routeEdge: bridgeRouteEdge },
};
