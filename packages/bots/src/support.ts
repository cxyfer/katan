/**
 * Which rulesets the built-in strategies can play (SPEC §4.9).
 *
 * A profile is playable when every rules module it runs has a registered Bot module
 * (`modules/registry.ts`) that supports the profile. A phase that teaches the bots a
 * module's commands and frames registers a `BotModule` for it. Pacing, per-window limits and
 * response commands are merged from the registered modules.
 */

import type { ProfileDefinition } from '@catan/rules';
import { BOT_MODULES, botModulesOf } from './modules/registry.ts';

export { BOT_MODULES, botModulesOf };

/** True when bots can be seated in a game of this profile. */
export function botsCanPlay(profile: ProfileDefinition): boolean {
  return profile.ruleModules.every((id) => {
    const module = BOT_MODULES.get(id);
    return module !== undefined && (module.supports?.(profile) ?? true);
  });
}

/** 各指令的思考延遲（毫秒）：依註冊順序合併各模組的 `pacing`，重複的鍵以先註冊者為準。 */
export const BOT_PACING: Readonly<Record<string, number>> = (() => {
  const out: Record<string, number> = {};
  for (const module of BOT_MODULES.values()) {
    for (const [type, ms] of Object.entries(module.pacing ?? {})) {
      if (!Object.hasOwn(out, type)) out[type] = ms;
    }
  }
  return out;
})();

/** 每個行動視窗的指令上限：`base` 與這個 profile 各模組 `maxCommandsPerWindow` 的最大值。 */
export function botCommandLimit(profile: Pick<ProfileDefinition, 'ruleModules'>, base: number): number {
  let limit = base;
  for (const module of botModulesOf(profile)) limit = Math.max(limit, module.maxCommandsPerWindow ?? 0);
  return limit;
}

/** base 的回應型指令：非行動者只會送這些（規格 §5 規則 3）。 */
export const BASE_RESPONSE_COMMANDS: ReadonlySet<string> = new Set([
  'pending.discard',
  'pending.moveRobber',
  'pending.steal',
  'pending.takeResource',
  'build.road',
  'trade.respond',
]);

/** 這個 profile 下非行動者可以送出的指令：base 加上各模組的 `responseCommands`。 */
export function botResponseCommands(profile: Pick<ProfileDefinition, 'ruleModules'>): ReadonlySet<string> {
  const out = new Set(BASE_RESPONSE_COMMANDS);
  for (const module of botModulesOf(profile)) for (const type of module.responseCommands ?? []) out.add(type);
  return out;
}
