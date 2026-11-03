/**
 * Which rulesets the built-in strategies can play (SPEC §4.9).
 *
 * The strategies only issue base commands and answer base pending frames, so a
 * profile is playable when every rules module it runs is listed here. A phase
 * that teaches the bots a module's commands and frames appends its id.
 */

import type { ProfileDefinition } from '@catan/rules';

/** Rules module ids (`ProfileDefinition.ruleModules`) the strategies can play. */
export const BOT_RULE_MODULES: readonly string[] = [];

/** True when bots can be seated in a game of this profile. */
export function botsCanPlay(profile: Pick<ProfileDefinition, 'ruleModules'>): boolean {
  return profile.ruleModules.every((module) => BOT_RULE_MODULES.includes(module));
}
