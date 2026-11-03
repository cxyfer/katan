/**
 * Typed access to the Traders & Barbarians projection (`view.modules
 * .tradersBarbarians`) and hints. The rules package owns the shapes; the
 * client only reads them, so every field is optional and checked.
 */

import type { GameView } from '@catan/rules';

export type TbView = Record<string, unknown>;

export function tbView(view: GameView | null | undefined): TbView | null {
  const slot = view?.modules?.tradersBarbarians;
  return slot && typeof slot === 'object' ? (slot as TbView) : null;
}

/** One part's projection (`harbors`, `tb-fishing`, …). */
export function tbPart<T>(view: GameView | null | undefined, part: string): T | null {
  const slot = tbView(view)?.[part];
  return slot && typeof slot === 'object' ? (slot as T) : null;
}

/** One part's action hints for the viewer. */
export function tbHints<T>(view: GameView | null | undefined, part: string): T | null {
  const slot = (view?.hints?.modules?.tradersBarbarians as Record<string, unknown> | undefined)?.[part];
  return slot && typeof slot === 'object' ? (slot as T) : null;
}

export function isTradersBarbarians(view: GameView | null | undefined): boolean {
  return tbView(view) !== null || !!view?.profileId.startsWith('tb-');
}

export interface HarborsView {
  holder: string | null;
  portPoints: Record<string, number>;
  minimum: number;
}
