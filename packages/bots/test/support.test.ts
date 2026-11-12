import { describe, expect, it } from 'vitest';
import { PROFILES, getProfile, type ProfileDefinition } from '@catan/rules';
import {
  BASE_RESPONSE_COMMANDS,
  BOT_MODULES,
  BOT_PACING,
  botCommandLimit,
  botModulesOf,
  botResponseCommands,
  botsCanPlay,
  type BotModule,
} from '../src/index.ts';
import { CK_BOTS_RELEASED, CK_PACING, CK_PENDING_COMMANDS } from '../src/modules/citiesKnights/index.ts';
import { SEAFARERS_PACING } from '../src/modules/seafarers/index.ts';
import { SFCK_BOTS_RELEASED, SFCK_PACING } from '../src/modules/seafarersCitiesKnights/index.ts';

/** 以 base-2025 為底、加上指定規則模組的 fixture profile。 */
function profileWith(ruleModules: readonly string[]): ProfileDefinition {
  return { ...getProfile('base-2025')!, ruleModules };
}

/**
 * 骨架仍然不呼叫、只保留型別的鉤子（定案 §1.1）；哪一版實作了某個鉤子，就在同一個 PR 從這裡移除。
 * `robberTargets` 與 `rescore` 在 0.4.3 起由骨架呼叫（SFCK-P），組合層（SFCK-1）是第一個定義 `robberTargets` 的模組。
 */
const RESERVED_HOOKS = ['phase', 'endWindow', 'trade'] as const;
const RESERVED_ECONOMY_HOOKS = ['awards', 'routeEdge'] as const;

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

  it('opens Cities & Knights seats, but not its combination with Seafarers', () => {
    expect(BOT_MODULES.has('citiesKnights')).toBe(true);
    expect(CK_BOTS_RELEASED).toBe(true);
    for (const id of ['ck-2025', 'ck-paired-2025']) expect(botsCanPlay(getProfile(id)!), id).toBe(true);
    // 組合層 `seafarersCitiesKnights` 已註冊（SFCK-1），但 `supports` 在 SFCK-G 之前回 false，兩個組合 profile
    // 仍然不開放。
    expect(BOT_MODULES.has('seafarersCitiesKnights')).toBe(true);
    expect(SFCK_BOTS_RELEASED).toBe(false);
    for (const id of ['sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025']) {
      const profile = getProfile(id)!;
      expect(botModulesOf(profile).map((module) => module.id), id).toEqual(profile.ruleModules);
      expect(botsCanPlay(profile), id).toBe(false);
    }
  });

  // 快照：哪個切片開放哪些 profile，就在同一個 PR 更新這份清單。
  it('lists the playable profiles', () => {
    expect(PROFILES.filter((profile) => botsCanPlay(profile)).map((profile) => profile.id)).toEqual([
      'base-2025',
      'base-paired-2025',
      'sf-new-shores-2025',
      'sf-new-shores-paired-2025',
      'ck-2025',
      'ck-paired-2025',
    ]);
  });
});

describe('bot module registry', () => {
  it('registers no module that defines a hook the skeleton still never calls', () => {
    for (const module of BOT_MODULES.values()) expect(reservedHooksOf(module), module.id).toEqual([]);
    // 檢查器本身要抓得到保留的鉤子。
    expect(reservedHooksOf({ id: 'fx', phase: () => null, economy: { awards: () => ({}) } })).toEqual([
      'phase',
      'economy.awards',
    ]);
  });

  it('does not mistake prototype keys for registered modules', () => {
    expect(BOT_MODULES.get('constructor')).toBeUndefined();
    expect(botModulesOf({ ruleModules: ['constructor', '__proto__', 'toString'] })).toEqual([]);
    expect(botsCanPlay(profileWith(['constructor']))).toBe(false);
  });

  it('merges pacing, command limits and response commands from the registered modules', () => {
    // 已註冊 Seafarers、Cities & Knights 與兩者的組合層：節奏是三者的合併，鍵不重複，也不蓋掉 base 的鍵。
    expect(BOT_PACING).toEqual({ ...SEAFARERS_PACING, ...CK_PACING, ...SFCK_PACING });
    expect(Object.keys(BOT_PACING)).toHaveLength(
      Object.keys(SEAFARERS_PACING).length + Object.keys(CK_PACING).length + Object.keys(SFCK_PACING).length,
    );
    // 組合層的 `knight.chasePirate` 與 C&K 的 `knight.chaseRobber` 同為 900；`pending.moveRobber` 同樣不列。
    expect(SFCK_PACING).toEqual({ 'knight.chasePirate': 900 });
    expect(SFCK_PACING).not.toHaveProperty('pending.moveRobber');
    // `pending.moveRobber` 沿用 base 的 1200（knight.chaseRobber 之後的指令）。
    expect(CK_PACING).not.toHaveProperty('pending.moveRobber');
    expect(botCommandLimit(profileWith([]), 40)).toBe(40);
    expect(botCommandLimit(profileWith(['seafarers']), 40)).toBe(40);
    expect(botCommandLimit(profileWith(['citiesKnights']), 40)).toBe(40);
    expect(botResponseCommands(profileWith([]))).toEqual(BASE_RESPONSE_COMMANDS);
    expect(botResponseCommands(profileWith(['citiesKnights']))).toEqual(
      new Set([...BASE_RESPONSE_COMMANDS, ...CK_PENDING_COMMANDS]),
    );
    // 組合層沒有回應指令，也不改每視窗上限：回應指令是 SF（gold.choose）與 C&K 的聯集。
    const combined = profileWith(['seafarersCitiesKnights', 'seafarers', 'citiesKnights']);
    expect(botCommandLimit(combined, 40)).toBe(40);
    expect(botResponseCommands(combined)).toEqual(
      new Set([...BASE_RESPONSE_COMMANDS, 'gold.choose', ...CK_PENDING_COMMANDS]),
    );
    expect(CK_PENDING_COMMANDS).toHaveLength(13);
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
