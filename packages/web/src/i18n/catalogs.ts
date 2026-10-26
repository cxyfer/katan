/**
 * Message catalog registry.
 *
 * Every key is a stable message id. Two families of ids are fixed by contract:
 *
 * - rule events use exactly the engine's event `type` (see `EVENT_MESSAGE_IDS`);
 * - errors use exactly `error.<CommandErrorCode>` as sent in `ApiError.messageId`.
 *
 * `zh-Hant` and `en` must always expose the same key set; `test/i18n.test.ts`
 * asserts that parity, and `REQUIRED_MESSAGE_IDS` asserts the contractual ids.
 */

import type { Locale } from '@catan/protocol';
import { ERROR_MESSAGE_IDS as PROTOCOL_ERROR_IDS, EVENT_MESSAGE_IDS as PROTOCOL_EVENT_IDS } from '@catan/protocol';
import { en } from './en.ts';
import { zhHant } from './zh-Hant.ts';

/** A catalog maps a stable message id to a template with `{param}` slots. */
export type Catalog = Readonly<Record<string, string>>;

export { en, zhHant };

export const catalogs: Readonly<Record<Locale, Catalog>> = {
  'zh-Hant': zhHant,
  en,
};

export const SUPPORTED_LOCALES: readonly Locale[] = ['zh-Hant', 'en'];

/** docs/SPEC.md §8.7: unsupported browser languages fall back to zh-Hant. */
export const DEFAULT_LOCALE: Locale = 'zh-Hant';

/**
 * Client-only message ids: transport and API codes that never originate in the
 * rules engine, so they are not part of the protocol's derived lists.
 */
export const CLIENT_ERROR_MESSAGE_IDS: readonly string[] = [
  'error.E_STALE_REVISION',
  'error.E_COMMAND_ID_REUSED',
  'error.E_NETWORK',
  'error.E_ROOM_FULL',
  'error.E_ROOM_NOT_FOUND',
  'error.E_NOT_IN_ROOM',
  'error.E_CHAT_TOO_LONG',
  'error.E_CHAT_RATE_LIMITED',
  'error.E_UNAUTHORIZED',
  'error.E_INVALID_INVITE',
];

/**
 * Legacy/defensive rule-error ids kept localisable even though the current
 * engine revision no longer emits them.
 */
export const LEGACY_ERROR_MESSAGE_IDS: readonly string[] = [
  'error.E_OCCUPIED',
  'error.E_DISTANCE_RULE',
  'error.E_NOT_CONNECTED',
  'error.E_INVALID_HARBOR_RATE',
  'error.E_UNSUPPORTED',
];

/** Canonical rule-event message ids, re-exported from `@catan/protocol`. */
export const EVENT_MESSAGE_IDS: readonly string[] = PROTOCOL_EVENT_IDS;

/** Canonical command-error message ids, re-exported from `@catan/protocol`. */
export const ERROR_MESSAGE_IDS: readonly string[] = [
  ...PROTOCOL_ERROR_IDS,
  ...CLIENT_ERROR_MESSAGE_IDS,
  ...LEGACY_ERROR_MESSAGE_IDS,
];

export const REQUIRED_MESSAGE_IDS: readonly string[] = [
  ...EVENT_MESSAGE_IDS,
  ...ERROR_MESSAGE_IDS,
];
