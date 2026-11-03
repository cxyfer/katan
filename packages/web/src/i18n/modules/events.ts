/**
 * Per-module event parameter builders, consulted by `../events.ts` for event
 * types the base formatter does not know. One line per module.
 */

import type { Locale } from '@catan/protocol';
import type { GameEvent } from '@catan/rules';
import { citiesKnightsEventParams } from './citiesKnights-events.ts';
import { seafarersEventParams } from './seafarers-events.ts';
import { seafarersCitiesKnightsEventParams } from './seafarersCitiesKnights-events.ts';

type Builder = (locale: Locale, event: GameEvent, nameOf: (playerId: string) => string) => Record<string, unknown> | undefined;

const BUILDERS: readonly Builder[] = [seafarersEventParams, citiesKnightsEventParams, seafarersCitiesKnightsEventParams];

export function moduleEventParams(locale: Locale, event: GameEvent, nameOf: (playerId: string) => string): Record<string, unknown> | undefined {
  for (const build of BUILDERS) {
    const params = build(locale, event, nameOf);
    if (params) return params;
  }
  return undefined;
}
