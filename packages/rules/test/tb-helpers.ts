/** Shared fixtures for the Traders & Barbarians rules tests (R-TB). */

import { createGame } from '../src/engine.ts';
import { seededRng } from '../src/rng.ts';
import type { GameState } from '../src/types.ts';
import { COLORS, forceTurn, playerIds, runSetup } from './helpers.ts';

export function tbCreate(profileId: string, options: { players?: number; seed?: number; mode?: 'fixed' | 'variable' } = {}): GameState {
  return createGame({
    profileId,
    players: playerIds(options.players ?? 4).map((id, index) => ({ id, nickname: id.toUpperCase(), color: COLORS[index]! })),
    setupMode: options.mode ?? 'variable',
    rng: seededRng(options.seed ?? 12345),
  });
}

/** A T&B game past setup with the turn forced onto a seat and phase. */
export function tbPlayable(
  profileId: string,
  options: { players?: number; seed?: number; mode?: 'fixed' | 'variable'; seat?: number; phase?: 'preroll' | 'action' } = {},
): GameState {
  const state = runSetup(tbCreate(profileId, options), seededRng(options.seed ?? 12345));
  forceTurn(state, options.seat ?? 0, options.phase ?? 'action');
  return state;
}

export function clearBoard(state: GameState): void {
  state.board.buildings = state.board.buildings.map(() => null);
  state.board.roads = state.board.roads.map(() => null);
}

/** Total of one resource across the bank and every hand (supply conservation). */
export function resourceTotal(state: GameState, resource: 'lumber' | 'brick' | 'wool' | 'grain' | 'ore'): number {
  return state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
}

/** Vitest timeout for whole simulated games (the 5 s default is too close under parallel load). */
export const SIMULATION_TIMEOUT = 30_000;
