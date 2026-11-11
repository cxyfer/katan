/**
 * 騎士戰術（C&K 計畫 §4.1、§5 CK-C）：移動騎士封鎖對手的建地或道路。價值中等〔推測〕，CK-B2 只建 stub。
 * 攻擊前不讓防守需要的騎士移動（`defense.ts` 的 `guardedKnights`）。
 */

import type { BotCommand, Scored, TurnContext } from '../types.ts';

export function tacticsActions(_turn: TurnContext): Scored<BotCommand>[] {
  return [];
}
