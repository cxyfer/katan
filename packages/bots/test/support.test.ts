import { describe, expect, it } from 'vitest';
import { PROFILES, getProfile, type ProfileDefinition } from '@katan/rules';
import {
  BASE_RESPONSE_COMMANDS,
  BOT_MODULES,
  BOT_PACING,
  botCommandLimit,
  botModulesOf,
  botResponseCommands,
  botLevelsFor,
  botsCanPlay,
} from '../src/index.ts';
import { CK_BOTS_RELEASED, CK_PACING, CK_PENDING_COMMANDS } from '../src/modules/citiesKnights/index.ts';
import { EP_PACING, epPartsOf, epSupports, SUPPORTED_PARTS } from '../src/modules/explorersPirates/index.ts';
import { SEAFARERS_PACING } from '../src/modules/seafarers/index.ts';
import { SFCK_BOTS_RELEASED, SFCK_PACING } from '../src/modules/seafarersCitiesKnights/index.ts';
import { TB_PACING } from '../src/modules/tradersBarbarians/index.ts';

/** 以 base-2025 為底、加上指定規則模組的 fixture profile。 */
function profileWith(ruleModules: readonly string[]): ProfileDefinition {
  return { ...getProfile('base-2025')!, ruleModules };
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

  it('opens Cities & Knights seats and its combination with Seafarers', () => {
    expect(BOT_MODULES.has('citiesKnights')).toBe(true);
    expect(CK_BOTS_RELEASED).toBe(true);
    for (const id of ['ck-2025', 'ck-paired-2025']) expect(botsCanPlay(getProfile(id)!), id).toBe(true);
    // 組合層 `seafarersCitiesKnights` 已註冊（SFCK-1），`supports` 自 SFCK-G 起回 true：兩個組合 profile 開放，
    // 而且它們的每個規則模組（組合層、seafarers、citiesKnights）都有已註冊的 BotModule。
    expect(BOT_MODULES.has('seafarersCitiesKnights')).toBe(true);
    expect(SFCK_BOTS_RELEASED).toBe(true);
    for (const id of ['sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025']) {
      const profile = getProfile(id)!;
      expect(botModulesOf(profile).map((module) => module.id), id).toEqual(profile.ruleModules);
      expect(botsCanPlay(profile), id).toBe(true);
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
      'sf-ck-new-shores-2025',
      'sf-ck-new-shores-paired-2025',
      'ep-land-ho-2025',
      'ep-pirate-lairs-2025',
      'ep-fish-2025',
      'ep-spices-2025',
      'ep-full-2025',
      'tb-friendly-robber-2025',
      'tb-harbors-2025',
      'tb-friendly-robber-harbors-2025',
      'tb-fishing-2025',
      'tb-rivers-2025',
      'tb-merchant-trains-2025',
      'tb-barbarian-attack-2025',
      'tb-traders-barbarians-2025',
    ]);
  });
});

describe('bot module registry', () => {
  it('registers explorersPirates and opens only the profiles whose parts are all supported', () => {
    const module = BOT_MODULES.get('explorersPirates')!;
    expect(module.maxCommandsPerWindow).toBe(80);
    expect(module.pacing?.['ep.moveShip']).toBe(400);
    expect(SUPPORTED_PARTS).toEqual(['core', 'pirates', 'lairs', 'fish', 'spices']);
    for (const profile of PROFILES.filter((item) => item.ruleModules.includes('explorersPirates'))) {
      // E4b 起五個 E&P profile 全開。
      const open = true;
      expect(botsCanPlay(profile), profile.id).toBe(open);
      expect(botLevelsFor(profile), profile.id).toEqual(open ? ['easy', 'standard'] : []);
      // 每視窗上限取各模組最大值，pacing 併入 BOT_PACING。
      expect(botCommandLimit(profile, 40), profile.id).toBe(80);
    }
    for (const [type, ms] of Object.entries(EP_PACING)) expect(BOT_PACING[type]).toBe(ms);
    expect(botCommandLimit(getProfile('base-2025')!, 40)).toBe(40);
  });

  it('derives the E&P parts from the scenario and never throws', () => {
    const land = getProfile('ep-land-ho-2025')!;
    expect(epPartsOf(land)).toEqual([]);
    expect(epPartsOf(getProfile('ep-pirate-lairs-2025')!)).toEqual(['lairs', 'pirates']);
    expect(epPartsOf(getProfile('ep-spices-2025')!)).toEqual(['fish', 'spices', 'pirates']);
    // 未知 scenario：不 throw，也不開放；超過 4 人也不開放。
    expect(epPartsOf({ scenario: 'no-such-scenario' } as never)).toBeNull();
    expect(epSupports({ ...land, scenario: 'no-such-scenario' } as never)).toBe(false);
    expect(epSupports({ ...land, playerCounts: [3, 4, 5] })).toBe(false);
    // 部件清單決定開放範圍。
    expect(epSupports(getProfile('ep-pirate-lairs-2025')!)).toBe(true);
    expect(epSupports(getProfile('ep-fish-2025')!)).toBe(true);
    expect(epSupports(getProfile('ep-spices-2025')!)).toBe(true);
    expect(epSupports(getProfile('ep-full-2025')!)).toBe(true);
    expect(epSupports(getProfile('ep-spices-2025')!, ['core', 'pirates', 'lairs', 'fish'])).toBe(false);
    expect(epSupports(getProfile('ep-fish-2025')!, ['core', 'pirates', 'lairs'])).toBe(false);
    expect(epSupports(getProfile('ep-pirate-lairs-2025')!, ['core', 'lairs'])).toBe(false);
  });

  it('does not mistake prototype keys for registered modules', () => {
    expect(BOT_MODULES.get('constructor')).toBeUndefined();
    expect(botModulesOf({ ruleModules: ['constructor', '__proto__', 'toString'] })).toEqual([]);
    expect(botsCanPlay(profileWith(['constructor']))).toBe(false);
  });

  it('merges pacing, command limits and response commands from the registered modules', () => {
    // 已註冊 Seafarers、Cities & Knights、兩者的組合層、Traders & Barbarians 與 Explorers & Pirates：節奏是五者的合併，鍵不重複，也不蓋掉
    // base 的鍵（T&B 的鍵一律是 `tb.*`）。
    expect(BOT_PACING).toEqual({ ...SEAFARERS_PACING, ...CK_PACING, ...SFCK_PACING, ...TB_PACING, ...EP_PACING });
    expect(Object.keys(BOT_PACING)).toHaveLength(
      Object.keys(SEAFARERS_PACING).length +
        Object.keys(CK_PACING).length +
        Object.keys(SFCK_PACING).length +
        Object.keys(TB_PACING).length +
        Object.keys(EP_PACING).length,
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
