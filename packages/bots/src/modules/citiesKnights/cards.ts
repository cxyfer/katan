/**
 * C&K 的進步卡（C&K 計畫 §4.3 F1 卡、`progressExcess`；§4.4 easy）。
 *
 * - F1：不需要互動的 12 種卡（irrigation、mining、merchant、merchantFleet、resourceMonopoly、tradeMonopoly、
 *   medicine、crane、engineering、smithing、encouragement、roadBuilding）。互動卡（F2）與 Alchemy 由 `cards-interactive.ts`、
 *   `preroll.ts` 處理（CK-C）；價值表給它們中低段的估值。
 * - 每張卡只有「現在就該打」才回傳候選，分數是勝利分當量，與 base 的立即建造同一份清單 pick：免費的資源卡與
 *   +1 VP 的 merchant 先於建造，讓拿到的牌能馬上用。
 * - `progressExcess > 0`（`turn.end` 被否決）：先打可打的卡，不夠再依價值表棄掉最低的。
 * - Smithing 一次升兩隻騎士時，依 `hints.knightSupply` 逐一模擬棋子存量（C4）：第一隻可能用掉最後一個高一級的
 *   騎士棋子，第二隻就非法；先升高等級的騎士會釋出低一級的棋子。`smithingPlan` 是純函式，單元測試直接鎖它。
 * - easy 只打 F1，而且延後到手牌有 3 張以上（或超過上限）時才打（D-CK3）。
 *
 * 合法性取自 `hints.progress[]`（`playable` 與 `targets`）；一律以 `targets` 為準，不假設目標的種類
 * （SF+CK 的 merchant 不放金礦，§4.9）。
 *
 * 決定性（P4）：不消耗亂數、不讀事件。
 */

import { COSTS, RESOURCES, type CardKind, type CkTrack, type Resource } from '@catan/rules';
import { playerYield } from '../../board.ts';
import { canAfford, handSize, productionValue, PIP_VALUE } from '../../economy.ts';
import { collectScored } from '../compose.ts';
import type { BotCommand, Scored, TurnContext } from '../types.ts';
import { DEFENSE_SCORE, defenseWindow } from './defense.ts';
import { trackOptions } from './improve.ts';
import { metropolisSite } from './plans.ts';
import { threatOf } from './knights.ts';
import { ckCommands, ckHints } from './view.ts';

/** 不需要互動的 12 種卡。 */
export const F1_CARDS: readonly string[] = [
  'irrigation',
  'mining',
  'merchant',
  'merchantFleet',
  'resourceMonopoly',
  'tradeMonopoly',
  'medicine',
  'crane',
  'engineering',
  'smithing',
  'encouragement',
  'roadBuilding',
];

/**
 * 保留價值（越高越不該棄）。F1 依效果高低；F2 與 Alchemy 在 F1 的中低段（CK-C）。
 * 沒列的卡（含 VP 卡，它們不在手牌）視為 0。
 */
export const CARD_VALUE: Readonly<Record<string, number>> = {
  merchant: 5,
  medicine: 4.5,
  crane: 4,
  smithing: 3.6,
  encouragement: 3.2,
  irrigation: 3,
  mining: 3,
  resourceMonopoly: 2.8,
  roadBuilding: 2.6,
  engineering: 2.4,
  tradeMonopoly: 2.2,
  merchantFleet: 1.8,
  // F2 與 Alchemy（CK-C）：standard 會打，估值落在 F1 的中低段：不再比 F1 先被棄掉，但也不比立即有益的卡高。
  // easy 不打這些卡（D-CK3），它們只佔手牌，所以不能比 F1 的高價卡更值得留。
  treason: 3,
  wedding: 2.9,
  guildDues: 2.8,
  intrigue: 2.5,
  commercialHarbor: 2.5,
  invention: 2.4,
  sabotage: 2.3,
  alchemy: 2.2,
  espionage: 2.1,
  taxation: 2,
  diplomacy: 2,
};

export function cardValue(card: string): number {
  return CARD_VALUE[card] ?? 0;
}

/** 手牌中價值最低的 `count` 張（同價值依牌名、再依位置，穩定且與牌序無關的內容決定）。 */
export function lowestValueCards(cards: readonly string[], count: number): string[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => cardValue(a.card) - cardValue(b.card) || (a.card < b.card ? -1 : a.card > b.card ? 1 : 0) || a.index - b.index)
    .slice(0, count)
    .map((entry) => entry.card);
}

/** 價值最高的一張；沒有牌時 null。 */
export function highestValueCard(cards: readonly string[]): string | null {
  const sorted = cards.slice().sort((a, b) => cardValue(b) - cardValue(a) || (a < b ? -1 : a > b ? 1 : 0));
  return sorted[0] ?? null;
}

// ---------------------------------------------------------------------------
// Smithing 的棋子存量（C4）
// ---------------------------------------------------------------------------

export interface SmithingKnight {
  readonly vertex: number;
  readonly level: number;
  readonly active: boolean;
}

/**
 * Smithing 的升級順序：最多兩隻不同的騎士，依序模擬棋子存量。`knights` 必須都是 hints 認可可以升級的
 * （`canPromote`）；`supply` 是 `hints.knightSupply`（每級還在存量裡的棋子數），`politics` 是 politics 改良等級
 * （升到 3 級要 3 級改良）。升 L → L+1 用掉一個 L+1 的棋子、釋出一個 L 的棋子。
 *
 * 在所有順序中取總價值最大的（已啟動的騎士升級才會立刻增加貢獻，價值 1，未啟動的 0.6），同分取靠前的候選；
 * 沒有任何合法序列時回空陣列。
 */
export function smithingPlan(
  knights: readonly SmithingKnight[],
  supply: Readonly<Record<number, number>>,
  politics: number,
): number[] {
  const attempt = (order: readonly SmithingKnight[]): { vertices: number[]; value: number } => {
    const left: Record<number, number> = { 1: supply[1] ?? 0, 2: supply[2] ?? 0, 3: supply[3] ?? 0 };
    const vertices: number[] = [];
    let value = 0;
    for (const knight of order) {
      const next = knight.level + 1;
      if (knight.level >= 3 || (left[next] ?? 0) <= 0 || (next === 3 && politics < 3)) return { vertices, value };
      left[next] = (left[next] ?? 0) - 1;
      left[knight.level] = (left[knight.level] ?? 0) + 1;
      vertices.push(knight.vertex);
      value += knight.active ? 1 : 0.6;
    }
    return { vertices, value };
  };
  let best: { vertices: number[]; value: number } = { vertices: [], value: 0 };
  for (const first of knights) {
    const single = attempt([first]);
    if (single.value > best.value) best = single;
    for (const second of knights) {
      if (second.vertex === first.vertex) continue;
      const pair = attempt([first, second]);
      // 兩隻都成功才算數：只成功一隻的順序由單隻的情況涵蓋。
      if (pair.vertices.length === 2 && pair.value > best.value) best = pair;
    }
  }
  return best.vertices;
}

// ---------------------------------------------------------------------------
// 候選
// ---------------------------------------------------------------------------

function numbersOf(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number') : [];
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** 打牌的分數：免費而且一定有益的先做。 */
const FREE_CARD_SCORE = 4;
const MERCHANT_SCORE = 4.5;

/** merchant 放在能帶來最多好處的格子：點數高，而且產的是計畫缺的資源。 */
function merchantHex(turn: TurnContext, hexes: readonly number[]): number | null {
  const missing = turn.economy.plans[0] ? turn.economy.plans[0].cost : {};
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const hex of hexes) {
    const resource = turn.model.hexResource[hex];
    const score = turn.model.hexPips[hex]! + (resource && (missing[resource] ?? 0) > (turn.economy.hand[resource] ?? 0) ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = hex;
    }
  }
  return best;
}

/** 其他玩家手上某卡種的期望張數（依公開產能與手牌張數估計；與 base 的壟斷評估同一個公式）。 */
function expectedHeld(turn: TurnContext, kind: CardKind): number {
  const { view, model, ctx } = turn;
  let expected = 0;
  for (const player of view.players) {
    if (player.id === ctx.selfId || player.handSize === 0) continue;
    const production = playerYield(model, player.id, true);
    const total = RESOURCES.reduce((sum, resource) => sum + production[resource], 0) + (production.paper ?? 0) + (production.cloth ?? 0) + (production.coin ?? 0);
    expected += (player.handSize * ((production[kind as Resource] ?? 0) + 0.5)) / (total + 2.5);
  }
  return expected;
}

/** merchantFleet 的種類：手上最多的（至少 4 張，才值得 2:1 換兩次以上）；沒有時 null。 */
export function fleetKind(turn: TurnContext, kinds: readonly CardKind[]): CardKind | null {
  const { economy } = turn;
  const target = economy.plans[0]?.cost ?? {};
  let best: CardKind | null = null;
  let bestSurplus = 3;
  for (const kind of kinds) {
    const surplus = (economy.hand[kind] ?? 0) - (target[kind] ?? 0);
    if (surplus > bestSurplus) {
      bestSurplus = surplus;
      best = kind;
    }
  }
  return best;
}

/** 一張卡的候選（沒有值得打的時機時回 null）。 */
function cardCandidate(turn: TurnContext, hint: NonNullable<ReturnType<typeof ckHints>>['progress'][number]): Scored<BotCommand> | null {
  const { view, economy, model, ctx } = turn;
  const targets = hint.targets as Record<string, unknown>;
  const play = (fields: Record<string, unknown>, score: number): Scored<BotCommand> => ({ item: ckCommands.playProgress(hint.card, fields), score });
  const threat = threatOf(view, ctx.selfId);
  switch (hint.card) {
    case 'irrigation':
    case 'mining': {
      const hexes = numbersOf(targets.hexes);
      const resource: Resource = hint.card === 'irrigation' ? 'grain' : 'ore';
      if (hexes.length === 0 || view.bank[resource] <= 0) return null;
      return play({}, FREE_CARD_SCORE + 0.1 * Math.min(hexes.length, 3) * (economy.weights[resource] ?? 1));
    }
    case 'merchant': {
      const hex = merchantHex(turn, numbersOf(targets.hexes));
      return hex === null ? null : play({ hex }, MERCHANT_SCORE);
    }
    case 'merchantFleet': {
      const kind = fleetKind(turn, (targets.kinds as CardKind[] | undefined) ?? []);
      return kind === null ? null : play({ kind }, 1.4);
    }
    case 'resourceMonopoly': {
      const kinds = (stringsOf(targets.kinds) as CardKind[]).filter((kind) => RESOURCES.includes(kind as Resource));
      let best: CardKind | null = null;
      let bestValue = 0;
      const missing = economy.plans[0]?.cost ?? {};
      for (const kind of kinds) {
        const useful = (missing[kind] ?? 0) > (economy.hand[kind] ?? 0) || (economy.rates[kind] ?? 4) <= 2 ? 1 : 0.7;
        const value = Math.min(2 * (view.players.length - 1), expectedHeld(turn, kind) * 1.5) * useful;
        if (value > bestValue) {
          bestValue = value;
          best = kind;
        }
      }
      return best !== null && bestValue >= turn.params.monopolyMin ? play({ kind: best }, 2.5 + 0.1 * bestValue) : null;
    }
    case 'tradeMonopoly': {
      const options = trackOptions(model, turn.level);
      const main = options.find((option) => option.main);
      const kinds = stringsOf(targets.kinds) as CardKind[];
      const commodity = main?.commodity;
      if (!commodity || !kinds.includes(commodity)) return null;
      const value = expectedHeld(turn, commodity);
      return value >= 1.5 ? play({ kind: commodity }, 2 + 0.1 * value) : null;
    }
    case 'medicine': {
      const vertices = numbersOf(targets.vertices);
      if (vertices.length === 0 || economy.left.cities <= 0) return null;
      const vertex = metropolisSite(turn, vertices);
      if (vertex === null) return null;
      // 代替 `build.city`：比一般的城市便宜 2 張牌，所以比同一個點的 base 候選略高。
      return play({ vertex }, 1 + PIP_VALUE * productionValue(model, vertex, economy.weights) + 0.2);
    }
    case 'crane': {
      const tracks = (Array.isArray(targets.tracks) ? targets.tracks : []) as { track: CkTrack; cost: number; metropolis: boolean; sites: number[] }[];
      const options = trackOptions(model, turn.level);
      let best: { track: CkTrack; vertex?: number; value: number } | null = null;
      for (const entry of tracks) {
        const option = options.find((candidate) => candidate.track === entry.track);
        if (!option) continue;
        if (turn.level === 'easy' && !option.main) continue;
        const held = economy.hand[option.commodity] ?? 0;
        // 只在它真的讓改良買得起（少一張 commodity）時才打；本來就買得起的改良不用浪費卡。
        if (held >= option.cost) continue;
        const vertex = entry.metropolis ? metropolisSite(turn, entry.sites) : null;
        if (entry.metropolis && vertex === null) continue;
        if (!best || option.value > best.value) best = { track: entry.track, ...(vertex !== null ? { vertex } : {}), value: option.value };
      }
      if (!best) return null;
      return play(best.vertex === undefined ? { track: best.track } : { track: best.track, vertex: best.vertex }, 1 + best.value);
    }
    case 'engineering': {
      const vertices = numbersOf(targets.vertices);
      const pressure = handSize(economy.hand) >= economy.handLimit - 2;
      const vertex = metropolisSite(turn, vertices);
      return vertex !== null && (pressure || (view.players.find((p) => p.id === ctx.selfId)?.progressCards?.length ?? 0) >= 3)
        ? play({ vertex }, 1.5)
        : null;
    }
    case 'smithing': {
      const hints = ckHints(view.hints);
      const politics = view.players.find((p) => p.id === ctx.selfId)?.improvements?.politics ?? 0;
      const allowed = new Set(numbersOf(targets.vertices));
      const knights = (hints?.knights ?? []).filter((knight) => allowed.has(knight.vertex));
      const vertices = smithingPlan(knights, hints?.knightSupply ?? { 1: 0, 2: 0, 3: 0 }, politics);
      if (vertices.length === 0) return null;
      const hand = view.players.find((p) => p.id === ctx.selfId)?.progressCards?.length ?? 0;
      // 攻擊逼近、有風險，或手牌滿了才打；否則留著。
      return threat.atRisk && defenseWindow(turn) || hand >= 4 ? play({ vertices }, 2.5) : null;
    }
    case 'encouragement': {
      const inactive = numbersOf(targets.vertices).length;
      if (inactive === 0) return null;
      const hand = view.players.find((p) => p.id === ctx.selfId)?.progressCards?.length ?? 0;
      if ((threat.atRisk && defenseWindow(turn)) || hand >= 4) return play({}, DEFENSE_SCORE + 0.1);
      return null;
    }
    case 'roadBuilding': {
      // 能不能放：base 的道路，或組合模組（SF+CK 的船、§4.9）提供的免費路線候選；只有船可放時也要打得出去。
      const canPlace =
        (economy.left.roads > 0 && (view.hints?.legalRoads?.length ?? 0) > 0) ||
        collectScored(turn.modules, (module) => module.freeRouteCandidates?.(turn)).length > 0;
      if (!canPlace) return null;
      const needsRoads = economy.plans.slice(0, 3).some((plan) => plan.roads.length >= 1 || (plan.ships?.length ?? 0) >= 1);
      return needsRoads && !canAfford(economy.hand, COSTS.road) ? play({}, 2.2) : needsRoads ? play({}, 1.8) : null;
    }
    default:
      return null;
  }
}

/** 手上的進步卡（只有自己的投影看得到）。 */
function handOf(turn: TurnContext): readonly string[] {
  return turn.view.players.find((player) => player.id === turn.ctx.selfId)?.progressCards ?? [];
}

/**
 * 進步卡的候選。`progressExcess > 0` 時，能打的卡分數加高（先打再棄），另外給一個棄最低價值的候選。
 */
export function cardActions(turn: TurnContext): Scored<BotCommand>[] {
  const hints = ckHints(turn.view.hints);
  if (!hints) return [];
  const cards = handOf(turn);
  const excess = hints.progressExcess ?? 0;
  const easy = turn.level === 'easy';
  // easy 延後到手牌有 3 張以上（或超過上限）才打。
  if (easy && cards.length < 3 && excess <= 0) return [];
  const out: Scored<BotCommand>[] = [];
  for (const hint of hints.progress ?? []) {
    if (!hint.playable || !F1_CARDS.includes(hint.card)) continue;
    const candidate = cardCandidate(turn, hint);
    if (candidate) out.push(excess > 0 ? { item: candidate.item, score: candidate.score + 10 } : candidate);
  }
  // 先打牌、再棄牌（§4.3）：有可打的卡就不放棄牌候選，否則 easy 的 topK 會抽到棄牌、白白丟掉能打的卡。
  if (out.length === 0 && excess > 0 && cards.length >= excess) {
    out.push({ item: ckCommands.discardProgress(lowestValueCards(cards, excess)), score: 9 });
  }
  return out;
}

