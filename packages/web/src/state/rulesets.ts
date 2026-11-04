/**
 * Lobby ruleset picker derived from the server registry (docs/SPEC.md §5.2).
 *
 * The host chooses an expansion set, then a scenario (with its variants), then
 * a player count; the choice resolves to exactly one enabled profile. Every
 * option comes from `GET /api/profiles`, so disabled profiles are never
 * offered and a new profile appears without UI changes. The server still
 * re-validates the resolved profile.
 */

import type { ProfileView } from '@catan/protocol';
import { EXPANSION_IDS } from '@catan/rules';

/** Registry order (base → Seafarers → C&K → T&B → E&P) for display. */
function displayOrder(expansions: readonly string[]): string[] {
  const rank = (id: string) => {
    const index = (EXPANSION_IDS as readonly string[]).indexOf(id);
    return index < 0 ? EXPANSION_IDS.length : index;
  };
  return [...expansions].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export interface ExpansionChoice {
  /** Stable key: sorted expansion ids joined by `+`, or `base`. */
  key: string;
  expansions: string[];
}

export interface ScenarioChoice {
  /** Stable key: scenario id (or `standard`) plus sorted variants. */
  key: string;
  scenario: string | null;
  variants: string[];
}

export interface RulesetSelection {
  expansionKey?: string;
  scenarioKey?: string;
  playerCount?: number;
}

export interface ResolvedRuleset {
  expansions: ExpansionChoice[];
  expansion: ExpansionChoice | null;
  scenarios: ScenarioChoice[];
  scenario: ScenarioChoice | null;
  playerCounts: number[];
  playerCount: number | null;
  profile: ProfileView | null;
}

export function expansionKey(expansions: readonly string[]): string {
  return expansions.length ? [...expansions].sort().join('+') : 'base';
}

export function scenarioKey(scenario: string | null, variants: readonly string[]): string {
  return [scenario ?? 'standard', ...[...variants].sort()].join('+');
}

function unique<T extends { key: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)));
}

/**
 * Resolves the picker cascade. Each step falls back to its first option when
 * the current choice is no longer available, so the form never names a
 * combination the registry does not offer.
 */
export function resolveRuleset(
  profiles: readonly ProfileView[],
  selection: RulesetSelection,
  capacityLimit = Infinity,
): ResolvedRuleset {
  const enabled = profiles.filter((profile) => profile.enabled);
  const expansions = unique(enabled.map((profile) => ({
    key: expansionKey(profile.expansions),
    expansions: displayOrder(profile.expansions),
  })));
  const expansion = expansions.find((choice) => choice.key === selection.expansionKey) ?? expansions[0] ?? null;
  const family = enabled.filter((profile) => expansion && expansionKey(profile.expansions) === expansion.key);
  const scenarios = unique(family.map((profile) => ({
    key: scenarioKey(profile.scenario, profile.variants),
    scenario: profile.scenario,
    variants: [...profile.variants].sort(),
  })));
  const scenario = scenarios.find((choice) => choice.key === selection.scenarioKey) ?? scenarios[0] ?? null;
  const candidates = family.filter((profile) => scenario && scenarioKey(profile.scenario, profile.variants) === scenario.key);
  const playerCounts = [...new Set(candidates.flatMap((profile) => profile.playerCounts))]
    .filter((count) => count <= capacityLimit)
    .sort((a, b) => a - b);
  const playerCount = playerCounts.includes(selection.playerCount ?? NaN)
    ? selection.playerCount!
    : (playerCounts[0] ?? null);
  const profile = playerCount === null
    ? null
    : candidates.find((candidate) => candidate.playerCounts.includes(playerCount)) ?? null;
  return { expansions, expansion, scenarios, scenario, playerCounts, playerCount, profile };
}

/** Message ids naming an expansion set, in display order. */
export function expansionLabelIds(choice: ExpansionChoice): string[] {
  return choice.expansions.length ? choice.expansions.map((id) => `expansion.${id}`) : ['expansion.none'];
}

/** Message ids naming a scenario and its variants. */
export function scenarioLabelIds(choice: ScenarioChoice): string[] {
  return [`scenario.${choice.scenario ?? 'standard'}`, ...choice.variants.map((id) => `variant.${id}`)];
}
