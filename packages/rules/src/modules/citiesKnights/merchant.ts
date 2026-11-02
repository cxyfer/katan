/**
 * The merchant piece (CK25 pp. 7, 14; CK-FAQ 58–62).
 *
 * - A Merchant card places it on a land hex next to one of the player's
 *   buildings; the player controls it until another Merchant card is played.
 *   The current hex is a legal destination, so a player can take control of
 *   a merchant standing next to their own building (interpretation P3-5).
 * - Its controller trades the hex's resource (not commodities) 2:1 with the
 *   supply, also for commodities, from the turn it is placed; the robber on
 *   the same hex does not matter. On the desert it gives no rate.
 * - Control is worth 1 VP. CK25 gives the merchant no production or blocking
 *   effect and no other way to leave the board.
 */

import { isLandHex, topologyOf } from '../../analysis.ts';
import { verticesOfHex } from '../../topology.ts';
import { TERRAIN_RESOURCE, type CardKind, type GameState, type Resource } from '../../types.ts';
import { ckView } from './state.ts';

export const MERCHANT_VP = 1;

/** Land hexes next to one of the player's buildings. */
export function merchantHexes(state: GameState, playerId: string): number[] {
  const topo = topologyOf(state);
  const out: number[] = [];
  for (let hex = 0; hex < topo.hexes.length; hex++) {
    if (!isLandHex(state, hex)) continue;
    if (verticesOfHex(topo, hex).some((vertex) => state.board.buildings[vertex]?.player === playerId)) out.push(hex);
  }
  return out;
}

/** The resource the merchant's controller trades at 2:1, if any. */
export function merchantResource(state: GameState, playerId: string): Resource | null {
  const merchant = ckView(state).merchant;
  if (!merchant || merchant.player !== playerId) return null;
  return TERRAIN_RESOURCE[state.board.layout.terrain[merchant.hex]!] ?? null;
}

export function merchantVp(state: GameState, playerId: string): number {
  return ckView(state).merchant?.player === playerId ? MERCHANT_VP : 0;
}

/** Card kinds the player gives at 2:1 this window (merchant and Merchant Fleet). */
export function twoForOneKinds(state: GameState, playerId: string): CardKind[] {
  const view = ckView(state);
  const out = new Set<CardKind>();
  const resource = merchantResource(state, playerId);
  if (resource) out.add(resource);
  for (const fleet of view.fleets ?? []) {
    if (fleet.player === playerId && fleet.windowId === state.windowId) out.add(fleet.kind);
  }
  return [...out];
}
