import { describe, expect, it } from 'vitest';
import { PROFILES, getProfile, type ProfileDefinition } from '@catan/rules';
import {
  BASE_RESPONSE_COMMANDS,
  BOT_MODULES,
  BOT_PACING,
  BOT_RULE_MODULES,
  botCommandLimit,
  botModulesOf,
  botResponseCommands,
  botsCanPlay,
  type BotModule,
} from '../src/index.ts';
import { SEAFARERS_PACING } from '../src/modules/seafarers/index.ts';

/** 以 base-2025 為底、加上指定規則模組的 fixture profile。 */
function profileWith(ruleModules: readonly string[]): ProfileDefinition {
  return { ...getProfile('base-2025')!, ruleModules };
}

/** 骨架不呼叫、只保留型別的鉤子（定案 §1.1）；哪一版實作了某個鉤子，就在同一個 PR 從這裡移除。 */
const RESERVED_HOOKS = ['phase', 'endWindow', 'robberTargets', 'rescore', 'trade'] as const;
const RESERVED_ECONOMY_HOOKS = [
  'awards',
  'cardKinds',
  'rates',
  'weights',
  'hexYield',
  'vertexBlocker',
  'siteBlocked',
  'routeEdge',
] as const;

function reservedHooksOf(module: BotModule): string[] {
  const found: string[] = RESERVED_HOOKS.filter((hook) => hook in module);
  for (const hook of RESERVED_ECONOMY_HOOKS) if (module.economy && hook in module.economy) found.push(`economy.${hook}`);
  return found;
}

describe('bot ruleset support', () => {
  it('plays the base profiles, including paired 5–6 player turns', () => {
    expect(botsCanPlay(getProfile('base-2025')!)).toBe(true);
    expect(botsCanPlay(getProfile('base-paired-2025')!)).toBe(true);
  });

  it('plays exactly the profiles whose every rules module has a registered, supporting Bot module', () => {
    for (const profile of PROFILES) {
      const playable = profile.ruleModules.every((id) => {
        const module = BOT_MODULES.get(id);
        return module !== undefined && (module.supports?.(profile) ?? true);
      });
      expect(botsCanPlay(profile), profile.id).toBe(playable);
    }
  });

  it('refuses a profile with a rules module nobody registered', () => {
    expect(botsCanPlay(profileWith(['seafarers']))).toBe(false);
    expect(botsCanPlay(profileWith(['base', 'no-such-module']))).toBe(false);
  });

  // 快照：哪個切片開放哪些 profile，就在同一個 PR 更新這份清單。
  it('lists the playable profiles', () => {
    expect(PROFILES.filter((profile) => botsCanPlay(profile)).map((profile) => profile.id)).toEqual([
      'base-2025',
      'base-paired-2025',
    ]);
  });

  it('keeps the deprecated BOT_RULE_MODULES empty', () => {
    expect(BOT_RULE_MODULES).toEqual([]);
  });
});

describe('bot module registry', () => {
  it('registers no module that defines a hook the skeleton never calls', () => {
    for (const module of BOT_MODULES.values()) expect(reservedHooksOf(module), module.id).toEqual([]);
    // 檢查器本身要抓得到保留的鉤子。
    expect(reservedHooksOf({ id: 'fx', phase: () => null, economy: { rates: () => ({}) } })).toEqual([
      'phase',
      'economy.rates',
    ]);
  });

  it('does not mistake prototype keys for registered modules', () => {
    expect(BOT_MODULES.get('constructor')).toBeUndefined();
    expect(botModulesOf({ ruleModules: ['constructor', '__proto__', 'toString'] })).toEqual([]);
    expect(botsCanPlay(profileWith(['constructor']))).toBe(false);
  });

  it('merges pacing, command limits and response commands from the registered modules', () => {
    // 0.4.1 只註冊了 Seafarers：節奏就是它的四個值，其他 profile 沒有模組。
    expect(BOT_PACING).toEqual(SEAFARERS_PACING);
    expect(botCommandLimit(profileWith([]), 40)).toBe(40);
    expect(botCommandLimit(profileWith(['seafarers']), 40)).toBe(40);
    expect(botResponseCommands(profileWith([]))).toEqual(BASE_RESPONSE_COMMANDS);
    expect([...BASE_RESPONSE_COMMANDS].sort()).toEqual([
      'build.road',
      'pending.discard',
      'pending.moveRobber',
      'pending.steal',
      'pending.takeResource',
      'trade.respond',
    ]);
  });
});
