/** Ruleset registry and compatibility policy (§5.2). */

import { describe, expect, it } from 'vitest';
import {
  PROFILES,
  getProfile,
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
    expect(enabled).toEqual(['base-2025']);
    expect(selectableProfiles().map((profile) => profile.id)).toEqual(['base-2025']);
    expect(selectableProfiles(5).map((profile) => profile.id)).toEqual([]);
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
    expect(
      resolveCombination({
        playerCount: 3,
        seafarers: false,
        citiesKnights: false,
        scenario: null,
        setupMode: 'fixed',
      }),
    ).toMatchObject({ ok: true, profile: { id: 'base-2025' } });
    expect(
      resolveCombination({
        playerCount: 4,
        seafarers: false,
        citiesKnights: false,
        scenario: null,
        setupMode: 'variable',
      }),
    ).toMatchObject({ ok: true });

    // Five players with base modules resolves to the registered paired
    // profile, which stays disabled until its rules and fixtures pass.
    expect(
      resolveCombination({
        playerCount: 5,
        seafarers: false,
        citiesKnights: false,
        scenario: null,
        setupMode: 'fixed',
      }),
    ).toEqual({ ok: false, reason: 'disabled' });

    expect(
      resolveCombination({
        playerCount: 7,
        seafarers: false,
        citiesKnights: false,
        scenario: null,
        setupMode: 'fixed',
      }),
    ).toEqual({ ok: false, reason: 'unknown-profile' });

    expect(
      resolveCombination({
        playerCount: 4,
        seafarers: true,
        citiesKnights: false,
        scenario: 'new-shores',
        setupMode: 'fixed',
      }),
    ).toEqual({ ok: false, reason: 'disabled' });

    expect(
      resolveCombination({
        playerCount: 4,
        seafarers: false,
        citiesKnights: false,
        scenario: null,
        setupMode: 'fixed',
      }),
    ).toMatchObject({ ok: true });
  });

  it('refuses to create a game for an unimplemented profile', () => {
    expect(() =>
      createGame({
        profileId: 'sf-new-shores-2025',
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

  it('refuses to create a game for a profile that is implemented but not advertised', () => {
    // `base-paired-2025` can be executed by the engine, yet the lobby must not
    // offer it until its 5-6 setup/supply evidence is complete.
    expect(getProfile('base-paired-2025')!.implemented).toBe(true);
    expect(selectableProfiles(6).map((profile) => profile.id)).toEqual([]);
    expect(
      resolveCombination({
        playerCount: 6,
        seafarers: false,
        citiesKnights: false,
        scenario: null,
        setupMode: 'fixed',
      }),
    ).toEqual({ ok: false, reason: 'disabled' });
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
