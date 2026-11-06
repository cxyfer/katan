/**
 * Seafarers 的經濟鉤子與計畫步驟。SF-1 先接上 stub，讓 SF-2a 只改這個檔案，不必再改 `index.ts`；
 * 島嶼聚落計畫、船隻成本與存量都在 SF-2a 實作。
 */

import type { BotEconomyHooks, BotModule } from '../types.ts';

export const seafarersEconomy: BotEconomyHooks = {
  costs: () => ({}),
  piecesLeft: () => ({}),
  scoreExtras: () => [],
};

/** 模組對不屬於自己的計畫種類必須回 undefined。 */
export const seafarersPlanStep: NonNullable<BotModule['planStep']> = () => undefined;
