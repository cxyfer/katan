/**
 * Browser-local persistence: the explicit locale choice, the last nickname, the
 * personal mute list and the trade auto-decline preference (docs/SPEC.md §8.7).
 * Injected so tests never touch a real `localStorage`.
 */

import type { Locale } from '@catan/protocol';
import { asLocale } from '../i18n/index.ts';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LOCALE_KEY = 'catan.locale';
export const NICKNAME_KEY = 'catan.nickname';
export const MUTE_KEY = 'catan.mute';
export const TRADE_AUTO_DECLINE_KEY = 'catan.trade.autoDecline';

export function readStoredLocale(storage: StorageLike): Locale | null {
  try {
    return asLocale(storage.getItem(LOCALE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredLocale(storage: StorageLike, locale: Locale): void {
  try {
    storage.setItem(LOCALE_KEY, locale);
  } catch {
    // Storage can be unavailable (private mode); locale persistence is a
    // convenience, never a correctness requirement.
  }
}

export function readStoredNickname(storage: StorageLike): string {
  try {
    return storage.getItem(NICKNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeStoredNickname(storage: StorageLike, nickname: string): void {
  try {
    storage.setItem(NICKNAME_KEY, nickname);
  } catch {
    // ignored on purpose
  }
}

export function readStoredMutes(storage: StorageLike): string[] {
  try {
    const raw = storage.getItem(MUTE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function writeStoredMutes(storage: StorageLike, muted: readonly string[]): void {
  try {
    storage.setItem(MUTE_KEY, JSON.stringify(muted));
  } catch {
    // ignored on purpose
  }
}

/** 交易偏好：自己資源不足的提案是否由客戶端代為拒絕。讀不到時一律視為關閉。 */
export function readStoredTradeAutoDecline(storage: StorageLike): boolean {
  try {
    return storage.getItem(TRADE_AUTO_DECLINE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeStoredTradeAutoDecline(storage: StorageLike, enabled: boolean): void {
  try {
    storage.setItem(TRADE_AUTO_DECLINE_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignored on purpose
  }
}

/** Deterministic in-memory storage for tests and SSR-less environments. */
export function memoryStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

export function browserStorage(): StorageLike {
  if (typeof globalThis.localStorage === 'undefined') return memoryStorage();
  return globalThis.localStorage;
}
