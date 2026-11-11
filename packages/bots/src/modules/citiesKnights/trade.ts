/**
 * C&K 的交易偏好（C&K 計畫 §4.3 交易）：銀行交易可以用 commodity（匯率讀 `hints.commodityRates`，已含 3:1 港口、
 * 貿易 3 級與 Merchant Fleet 的 2:1），換入 commodity 要銀行有存量（`bankHas`，只到 `BANK_VIEW_CAP` 的可得性）。
 * 國內報價沿用 base，只含資源。
 *
 * 骨架的 `bankTradeToward` 與 `handRelief` 已經認得 commodity，主計畫（含改良）缺牌時會自己補；這裡只處理骨架
 * 看不到的一種：改良還差一點時，用不屬於主軌道、也不是計畫所需的多餘 commodity 去換主軌道的 commodity。
 *
 * 決定性（P4）：不消耗亂數；依 `CARD_KINDS` 順序，同分取靠前者。
 */

import { COMMODITIES, type CardKind } from '@catan/rules';
import { bankHas } from '../../bank.ts';
import type { BotCommand, Scored, TurnContext } from '../types.ts';
import { mainTrack, trackOptions } from './improve.ts';

/** 換匯的分數：低於建造與打牌，只在沒有更急的事時做。 */
const TRADE_SCORE = 1.05;

export function commodityTradeActions(turn: TurnContext): Scored<BotCommand>[] {
  const { view, economy, model } = turn;
  const option = trackOptions(model, turn.level).find((candidate) => candidate.track === mainTrack(model, turn.level));
  if (!option) return [];
  const need = option.cost - (economy.hand[option.commodity] ?? 0);
  if (need <= 0 || !bankHas(view, option.commodity)) return [];
  const reserved = economy.plans[0]?.cost ?? {};
  for (const give of COMMODITIES as readonly CardKind[]) {
    if (give === option.commodity) continue;
    const rate = economy.rates[give];
    if (rate === undefined) continue;
    const spare = (economy.hand[give] ?? 0) - (reserved[give] ?? 0);
    if (spare >= rate) return [{ item: { type: 'trade.bank', give, receive: option.commodity }, score: TRADE_SCORE }];
  }
  return [];
}
