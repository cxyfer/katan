/**
 * Locale-aware formatting. Counts, dates and canonical term maps are rendered
 * per locale without ever changing the underlying canonical values
 * (docs/SPEC.md §8.7).
 */

import type { Locale } from '@catan/protocol';
import { RESOURCES, type Resource } from '@catan/rules';
import { t } from './index.ts';

export function formatNumber(locale: Locale, value: number): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

export function formatDateTime(locale: Locale, iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function isResource(value: string): value is Resource {
  return (RESOURCES as readonly string[]).includes(value);
}

/**
 * Renders a canonical resource map (`{ lumber: 2 }`) as localised text. Keys are
 * kept canonical; only the labels are translated.
 */
export function formatResourceMap(
  locale: Locale,
  terms: Partial<Record<string, number>> | Record<string, number> | null | undefined,
): string {
  if (!terms) return '—';
  const parts: string[] = [];
  for (const key of Object.keys(terms).sort()) {
    const amount = terms[key] ?? 0;
    if (!amount) continue;
    const label = isResource(key) ? t(locale, `resource.${key}`) : key;
    parts.push(`${formatNumber(locale, amount)}×${label}`);
  }
  return parts.length > 0 ? parts.join('、') : '—';
}

/** Renders a list of resource ids with multiplicities (e.g. a discard pile). */
export function formatResourceList(locale: Locale, resources: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const resource of resources) counts.set(resource, (counts.get(resource) ?? 0) + 1);
  return formatResourceMap(locale, Object.fromEntries(counts));
}

/** Renders a per-player production/transfer summary (`{ p1: { wool: 2 } }`). */
export function formatGrantMap(
  locale: Locale,
  grants: Record<string, Partial<Record<string, number>>> | null | undefined,
  nameOf: (playerId: string) => string,
): string {
  if (!grants) return '—';
  const parts: string[] = [];
  for (const playerId of Object.keys(grants)) {
    const terms = formatResourceMap(locale, grants[playerId]);
    if (terms === '—') continue;
    parts.push(`${nameOf(playerId)}: ${terms}`);
  }
  return parts.length > 0 ? parts.join('；') : '—';
}

export function formatPlayerList(
  players: readonly string[],
  nameOf: (playerId: string) => string,
): string {
  return players.map(nameOf).join('、');
}

export function formatDice(dice: readonly number[] | null | undefined): string {
  if (!dice || dice.length === 0) return '—';
  return dice.join(' + ');
}
