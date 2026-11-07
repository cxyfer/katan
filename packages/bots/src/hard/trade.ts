/**
 * hard 的國內交易（規格 §4 第 6 點）：依計牌結果與對手的公開盤面，推估對手的主要計畫與
 * 手牌，開出對方多半會接受、又對自己有利的報價；回應別人的報價時，也考慮對方得到多少。
 */

import { RESOURCES, type Command, type GameView, type Offer, type Resource } from '@catan/rules';
import { boardModel } from '../board.ts';
import { canAfford, deficitOf, economyOf, type Cost, type Economy, type Hand } from '../economy.ts';
import { acceptMargin, handUtility, MAX_OFFERS_PER_WINDOW, offerGain, offerTermsKnown } from '../trade.ts';
import { LEVEL_PARAMS } from '../level.ts';
import type { HardTurn } from './turn.ts';

/** 每位對手最多模擬幾種可能手牌（依機率由高到低，累積到 `WORLD_MASS` 為止）。 */
const MAX_RIVAL_WORLDS = 4;
const WORLD_MASS = 0.9;
/** 主動開價：主要計畫最多缺幾張時才開價。 */
const OFFER_MAX_MISSING = 3;
/** 主動開價：至少一位對手接受的機率下限。 */
const OFFER_MIN_ODDS = 0.25;
/** 主動開價：幫到威脅較大的對手時，每單位威脅扣的分數。 */
const OFFER_HELP_COST = 0.3;
/** 接受報價：自己效用增益的基本門檻（與 standard 相同）。 */
const ACCEPT_BASE = 0.6;
/** 接受報價：對方因這筆交易完成計畫時，門檻依計畫價值乘以威脅度提高。 */
const ACCEPT_BENEFIT = 1.5;

/** 對手在某種可能手牌下的經濟（以 standard 的估值方式，從對方的角度）。 */
export interface RivalWorld {
  readonly p: number;
  readonly hand: Hand;
  readonly economy: Economy;
}

export interface RivalModel {
  readonly id: string;
  readonly worlds: readonly RivalWorld[];
}

/** 以對手的角度建立投影：資源換成假設的手牌，沒有 hints（對方的合法位置自己算不到）。 */
function viewAs(view: GameView, rivalId: string, hand: Hand): GameView {
  const { hints: _hints, ...rest } = view;
  return {
    ...rest,
    players: view.players.map((player) => (player.id === rivalId ? { ...player, resources: { ...hand } } : player)),
  };
}

/** 對手的模型；同一次決策內只算一次（快取在 `HardTurn` 上，決策結束就丟掉）。 */
export function rivalModel(turn: HardTurn, rivalId: string): RivalModel {
  let model = turn.rivals.get(rivalId) as RivalModel | undefined;
  if (!model) {
    model = buildRivalModel(turn, rivalId);
    turn.rivals.set(rivalId, model);
  }
  return model;
}

function buildRivalModel(turn: HardTurn, rivalId: string): RivalModel {
  const belief = turn.hand(rivalId);
  const worlds: RivalWorld[] = [];
  if (belief && belief.worlds.length > 0) {
    let mass = 0;
    // 盤面模型只依盤面而定：建一次，每種手牌只換掉 view。
    const base = boardModel(turn.view, rivalId);
    for (const world of belief.worlds) {
      if (worlds.length >= MAX_RIVAL_WORLDS || mass >= WORLD_MASS) break;
      const hand = { ...world.hand } as Hand;
      worlds.push({ p: world.p, hand, economy: economyOf({ ...base, view: viewAs(turn.view, rivalId, hand) }) });
      mass += world.p;
    }
    // 只用前幾種可能時重新正規化。
    const total = worlds.reduce((sum, world) => sum + world.p, 0);
    return { id: rivalId, worlds: worlds.map((world) => ({ ...world, p: world.p / total })) };
  }
  return { id: rivalId, worlds };
}

/**
 * 對手接受報價的機率：在每種可能手牌下套用 standard 的接受條件（`acceptMargin`、`offerGain`）。
 * 對手是人類時這只是估計；條件本身是「拿到自己缺的、給出自己多的」，方向與人類相同。
 */
export function acceptOdds(turn: HardTurn, rival: RivalModel, offer: Pick<Offer, 'give' | 'want'>): number {
  const margin = acceptMargin(turn.view, rival.id, turn.ctx.selfId, LEVEL_PARAMS.standard.acceptMargin);
  if (margin === Infinity) return 0;
  let p = 0;
  for (const world of rival.worlds) {
    if (offerGain(world.economy, offer as Offer) >= margin) p += world.p;
  }
  return p;
}

function costTotal(cost: Cost): number {
  return RESOURCES.reduce((sum, resource) => sum + (cost[resource] ?? 0), 0);
}

function sameTerms(a: Cost, b: Cost): boolean {
  return RESOURCES.every((resource) => (a[resource] ?? 0) === (b[resource] ?? 0));
}

function single(resource: Resource, count = 1): Cost {
  return { [resource]: count };
}

/**
 * 主動開價：為主要計畫缺的牌，拿計畫以外的牌交換。對每個候選報價估計各對手接受的機率，
 * 挑「自己的效用增益 × 至少一人接受的機率」最高者；每個視窗最多兩次，同條件不重複。
 */
export function hardProposal(turn: HardTurn, target: Cost): Command | null {
  const { view, ctx } = turn;
  const mine = view.offers.filter((offer) => offer.from === ctx.selfId && offer.windowId === view.windowId);
  if (mine.length >= MAX_OFFERS_PER_WINDOW || mine.some((offer) => offer.status === 'open')) return null;
  const economy = turn.economy;
  const hand = economy.hand;
  const missing = deficitOf(hand, target);
  const need = costTotal(missing);
  if (need < 1 || need > OFFER_MAX_MISSING) return null;
  const rivals = turn.opponents
    .filter((player) => player.handSize > 0)
    .map((player) => rivalModel(turn, player.id))
    .filter((rival) => rival.worlds.length > 0);
  if (rivals.length === 0) return null;
  const before = handUtility(economy, hand, target);
  let best: { give: Cost; want: Cost; score: number } | null = null;
  for (const want of RESOURCES) {
    if (missing[want] <= 0) continue;
    for (const give of RESOURCES) {
      if (give === want) continue;
      const spare = hand[give] - (target[give] ?? 0);
      for (let count = 1; count <= 2 && count <= spare; count++) {
        const terms = { give: single(give, count), want: single(want) };
        if (mine.some((offer) => sameTerms(offer.give, terms.give) && sameTerms(offer.want, terms.want))) continue;
        const after = { ...hand };
        after[give] -= count;
        after[want] += 1;
        const gain = handUtility(economy, after, target) - before;
        if (gain <= 0) continue;
        // 報價條款以提出者（自己）的角度記錄；`acceptOdds` 從對方的角度評估同一份條款。
        let none = 1;
        let helped = 0;
        for (const rival of rivals) {
          const odds = acceptOdds(turn, rival, terms);
          none *= 1 - odds;
          helped += odds * (turn.threat(rival.id) - 1);
        }
        const accept = 1 - none;
        if (accept < OFFER_MIN_ODDS) continue;
        const score = gain * accept - OFFER_HELP_COST * helped;
        if (!best || score > best.score) best = { ...terms, score };
      }
    }
  }
  return best ? { type: 'trade.offer', to: 'all', give: best.give, want: best.want } : null;
}

/** 交易讓對手剛好湊齊主要計畫時，該計畫的價值（依可能手牌加權，以勝利分計）。 */
function rivalBenefit(rival: RivalModel, receives: Cost, pays: Cost): number {
  let benefit = 0;
  for (const world of rival.worlds) {
    const plan = world.economy.plans[0];
    if (!plan) continue;
    const before = canAfford(world.hand, plan.cost);
    const after = { ...world.hand };
    for (const resource of RESOURCES) after[resource] += (receives[resource] ?? 0) - (pays[resource] ?? 0);
    if (RESOURCES.some((resource) => after[resource] < 0)) continue;
    if (!before && canAfford(after, plan.cost)) benefit += world.p * plan.value;
  }
  return benefit;
}

/**
 * 回應別人的報價（自己是收件人）：自己的效用增益要超過門檻，而且門檻依對方從交易中
 * 得到的好處與威脅度提高。
 */
export function hardAccepts(turn: HardTurn, offer: Offer): boolean {
  if (!offerTermsKnown(offer)) return false;
  const gain = offerGain(turn.economy, offer);
  if (gain === -Infinity) return false;
  const proposer = turn.player(offer.from);
  if (!proposer) return false;
  if (turn.scoreOf(offer.from) >= turn.view.victoryTarget - 2) return false;
  const rival = rivalModel(turn, offer.from);
  // 報價條款以提出者的角度記錄：對方拿到 want、付出 give。
  const benefit = rival.worlds.length > 0 ? rivalBenefit(rival, offer.want, offer.give) : 0;
  const margin = ACCEPT_BASE + ACCEPT_BENEFIT * benefit * turn.threat(offer.from);
  return gain >= margin;
}
