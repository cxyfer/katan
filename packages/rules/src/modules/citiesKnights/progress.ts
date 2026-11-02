/**
 * Progress cards (CK25 pp. 6, 10): the three decks, drawing, the face-up
 * victory-point cards and the hand limit. Playing a card's effect is not part
 * of this phase (P3): cards are held and can be discarded, never played.
 *
 * - A city-gate result lets every player whose range on that track contains
 *   the red die draw the top card of that deck, in turn order from the
 *   current player, while the deck lasts (CK-FAQ: shortage).
 * - Printing and Constitution are placed face up at once (1 VP each), even off
 *   turn; they are not in the hand and not in the hand limit.
 * - Hand limit 4: a player not on turn discards down to 4 at once (before
 *   production); the player on turn has until the end of their action phase.
 *   All draws of one event happen first, then the discards are collected
 *   together (explicit interpretation, docs/FIDELITY.md).
 * - Discarded cards go face down under their deck. The deck order is
 *   server-only; clients see counts.
 */

import { playerById } from '../../analysis.ts';
import { insertPendingNext } from '../../pending.ts';
import { shuffle } from '../../rng.ts';
import type { CommandOutcome, GameState, ModulePending, ProgressCardType } from '../../types.ts';
import type { ModuleCommand, ModuleContext } from '../types.ts';
import {
  CITIES_KNIGHTS,
  PROGRESS_DECKS,
  PROGRESS_HAND_LIMIT,
  TRACKS,
  VP_PROGRESS_CARDS,
  drawThreshold,
  trackOfCard,
  type Track,
} from './constants.ts';
import { ckState, ckView, turnOrder } from './state.ts';

export const PROGRESS_DISCARD_FRAME = 'citiesKnights.progressDiscard' as const;

/** Shuffles the three decks into `state.progressDecks` (top = index 0). */
export function initProgressDecks(state: GameState, ctx: ModuleContext): void {
  for (const track of TRACKS) state.progressDecks[track] = shuffle(PROGRESS_DECKS[track], ctx.rng);
}

/**
 * Draws the top card of a deck for a player. A VP card is revealed at once;
 * any other card goes into the private hand. Returns false when the deck is
 * empty.
 */
export function drawProgressCard(state: GameState, playerId: string, track: Track, ctx: ModuleContext, cause: 'event' | 'defense'): boolean {
  const card = state.progressDecks[track].shift();
  if (!card) {
    ctx.kit.emit(state, 'ck.progressDeckEmpty', { playerId, track });
    return false;
  }
  const player = playerById(state, playerId)!;
  if (VP_PROGRESS_CARDS.includes(card)) {
    const slot = ckState(state);
    slot.progressVp[playerId] = [...(slot.progressVp[playerId] ?? []), card];
    ctx.kit.emit(state, 'ck.progressVictoryPoint', { playerId, track, card, cause });
    return true;
  }
  player.progressCards.push(card);
  ctx.kit.emit(state, 'ck.progressDrawn', { playerId, track, cause }, { to: [playerId], params: { card } });
  return true;
}

/** Event-die draws for a city-gate result (CK25 p. 6). */
export function resolveProgressEvent(state: GameState, track: Track, red: number, ctx: ModuleContext): void {
  for (const playerId of turnOrder(state)) {
    const level = playerById(state, playerId)!.improvements[track];
    if (red > drawThreshold(level)) continue;
    if (!drawProgressCard(state, playerId, track, ctx, 'event')) break;
  }
}

/** Players not on turn who hold more than the limit and must discard now. */
export function overLimitOffTurn(state: GameState): string[] {
  const actor = state.players[state.turn.seat]!.id;
  return turnOrder(state).filter((id) => id !== actor && playerById(state, id)!.progressCards.length > PROGRESS_HAND_LIMIT);
}

/**
 * Queues the off-turn discards right behind the active frame (or makes them
 * active), ahead of the roll's continuation.
 */
export function queueProgressDiscards(state: GameState, ctx: ModuleContext, next = false): boolean {
  const responders = overLimitOffTurn(state);
  if (responders.length === 0) return false;
  const required = Object.fromEntries(responders.map((id) => [id, playerById(state, id)!.progressCards.length - PROGRESS_HAND_LIMIT]));
  const frame: ModulePending = { kind: PROGRESS_DISCARD_FRAME, module: CITIES_KNIGHTS, responders, data: { required } };
  ctx.kit.emit(state, 'ck.progressDiscardRequired', { required });
  if (next) insertPendingNext(state, frame);
  else ctx.kit.enqueuePending(state, frame);
  return true;
}

/**
 * `progress.discard { cards }` — discard down to the limit: off turn while
 * the discard frame asks for it, or on one's own turn in the action phase.
 */
export function discardProgress(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const player = playerById(state, actorId)!;
  const cards = command.cards;
  const frame = state.pending as ModulePending | null;
  let required: number;
  if (frame && frame.kind === PROGRESS_DISCARD_FRAME) {
    if (!frame.responders.includes(actorId)) return kit.fail('E_NOT_ACTOR');
    required = (frame.data.required as Record<string, number>)[actorId] ?? 0;
  } else if (frame) {
    return kit.fail('E_PENDING_EFFECT', { pending: frame.kind });
  } else {
    if (kit.currentPlayer(state).id !== actorId) return kit.fail('E_NOT_YOUR_TURN');
    if (state.turn.phase !== 'action') return kit.fail('E_WRONG_PHASE', { phase: state.turn.phase });
    required = player.progressCards.length - PROGRESS_HAND_LIMIT;
    // A card may only be given up to meet the limit (CK-FAQ: no voluntary discard).
    if (required <= 0) return kit.fail('E_PROGRESS_WITHIN_LIMIT');
  }
  if (!Array.isArray(cards) || cards.length !== required) return kit.fail('E_INVALID_DISCARD_COUNT', { required });
  const hand = player.progressCards.slice();
  for (const card of cards) {
    const index = hand.indexOf(card as ProgressCardType);
    if (index < 0) return kit.fail('E_CARD_NOT_HELD', { card });
    hand.splice(index, 1);
  }
  player.progressCards = hand;
  const tracks: Track[] = [];
  for (const card of cards as ProgressCardType[]) {
    const track = trackOfCard(card);
    state.progressDecks[track].push(card);
    tracks.push(track);
  }
  // The deck backs are public, the card faces are not.
  kit.emit(state, 'ck.progressDiscarded', { playerId: actorId, tracks }, { to: [actorId], params: { cards: cards.slice() } });
  if (frame && frame.kind === PROGRESS_DISCARD_FRAME) {
    frame.responders = frame.responders.filter((id) => id !== actorId);
    if (frame.responders.length === 0) kit.completePending(state, ctx.rng);
  }
  return kit.accept(state);
}

/** The player on turn must meet the limit before ending the action phase. */
export function progressLimitVeto(state: GameState, actorId: string, ctx: ModuleContext): CommandOutcome | null {
  const player = playerById(state, actorId)!;
  if (player.progressCards.length <= PROGRESS_HAND_LIMIT) return null;
  return ctx.kit.fail('E_PROGRESS_HAND_LIMIT', { limit: PROGRESS_HAND_LIMIT, held: player.progressCards.length });
}

/** Face-up VP cards of a player. */
export function progressVpOf(state: GameState, playerId: string): number {
  return ckView(state).progressVp[playerId]?.length ?? 0;
}
