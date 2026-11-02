/**
 * Playing progress cards (CK25 pp. 6, 10, 13–16).
 *
 * `progress.play { card, … }` plays one card from the hand: Alchemy in the
 * player's own Roll Dice phase before rolling, every other card in their own
 * Action phase (also paired player 2's, CK56-25 p. 4), with nothing pending.
 * Any number of cards may be played. The card goes face down under its deck
 * and `ck.progressPlayed` names it publicly; a card without benefit still
 * counts as played, but a card whose effect names a target needs a legal one
 * (interpretation P3-1). VP cards are never in the hand (`progress.ts`).
 */

import { playerById } from '../../analysis.ts';
import type { CommandOutcome, GameState, ModulePending, ProgressCardType } from '../../types.ts';
import type { ModuleCommand, ModuleContext, ModuleViewContext } from '../types.ts';
import { spendCard, type BlockReason, type CardRule } from './card-common.ts';
import { POLITICS_RULES, projectPoliticsFrame } from './cards-politics.ts';
import { SCIENCE_RULES } from './cards-science.ts';
import { TRADE_RULES, harborTargets, projectTradeFrame } from './cards-trade.ts';
import { trackOfCard } from './constants.ts';

export const CARD_RULES: Partial<Record<ProgressCardType, CardRule>> = {
  ...SCIENCE_RULES,
  ...TRADE_RULES,
  ...POLITICS_RULES,
};

function timingBlock(state: GameState, playerId: string, rule: CardRule): BlockReason | null {
  if (state.players[state.turn.seat]?.id !== playerId) return 'not-your-turn';
  if (state.pending) return 'pending';
  if (rule.timing === 'preroll') return state.turn.phase === 'preroll' ? null : 'after-roll';
  return state.turn.phase === 'action' ? null : 'before-roll';
}

/** `progress.play { card, … }` */
export function playProgress(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const card = command.card as ProgressCardType;
  const rule = typeof card === 'string' ? CARD_RULES[card] : undefined;
  if (!rule) return kit.fail('E_INVALID_SELECTION', { card });
  if (kit.currentPlayer(state).id !== actorId) return kit.fail('E_NOT_YOUR_TURN');
  if (state.pending) return kit.fail('E_PENDING_EFFECT', { pending: state.pending.kind });
  const timing = timingBlock(state, actorId, rule);
  if (timing) return kit.fail('E_WRONG_PHASE', { phase: state.turn.phase, card });
  if (!playerById(state, actorId)!.progressCards.includes(card)) return kit.fail('E_CARD_NOT_HELD', { card });
  let spent = false;
  const outcome = rule.play(state, actorId, command, ctx, () => {
    if (spent) return;
    spent = true;
    spendCard(state, actorId, card, ctx);
  });
  if (outcome.ok && !spent) throw new Error(`progress card ${card} accepted without being played`);
  return outcome;
}

export interface ProgressCardHint {
  card: ProgressCardType;
  track: string;
  /** Copies of this card in the hand. */
  count: number;
  playable: boolean;
  reason: BlockReason | null;
  targets: Record<string, unknown>;
}

/** Playability and targets of each card in the viewer's hand (advisory). */
export function progressHints(state: GameState, playerId: string, view: ModuleViewContext): ProgressCardHint[] {
  const hand = playerById(state, playerId)!.progressCards;
  const kinds = [...new Set(hand)].sort();
  return kinds.map((card) => {
    const rule = CARD_RULES[card]!;
    const reason = timingBlock(state, playerId, rule) ?? rule.blocked?.(state, playerId, view) ?? null;
    const active = reason === null;
    return {
      card,
      track: trackOfCard(card),
      count: hand.filter((candidate) => candidate === card).length,
      playable: active,
      reason,
      targets: active && rule.targets ? rule.targets(state, playerId, view) : {},
    };
  });
}

/** Players the viewer may still make a Commercial Harbor offer to. */
export function harborHint(state: GameState, playerId: string): string[] {
  if (state.players[state.turn.seat]?.id !== playerId || state.pending || state.turn.phase !== 'action') return [];
  return harborTargets(state, playerId);
}

/** Viewer-filtered data of the card frames, or null for other frames. */
export function projectCardFrame(state: GameState, frame: ModulePending, viewerId: string): Record<string, unknown> | null {
  return projectTradeFrame(state, frame, viewerId) ?? projectPoliticsFrame(state, frame, viewerId);
}
