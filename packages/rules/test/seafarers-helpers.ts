/** Board helpers for the Seafarers (New Shores) fixtures. */

import { topologyOf } from '../src/analysis.ts';
import { createGame } from '../src/engine.ts';
import { getProfile } from '../src/profiles.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import { hexCenter, NEIGHBOR_DIRS } from '../src/topology.ts';
import type { GameState } from '../src/types.ts';
import { COLORS, forceTurn, playerIds } from './helpers.ts';

/** 預設是 New Shores；`profileId` 可改成其他只有 fixed 版圖的 Seafarers 劇本（3–4 人）。 */
export function seafarersGame(players: 3 | 4 | 5 | 6 = 4, seed = 12345, profileId?: string): { state: GameState; rng: Rng } {
  const rng = seededRng(seed);
  const id = profileId ?? (players <= 4 ? 'sf-new-shores-2025' : 'sf-new-shores-paired-2025');
  const state = createGame({
    profileId: id,
    players: playerIds(players).map((id, index) => ({ id, nickname: id.toUpperCase(), color: COLORS[index]! })),
    // 新世界只有隨機版圖（variable）；其餘 3–4 人劇本是固定版圖。
    setupMode: players <= 4 && getProfile(id)!.setupModes.includes('fixed') ? 'fixed' : 'variable',
    rng,
  });
  return { state, rng };
}

/** A New Shores game past setup with an empty board, the turn on `seat`. */
export function emptySeafarersGame(players: 3 | 4 | 5 | 6 = 4, seat = 0, phase: 'preroll' | 'action' = 'action', profileId?: string): GameState {
  const { state } = seafarersGame(players, 12345, profileId);
  forceTurn(state, seat, phase);
  state.windowId += 1;
  return state;
}

export function hex(state: GameState, q: number, r: number): number {
  const index = topologyOf(state).hexes.findIndex((cell) => cell.q === q && cell.r === r);
  if (index < 0) throw new Error(`no hex ${q},${r}`);
  return index;
}

/**
 * Corner `k` of a hex, at screen angle 30° + 60°·k (y down): 0 lower right,
 * 1 bottom, 2 lower left, 3 upper left, 4 top, 5 upper right.
 */
export function corner(state: GameState, q: number, r: number, k: number): number {
  const centre = hexCenter({ q, r });
  const angle = ((30 + 60 * k) * Math.PI) / 180;
  const x = centre.x + Math.cos(angle);
  const y = centre.y + Math.sin(angle);
  const index = topologyOf(state).vertices.findIndex((vertex) => Math.abs(vertex.x - x) < 1e-4 && Math.abs(vertex.y - y) < 1e-4);
  if (index < 0) throw new Error(`no corner ${k} on ${q},${r}`);
  return index;
}

/** The edge of a hex facing `NEIGHBOR_DIRS[side]` (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE). */
export function side(state: GameState, q: number, r: number, s: number): number {
  const dir = NEIGHBOR_DIRS[s]!;
  const a = hexCenter({ q, r });
  const b = hexCenter({ q: q + dir.q, r: r + dir.r });
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;
  const index = topologyOf(state).edges.findIndex((edge) => Math.abs(edge.x - x) < 1e-4 && Math.abs(edge.y - y) < 1e-4);
  if (index < 0) throw new Error(`no side ${s} on ${q},${r}`);
  return index;
}

export function ship(state: GameState, playerId: string, edge: number): void {
  state.board.roads[edge] = { player: playerId, ship: true };
}

export function road(state: GameState, playerId: string, edge: number): void {
  state.board.roads[edge] = { player: playerId, ship: false };
}

export function settle(state: GameState, playerId: string, vertex: number, city = false): void {
  state.board.buildings[vertex] = { player: playerId, city };
}

export function totalSupply(state: GameState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const resource of Object.keys(state.bank)) {
    out[resource] = state.bank[resource as keyof typeof state.bank] +
      state.players.reduce((sum, player) => sum + player.resources[resource as keyof typeof player.resources], 0);
  }
  return out;
}
