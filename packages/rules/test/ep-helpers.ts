/** Helpers for the Explorers & Pirates (CN3085) fixtures. */

import { createGame } from '../src/engine.ts';
import type { EpScenarioId } from '../src/explorers-pirates-boards.ts';
import { epState } from '../src/modules/explorersPirates/state.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import type { GameState } from '../src/types.ts';
import { COLORS, playerIds } from './helpers.ts';

export const EP_PROFILE: Record<EpScenarioId, string> = {
  'land-ho': 'ep-land-ho-2025',
  'pirate-lairs': 'ep-pirate-lairs-2025',
  fish: 'ep-fish-2025',
  spices: 'ep-spices-2025',
  'explorers-pirates': 'ep-full-2025',
};

export function epGame(scenario: EpScenarioId, players: 3 | 4 = 4, seed = 12345): { state: GameState; rng: Rng } {
  const rng = seededRng(seed);
  const fixed = scenario === 'land-ho' || scenario === 'pirate-lairs';
  const state = createGame({
    profileId: EP_PROFILE[scenario],
    players: playerIds(players).map((id, index) => ({ id, nickname: id.toUpperCase(), color: COLORS[index]! })),
    setupMode: fixed ? 'fixed' : 'variable',
    rng,
  });
  return { state, rng };
}

export { epState };
