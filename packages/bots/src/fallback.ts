/**
 * 保底策略：只做必定合法的最小動作，讓整局不會因為策略出錯而卡住
 * （規格 I9）。非強制的動作（回應報價、建造、交易）一律不做。
 *
 * base 的義務在 `base/duty.ts`；模組以 `duty` 鉤子加上自己的義務。保底不得 throw：
 * server 的保底路徑不在 try 裡。
 */

import { getProfile, type GameView } from '@catan/rules';
import { pendingDuty, setupDuty } from './base/duty.ts';
import { firstAnswer, isModuleFrame } from './modules/compose.ts';
import { botModulesOf } from './modules/registry.ts';
import type { BotModule } from './modules/types.ts';
import type { BotCommand, BotPolicy } from './types.ts';

// 公開入口一向由此匯出這兩個函式。
export { handList, pendingDuty } from './base/duty.ts';

/**
 * `selfId` 此刻欠的最小動作；沒有則回傳 null。順序：待決效果與初始放置先 base 後模組，
 * 擲骰前與行動階段先模組後 base（模組 `duty` 回 null 時，不再送 `turn.roll`／`turn.end`）。
 *
 * 模組 frame 一律採保守的 `responders[0]`（策略原則 P3）：不是第一位 responder 就回 null，
 * 也不詢問模組的 `duty`；同時作答的 frame 由策略路徑的 `answerFrame` 負責。與
 * `botOwesAction` 的判定一致。
 */
export function fallbackDecision(view: GameView, selfId: string, modules: readonly BotModule[]): BotCommand | null {
  if (view.result) return null;
  const askDuty = (): BotCommand | null | undefined => firstAnswer(modules, (module) => module.duty?.(view, selfId));
  const pending = view.pending;
  if (pending) {
    if (isModuleFrame(pending) && pending.responders[0] !== selfId) return null;
    const duty = pendingDuty(view, selfId, modules);
    if (duty !== null) return duty;
    // 自己欠 moveRobber 而 fold 為空：集合是完整的合法集合，沒有任何模組的 duty 能做得更好，直接回 null
    // 交給 server 診斷，不再詢問模組（否則可能送出集合外的指令）。
    if (pending.kind === 'moveRobber' && pending.actor === selfId) return null;
    return askDuty() ?? null;
  }
  if (view.turn.playerId !== selfId) return null;
  const hints = view.hints;
  if (!hints) return null;
  switch (view.turn.phase) {
    case 'setup':
      return setupDuty(view) ?? askDuty() ?? null;
    case 'preroll': {
      const answer = askDuty();
      if (answer !== undefined) return answer;
      return hints.canRoll ? { type: 'turn.roll' } : null;
    }
    case 'action': {
      const answer = askDuty();
      if (answer !== undefined) return answer;
      return hints.canEndTurn ? { type: 'turn.end' } : null;
    }
    default:
      return null;
  }
}

/** 模組清單省略時依 `view.profileId` 推導；查不到 profile 時只有 base，不得 throw。 */
export function createFallbackPolicy(modules?: readonly BotModule[]): BotPolicy {
  return {
    decide(view, ctx) {
      const profile = modules === undefined ? getProfile(view.profileId) : undefined;
      return fallbackDecision(view, ctx.selfId, modules ?? (profile ? botModulesOf(profile) : []));
    },
  };
}

export const fallbackPolicy: BotPolicy = createFallbackPolicy();

/** 此刻欠的動作種類：給排程器判斷「現在是不是輪到我、該做什麼」。 */
export type OwedAction = 'frame' | 'pending' | 'setup' | 'preroll' | 'action';

/**
 * `selfId` 此刻是否欠一個動作。
 * - 模組 frame：`responders[0]` 是 self 時為 `'frame'`。
 * - 棄牌：`waitingFor` 包含 self 時為 `'pending'`；其他 base frame：`actor` 是 self 時為 `'pending'`。
 * - 沒有待決效果：行動者在 setup、preroll、action 時分別為 `'setup'`、`'preroll'`、`'action'`。
 *
 * `'action'` 也包含「自己有 open 報價正在等回應」的情況，由呼叫端以 offerPhases 豁免
 * （server 的 `waitingOnOwnOffers`、harness 的報價時鐘）。
 */
export function botOwesAction(view: GameView, selfId: string): OwedAction | null {
  if (view.result) return null;
  const pending = view.pending;
  if (pending) {
    if (isModuleFrame(pending)) return pending.responders[0] === selfId ? 'frame' : null;
    if (pending.kind === 'discard') return pending.waitingFor.includes(selfId) ? 'pending' : null;
    return pending.actor === selfId ? 'pending' : null;
  }
  if (view.turn.playerId !== selfId) return null;
  const phase = view.turn.phase;
  return phase === 'setup' || phase === 'preroll' || phase === 'action' ? phase : null;
}
