/**
 * Display parameters for rules-module events. Module events use canonical
 * parameter names, so one mapping covers them all: player ids become names,
 * resources and goods become their localised labels, maps become lists.
 * Anything else (numbers, flags) passes through unchanged.
 */

import type { Locale } from '@catan/protocol';
import type { GameEvent } from '@catan/rules';
import { formatNumber, formatResourceMap } from './format.ts';
import { hasMessage, t } from './index.ts';

/** Parameters naming a player (by id). */
const PLAYER_KEYS = new Set(['playerId', 'previous', 'victim', 'from', 'to', 'owner', 'recipient', 'chooser', 'holder', 'target']);

function label(locale: Locale, prefix: string, value: string): string {
  const id = `${prefix}.${value}`;
  return hasMessage(locale, id) ? t(locale, id) : value;
}

export function moduleEventParams(
  locale: Locale,
  event: GameEvent,
  nameOf: (playerId: string) => string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event.params ?? {})) {
    const name = key === 'playerId' ? 'player' : key;
    if (PLAYER_KEYS.has(key)) {
      out[name] = typeof value === 'string' ? nameOf(value) : t(locale, 'tb.nobody');
    } else if (key === 'resource' && typeof value === 'string') {
      out[name] = label(locale, 'resource', value);
    } else if ((key === 'resources' || key === 'paid' || key === 'bid') && value && typeof value === 'object') {
      out[name] = formatResourceMap(locale, value as Record<string, number>);
    } else if (typeof value === 'number') {
      out[name] = formatNumber(locale, value);
    } else if (typeof value === 'string') {
      out[name] = label(locale, 'tb.term', value);
    } else if (Array.isArray(value)) {
      out[name] = value.map((item) => (typeof item === 'string' ? nameOf(item) : String(item))).join('、');
    } else {
      out[name] = value;
    }
  }
  return out;
}
