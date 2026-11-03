/** Fixtures for the Seafarers + Cities & Knights (R-COMB) tests. */

import { createGame } from '../src/engine.ts';
import { ckState } from '../src/modules/citiesKnights/state.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import type { GameState } from '../src/types.ts';
import { COLORS, forceTurn, playerIds } from './helpers.ts';

export function sfckGame(players: 3 | 4 | 5 | 6 = 4, seed = 12345): { state: GameState; rng: Rng } {
  const rng = seededRng(seed);
  const state = createGame({
    profileId: players <= 4 ? 'sf-ck-new-shores-2025' : 'sf-ck-new-shores-paired-2025',
    players: playerIds(players).map((id, index) => ({ id, nickname: id.toUpperCase(), color: COLORS[index]! })),
    setupMode: players <= 4 ? 'fixed' : 'variable',
    rng,
  });
  return { state, rng };
}

/** A combined game past setup with an empty board, the turn on `seat`. */
export function emptySfckGame(players: 3 | 4 | 5 | 6 = 4, seat = 0, phase: 'preroll' | 'action' = 'action'): GameState {
  const { state } = sfckGame(players);
  forceTurn(state, seat, phase);
  state.windowId += 1;
  return state;
}

/** As after the first barbarian attack: the robber stands where the scenario puts it. */
export function afterFirstAttack(state: GameState): GameState {
  ckState(state).attacks = 1;
  state.board.robber = state.board.layout.robber;
  return state;
}
