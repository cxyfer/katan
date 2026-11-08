/**
 * Locale-aware formatting. Counts, dates and canonical term maps are rendered
 * per locale without ever changing the underlying canonical values
 * (docs/SPEC.md §8.7).
 */

import type { Locale } from '@catan/protocol';
import { BANK_VIEW_CAP, COMMODITIES, RESOURCES, type Resource } from '@catan/rules';
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

/**
 * 投影的銀行／商品存量只到 `BANK_VIEW_CAP`（SPEC §8.3、#137）：低於上限是確切張數，
 * 等於上限代表「至少這麼多」。`taken` 是這次選擇已先拿走的張數（例如豐收之年已選的牌），
 * 從「至少」的值扣掉後仍是「至少」；扣到 0 時不再標示。
 */
export function bankSupply(supply: number, taken = 0): { count: number; atLeast: boolean } {
  const count = Math.max(0, supply - taken);
  return { count, atLeast: supply >= BANK_VIEW_CAP && count > 0 };
}

/** 銀行存量的顯示文字：確切張數，或「至少」時的 `2+`。 */
export function formatBankSupply(locale: Locale, supply: number, taken = 0): string {
  const { count, atLeast } = bankSupply(supply, taken);
  const text = formatNumber(locale, count);
  return atLeast ? t(locale, 'bank.supply.atLeast', { count: text }) : text;
}

function isResource(value: string): value is Resource {
  return (RESOURCES as readonly string[]).includes(value);
}

/** Commodities (Cities & Knights) share the `resource.<id>` label namespace. */
function isCommodity(value: string): boolean {
  return (COMMODITIES as readonly string[]).includes(value);
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
    const label = isResource(key) || isCommodity(key) ? t(locale, `resource.${key}`) : key;
    parts.push(`${formatNumber(locale, amount)}×${label}`);
  }
  return parts.length > 0 ? parts.join('、') : '—';
}

/** 資源、C&K 商品與 module goods 共用的交易條款文字。 */
export function formatTradeMap(
  locale: Locale,
  resources: Record<string, number> | undefined,
  goods: Record<string, number> | undefined,
): string {
  const parts: string[] = [];
  const resourceText = formatResourceMap(locale, resources);
  if (resourceText !== '—') parts.push(resourceText);
  for (const [good, amount] of Object.entries(goods ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (amount > 0) parts.push(`${formatNumber(locale, amount)}×${t(locale, `tb.trade.goodName.${good}`)}`);
  }
  return parts.length > 0 ? parts.join(t(locale, 'tb.trade.separator')) : '—';
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

export function formatDice(dice: readonly number[] | null | undefined): string {
  if (!dice || dice.length === 0) return '—';
  return dice.join(' + ');
}
