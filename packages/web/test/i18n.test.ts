import { describe, expect, it } from 'vitest';
import {
  ERROR_MESSAGE_IDS,
  EVENT_MESSAGE_IDS,
  REQUIRED_MESSAGE_IDS,
  catalogs,
} from '../src/i18n/catalogs.ts';
import {
  ERROR_MESSAGE_IDS as PROTOCOL_ERROR_IDS,
  EVENT_MESSAGE_IDS as PROTOCOL_EVENT_IDS,
  REQUIRED_MESSAGE_IDS as PROTOCOL_REQUIRED_IDS,
} from '@catan/protocol';
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

  it('covers every id in the protocol’s derived ERROR_MESSAGE_IDS list', () => {
    expect(PROTOCOL_ERROR_IDS.length).toBeGreaterThanOrEqual(20);
    for (const id of PROTOCOL_ERROR_IDS) {
      expect(id.startsWith('error.'), `unexpected id shape: ${id}`).toBe(true);
      expect(hasMessage('zh-Hant', id), `zh-Hant missing ${id}`).toBe(true);
      expect(hasMessage('en', id), `en missing ${id}`).toBe(true);
    }
  });

  it('covers every id in the protocol’s derived EVENT_MESSAGE_IDS list', () => {
    expect(PROTOCOL_EVENT_IDS.length).toBeGreaterThanOrEqual(30);
    for (const id of PROTOCOL_EVENT_IDS) {
      expect(id.startsWith('event.'), `unexpected id shape: ${id}`).toBe(true);
      expect(hasMessage('zh-Hant', id), `zh-Hant missing ${id}`).toBe(true);
      expect(hasMessage('en', id), `en missing ${id}`).toBe(true);
    }
  });

  it('re-exports the protocol lists and adds only client-side extras', () => {
    expect(EVENT_MESSAGE_IDS).toEqual(PROTOCOL_EVENT_IDS);
    for (const id of PROTOCOL_ERROR_IDS) expect(ERROR_MESSAGE_IDS).toContain(id);
    expect(ERROR_MESSAGE_IDS).toContain('error.E_NETWORK');
    for (const id of REQUIRED_MESSAGE_IDS) {
      expect(hasMessage('zh-Hant', id), `zh-Hant missing ${id}`).toBe(true);
      expect(hasMessage('en', id), `en missing ${id}`).toBe(true);
    }
  });

  it('renders every service-owned id, including lobby blockers', () => {
    // The server authors its own notices and rejections; a missing key here
    // previously showed a raw id such as `blocker.seats` to players.
    expect(PROTOCOL_REQUIRED_IDS.length).toBeGreaterThanOrEqual(90);
    for (const id of PROTOCOL_REQUIRED_IDS) {
      expect(hasMessage('zh-Hant', id), `zh-Hant missing ${id}`).toBe(true);
      expect(hasMessage('en', id), `en missing ${id}`).toBe(true);
      const params = { capacity: 4, min: 3, playerCount: 4, seated: 2, players: ['A', 'B'], field: 'x', max: 6, seatedCount: 1, profileId: 'base-2025', color: 'red', seatedPlayers: 1, code: 'E_X' };
      expect(t('en', id, params)).not.toBe(id);
      expect(t('zh-Hant', id, params)).not.toBe(id);
    }
  });

  it('renders every catalogued rule event as a real sentence in both locales', () => {
    for (const id of EVENT_MESSAGE_IDS) {
      expect(t('en', id, {})).not.toBe(id);
      expect(t('zh-Hant', id, {})).not.toBe(id);
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
    expect(en.messageId).toBe('event.build.road');
    expect(en.text).toContain('41');
    expect(zh.text).toContain('41');
    expect(zh.text).not.toBe(en.text);
  });

  it('renders the newly added game.abandoned event without a raw parameter', () => {
    const translated = translateEvent('en', makeEvent(9, 'game.abandoned', { reason: 'abandoned' }), (id) => id);
    expect(translated.unknown).toBe(false);
    expect(translated.text).toBe('The game was abandoned: Abandoned by table agreement.');
  });

  it('renders a bank shortage with the dice total, not as a shortfall amount', () => {
    const event = makeEvent(10, 'production.starved', { hex: 4, resource: 'ore', total: 6 });
    expect(translateEvent('en', event, (id) => id).text).toBe(
      'Roll of 6: the bank is short of Ore, so hex 4 paid nothing.',
    );
    expect(translateEvent('zh-Hant', event, (id) => id).text).toBe('擲出 6：銀行的礦石不足，六角格 4 本次不發放。');
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
