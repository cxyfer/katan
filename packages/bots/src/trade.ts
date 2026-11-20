/**
 * 交易：手牌效用、報價評估、自己報價的生命週期、銀行交易與開價條件。
 */

import { CARD_KINDS, COMMODITIES, RESOURCES, type CardKind, type Command, type GameView, type Offer, type Resource } from '@catan/rules';
import { plannedBankOf } from './bank.ts';
import { targetOf } from './board.ts';
import {
  canAfford,
  deficitOf,
  mergeFirstWins,
  pay,
  type Cost,
  type Economy,
  type Hand,
} from './economy.ts';
import { firstAnswer } from './modules/compose.ts';
import type { BotModule, TurnContext } from './modules/types.ts';
import type { OfferPhase } from './types.ts';

/** 每個行動視窗最多主動開價次數（規格 §5）。 */
export const MAX_OFFERS_PER_WINDOW = 2;

/** 張數類：依 `CARD_KINDS` 計算（E-3），不經模組鉤子。 */
function costTotal(cost: Cost): number {
  return CARD_KINDS.reduce((sum, kind) => sum + (cost[kind] ?? 0), 0);
}

/**
 * 以目標成本衡量的手牌效用：目標內的牌價值高，過剩的牌依匯率折價。估值類迴圈，依 `Economy.kinds`；
 * 模組卡種沒有匯率時以 4:1 計流動性（與銀行不能換的牌一樣不好脫手），沒有權重時過剩的牌不值錢。
 */
/** 目標內一張牌的效用；也是 goods 一個資源當量的效用（`goodsGain`）。 */
export const USEFUL_CARD_UTILITY = 3;

export function handUtility(economy: Economy, hand: Hand, target: Cost): number {
  let utility = 0;
  for (const kind of economy.kinds) {
    const held = hand[kind] ?? 0;
    const need = target[kind] ?? 0;
    const useful = Math.min(held, need);
    const extra = Math.max(0, held - need);
    utility += useful * USEFUL_CARD_UTILITY + extra * liquidityOf(economy, kind) * (economy.weights[kind] ?? 0);
  }
  if (canAfford(hand, target)) utility += 2;
  return utility;
}

/** 過剩的牌依匯率折價的流動性係數。 */
function liquidityOf(economy: Economy, kind: CardKind): number {
  return 0.45 + (4 - (economy.rates[kind] ?? 4)) * 0.2;
}

/** 接受報價後效用的變化；付不起時回傳 -Infinity。報價條款以提出者的角度記錄。 */
export function offerGain(economy: Economy, offer: Offer): number {
  const hand = economy.hand;
  if (!canAfford(hand, offer.want)) return -Infinity;
  const target = economy.plans[0]?.cost ?? {};
  const after = pay(addHand(hand, offer.give), offer.want);
  return handUtility(economy, after, target) - handUtility(economy, hand, target);
}

/** 收到報價的牌：張數類，依 `CARD_KINDS`（E-3），否則 `offerGain` 會漏掉收到的 commodity。 */
function addHand(hand: Hand, cost: Cost): Hand {
  const out = { ...hand };
  for (const kind of CARD_KINDS) {
    const amount = cost[kind] ?? 0;
    if (amount > 0) out[kind] = (hand[kind] ?? 0) + amount;
  }
  return out;
}

/**
 * 規則 9：報價只含 Bot 估得了價的東西。含 `kinds` 以外的卡種，或任何 goods 的報價無法估值，
 * 一律拒絕（不接受、不結算）。`kinds` 是 `Economy.kinds`，省略時只有資源。base 的報價必定通過：
 * 引擎只保留正數的卡種，goods 總數為 0 時會刪掉該欄位。策略骨架改用 `offerValue`，含 goods 的報價交給模組的
 * trade 鉤子估值；這裡維持不看鉤子（hard 沿用）。
 */
export function offerTermsKnown(offer: Offer, kinds: readonly CardKind[] = RESOURCES): boolean {
  return cardTermsKnown(offer, kinds) && !hasGoods(offer);
}

function cardTermsKnown(offer: Offer, kinds: readonly CardKind[]): boolean {
  const known = (terms: Partial<Record<CardKind, number>>): boolean =>
    Object.entries(terms).every(([kind, amount]) => !(amount! > 0) || (kinds as readonly string[]).includes(kind));
  return known(offer.give) && known(offer.want);
}

/** 只留正數的 goods。 */
function positiveGoods(goods?: Record<string, number>): [string, number][] {
  return goods ? Object.entries(goods).filter(([, amount]) => amount > 0) : [];
}

function hasGoods(offer: Offer): boolean {
  return positiveGoods(offer.giveGoods).length > 0 || positiveGoods(offer.wantGoods).length > 0;
}

/** `playerId` 公開持有的 goods：依模組順序合併各模組的 `trade.goods`，同一個 good 先出現者優先。 */
export function goodsOf(modules: readonly BotModule[], view: GameView, playerId: string): Record<string, number> {
  return mergeFirstWins(modules.map((module) => module.trade?.goods?.(view, playerId) ?? {}));
}

/** `amount` 個 `good` 在 `side` 這一方的價值（資源當量）：第一個非 undefined 勝出；沒有人估得了、null 或非有限值都回 null。 */
function goodValueOf(turn: TurnContext, good: string, amount: number, side: 'receive' | 'pay'): number | null {
  const value = firstAnswer(turn.modules, (module) => module.trade?.goodValue?.(turn, good, amount, side));
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 規則 9 的 goods 部分：報價以提出者的角度記錄，所以收到 `giveGoods`、付出 `wantGoods`。下列任一成立就回
 * null（拒絕）：有 good 無法估值、`wantGoods` 超過自己持有、`giveGoods` 超過提出者公開持有。否則回傳淨值，
 * 由資源當量乘上 `USEFUL_CARD_UTILITY`（一張用得上的牌），換算到 `handUtility` 的尺度：goods 能換成缺的牌，
 * 以過剩牌計價會讓 Bot 用遠高於銀行的價格付出 goods。收進的 goods 用不掉時由模組在 `goodValue` 折價（只有收的一方，
 * 付出的一方不得低於市價）。沒有模組提供
 * trade 鉤子時一律 null。
 */
export function goodsGain(turn: TurnContext, offer: Offer): number | null {
  const receive = positiveGoods(offer.giveGoods);
  const pay = positiveGoods(offer.wantGoods);
  const mine = goodsOf(turn.modules, turn.view, turn.ctx.selfId);
  const theirs = goodsOf(turn.modules, turn.view, offer.from);
  if (pay.some(([good, amount]) => amount > (mine[good] ?? 0))) return null;
  if (receive.some(([good, amount]) => amount > (theirs[good] ?? 0))) return null;
  let units = 0;
  for (const [terms, sign, side] of [[receive, 1, 'receive'], [pay, -1, 'pay']] as const) {
    for (const [good, amount] of terms) {
      const value = goodValueOf(turn, good, amount, side);
      if (value === null) return null;
      units += sign * value;
    }
  }
  return units * USEFUL_CARD_UTILITY;
}

/**
 * 接受報價後的效用變化，含 goods；規則 9 拒絕或付不起時回 -Infinity。不含 goods 的報價與
 * `offerTermsKnown` 加 `offerGain` 相同，不呼叫任何 trade 鉤子。
 */
export function offerValue(turn: TurnContext, offer: Offer): number {
  const { economy } = turn;
  if (!cardTermsKnown(offer, economy.kinds)) return -Infinity;
  if (!hasGoods(offer)) return offerGain(economy, offer);
  const goods = goodsGain(turn, offer);
  return goods === null ? -Infinity : offerGain(economy, offer) + goods;
}

/** 對手接近勝利時不幫他；領先越多，要求的好處越大。 */
export function acceptMargin(view: GameView, selfId: string, proposerId: string, base: number): number {
  const proposer = view.players.find((player) => player.id === proposerId);
  const me = view.players.find((player) => player.id === selfId);
  if (!proposer || !me) return Infinity;
  if (proposer.publicScore >= targetOf(view, proposerId) - 2) return Infinity;
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
 * 以銀行／港口補齊 `nextCost`，只用 `reserve` 以外的過剩卡牌。全部補得起才回傳
 * 第一筆交易，否則回傳 null（避免換了一半又蓋不成）。卡種依 `Economy.kinds`：模組卡種要有匯率才能付出，
 * 要銀行有存量才能換入。
 */
export function bankTradeToward(view: GameView, economy: Economy, nextCost: Cost, reserve: Cost): Command | null {
  const { kinds } = economy;
  const missing = deficitOf(economy.hand, nextCost);
  if (kinds.every((kind) => (missing[kind] ?? 0) === 0)) return null;
  const spare: Hand = { ...economy.hand };
  for (const kind of kinds) {
    const keep = Math.max(nextCost[kind] ?? 0, reserve[kind] ?? 0);
    spare[kind] = Math.max(0, (economy.hand[kind] ?? 0) - keep);
  }
  // 投影的銀行只到上限（#137）：規劃連續幾筆交易時把「至少」當成足夠。
  const bank = plannedBankOf(view, kinds);
  let first: Command | null = null;
  const order = kinds.slice().sort((a, b) => (missing[b] ?? 0) - (missing[a] ?? 0));
  for (const want of order) {
    for (let unit = 0; unit < (missing[want] ?? 0); unit++) {
      if ((bank[want] ?? 0) <= 0) return null;
      let give: CardKind | null = null;
      for (const kind of kinds) {
        const rate = economy.rates[kind];
        if (kind === want || rate === undefined || (spare[kind] ?? 0) < rate) continue;
        // 換完後剩最多的優先；同分時拿出價值較低的牌。
        const left = (spare[kind] ?? 0) - rate;
        const bestLeft = give ? (spare[give] ?? 0) - economy.rates[give]! : -Infinity;
        if (left > bestLeft || (left === bestLeft && (economy.weights[kind] ?? 0) < (economy.weights[give!] ?? 0))) {
          give = kind;
        }
      }
      if (!give) return null;
      spare[give] = (spare[give] ?? 0) - economy.rates[give]!;
      bank[want] = (bank[want] ?? 0) - 1;
      first ??= { type: 'trade.bank', give, receive: want };
    }
  }
  return first;
}

function sameTerms(a: Cost, b: Cost): boolean {
  return CARD_KINDS.every((kind) => (a[kind] ?? 0) === (b[kind] ?? 0));
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
  // 不主動提出 commodity 的國內報價：缺 commodity 時不開價（報價只含資源）。
  if (COMMODITIES.some((commodity) => (missing[commodity] ?? 0) > 0)) return null;
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

