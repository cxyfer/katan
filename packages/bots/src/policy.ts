import { fallbackPolicy } from './fallback.ts';
import type { BotLevel, BotPolicy } from './types.ts';

/** 依難度建立策略。standard／easy 實作完成前先回傳保底策略。 */
export function createBotPolicy(level: BotLevel): BotPolicy {
  void level;
  return fallbackPolicy;
}
