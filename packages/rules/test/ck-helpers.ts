/** Fixtures for the Cities & Knights rules tests. */

import { applyCommand, createGame } from '../src/engine.ts';
import type { ModuleCommand } from '../src/modules/types.ts';
import { ckState, type Knight } from '../src/modules/citiesKnights/state.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import type { Commodity, GameState, ModulePending } from '../src/types.ts';
import { COLORS, CommandRejected, forceTurn, playerIds, type ActResult } from './helpers.ts';

export function ckGame(players: 3 | 4 | 5 | 6 = 4, seed = 12345): { state: GameState; rng: Rng } {
  const rng = seededRng(seed);
  const state = createGame({
    profileId: players <= 4 ? 'ck-2025' : 'ck-paired-2025',
    players: playerIds(players).map((id, index) => ({ id, nickname: id.toUpperCase(), color: COLORS[index]! })),
    setupMode: 'fixed',
    rng,
  });
  return { state, rng };
}

/** A C&K game past setup with an empty board, the turn on `seat`. */
export function emptyCkGame(players: 3 | 4 | 5 | 6 = 4, seat = 0, phase: 'preroll' | 'action' = 'action'): GameState {
  const { state } = ckGame(players);
  forceTurn(state, seat, phase);
  state.windowId += 1;
  return state;
}

export function actCk(state: GameState, actorId: string, command: ModuleCommand, rng: Rng = seededRng(1)): ActResult {
  const outcome = applyCommand(state, actorId, command, rng);
  if (!outcome.ok) throw new CommandRejected(outcome.error.code, outcome.error.params);
  return { state: outcome.state, events: outcome.events };
}

export function rejectCk(state: GameState, actorId: string, command: ModuleCommand, rng: Rng = seededRng(1)): string {
  const outcome = applyCommand(state, actorId, command, rng);
  if (outcome.ok) throw new Error(`expected a rejection for ${command.type}`);
  return outcome.error.code;
}

export function addKnight(state: GameState, knight: Knight): void {
  ckState(state).knights.push({ ...knight });
}

export function giveCommodities(state: GameState, playerId: string, commodities: Partial<Record<Commodity, number>>): void {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  for (const [commodity, amount] of Object.entries(commodities) as [Commodity, number][]) {
    player.commodities[commodity] += amount;
    state.commodityBank[commodity] -= amount;
  }
}

/**
 * Scripted rolls for `turn.roll`: yellow and red production dice (1–6) and
 * the event face index (0–2 ship, 3 science, 4 trade, 5 politics).
 */
export function rollRng(yellow: number, red: number, event: number, after: number[] = []): Rng {
  const values = [yellow - 1, red - 1, event, ...after];
  let cursor = 0;
  return {
    int(max: number): number {
      if (cursor >= values.length) return 0;
      const value = values[cursor++]!;
      if (value < 0 || value >= max) throw new Error(`scripted ${value} out of range for ${max}`);
      return value;
    },
  };
}

export const SHIP = 0;
export const SCIENCE = 3;
export const TRADE = 4;
export const POLITICS = 5;

export function moduleFrame(state: GameState): ModulePending | null {
  const frame = state.pending;
  return frame && 'module' in frame ? (frame as ModulePending) : null;
}
