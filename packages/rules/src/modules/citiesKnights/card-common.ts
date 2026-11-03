/**
 * Shared pieces of the progress-card effects (CK25 pp. 10, 13–16): the frame
 * kinds, the rule shape of one card and the "play" bookkeeping (the card
 * leaves the hand and goes face down under its deck).
 */

import { playerById, scoreOf } from '../../analysis.ts';
import type { CommandOutcome, GameState, ModulePending, ProgressCardType } from '../../types.ts';
import type { ModuleCommand, ModuleContext, ModuleViewContext } from '../types.ts';
import { CITIES_KNIGHTS, trackOfCard } from './constants.ts';

export const HARBOR_FRAME = 'citiesKnights.harborExchange' as const;
export const GUILD_DUES_FRAME = 'citiesKnights.guildDues' as const;
export const ESPIONAGE_FRAME = 'citiesKnights.espionage' as const;
export const SABOTAGE_FRAME = 'citiesKnights.sabotage' as const;
export const WEDDING_FRAME = 'citiesKnights.wedding' as const;
export const TREASON_REMOVE_FRAME = 'citiesKnights.treasonRemove' as const;
export const TREASON_PLACE_FRAME = 'citiesKnights.treasonPlace' as const;
export const DIPLOMACY_FRAME = 'citiesKnights.diplomacyRoad' as const;

/** Why a held card cannot be played right now (advisory, for the hand UI). */
export type BlockReason =
  | 'not-your-turn'
  | 'pending'
  | 'before-roll'
  | 'after-roll'
  | 'no-target'
  | 'cost'
  | 'robber-inactive'
  | 'alchemy-set';

export interface CardRule {
  /** `preroll` for Alchemy (before rolling), `action` for every other card. */
  timing: 'preroll' | 'action';
  /** Advisory targets for the hand UI; `blocked` reports a missing one. */
  targets?(state: GameState, playerId: string, view: ModuleViewContext): Record<string, unknown>;
  blocked?(state: GameState, playerId: string, view: ModuleViewContext): BlockReason | null;
  /**
   * Validates the command, calls `spend()` once it is legal and applies the
   * effect. A rejection after partial changes is safe: the engine discards
   * the working copy of the state.
   */
  play(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext, spend: () => void): CommandOutcome;
}

/** Takes the card out of the hand and puts it face down under its deck (CK25 p. 10). */
export function spendCard(state: GameState, actorId: string, card: ProgressCardType, ctx: ModuleContext): void {
  const player = playerById(state, actorId)!;
  player.progressCards.splice(player.progressCards.indexOf(card), 1);
  const track = trackOfCard(card);
  state.progressDecks[track].push(card);
  ctx.kit.emit(state, 'ck.progressPlayed', { playerId: actorId, card, track });
}

export function moduleFrame(kind: string, responders: string[], data: Record<string, unknown>): ModulePending {
  return { kind: kind as ModulePending['kind'], module: CITIES_KNIGHTS, responders, data };
}

/** The active frame when it is of `kind` and `actorId` must answer it. */
export function activeFrame(state: GameState, kind: string, actorId: string, ctx: ModuleContext): ModulePending | CommandOutcome {
  const frame = state.pending as ModulePending | null;
  if (!frame || frame.kind !== kind) return ctx.kit.fail('E_PENDING_EFFECT', { pending: frame?.kind ?? 'none' });
  if (!frame.responders.includes(actorId)) return ctx.kit.fail('E_NOT_ACTOR');
  return frame;
}

export function isOutcome(value: unknown): value is CommandOutcome {
  return typeof value === 'object' && value !== null && 'ok' in value;
}

/** Removes an answering player; finishes the frame when nobody is left. */
export function answered(state: GameState, frame: ModulePending, actorId: string, ctx: ModuleContext): void {
  frame.responders = frame.responders.filter((id) => id !== actorId);
  if (frame.responders.length === 0) ctx.kit.completePending(state, ctx.rng);
}

/** Public score; C&K has no hidden points (interpretation P3-9). */
export function publicScore(state: GameState, playerId: string): number {
  return scoreOf(state, playerId, { includeHidden: false });
}

export function otherPlayers(state: GameState, actorId: string): string[] {
  const count = state.players.length;
  const seat = playerById(state, actorId)!.seat;
  return Array.from({ length: count - 1 }, (_, offset) => state.players[(seat + offset + 1) % count]!.id);
}
