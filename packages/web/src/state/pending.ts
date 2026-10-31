/**
 * Required-action derivation (docs/SPEC.md §4.4, §8.4).
 *
 * "Your turn", "Your response required" and "Waiting for …" must be distinct,
 * persistent states. The engine owns who owes what; this module only decides
 * how that is labelled and whether it is *our* obligation.
 */

import { awaitingProjection, type TableState } from './table.ts';

export interface RequiredAction {
  kind: 'setup' | 'roll' | 'rolling' | 'syncing' | 'discard' | 'moveRobber' | 'steal' | 'yearOfPlenty' | 'freeRoads' | 'turn';
  /** Message id for the prompt headline. */
  messageId: string;
  params: Record<string, unknown>;
  /** True when the viewer personally owes this action. */
  mine: boolean;
  /** Player ids the table is waiting for. */
  waitingFor: string[];
}

function selfId(state: TableState): string | null {
  return state.session?.id ?? null;
}

/**
 * Resolves the single most important obligation for the viewer, or null when
 * the table is simply waiting for somebody else's ordinary turn.
 */
export function requiredActionFor(state: TableState): RequiredAction | null {
  const view = state.game?.view;
  if (!view) return null;
  const me = selfId(state);
  const nameOf = (id: string) =>
    view.players.find((player) => player.id === id)?.nickname ?? id;

  if (view.result) return null;

  // 擲骰演出期間，所有狀態顯示（提示、計分板、狀態列、朗讀）都只說「擲骰中」，
  // 不從擲骰後的投影透露棄牌、強盜等結果。
  if (state.dicePresenting) {
    return { kind: 'rolling', messageId: 'dice.rolling', params: {}, mine: false, waitingFor: [] };
  }
  // 事件先到而投影未追上：不依過時投影提示擲骰或其他義務。
  if (awaitingProjection(state)) {
    return { kind: 'syncing', messageId: 'play.syncing', params: {}, mine: false, waitingFor: [] };
  }

  const pending = view.pending;
  if (pending) {
    switch (pending.kind) {
      case 'discard': {
        const required = pending.required[me ?? ''] ?? 0;
        // `required` is who owed at effect start; `waitingFor` is the
        // authoritative outstanding set. Once I submit, I must drop the
        // selection prompt and see the remaining wait list instead
        // (docs/SPEC.md §4.4).
        const mine = required > 0 && me !== null && pending.waitingFor.includes(me);
        return {
          kind: 'discard',
          messageId: mine ? 'play.pending.discard' : 'play.pending.discardWaiting',
          params: mine ? { count: required } : {},
          mine,
          waitingFor: mine ? [] : pending.waitingFor,
        };
      }
      case 'moveRobber':
        return {
          kind: 'moveRobber',
          messageId: 'play.pending.moveRobber',
          params: {},
          mine: pending.actor === me,
          waitingFor: pending.actor === me ? [] : [pending.actor],
        };
      case 'steal':
        return {
          kind: 'steal',
          messageId: 'play.pending.steal',
          params: {},
          mine: pending.actor === me,
          waitingFor: pending.actor === me ? [] : [pending.actor],
        };
      case 'yearOfPlenty':
        return {
          kind: 'yearOfPlenty',
          messageId: 'play.pending.yearOfPlenty',
          params: { remaining: pending.remaining },
          mine: pending.actor === me,
          waitingFor: pending.actor === me ? [] : [pending.actor],
        };
      case 'freeRoads':
        return {
          kind: 'freeRoads',
          messageId: 'play.pending.freeRoads',
          params: { remaining: pending.remaining },
          mine: pending.actor === me,
          waitingFor: pending.actor === me ? [] : [pending.actor],
        };
      default:
        return null;
    }
  }

  const setup = view.turn.setup;
  if (setup) {
    const actorSeat = setup.seat;
    const actor = view.players.find((player) => player.seat === actorSeat);
    const actorId = actor?.id ?? null;
    return {
      kind: 'setup',
      messageId: setup.stage === 'building' ? 'play.build.settlement' : 'play.build.road',
      params: { remaining: setup.remaining },
      mine: actorId === me,
      waitingFor: actorId && actorId !== me ? [actorId] : [],
    };
  }

  if (view.turn.phase === 'preroll') {
    const mine = view.turn.playerId === me;
    return {
      kind: 'roll',
      messageId: 'play.roll',
      params: { player: nameOf(view.turn.playerId) },
      mine,
      waitingFor: mine ? [] : [view.turn.playerId],
    };
  }

  if (view.turn.playerId === me) {
    return {
      kind: 'turn',
      messageId: 'play.yourTurn',
      params: {},
      mine: true,
      waitingFor: [],
    };
  }

  return {
    kind: 'turn',
    messageId: 'play.waitingFor',
    params: { player: nameOf(view.turn.playerId) },
    mine: false,
    waitingFor: [view.turn.playerId],
  };
}

/**
 * Message id + params for the `aria-live` required-action announcement. The
 * action label is translated first so the announcement is a real sentence in
 * the active locale rather than a raw message id.
 */
export function requiredActionAnnouncement(
  action: RequiredAction | null,
  translate: (messageId: string, params?: Record<string, unknown>) => string,
): { messageId: string; params: Record<string, unknown> } | null {
  if (!action || !action.mine) return null;
  return {
    messageId: 'a11y.requiredAction',
    params: { action: translate(action.messageId, action.params) },
  };
}
