/**
 * The three dice and the roll's resolution order (CK25 p. 6, CK56-25 p. 3).
 *
 * `turn.dice` holds the two production dice as [yellow, red]; the event die
 * and the red die are also kept in `roll.extra` and in the module state for
 * the table. The event die is resolved first:
 *
 * 1. ship → the barbarians advance and may attack (pillage choices or tied
 *    defenders' draws become pending frames);
 *    city gate → progress cards are drawn, then off-turn players over the
 *    hand limit discard;
 * 2. then a continuation frame resolves production or the 7 through the
 *    engine (`kit.resolveRollOutcome`), followed by the science ability.
 *
 * When the event needs no answer, the roll continues without a frame.
 */

import type { GameState, ModulePending } from '../../types.ts';
import type { ModuleContext, RollResult } from '../types.ts';
import { advanceBarbarians } from './barbarians.ts';
import { CITIES_KNIGHTS, EVENT_FACES, type EventFace } from './constants.ts';
import { queueProgressDiscards, resolveProgressEvent } from './progress.ts';
import { ckState } from './state.ts';

export const RESOLVE_ROLL_FRAME = 'citiesKnights.resolveRoll' as const;

export function rollDice(state: GameState, ctx: ModuleContext): RollResult {
  const slot = ckState(state);
  // Alchemy sets both production dice; the event die is still rolled (CK25 p. 13).
  const alchemy = slot.alchemy && slot.alchemy.windowId === state.windowId ? slot.alchemy.dice : null;
  const yellow = alchemy ? alchemy[0] : ctx.rng.int(6) + 1;
  const red = alchemy ? alchemy[1] : ctx.rng.int(6) + 1;
  const event = EVENT_FACES[ctx.rng.int(EVENT_FACES.length)]!;
  if (alchemy) slot.alchemy = null;
  slot.lastRoll = { event, red, atSeq: state.seq + 1, ...(alchemy ? { alchemy: true } : {}) };
  return { dice: [yellow, red], total: yellow + red, extra: alchemy ? { event, red, alchemy: true } : { event, red } };
}

export function eventOf(roll: RollResult): { event: EventFace; red: number } {
  return { event: roll.extra?.event as EventFace, red: roll.extra?.red as number };
}

export function beforeProduction(state: GameState, roll: RollResult, ctx: ModuleContext): 'continue' | 'defer' {
  const { event, red } = eventOf(roll);
  ctx.kit.emit(state, 'ck.eventRolled', { event, red });
  if (event === 'ship') {
    advanceBarbarians(state, ctx);
  } else {
    resolveProgressEvent(state, event, red, ctx);
    // A VP card drawn by the roller can end the game: no discards after that.
    if (!state.result) queueProgressDiscards(state, ctx);
  }
  // A Defender or Printing/Constitution VP can end the game during the roll (CK25 p. 10).
  if (state.result) return 'defer';
  if (!state.pending) return 'continue';
  const frame: ModulePending = { kind: RESOLVE_ROLL_FRAME, module: CITIES_KNIGHTS, responders: [], data: { roll } };
  ctx.kit.enqueuePending(state, frame);
  return 'defer';
}

/** Continuation: production or the 7 now that the event is settled. */
export function resumeRoll(state: GameState, frame: ModulePending, ctx: ModuleContext): void {
  ctx.kit.resolveRollOutcome(state, frame.data.roll as RollResult, ctx.rng);
}
