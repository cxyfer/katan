/**
 * Typed access to the Seafarers module's public view and advisory hints
 * (`GameView.modules.seafarers`, `ActionHints.modules.seafarers`). Base games
 * have neither, so every helper returns `null` there.
 */

import type { GameView, Resource } from '@catan/rules';
import { isEpShipCommand } from './explorersPirates.ts';

export interface IslandClaimView {
  player: string;
  island: number;
  vertex: number;
}

export interface SeafarersModuleView {
  islandBonus: Record<string, number[]>;
  islandClaims: IslandClaimView[];
  shipsBuiltThisTurn: number[];
  shipMoved: boolean;
}

export interface SeafarersHints {
  legalShips: number[];
  setupShips: number[];
  movableShips: { edge: number; targets: number[] }[];
  shipMoved: boolean;
  pirateTargets: (number | null)[];
  robberTargets: number[];
  goldRequired: number;
}

export const SHIP_COST: Partial<Record<Resource, number>> = { lumber: 1, wool: 1 };

/** Points one island claim is worth (SF25 p. 4). */
export const ISLAND_BONUS_POINTS = 2;

/** Board commands whose edge target is a ship. */
const SHIP_COMMANDS = new Set(['build.ship', 'setup.placeShip', 'ship.move', 'ship.pick']);

export function isShipCommand(commandType: string | null | undefined): boolean {
  return !!commandType && (SHIP_COMMANDS.has(commandType) || isEpShipCommand(commandType));
}

export function seafarersView(view: Pick<GameView, 'modules'> | null | undefined): SeafarersModuleView | null {
  const slot = view?.modules?.seafarers as Partial<SeafarersModuleView> | undefined;
  if (!slot) return null;
  return {
    islandBonus: slot.islandBonus ?? {},
    islandClaims: slot.islandClaims ?? [],
    shipsBuiltThisTurn: slot.shipsBuiltThisTurn ?? [],
    shipMoved: !!slot.shipMoved,
  };
}

export function seafarersHints(view: Pick<GameView, 'hints'> | null | undefined): SeafarersHints | null {
  const slot = view?.hints?.modules?.seafarers as Partial<SeafarersHints> | undefined;
  if (!slot) return null;
  return {
    legalShips: slot.legalShips ?? [],
    setupShips: slot.setupShips ?? [],
    movableShips: slot.movableShips ?? [],
    shipMoved: !!slot.shipMoved,
    pirateTargets: slot.pirateTargets ?? [],
    robberTargets: slot.robberTargets ?? [],
    goldRequired: slot.goldRequired ?? 0,
  };
}

/** Island bonus points a player holds (public). */
export function islandBonusPoints(view: Pick<GameView, 'modules'> | null | undefined, playerId: string): number {
  return (seafarersView(view)?.islandBonus[playerId]?.length ?? 0) * ISLAND_BONUS_POINTS;
}
