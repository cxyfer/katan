/** Shared Explorers & Pirates rules: supplies, coins, guards and mission tracks. */

import type { EpMission } from '../../explorers-pirates-boards.ts';
import { epScenario } from '../../explorers-pirates-boards.ts';
import type { CommandOutcome, GameState } from '../../types.ts';
import type { ModuleContext, RulesKit } from '../types.ts';
import { epState, epTurn, type Cargo, type EpTurn, type ExplorersPiratesState } from './state.ts';

/** Per-colour pieces (EP25 p. 2; CATAN: 5 settlements, 15 roads). */
export const EP_PIECES = { harbors: 4, ships: 3, settlers: 2, crews: 9, settlements: 5 } as const;
export const COIN_SUPPLY = 148;
export const FISH_HAULS = 6;
export const START_GOLD = 2;
export const BASE_MP = 4;
export const EXTRA_MP = 2;
/** Pirate lair numbers: not printed in CN3085 (open fixture, see FIDELITY). */
export const LAIR_TOKENS = [2, 3, 5, 6, 8, 11] as const;

/** VP printed next to each track space after the start (EP25 pp. 4, 13–14). */
export const TRACK_VALUES: Readonly<Record<EpMission, readonly number[]>> = {
  lairs: [1, 1, 2, 2, 2, 3, 3],
  fish: [1, 1, 2, 2, 2, 3, 3],
  spices: [1, 1, 2, 2, 3, 3],
};
/** Greatest Pirate Scourge / Best Fisher / Greatest Spice Merchant. */
export const TRACK_BONUS = 1;

export const COSTS = {
  harbor: { grain: 2, ore: 2 },
  ship: { lumber: 1, wool: 1 },
  settler: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  crew: { wool: 1, ore: 1 },
  extraMove: { wool: 1 },
} as const;

export function scenarioOf(state: GameState) {
  return epScenario(epState(state).scenario);
}

export function hasMission(state: GameState, mission: EpMission): boolean {
  return scenarioOf(state).missions.includes(mission);
}

// -- guards --------------------------------------------------------------------

/** The actor's own turn, after the roll, with nothing pending. */
export function requireTurn(state: GameState, actorId: string, kit: RulesKit): CommandOutcome | null {
  if (state.turn.phase === 'setup') return kit.fail('E_WRONG_PHASE', { phase: 'setup' });
  if (kit.currentPlayer(state).id !== actorId) return kit.fail('E_NOT_YOUR_TURN');
  if (state.turn.phase !== 'action') return kit.fail('E_WRONG_PHASE', { phase: state.turn.phase });
  if (state.pending) return kit.fail('E_PENDING_EFFECT', { pending: state.pending.kind });
  return null;
}

/** The actor's Action phase (trade and build). */
export function requireAction(state: GameState, actorId: string, kit: RulesKit): CommandOutcome | null {
  const guard = requireTurn(state, actorId, kit);
  if (guard) return guard;
  if (epTurn(state).phase !== 'action') return kit.fail('E_EP_MOVEMENT_PHASE');
  return null;
}

/** The actor's Movement phase. */
export function requireMovement(state: GameState, actorId: string, kit: RulesKit): CommandOutcome | null {
  const guard = requireTurn(state, actorId, kit);
  if (guard) return guard;
  if (epTurn(state).phase !== 'movement') return kit.fail('E_EP_ACTION_PHASE');
  return null;
}

export function requirePirates(state: GameState, kit: RulesKit): CommandOutcome | null {
  return scenarioOf(state).pirates ? null : kit.fail('E_EP_NOT_IN_SCENARIO');
}

// -- coins -----------------------------------------------------------------------

export function goldOf(slot: ExplorersPiratesState, playerId: string): number {
  return slot.gold[playerId] ?? 0;
}

/** Takes up to `amount` coins from the supply; returns what was paid. */
export function gainGold(slot: ExplorersPiratesState, playerId: string, amount: number): number {
  const paid = Math.max(0, Math.min(amount, slot.goldSupply));
  slot.goldSupply -= paid;
  slot.gold[playerId] = goldOf(slot, playerId) + paid;
  return paid;
}

export function payGold(slot: ExplorersPiratesState, playerId: string, amount: number): void {
  slot.gold[playerId] = goldOf(slot, playerId) - amount;
  slot.goldSupply += amount;
}

// -- supplies ---------------------------------------------------------------------

export function piecesInPlay(state: GameState, playerId: string, piece: Cargo): number {
  const slot = epState(state);
  let count = 0;
  for (const holder of [...slot.ships, ...slot.harbors]) {
    if (holder.player === playerId) count += holder.cargo.filter((cargo) => cargo === piece).length;
  }
  if (piece === 'crew') {
    for (const site of slot.sites) {
      if (site.kind === 'lair' || site.kind === 'spice') count += site.crews.filter((id) => id === playerId).length;
    }
  }
  return count;
}

export function plainSettlements(state: GameState, playerId: string): number {
  const slot = epState(state);
  let count = 0;
  state.board.buildings.forEach((building, vertex) => {
    if (building?.player === playerId && !slot.harbors.some((harbor) => harbor.vertex === vertex)) count++;
  });
  return count;
}

export function harborsOf(slot: ExplorersPiratesState, playerId: string) {
  return slot.harbors.filter((harbor) => harbor.player === playerId);
}

/** Fish hauls on the board (on shoals or in holds). */
export function fishOut(slot: ExplorersPiratesState): number {
  let count = 0;
  for (const site of slot.sites) if (site.kind === 'shoal' && site.fish) count++;
  for (const holder of [...slot.ships, ...slot.harbors]) count += holder.cargo.filter((cargo) => cargo === 'fish').length;
  return count;
}

// -- mission tracks ------------------------------------------------------------------

export function trackSpace(slot: ExplorersPiratesState, mission: EpMission, playerId: string): number {
  return slot.tracks[mission]?.positions[playerId] ?? 0;
}

/**
 * Moves a marker one space (EP25 p. 13). A marker that lands on an occupied
 * space goes on top; progress beyond the last space is lost.
 */
export function advanceTrack(state: GameState, mission: EpMission, playerId: string, ctx: ModuleContext, cause: string): void {
  const slot = epState(state);
  const track = slot.tracks[mission];
  if (!track) return;
  const last = TRACK_VALUES[mission].length;
  const from = track.positions[playerId] ?? 0;
  if (from >= last) {
    ctx.kit.emit(state, 'ep.trackFull', { playerId, mission, cause });
    return;
  }
  track.positions[playerId] = from + 1;
  slot.arrivalSeq += 1;
  track.arrivals[playerId] = slot.arrivalSeq;
  ctx.kit.emit(state, 'ep.trackAdvanced', { playerId, mission, space: from + 1, cause });
}

/**
 * Holder of a mission's bonus tile: the furthest marker; on a tie the one at
 * the bottom of the stack (it arrived first). Nobody before leaving the start.
 */
export function trackLeader(slot: ExplorersPiratesState, mission: EpMission): string | null {
  const track = slot.tracks[mission];
  if (!track) return null;
  let best: string | null = null;
  for (const [playerId, space] of Object.entries(track.positions)) {
    if (space <= 0) continue;
    if (best === null) {
      best = playerId;
      continue;
    }
    const bestSpace = track.positions[best]!;
    if (space > bestSpace || (space === bestSpace && (track.arrivals[playerId] ?? 0) < (track.arrivals[best] ?? 0))) {
      best = playerId;
    }
  }
  return best;
}

export function trackPoints(slot: ExplorersPiratesState, mission: EpMission, playerId: string): number {
  const space = trackSpace(slot, mission, playerId);
  const value = space > 0 ? TRACK_VALUES[mission][space - 1]! : 0;
  return value + (trackLeader(slot, mission) === playerId ? TRACK_BONUS : 0);
}

/** E&P points beyond the base score: +1 per harbour settlement (2 VP total) and the tracks. */
export function epPoints(state: GameState, playerId: string): { harbors: number; missions: Partial<Record<EpMission, number>> } {
  const slot = epState(state);
  const missions: Partial<Record<EpMission, number>> = {};
  for (const mission of Object.keys(slot.tracks) as EpMission[]) missions[mission] = trackPoints(slot, mission, playerId);
  return { harbors: harborsOf(slot, playerId).length, missions };
}

export function turnOf(state: GameState): EpTurn {
  return epTurn(state);
}
