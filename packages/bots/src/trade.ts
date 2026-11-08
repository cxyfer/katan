/**
 * 交易：手牌效用、報價評估、自己報價的生命週期、銀行交易與開價條件。
 */

import { RESOURCES, type CardKind, type Command, type GameView, type Offer, type Resource } from '@catan/rules';
import { plannedBank } from './bank.ts';
import {
  canAfford,
  deficitOf,
  pay,
  type Cost,
  type Economy,
  type Hand,
} from './economy.ts';
import type { OfferPhase } from './types.ts';

/** 每個行動視窗最多主動開價次數（規格 §5）。 */
export const MAX_OFFERS_PER_WINDOW = 2;

function costTotal(cost: Cost): number {
  return RESOURCES.reduce((sum, resource) => sum + (cost[resource] ?? 0), 0);
}

/** 以目標成本衡量的手牌效用：目標內的牌價值高，過剩的牌依匯率折價。 */
export function handUtility(economy: Economy, hand: Hand, target: Cost): number {
  let utility = 0;
  for (const resource of RESOURCES) {
    const need = target[resource] ?? 0;
    const useful = Math.min(hand[resource], need);
    const extra = Math.max(0, hand[resource] - need);
    const liquidity = 0.45 + (4 - economy.rates[resource]) * 0.2;
    utility += useful * 3 + extra * liquidity * economy.weights[resource];
  }
  if (canAfford(hand, target)) utility += 2;
  return utility;
}

/** 接受報價後效用的變化；付不起時回傳 -Infinity。報價條款以提出者的角度記錄。 */
export function offerGain(economy: Economy, offer: Offer): number {
  const hand = economy.hand;
  if (!canAfford(hand, offer.want)) return -Infinity;
  const target = economy.plans[0]?.cost ?? {};
  const after = pay(addHand(hand, offer.give), offer.want);
  return handUtility(economy, after, target) - handUtility(economy, hand, target);
}

function addHand(hand: Hand, cost: Cost): Hand {
  const out = { ...hand };
  for (const resource of RESOURCES) out[resource] += cost[resource] ?? 0;
  return out;
}

/**
 * 規則 9：報價只含 Bot 估得了價的東西。含非資源卡種，或任何 goods 的報價無法估值，
 * 一律拒絕（不接受、不結算）。base 的報價必定通過：引擎只保留正數的卡種，goods 總數為 0
 * 時會刪掉該欄位。
 */
export function offerTermsKnown(offer: Offer): boolean {
  const known = (terms: Partial<Record<CardKind, number>>): boolean =>
    Object.entries(terms).every(([kind, amount]) => !(amount! > 0) || (RESOURCES as readonly string[]).includes(kind));
  const noGoods = (goods?: Record<string, number>): boolean =>
    !goods || Object.values(goods).every((amount) => !(amount > 0));
  return known(offer.give) && known(offer.want) && noGoods(offer.giveGoods) && noGoods(offer.wantGoods);
}

/** 對手接近勝利時不幫他；領先越多，要求的好處越大。 */
export function acceptMargin(view: GameView, selfId: string, proposerId: string, base: number): number {
  const proposer = view.players.find((player) => player.id === proposerId);
  const me = view.players.find((player) => player.id === selfId);
  if (!proposer || !me) return Infinity;
  if (proposer.publicScore >= view.victoryTarget - 2) return Infinity;
  const lead = proposer.publicScore - me.publicScore;
  return base + Math.max(0, lead - 1) * 0.75;
}

/** 收件人包含自己、仍 open、且自己尚未回應的報價。 */
export function offersAwaitingMe(view: GameView, selfId: string): Offer[] {
  return view.offers.filter(
    (offer) =>
      offer.status === 'open' &&
      offer.windowId === view.windowId &&
      offer.from !== selfId &&
      (offer.to === 'all' || offer.to === selfId) &&
      offer.responses[selfId] === undefined,
  );
}

export function ownOpenOffers(view: GameView, selfId: string): Offer[] {
  return view.offers.filter(
    (offer) => offer.status === 'open' && offer.windowId === view.windowId && offer.from === selfId,
  );
}

function responders(view: GameView, offer: Offer): string[] {
  if (offer.to !== 'all') return [offer.to];
  return view.players.map((player) => player.id).filter((id) => id !== offer.from);
}

/**
 * 自己報價的下一步：結算、撤回，或回傳 null 繼續等待。只看階段，不看時間。
 */
export function ownOfferStep(
  view: GameView,
  economy: Economy,
  offer: Offer,
  phase: OfferPhase,
  canSettle: boolean,
): Command | null {
  const withdraw: Command = { type: 'trade.withdraw', offerId: offer.id };
  if (!canSettle || !canAfford(economy.hand, offer.give)) return withdraw;
  const eligible = responders(view, offer);
  const answered = eligible.every((id) => offer.responses[id] !== undefined);
  const wantTotal = costTotal(offer.want);
  const consenters = eligible
    .filter((id) => offer.responses[id] === 'consented')
    .map((id) => view.players.find((player) => player.id === id)!)
    // 手牌張數不夠的同意者一定付不起，結算只會被拒。
    .filter((player) => player && player.handSize >= wantTotal)
    .sort((a, b) => a.publicScore - b.publicScore || a.seat - b.seat);
  if (consenters.length > 0 && (phase !== 'collecting' || answered)) {
    const partner = consenters[0]!.id;
    return offer.to === 'all'
      ? { type: 'trade.settle', offerId: offer.id, counterparty: partner }
      : { type: 'trade.settle', offerId: offer.id };
  }
  if (answered || phase === 'expired') return withdraw;
  return null;
}

/**
 * 以銀行／港口補齊 `nextCost`，只用 `reserve` 以外的過剩資源。全部補得起才回傳
 * 第一筆交易，否則回傳 null（避免換了一半又蓋不成）。
 */
export function bankTradeToward(view: GameView, economy: Economy, nextCost: Cost, reserve: Cost): Command | null {
  const missing = deficitOf(economy.hand, nextCost);
  if (RESOURCES.every((resource) => missing[resource] === 0)) return null;
  const spare: Hand = { ...economy.hand };
  for (const resource of RESOURCES) {
    const keep = Math.max(nextCost[resource] ?? 0, reserve[resource] ?? 0);
    spare[resource] = Math.max(0, economy.hand[resource] - keep);
  }
  // 投影的銀行只到上限（#137）：規劃連續幾筆交易時把「至少」當成足夠。
  const bank = plannedBank(view);
  let first: Command | null = null;
  const order = RESOURCES.slice().sort((a, b) => missing[b] - missing[a]);
  for (const want of order) {
    for (let unit = 0; unit < missing[want]; unit++) {
      if (bank[want] <= 0) return null;
      let give: Resource | null = null;
      for (const resource of RESOURCES) {
        if (resource === want || spare[resource] < economy.rates[resource]) continue;
        // 換完後剩最多的優先；同分時拿出價值較低的資源。
        const left = spare[resource] - economy.rates[resource];
        const bestLeft = give ? spare[give] - economy.rates[give] : -Infinity;
        if (left > bestLeft || (left === bestLeft && economy.weights[resource] < economy.weights[give!])) {
          give = resource;
        }
      }
      if (!give) return null;
      spare[give] -= economy.rates[give];
      bank[want] -= 1;
      first ??= { type: 'trade.bank', give, receive: want };
    }
  }
  return first;
}

function sameTerms(a: Cost, b: Cost): boolean {
  return RESOURCES.every((resource) => (a[resource] ?? 0) === (b[resource] ?? 0));
}

/**
 * 主動對全桌開價：只在最多缺 `maxMissing` 張、且有不影響目標的過剩資源時提出；
 * 每個視窗最多兩次，同條件不重複。
 */
export function proposeOffer(
  view: GameView,
  economy: Economy,
  selfId: string,
  nextCost: Cost,
  maxMissing = 2,
): Command | null {
  const mine = view.offers.filter((offer) => offer.from === selfId && offer.windowId === view.windowId);
  if (mine.length >= MAX_OFFERS_PER_WINDOW || mine.some((offer) => offer.status === 'open')) return null;
  const others = view.players.filter((player) => player.id !== selfId);
  if (!others.some((player) => player.handSize > 0)) return null;
  const missing = deficitOf(economy.hand, nextCost);
  const need = costTotal(missing);
  if (need < 1 || need > maxMissing) return null;
  const want: Cost = {};
  for (const resource of RESOURCES) if (missing[resource] > 0) want[resource] = missing[resource];
  // 過剩資源：價值越低越先拿出來交換。
  const surplus: Resource[] = [];
  const order = RESOURCES.slice().sort((a, b) => economy.weights[a] - economy.weights[b]);
  for (const resource of order) {
    const extra = economy.hand[resource] - (nextCost[resource] ?? 0);
    for (let i = 0; i < extra; i++) surplus.push(resource);
  }
  if (surplus.length < need) return null;
  // 先提 1:1；同條件已被拒時多給一張。
  for (const count of [need, need + 1]) {
    if (count > surplus.length) break;
    const give: Cost = {};
    for (const resource of surplus.slice(0, count)) give[resource] = (give[resource] ?? 0) + 1;
    if (mine.some((offer) => sameTerms(offer.give, give) && sameTerms(offer.want, want))) continue;
    return { type: 'trade.offer', to: 'all', give, want };
  }
  return null;
}

