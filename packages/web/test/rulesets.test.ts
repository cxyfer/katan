import { describe, expect, it } from 'vitest';
import { PROFILES } from '@katan/rules';
import { profileView } from '@katan/protocol';
import { expansionLabelIds, resolveRuleset, scenarioLabelIds } from '../src/state/rulesets.ts';

const registry = PROFILES.map((profile) => profileView(profile, { botLevels: profile.ruleModules.length === 0 ? ['easy', 'standard', 'hard'] : [] }));

describe('lobby ruleset picker', () => {
  it('offers only enabled profiles: the base game, Seafarers, Cities & Knights and both combined for 3–6 players, and Traders & Barbarians', () => {
    const resolved = resolveRuleset(registry, {});
    expect(resolved.expansions.map((choice) => choice.key)).toEqual(['base', 'seafarers', 'citiesKnights', 'citiesKnights+seafarers', 'explorersPirates', 'tradersBarbarians']);
    expect(resolved.scenarios.map((choice) => choice.key)).toEqual(['standard']);
    expect(resolved.playerCounts).toEqual([3, 4, 5, 6]);
    expect(resolved.profile?.id).toBe('base-2025');
    expect(resolveRuleset(registry, { playerCount: 5 }).profile?.id).toBe('base-paired-2025');
    expect(resolveRuleset(registry, { playerCount: 6 }).profile?.id).toBe('base-paired-2025');
    expect(resolveRuleset(registry, {}, 4).playerCounts).toEqual([3, 4]);
    const tb = resolveRuleset(registry, { expansionKey: 'tradersBarbarians', scenarioKey: 'standard+harbors' });
    expect(tb.scenario && scenarioLabelIds(tb.scenario)).toEqual(['scenario.standard', 'variant.harbors']);
    expect(tb.playerCounts).toEqual([3, 4]);
    expect(tb.profile?.id).toBe('tb-harbors-2025');
    // Event-card rows are registered but closed, so the picker never names them.
    expect(tb.scenarios.some((choice) => choice.variants.includes('event-cards'))).toBe(false);
    const sea = resolveRuleset(registry, { expansionKey: 'seafarers', playerCount: 6 });
    expect(sea.scenarios.map(scenarioLabelIds)).toEqual([['scenario.new-shores'], ['scenario.four-islands'], ['scenario.fog-islands'], ['scenario.through-the-desert'], ['scenario.forgotten-tribe'], ['scenario.cloth-for-catan'], ['scenario.pirate-islands'], ['scenario.wonders-of-catan'], ['scenario.new-world']]);
    expect(sea.profile?.id).toBe('sf-new-shores-paired-2025');
    expect(resolveRuleset(registry, { expansionKey: 'seafarers', playerCount: 3 }).profile?.id).toBe('sf-new-shores-2025');
    const ep = resolveRuleset(registry, { expansionKey: 'explorersPirates' });
    expect(ep.scenarios).toHaveLength(5);
    expect(ep.playerCounts).toEqual([3, 4]);
    expect(ep.profile?.id).toBe('ep-land-ho-2025');
    expect(resolveRuleset(registry, { expansionKey: 'citiesKnights', playerCount: 4 }).profile?.id).toBe('ck-2025');
    expect(resolveRuleset(registry, { expansionKey: 'citiesKnights', playerCount: 5 }).profile?.id).toBe('ck-paired-2025');
  });

  it('hints when a scenario supports fewer players than the registry maximum and says when the count was adjusted', () => {
    // 八個新劇本在 S0 仍是 disabled；用「全部啟用」的副本驗證提示。
    const enabledAll = registry.map((profile) => ({ ...profile, enabled: true }));
    const base = resolveRuleset(enabledAll, { playerCount: 4 });
    expect(base.scenarioPlayerRange).toEqual({ min: 3, max: 6 });
    expect(base.scenarioNarrowsPlayers).toBe(false);
    // 揚帆出海是 3–6 人：不提示。
    const shores = resolveRuleset(enabledAll, { expansionKey: 'seafarers', scenarioKey: 'new-shores', playerCount: 5 });
    expect(shores.scenarioNarrowsPlayers).toBe(false);
    expect(shores.playerCountAdjusted).toBe(false);
    // 3–4 人劇本：提示；選了 5 人會被改成 3 並說明。
    const four = resolveRuleset(enabledAll, { expansionKey: 'seafarers', scenarioKey: 'four-islands', playerCount: 5 });
    expect(four.profile?.id).toBe('sf-four-islands-2025');
    expect(four.scenarioPlayerRange).toEqual({ min: 3, max: 4 });
    expect(four.scenarioNarrowsPlayers).toBe(true);
    expect(four.playerCount).toBe(3);
    expect(four.playerCountAdjusted).toBe(true);
    // 人數本來就合法：提示但不說調整。
    const kept = resolveRuleset(enabledAll, { expansionKey: 'seafarers', scenarioKey: 'four-islands', playerCount: 4 });
    expect(kept.scenarioNarrowsPlayers).toBe(true);
    expect(kept.playerCountAdjusted).toBe(false);
  });

  it('does not blame the scenario when only the room capacity limit clamped the player count', () => {
    const enabledAll = registry.map((profile) => ({ ...profile, enabled: true }));
    const capped = resolveRuleset(enabledAll, { expansionKey: 'seafarers', scenarioKey: 'four-islands', playerCount: 4 }, 3);
    expect(capped.playerCount).toBe(3);
    expect(capped.scenarioPlayerRange).toEqual({ min: 3, max: 4 });
    expect(capped.playerCountAdjusted).toBe(false);
    // 劇本範圍外（5 人）同時也超過上限：仍是劇本造成的調整。
    const outside = resolveRuleset(enabledAll, { expansionKey: 'seafarers', scenarioKey: 'four-islands', playerCount: 5 }, 3);
    expect(outside.playerCountAdjusted).toBe(true);
  });

  it('shows only the enabled further Seafarers scenarios in the lobby (S2, S3, S4, S5, S6, S7, S8, S9: new world)', () => {
    const sea = resolveRuleset(registry, { expansionKey: 'seafarers' });
    expect(sea.scenarios.map(scenarioLabelIds)).toEqual([['scenario.new-shores'], ['scenario.four-islands'], ['scenario.fog-islands'], ['scenario.through-the-desert'], ['scenario.forgotten-tribe'], ['scenario.cloth-for-catan'], ['scenario.pirate-islands'], ['scenario.wonders-of-catan'], ['scenario.new-world']]);
    expect(sea.scenarioNarrowsPlayers).toBe(false);
    const ids = registry.filter((profile) => profile.scenario && ['four-islands', 'fog-islands', 'through-the-desert', 'forgotten-tribe', 'cloth-for-catan', 'pirate-islands', 'wonders-of-catan', 'new-world'].includes(profile.scenario));
    expect(ids).toHaveLength(8);
    for (const profile of ids) expect(profile.enabled).toBe(['four-islands', 'fog-islands', 'through-the-desert', 'forgotten-tribe', 'cloth-for-catan', 'pirate-islands', 'wonders-of-catan', 'new-world'].includes(profile.scenario!));
  });

  it('cascades expansion set → scenario → player count from the registry', () => {
    const enabledAll = registry
      .filter((profile) => !profile.expansions.includes('tradersBarbarians'))
      .map((profile) => ({ ...profile, enabled: true }));
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
