/**
 * 測試矩陣的守門測試（策略 §4.6）：`BOT_TEST_MATRIX` 的每個 profile 都必須至少被一個測試檔涵蓋；
 * 開放新 profile 卻沒有任何測試跑它時，這裡會失敗。另外鎖住 harness 的預設值（setup 模式、種子數）。
 */

import { describe, expect, it } from 'vitest';
import { getProfile, PROFILES } from '@catan/rules';
import { botsCanPlay } from '../src/index.ts';
import {
  BOT_FAMILIES,
  dedicatedProfileIds,
  familyCoverageProblems,
  GENERIC_MATRIX_FILES,
  type BotTestFamily,
} from './families.ts';
import {
  BASE_SEED_COUNT,
  BOT_TEST_MATRIX,
  defaultSetupMode,
  EXTENSION_SEED_COUNT,
  extensionSeedCount,
  GENERIC_MATRIX,
  newBotGame,
  seedsFor,
} from './harness.ts';

declare const process: { env: Record<string, string | undefined> };

// 測試檔的原始碼文字（只讀、不載入）。
const sources = import.meta.glob('./*.test.ts', { query: '?raw', import: 'default', eager: true });
const fileText: Record<string, string> = Object.fromEntries(
  Object.entries(sources).map(([path, text]) => [path.replace(/^\.\//, ''), text]),
);
const knownProfiles = new Set(PROFILES.map((profile) => profile.id));
const matrixProfileIds = [...new Set(BOT_TEST_MATRIX.map((entry) => entry.profile.id))];

describe('BOT_TEST_MATRIX', () => {
  it('lists every enabled profile the bots can play, once per player count', () => {
    const expected = PROFILES.filter((profile) => profile.enabled && botsCanPlay(profile)).flatMap((profile) =>
      profile.playerCounts.map((players) => `${profile.id}:${players}`),
    );
    expect(BOT_TEST_MATRIX.map((entry) => `${entry.profile.id}:${entry.players}`)).toEqual(expected);
    // 0.4.1 開放的只有 base（3–6 人）。
    expect(BOT_TEST_MATRIX.map((entry) => entry.players)).toEqual(expect.arrayContaining([3, 4, 5, 6]));
  });

  it('is covered by at least one test file per profile', () => {
    expect(familyCoverageProblems(matrixProfileIds, BOT_FAMILIES, fileText, knownProfiles)).toEqual([]);
  });

  it('only runs profiles without a dedicated family test file in the generic matrix', () => {
    const dedicated = dedicatedProfileIds();
    expect(GENERIC_MATRIX.filter((entry) => dedicated.has(entry.profile.id))).toEqual([]);
    // 每個矩陣項目不是通用矩陣跑，就是專屬 family 跑；不會兩者都沒有。
    const generic = new Set(GENERIC_MATRIX.map((entry) => entry.profile.id));
    for (const id of matrixProfileIds) expect(generic.has(id) || dedicated.has(id), id).toBe(true);
  });

  it('registers the generic matrix files, and each one actually uses the generic matrix', () => {
    for (const file of GENERIC_MATRIX_FILES) {
      expect(fileText[file], `${file} exists`).toBeDefined();
      expect(fileText[file], `${file} uses GENERIC_MATRIX`).toContain('GENERIC_MATRIX');
    }
  });
});

describe('family coverage guard', () => {
  const sourcesFor = { 'sf-games.test.ts': "profiles: ['sf-new-shores-2025']", 'other.test.ts': 'nothing here' };
  const sfFamily: BotTestFamily = { id: 'sf', profiles: ['sf-new-shores-2025'], files: ['sf-games.test.ts'] };
  const known = new Set(['sf-new-shores-2025', 'sf-new-shores-paired-2025']);

  it('passes when a family file names its profile', () => {
    expect(familyCoverageProblems(['sf-new-shores-2025'], [sfFamily], sourcesFor, known)).toEqual([]);
  });

  it('catches a matrix profile that no family registers', () => {
    const problems = familyCoverageProblems(['sf-new-shores-paired-2025'], [sfFamily], sourcesFor, known);
    expect(problems).toEqual([expect.stringContaining('sf-new-shores-paired-2025: no test file covers it')]);
  });

  it('catches a registered file that does not mention the profile', () => {
    const dead: BotTestFamily = { ...sfFamily, files: ['other.test.ts'] };
    expect(familyCoverageProblems(['sf-new-shores-2025'], [dead], sourcesFor, known)).toEqual([
      expect.stringContaining('no test file covers it'),
    ]);
  });

  it('catches a missing file and an unknown profile id', () => {
    const broken: BotTestFamily = { id: 'broken', profiles: ['sf-typo'], files: ['gone.test.ts'] };
    const problems = familyCoverageProblems([], [broken], sourcesFor, known);
    expect(problems).toEqual([
      'broken: test file gone.test.ts does not exist',
      'broken: unknown profile sf-typo',
    ]);
  });

  it('lets a generic family cover through the generic matrix', () => {
    const generic: BotTestFamily = { id: 'base', profiles: ['base-2025'], files: ['g.test.ts'], generic: true };
    expect(familyCoverageProblems(['base-2025'], [generic], { 'g.test.ts': 'for (e of GENERIC_MATRIX)' }, new Set(['base-2025']))).toEqual([]);
    // 非 generic 的 family 提到 GENERIC_MATRIX 不算涵蓋。
    expect(
      familyCoverageProblems(['base-2025'], [{ ...generic, generic: undefined as never }], { 'g.test.ts': 'GENERIC_MATRIX' }, new Set(['base-2025'])),
    ).toEqual([expect.stringContaining('no test file covers it')]);
  });
});

describe('harness defaults', () => {
  it('keeps base on the variable setup (the first mode would be fixed)', () => {
    const base = getProfile('base-2025')!;
    expect(base.setupModes[0]).toBe('fixed');
    expect(defaultSetupMode(base)).toBe('variable');
    const { state } = newBotGame({ profileId: 'base-2025', players: 4, seed: 1 });
    expect(state.log.find((event) => event.type === 'game.created')?.params.setupMode).toBe('variable');
  });

  it('falls back to the first mode when the profile has no variable setup', () => {
    expect(defaultSetupMode({ setupModes: ['fixed'] })).toBe('fixed');
    expect(defaultSetupMode({ setupModes: ['fixed', 'variable'] })).toBe('variable');
  });

  it('honors an explicit setup mode', () => {
    const { state } = newBotGame({ profileId: 'base-2025', players: 3, seed: 1, setupMode: 'fixed' });
    expect(state.log.find((event) => event.type === 'game.created')?.params.setupMode).toBe('fixed');
  });
});

describe('seed counts', () => {
  const base = { ruleModules: [] as string[] };
  const extension = { ruleModules: ['seafarers'] };
  const withSeeds = (value: string | undefined, run: () => void): void => {
    const previous = process.env.BOTS_SEEDS;
    if (value === undefined) delete process.env.BOTS_SEEDS;
    else process.env.BOTS_SEEDS = value;
    try {
      run();
    } finally {
      if (previous === undefined) delete process.env.BOTS_SEEDS;
      else process.env.BOTS_SEEDS = previous;
    }
  };

  it('gives base ten seeds and an extension three by default', () => {
    withSeeds(undefined, () => {
      expect(seedsFor(base)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(BASE_SEED_COUNT).toBe(10);
      expect(seedsFor(extension)).toEqual([1, 2, 3]);
      expect(EXTENSION_SEED_COUNT).toBe(3);
    });
  });

  it('lets BOTS_SEEDS raise an extension to the release gate but never changes base', () => {
    withSeeds('10', () => {
      expect(seedsFor(extension)).toHaveLength(10);
      expect(seedsFor(base)).toHaveLength(10);
    });
    withSeeds('5', () => {
      expect(seedsFor(extension)).toHaveLength(5);
      expect(seedsFor(base)).toHaveLength(10);
    });
  });

  it('rejects a BOTS_SEEDS that is not a positive integer instead of silently running fewer games', () => {
    for (const bad of ['0', '-1', '2.5', 'ten']) {
      withSeeds(bad, () => expect(() => extensionSeedCount(), bad).toThrow(/BOTS_SEEDS/));
    }
    withSeeds('', () => expect(extensionSeedCount()).toBe(EXTENSION_SEED_COUNT));
  });
});
