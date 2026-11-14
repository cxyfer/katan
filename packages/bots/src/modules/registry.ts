/**
 * Bot 模組的註冊表。模組以 `id`（與 rules module id 相同）索引；`botModulesOf` 依
 * `profile.ruleModules` 的順序回傳已註冊的模組。
 */

import type { ProfileDefinition } from '@catan/rules';
import { citiesKnightsBotModule } from './citiesKnights/index.ts';
import { seafarersBotModule } from './seafarers/index.ts';
import { seafarersCitiesKnightsBotModule } from './seafarersCitiesKnights/index.ts';
import type { BotModule } from './types.ts';

/** 已註冊的 Bot 模組；每個模組在這裡加一行。 */
const REGISTERED: readonly BotModule[] = [
  seafarersBotModule,
  citiesKnightsBotModule,
  seafarersCitiesKnightsBotModule,
];

// 用 Map：`{}['constructor']` 這類原型鍵不會被當成已註冊的模組。
export const BOT_MODULES: ReadonlyMap<string, BotModule> = new Map(
  REGISTERED.map((module): [string, BotModule] => [module.id, module]),
);

/** 這個 profile 用得到的 Bot 模組，依 `ruleModules` 的順序；沒有註冊的 id 略過。 */
export function botModulesOf(profile: Pick<ProfileDefinition, 'ruleModules'>): readonly BotModule[] {
  const out: BotModule[] = [];
  for (const id of profile.ruleModules) {
    const module = BOT_MODULES.get(id);
    if (module) out.push(module);
  }
  return out;
}
