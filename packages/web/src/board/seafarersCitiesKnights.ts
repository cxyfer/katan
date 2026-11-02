/**
 * Typed access to the Seafarers + Cities & Knights combination layer
 * (`GameView.modules.seafarersCitiesKnights`, `ActionHints.modules.
 * seafarersCitiesKnights`). Only the combined profiles have it, so every
 * helper returns `null` / leaves its input unchanged elsewhere.
 */

import type { GameView } from '@catan/rules';

export interface SeafarersCitiesKnightsHints {
  /** The pirate (like the robber) is in play from the first barbarian attack. */
  pirateActive: boolean;
  /** Own knights that may chase the pirate now (COMB-6). */
  pirateChase: number[];
  /** Which bandit the viewer's pending move may take, if any. */
  bandit: 'robber' | 'pirate' | 'either' | null;
}

export function seafarersCitiesKnightsHints(view: Pick<GameView, 'hints'> | null | undefined): SeafarersCitiesKnightsHints | null {
  const slot = view?.hints?.modules?.seafarersCitiesKnights as Partial<SeafarersCitiesKnightsHints> | undefined;
  if (!slot) return null;
  return { pirateActive: !!slot.pirateActive, pirateChase: slot.pirateChase ?? [], bandit: slot.bandit ?? null };
}

/** Whether the pirate is in play; `null` outside the combined profiles. */
export function pirateActive(view: Pick<GameView, 'modules'> | null | undefined): boolean | null {
  const slot = view?.modules?.seafarersCitiesKnights as { pirateActive?: boolean } | undefined;
  return slot ? !!slot.pirateActive : null;
}

/**
 * Narrows the Seafarers bandit targets to the bandit the combined rules let
 * the viewer move: a knight chasing the robber moves the robber only, one
 * chasing the pirate the pirate only (COMB-6), and the pirate waits for the
 * first attack (COMB-10).
 */
export function banditTargets(
  view: Pick<GameView, 'hints'> | null | undefined,
  robber: readonly number[],
  pirate: readonly (number | null)[],
): { robber: number[]; pirate: (number | null)[] } {
  const combined = seafarersCitiesKnightsHints(view);
  if (!combined) return { robber: robber.slice(), pirate: pirate.slice() };
  const bandit = combined.bandit ?? (combined.pirateActive ? 'either' : 'robber');
  return {
    robber: bandit === 'pirate' ? [] : robber.slice(),
    pirate: bandit === 'robber' || !combined.pirateActive ? [] : pirate.slice(),
  };
}
