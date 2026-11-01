/** Seafarers module state (`GameState.moduleState.seafarers`). */

import type { GameState } from '../../types.ts';
import { moduleStateOf, setModuleState } from '../state.ts';

export const SEAFARERS = 'seafarers';

export interface SeafarersState {
  /** Action window (`GameState.windowId`) that `built` and `moved` belong to. */
  window: number;
  /** Ships built in that window; they may not move in it (SF25 p. 2). */
  built: number[];
  /** Whether that window's one ship move has been used. */
  moved: boolean;
  /** Small islands each player has already received the +2 VP for. */
  islands: Record<string, number[]>;
}

export function initialSeafarersState(state: GameState): SeafarersState {
  return {
    window: state.windowId,
    built: [],
    moved: false,
    islands: Object.fromEntries(state.players.map((player) => [player.id, []])),
  };
}

/** The module slot, rolled over to the current action window. */
export function seafarersState(state: GameState): SeafarersState {
  const slot = moduleStateOf<SeafarersState>(state, SEAFARERS) ?? setModuleState(state, SEAFARERS, initialSeafarersState(state));
  if (slot.window !== state.windowId) {
    slot.window = state.windowId;
    slot.built = [];
    slot.moved = false;
  }
  return slot;
}

/** Read-only view for projections: stale windows read as empty. */
export function seafarersView(state: GameState): SeafarersState {
  const slot = moduleStateOf<SeafarersState>(state, SEAFARERS) ?? initialSeafarersState(state);
  if (slot.window === state.windowId) return slot;
  return { ...slot, window: state.windowId, built: [], moved: false };
}
