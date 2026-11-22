/** bench 的座位角色與對應的策略（`bench/roles.test.ts` 鎖定 `hard0` 走凍結基線）。 */

import type { ProfileDefinition } from '@katan/rules';
import { botModulesOf, createBotPolicy } from '../src/index.ts';
import { heuristicPolicy } from '../src/heuristic.ts';
import type { BotPolicy } from '../src/types.ts';
import { naivePolicy } from '../test/harness.ts';
import { hardBaselinePolicy } from './hard-baseline/index.ts';

/** `hard0` 是凍結的舊 hard 基線（`bench/hard-baseline/`），只在 bench 用。 */
export type Role = 'hard' | 'hard0' | 'standard' | 'easy' | 'naive';

export function policyOf(role: Role, profile: ProfileDefinition): BotPolicy {
  switch (role) {
    case 'naive':
      return naivePolicy('standard', botModulesOf(profile));
    case 'hard':
      return createBotPolicy('hard');
    case 'hard0':
      return hardBaselinePolicy();
    default:
      return heuristicPolicy(role);
  }
}
