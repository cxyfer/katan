import { heuristicPolicy } from './heuristic.ts';
import type { BotLevel, BotPolicy } from './types.ts';

/**
 * 依難度建立策略。策略不吞例外：排程器會記錄錯誤並改用保底策略（規格 I9），
 * 讓策略缺陷留在日誌裡而不是被默默蓋掉。
 */
export function createBotPolicy(level: BotLevel): BotPolicy {
  return heuristicPolicy(level);
}
