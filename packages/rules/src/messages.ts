/**
 * Stable rule message ids: every rejection and event the engine and its rules
 * modules can produce.
 *
 * These arrays are the single source of truth: the union types are derived
 * from them so clients can assert that their localisation catalogs cover all
 * of them. The base engine owns the `BASE_*` lists; each rules module owns the
 * lists in `modules/<id>/messages.ts`, and a test keeps every list exactly in
 * step with the `fail(...)` / `emit(...)` calls in its own sources.
 */

import { MODULE_MESSAGES } from './modules/messages.ts';

/**
 * Every rejection the base engine can actually produce. A test keeps it
 * exactly in step with the `fail(...)` calls in `engine.ts`.
 */
export const BASE_COMMAND_ERROR_CODES = [
  'E_NOT_YOUR_TURN',
  'E_NOT_ACTOR',
  'E_WRONG_PHASE',
  'E_PENDING_EFFECT',
  'E_NO_PIECES',
  'E_INSUFFICIENT_RESOURCES',
  'E_BANK_EMPTY',
  'E_DECK_EMPTY',
  'E_ILLEGAL_TARGET',
  'E_CARD_NOT_HELD',
  'E_CARD_JUST_BOUGHT',
  'E_CARD_ALREADY_PLAYED',
  'E_PAIRED_NO_DOMESTIC_TRADE',
  'E_NO_ELIGIBLE_VICTIM',
  'E_ROBBER_SAME_HEX',
  'E_INVALID_DISCARD_COUNT',
  'E_INVALID_SELECTION',
  'E_UNKNOWN_OFFER',
  'E_OFFER_CLOSED',
  'E_NOT_RECIPIENT',
  'E_NOT_CONSENTED',
  'E_GAME_OVER',
  'E_INVALID_COMMAND',
] as const;


/**
 * Every event the base engine emits. Kept in step with `emit(...)` by a test
 * that scans the engine source, so a new event cannot ship without a message id.
 */
export const BASE_RULE_EVENT_TYPES = [
  'game.created',
  'game.finished',
  'game.abandoned',
  'setup.building',
  'setup.road',
  'setup.startingResources',
  'turn.started',
  'turn.ended',
  'turn.rolled',
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
] as const;

export const COMMAND_ERROR_CODES = [
  ...BASE_COMMAND_ERROR_CODES,
  ...MODULE_MESSAGES.seafarers.errorCodes,
  ...MODULE_MESSAGES.citiesKnights.errorCodes,
  ...MODULE_MESSAGES.tradersBarbarians.errorCodes,
  ...MODULE_MESSAGES.explorersPirates.errorCodes,
  ...MODULE_MESSAGES.seafarersCitiesKnights.errorCodes,
] as const;

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

export const RULE_EVENT_TYPES = [
  ...BASE_RULE_EVENT_TYPES,
  ...MODULE_MESSAGES.seafarers.eventTypes,
  ...MODULE_MESSAGES.citiesKnights.eventTypes,
  ...MODULE_MESSAGES.tradersBarbarians.eventTypes,
  ...MODULE_MESSAGES.explorersPirates.eventTypes,
  ...MODULE_MESSAGES.seafarersCitiesKnights.eventTypes,
] as const;

export type RuleEventType = (typeof RULE_EVENT_TYPES)[number];
