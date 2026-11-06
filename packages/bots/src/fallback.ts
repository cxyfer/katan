/**
 * 保底策略：只做必定合法的最小動作，讓整局不會因為策略出錯而卡住
 * （規格 I9）。非強制的動作（回應報價、建造、交易）一律不做。
 */

import type { Command, GameView } from '@catan/rules';
import { pendingDuty, setupDuty } from './base/duty.ts';
import type { BotContext, BotPolicy } from './types.ts';

// 公開入口一向由此匯出這兩個函式。
export { handList, pendingDuty } from './base/duty.ts';

function decide(view: GameView, ctx: BotContext): Command | null {
  if (view.result) return null;
  if (view.pending) return pendingDuty(view, ctx.selfId);
  if (view.turn.playerId !== ctx.selfId) return null;
  const hints = view.hints;
  if (!hints) return null;
  switch (view.turn.phase) {
    case 'setup':
      return setupDuty(view);
    case 'preroll':
      return hints.canRoll ? { type: 'turn.roll' } : null;
    case 'action':
      return hints.canEndTurn ? { type: 'turn.end' } : null;
    default:
      return null;
  }
}

export const fallbackPolicy: BotPolicy = { decide };
