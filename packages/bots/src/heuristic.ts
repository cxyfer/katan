/**
 * standard／easy 啟發式策略（規格 §6）。每次呼叫只決定一個指令；下一次呼叫
 * 會從新的投影重新評估，因此不需要跨呼叫狀態。
 */

import {
  COSTS,
  requireProfile,
  RESOURCES,
  type Command,
  type GameView,
  type PublicModulePendingView,
  type PublicPendingView,
  type Resource,
} from '@catan/rules';
import { playerYield, vertexYield } from './board.ts';
import { banditChoice, robberCauseOf } from './base/robber.ts';
import { canPlay, plentyPick } from './base/cards.ts';
import { freeRoadDecision, roadDirectionScore, usefulRoad } from './base/roads.ts';
import { setupSpotScore } from './base/setup.ts';
import {
  canAfford,
  deficitOf,
  handSize,
  isImmediate,
  PIP_VALUE,
  settlementSpotValue,
  weightedPips,
  type Cost,
  type Economy,
  type Plan,
} from './economy.ts';
import { LEVEL_PARAMS, type LevelParams } from './level.ts';
import { fallbackDecision } from './fallback.ts';
import { collectScored, firstAnswer, isModuleFrame } from './modules/compose.ts';
import { botModulesOf } from './modules/registry.ts';
import type { BotModule, Scored, TurnContext } from './modules/types.ts';
import { Turn } from './turn.ts';
import {
  acceptMargin,
  bankTradeToward,
  offerGain,
  offersAwaitingMe,
  offerTermsKnown,
  ownOfferStep,
  ownOpenOffers,
  proposeOffer,
} from './trade.ts';
import type { BotCommand, BotContext, BotLevel, BotPolicy } from './types.ts';

/** 模組清單省略時，依 profile 的 ruleModules 取得已註冊的模組。 */
function modulesFor(view: GameView, modules: readonly BotModule[] | undefined): readonly BotModule[] {
  return modules ?? botModulesOf(requireProfile(view.profileId));
}

function decide(
  view: GameView,
  ctx: BotContext,
  level: BotLevel,
  params: LevelParams,
  modules?: readonly BotModule[],
): BotCommand | null {
  if (view.result) return null;
  const me = view.players.find((player) => player.id === ctx.selfId);
  if (!me || !view.hints) return null;
  const turn = new Turn(view, ctx, level, params, me, modulesFor(view, modules));
  // 沒有策略可答時退回保底；保底回 null（例如 duty 回 null）時就是真的沒有事可做。
  const duty = (): BotCommand | null => fallbackDecision(view, ctx.selfId, turn.modules);
  const pending = view.pending;
  if (pending) {
    if (isModuleFrame(pending)) {
      if (!pending.responders.includes(ctx.selfId)) return null;
      return firstAnswer(turn.modules, (module) => module.answerFrame?.(turn, pending)) ?? duty();
    }
    return basePendingDecision(turn, pending) ?? duty();
  }
  if (view.turn.phase === 'setup') {
    if (view.turn.playerId !== ctx.selfId) return null;
    const answer = firstAnswer(turn.modules, (module) => module.setup?.(turn));
    return (answer !== undefined ? answer : setupDecision(turn)) ?? duty();
  }
  // 非行動者在待決效果與初始放置之外，只回應報價。
  if (view.turn.playerId !== ctx.selfId) return respondToOffers(turn);
  if (view.turn.phase === 'preroll') return prerollDecision(turn) ?? duty();
  if (view.turn.phase === 'action') return actionDecision(turn, duty);
  return null;
}

export function heuristicPolicy(level: BotLevel, modules?: readonly BotModule[]): BotPolicy {
  const params = LEVEL_PARAMS[level] ?? LEVEL_PARAMS.standard;
  return { decide: (view, ctx) => decide(view, ctx, level, params, modules) };
}

/**
 * 測試用：建立與策略內部相同的單次決策資料。找不到 `selfId` 時 throw；hints 可以缺。
 * 模組清單省略時依 profile 推導，`[]` 代表只有 base。
 */
export function turnContext(
  view: GameView,
  ctx: BotContext,
  level: BotLevel,
  modules?: readonly BotModule[],
): TurnContext {
  const me = view.players.find((player) => player.id === ctx.selfId);
  if (!me) throw new Error(`turnContext: no seat ${ctx.selfId} in the view`);
  const params = LEVEL_PARAMS[level] ?? LEVEL_PARAMS.standard;
  return new Turn(view, ctx, level, params, me, modulesFor(view, modules));
}

// ---------------------------------------------------------------------------
// 待決效果
// ---------------------------------------------------------------------------

type BasePending = Exclude<NonNullable<PublicPendingView>, PublicModulePendingView>;

function basePendingDecision(turn: TurnContext, pending: BasePending): BotCommand | null {
  const { ctx } = turn;
  switch (pending.kind) {
    case 'discard': {
      if (!pending.waitingFor.includes(ctx.selfId)) return null;
      return discardDecision(turn, pending.required[ctx.selfId] ?? 0);
    }
    case 'moveRobber': {
      if (pending.actor !== ctx.selfId) return null;
      const choice = banditChoice(turn, robberCauseOf(pending.cause));
      return choice === null ? null : { type: 'pending.moveRobber', hex: choice.target };
    }
    case 'steal': {
      if (pending.actor !== ctx.selfId) return null;
      const victim = stealVictim(turn, pending.candidates);
      return victim === null ? null : { type: 'pending.steal', victim };
    }
    case 'yearOfPlenty': {
      if (pending.actor !== ctx.selfId) return null;
      const resource = plentyPick(turn);
      return resource === null ? null : { type: 'pending.takeResource', resource };
    }
    case 'freeRoads': {
      if (pending.actor !== ctx.selfId) return null;
      // 模組提供免費道路的候選時，取代 base 選路（模組要自行納入道路選項）。
      const extra = collectScored(turn.modules, (module) => module.freeRouteCandidates?.(turn));
      if (extra.length > 0) return turn.pick(extra);
      return freeRoadDecision(turn);
    }
  }
}

/** 保留最接近目標的組合，先丟過剩、再丟價值低的資源。 */
function discardDecision(turn: TurnContext, count: number): Command | null {
  const economy = turn.economy;
  const keep: Cost = economy.plans[0]?.cost ?? {};
  const hand = { ...economy.hand };
  const out: Resource[] = [];
  for (let i = 0; i < count; i++) {
    let best: Resource | null = null;
    let bestValue = Infinity;
    for (const resource of RESOURCES) {
      if (hand[resource] <= 0) continue;
      const surplus = hand[resource] - (keep[resource] ?? 0);
      const value =
        (surplus > 0 ? -surplus * 0.5 : 10) + economy.weights[resource] + (economy.yield[resource] === 0 ? 0.5 : 0);
      if (value < bestValue) {
        bestValue = value;
        best = resource;
      }
    }
    if (!best) return null;
    out.push(best);
    hand[best] -= 1;
  }
  return { type: 'pending.discard', resources: out };
}

function stealVictim(turn: TurnContext, candidates: readonly string[]): string | null {
  const scored = candidates.map((id) => {
    const player = turn.view.players.find((candidate) => candidate.id === id);
    return { item: id, score: (player?.handSize ?? 0) * 10 + (player?.publicScore ?? 0) };
  });
  return turn.pick(scored);
}

// ---------------------------------------------------------------------------
// 初始放置
// ---------------------------------------------------------------------------

function setupDecision(turn: TurnContext): Command | null {
  const { view } = turn;
  const hints = view.hints!;
  const stage = view.turn.setup?.stage;
  if (stage === 'building') {
    const vertex = turn.pick(hints.legalSettlements.map((item) => ({ item, score: setupSpotScore(turn, item) })));
    return vertex === null ? null : { type: 'setup.placeBuilding', vertex };
  }
  if (stage === 'road') {
    const edge = turn.pick(hints.legalRoads.map((item) => ({ item, score: roadDirectionScore(turn, item) })));
    return edge === null ? null : { type: 'setup.placeRoad', edge };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 回應報價（非行動者）
// ---------------------------------------------------------------------------

function respondToOffers(turn: TurnContext): Command | null {
  const { view, ctx, params } = turn;
  if (view.turn.phase !== 'action') return null;
  for (const offer of offersAwaitingMe(view, ctx.selfId)) {
    // 規則 9：無法估值的報價視為不划算，下面的比較自然得到 declined。
    const gain = offerTermsKnown(offer) ? offerGain(turn.economy, offer) : -Infinity;
    const margin = acceptMargin(view, ctx.selfId, offer.from, params.acceptMargin);
    return {
      type: 'trade.respond',
      offerId: offer.id,
      response: gain >= margin ? 'consented' : 'declined',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 擲骰前與行動階段
// ---------------------------------------------------------------------------

/** 擲骰前：base 的騎士先決定；模組候選只在 base 不打騎士時才挑。擲骰交給保底義務。 */
function prerollDecision(turn: TurnContext): BotCommand | null {
  const knight = knightDecision(turn);
  if (knight) return knight;
  return turn.pick(collectScored(turn.modules, (module) => module.preroll?.(turn)));
}

/** 自己被強盜擋住的點數（城市加倍）。 */
function blockedPips(turn: TurnContext): number {
  const { view, model, ctx } = turn;
  const hex = view.board.robber;
  let blocked = 0;
  for (const vertex of model.hexVertices[hex] ?? []) {
    const building = view.board.buildings[vertex];
    if (building?.player === ctx.selfId) blocked += model.hexPips[hex]! * (building.city ? 2 : 1);
  }
  return blocked;
}

function knightDecision(turn: TurnContext): Command | null {
  if (!canPlay(turn, 'knight')) return null;
  const { view, me, params } = turn;
  const holder = view.awards.largestArmy;
  const holderKnights = holder ? view.players.find((player) => player.id === holder)?.playedKnights ?? 0 : 0;
  const takesArmy = holder !== me.id && me.playedKnights + 1 >= 3 && me.playedKnights + 1 > holderKnights;
  const wins = takesArmy && (me.ownScore ?? me.publicScore) + 2 >= view.victoryTarget;
  const unblock = blockedPips(turn) >= 3;
  if (!unblock && !wins && !(params.eagerKnights && takesArmy)) return null;
  const choice = banditChoice(turn, 'knight');
  return choice === null ? null : { type: 'dev.playKnight', hex: choice.target };
}

function actionDecision(turn: TurnContext, duty: () => BotCommand | null): BotCommand | null {
  const { view, ctx, params } = turn;

  // 1. 自己的報價：結算、撤回或等待。等待期間不做別的事，避免手牌變動。
  const own = ownOpenOffers(view, ctx.selfId)[0];
  if (own) {
    return ownOfferStep(view, turn.economy, own, ctx.offerPhases[own.id] ?? 'expired', !turn.pairedSecond);
  }

  // 2. 別人直接對我（行動者）提出的反報價：划算就結算，否則拒絕。
  for (const offer of offersAwaitingMe(view, ctx.selfId)) {
    // 規則 9：無法估值的報價視為不划算，下面的比較自然得到 declined。
    const gain = offerTermsKnown(offer) ? offerGain(turn.economy, offer) : -Infinity;
    const margin = acceptMargin(view, ctx.selfId, offer.from, params.acceptMargin);
    const proposer = view.players.find((player) => player.id === offer.from);
    const proposerCanPay = (proposer?.handSize ?? 0) >= RESOURCES.reduce((sum, r) => sum + (offer.give[r] ?? 0), 0);
    if (offer.to === ctx.selfId && !turn.pairedSecond && proposerCanPay && gain >= margin) {
      return { type: 'trade.settle', offerId: offer.id };
    }
    return { type: 'trade.respond', offerId: offer.id, response: 'declined' };
  }

  // 3. 發展卡。
  const card = devCardDecision(turn);
  if (card) return card;

  // 4. 建造與銀行交易。
  const build = buildDecision(turn);
  if (build) return build;

  // 5. 主動開價。
  if (params.proposeOffers && !turn.pairedSecond) {
    const plan = turn.economy.plans[0];
    // 只為了立即得分的建造開價，避免每回合都拿小事打擾其他玩家。
    if (plan && isImmediate(plan)) {
      const offer = proposeOffer(view, turn.economy, ctx.selfId, plan.nextCost, 1);
      if (offer) return offer;
    }
  }

  // 6. 手牌太多時先消化，降低擲出 7 時的損失。
  const relief = handRelief(turn);
  if (relief) return relief;

  // 7. 沒有事可做：交給保底義務（模組 duty 優先，否則結束回合）。
  return duty();
}

function devCardDecision(turn: TurnContext): Command | null {
  const { view } = turn;
  const knight = knightDecision(turn);
  if (knight) return knight;
  const economy = turn.economy;
  const plan = economy.plans[0];

  if (canPlay(turn, 'yearOfPlenty') && plan) {
    const bankTotal = RESOURCES.reduce((sum, resource) => sum + view.bank[resource], 0);
    const missing = deficitOf(economy.hand, plan.nextCost);
    const need = RESOURCES.reduce((sum, resource) => sum + missing[resource], 0);
    // base-2025.3 會依銀行現有張數完成效果；空銀行才拒絕並保留卡片。
    if (bankTotal >= 1 && need >= 1 && need <= 2) return { type: 'dev.playYearOfPlenty' };
  }

  if (canPlay(turn, 'monopoly')) {
    const resource = monopolyChoice(turn);
    if (resource) return { type: 'dev.playMonopoly', resource };
  }

  // base-2025.3 可只授予最後一個道路棋子；仍需有合法道路才值得打出。
  // base 的條件先求值，與 v0.4.0 相同；模組候選只在 base 條件不成立時才計算。
  if (
    canPlay(turn, 'roadBuilding') &&
    ((economy.left.roads >= 1 && usefulRoad(turn, true) !== null) ||
      collectScored(turn.modules, (module) => module.freeRouteCandidates?.(turn)).length > 0)
  ) {
    return { type: 'dev.playRoadBuilding' };
  }
  return null;
}

/** 依對手的公開產能估計他們手上各資源的張數。 */
function monopolyChoice(turn: TurnContext): Resource | null {
  const { view, model, ctx, params } = turn;
  const economy = turn.economy;
  const plan = economy.plans[0];
  const missing = plan ? deficitOf(economy.hand, plan.cost) : null;
  let best: Resource | null = null;
  let bestValue = 0;
  for (const resource of RESOURCES) {
    let expected = 0;
    for (const player of view.players) {
      if (player.id === ctx.selfId || player.handSize === 0) continue;
      const production = playerYield(model, player.id, true);
      const total = RESOURCES.reduce((sum, r) => sum + production[r], 0);
      expected += (player.handSize * (production[resource] + 0.5)) / (total + 2.5);
    }
    const useful = (missing && missing[resource] > 0) || economy.rates[resource] <= 2 ? 1 : 0.7;
    const value = expected * useful;
    if (value > bestValue) {
      bestValue = value;
      best = resource;
    }
  }
  return bestValue >= params.monopolyMin ? best : null;
}

/** 付完 `spend` 後，主要計畫已持有的資源是否減少。 */
function hurts(economy: Economy, primary: Cost, spend: Cost): boolean {
  return RESOURCES.some(
    (resource) =>
      economy.hand[resource] - (spend[resource] ?? 0) < Math.min(economy.hand[resource], primary[resource] ?? 0),
  );
}

function buildDecision(turn: TurnContext): BotCommand | null {
  const { view, model, ctx } = turn;
  const hints = view.hints!;
  const economy = turn.economy;
  const hand = economy.hand;
  const { left, weights } = economy;

  // a) 付得起的城市與聚落：立即得分，優先於其他計畫。
  const scoring: Scored<BotCommand>[] = [];
  if (left.cities > 0 && canAfford(hand, COSTS.city)) {
    for (const vertex of hints.legalCities) {
      const value = 1 + PIP_VALUE * weightedPips(vertexYield(model, vertex), weights);
      scoring.push({ item: { type: 'build.city', vertex }, score: value });
    }
  }
  if (left.settlements > 0 && canAfford(hand, COSTS.settlement)) {
    const mine = playerYield(model, ctx.selfId, true);
    for (const vertex of hints.legalSettlements) {
      const value = 1 + PIP_VALUE * settlementSpotValue(model, vertex, weights, mine);
      scoring.push({ item: { type: 'build.settlement', vertex }, score: value });
    }
  }
  // 模組的「現在就該做」候選接在 base 之後，一起評分。
  const scoringPick = turn.pick([...scoring, ...collectScored(turn.modules, (module) => module.actions?.(turn))]);
  if (scoringPick) return scoringPick;

  // b) 主要計畫：付得起就做下一步，否則看銀行交易能否在這回合補齊。
  const primary = economy.plans[0];
  if (primary) {
    const step = planStep(turn, primary);
    if (step) return step;
    const trade = bankTradeToward(view, economy, primary.nextCost, primary.cost);
    if (trade) return trade;
  }

  // c) 其他付得起、且不動用主要計畫資源的建造。
  const reserve = primary?.cost ?? {};
  for (const plan of economy.plans.slice(1)) {
    if (!canAfford(hand, plan.nextCost) || hurts(economy, reserve, plan.nextCost)) continue;
    const step = planStep(turn, plan);
    if (step) return step;
  }
  if (view.devDeckSize > 0 && canAfford(hand, COSTS.devCard) && !hurts(economy, reserve, COSTS.devCard)) {
    return { type: 'build.devCard' };
  }
  if (left.roads > 0 && canAfford(hand, COSTS.road) && !hurts(economy, reserve, COSTS.road)) {
    const edge = usefulRoad(turn, false);
    if (edge !== null) return { type: 'build.road', edge };
  }
  return null;
}

/** 計畫的下一步；付不起或已不合法時回傳 null。 */
function planStep(turn: TurnContext, plan: Plan): BotCommand | null {
  const { view } = turn;
  const hints = view.hints!;
  const economy = turn.economy;
  if (!canAfford(economy.hand, plan.nextCost)) return null;
  switch (plan.kind) {
    case 'city':
      return plan.vertex !== null && hints.legalCities.includes(plan.vertex) && economy.left.cities > 0
        ? { type: 'build.city', vertex: plan.vertex }
        : null;
    case 'settlement': {
      if (plan.roads.length === 0) {
        return plan.vertex !== null && hints.legalSettlements.includes(plan.vertex) && economy.left.settlements > 0
          ? { type: 'build.settlement', vertex: plan.vertex }
          : null;
      }
      const edge = plan.roads[0]!;
      return hints.legalRoads.includes(edge) && economy.left.roads > 0 ? { type: 'build.road', edge } : null;
    }
    case 'longestRoad': {
      const edge = plan.roads[0];
      return edge !== undefined && hints.legalRoads.includes(edge) && economy.left.roads > 0
        ? { type: 'build.road', edge }
        : null;
    }
    case 'devCard':
      return view.devDeckSize > 0 ? { type: 'build.devCard' } : null;
    default:
      // 只有模組計畫會走到這裡；模組對不屬於自己的 kind 必須回 undefined。
      return firstAnswer(turn.modules, (module) => module.planStep?.(turn, plan)) ?? null;
  }
}

/** 手牌 8 張以上時：先買發展卡、再鋪有用的路，最後把過剩資源換成需要的。 */
function handRelief(turn: TurnContext): Command | null {
  const { view } = turn;
  const economy = turn.economy;
  const hand = economy.hand;
  if (handSize(hand) < 8) return null;
  if (view.devDeckSize > 0 && canAfford(hand, COSTS.devCard)) return { type: 'build.devCard' };
  if (economy.left.roads > 0 && canAfford(hand, COSTS.road)) {
    const edge = usefulRoad(turn, economy.left.roads > 3);
    if (edge !== null) return { type: 'build.road', edge };
  }
  const target = economy.plans[0]?.cost ?? {};
  const missing = deficitOf(hand, target);
  let give: Resource | null = null;
  for (const resource of RESOURCES) {
    const extra = hand[resource] - (target[resource] ?? 0);
    if (extra < economy.rates[resource]) continue;
    if (!give || extra - economy.rates[resource] > hand[give] - (target[give] ?? 0) - economy.rates[give]) give = resource;
  }
  if (!give) return null;
  const receive = RESOURCES.filter((resource) => resource !== give && view.bank[resource] > 0).sort(
    (a, b) => missing[b] - missing[a] || economy.weights[b] - economy.weights[a],
  )[0];
  return receive ? { type: 'trade.bank', give, receive } : null;
}
