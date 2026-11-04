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
import {
  ERROR_MESSAGE_IDS as PROTOCOL_ERROR_IDS,
  EVENT_MESSAGE_IDS as PROTOCOL_EVENT_IDS,
  REQUIRED_MESSAGE_IDS as PROTOCOL_REQUIRED_IDS,
  SERVER_ERROR_IDS as PROTOCOL_SERVER_ERROR_IDS,
} from '@catan/protocol';
import { en } from './en.ts';
import { MODULE_CATALOGS } from './modules/index.ts';
import { zhHant } from './zh-Hant.ts';

/** A catalog maps a stable message id to a template with `{param}` slots. */
export type Catalog = Readonly<Record<string, string>>;

export { en, zhHant, MODULE_CATALOGS };

function withModules(locale: Locale, base: Catalog): Catalog {
  return Object.assign({}, base, ...Object.values(MODULE_CATALOGS).map((catalog) => catalog[locale]));
}

/** Base catalogs with every rules module's own catalog merged in. */
export const catalogs: Readonly<Record<Locale, Catalog>> = {
  'zh-Hant': withModules('zh-Hant', zhHant),
  en: withModules('en', en),
};

export const SUPPORTED_LOCALES: readonly Locale[] = ['zh-Hant', 'en'];

/** docs/SPEC.md §8.7: unsupported browser languages fall back to zh-Hant. */
export const DEFAULT_LOCALE: Locale = 'zh-Hant';

/**
 * Ids this client synthesises itself, which therefore cannot appear in the
 * server-owned vocabulary: a transport failure it detected, and the generic
 * envelopes it builds from an unrecognised HTTP status.
 *
 * Everything else the client must render comes from `PROTOCOL_REQUIRED_IDS`;
 * duplicating server ids here previously let the service's own notices
 * (`blocker.*`) go untranslated without any test noticing.
 */
export const CLIENT_ERROR_MESSAGE_IDS: readonly string[] = [
  'error.E_NETWORK',
  'error.E_UNAUTHORIZED',
  'error.E_INVALID_COMMAND',
  'error.unknown',
];

/** Every id a client must be able to render, from both owners. */
export const REQUIRED_MESSAGE_IDS: readonly string[] = [
  ...new Set([...PROTOCOL_REQUIRED_IDS, ...CLIENT_ERROR_MESSAGE_IDS]),
];

export { PROTOCOL_REQUIRED_IDS };

/** Canonical rule-event message ids, re-exported from `@catan/protocol`. */
export const EVENT_MESSAGE_IDS: readonly string[] = PROTOCOL_EVENT_IDS;

/**
 * Every error id this client may have to render: the service-owned vocabulary
 * plus the envelopes the client synthesises itself.
 */
export const ERROR_MESSAGE_IDS: readonly string[] = [
  ...new Set([...PROTOCOL_ERROR_IDS, ...PROTOCOL_SERVER_ERROR_IDS, ...CLIENT_ERROR_MESSAGE_IDS]),
];
