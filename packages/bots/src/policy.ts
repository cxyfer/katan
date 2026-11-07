import { hardPolicy } from './hard/index.ts';
import { heuristicPolicy } from './heuristic.ts';
import type { BotModule } from './modules/types.ts';
import type { BotLevel, BotPolicy } from './types.ts';

export interface BotPolicyOptions {
  /** 省略時依 `view.profileId` 取 `botModulesOf`；`[]` 是純 base 策略（遇到模組 frame 只能靠保底）。naive 座位另見 `test/harness.ts` 的 `naiveModule`：只保留模組的 `duty`。 */
  readonly modules?: readonly BotModule[];
}

/**
 * 依難度建立策略；`hard` 是 `hard/` 的策略，其餘是 `heuristicPolicy`。策略不吞例外：
 * 排程器會記錄錯誤並改用保底策略（規格 I9），讓策略缺陷留在日誌裡而不是被默默蓋掉。
 */
export function createBotPolicy(level: BotLevel, options: BotPolicyOptions = {}): BotPolicy {
  if (level === 'hard') return hardPolicy(options.modules);
  return heuristicPolicy(level, options.modules);
}
