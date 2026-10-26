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

/** Rule event ids emitted by `@catan/rules` (engine `emit` calls). */
export const EVENT_MESSAGE_IDS: readonly string[] = [
  'game.created',
  'setup.building',
  'setup.road',
  'setup.startingResources',
  'turn.started',
  'turn.rolled',
  'turn.ended',
  'production.resolved',
  'production.starved',
  'discard.required',
  'discard.submitted',
  'robber.moveRequired',
  'robber.moved',
  'robber.stole',
  'build.road',
  'build.settlement',
  'build.city',
  'build.devCard',
  'dev.knight',
  'dev.roadBuilding',
  'dev.roadBuildingFinished',
  'dev.yearOfPlenty',
  'dev.yearOfPlentyPick',
  'dev.monopoly',
  'trade.offered',
  'trade.responded',
  'trade.revised',
  'trade.withdrawn',
  'trade.expired',
  'trade.bank',
  'trade.completed',
  'game.finished',
];

/** `CommandErrorCode` from `@catan/rules` plus the transport/API-only codes. */
export const ERROR_MESSAGE_IDS: readonly string[] = [
  'error.E_NOT_YOUR_TURN',
  'error.E_NOT_ACTOR',
  'error.E_WRONG_PHASE',
  'error.E_PENDING_EFFECT',
  'error.E_OCCUPIED',
  'error.E_DISTANCE_RULE',
  'error.E_NOT_CONNECTED',
  'error.E_NO_PIECES',
  'error.E_INSUFFICIENT_RESOURCES',
  'error.E_BANK_EMPTY',
  'error.E_DECK_EMPTY',
  'error.E_ILLEGAL_TARGET',
  'error.E_INVALID_HARBOR_RATE',
  'error.E_CARD_NOT_HELD',
  'error.E_CARD_JUST_BOUGHT',
  'error.E_CARD_ALREADY_PLAYED',
  'error.E_NO_ELIGIBLE_VICTIM',
  'error.E_ROBBER_SAME_HEX',
  'error.E_INVALID_DISCARD_COUNT',
  'error.E_INVALID_SELECTION',
  'error.E_UNKNOWN_OFFER',
  'error.E_OFFER_CLOSED',
  'error.E_NOT_RECIPIENT',
  'error.E_NOT_CONSENTED',
  'error.E_GAME_OVER',
  'error.E_UNSUPPORTED',
  'error.E_INVALID_COMMAND',
  'error.E_STALE_REVISION',
  'error.E_COMMAND_ID_REUSED',
  'error.E_NETWORK',
];

export const REQUIRED_MESSAGE_IDS: readonly string[] = [
  ...EVENT_MESSAGE_IDS,
  ...ERROR_MESSAGE_IDS,
];
