/**
 * Coins（gold 買賣與估值）的策略（T&B 計畫 §4.2）。gold 是公開的 goods，不是手牌，也不算進手牌上限。
 *
 * - 估值：1 gold = 0.5 資源當量（`GOLD_PER_RESOURCE` = 2 gold 換一張任選資源）。
 * - `tb.buyResource`：只在買完（必要時再加銀行交易）就能做主要計畫的下一步時才買；每回合最多 `PURCHASES_PER_TURN` 次
 *   （rules 以 view 的 `purchasesLeft` 執行）。base 的立即建造付得起時不買。standard 與 easy 都會買。
 * - `tb.sellResources`（只有 standard）：Rivers 能靠賣出脫離 Poor（−2 VP）時；或手牌超過上限、而銀行交易換不到牌時（gold 不算手牌）。
 * - Rivers 的財富板塊（唯一最多 +1、最少含並列 −2）：standard 買資源前先確認不會因此失分；付出 gold 會失分的報價一律拒絕。
 *   完整的排名估值在 S8（rivers），它可以直接用 `wealthDelta`、`sellCandidates`。
 * - Traders：買資源與報價付出都不動用為過路費保留的 gold（`traders.ts` 的 `tollReserve`，§4.2 Traders 列）。
 * - 報價（規則 9）：`trade.goods` 回傳各玩家公開的 gold；`trade.goodValue` standard 以 0.5 × 張數估值；收進的 gold 買不了時（本回合購買
 *   次數用完，或 gold 已多到用不完）再折價；付出時固定以銀行價格估值、不動用過路費保留；easy 回 null，一律拒絕含 goods
 *   的報價。兩者都不主動提出 gold 報價（骨架不提）。
 *
 * 所有鉤子只讀 view、hints 與經濟模型，不消耗亂數、不 throw。
 */

import {
  COSTS,
  GOLD_PER_RESOURCE,
  PURCHASES_PER_TURN,
  RESOURCES,
  type GameView,
  type Resource,
} from '@catan/rules';
import { canAfford, deficitOf, handSize, type Economy, type Hand } from '../../economy.ts';
import { bankTradeToward } from '../../trade.ts';
import type { BotCommand, Scored, TurnContext } from '../types.ts';
import type { TbPartBot } from './part.ts';
import { tollReserve } from './traders.ts';
import { goldOf, TB_PART_IDS, tbPartHints, tbPartIdsOfView, tbPartView } from './view.ts';

/** 一枚 gold 的資源當量。 */
export const GOLD_RESOURCE_VALUE = 1 / GOLD_PER_RESOURCE;
/** 暫時用不掉的 gold 的折價係數（本回合買不了，或 gold 多到用不完）。 */
export const IDLE_GOLD_FACTOR = 0.6;
/** 持有至少這麼多 gold 時，再收進的 gold 短期內用不完（兩回合的購買量）。 */
export const GOLD_HOARD = 2 * PURCHASES_PER_TURN * GOLD_PER_RESOURCE;

/** 買資源候選的分數：只是補齊計畫的手段，低於任何立即建造（base 的立即建造 ≥ 1）。 */
const BUY_SCORE = 0.3;
/** 手牌超過上限時賣出的分數：只在其他消化方式都不可行時才會出現。 */
const RELIEF_SELL_SCORE = 0.2;

const WEALTHIEST_POINTS = 1;
const POOR_POINTS = -2;

const command = (type: string, fields: Record<string, unknown>): BotCommand => ({ type, ...fields }) as BotCommand;

/** 自己的 gold 與本視窗的購買狀態；沒有 coins part 時是 null。 */
export interface CoinsStatus {
  readonly gold: number;
  readonly purchasesLeft: number;
  readonly supply: number;
  /** 自己的行動階段、沒有待決效果（hints 的 `canTrade`）。 */
  readonly canTrade: boolean;
  /** 賣出一次要付的張數（港口比率）。 */
  readonly sellRates: Readonly<Record<Resource, number>>;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function coinsStatus(view: GameView, selfId: string): CoinsStatus | null {
  const coins = tbPartView(view, TB_PART_IDS.coins);
  if (!coins) return null;
  const hints = tbPartHints(view.hints, TB_PART_IDS.coins);
  const rates = (hints?.sellRates ?? {}) as Partial<Record<Resource, number>>;
  return {
    gold: goldOf(view, selfId),
    purchasesLeft: finite(coins.purchasesLeft, 0),
    supply: finite(coins.supply, 0),
    canTrade: hints?.canTrade === true,
    sellRates: Object.fromEntries(RESOURCES.map((resource) => [resource, finite(rates[resource], 4)])) as Record<Resource, number>,
  };
}

/** 這一局有沒有某個 part。 */
function hasPart(view: GameView, part: string): boolean {
  return tbPartIdsOfView(view).includes(part);
}

/** Rivers 財富板塊的分數（與 rules 的 `wealth` 相同：唯一最多 +1，最少含並列 −2）。 */
function wealthPoints(golds: readonly { id: string; gold: number }[], selfId: string): number {
  const amounts = golds.map((entry) => entry.gold);
  const most = Math.max(...amounts);
  const least = Math.min(...amounts);
  const mine = golds.find((entry) => entry.id === selfId)?.gold ?? 0;
  const top = golds.filter((entry) => entry.gold === most).length;
  return (mine === most && top === 1 ? WEALTHIEST_POINTS : 0) + (mine === least ? POOR_POINTS : 0);
}

/**
 * 自己的 gold 變動 `delta` 時，Rivers 財富板塊的分數變化（其他人的 gold 不變）。不是 Rivers 時恆為 0。
 * S8（rivers）可以直接呼叫它估排名效果。
 */
export function wealthDelta(view: GameView, selfId: string, delta: number): number {
  if (!hasPart(view, TB_PART_IDS.rivers)) return 0;
  const golds = view.players.map((player) => ({ id: player.id, gold: goldOf(view, player.id) }));
  const after = golds.map((entry) => (entry.id === selfId ? { id: entry.id, gold: entry.gold + delta } : entry));
  return wealthPoints(after, selfId) - wealthPoints(golds, selfId);
}


/** base 的立即建造（城市、聚落）現在付得起而且有合法位置：那就先蓋，不買。 */
function immediateBuildAffordable(turn: TurnContext): boolean {
  const hints = turn.view.hints;
  if (!hints) return false;
  const { hand, left } = turn.economy;
  if (left.cities > 0 && canAfford(hand, COSTS.city) && hints.legalCities.length > 0) return true;
  return left.settlements > 0 && canAfford(hand, COSTS.settlement) && hints.legalSettlements.length > 0;
}

/**
 * 計畫的下一步湊齊之後能不能做。base 的種類比照骨架的 `planStep` 檢查合法性；模組計畫交給它的 part（這裡無從得知，視為可以）。
 */
function planExecutable(turn: TurnContext, plan: Economy['plans'][number]): boolean {
  const { view } = turn;
  const hints = view.hints;
  if (!hints) return false;
  const { left } = turn.economy;
  switch (plan.kind) {
    case 'city':
      return plan.vertex !== null && hints.legalCities.includes(plan.vertex) && left.cities > 0;
    case 'settlement':
      if (plan.roads.length === 0) {
        return plan.vertex !== null && hints.legalSettlements.includes(plan.vertex) && left.settlements > 0;
      }
      return hints.legalRoads.includes(plan.roads[0]!) && left.roads > 0;
    case 'longestRoad':
      return plan.roads[0] !== undefined && hints.legalRoads.includes(plan.roads[0]) && left.roads > 0;
    case 'devCard':
      return view.devDeckSize > 0;
    default:
      return true;
  }
}

/**
 * 買哪一種資源補主要計畫：缺最多的優先，再依權重高者、`RESOURCES` 順序決勝；銀行沒有的不買。回傳依序要買的資源
 * （最多 `count` 張）。
 */
function purchaseOrder(view: GameView, missing: Hand, weights: Economy['weights'], count: number): Resource[] {
  const left = { ...missing };
  const bank = { ...view.bank };
  const out: Resource[] = [];
  while (out.length < count) {
    const next = RESOURCES.filter((resource) => left[resource] > 0 && bank[resource] > 0).sort(
      (a, b) => left[b] - left[a] || weights[b] - weights[a] || RESOURCES.indexOf(a) - RESOURCES.indexOf(b),
    )[0];
    if (!next) break;
    out.push(next);
    left[next] -= 1;
    bank[next] -= 1;
  }
  return out;
}

/**
 * `tb.buyResource` 的候選：買完（不夠時再加銀行交易）就能做主要計畫的下一步，才回傳下一張要買的資源。
 * standard 另外確認 Rivers 的財富板塊不會因此失分；easy 不估排名（§4.2）。
 */
export function buyCandidates(turn: TurnContext): Scored<BotCommand>[] {
  const { view, ctx } = turn;
  const status = coinsStatus(view, ctx.selfId);
  if (!status || !status.canTrade || status.purchasesLeft <= 0) return [];
  const affordable = Math.floor((status.gold - tollReserve(view)) / GOLD_PER_RESOURCE);
  const buyable = Math.min(status.purchasesLeft, affordable);
  if (buyable <= 0) return [];
  const economy = turn.economy;
  const plan = economy.plans[0];
  if (!plan || immediateBuildAffordable(turn) || !planExecutable(turn, plan)) return [];
  const missing = deficitOf(economy.hand, plan.nextCost);
  const short = RESOURCES.reduce((sum, resource) => sum + missing[resource], 0);
  if (short === 0) return [];
  const order = purchaseOrder(view, missing, economy.weights, Math.min(short, buyable));
  if (order.length === 0) return [];
  // 買完之後要嘛已經付得起，要嘛剩下的缺口銀行交易補得齊（`bankTradeToward` 全部補得起才回傳交易）。
  const hand: Hand = { ...economy.hand };
  for (const resource of order) hand[resource] += 1;
  const covered =
    canAfford(hand, plan.nextCost) || bankTradeToward(view, { ...economy, hand }, plan.nextCost, plan.cost) !== null;
  if (!covered) return [];
  if (turn.level !== 'easy' && wealthDelta(view, ctx.selfId, -GOLD_PER_RESOURCE) < 0) return [];
  return [{ item: command('tb.buyResource', { resource: order[0]! }), score: BUY_SCORE }];
}

/** 賣哪一種資源：超出主要計畫的張數減去比率最多者優先，再依權重低者、`RESOURCES` 順序。`surplusOnly` 時只賣超出計畫的牌。 */
function saleResource(turn: TurnContext, rates: Readonly<Record<Resource, number>>, surplusOnly: boolean): Resource | null {
  const economy = turn.economy;
  const target = economy.plans[0]?.cost ?? {};
  const options = RESOURCES.filter((resource) => {
    const held = economy.hand[resource];
    if (held < rates[resource]) return false;
    return !surplusOnly || held - (target[resource] ?? 0) >= rates[resource];
  });
  const spare = (resource: Resource): number => economy.hand[resource] - (target[resource] ?? 0) - rates[resource];
  return (
    options.sort(
      (a, b) =>
        spare(b) - spare(a) || economy.weights[a] - economy.weights[b] || RESOURCES.indexOf(a) - RESOURCES.indexOf(b),
    )[0] ?? null
  );
}

/** 手牌超過上限時 base 還有沒有別的消化方式（`handRelief` 的發展卡、道路、銀行交易；只看可行性）。 */
function baseReliefAvailable(turn: TurnContext): boolean {
  const { view } = turn;
  const economy = turn.economy;
  const { hand, left, rates, kinds } = economy;
  if (view.devDeckSize > 0 && canAfford(hand, COSTS.devCard)) return true;
  if (left.roads > 0 && canAfford(hand, COSTS.road) && (view.hints?.legalRoads.length ?? 0) > 0) return true;
  const target = economy.plans[0]?.cost ?? {};
  return kinds.some((give) => {
    const rate = rates[give];
    if (rate === undefined || (hand[give] ?? 0) - (target[give] ?? 0) < rate) return false;
    return RESOURCES.some((receive) => receive !== give && view.bank[receive] > 0);
  });
}

/**
 * `tb.sellResources` 的候選（只有 standard；easy 只買不賣）：
 * 1. Rivers：賣一次就能脫離 Poor（−2 VP）。分數高於立即建造，可以動用計畫內的牌（2 VP 比幾張牌值錢），超出計畫的牌優先。
 * 2. 手牌超過上限，而 base 的消化方式（發展卡、道路、銀行交易）都不可行：只賣超出計畫的牌。
 */
export function sellCandidates(turn: TurnContext): Scored<BotCommand>[] {
  if (turn.level === 'easy') return [];
  const { view, ctx } = turn;
  const status = coinsStatus(view, ctx.selfId);
  if (!status || !status.canTrade || status.supply <= 0) return [];
  const escape = wealthDelta(view, ctx.selfId, 1);
  if (escape >= -POOR_POINTS) {
    const resource = saleResource(turn, status.sellRates, false);
    if (resource) return [{ item: command('tb.sellResources', { resource }), score: escape }];
  }
  const economy = turn.economy;
  if (handSize(economy.hand) > economy.handLimit && !baseReliefAvailable(turn)) {
    const resource = saleResource(turn, status.sellRates, true);
    if (resource) return [{ item: command('tb.sellResources', { resource }), score: RELIEF_SELL_SCORE }];
  }
  return [];
}

/**
 * `amount` 個 gold 在 `side` 這一方的資源當量（`trade.goodValue`）。easy 回 null（拒絕含 goods 的報價）。standard：
 * - 收進（`'receive'`）：0.5 × 張數；本回合買不了（自己的行動視窗、購買次數用完）或持有至少 `GOLD_HOARD` 時乘
 *   `IDLE_GOLD_FACTOR`。收進 gold 不會失去財富板塊，所以不看 Rivers 的排名（排名加分留給 S8）。
 * - 付出（`'pay'`）：固定 0.5 × 張數，也就是銀行的價格（`GOLD_PER_RESOURCE` gold 換一張），不折價：折價會讓對手用
 *   低於銀行的價格買走 gold，再向銀行換牌套利。超出「持有減去 Traders 過路費保留」的部分不付（null）；Rivers 裡付出後
 *   財富板塊會失分時也不付（保守，R3）。
 */
export function goldValue(turn: TurnContext, amount: number, side: 'receive' | 'pay'): number | null {
  if (turn.level === 'easy') return null;
  if (!(amount > 0)) return 0;
  const { view, ctx } = turn;
  const status = coinsStatus(view, ctx.selfId);
  if (!status) return null;
  if (side === 'pay') {
    if (amount > status.gold - tollReserve(view)) return null;
    if (wealthDelta(view, ctx.selfId, -amount) < 0) return null;
    return amount * GOLD_RESOURCE_VALUE;
  }
  const acting = view.turn.playerId === ctx.selfId && view.turn.phase === 'action';
  const idle = (acting && status.purchasesLeft <= 0) || status.gold >= GOLD_HOARD;
  return amount * GOLD_RESOURCE_VALUE * (idle ? IDLE_GOLD_FACTOR : 1);
}

export const coinsBot: TbPartBot = {
  id: TB_PART_IDS.coins,
  actions: (turn) => [...sellCandidates(turn), ...buyCandidates(turn)],
  trade: {
    goods: (view, playerId): Readonly<Record<string, number>> =>
      tbPartView(view, TB_PART_IDS.coins) ? { gold: goldOf(view, playerId) } : {},
    goodValue: (turn, good, amount, side) => (good === 'gold' ? goldValue(turn, amount, side) : undefined),
  },
};
