/**
 * Tiny in-house i18n runtime (no external library).
 *
 * Rendering rule: the protocol only ever carries stable message ids plus
 * canonical parameters, so every user-facing sentence is produced here
 * (docs/SPEC.md §8.7). `t()` never mutates or reloads application state, which
 * is what lets a locale switch preserve a draft, a selection or a pending
 * command id.
 */

import type { Locale } from '@catan/protocol';
import { catalogs, DEFAULT_LOCALE, SUPPORTED_LOCALES } from './catalogs.ts';

export * from './catalogs.ts';

/**
 * Picks the initial locale from the browser's language preferences, falling
 * back to Traditional Chinese for anything unsupported (docs/SPEC.md §8.7).
 */
export function detectLocale(languages: readonly string[] | undefined | null): Locale {
  for (const raw of languages ?? []) {
    const tag = raw.trim().toLowerCase();
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-Hant';
  }
  return DEFAULT_LOCALE;
}

/** Narrows an arbitrary persisted string back to a supported locale. */
export function asLocale(value: unknown): Locale | null {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
    ? (value as Locale)
    : null;
}

export function hasMessage(locale: Locale, messageId: string): boolean {
  return Object.prototype.hasOwnProperty.call(catalogs[locale], messageId);
}

/** Replaces `{param}` slots; unknown slots are left verbatim so gaps are visible. */
export function interpolate(template: string, params?: Record<string, unknown>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    if (value === undefined || value === null) return match;
    return typeof value === 'string' ? value : String(value);
  });
}

/**
 * Resolves a message id. An id missing from the active locale falls back to the
 * default locale; an id missing everywhere returns the id itself so tests and
 * developers see the gap instead of a blank control.
 */
export function t(locale: Locale, messageId: string, params?: Record<string, unknown>): string {
  const active = catalogs[locale] ?? catalogs[DEFAULT_LOCALE];
  const template = active[messageId] ?? catalogs[DEFAULT_LOCALE][messageId];
  if (template === undefined) return messageId;
  return interpolate(template, params);
}

export function createTranslator(locale: Locale): (id: string, params?: Record<string, unknown>) => string {
  return (id, params) => t(locale, id, params);
}
