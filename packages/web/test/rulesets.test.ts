import { describe, expect, it } from 'vitest';
import { PROFILES } from '@catan/rules';
import { profileView } from '@catan/protocol';
import { expansionLabelIds, resolveRuleset, scenarioLabelIds } from '../src/state/rulesets.ts';

const registry = PROFILES.map((profile) => profileView(profile, { botSeats: profile.ruleModules.length === 0 }));

describe('lobby ruleset picker', () => {
  it('offers only enabled profiles: the base game and Seafarers for 3–6 players, Explorers & Pirates for 3–4', () => {
    const resolved = resolveRuleset(registry, {});
    expect(resolved.expansions.map((choice) => choice.key)).toEqual(['base', 'seafarers', 'explorersPirates']);
    expect(resolved.scenarios.map((choice) => choice.key)).toEqual(['standard']);
    expect(resolved.playerCounts).toEqual([3, 4, 5, 6]);
    expect(resolved.profile?.id).toBe('base-2025');
    expect(resolveRuleset(registry, { playerCount: 5 }).profile?.id).toBe('base-paired-2025');
    expect(resolveRuleset(registry, { playerCount: 6 }).profile?.id).toBe('base-paired-2025');
    expect(resolveRuleset(registry, {}, 4).playerCounts).toEqual([3, 4]);
    const sea = resolveRuleset(registry, { expansionKey: 'seafarers', playerCount: 6 });
    expect(sea.scenarios.map(scenarioLabelIds)).toEqual([['scenario.new-shores']]);
    expect(sea.profile?.id).toBe('sf-new-shores-paired-2025');
    expect(resolveRuleset(registry, { expansionKey: 'seafarers', playerCount: 3 }).profile?.id).toBe('sf-new-shores-2025');
    const ep = resolveRuleset(registry, { expansionKey: 'explorersPirates' });
    expect(ep.scenarios).toHaveLength(5);
    expect(ep.playerCounts).toEqual([3, 4]);
    expect(ep.profile?.id).toBe('ep-land-ho-2025');
  });

  it('cascades expansion set → scenario → player count from the registry', () => {
    const enabledAll = registry.map((profile) => ({ ...profile, enabled: true }));
    const all = resolveRuleset(enabledAll, {});
    expect(all.expansions.map((choice) => choice.key)).toEqual(['base', 'seafarers', 'citiesKnights', 'citiesKnights+seafarers', 'explorersPirates']);
    const combined = resolveRuleset(enabledAll, { expansionKey: 'citiesKnights+seafarers', playerCount: 6 });
    expect(expansionLabelIds(combined.expansion!)).toEqual(['expansion.seafarers', 'expansion.citiesKnights']);
    expect(combined.scenarios.map(scenarioLabelIds)).toEqual([['scenario.new-shores']]);
    expect(combined.profile?.id).toBe('sf-ck-new-shores-paired-2025');
    // Explorers & Pirates: one scenario per mission set, in book order, 3–4 players.
    const ep = resolveRuleset(enabledAll, { expansionKey: 'explorersPirates' });
    expect(ep.scenarios.map(scenarioLabelIds)).toEqual([
      ['scenario.land-ho'], ['scenario.pirate-lairs'], ['scenario.fish'], ['scenario.spices'], ['scenario.explorers-pirates'],
    ]);
    expect(ep.playerCounts).toEqual([3, 4]);
    expect(ep.profile?.id).toBe('ep-land-ho-2025');
    expect(resolveRuleset(enabledAll, { expansionKey: 'explorersPirates', scenarioKey: ep.scenarios[4]!.key }).profile?.id).toBe('ep-full-2025');
    // A stale choice falls back to the first available option.
    const stale = resolveRuleset(enabledAll, { expansionKey: 'tradersBarbarians', scenarioKey: 'gone', playerCount: 9 });
    expect(stale.expansion?.key).toBe('base');
    expect(stale.profile?.id).toBe('base-2025');
  });

  it('resolves nothing when the registry offers nothing', () => {
    const resolved = resolveRuleset(registry.map((profile) => ({ ...profile, enabled: false })), {});
    expect(resolved.expansion).toBeNull();
    expect(resolved.profile).toBeNull();
    expect(resolved.playerCounts).toEqual([]);
  });
});
