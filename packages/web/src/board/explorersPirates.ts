/**
 * Typed access to the Explorers & Pirates module's public view and advisory
 * hints (`GameView.modules.explorersPirates`, `ActionHints.modules.explorersPirates`).
 * Other games have neither, so every helper returns `null` there.
 */

import type { ExplorersPiratesHints, ExplorersPiratesView, GameView, Resource } from '@catan/rules';
import { EP_COSTS } from '@catan/rules';

export type EpView = ExplorersPiratesView;
export type EpHints = ExplorersPiratesHints;
export type EpShipView = EpView['ships'][number];
export type EpShipHints = EpHints['ships'][number];

export const EP_FRAME = 'explorersPirates.pirate';

export function epView(view: Pick<GameView, 'modules'> | null | undefined): EpView | null {
  return (view?.modules?.explorersPirates as EpView | undefined) ?? null;
}

export function epHints(view: Pick<GameView, 'hints'> | null | undefined): EpHints | null {
  return (view?.hints?.modules?.explorersPirates as EpHints | undefined) ?? null;
}

export const EP_HARBOR_COST: Partial<Record<Resource, number>> = EP_COSTS.harbor;
export const EP_SHIP_COST: Partial<Record<Resource, number>> = EP_COSTS.ship;
export const EP_SETTLER_COST: Partial<Record<Resource, number>> = EP_COSTS.settler;
export const EP_CREW_COST: Partial<Record<Resource, number>> = EP_COSTS.crew;

/** Board commands whose edge target is an E&P ship. */
const SHIP_COMMANDS = new Set(['ep.buildShip', 'ep.setupShip', 'ep.moveShip']);

export function isEpShipCommand(commandType: string | null | undefined): boolean {
  return !!commandType && SHIP_COMMANDS.has(commandType);
}

/** Unexplored hexes by index → region. */
export function fogRegions(view: EpView | null): Map<number, 'parrot' | 'goose'> {
  return new Map((view?.fog ?? []).map((entry) => [entry.hex, entry.region]));
}

/** Ships sharing an edge sit side by side: the slot (0 or 1) of each ship on its edge. */
export function shipSlots(view: EpView | null): Map<string, { slot: number; of: number }> {
  const out = new Map<string, { slot: number; of: number }>();
  const byEdge = new Map<number, EpShipView[]>();
  for (const ship of view?.ships ?? []) byEdge.set(ship.edge, [...(byEdge.get(ship.edge) ?? []), ship]);
  for (const group of byEdge.values()) group.forEach((ship, slot) => out.set(ship.id, { slot, of: group.length }));
  return out;
}

/** Points a player has from E&P beyond the base score (harbour +1 each, mission tracks). */
export function epBonusPoints(view: EpView | null, playerId: string): number {
  const player = view?.players[playerId];
  if (!player) return 0;
  return player.harborPoints + Object.values(player.missionPoints).reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

/** Display order of a player's ships: ship ids are `s<n>`. */
export function shipNumber(view: EpView | null, id: string): number {
  const own = (view?.ships ?? []).filter((ship) => ship.player === view?.ships.find((candidate) => candidate.id === id)?.player);
  return own.findIndex((ship) => ship.id === id) + 1;
}
