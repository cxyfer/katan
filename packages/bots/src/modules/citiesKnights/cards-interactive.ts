/**
 * 互動型進步卡（F2，共 10 種）：invention、commercialHarbor、guildDues、espionage、intrigue、sabotage、wedding、
 * taxation、treason、diplomacy（C&K 計畫 §4.1、§4.3、§5 CK-C）。
 *
 * - 只在 `hints.progress[].playable` 時打，目標一律取自 `targets`；每張卡只有「現在就值得打」才回傳候選，
 *   分數是勝利分當量（約 1.8–3.3），高於 base 的立即建造、低於蠻族防禦（`DEFENSE_SCORE`）。
 * - 手牌超過上限（`progressExcess > 0`）時：打出比棄掉好，所以條件放寬到「價值為正」，並與 F1 一樣 +10，
 *   先打再棄（`cards.ts`）。
 * - easy 不打 F2（D-CK3），全部 frame 照常回應。paired 的 Player 2 依 hints 打 Commercial Harbor（D-CK2）。
 * - 多目標的組合逐一模擬合法性（K3，比照 Smithing 的 C4）：Invention 的兩格取自 `targets.hexes` 並且互異；
 *   Commercial Harbor 的每次報價都檢查自己手上有那種資源，目標取自 `hints.harborTargets`（只剩還沒報價的人）。
 *
 * 全部只讀公開資訊與自己的 hints：對手手牌只用張數（`handSize`）與進步卡張數（`progressCounts`），不讀對手的組成、
 * 進步卡身分、牌庫順序，也不讀 `view.events`（B-FAIR）。espionage 與 guildDues 看到對手手牌是回應 frame 時合法的
 * 資料（`frames.ts`），打牌時只用公開的張數選目標。
 *
 * 決定性（P4）：不消耗亂數；同分取順序靠前者（玩家依 `view.players`，路口與邊依編號）。
 */

import { BASE_AWARD_RULES, CARD_KINDS, RESOURCES, type PublicPlayerView, type Resource } from '@catan/rules';
import { isFreeSpot, routeLength, searchRoads, type BoardModel } from '../../board.ts';
import { PIP_VALUE } from '../../economy.ts';
import type { BotCommand, Scored, TurnContext } from '../types.ts';
import { lowestValueCards } from './cards.ts';
import { DEFENSE_SCORE, defenseWindow } from './defense.ts';
import { consideredOptions, hasCity } from './improve.ts';
import { knightsOf, threatOf } from './knights.ts';
import { ckCommands, ckHints, ckView } from './view.ts';

/** 互動卡的十種。 */
export const F2_CARDS: readonly string[] = [
  'invention',
  'commercialHarbor',
  'guildDues',
  'espionage',
  'intrigue',
  'sabotage',
  'wedding',
  'taxation',
  'treason',
  'diplomacy',
];

/** 一張資源卡的勝利分當量（4 張牌約換 1 分，再偏保守）。 */
export const CARD_VP = 0.2;
/** 值得打的互動卡的底分：高於 base 的立即建造（約 1.2–1.7）。 */
const PLAY_BASE = 1.8;
/** 互動卡的分數上限：不得搶過蠻族防禦。 */
const PLAY_CAP = DEFENSE_SCORE - 0.2;
/** 超過手牌上限時，打牌比棄牌優先（與 F1 相同）。 */
export const EXCESS_BONUS = 10;
/** 報價的分數：已經打出 Commercial Harbor，趁牌還在時用掉。 */
const OFFER_SCORE = 2.3;

// ---------------------------------------------------------------------------
// 公開資訊的小工具
// ---------------------------------------------------------------------------

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function numbersOf(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number') : [];
}

/** 其他玩家（依 `view.players` 的順序）。 */
export function opponentsOf(turn: TurnContext): PublicPlayerView[] {
  return turn.view.players.filter((player) => player.id !== turn.ctx.selfId);
}

/**
 * 對手對自己的威脅權重：領先越多、越接近勝利越大；落後的對手也有 0.5（他們的收益還是會拉近差距）。
 * 與 base 的強盜評分相同的形狀（`base/robber.ts`）。
 */
export function rivalWeight(turn: TurnContext, rival: PublicPlayerView): number {
  const lead = Math.max(0, rival.publicScore - turn.me.publicScore);
  return 0.5 + 0.35 * lead + (rival.publicScore >= turn.view.victoryTarget - 3 ? 0.6 : 0);
}

/** 對手的進步卡張數（公開）。 */
function progressCountOf(turn: TurnContext, playerId: string): number {
  return ckView(turn.view)?.progressCounts?.[playerId] ?? 0;
}

/** 自己的進步卡張數。 */
export function progressHeld(turn: TurnContext): number {
  return turn.me.progressCards?.length ?? 0;
}

/** 手上多餘的資源：減去前兩個計畫需要的張數（取較大者），每種至少 0。 */
export function spareResources(turn: TurnContext): Record<Resource, number> {
  const { economy } = turn;
  const out = {} as Record<Resource, number>;
  for (const resource of RESOURCES) {
    const need = Math.max(0, ...economy.plans.slice(0, 2).map((plan) => plan.cost[resource] ?? 0));
    out[resource] = Math.max(0, (economy.hand[resource] ?? 0) - need);
  }
  return out;
}

function spareTotal(turn: TurnContext): number {
  return RESOURCES.reduce((sum, resource) => sum + spareResources(turn)[resource], 0);
}

/** 還要幾條路才到：對價值的折扣；超過 2 條路視為到不了。 */
const DISTANCE_FACTOR: Readonly<Record<number, number>> = { 0: 1, 1: 0.6, 2: 0.3 };

/** 聚落點的價值：1 + 點數 × `PIP_VALUE`（與 base 的立即建造同尺度）。 */
export function spotValue(model: BoardModel, vertex: number): number {
  const pips = model.topo.vertices[vertex]!.hexes.reduce((sum, hex) => sum + model.hexPips[hex]!, 0);
  return 1 + PIP_VALUE * pips;
}

/** 玩家 `playerId` 在這個盤面下最好的擴張選擇的價值（兩條路以內最好的空點，依距離折扣）。 */
export function expansionValue(model: BoardModel, playerId: string): number {
  const search = searchRoads(model, playerId, 2);
  let best = 0;
  model.topo.vertices.forEach((_, vertex) => {
    const factor = DISTANCE_FACTOR[search.distance[vertex] ?? Infinity];
    if (factor === undefined || !isFreeSpot(model, vertex)) return;
    best = Math.max(best, factor * spotValue(model, vertex));
  });
  return best;
}

/** 自己的計畫目標路口與道路端點（前 3 個計畫）。 */
function planVertices(turn: TurnContext): Set<number> {
  const out = new Set<number>();
  for (const plan of turn.economy.plans.slice(0, 3)) {
    if (plan.vertex !== null) out.add(plan.vertex);
    for (const edge of plan.roads) for (const vertex of turn.model.topo.edges[edge]?.vertices ?? []) out.add(vertex);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 各卡的評估：回傳 { fields, value }（勝利分當量），不值得打時 null
// ---------------------------------------------------------------------------

interface Play {
  readonly fields: Record<string, unknown>;
  readonly value: number;
}

interface Context {
  readonly turn: TurnContext;
  /** 手牌超過上限：價值為正就打。 */
  readonly forced: boolean;
}

/** Guild Dues：看領先者的手牌拿 2 張。目標是手牌最多的領先者（公開張數）。 */
function guildDues(ctx: Context, targets: Record<string, unknown>): Play | null {
  const { turn, forced } = ctx;
  let best: { id: string; hand: number; score: number } | null = null;
  for (const id of stringsOf(targets.players)) {
    const rival = turn.view.players.find((player) => player.id === id);
    if (!rival || rival.handSize < (forced ? 1 : 3)) continue;
    if (!best || rival.handSize > best.hand || (rival.handSize === best.hand && rival.publicScore > best.score)) {
      best = { id, hand: rival.handSize, score: rival.publicScore };
    }
  }
  if (!best) return null;
  return { fields: { target: best.id }, value: CARD_VP * Math.min(2, best.hand) * 1.5 };
}

/** Espionage：看對手的進步卡拿 1 張。目標是進步卡最多的對手（至少 2 張才有得挑）。 */
function espionage(ctx: Context, targets: Record<string, unknown>): Play | null {
  const { turn, forced } = ctx;
  let best: { id: string; count: number; score: number } | null = null;
  for (const id of stringsOf(targets.players)) {
    const count = progressCountOf(turn, id);
    if (count < (forced ? 1 : 2)) continue;
    const score = turn.view.players.find((player) => player.id === id)?.publicScore ?? 0;
    if (!best || count > best.count || (count === best.count && score > best.score)) best = { id, count, score };
  }
  if (!best) return null;
  return { fields: { target: best.id }, value: 0.3 + 0.1 * best.count };
}

/** 假設盤面：`vertex` 上的騎士不在（路線與建地都不再被它擋住）。 */
export function withoutKnightAt(model: BoardModel, vertex: number): BoardModel {
  return {
    ...model,
    blocker: (at, candidate) => (candidate === vertex ? null : model.blocker?.(at, candidate) ?? null),
    siteBlocked: (at, candidate) => (candidate === vertex ? false : model.siteBlocked?.(at, candidate) ?? false),
  };
}

/** 自己的路線被這個點上的對手騎士切斷時，放掉它能多出幾格。 */
function routeGain(turn: TurnContext, vertex: number): number {
  const { model, ctx } = turn;
  return Math.max(0, routeLength(withoutKnightAt(model, vertex), ctx.selfId) - routeLength(model, ctx.selfId));
}

/**
 * Intrigue：擠走一隻碰到自己路線的對手騎士（不需要自己的騎士）。只有擠走它對自己有好處才打：
 * - 它站在前 3 個計畫的目標點或道路端點上（+1.2）；
 * - 騎士走了之後，自己最好的擴張選擇變好（開出聚落點或讓路線通過，`expansionValue` 前後的差，×0.6）；
 * - 自己的最長路線多出幾格（×0.45）；
 * - 那個路口還有沒鋪的邊，自己的路線原本可以延伸過去（+0.15）。
 * 被擠走的騎士由對手自己選退路、狀態不變，所以沒有這些好處（例如封死的路口）就是白白用掉一張卡。
 * 手牌超過上限時：這張卡本來就是最先被棄掉的，打出去至少不比棄掉差，所以沒有好處也打。
 */
function intrigue(ctx: Context, targets: Record<string, unknown>): Play | null {
  const { turn, forced } = ctx;
  const { model, view } = turn;
  const wanted = planVertices(turn);
  const before = expansionValue(model, turn.ctx.selfId);
  let best: { vertex: number; value: number } | null = null;
  for (const vertex of numbersOf(targets.vertices)) {
    if (!ckView(view)?.knights.some((knight) => knight.vertex === vertex)) continue;
    const gain = Math.max(0, expansionValue(withoutKnightAt(model, vertex), turn.ctx.selfId) - before);
    const open = model.topo.vertices[vertex]!.edges.some((edge) => !view.board.roads[edge]);
    const value = (wanted.has(vertex) ? 1.2 : 0) + 0.6 * gain + 0.45 * routeGain(turn, vertex) + (open ? 0.15 : 0);
    if (!best || value > best.value + 1e-9) best = { vertex, value };
  }
  if (!best) return null;
  if (best.value <= 0) {
    const hand = turn.me.progressCards ?? [];
    const discarded = forced && lowestValueCards(hand, Math.max(1, hand.length - 4)).includes('intrigue');
    if (!discarded) return null;
    return { fields: { vertex: best.vertex }, value: 0.01 };
  }
  return { fields: { vertex: best.vertex }, value: best.value };
}

/** Sabotage：分數不低於自己的對手棄一半手牌。全部是公開的手牌張數與分數。 */
function sabotage(ctx: Context, targets: Record<string, unknown>): Play | null {
  const { turn, forced } = ctx;
  let value = 0;
  let victims = 0;
  for (const id of stringsOf(targets.players)) {
    const rival = turn.view.players.find((player) => player.id === id);
    if (!rival) continue;
    const discards = Math.floor(rival.handSize / 2);
    if (discards <= 0) continue;
    victims += 1;
    value += CARD_VP * discards * (1 + (rival.publicScore > turn.me.publicScore ? 0.5 : 0));
  }
  if (victims === 0 || value < (forced ? 0.01 : 0.8)) return null;
  return { fields: {}, value };
}

/** Wedding：分數比自己高的對手各給 2 張。 */
function wedding(ctx: Context, targets: Record<string, unknown>): Play | null {
  const { turn, forced } = ctx;
  let cards = 0;
  for (const id of stringsOf(targets.players)) {
    const rival = turn.view.players.find((player) => player.id === id);
    if (rival) cards += Math.min(2, rival.handSize);
  }
  if (cards < (forced ? 1 : 2)) return null;
  return { fields: {}, value: CARD_VP * cards * 1.1 };
}

/** Taxation：只移動強盜，向放在那格的每位對手各偷 1 張。需要強盜已啟動；價值 = 偷到的牌加上壓住對手的點數。 */
function taxation(ctx: Context, targets: Record<string, unknown>): Play | null {
  const { turn, forced } = ctx;
  const { model, view } = turn;
  if (ckView(view)?.robberActive !== true) return null;
  const self = turn.ctx.selfId;
  /** 強盜壓在 `hex` 時對自己的好處：對手被擋掉的點數（依威脅權重）減去自己被擋掉的（`ownFactor` 倍）。 */
  const pressure = (hex: number, ownFactor: number): number => {
    let sum = 0;
    for (const vertex of model.hexVertices[hex] ?? []) {
      const building = view.board.buildings[vertex];
      if (!building) continue;
      const pips = model.hexPips[hex]! * (building.city ? 2 : 1);
      if (building.player === self) sum -= ownFactor * pips;
      else {
        const owner = view.players.find((player) => player.id === building.player);
        sum += pips * (owner ? rivalWeight(turn, owner) : 0.5);
      }
    }
    return sum;
  };
  // 強盜離開現在的格子：被它壓住的人解除封鎖（自己是好事，對手是壞事）。
  const before = view.board.robber >= 0 ? pressure(view.board.robber, 1) : 0;
  let best: { hex: number; value: number; stolen: number } | null = null;
  for (const hex of numbersOf(targets.hexes)) {
    const owners = new Set<string>();
    for (const vertex of model.hexVertices[hex] ?? []) {
      const building = view.board.buildings[vertex];
      if (building && building.player !== self) owners.add(building.player);
    }
    let stolen = 0;
    for (const id of owners) if ((view.players.find((player) => player.id === id)?.handSize ?? 0) > 0) stolen += 1;
    const value = CARD_VP * 1.2 * stolen + PIP_VALUE * (pressure(hex, 1.5) - before);
    if (!best || value > best.value + 1e-9) best = { hex, value, stolen };
  }
  if (!best) return null;
  if (best.value < (forced ? 0.01 : 0.45) || (!forced && best.stolen < 2 && best.value < 0.7)) return null;
  return { fields: { hex: best.hex }, value: best.value };
}

/** Treason：對手移除一隻騎士，自己可以放一隻同級以下的（狀態沿用）。目標是騎士最強的對手；沒有放置點時價值減半。 */
function treason(ctx: Context, targets: Record<string, unknown>): Play | null {
  const { turn, forced } = ctx;
  const { view } = turn;
  const hints = ckHints(view.hints);
  const placeable = (hints?.recruitSites?.length ?? 0) > 0;
  let best: { id: string; strength: number } | null = null;
  for (const id of stringsOf(targets.players)) {
    const knights = knightsOf(view, id);
    if (knights.length === 0) continue;
    const owner = view.players.find((player) => player.id === id);
    const strength =
      knights.reduce((sum, knight) => sum + knight.level * (knight.active ? 1 : 0.4), 0) +
      (owner && owner.publicScore > turn.me.publicScore ? 0.5 : 0) +
      0.2 * knights.length;
    if (!best || strength > best.strength) best = { id, strength };
  }
  if (!best) return null;
  const threat = threatOf(view, turn.ctx.selfId);
  const defending = defenseWindow(turn) && threat.atRisk;
  // 放下的騎士沿用移除那隻的狀態：對手的騎士多半已啟動，攻擊逼近時等於一隻現成的防守。
  const value = (placeable ? 0.55 : 0.1) + 0.12 * best.strength + (defending && placeable ? 0.8 : 0);
  if (value < (forced ? 0.01 : 0.9)) return null;
  return { fields: { target: best.id }, value };
}

/** 打掉對手的一條開放道路後，對手的最長路線（假設盤面：那條路不在）。 */
function routeAfterRemoval(turn: TurnContext, edge: number, owner: string): number {
  const { model, view } = turn;
  const roads = view.board.roads.map((road, index) => (index === edge ? null : road));
  const at: BoardModel = { ...model, view: { ...view, board: { ...view.board, roads } } };
  return routeLength(at, owner);
}

/**
 * 持有者 `owner` 的最長路線掉到 `after` 之後，最長道路由誰持有（照 rules 的 `recomputeAwards`，C&K 沿用基礎規則）：
 * - owner 仍有資格（≥ 最短長度）：依座位順序第一個「嚴格長於」owner 的人接手，沒有就保留；平手不奪走。
 * - owner 失去資格：有資格的人之中取最長，同長取座位最小；沒有人有資格就空缺（`null`）。
 * `lengths` 是各人目前的最長路線（owner 以 `after` 取代）。
 */
export function roadHolderAfter(
  players: readonly Pick<PublicPlayerView, 'id' | 'seat'>[],
  lengths: ReadonlyMap<string, number>,
  owner: string,
  after: number,
): string | null {
  const minimum = BASE_AWARD_RULES.minLongestRoad;
  const ordered = players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((player) => ({ id: player.id, length: player.id === owner ? after : (lengths.get(player.id) ?? 0) }));
  const candidates = ordered.filter((player) => player.length >= minimum);
  if (after >= minimum) return candidates.find((player) => player.length > after)?.id ?? owner;
  if (candidates.length === 0) return null;
  const longest = Math.max(...candidates.map((player) => player.length));
  return candidates.find((player) => player.length === longest)!.id;
}

/** Diplomacy：拆掉別人的開放道路。價值在於讓最長道路的持有者掉下來，或縮短領先者的路線。 */
function diplomacy(ctx: Context, targets: Record<string, unknown>): Play | null {
  const { turn, forced } = ctx;
  const { model, view } = turn;
  const self = turn.ctx.selfId;
  const holder = view.awards.longestRoad;
  const lengths = new Map<string, number>(view.players.map((player) => [player.id, routeLength(model, player.id)]));
  let best: { edge: number; value: number } | null = null;
  for (const edge of numbersOf(targets.edges)) {
    const road = view.board.roads[edge];
    if (!road || road.player === self) continue;
    const owner = view.players.find((player) => player.id === road.player);
    if (!owner) continue;
    const before = lengths.get(owner.id) ?? 0;
    const after = routeAfterRemoval(turn, edge, owner.id);
    const drop = before - after;
    if (drop <= 0) continue;
    let value = 0.12 * drop * rivalWeight(turn, owner);
    if (holder === owner.id) {
      // 照 rules 的重算規則推演誰接手：持有者失去 2 分；只有自己真的接到才再加 2 分（同長時座位較後的拿不到）。
      const next = roadHolderAfter(view.players, lengths, owner.id, after);
      if (next !== owner.id) value += next === self ? 4 : 2;
    }
    if (!best || value > best.value + 1e-9) best = { edge, value };
  }
  if (!best || best.value < (forced ? 0.01 : 0.8)) return null;
  return { fields: { edge: best.edge }, value: best.value };
}

/**
 * Invention：交換兩格的數字圓片（不含 2、6、8、12）。評估每一對的淨增益：自己的點數增加減去（依威脅權重
 * 加權的）對手增加；強盜壓住的格子不計（強盜不隨圓片移動）。窮舉 `targets.hexes` 的所有兩兩組合。
 */
export function inventionPlan(turn: TurnContext, hexes: readonly number[]): { hexes: [number, number]; net: number } | null {
  const { view, model, economy } = turn;
  const robber = ckView(view)?.robberActive === true ? view.board.robber : -1;
  /** 這格每 1 點數的淨收益：自己加權（卡種權重），對手依威脅權重；強盜壓住的格子為 0。 */
  const unit = (hex: number): number => {
    if (hex === robber) return 0;
    let sum = 0;
    for (const vertex of model.hexVertices[hex] ?? []) {
      const building = view.board.buildings[vertex];
      if (!building) continue;
      const amounts = model.hexYield?.(model, hex, vertex, building.city);
      const mine = building.player === turn.ctx.selfId;
      const rival = mine ? null : view.players.find((player) => player.id === building.player);
      const weight = mine ? 1 : -(rival ? rivalWeight(turn, rival) : 0.5);
      let cards = 0;
      if (amounts !== undefined) {
        for (const kind of CARD_KINDS) {
          const amount = amounts[kind];
          if (amount) cards += amount * (mine ? (economy.weights[kind] ?? 0) : 1);
        }
      } else {
        const resource = model.hexResource[hex];
        if (resource) cards += (building.city ? 2 : 1) * (mine ? economy.weights[resource] : 1);
      }
      sum += weight * cards;
    }
    return sum;
  };
  const units = new Map<number, number>(hexes.map((hex) => [hex, unit(hex)]));
  let best: { hexes: [number, number]; net: number } | null = null;
  for (let i = 0; i < hexes.length; i++) {
    for (let j = i + 1; j < hexes.length; j++) {
      const a = hexes[i]!;
      const b = hexes[j]!;
      const pa = model.hexPips[a]!;
      const pb = model.hexPips[b]!;
      if (pa === pb) continue;
      // a 換成 b 的點數、b 換成 a 的點數。
      const net = (pb - pa) * units.get(a)! + (pa - pb) * units.get(b)!;
      if (!best || net > best.net + 1e-9) best = { hexes: [a, b], net };
    }
  }
  return best;
}

function invention(ctx: Context, targets: Record<string, unknown>): Play | null {
  const { turn, forced } = ctx;
  const plan = inventionPlan(turn, numbersOf(targets.hexes));
  if (!plan || plan.net < (forced ? 0.5 : 3)) return null;
  return { fields: { hexes: plan.hexes }, value: Math.min(1.2, 0.13 * plan.net) };
}

/**
 * 改良缺的 commodity：有城市、沒有任何一級改良買得起、而且最近的一級只差幾張（`need`，最多是對手數）。
 * `value` 是那一級改良的勝利分當量。不缺（買得起、沒有城市、或差太多）時回 null。
 */
export function harborNeed(turn: TurnContext): { need: number; value: number } | null {
  if (!hasCity(turn.model)) return null;
  let best: { need: number; value: number } | null = null;
  for (const option of consideredOptions(turn.model, turn.level)) {
    const missing = option.cost - (turn.economy.hand[option.commodity] ?? 0);
    // 已經買得起：先買，不用打卡。
    if (missing <= 0) return null;
    if (missing > turn.view.players.length - 1) continue;
    if (!best || missing < best.need || (missing === best.need && option.value > best.value)) best = { need: missing, value: option.value };
  }
  return best;
}

/**
 * Commercial Harbor 要打的時候：改良缺 commodity（`harborNeed`）、而且有多餘的資源可以換。每張卡最多對
 * N−1 位對手各報價一次（報價由 `harborOfferActions` 逐一送出）。
 */
function commercialHarbor(ctx: Context): Play | null {
  const { turn, forced } = ctx;
  if (spareTotal(turn) < 1) return null;
  const need = harborNeed(turn);
  if (!need) return forced ? { fields: {}, value: 0.05 } : null;
  return { fields: {}, value: Math.min(1.2, 0.4 + need.value * Math.min(1, spareTotal(turn) / need.need)) };
}

const EVALUATORS: Readonly<Record<string, (ctx: Context, targets: Record<string, unknown>) => Play | null>> = {
  invention,
  commercialHarbor: (ctx) => commercialHarbor(ctx),
  guildDues,
  espionage,
  intrigue,
  sabotage,
  wedding,
  taxation,
  treason,
  diplomacy,
};

// ---------------------------------------------------------------------------
// 候選
// ---------------------------------------------------------------------------

/** 手上有哪些卡可打，每種的指令與分數；easy 不打（D-CK3）。 */
export function interactiveCardActions(turn: TurnContext): Scored<BotCommand>[] {
  if (turn.level === 'easy') return [];
  const hints = ckHints(turn.view.hints);
  if (!hints) return [];
  const forced = (hints.progressExcess ?? 0) > 0;
  const out: Scored<BotCommand>[] = [];
  for (const hint of hints.progress ?? []) {
    if (!hint.playable || !F2_CARDS.includes(hint.card)) continue;
    const play = EVALUATORS[hint.card]?.({ turn, forced }, hint.targets as Record<string, unknown>);
    if (!play) continue;
    const score = Math.min(PLAY_CAP, PLAY_BASE + play.value);
    out.push({ item: ckCommands.playProgress(hint.card, play.fields), score: forced ? score + EXCESS_BONUS : score });
  }
  // Commercial Harbor 打出之後的報價。
  out.push(...harborOfferActions(turn));
  return out;
}

// ---------------------------------------------------------------------------
// Commercial Harbor 的報價
// ---------------------------------------------------------------------------

/**
 * 對 `hints.harborTargets`（還沒報價的對手）逐一報價：給出手上最多餘的資源，換對手挑的一張 commodity
 * （對手沒有 commodity 時牌會退回）。只在改良還缺 commodity、而且有多餘資源時才報價，報價數受限於
 * 還缺的張數與多餘的資源張數，每位對手最多一次（`harborTargets` 報價後就不再列出它）。
 * 目標優先選看起來有 commodity 的對手：改良等級高、手牌多（公開資訊）。
 */
export function harborOfferActions(turn: TurnContext): Scored<BotCommand>[] {
  if (turn.level === 'easy') return [];
  const hints = ckHints(turn.view.hints);
  const targets = hints?.harborTargets ?? [];
  if (targets.length === 0) return [];
  const spare = spareResources(turn);
  const kinds = RESOURCES.filter((resource) => spare[resource] > 0);
  if (kinds.length === 0) return [];
  // 改良還缺 commodity 才報價（卡已經打了，剩下的報價就放著）。
  if (!harborNeed(turn)) return [];
  // 給最多餘的資源；同量時給權重最低的。
  let give: Resource = kinds[0]!;
  for (const resource of kinds) {
    if (
      spare[resource] > spare[give] ||
      (spare[resource] === spare[give] && (turn.economy.weights[resource] ?? 1) < (turn.economy.weights[give] ?? 1) - 1e-9)
    ) {
      give = resource;
    }
  }
  const ranked = targets
    .map((id, index) => {
      const player = turn.view.players.find((candidate) => candidate.id === id);
      const levels = Object.values(player?.improvements ?? {}).reduce((sum, level) => sum + level, 0);
      return { id, index, rank: levels * 2 + (player?.handSize ?? 0) };
    })
    .sort((a, b) => b.rank - a.rank || a.index - b.index);
  const target = ranked[0]!.id;
  return [{ item: ckCommands.harborOffer(target, give), score: OFFER_SCORE }];
}
