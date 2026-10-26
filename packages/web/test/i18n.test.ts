import { describe, expect, it } from 'vitest';
import {
  catalogs,
  ERROR_MESSAGE_IDS,
  EVENT_MESSAGE_IDS,
  REQUIRED_MESSAGE_IDS,
} from '../src/i18n/catalogs.ts';
import { asLocale, detectLocale, hasMessage, interpolate, t } from '../src/i18n/index.ts';
import { translateEvent, translateNotice } from '../src/i18n/events.ts';
import { makeEvent } from '../src/test/fixtures.ts';

describe('catalog parity', () => {
  it('zh-Hant and en expose exactly the same key set', () => {
    const zh = Object.keys(catalogs['zh-Hant']).sort();
    const en = Object.keys(catalogs.en).sort();
    expect(zh.length).toBeGreaterThan(200);
    expect(zh).toEqual(en);
  });

  it('every catalogued template is non-empty in both locales', () => {
    for (const locale of ['zh-Hant', 'en'] as const) {
      for (const [key, value] of Object.entries(catalogs[locale])) {
        expect(value.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('covers every engine event type and every error code in both locales', () => {
    expect(EVENT_MESSAGE_IDS).toHaveLength(32);
    expect(ERROR_MESSAGE_IDS.length).toBeGreaterThanOrEqual(27);
    for (const id of REQUIRED_MESSAGE_IDS) {
      expect(hasMessage('zh-Hant', id), `zh-Hant missing ${id}`).toBe(true);
      expect(hasMessage('en', id), `en missing ${id}`).toBe(true);
    }
  });

  it('uses the engine event type as the message id (no renaming layer)', () => {
    for (const id of EVENT_MESSAGE_IDS) {
      expect(catalogs.en[id]).toBeTypeOf('string');
      expect(t('en', id, {})).not.toBe(id);
    }
  });
});

describe('t()', () => {
  it('interpolates named parameters and leaves unknown slots visible', () => {
    expect(interpolate('a {b} c', { b: 3 })).toBe('a 3 c');
    expect(interpolate('a {b} c', {})).toBe('a {b} c');
  });

  it('falls back to the default locale and finally to the id', () => {
    expect(t('en', 'app.title')).toBe('Catan Table');
    expect(t('zh-Hant', 'app.title')).toBe('卡坦桌遊桌');
    expect(t('en', 'not.a.real.key')).toBe('not.a.real.key');
  });

  it('renders a real sentence for an event in both locales', () => {
    const event = makeEvent(4, 'build.road', { playerId: 'p1', edge: 41, free: false });
    const nameOf = (id: string) => (id === 'p1' ? 'Alex' : id);
    const en = translateEvent('en', event, nameOf);
    const zh = translateEvent('zh-Hant', event, nameOf);
    expect(en.unknown).toBe(false);
    expect(en.text).toContain('41');
    expect(zh.text).toContain('41');
    expect(zh.text).not.toBe(en.text);
  });

  it('never leaks a raw message id for an unknown error code', () => {
    expect(translateNotice('en', { messageId: 'error.E_TOTALLY_NEW' })).toContain('E_TOTALLY_NEW');
    expect(translateNotice('en', { messageId: 'error.E_ILLEGAL_TARGET' })).toBe(
      'That target is not legal.',
    );
    expect(translateNotice('en', null)).toBe('');
  });
});

describe('locale detection', () => {
  it('prefers the first supported browser language', () => {
    expect(detectLocale(['en-GB', 'zh-TW'])).toBe('en');
    expect(detectLocale(['zh-HK'])).toBe('zh-Hant');
    expect(detectLocale(['zh-CN'])).toBe('zh-Hant');
  });

  it('falls back to Traditional Chinese for unsupported languages', () => {
    expect(detectLocale(['fr-FR', 'de'])).toBe('zh-Hant');
    expect(detectLocale([])).toBe('zh-Hant');
    expect(detectLocale(undefined)).toBe('zh-Hant');
  });

  it('narrows persisted values and rejects anything else', () => {
    expect(asLocale('en')).toBe('en');
    expect(asLocale('zh-Hant')).toBe('zh-Hant');
    expect(asLocale('ja')).toBeNull();
    expect(asLocale(7)).toBeNull();
  });
});
