/** 模組組合的純函式：不讀環境、不消耗亂數，模組清單為空時等同沒有模組。 */

import type { PublicModulePendingView, PublicPendingView } from '@catan/rules';
import type { BotCommand, BotModule, Scored, TurnContext } from './types.ts';

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

/**
 * 各模組對 `command` 的 `rescore` 差值總和。沒有 `rescore` 的模組略過；非有限值（NaN、±Infinity）視為 0，
 * 所以不能用 −∞ 表達排除，要壓低分數請回有限的負值。放在這裡（純函式、不依賴 registry）讓策略骨架與
 * 模組內部（例如 C&K 的招募點排序）共用同一段加總，不會形成 import 循環。
 */
export function rescoreDelta(modules: readonly BotModule[], turn: TurnContext, command: BotCommand): number {
  let delta = 0;
  for (const module of modules) {
    if (!module.rescore) continue;
    const diff = module.rescore(turn, command);
    if (Number.isFinite(diff)) delta += diff;
  }
  return delta;
}
