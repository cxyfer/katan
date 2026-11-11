/**
 * C&K 的保底義務（規格 I9；C&K 計畫 §4.2）：只取 view、hints 或 frame data 的第一個合法選項，不得 throw
 * （server 的保底呼叫不在 try 裡，例外會讓這一局不斷重試）。
 *
 * 資格判定一律採保守的 `responders[0] === self`（P3）：保底骨架在這之前就會擋掉其他人，這裡再檢查一次，
 * 讓直接呼叫 `duty` 的測試與組合模組也得到同樣的結果。自己的 frame 但此刻不該動作時回 null（歸我管、
 * 不送指令）；不是 C&K 的 frame 回 undefined，交給下一個模組。
 *
 * - 14 種 frame：見 `frameDuty`。
 * - 自己的 action、沒有 pending、`progressExcess > 0`：棄超出上限的進步卡。這時 `canEndTurn` 為 false，
 *   這是唯一能解除否決的動作（C3），之後才輪到 `turn.end`。
 * - base 的棄牌（含 commodity）由 `base/duty.ts` 的 `handList` 處理，不在這裡。
 * - `resolveRoll` 是續行 frame（responders 為空）：不動作。
 */

import {
  CARD_KINDS,
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
  type GameView,
  type PublicModulePendingView,
} from '@catan/rules';
import { handList } from '../../base/duty.ts';
import type { BotCommand } from '../../types.ts';
import type { BotModule } from '../types.ts';
import {
  ckCommands,
  ckHints,
  defenderDrawData,
  displacedData,
  giveCardsData,
  guildDuesData,
  isCkFrame,
  pillageData,
  progressDiscardData,
  treasonRemoveData,
} from './view.ts';

type Duty = BotCommand | null | undefined;

export const citiesKnightsDuty: NonNullable<BotModule['duty']> = (view, selfId) => {
  try {
    return dutyOf(view, selfId);
  } catch {
    // 形狀不明的投影：歸我管、不送指令，讓 server 診斷，也不讓保底路徑丟出例外。
    return isCkFrame(view?.pending) ? null : undefined;
  }
};

function dutyOf(view: GameView, selfId: string): Duty {
  if (view.result) return undefined;
  const pending = view.pending;
  if (pending) return isCkFrame(pending) ? frameDuty(view, pending, selfId) : undefined;
  if (view.turn?.phase === 'action' && view.turn.playerId === selfId) return excessDuty(view, selfId);
  return undefined;
}

/** 自己手上的進步卡（只有自己的投影看得到）。 */
function progressHand(view: GameView, selfId: string): readonly string[] {
  return view.players.find((player) => player.id === selfId)?.progressCards ?? [];
}

/** 進步卡超過手牌上限：棄最前面的 `progressExcess` 張。 */
function excessDuty(view: GameView, selfId: string): Duty {
  const excess = ckHints(view.hints)?.progressExcess;
  if (typeof excess !== 'number' || excess <= 0) return undefined;
  const cards = progressHand(view, selfId);
  return cards.length >= excess ? ckCommands.discardProgress(cards.slice(0, excess)) : null;
}

/** 把一份「卡種 → 張數」依 `CARD_KINDS` 順序展開。 */
function expand(hand: Readonly<Partial<Record<CardKind, number>>>): CardKind[] {
  const out: CardKind[] = [];
  for (const kind of CARD_KINDS) {
    for (let i = 0; i < (hand[kind] ?? 0); i++) out.push(kind);
  }
  return out;
}

function frameDuty(view: GameView, frame: PublicModulePendingView, selfId: string): Duty {
  if (frame.responders?.[0] !== selfId) return null;
  const hints = ckHints(view.hints);
  switch (frame.kind) {
    case CK_PILLAGE_FRAME: {
      const city = pillageData(frame)?.cities[selfId]?.[0] ?? hints?.pillage?.[0];
      return city === undefined ? null : ckCommands.pillage(city);
    }
    case CK_DISPLACED_FRAME: {
      // 沒有 null 選項：沒有退路時 rules 不會出 frame。
      const vertex = displacedData(frame)?.options[0] ?? hints?.retreat?.[0];
      return vertex === undefined ? null : ckCommands.retreatKnight(vertex);
    }
    case CK_PROGRESS_DISCARD_FRAME: {
      const required = progressDiscardData(frame)?.required[selfId];
      const cards = progressHand(view, selfId);
      return required !== undefined && cards.length >= required ? ckCommands.discardProgress(cards.slice(0, required)) : null;
    }
    case CK_DEFENDER_FRAME: {
      const track = defenderDrawData(frame)?.decks[0] ?? hints?.defenderDecks?.[0];
      return track === undefined ? null : ckCommands.chooseDeck(track);
    }
    case CK_SCIENCE_FRAME:
      // 只有明確的 null 合法；缺少 resource 會被拒絕。
      return ckCommands.scienceTake(null);
    case CK_RESOLVE_ROLL_FRAME:
      return null;
    case CK_HARBOR_FRAME: {
      const held = view.players.find((player) => player.id === selfId)?.commodities;
      const commodity = COMMODITIES.find((candidate) => (held?.[candidate] ?? 0) > 0);
      return commodity === undefined ? null : ckCommands.harborAnswer(commodity);
    }
    case CK_GUILD_DUES_FRAME: {
      const data = guildDuesData(frame);
      if (!data?.hand) return null;
      const cards = expand(data.hand);
      return cards.length >= data.count ? ckCommands.takeCards(cards.slice(0, data.count)) : null;
    }
    case CK_ESPIONAGE_FRAME:
      return ckCommands.takeProgress(null);
    case CK_SABOTAGE_FRAME:
    case CK_WEDDING_FRAME: {
      const required = giveCardsData(frame)?.required[selfId];
      const cards = handList(view, selfId);
      if (required === undefined || cards.length < required) return null;
      const give = cards.slice(0, required);
      return frame.kind === CK_SABOTAGE_FRAME ? ckCommands.sabotageDiscard(give) : ckCommands.weddingGive(give);
    }
    case CK_TREASON_REMOVE_FRAME: {
      const vertex = treasonRemoveData(frame)?.knights[0];
      return vertex === undefined ? null : ckCommands.treasonRemove(vertex);
    }
    case CK_TREASON_PLACE_FRAME:
      // null 分支不檢查等級。
      return ckCommands.treasonPlace(null);
    case CK_DIPLOMACY_FRAME:
      // null 一定合法；SF+CK 要重建船時也一樣。
      return ckCommands.diplomacyRoad(null);
    default:
      return null;
  }
}
