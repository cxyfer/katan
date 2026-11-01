/**
 * The T&B module's slot in `GameState.moduleState`. Each part owns one key;
 * everything here is server-side and reaches clients only through `project`.
 */

import { moduleStateOf, setModuleState } from '../state.ts';
import type { GameState } from '../../types.ts';
import { TB } from './part.ts';

export type TbSlot = Record<string, unknown>;

/** The whole T&B slot, created on first use. */
export function tbSlot(state: GameState): TbSlot {
  return moduleStateOf<TbSlot>(state, TB) ?? setModuleState<TbSlot>(state, TB, {});
}

/** One part's state, or `undefined` before `initGame` created it. */
export function partState<T>(state: GameState, key: string): T | undefined {
  return moduleStateOf<TbSlot>(state, TB)?.[key] as T | undefined;
}

/** A part's state; throws when the part was never initialised (a bug). */
export function requirePartState<T>(state: GameState, key: string): T {
  const value = partState<T>(state, key);
  if (value === undefined) throw new Error(`traders & barbarians state missing: ${key}`);
  return value;
}

export function setPartState<T>(state: GameState, key: string, value: T): T {
  tbSlot(state)[key] = value;
  return value;
}
