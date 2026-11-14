/**
 * standard／easy 啟發式策略（規格 §6）。每次呼叫只決定一個指令；下一次呼叫
 * 會從新的投影重新評估，因此不需要跨呼叫狀態。
 */

import {
  CARD_KINDS,
  COSTS,
  requireProfile,
  RESOURCES,
  type CardKind,
  type Command,
  type GameView,
  type PublicModulePendingView,
  type PublicPendingView,
  type Resource,
} from '@catan/rules';
import { bankHas } from './bank.ts';
import { playerYield } from './board.ts';
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
  productionValue,
  settlementSpotValue,
  type Cost,
  type Economy,
  type Plan,
} from './economy.ts';
import { LEVEL_PARAMS, type LevelParams } from './level.ts';
import { fallbackDecision } from './fallback.ts';
import { collectScored, firstAnswer, isModuleFrame, rescoreDelta } from './modules/compose.ts';
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

/** 保留最接近目標的組合，先丟過剩、再丟價值低的牌；卡種依 `Economy.kinds`（C&K 的 commodity 也要能棄）。 */
function discardDecision(turn: TurnContext, count: number): Command | null {
  const economy = turn.economy;
  const keep: Cost = economy.plans[0]?.cost ?? {};
  const hand = { ...economy.hand };
  const out: CardKind[] = [];
  for (let i = 0; i < count; i++) {
    let best: CardKind | null = null;
    let bestValue = Infinity;
    for (const kind of economy.kinds) {
      const held = hand[kind] ?? 0;
      if (held <= 0) continue;
      const surplus = held - (keep[kind] ?? 0);
      const value =
        (surplus > 0 ? -surplus * 0.5 : 10) + (economy.weights[kind] ?? 0) + ((economy.yield[kind] ?? 0) === 0 ? 0.5 : 0);
      if (value < bestValue) {
        bestValue = value;
        best = kind;
      }
    }
    if (!best) return null;
    out.push(best);
    hand[best] = (hand[best] ?? 0) - 1;
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
    const gain = offerTermsKnown(offer, turn.economy.kinds) ? offerGain(turn.economy, offer) : -Infinity;
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
export function blockedPips(turn: TurnContext): number {
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
    const gain = offerTermsKnown(offer, turn.economy.kinds) ? offerGain(turn.economy, offer) : -Infinity;
    const margin = acceptMargin(view, ctx.selfId, offer.from, params.acceptMargin);
    const proposer = view.players.find((player) => player.id === offer.from);
    const proposerCanPay = (proposer?.handSize ?? 0) >= CARD_KINDS.reduce((sum, kind) => sum + (offer.give[kind] ?? 0), 0);
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

/** 付完 `spend` 後，主要計畫已持有的牌是否減少（張數類，含 commodity）。 */
function hurts(economy: Economy, primary: Cost, spend: Cost): boolean {
  return CARD_KINDS.some((kind) => {
    const held = economy.hand[kind] ?? 0;
    return held - (spend[kind] ?? 0) < Math.min(held, primary[kind] ?? 0);
  });
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
      const value = 1 + PIP_VALUE * productionValue(model, vertex, weights);
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
  // 模組的「現在就該做」候選接在 base 之後，一起評分；合併、去重之後再套用各模組的 rescore 差值。
  const extra = collectScored(turn.modules, (module) => module.actions?.(turn));
  const scoringPick = turn.pick(
    rescoreCandidates(turn, extra.length === 0 ? scoring : dedupeCandidates([...scoring, ...extra])),
  );
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

/**
 * 把所有提供 `rescore` 的模組對同一個候選的差值相加到分數上（不新增、不移除候選，順序不變）。沒有任何
 * 模組提供 `rescore` 時原樣回傳同一個陣列：不呼叫任何鉤子，也不改變順序或亂數消耗。非有限的差值視為 0。
 */
export function rescoreCandidates(
  turn: TurnContext,
  candidates: readonly Scored<BotCommand>[],
): readonly Scored<BotCommand>[] {
  const hooks = turn.modules.filter((module) => module.rescore);
  if (hooks.length === 0) return candidates;
  return candidates.map((candidate) => {
    const delta = rescoreDelta(hooks, turn, candidate.item);
    return delta === 0 ? candidate : { item: candidate.item, score: candidate.score + delta };
  });
}

/**
 * 完全相同的指令只留一個：分數取最高，位置取第一次出現的。模組的候選可能與 base 的立即建造是同一個
 * 指令（例如帶小島加分的聚落），不去重會在 easy 的 topK 裡多佔名額。鍵依內容遞迴正規化：物件的 key
 * 順序不影響結果，陣列順序有意義（例如 `knight.*` 的路線、`progress.discard` 的牌序）。
 */
/**
 * 遞迴把物件重建成 key 排序後的物件，陣列保留順序；只用來產生比對用的鍵。物件仍是物件、陣列仍是陣列，
 * 所以 `{ a: 1 }` 與 `[['a', 1]]` 的鍵不同。
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, inner]) => [key, canonical(inner)]),
    );
  }
  return value;
}

export function dedupeCandidates(candidates: readonly Scored<BotCommand>[]): Scored<BotCommand>[] {
  const keyOf = (command: BotCommand): string => JSON.stringify(canonical(command));
  const seen = new Map<string, { item: BotCommand; score: number }>();
  const out: { item: BotCommand; score: number }[] = [];
  for (const candidate of candidates) {
    const key = keyOf(candidate.item);
    const first = seen.get(key);
    if (!first) {
      const entry = { item: candidate.item, score: candidate.score };
      seen.set(key, entry);
      out.push(entry);
    } else if (candidate.score > first.score) {
      first.score = candidate.score;
    }
  }
  return out;
}

/** 計畫的下一步；付不起或已不合法時回傳 null。 */
export function planStep(turn: TurnContext, plan: Plan): BotCommand | null {
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

/**
 * 這個回合（自最近一次 `turn.started` 起）自己做過的銀行交易：收進來的牌與換出去的牌。策略沒有跨呼叫的狀態，
 * 所以從投影的事件歷史推回來；歷史缺漏或沒有附（測試用的投影）時兩個集合都是空的。
 */
function bankTradesThisTurn(view: GameView, selfId: string): { received: Set<CardKind>; gave: Set<CardKind> } {
  const received = new Set<CardKind>();
  const gave = new Set<CardKind>();
  for (let index = view.events.length - 1; index >= 0; index--) {
    const event = view.events[index]!;
    if (event.type === 'turn.started') break;
    if (event.type !== 'trade.bank' || event.params.playerId !== selfId) continue;
    received.add(event.params.receive as CardKind);
    gave.add(event.params.give as CardKind);
  }
  return { received, gave };
}

/**
 * 手牌超過上限（`Economy.handLimit`，base 為 7，C&K 每座城牆 +2；張數含 commodity）時：先買發展卡、再鋪有用的路，最後把過剩的牌換成需要的。
 *
 * 銀行交易不來回換（#173）：同一回合內不換出剛從銀行換進來的牌、也不再換入換出去過的牌；兩個計畫的排名會隨手牌互相翻轉，
 * 光看當下的缺牌會在 A → B、B → A 之間打轉。再加上「收下去馬上又夠格當 give 的牌排後面」，在沒有事件歷史時也能避開大部分。
 */
export function handRelief(turn: TurnContext): Command | null {
  const { view } = turn;
  const economy = turn.economy;
  const hand = economy.hand;
  if (handSize(hand) <= economy.handLimit) return null;
  if (view.devDeckSize > 0 && canAfford(hand, COSTS.devCard)) return { type: 'build.devCard' };
  if (economy.left.roads > 0 && canAfford(hand, COSTS.road)) {
    const edge = usefulRoad(turn, economy.left.roads > 3);
    if (edge !== null) return { type: 'build.road', edge };
  }
  const target = economy.plans[0]?.cost ?? {};
  const missing = deficitOf(hand, target);
  const { kinds, rates } = economy;
  const traded = bankTradesThisTurn(view, turn.ctx.selfId);
  let give: CardKind | null = null;
  for (const kind of kinds) {
    const rate = rates[kind];
    if (rate === undefined || traded.received.has(kind)) continue;
    const extra = (hand[kind] ?? 0) - (target[kind] ?? 0);
    if (extra < rate) continue;
    if (!give || extra - rate > (hand[give] ?? 0) - (target[give] ?? 0) - rates[give]!) give = kind;
  }
  if (!give) return null;
  // 收下去馬上又夠格當 give 的牌（超出計畫所需的張數 ≥ 匯率）排後面：不然下一步就會把它換回去，
  // 或者換掉剛收到的牌（計畫空了、或已經湊齊時，`missing` 全是 0，只剩權重決定收什麼）。
  const recyclable = (kind: CardKind): number => {
    const rate = rates[kind];
    return rate !== undefined && (hand[kind] ?? 0) + 1 - (target[kind] ?? 0) >= rate ? 1 : 0;
  };
  const receive = kinds
    .filter((kind) => kind !== give && !traded.gave.has(kind) && bankHas(view, kind))
    .sort(
      (a, b) =>
        (missing[b] ?? 0) - (missing[a] ?? 0) ||
        recyclable(a) - recyclable(b) ||
        (economy.weights[b] ?? 0) - (economy.weights[a] ?? 0),
    )[0];
  return receive ? { type: 'trade.bank', give, receive } : null;
}
