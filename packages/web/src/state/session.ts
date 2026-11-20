/**
 * Browser-local persistence: the explicit locale choice, the last nickname, the
 * personal mute list and the trade auto-decline preference (docs/SPEC.md §8.7).
 * Injected so tests never touch a real `localStorage`.
 */

import type { Locale } from '@katan/protocol';
import { asLocale } from '../i18n/index.ts';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LOCALE_KEY = 'katan.locale';
export const NICKNAME_KEY = 'katan.nickname';
export const MUTE_KEY = 'katan.mute';
export const TRADE_AUTO_DECLINE_KEY = 'katan.trade.autoDecline';
export const NEWS_SEEN_KEY = 'katan.news.seen';

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

/** 公告牌：這個瀏覽器最後看過的公告版號；從未看過或讀不到時為 `null`。 */
export function readStoredNewsSeen(storage: StorageLike): string | null {
  try {
    return storage.getItem(NEWS_SEEN_KEY);
  } catch {
    return null;
  }
}

export function writeStoredNewsSeen(storage: StorageLike, version: string): void {
  try {
    storage.setItem(NEWS_SEEN_KEY, version);
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

/** 0.4.x 以前以 `catan.` 為前綴的鍵，也涵蓋 audio/preferences.ts 的音效偏好。 */
const LEGACY_KEY_PAIRS: readonly (readonly [legacy: string, current: string])[] = [
  'locale',
  'nickname',
  'mute',
  'trade.autoDecline',
  'news.seen',
  'audio',
].map((suffix) => [`catan.${suffix}`, `katan.${suffix}`] as const);

/** 把舊鍵的值搬到新鍵；新鍵已有值時以新鍵為準，舊鍵一律移除。 */
export function migrateLegacyStorage(storage: StorageLike): void {
  for (const [legacy, current] of LEGACY_KEY_PAIRS) {
    try {
      const value = storage.getItem(legacy);
      if (value === null) continue;
      if (storage.getItem(current) === null) storage.setItem(current, value);
      storage.removeItem(legacy);
    } catch {
      // 與其他偏好相同：儲存空間不可用時直接略過
    }
  }
}

let legacyStorageMigrated = false;

export function browserStorage(): StorageLike {
  if (typeof globalThis.localStorage === 'undefined') return memoryStorage();
  if (!legacyStorageMigrated) {
    legacyStorageMigrated = true;
    migrateLegacyStorage(globalThis.localStorage);
  }
  return globalThis.localStorage;
}
