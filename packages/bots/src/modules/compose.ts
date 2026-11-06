/** 模組組合的純函式：不讀環境、不消耗亂數，模組清單為空時等同沒有模組。 */

import type { PublicModulePendingView, PublicPendingView } from '@catan/rules';
import type { BotModule, Scored } from './types.ts';

/** 模組 frame 的 kind 都是 `<module id>.<名稱>`；base frame 沒有句點。 */
export function isModuleFrame(pending: NonNullable<PublicPendingView>): pending is PublicModulePendingView {
  return pending.kind.includes('.');
}

/**
 * 依序詢問各模組，第一個 `!== undefined` 的答案勝出（含 null）；全部都不歸自己管時回傳
 * undefined。
 */
export function firstAnswer<T>(
  modules: readonly BotModule[],
  ask: (module: BotModule) => T | null | undefined,
): T | null | undefined {
  for (const module of modules) {
    const answer = ask(module);
    if (answer !== undefined) return answer;
  }
  return undefined;
}

/** 依模組順序串接候選；模組內保留原順序。 */
export function collectScored<T>(
  modules: readonly BotModule[],
  get: (module: BotModule) => readonly Scored<T>[] | undefined,
): Scored<T>[] {
  const out: Scored<T>[] = [];
  for (const module of modules) {
    const candidates = get(module);
    if (candidates) out.push(...candidates);
  }
  return out;
}
