/**
 * C&K 的 frame 偏好（C&K 計畫 §4.3 frame 偏好表；§4.4）。`answerFrame` 只處理 C&K 的 frame，其他一律回
 * undefined（組合模組先攔截的前提，§4.9）；不屬於自己作答的時機（依序 frame 還沒輪到自己、續行 frame）回 null，
 * 骨架再交給保底。形狀不明的 data 也回 null，不 throw。
 *
 * | frame | 選擇 |
 * |---|---|
 * | pillage | 產值加城牆價值最低的城市 |
 * | displaced | 退到離自己的建築最近的路口 |
 * | progressDiscard | 依價值表棄掉最低的 |
 * | defenderDraw | 主軌道的牌組 |
 * | scienceBonus | `view.bank[r] > 0` 的資源中依計畫缺口挑（`plentyPick`，只回 Resource）；沒有就 null |
 * | harborExchange、sabotage、wedding | 交出效用損失最小的牌 |
 * | guildDues | 拿效用增加最多的牌 |
 * | espionage | 拿價值表最高的牌（手牌滿時要比自己最低的高） |
 * | treasonRemove | 交出最弱、未啟動的騎士 |
 * | treasonPlace | 擋路價值最高的點，選允許的最高等級 |
 * | diplomacyRoad | 讓自己最長路線最長的邊，沒有幫助時放棄 |
 *
 * 決定性（P4）：不消耗亂數、不讀事件；同分取較小的路口、邊或卡種順序。
 */

import {
  CK_DEFENDER_FRAME,
  CK_DIPLOMACY_FRAME,
  CK_DISPLACED_FRAME,
  CK_ESPIONAGE_FRAME,
  CK_GUILD_DUES_FRAME,
  CK_HARBOR_FRAME,
  CK_PILLAGE_FRAME,
  CK_PROGRESS_DISCARD_FRAME,
  CK_RESOLVE_ROLL_FRAME,
  CK_SABOTAGE_FRAME,
  CK_SCIENCE_FRAME,
  CK_TREASON_PLACE_FRAME,
  CK_TREASON_REMOVE_FRAME,
  CK_WEDDING_FRAME,
  COMMODITIES,
  type CardKind,
  type CkTrack,
} from '@catan/rules';
import { plentyPick } from '../../base/cards.ts';
import { routeLength } from '../../board.ts';
import { productionValue, type Cost, type Hand } from '../../economy.ts';
import { handUtility } from '../../trade.ts';
import type { BotModule, TurnContext } from '../types.ts';
import { highestValueCard, lowestValueCards, cardValue } from './cards.ts';
import { mainTrack } from './improve.ts';
import { knightsOf } from './knights.ts';
import {
  ckCommands,
  ckHints,
  ckView,
  defenderDrawData,
  diplomacyData,
  displacedData,
  espionageData,
  giveCardsData,
  guildDuesData,
  isCkFrame,
  pillageData,
  progressDiscardData,
  treasonPlaceData,
  treasonRemoveData,
} from './view.ts';

/** 手牌中損失最小的 `count` 張：逐張拿掉效用下降最少的（同分取 `economy.kinds` 靠前者的反序：留住靠前的）。 */
export function cheapestCards(turn: TurnContext, count: number): CardKind[] {
  const { economy } = turn;
  const target: Cost = economy.plans[0]?.cost ?? {};
  const hand: Hand = { ...economy.hand };
  const out: CardKind[] = [];
  for (let i = 0; i < count; i++) {
    const before = handUtility(economy, hand, target);
    let best: CardKind | null = null;
    let bestLoss = Infinity;
    for (const kind of economy.kinds) {
      if ((hand[kind] ?? 0) <= 0) continue;
      const after = { ...hand, [kind]: (hand[kind] ?? 0) - 1 } as Hand;
      const loss = before - handUtility(economy, after, target);
      if (loss < bestLoss - 1e-9) {
        bestLoss = loss;
        best = kind;
      }
    }
    if (best === null) break;
    out.push(best);
    hand[best] = (hand[best] ?? 0) - 1;
  }
  return out;
}

/** 偷、拿別人手牌時：逐張拿效用增加最多的（`pool` 是對方的手牌）。 */
export function bestCards(turn: TurnContext, pool: Readonly<Partial<Record<CardKind, number>>>, count: number): CardKind[] {
  const { economy } = turn;
  const target: Cost = economy.plans[0]?.cost ?? {};
  const hand: Hand = { ...economy.hand };
  const left: Partial<Record<CardKind, number>> = { ...pool };
  const out: CardKind[] = [];
  for (let i = 0; i < count; i++) {
    const before = handUtility(economy, hand, target);
    let best: CardKind | null = null;
    let bestGain = -Infinity;
    for (const kind of economy.kinds) {
      if ((left[kind] ?? 0) <= 0) continue;
      const after = { ...hand, [kind]: (hand[kind] ?? 0) + 1 } as Hand;
      const gain = handUtility(economy, after, target) - before;
      if (gain > bestGain + 1e-9) {
        bestGain = gain;
        best = kind;
      }
    }
    if (best === null) break;
    out.push(best);
    left[best] = (left[best] ?? 0) - 1;
    hand[best] = (hand[best] ?? 0) + 1;
  }
  return out;
}

/** 從自己的建築出發，到各路口經過幾條邊（BFS，最遠 6）。 */
function distanceFromOwn(turn: TurnContext): number[] {
  const { model, view, ctx } = turn;
  const distance = model.topo.vertices.map(() => Infinity);
  const queue: number[] = [];
  view.board.buildings.forEach((building, vertex) => {
    if (building?.player === ctx.selfId) {
      distance[vertex] = 0;
      queue.push(vertex);
    }
  });
  for (let head = 0; head < queue.length; head++) {
    const vertex = queue[head]!;
    if (distance[vertex]! >= 6) continue;
    for (const next of model.neighbors[vertex] ?? []) {
      if (distance[next] !== Infinity) continue;
      distance[next] = distance[vertex]! + 1;
      queue.push(next);
    }
  }
  return distance;
}

function pillageChoice(turn: TurnContext, cities: readonly number[]): number | null {
  const walls = new Set((ckView(turn.view)?.walls ?? []).filter((wall) => wall.player === turn.ctx.selfId).map((wall) => wall.vertex));
  let best: number | null = null;
  let bestValue = Infinity;
  for (const vertex of cities) {
    const value = productionValue(turn.model, vertex, turn.economy.weights) * 0.07 + (walls.has(vertex) ? 0.3 : 0);
    if (value < bestValue - 1e-9) {
      bestValue = value;
      best = vertex;
    }
  }
  return best;
}

function retreatChoice(turn: TurnContext, options: readonly number[]): number | null {
  const distance = distanceFromOwn(turn);
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const vertex of options) {
    if (distance[vertex]! < bestDistance) {
      bestDistance = distance[vertex]!;
      best = vertex;
    }
  }
  return best ?? options[0] ?? null;
}

/** 對手的道路在這個路口的數量：放在對手路線的端點上最能擋路。 */
function blockingValue(turn: TurnContext, vertex: number): number {
  const { model, view, ctx } = turn;
  let value = 0;
  for (const edge of model.topo.vertices[vertex]!.edges) {
    const road = view.board.roads[edge];
    if (road && road.player !== ctx.selfId) value += 1;
  }
  return value;
}

export const citiesKnightsAnswerFrame: NonNullable<BotModule['answerFrame']> = (turn, frame) => {
  if (!isCkFrame(frame)) return undefined;
  const { view, ctx } = turn;
  const self = ctx.selfId;
  // 依序作答的 frame（以及保底）只有 `responders[0]` 才動作。
  if (frame.responders?.[0] !== self) return null;
  const hints = ckHints(view.hints);
  const me = view.players.find((player) => player.id === self);
  switch (frame.kind) {
    case CK_PILLAGE_FRAME: {
      const cities = pillageData(frame)?.cities[self] ?? hints?.pillage ?? [];
      const vertex = pillageChoice(turn, cities);
      return vertex === null ? null : ckCommands.pillage(vertex);
    }
    case CK_DISPLACED_FRAME: {
      const vertex = retreatChoice(turn, displacedData(frame)?.options ?? hints?.retreat ?? []);
      return vertex === null ? null : ckCommands.retreatKnight(vertex);
    }
    case CK_PROGRESS_DISCARD_FRAME: {
      const required = progressDiscardData(frame)?.required[self];
      const cards = me?.progressCards ?? [];
      return required !== undefined && cards.length >= required ? ckCommands.discardProgress(lowestValueCards(cards, required)) : null;
    }
    case CK_DEFENDER_FRAME: {
      const decks: readonly CkTrack[] = defenderDrawData(frame)?.decks ?? hints?.defenderDecks ?? [];
      if (decks.length === 0) return null;
      const main = mainTrack(turn.model, turn.level);
      return ckCommands.chooseDeck(decks.includes(main) ? main : decks[0]!);
    }
    case CK_SCIENCE_FRAME: {
      // 只有明確的 null 合法；只挑銀行有牌的資源（`view.bank` 到 2 為止，> 0 是精確的）。
      if (hints?.scienceBonus !== true) return null;
      return ckCommands.scienceTake(plentyPick(turn));
    }
    case CK_RESOLVE_ROLL_FRAME:
      return null;
    case CK_HARBOR_FRAME: {
      const held = COMMODITIES.filter((commodity) => (me?.commodities?.[commodity] ?? 0) > 0);
      if (held.length === 0) return null;
      // 只能交 commodity：持有的當中權重最低的一種。
      const choice = cheapestHeld(turn, held);
      return ckCommands.harborAnswer(choice);
    }
    case CK_GUILD_DUES_FRAME: {
      const data = guildDuesData(frame);
      if (!data?.hand) return null;
      const cards = bestCards(turn, data.hand, data.count);
      return cards.length === data.count ? ckCommands.takeCards(cards) : null;
    }
    case CK_ESPIONAGE_FRAME: {
      const cards = espionageData(frame)?.cards ?? [];
      const best = highestValueCard(cards);
      if (best === null) return ckCommands.takeProgress(null);
      const mine = me?.progressCards ?? [];
      // 手牌滿了（上限 4）才要看值不值得換掉自己最低的；沒滿就拿價值最高的。
      const worst = lowestValueCards(mine, 1)[0];
      if (mine.length >= 4 && (worst === undefined || cardValue(best) <= cardValue(worst))) return ckCommands.takeProgress(null);
      return ckCommands.takeProgress(best);
    }
    case CK_SABOTAGE_FRAME:
    case CK_WEDDING_FRAME: {
      const required = giveCardsData(frame)?.required[self];
      if (required === undefined) return null;
      const cards = cheapestCards(turn, required);
      if (cards.length < required) return null;
      return frame.kind === CK_SABOTAGE_FRAME ? ckCommands.sabotageDiscard(cards) : ckCommands.weddingGive(cards);
    }
    case CK_TREASON_REMOVE_FRAME: {
      const allowed = new Set(treasonRemoveData(frame)?.knights ?? []);
      const mine = knightsOf(view, self).filter((knight) => allowed.has(knight.vertex));
      mine.sort((a, b) => Number(a.active) - Number(b.active) || a.level - b.level || a.vertex - b.vertex);
      const vertex = mine[0]?.vertex ?? [...allowed][0];
      return vertex === undefined ? null : ckCommands.treasonRemove(vertex);
    }
    case CK_TREASON_PLACE_FRAME: {
      const data = treasonPlaceData(frame);
      if (!data || data.sites.length === 0 || data.levels.length === 0) return ckCommands.treasonPlace(null);
      let best: number | null = null;
      let bestValue = -Infinity;
      for (const vertex of data.sites) {
        const value = blockingValue(turn, vertex) - (view.hints?.legalSettlements?.includes(vertex) ? 2 : 0);
        if (value > bestValue) {
          bestValue = value;
          best = vertex;
        }
      }
      return best === null ? ckCommands.treasonPlace(null) : ckCommands.treasonPlace(best, Math.max(...data.levels));
    }
    case CK_DIPLOMACY_FRAME: {
      const data = diplomacyData(frame);
      if (!data || data.ship) return ckCommands.diplomacyRoad(null);
      const base = routeLength(turn.model, self);
      let best: number | null = null;
      let bestLength = base;
      for (const edge of data.edges) {
        const length = routeLength(turn.model, self, [edge]);
        if (length > bestLength) {
          bestLength = length;
          best = edge;
        }
      }
      return ckCommands.diplomacyRoad(best);
    }
    default:
      return null;
  }
};

/** 持有的 commodity 中，對自己最不重要的一種（權重最低；同權重取排在前面的）。 */
function cheapestHeld(turn: TurnContext, held: readonly CardKind[]): (typeof COMMODITIES)[number] {
  const weights = turn.economy.weights;
  let best = held[0]! as (typeof COMMODITIES)[number];
  for (const kind of held) if ((weights[kind] ?? 0) < (weights[best] ?? 0) - 1e-9) best = kind as (typeof COMMODITIES)[number];
  return best;
}
