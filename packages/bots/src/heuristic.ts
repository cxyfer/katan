/**
 * standard／easy 啟發式策略（規格 §6）。每次呼叫只決定一個指令；下一次呼叫
 * 會從新的投影重新評估，因此不需要跨呼叫狀態。
 */

import {
  COSTS,
  RESOURCES,
  seededRng,
  type Command,
  type DevCardType,
  type GameView,
  type PublicPlayerView,
  type Resource,
  type Rng,
} from '@catan/rules';
import {
  boardModel,
  isFreeSpot,
  playerYield,
  vertexYield,
  type BoardModel,
} from './board.ts';
import {
  bestRouteEdge,
  canAfford,
  deficitOf,
  economyOf,
  handSize,
  PIP_VALUE,
  resourceWeights,
  settlementSpotValue,
  weightedPips,
  type Cost,
  type Economy,
  type Plan,
} from './economy.ts';
import { pendingDuty } from './fallback.ts';
import {
  acceptMargin,
  bankTradeToward,
  offerGain,
  offersAwaitingMe,
  ownOfferStep,
  ownOpenOffers,
  proposeOffer,
} from './trade.ts';
import type { BotContext, BotLevel, BotPolicy } from './types.ts';

export interface LevelParams {
  /** 從前幾名候選中隨機挑選；1 代表永遠選最佳。 */
  readonly topK: number;
  /** 是否主動對全桌開價。 */
  readonly proposeOffers: boolean;
  /** 是否為了最大騎士團主動打騎士（否則只在強盜壓到自己時打）。 */
  readonly eagerKnights: boolean;
  /** 接受報價需要的最低效用增益。 */
  readonly acceptMargin: number;
  /** 壟斷至少預期拿到幾張才打。 */
  readonly monopolyMin: number;
}

export const LEVEL_PARAMS: Readonly<Record<BotLevel, LevelParams>> = {
  standard: { topK: 1, proposeOffers: true, eagerKnights: true, acceptMargin: 0.6, monopolyMin: 3 },
  easy: { topK: 3, proposeOffers: false, eagerKnights: false, acceptMargin: 1.6, monopolyMin: 4 },
};

interface Scored<T> {
  item: T;
  score: number;
}

/** 決策時共用的資料；`economy` 延遲計算，非行動者多半用不到。 */
class Turn {
  private cachedEconomy: Economy | null = null;
  readonly view: GameView;
  readonly ctx: BotContext;
  readonly params: LevelParams;
  readonly me: PublicPlayerView;
  readonly model: BoardModel;
  readonly rng: Rng;

  // 不用 parameter properties：bench 以 Node 的 strip-only 模式執行。
  constructor(view: GameView, ctx: BotContext, params: LevelParams, me: PublicPlayerView) {
    this.view = view;
    this.ctx = ctx;
    this.params = params;
    this.me = me;
    this.model = boardModel(view, ctx.selfId);
    this.rng = seededRng(ctx.seed);
  }

  get economy(): Economy {
    this.cachedEconomy ??= economyOf(this.model);
    return this.cachedEconomy;
  }

  /** paired Player 2 不可發起或結算國內交易。 */
  get pairedSecond(): boolean {
    return this.model.profile.paired && this.view.turn.pairedActor === 2;
  }

  pick<T>(candidates: readonly Scored<T>[]): T | null {
    if (candidates.length === 0) return null;
    // 穩定排序：同分時保留原本（索引）順序，standard 因此完全決定。
    const sorted = candidates.slice().sort((a, b) => b.score - a.score);
    const k = Math.min(this.params.topK, sorted.length);
    return sorted[k <= 1 ? 0 : this.rng.int(k)]!.item;
  }
}

function decide(view: GameView, ctx: BotContext, params: LevelParams): Command | null {
  if (view.result) return null;
  const me = view.players.find((player) => player.id === ctx.selfId);
  if (!me || !view.hints) return null;
  const turn = new Turn(view, ctx, params, me);
  if (view.pending) return pendingDecision(turn) ?? pendingDuty(view, ctx.selfId);
  if (view.turn.phase === 'setup') return view.turn.playerId === ctx.selfId ? setupDecision(turn) : null;
  if (view.turn.playerId !== ctx.selfId) return respondToOffers(turn);
  if (view.turn.phase === 'preroll') return prerollDecision(turn);
  if (view.turn.phase === 'action') return actionDecision(turn);
  return null;
}

export function heuristicPolicy(level: BotLevel): BotPolicy {
  const params = LEVEL_PARAMS[level] ?? LEVEL_PARAMS.standard;
  return { decide: (view, ctx) => decide(view, ctx, params) };
}

// ---------------------------------------------------------------------------
// 待決效果
// ---------------------------------------------------------------------------

function pendingDecision(turn: Turn): Command | null {
  const { view, ctx } = turn;
  const pending = view.pending!;
  switch (pending.kind) {
    case 'discard': {
      if (!pending.waitingFor.includes(ctx.selfId)) return null;
      return discardDecision(turn, pending.required[ctx.selfId] ?? 0);
    }
    case 'moveRobber': {
      if (pending.actor !== ctx.selfId) return null;
      const hex = robberHex(turn);
      return hex === null ? null : { type: 'pending.moveRobber', hex };
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
      const edge = usefulRoad(turn, true);
      return edge === null ? null : { type: 'build.road', edge };
    }
  }
}

/** 保留最接近目標的組合，先丟過剩、再丟價值低的資源。 */
function discardDecision(turn: Turn, count: number): Command | null {
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

/** 強盜：壓領先者的高產能格、避開自己的建築，並優先有牌可偷的格子。 */
function robberHex(turn: Turn): number | null {
  const { view, model, ctx, me } = turn;
  const candidates: Scored<number>[] = [];
  view.board.terrain.forEach((terrain, hex) => {
    if (hex === view.board.robber || terrain === 'sea') return;
    const pips = model.hexPips[hex]!;
    let score = 0;
    let stealable = 0;
    for (const vertex of model.hexVertices[hex]!) {
      const building = view.board.buildings[vertex];
      if (!building) continue;
      const factor = building.city ? 2 : 1;
      if (building.player === ctx.selfId) {
        score -= pips * factor * 3;
        continue;
      }
      const owner = view.players.find((player) => player.id === building.player)!;
      const lead =
        1 + 0.35 * Math.max(0, owner.publicScore - me.publicScore) +
        (owner.publicScore >= view.victoryTarget - 3 ? 0.8 : 0);
      score += pips * factor * lead;
      if (owner.handSize > 0) stealable = Math.max(stealable, owner.handSize);
    }
    if (stealable > 0) score += 1.5 + 0.25 * Math.min(stealable, 8);
    candidates.push({ item: hex, score });
  });
  return turn.pick(candidates);
}

function stealVictim(turn: Turn, candidates: readonly string[]): string | null {
  const scored = candidates.map((id) => {
    const player = turn.view.players.find((candidate) => candidate.id === id);
    return { item: id, score: (player?.handSize ?? 0) * 10 + (player?.publicScore ?? 0) };
  });
  return turn.pick(scored);
}

function plentyPick(turn: Turn): Resource | null {
  const economy = turn.economy;
  const plan = economy.plans[0];
  // 先補下一步（例如通往聚落的道路），再補整個計畫。
  const next = deficitOf(economy.hand, plan?.nextCost ?? {});
  const missing = deficitOf(economy.hand, plan?.cost ?? {});
  const scored: Scored<Resource>[] = [];
  for (const resource of RESOURCES) {
    if (turn.view.bank[resource] <= 0) continue;
    const score =
      (next[resource] > 0 ? 20 : 0) +
      (missing[resource] > 0 ? 10 + missing[resource] : 0) +
      economy.weights[resource] +
      (economy.yield[resource] === 0 ? 1 : 0);
    scored.push({ item: resource, score });
  }
  // 豐收之年拿的是確定需要的牌，不加隨機。
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.item ?? null;
}

/**
 * 最有用的合法道路：先朝主要聚落目標，再延長最長道路，最後朝附近最好的空點。
 * `anyEdge` 為 true 時（免費道路）至少回傳一條合法道路。
 */
function usefulRoad(turn: Turn, anyEdge: boolean): number | null {
  const { view, model } = turn;
  const legal = view.hints?.legalRoads ?? [];
  if (legal.length === 0) return null;
  const economy = turn.economy;
  for (const plan of economy.plans) {
    if ((plan.kind === 'settlement' || plan.kind === 'longestRoad') && plan.roads.length > 0) {
      if (legal.includes(plan.roads[0]!)) return plan.roads[0]!;
    }
  }
  const longer = bestRouteEdge(model, legal, economy.myRoute);
  if (longer !== null) return longer;
  if (!anyEdge) return null;
  const scored = legal.map((edge) => ({ item: edge, score: roadDirectionScore(turn, edge) }));
  return turn.pick(scored);
}

/** 道路遠端一到兩步內最好的空點價值。 */
function roadDirectionScore(turn: Turn, edge: number): number {
  const { model, ctx } = turn;
  const weights = resourceWeights(model);
  const mine = playerYield(model, ctx.selfId, true);
  const [a, b] = model.topo.edges[edge]!.vertices;
  const ownA = model.view.board.buildings[a]?.player === ctx.selfId || touchesOwnRoad(turn, a, edge);
  const far = ownA ? b : a;
  let best = 0;
  const visit = (vertex: number, factor: number): void => {
    if (isFreeSpot(model, vertex)) {
      best = Math.max(best, settlementSpotValue(model, vertex, weights, mine) * factor);
    }
  };
  visit(far, 1);
  for (const next of model.neighbors[far]!) {
    if (next === a || next === b) continue;
    visit(next, 0.75);
  }
  return best;
}

function touchesOwnRoad(turn: Turn, vertex: number, except: number): boolean {
  const { model, ctx } = turn;
  return model.topo.vertices[vertex]!.edges.some(
    (edge) => edge !== except && model.view.board.roads[edge]?.player === ctx.selfId,
  );
}

// ---------------------------------------------------------------------------
// 初始放置
// ---------------------------------------------------------------------------

function setupDecision(turn: Turn): Command | null {
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

function setupSpotScore(turn: Turn, vertex: number): number {
  const { model, ctx, view } = turn;
  const weights = resourceWeights(model);
  const mine = playerYield(model, ctx.selfId, true);
  const spot = vertexYield(model, vertex);
  let score = weightedPips(spot, weights);
  for (const resource of RESOURCES) {
    if (spot[resource] > 0 && mine[resource] === 0) score += 2;
  }
  const harbor = model.harborAt[vertex];
  if (harbor === 'generic') score += 1;
  else if (harbor) score += mine[harbor as Resource] + spot[harbor as Resource] >= 5 ? 2.5 : 0.5;
  if (view.turn.setup?.round === 2) {
    // 第二座聚落要讓開局能鋪路、能蓋聚落。
    const combined = { ...mine };
    for (const resource of RESOURCES) combined[resource] += spot[resource];
    if (combined.lumber === 0) score -= 3;
    if (combined.brick === 0) score -= 3;
    if (combined.grain === 0) score -= 1.5;
    if (combined.wool === 0) score -= 1;
    if (combined.ore === 0) score -= 1;
    // 第二座聚落立即給起始資源。
    for (const hex of model.topo.vertices[vertex]!.hexes) if (model.hexResource[hex]) score += 0.3;
  }
  return score;
}

// ---------------------------------------------------------------------------
// 回應報價（非行動者）
// ---------------------------------------------------------------------------

function respondToOffers(turn: Turn): Command | null {
  const { view, ctx, params } = turn;
  if (view.turn.phase !== 'action') return null;
  for (const offer of offersAwaitingMe(view, ctx.selfId)) {
    const gain = offerGain(turn.economy, offer);
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

function canPlay(turn: Turn, card: DevCardType): boolean {
  const { me, view } = turn;
  if (view.turn.devCardPlayed) return false;
  if (!(me.devCards ?? []).includes(card)) return false;
  // 規則引擎在同類卡本回合剛買進時會拒絕打出舊卡（騎士除外）。
  return card === 'knight' || !(me.newDevCards ?? []).includes(card);
}

function prerollDecision(turn: Turn): Command | null {
  const knight = knightDecision(turn);
  if (knight) return knight;
  return turn.view.hints!.canRoll ? { type: 'turn.roll' } : null;
}

/** 自己被強盜擋住的點數（城市加倍）。 */
function blockedPips(turn: Turn): number {
  const { view, model, ctx } = turn;
  const hex = view.board.robber;
  let blocked = 0;
  for (const vertex of model.hexVertices[hex] ?? []) {
    const building = view.board.buildings[vertex];
    if (building?.player === ctx.selfId) blocked += model.hexPips[hex]! * (building.city ? 2 : 1);
  }
  return blocked;
}

function knightDecision(turn: Turn): Command | null {
  if (!canPlay(turn, 'knight')) return null;
  const { view, me, params } = turn;
  const holder = view.awards.largestArmy;
  const holderKnights = holder ? view.players.find((player) => player.id === holder)?.playedKnights ?? 0 : 0;
  const takesArmy = holder !== me.id && me.playedKnights + 1 >= 3 && me.playedKnights + 1 > holderKnights;
  const wins = takesArmy && (me.ownScore ?? me.publicScore) + 2 >= view.victoryTarget;
  const unblock = blockedPips(turn) >= 3;
  if (!unblock && !wins && !(params.eagerKnights && takesArmy)) return null;
  const hex = robberHex(turn);
  return hex === null ? null : { type: 'dev.playKnight', hex };
}

function actionDecision(turn: Turn): Command | null {
  const { view, ctx, params } = turn;
  const hints = view.hints!;

  // 1. 自己的報價：結算、撤回或等待。等待期間不做別的事，避免手牌變動。
  const own = ownOpenOffers(view, ctx.selfId)[0];
  if (own) {
    return ownOfferStep(view, turn.economy, own, ctx.offerPhases[own.id] ?? 'expired', !turn.pairedSecond);
  }

  // 2. 別人直接對我（行動者）提出的反報價：划算就結算，否則拒絕。
  for (const offer of offersAwaitingMe(view, ctx.selfId)) {
    const gain = offerGain(turn.economy, offer);
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
    if (plan && (plan.kind === 'city' || (plan.kind === 'settlement' && plan.roads.length === 0))) {
      const offer = proposeOffer(view, turn.economy, ctx.selfId, plan.nextCost, 1);
      if (offer) return offer;
    }
  }

  // 6. 手牌太多時先消化，降低擲出 7 時的損失。
  const relief = handRelief(turn);
  if (relief) return relief;

  return hints.canEndTurn ? { type: 'turn.end' } : null;
}

function devCardDecision(turn: Turn): Command | null {
  const { view } = turn;
  const knight = knightDecision(turn);
  if (knight) return knight;
  const economy = turn.economy;
  const plan = economy.plans[0];

  if (canPlay(turn, 'yearOfPlenty') && plan) {
    const bankTotal = RESOURCES.reduce((sum, resource) => sum + view.bank[resource], 0);
    const missing = deficitOf(economy.hand, plan.nextCost);
    const need = RESOURCES.reduce((sum, resource) => sum + missing[resource], 0);
    // 銀行總存量不足 2 張時，豐收之年的待決效果會無法完成。
    if (bankTotal >= 2 && need >= 1 && need <= 2) return { type: 'dev.playYearOfPlenty' };
  }

  if (canPlay(turn, 'monopoly')) {
    const resource = monopolyChoice(turn);
    if (resource) return { type: 'dev.playMonopoly', resource };
  }

  // 道路建設需要至少兩個道路棋子，否則免費道路的待決效果可能無法完成。
  if (canPlay(turn, 'roadBuilding') && economy.left.roads >= 2 && usefulRoad(turn, false) !== null) {
    return { type: 'dev.playRoadBuilding' };
  }
  return null;
}

/** 依對手的公開產能估計他們手上各資源的張數。 */
function monopolyChoice(turn: Turn): Resource | null {
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

function buildDecision(turn: Turn): Command | null {
  const { view, model, ctx } = turn;
  const hints = view.hints!;
  const economy = turn.economy;
  const hand = economy.hand;
  const { left, weights } = economy;

  // a) 付得起的城市與聚落：立即得分，優先於其他計畫。
  const scoring: Scored<Command>[] = [];
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
  const scoringPick = turn.pick(scoring);
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
function planStep(turn: Turn, plan: Plan): Command | null {
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
  }
}

/** 手牌 8 張以上時：先買發展卡、再鋪有用的路，最後把過剩資源換成需要的。 */
function handRelief(turn: Turn): Command | null {
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
