/** Typed access to a rules module's slot in `GameState.moduleState`. */

import type { GameState } from '../types.ts';

export function moduleStateOf<T>(state: GameState, moduleId: string): T | undefined {
  return state.moduleState?.[moduleId] as T | undefined;
}

/** Writes the module's slot; the snapshot then carries it verbatim. */
export function setModuleState<T>(state: GameState, moduleId: string, value: T): T {
  state.moduleState = { ...(state.moduleState ?? {}), [moduleId]: value };
  return value;
}
