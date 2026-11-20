/** 0.4.x 存在 `catan.*` 的瀏覽器偏好搬到 `katan.*`。 */

import { describe, expect, it } from 'vitest';
import { AUDIO_KEY } from '../src/audio/preferences.ts';
import {
  LOCALE_KEY,
  memoryStorage,
  migrateLegacyStorage,
  MUTE_KEY,
  NEWS_SEEN_KEY,
  NICKNAME_KEY,
  readStoredLocale,
  TRADE_AUTO_DECLINE_KEY,
} from '../src/state/session.ts';

describe('legacy storage keys', () => {
  it('moves every catan.* preference to its katan.* key', () => {
    const storage = memoryStorage({
      'catan.locale': 'en',
      'catan.nickname': 'Old',
      'catan.mute': '["p2"]',
      'catan.trade.autoDecline': 'true',
      'catan.news.seen': '0.4.3',
      'catan.audio': '{"muted":true}',
    });
    migrateLegacyStorage(storage);
    expect(readStoredLocale(storage)).toBe('en');
    expect(storage.getItem(NICKNAME_KEY)).toBe('Old');
    expect(storage.getItem(MUTE_KEY)).toBe('["p2"]');
    expect(storage.getItem(TRADE_AUTO_DECLINE_KEY)).toBe('true');
    expect(storage.getItem(NEWS_SEEN_KEY)).toBe('0.4.3');
    expect(storage.getItem(AUDIO_KEY)).toBe('{"muted":true}');
    for (const key of ['locale', 'nickname', 'mute', 'trade.autoDecline', 'news.seen', 'audio']) {
      expect(storage.getItem(`catan.${key}`)).toBeNull();
    }
  });

  it('keeps a value already stored under the current key', () => {
    const storage = memoryStorage({ 'catan.locale': 'en', [LOCALE_KEY]: 'zh-Hant' });
    migrateLegacyStorage(storage);
    expect(storage.getItem(LOCALE_KEY)).toBe('zh-Hant');
    expect(storage.getItem('catan.locale')).toBeNull();
  });

  it('ignores storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(() => migrateLegacyStorage(broken)).not.toThrow();
  });
});
