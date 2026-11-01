/**
 * Heading for New Shores island rules (SF25 p. 4):
 * - starting settlements go on the main island;
 * - each player earns 2 VP for their own first settlement on each small
 *   island, whether or not someone else settled there before. The bonus is
 *   kept (the tokens lie under that settlement) and is public.
 */

import { isLandHex, playerById, topologyOf } from '../../analysis.ts';
import { MAIN_ISLAND } from '../../seafarers-boards.ts';
import type { GameState } from '../../types.ts';
import type { ModuleContext, ModuleViewContext } from '../types.ts';
import { seafarersState } from './state.ts';

export const ISLAND_BONUS = 2;

/** Island ids of the land hexes around an intersection. */
export function islandsAt(state: GameState, vertex: number): number[] {
  const info = topologyOf(state).vertices[vertex];
  if (!info) return [];
  const out = new Set<number>();
  for (const hex of info.hexes) {
    if (!isLandHex(state, hex)) continue;
    const island = state.board.layout.islands[hex] ?? 0;
    if (island > 0) out.add(island);
  }
  return [...out].sort((a, b) => a - b);
}

function usesIslandRules(ctx: ModuleViewContext): boolean {
  return ctx.profile.scenario === 'new-shores';
}

/** Starting settlements only on the main island. */
export function allowBuilding(state: GameState, _playerId: string, vertex: number, options: { setup: boolean }, ctx: ModuleViewContext): boolean {
  if (!options.setup || !usesIslandRules(ctx)) return true;
  return islandsAt(state, vertex).includes(MAIN_ISLAND);
}

/** Awards the +2 VP for every new (player, small island) pair. */
export function claimIslands(state: GameState, ctx: ModuleContext): void {
  if (!usesIslandRules(ctx)) return;
  if (state.turn.phase === 'setup') return;
  const slot = seafarersState(state);
  state.board.buildings.forEach((building, vertex) => {
    if (!building) return;
    for (const island of islandsAt(state, vertex)) {
      if (island === MAIN_ISLAND) continue;
      const claimed = (slot.islands[building.player] ??= []);
      if (claimed.includes(island)) continue;
      claimed.push(island);
      (slot.claims ??= []).push({ player: building.player, island, vertex });
      playerById(state, building.player)!.bonusPoints += ISLAND_BONUS;
      ctx.kit.emit(state, 'island.bonus', { playerId: building.player, island, vertex, points: ISLAND_BONUS });
    }
  });
}
