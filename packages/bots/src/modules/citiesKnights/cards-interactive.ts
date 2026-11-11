/**
 * 互動型進步卡（F2，共 10 種）：invention、commercialHarbor、guildDues、espionage、intrigue、sabotage、wedding、
 * taxation、treason、diplomacy（C&K 計畫 §4.1、§5 CK-C）。CK-B2 只建 stub，CK-C 實作；在那之前 Bot 不打這些卡，
 * 價值表（`cards.ts` 的 `CARD_VALUE`）把它們評為低價，手牌超過上限時先棄掉；它們的 frame 照常回應（`frames.ts`）。
 */

import type { BotCommand, Scored, TurnContext } from '../types.ts';

export function interactiveCardActions(_turn: TurnContext): Scored<BotCommand>[] {
  return [];
}
