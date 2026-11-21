/**
 * Fishing on Katan 的策略（T&B 計畫 §4.2）。
 *
 * 規則重點（`TB/fishing/index.ts`）：魚場與湖依擲骰發出蓋著的魚片（面額 1–3，`FISH_SUPPLY` [11,10,8]，期望 55/29 ≈ 1.90 條魚），
 * 手上最多 `FISH_LIMIT` 片；在自己的行動階段可以花魚（`FISH_COSTS`：2 移走強盜、3 偷牌、4 取資源、5 道路、7 發展卡），
 * 付超過的部分不找零。舊靴讓持有者的目標 +1，可以交給公開分數不低於自己的玩家。手上已滿時，拿魚前可以換掉一片（每回合一次）。
 *
 * - 花魚（`actions`）：每種用途估一個價值（勝利分當量，1 張資源 ≈ `RESOURCE_VP`），減去付出的魚的機會成本（每條 `FISH_VP`，
 *   手上快滿時降為 `FULL_FISH_VP`：再拿到的魚會被擋下）。淨值為正才列為候選，分數就是淨值，所以會先蓋立即得分的建築，
 *   也會為了更划算的用途（道路、發展卡）先存魚。付款挑超付最少的組合，同超付時用掉較多片（騰出上限）。
 *   - 道路只鋪在計畫的路線上（聚落計畫或最長道路），而且先以 `roadStockLeft` 檢查剩餘道路數：fishing 的道路 hints 不扣存量（G13）。
 *   - 取資源補主要計畫的缺口；剛好補齊下一步時加值（下一個決策就蓋）。
 *   - 偷牌只偷分數不低於自己的領先者（手上快滿時才偷其他人）；移走強盜只在強盜擋住自己的產能（含湖的魚）時估值。
 * - 舊靴（`tb.giveBoot`）：有對象就立即交出，給公開分數最高的對象（同分取座位在前者）。
 * - `fishSwap`：standard 只換掉面額 1 的魚片，其他情況放棄；easy 一律放棄。兩者都由策略作答，不走保底。
 * - 初始放置（`setup`）：base 的 `setupSpotScore` 加上魚場與湖的點數；不估魚的話 standard 幾乎不會蓋在魚場旁、拿不到魚。
 *   道路交給 base。
 * - easy：只把魚用在道路、取資源與發展卡；同樣交出舊靴，初始放置也算魚。
 *
 * 只讀投影與 hints（自己的魚片面額 `mine`、公開的片數），合法性以 hints 為準（P2）；回傳候選的鉤子不消耗亂數（`setup` 與 base
 * 一樣用 `turn.pick` 挑選），同分依先出現者決勝。
 */

import { FISH_COSTS, FISH_LIMIT, RESOURCES, type GameView, type PublicModulePendingView, type Resource, type TbFishingView } from '@katan/rules';
import { setupSpotScore } from '../../base/setup.ts';
import { pipsOf, roadStockLeft } from '../../board.ts';
import { bestRouteEdge, deficitOf, handSize, longestRoadAwarded } from '../../economy.ts';
import type { BotCommand, Scored, TurnContext } from '../types.ts';
import { isMine, TB_FRAME_KINDS } from './frames.ts';
import type { TbPartBot } from './part.ts';
import { integers, TB_PART_IDS, tbPartHints, tbPartView, tbTargets } from './view.ts';

const FISHING = TB_PART_IDS.fishing;

type FishAction = keyof typeof FISH_COSTS;
type Token = 1 | 2 | 3;

/** 一張資源的價值（勝利分當量；一座聚落約 4–5 張）。 */
export const RESOURCE_VP = 0.2;
/** 一條魚的機會成本：略低於最划算的用途（7 條換 1 張發展卡）每條魚的價值，超付 1–2 條時發展卡仍划算。 */
export const FISH_VP = 0.06;
/** 手上快滿（≥ 上限 − 1 片）時一條魚的機會成本：再拿到的魚會被擋下或得靠交換。 */
export const FULL_FISH_VP = 0.03;
/**
 * 初始放置時，魚場或湖每 1 點（擲中的機率 ×36）的價值，與 base 的加權點數同尺度（一張資源 ≈ 1）。一片魚約 1.9 條魚，
 * 每條魚約值 `FISH_VP / RESOURCE_VP` = 0.3 張資源，一片約 0.57 張；略為保守，取 0.5。
 */
export const FISH_PIP_WEIGHT = 0.5;
/** 交出舊靴的分數：不花任何東西，排在立即得分的建築之前。 */
const BOOT_SCORE = 3;

/** 各用途的基本價值。 */
const VALUE = {
  /** 發展卡（同 base 的 devCard 計畫）。 */
  devCard: 0.55,
  /** 計畫路線上的道路：兩張資源，再加上推進計畫。 */
  planRoad: 2 * RESOURCE_VP + 0.1,
  /** 主要計畫的下一步就是這條道路。 */
  primaryRoad: 0.1,
  /** 延長最長道路的道路。 */
  routeRoad: 2 * RESOURCE_VP + 0.05,
  /** 取一張主要計畫缺的資源；剛好補齊下一步時再加 `completes`。 */
  neededResource: RESOURCE_VP,
  spareResource: 0.6 * RESOURCE_VP,
  completes: 0.3,
  /**
   * 偷到的牌是隨機的，比指定的資源略差（約 0.85 張），略低於 3 條魚的機會成本：只有對象是分數不低於自己的領先者
   * （再加上讓他少一張）或手上快滿時才偷。
   */
  stolen: 0.17,
  denialLeader: 0.06,
  /** 強盜平均再停幾輪（到下一次擲出 7 或騎士）。 */
  robberRounds: 2,
} as const;

const command = (type: string, fields: Record<string, unknown> = {}): BotCommand => ({ type, ...fields }) as BotCommand;

function fishingView(view: Pick<GameView, 'modules'>): TbFishingView | undefined {
  const slot = tbPartView(view, FISHING);
  return slot && Array.isArray(slot.grounds) ? slot : undefined;
}

/** 自己的魚片（只有自己看得到面額）；形狀不對時是空的。 */
function myTokens(slot: TbFishingView): Token[] {
  return (integers(slot.mine) ?? []).filter((value): value is Token => value === 1 || value === 2 || value === 3);
}

// ---------------------------------------------------------------------------
// 付款
// ---------------------------------------------------------------------------

export interface Payment {
  /** 用掉的魚片（遞增）。 */
  readonly tokens: Token[];
  /** 付出的魚數（≥ 成本，超過的部分不找零）。 */
  readonly paid: number;
}

/**
 * 付 `cost` 條魚的魚片組合：超付最少，同超付時用掉較多片（騰出手上的上限，留下大面額），再同分時取列舉順序在前者。
 * 付不起時回 null。手上最多 7 片，直接列舉所有子集。
 */
export function paymentFor(tokens: readonly Token[], cost: number): Payment | null {
  const sorted = tokens.slice().sort((a, b) => a - b);
  let best: { mask: number; paid: number; count: number } | null = null;
  for (let mask = 1; mask < 1 << sorted.length; mask++) {
    let paid = 0;
    let count = 0;
    for (let index = 0; index < sorted.length; index++) {
      if (mask & (1 << index)) {
        paid += sorted[index]!;
        count += 1;
      }
    }
    if (paid < cost) continue;
    if (!best || paid < best.paid || (paid === best.paid && count > best.count)) best = { mask, paid, count };
  }
  if (!best) return null;
  return { tokens: sorted.filter((_, index) => best!.mask & (1 << index)), paid: best.paid };
}

// ---------------------------------------------------------------------------
// 各用途的價值
// ---------------------------------------------------------------------------

interface Use {
  readonly action: FishAction;
  readonly value: number;
  readonly fields: Record<string, unknown>;
}

/** 計畫路線上的道路：聚落或最長道路計畫的下一條路，其次是延長最長道路；fish 的道路 hints 不扣存量（G13）。 */
function roadUse(turn: TurnContext): Use | null {
  const { view, ctx, model } = turn;
  const targets = tbTargets(view.hints, 'tb.spendFish');
  if (targets.length === 0 || roadStockLeft(view, ctx.selfId) <= 0 || turn.economy.left.roads <= 0) return null;
  const legal = new Set(targets);
  const plans = turn.economy.plans;
  for (const [index, plan] of plans.entries()) {
    if ((plan.kind !== 'settlement' && plan.kind !== 'longestRoad') || plan.roads.length === 0) continue;
    const edge = plan.roads[0]!;
    if (!legal.has(edge)) continue;
    return { action: 'road', value: VALUE.planRoad + (index === 0 ? VALUE.primaryRoad : 0), fields: { edge } };
  }
  if (!longestRoadAwarded(model, turn.modules)) return null;
  const edge = bestRouteEdge(model, targets, turn.economy.myRoute);
  return edge === null ? null : { action: 'road', value: VALUE.routeRoad, fields: { edge } };
}

/** 取一張資源：主要計畫下一步的缺口優先，其次是整個計畫的缺口，最後是權重最高的資源；銀行要有。 */
function takeUse(turn: TurnContext): Use | null {
  const { view } = turn;
  const economy = turn.economy;
  const plan = economy.plans[0];
  const next = plan ? deficitOf(economy.hand, plan.nextCost) : null;
  const whole = plan ? deficitOf(economy.hand, plan.cost) : null;
  const missingNext = next ? RESOURCES.reduce((sum, resource) => sum + next[resource], 0) : 0;
  let best: { resource: Resource; value: number } | null = null;
  for (const resource of RESOURCES) {
    if ((view.bank[resource] ?? 0) <= 0) continue;
    let value = VALUE.spareResource;
    if (next && next[resource] > 0) value = VALUE.neededResource + (missingNext === 1 ? VALUE.completes : 0) + 0.01;
    else if (whole && whole[resource] > 0) value = VALUE.neededResource;
    value += 0.001 * (economy.weights[resource] ?? 0);
    if (!best || value > best.value) best = { resource, value };
  }
  if (!best) return null;
  return { action: 'takeResource', value: crowded(turn, best.value), fields: { resource: best.resource } };
}

/** 手牌已達上限時，多一張牌在擲出 7 時多半要丟掉，價值打折。 */
function crowded(turn: TurnContext, value: number): number {
  return handSize(turn.economy.hand) >= turn.economy.handLimit ? value * 0.6 : value;
}

/** 對手中公開分數最高者（同分取座位在前者）。 */
function leaderOf(view: GameView, selfId: string): string | null {
  let best: { id: string; score: number } | null = null;
  for (const player of view.players) {
    if (player.id === selfId) continue;
    if (!best || player.publicScore > best.score) best = { id: player.id, score: player.publicScore };
  }
  return best?.id ?? null;
}

/**
 * 偷牌：分數不低於自己的領先者有手牌時偷他（多一份「讓他少一張」的價值）；否則偷有手牌的對手中公開分數高、手牌多者。
 */
function stealUse(turn: TurnContext): Use | null {
  const { view, ctx } = turn;
  const leaderId = leaderOf(view, ctx.selfId);
  const leader = view.players.find((player) => player.id === leaderId);
  if (leader && leader.handSize > 0 && leader.publicScore >= turn.me.publicScore) {
    return { action: 'steal', value: crowded(turn, VALUE.stolen) + VALUE.denialLeader, fields: { victim: leader.id } };
  }
  let best: { id: string; rank: number } | null = null;
  for (const player of view.players) {
    if (player.id === ctx.selfId || player.handSize <= 0) continue;
    const rank = player.publicScore * 2 + player.handSize;
    if (!best || rank > best.rank) best = { id: player.id, rank };
  }
  return best ? { action: 'steal', value: crowded(turn, VALUE.stolen), fields: { victim: best.id } } : null;
}

/** 移走強盜：只看強盜擋住自己的產能（資源格的點數，或湖的魚）。 */
function robberUse(turn: TurnContext, slot: TbFishingView): Use | null {
  const { view, model, ctx } = turn;
  const hex = view.board.robber;
  if (hex < 0) return null;
  const players = view.players.length;
  // 自己在這一格的建築（城市加倍）；與 heuristic 的 `blockedPips` 相同，不 import 它以免模組循環。
  let weight = 0;
  for (const vertex of model.hexVertices[hex] ?? []) {
    const building = view.board.buildings[vertex];
    if (building?.player === ctx.selfId) weight += building.city ? 2 : 1;
  }
  if (weight === 0) return null;
  let value = ((model.hexPips[hex] ?? 0) * weight * players * VALUE.robberRounds * RESOURCE_VP) / 36;
  if (hex === slot.lake) {
    // 湖不產資源，擲中湖的點數時發魚；一片魚約 1.9 條魚。
    const lakePips = (integers(slot.lakeNumbers) ?? []).reduce((sum, number) => sum + pipsOf(number), 0);
    value += (lakePips * weight * players * VALUE.robberRounds * 1.9 * FISH_VP) / 36;
  }
  return value > 0 ? { action: 'removeRobber', value, fields: {} } : null;
}

/** 可以考慮的用途；easy 只用道路、取資源與發展卡。 */
function usesOf(turn: TurnContext, slot: TbFishingView, fish: number): Use[] {
  const easy = turn.level === 'easy';
  const out: Use[] = [];
  if (fish >= FISH_COSTS.devCard && turn.view.devDeckSize > 0) out.push({ action: 'devCard', value: VALUE.devCard, fields: {} });
  if (fish >= FISH_COSTS.road) {
    const road = roadUse(turn);
    if (road) out.push(road);
  }
  if (fish >= FISH_COSTS.takeResource) {
    const take = takeUse(turn);
    if (take) out.push(take);
  }
  if (!easy && fish >= FISH_COSTS.steal) {
    const steal = stealUse(turn);
    if (steal) out.push(steal);
  }
  if (!easy && fish >= FISH_COSTS.removeRobber) {
    const robber = robberUse(turn, slot);
    if (robber) out.push(robber);
  }
  return out;
}

/** 花魚的候選：淨值（價值減去付出的魚的機會成本）為正者，分數即淨值。 */
export function fishCandidates(turn: TurnContext): Scored<BotCommand>[] {
  const slot = fishingView(turn.view);
  const hints = tbPartHints(turn.view.hints, FISHING);
  if (!slot || hints?.canSpend !== true) return [];
  const tokens = myTokens(slot);
  const fish = tokens.reduce((sum, value) => sum + value, 0);
  const perFish = tokens.length >= FISH_LIMIT - 1 ? FULL_FISH_VP : FISH_VP;
  const out: Scored<BotCommand>[] = [];
  for (const use of usesOf(turn, slot, fish)) {
    const payment = paymentFor(tokens, FISH_COSTS[use.action]);
    if (!payment) continue;
    const net = use.value - payment.paid * perFish;
    if (net <= 0) continue;
    out.push({ item: command('tb.spendFish', { action: use.action, tokens: payment.tokens, ...use.fields }), score: net });
  }
  return out;
}

/** 交出舊靴：hints 的對象中公開分數最高者（同分取座位在前者）。 */
export function bootCandidate(turn: TurnContext): Scored<BotCommand> | null {
  const hints = tbPartHints(turn.view.hints, FISHING);
  if (hints?.canGiveBoot !== true) return null;
  const targets = new Set((hints.bootTargets ?? []).filter((id) => id !== turn.ctx.selfId));
  let best: { id: string; score: number } | null = null;
  for (const player of turn.view.players) {
    if (!targets.has(player.id)) continue;
    if (!best || player.publicScore > best.score) best = { id: player.id, score: player.publicScore };
  }
  return best ? { item: command('tb.giveBoot', { to: best.id }), score: BOOT_SCORE } : null;
}

// ---------------------------------------------------------------------------
// 初始放置
// ---------------------------------------------------------------------------

/** `vertex` 每輪拿魚的點數：相鄰魚場的號碼，加上湖的四個號碼（城市加倍由呼叫端處理）。 */
export function fishPipsAt(view: Pick<GameView, 'modules'>, topoHexes: readonly number[], vertex: number): number {
  const slot = fishingView(view);
  if (!slot) return 0;
  let pips = 0;
  for (const ground of slot.grounds) {
    if ((integers(ground.vertices) ?? []).includes(vertex)) pips += pipsOf(ground.number);
  }
  if (topoHexes.includes(slot.lake)) pips += (integers(slot.lakeNumbers) ?? []).reduce((sum, number) => sum + pipsOf(number), 0);
  return pips;
}

/**
 * 初始放置的聚落：base 的 `setupSpotScore` 加上魚場與湖的點數（`FISH_PIP_WEIGHT`）；第二輪放在魚場或湖旁邊時立即拿 1 片魚。
 * 挑選方式與 base 相同（`turn.pick`）；道路交給 base。
 */
function setup(turn: TurnContext): BotCommand | null | undefined {
  const { view, model } = turn;
  if (view.turn.setup?.stage !== 'building' || !fishingView(view)) return undefined;
  const second = view.turn.setup?.round === 2;
  const scored = (view.hints?.legalSettlements ?? []).map((vertex) => {
    const pips = fishPipsAt(view, model.topo.vertices[vertex]?.hexes ?? [], vertex);
    const bonus = pips * FISH_PIP_WEIGHT + (second && pips > 0 ? 1.9 * (FISH_VP / RESOURCE_VP) : 0);
    return { item: vertex, score: setupSpotScore(turn, vertex) + bonus };
  });
  const vertex = turn.pick(scored);
  return vertex === null ? null : command('setup.placeBuilding', { vertex });
}

function actions(turn: TurnContext): readonly Scored<BotCommand>[] {
  const boot = bootCandidate(turn);
  return [...(boot ? [boot] : []), ...fishCandidates(turn)];
}

// ---------------------------------------------------------------------------
// fishSwap
// ---------------------------------------------------------------------------

/** 手上滿了還要拿魚：standard 換掉一片面額 1 的魚（新抽一片期望約 1.9 條），沒有就放棄；easy 一律放棄。 */
function swapAnswer(turn: TurnContext): BotCommand {
  if (turn.level === 'easy') return command('tb.fishSwap', { token: null });
  const slot = fishingView(turn.view);
  const ones = slot ? myTokens(slot).includes(1) : false;
  return command('tb.fishSwap', { token: ones ? 1 : null });
}

function answerFrame(turn: TurnContext, frame: PublicModulePendingView): BotCommand | null | undefined {
  if (frame.kind !== TB_FRAME_KINDS.fishSwap) return undefined;
  if (!isMine(frame, turn.ctx.selfId)) return null;
  return swapAnswer(turn);
}

export const fishingBot: TbPartBot = {
  id: FISHING,
  answerFrame,
  setup,
  actions,
};
