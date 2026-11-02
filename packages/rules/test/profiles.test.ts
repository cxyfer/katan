/** Ruleset registry and compatibility policy (§5.2). */

import { describe, expect, it } from 'vitest';
import {
  BASE_RULE_VERSION,
  BOX_IDS,
  EXPANSION_IDS,
  PROFILES,
  SCENARIO_IDS,
  SOURCE_IDS,
  combinationOf,
  getProfile,
  registerFixtureProfile,
  resolveCombination,
  selectableProfiles,
} from '../src/profiles.ts';
import { createGame } from '../src/engine.ts';
import { seededRng } from '../src/rng.ts';
import { playerIds, COLORS } from './helpers.ts';

describe('ruleset registry', () => {
  it('registers every row of the confirmed matrix', () => {
    const ids = PROFILES.map((profile) => profile.id);
    expect(ids).toEqual([
      'base-2025',
      'base-paired-2025',
      'sf-new-shores-2025',
      'sf-new-shores-paired-2025',
      'ck-2025',
      'ck-paired-2025',
      'sf-ck-new-shores-2025',
      'sf-ck-new-shores-paired-2025',
    ]);
  });

  it('enables only the profiles whose rules and fixtures have passed', () => {
    const enabled = PROFILES.filter((profile) => profile.enabled).map((profile) => profile.id);
    const all = ['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025', 'ck-2025', 'ck-paired-2025'];
    expect(enabled).toEqual(all);
    expect(selectableProfiles().map((profile) => profile.id)).toEqual(all);
    expect(selectableProfiles(5).map((profile) => profile.id)).toEqual(['base-paired-2025', 'sf-new-shores-paired-2025', 'ck-paired-2025']);
  });

  it('keeps the confirmed victory targets and player counts', () => {
    expect(getProfile('base-2025')!.victoryTarget).toBe(10);
    expect(getProfile('base-2025')!.playerCounts).toEqual([3, 4]);
    expect(getProfile('base-paired-2025')!.playerCounts).toEqual([5, 6]);
    expect(getProfile('sf-new-shores-2025')!.victoryTarget).toBe(14);
    expect(getProfile('ck-2025')!.victoryTarget).toBe(13);
    expect(getProfile('sf-ck-new-shores-2025')!.victoryTarget).toBe(16);
    for (const profile of PROFILES) {
      if (!profile.enabled) expect(profile.unavailableReasonKey).toBeDefined();
    }
  });

  it('resolves supported combinations and rejects the rest', () => {
    const base = { expansions: [], scenario: null, variants: [] };
    expect(resolveCombination({ ...base, playerCount: 3, setupMode: 'fixed' }))
      .toMatchObject({ ok: true, profile: { id: 'base-2025' } });
    expect(resolveCombination({ ...base, playerCount: 4, setupMode: 'variable' }))
      .toMatchObject({ ok: true, profile: { id: 'base-2025' } });
    // Five players with the base rules resolve to the registered paired profile.
    expect(resolveCombination({ ...base, playerCount: 5, setupMode: 'fixed' }))
      .toMatchObject({ ok: true, profile: { id: 'base-paired-2025' } });
    expect(resolveCombination({ ...base, playerCount: 7, setupMode: 'fixed' }))
      .toEqual({ ok: false, reason: 'bad-player-count' });
    expect(resolveCombination({
      expansions: ['seafarers'], scenario: 'new-shores', variants: [], playerCount: 4, setupMode: 'fixed',
    })).toMatchObject({ ok: true, profile: { id: 'sf-new-shores-2025' } });
    expect(resolveCombination({
      expansions: ['seafarers'], scenario: 'new-shores', variants: [], playerCount: 4, setupMode: 'variable',
    })).toEqual({ ok: false, reason: 'bad-setup-mode' });
  });

  it('matches expansion sets exactly and order-insensitively', () => {
    const request = (expansions: string[], scenario: string | null = 'new-shores') => resolveCombination({
      expansions, scenario, variants: [], playerCount: 4, setupMode: 'fixed',
    });
    // Both orders name the same (disabled) registered combination.
    expect(request(['seafarers', 'citiesKnights'])).toEqual({ ok: false, reason: 'disabled' });
    expect(request(['citiesKnights', 'seafarers'])).toEqual({ ok: false, reason: 'disabled' });
    // A scenario belongs to its expansion set; nothing is inferred.
    expect(request(['seafarers'], null)).toEqual({ ok: false, reason: 'unknown-profile' });
    expect(request(['citiesKnights'], 'new-shores')).toEqual({ ok: false, reason: 'unknown-profile' });
    // Pairwise registration never implies a larger set.
    expect(request(['seafarers', 'citiesKnights', 'tradersBarbarians'])).toEqual({ ok: false, reason: 'unknown-profile' });
    expect(request(['tradersBarbarians'], null)).toEqual({ ok: false, reason: 'unknown-profile' });
    expect(request(['explorersPirates', 'seafarers'], null)).toEqual({ ok: false, reason: 'unknown-profile' });
    // Unknown variants never match a profile without them.
    expect(resolveCombination({
      expansions: [], scenario: null, variants: ['tb-event-cards'], playerCount: 4, setupMode: 'fixed',
    })).toEqual({ ok: false, reason: 'unknown-profile' });
    // Duplicates and non-arrays are malformed rather than matched loosely.
    expect(request(['seafarers', 'seafarers'])).toEqual({ ok: false, reason: 'invalid-request' });
    expect(resolveCombination({ expansions: 'seafarers', scenario: null, variants: [], playerCount: 4, setupMode: 'fixed' } as never))
      .toEqual({ ok: false, reason: 'invalid-request' });
  });

  it('enumerates the full count x expansion x scenario matrix', () => {
    const sets: string[][] = [[], ['seafarers'], ['citiesKnights'], ['seafarers', 'citiesKnights'],
      ['tradersBarbarians'], ['explorersPirates'], ['seafarers', 'tradersBarbarians'], ['citiesKnights', 'tradersBarbarians']];
    const allowed: string[] = [];
    for (const expansions of sets) {
      for (const scenario of [null, 'new-shores']) {
        for (const playerCount of [2, 3, 4, 5, 6, 7]) {
          for (const setupMode of ['fixed', 'variable'] as const) {
            const check = resolveCombination({ expansions, scenario, variants: [], playerCount, setupMode });
            if (check.ok) allowed.push(`${check.profile.id}:${playerCount}:${setupMode}`);
          }
        }
      }
    }
    expect(allowed).toEqual([
      'base-2025:3:fixed', 'base-2025:3:variable', 'base-2025:4:fixed', 'base-2025:4:variable',
      'base-paired-2025:5:fixed', 'base-paired-2025:5:variable',
      'base-paired-2025:6:fixed', 'base-paired-2025:6:variable',
      'sf-new-shores-2025:3:fixed', 'sf-new-shores-2025:4:fixed',
      'sf-new-shores-paired-2025:5:variable', 'sf-new-shores-paired-2025:6:variable',
      'ck-2025:3:fixed', 'ck-2025:3:variable', 'ck-2025:4:fixed', 'ck-2025:4:variable',
      'ck-paired-2025:5:fixed', 'ck-paired-2025:5:variable', 'ck-paired-2025:6:fixed', 'ck-paired-2025:6:variable',
    ]);
  });

  it('round-trips every profile through its own combination', () => {
    for (const profile of PROFILES) {
      for (const playerCount of profile.playerCounts) {
        const check = resolveCombination(combinationOf(profile, playerCount, profile.setupModes[0]!));
        if (profile.enabled) expect(check).toMatchObject({ ok: true, profile: { id: profile.id } });
        else expect(check).toEqual({ ok: false, reason: 'disabled' });
      }
    }
  });

  it('describes every profile with registry v2 metadata', () => {
    for (const profile of PROFILES) {
      expect(new Set(profile.expansions).size).toBe(profile.expansions.length);
      for (const expansion of profile.expansions) expect(EXPANSION_IDS).toContain(expansion);
      if (profile.scenario) expect(SCENARIO_IDS).toContain(profile.scenario);
      expect(profile.sources.length).toBeGreaterThan(0);
      for (const source of profile.sources) expect(SOURCE_IDS).toContain(source.id);
      expect(profile.requiredBoxes).toContain('base');
      for (const box of profile.requiredBoxes) expect(BOX_IDS).toContain(box);
      if (profile.paired) expect(profile.requiredBoxes).toContain('base-5-6');
      expect(profile.ruleVersion).toMatch(/^[a-z-]+-2025\.\d+$/);
      expect(profile.ruleModules).toEqual([...profile.expansions, ...profile.variants]);
    }
    expect(getProfile('base-2025')!.ruleVersion).toBe(BASE_RULE_VERSION);
    expect(getProfile('base-paired-2025')!.ruleVersion).toBe(BASE_RULE_VERSION);
    expect(getProfile('base-2025')!.expansions).toEqual([]);
    expect(getProfile('sf-ck-new-shores-2025')!.expansions).toEqual(['seafarers', 'citiesKnights']);
  });

  it('stores the profile rule version in new snapshots', () => {
    const state = createGame({
      profileId: 'base-paired-2025',
      players: playerIds(5).map((id, index) => ({ id, nickname: id, color: COLORS[index]! })),
      setupMode: 'variable',
      rng: seededRng(3),
    });
    expect(state.engineVersion).toBe('base-2025.3');
  });

  it('keeps fixture profiles out of the lobby and the resolver', () => {
    const fixture = registerFixtureProfile('fixture-registry-only', [3, 4], { enabled: true });
    expect(getProfile('fixture-registry-only')).toBe(fixture);
    expect(PROFILES).not.toContain(fixture);
    expect(selectableProfiles().map((profile) => profile.id)).not.toContain('fixture-registry-only');
    expect(() => registerFixtureProfile('base-2025', [3])).toThrow(/shadow/);
  });

  it('implements and enables the cities & knights profiles', () => {
    for (const id of ['ck-2025', 'ck-paired-2025']) {
      const profile = getProfile(id)!;
      expect(profile.implemented).toBe(true);
      expect(profile.enabled).toBe(true);
      expect(profile.devDeck).toEqual([]);
    }
    expect(getProfile('ck-2025')!.commodityBankPerType).toBe(12);
    expect(getProfile('ck-paired-2025')!.commodityBankPerType).toBe(18);
  });

  it('refuses to create a game for an unimplemented profile', () => {
    expect(() =>
      createGame({
        profileId: 'sf-ck-new-shores-2025',
        players: playerIds(4).map((id, index) => ({
          id,
          nickname: id,
          color: COLORS[index]!,
        })),
        setupMode: 'fixed',
        rng: seededRng(1),
      }),
    ).toThrow(/not implemented/);
  });

  it('advertises the verified paired profile for six players', () => {
    expect(getProfile('base-paired-2025')!.implemented).toBe(true);
    expect(selectableProfiles(6).map((profile) => profile.id)).toEqual(['base-paired-2025', 'sf-new-shores-paired-2025', 'ck-paired-2025']);
    expect(resolveCombination({ expansions: [], scenario: null, variants: [], playerCount: 6, setupMode: 'fixed' }))
      .toMatchObject({ ok: true, profile: { id: 'base-paired-2025' } });
  });

  it('refuses a player count the profile does not support', () => {
    expect(() =>
      createGame({
        profileId: 'base-2025',
        players: playerIds(5).map((id, index) => ({
          id,
          nickname: id,
          color: COLORS[index]!,
        })),
        setupMode: 'fixed',
        rng: seededRng(1),
      }),
    ).toThrow(/does not support 5 players/);
  });

  it('refuses a setup mode the profile does not support', () => {
    expect(() =>
      createGame({
        profileId: 'base-2025',
        players: playerIds(3).map((id, index) => ({
          id,
          nickname: id,
          color: COLORS[index]!,
        })),
        setupMode: 'random' as 'fixed',
        rng: seededRng(1),
      }),
    ).toThrow();
  });
});
