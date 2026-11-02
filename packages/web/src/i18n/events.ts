/**
 * Renders a rule event (`GameEvent`) into localised text.
 *
 * The event `type` is the message id and `params` are canonical values; this
 * module only decides how canonical values become readable fragments. It never
 * invents information: a parameter the viewer did not receive stays absent.
 */

import type { Locale } from '@catan/protocol';
import type { GameEvent } from '@catan/rules';
import { t } from './index.ts';
import { formatDice, formatGrantMap, formatResourceMap } from './format.ts';
import { moduleEventParams } from './modules/events.ts';

export interface EventText {
  messageId: string;
  params: Record<string, unknown>;
  text: string;
  /** True when the id is not part of the catalogued event set. */
  unknown: boolean;
}

export type NameResolver = (playerId: string) => string;

function str(value: unknown, fallback = '—'): string {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'string' ? value : String(value);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Builds the display parameters for one event. Parameters are canonical
 * (ids, numbers, maps); formatting into a sentence is `t`'s job.
 */
export function eventParams(
  locale: Locale,
  event: GameEvent,
  nameOf: NameResolver,
): Record<string, unknown> {
  const p = event.params ?? {};
  const player = () => nameOf(str(p.playerId, ''));

  switch (event.type) {
    case 'game.created':
      return {
        playerCount: Array.isArray(p.playerIds) ? p.playerIds.length : 0,
        playerIds: Array.isArray(p.playerIds) ? (p.playerIds as string[]).join('、') : '—',
        profileId: str(p.profileId),
        setupMode: str(p.setupMode),
      };
    case 'setup.building':
      return {
        player: player(),
        vertex: num(p.vertex),
        roundSuffix: num(p.round) === 2 ? '2/2 ' : '1/2 ',
      };
    case 'setup.road':
      return { player: player(), edge: num(p.edge) };
    case 'setup.startingResources':
      return {
        player: player(),
        resources: formatResourceMap(locale, p.resources as Record<string, number>),
      };
    case 'turn.started':
      return { player: player() };
    case 'turn.rolled':
      return {
        player: player(),
        dice: formatDice(p.dice as number[]),
        total: num(p.total),
      };
    case 'turn.ended':
      return { player: player() };
    case 'production.resolved':
      return {
        total: num(p.total),
        grants: formatGrantMap(
          locale,
          p.grants as Record<string, Partial<Record<string, number>>>,
          nameOf,
        ),
      };
    case 'production.starved':
      return {
        hex: num(p.hex),
        resource: t(locale, `resource.${str(p.resource, 'lumber')}`),
        total: num(p.total),
      };
    case 'discard.required': {
      const required = (p.required ?? {}) as Record<string, number>;
      const parts = Object.keys(required).map((id) => `${nameOf(id)} ${required[id]}`);
      return { required: parts.length > 0 ? parts.join('、') : '—' };
    }
    case 'discard.submitted':
      return { player: player(), count: num(p.count) };
    case 'robber.moveRequired':
      return { player: player(), cause: str(p.cause) };
    case 'robber.moved':
      return { player: player(), hex: num(p.hex), cause: str(p.cause) };
    case 'robber.stole':
      return {
        player: player(),
        victim: nameOf(str(p.victim, '')),
        resourceSuffix:
          p.resource === undefined
            ? ''
            : `（${t(locale, `resource.${str(p.resource)}`)}）`,
      };
    case 'build.road':
      return {
        player: player(),
        edge: num(p.edge),
        freeSuffix: p.free ? '（免費）' : '',
      };
    case 'build.settlement':
      return { player: player(), vertex: num(p.vertex) };
    case 'build.city':
      return { player: player(), vertex: num(p.vertex) };
    case 'build.devCard':
      return {
        player: player(),
        remaining: num(p.remaining),
        cardSuffix:
          p.card === undefined ? '' : `（${t(locale, `devCard.${str(p.card)}`)}）`,
      };
    case 'dev.knight':
      return {
        player: player(),
        hex: num(p.hex),
        playedKnights: num(p.playedKnights),
      };
    case 'dev.roadBuilding':
    case 'dev.yearOfPlenty':
      return { player: player() };
    case 'dev.roadBuildingFinished':
      return { player: player(), placed: num(p.placed) };
    case 'dev.yearOfPlentyPick':
      return { player: player(), resource: t(locale, `resource.${str(p.resource)}`) };
    case 'dev.monopoly':
      return {
        player: player(),
        resource: t(locale, `resource.${str(p.resource)}`),
        taken: formatResourceMap(locale, p.taken as Record<string, number>),
      };
    case 'trade.offered':
      return {
        from: nameOf(str(p.from, '')),
        to: p.to === 'all' ? t(locale, 'play.tradeToAll') : nameOf(str(p.to, '')),
        give: formatResourceMap(locale, p.give as Record<string, number>),
        want: formatResourceMap(locale, p.want as Record<string, number>),
      };
    case 'trade.responded':
      return {
        player: player(),
        response: t(locale, `play.tradeResponse.${str(p.response, 'declined')}`),
      };
    case 'trade.revised':
      return {
        revision: num(p.revision),
        give: formatResourceMap(locale, p.give as Record<string, number>),
        want: formatResourceMap(locale, p.want as Record<string, number>),
      };
    case 'trade.withdrawn':
      return {};
    case 'trade.expired':
      return { reason: str(p.reason) };
    case 'trade.bank':
      return {
        player: player(),
        rate: num(p.rate),
        give: t(locale, `resource.${str(p.give)}`),
        receive: t(locale, `resource.${str(p.receive)}`),
      };
    case 'trade.completed':
      return {
        from: nameOf(str(p.from, '')),
        to: nameOf(str(p.to, '')),
        give: formatResourceMap(locale, p.give as Record<string, number>),
        want: formatResourceMap(locale, p.want as Record<string, number>),
      };
    case 'game.abandoned':
      return { reason: t(locale, `play.resultReason.${str(p.reason, 'abandoned')}`) };
    case 'game.finished':
      return {
        player: player(),
        score: num(p.score),
        target: num(p.target),
      };
    default:
      // Module events format their own parameters; an id nobody knows how to
      // parameterise still renders its own text.
      return moduleEventParams(locale, event, nameOf) ?? {};
  }
}

export function translateEvent(locale: Locale, event: GameEvent, nameOf: NameResolver): EventText {
  const params = eventParams(locale, event, nameOf);
  // Canonical id shape from `@catan/protocol`: `event.<engine event type>`.
  // A pirate action reuses a robber event with `pirate: true` and its own
  // text; a ship reuses a road event with `ship: true` the same way.
  const base = `event.${event.type}`;
  const variant = event.params?.pirate === true ? `${base}.pirate` : event.params?.ship === true ? `${base}.ship` : null;
  const messageId = variant && t(locale, variant) !== variant ? variant : base;
  const text = t(locale, messageId, params);
  return {
    messageId,
    params,
    text: text === messageId ? event.type : text,
    unknown: text === messageId,
  };
}

/** Renders a localisable `Notice` (message id + params) from the server. */
export function translateNotice(
  locale: Locale,
  notice: { messageId: string; params?: Record<string, unknown> } | null | undefined,
): string {
  if (!notice) return '';
  const text = t(locale, notice.messageId, notice.params);
  if (text !== notice.messageId) return text;
  const code = notice.messageId.startsWith('error.') ? notice.messageId.slice(6) : notice.messageId;
  return t(locale, 'error.unknown', { code });
}
