/**
 * E&P 的國內交易估值（計畫 §4.7；整體策略規則 9）。報價可以含金幣（`gold`），金幣是公開資訊。
 * 骨架在 `offerValue` 以 `goodsGain` 檢查雙方付得起；這裡只回答金幣怎麼估值。Bot 不主動提出含金幣的報價。
 */

import type { BotTradeHooks } from '../types.ts';
import { epPlayer, epView } from './view.ts';

/** 收進一枚金幣：2 金換 1 張資源、3 張換 1 金，取 [1/3, 1/2] 之間（推測，由 bench 調整）。 */
export const GOLD_RECEIVE_VALUE = 0.4;
/** 付出一枚金幣不得低於市價（2 金 = 1 張資源），否則對手能低價買走金幣再向銀行換牌。 */
export const GOLD_PAY_VALUE = 0.5;
/** 付出後至少要留下的金幣（過路費）。 */
export const GOLD_KEEP = 1;

export const explorersPiratesTrade: BotTradeHooks = {
  goods: (view, playerId) => ({ gold: epPlayer(epView(view), playerId)?.gold ?? 0 }),
  goodValue(turn, good, amount, side) {
    if (good !== 'gold') return undefined;
    if (side === 'receive') return amount * GOLD_RECEIVE_VALUE;
    // 付出後金幣會少於 1 枚就拒絕。
    const held = epPlayer(epView(turn.view), turn.ctx.selfId)?.gold ?? 0;
    return held - amount < GOLD_KEEP ? null : amount * GOLD_PAY_VALUE;
  },
};
