/** Engine-backed fixtures for Traders & Barbarians UI tests. */

import { vi } from 'vitest';
import { actionHints, createGame, moduleStateOf, projectGame, seededRng, type GameState } from '@catan/rules';
import { initialTableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeSnapshot } from '../src/test/fixtures.ts';

const COLORS = ['red', 'blue', 'orange', 'white'] as const;

/** A T&B game forced into p1's action phase (setup skipped). */
export function tbState(profileId: string, players = 4, seed = 3): GameState {
  const state = createGame({
    profileId,
    players: Array.from({ length: players }, (_, index) => ({ id: `p${index + 1}`, nickname: `P${index + 1}`, color: COLORS[index]! })),
    setupMode: 'variable',
    rng: seededRng(seed),
  });
  state.turn.setup = null;
  state.turn.phase = 'action';
  state.turn.seat = 0;
  return state;
}

export function tbSlot<T>(state: GameState, part: string): T {
  return (moduleStateOf<Record<string, unknown>>(state, 'tradersBarbarians')![part]) as T;
}

/** A controller whose table shows `state` from `viewer`'s seat. */
export function tbController(state: GameState, viewer = 'p1'): TableController {
  const table = initialTableState('en');
  const view = projectGame(state, viewer, { hints: actionHints(state, viewer) });
  table.game = makeSnapshot(view);
  table.session = { id: viewer, nickname: viewer, locale: 'en', createdAt: '2026-11-01T00:00:00.000Z' };
  return {
    state: table,
    dispatch: vi.fn(),
    actions: { submitCommand: vi.fn(async () => {}), selectTarget: vi.fn(), clearCommand: vi.fn() },
  } as unknown as TableController;
}
