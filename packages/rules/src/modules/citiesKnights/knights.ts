/**
 * Knights (CK25 pp. 9–10, CK-FAQ knights).
 *
 * - Six per player, two per strength (basic 1, strong 2, mighty 3).
 * - Recruit (1 wool + 1 ore): a basic knight from the supply onto an empty
 *   intersection touching an own road; no distance rule; it starts inactive.
 * - Promote (1 wool + 1 ore): replace with the next strength if such a piece
 *   is in the supply; strong → mighty needs politics level 3; a knight is
 *   promoted at most once per turn; its status does not change.
 * - Activate (1 grain): stand up an inactive knight. A knight activated in
 *   this action window cannot act in it (recruit → activate and act →
 *   activate are fine, activate → act is not).
 * - Actions, by a knight that is active and was not activated in this window,
 *   each laying it down afterwards:
 *   move along own continuous routes, past own pieces but not others', to an
 *   empty intersection; displace a weaker opponent knight reached the same
 *   way (the owner then moves it by the move rules or loses it to their
 *   supply); chase away the robber from an adjacent hex (move + steal).
 * - Knights act like buildings for routes: opponents cannot build a road past
 *   them and their Longest Route is split there; knights block settlement
 *   sites. In C&K buildings block roads the same way (`vertexBlocker`).
 *
 * Routes are the player's road pieces; ships are included so the later
 * Seafarers + C&K profile can reuse this (CK25 p. 12), which this phase does
 * not enable.
 */

import { isLandVertex, playerById, topologyOf } from '../../analysis.ts';
import type { CommandOutcome, GameState, ModulePending } from '../../types.ts';
import type { ModuleCommand, ModuleContext } from '../types.ts';
import {
  ABILITY_LEVEL,
  ACTIVATE_COST,
  CITIES_KNIGHTS,
  KNIGHTS_PER_LEVEL,
  KNIGHT_COST,
  PROMOTE_COST,
  type KnightLevel,
} from './constants.ts';
import { ckState, ckView, knightAt, type Knight } from './state.ts';

export const DISPLACED_FRAME = 'citiesKnights.displaced' as const;

interface DisplacedData {
  knight: Knight;
  /** Intersection the knight was pushed off. */
  from: number;
}

/** The owner of whatever holds an intersection: a building or a knight. */
export function vertexOccupant(state: GameState, vertex: number): string | null {
  return state.board.buildings[vertex]?.player ?? knightAt(state, vertex)?.player ?? null;
}

function ownRouteNeighbours(state: GameState, playerId: string, vertex: number): number[] {
  const topo = topologyOf(state);
  const out: number[] = [];
  for (const edge of topo.vertices[vertex]!.edges) {
    const road = state.board.roads[edge];
    if (!road || road.player !== playerId) continue;
    const [a, b] = topo.edges[edge]!.vertices;
    out.push(a === vertex ? b : a);
  }
  return out;
}

/**
 * Where a knight of `playerId` standing on `start` can go along the player's
 * continuous routes: empty intersections (`moves`) and intersections holding
 * another player's knight (`knights`), never passing another player's piece.
 */
export function knightReach(state: GameState, playerId: string, start: number): { moves: number[]; knights: number[] } {
  const moves: number[] = [];
  const knights: number[] = [];
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const vertex = queue.shift()!;
    for (const next of ownRouteNeighbours(state, playerId, vertex)) {
      if (seen.has(next)) continue;
      seen.add(next);
      const occupant = vertexOccupant(state, next);
      if (occupant === null) {
        moves.push(next);
        queue.push(next);
      } else if (occupant === playerId) {
        queue.push(next);
      } else if (!state.board.buildings[next]) {
        knights.push(next);
      }
    }
  }
  return { moves: moves.sort((a, b) => a - b), knights: knights.sort((a, b) => a - b) };
}

export function knightsOf(state: GameState, playerId: string): Knight[] {
  return ckView(state).knights.filter((knight) => knight.player === playerId);
}

export function knightsInSupply(state: GameState, playerId: string, level: KnightLevel): number {
  return KNIGHTS_PER_LEVEL - knightsOf(state, playerId).filter((knight) => knight.level === level).length;
}

/** Recruit sites: empty land intersections touching an own road (CK25 p. 9). */
export function recruitSites(state: GameState, playerId: string): number[] {
  const topo = topologyOf(state);
  const out: number[] = [];
  for (let vertex = 0; vertex < topo.vertices.length; vertex++) {
    if (vertexOccupant(state, vertex) !== null || !isLandVertex(state, vertex)) continue;
    if (ownRouteNeighbours(state, playerId, vertex).length > 0) out.push(vertex);
  }
  return out;
}

export function canAct(state: GameState, knight: Knight): boolean {
  return knight.active && knight.activatedIn !== state.windowId;
}

export function canPromote(state: GameState, knight: Knight): boolean {
  if (knight.level >= 3 || knight.promotedIn === state.windowId) return false;
  const next = (knight.level + 1) as KnightLevel;
  if (knightsInSupply(state, knight.player, next) <= 0) return false;
  return next < 3 || playerById(state, knight.player)!.improvements.politics >= ABILITY_LEVEL;
}

/** Weaker opponent knights this knight could displace. */
export function displaceTargets(state: GameState, knight: Knight): number[] {
  return knightReach(state, knight.player, knight.vertex).knights.filter((vertex) => {
    const other = knightAt(state, vertex);
    return !!other && other.level < knight.level;
  });
}

export function adjacentToRobber(state: GameState, knight: Knight): boolean {
  return topologyOf(state).vertices[knight.vertex]!.hexes.includes(state.board.robber);
}

/** Knight commands are action-phase actions of the player on turn. */
function requireAction(state: GameState, actorId: string, ctx: ModuleContext): CommandOutcome | null {
  const { kit } = ctx;
  if (kit.currentPlayer(state).id !== actorId) return kit.fail('E_NOT_YOUR_TURN');
  if (state.turn.phase !== 'action') return kit.fail('E_WRONG_PHASE', { phase: state.turn.phase });
  if (state.pending) return kit.fail('E_PENDING_EFFECT', { pending: state.pending.kind });
  return null;
}

function ownKnight(state: GameState, actorId: string, vertex: unknown, ctx: ModuleContext): Knight | CommandOutcome {
  const knight = typeof vertex === 'number' ? ckState(state).knights.find((candidate) => candidate.vertex === vertex) : undefined;
  if (!knight || knight.player !== actorId) return ctx.kit.fail('E_ILLEGAL_TARGET', { vertex });
  return knight;
}

function isOutcome(value: Knight | CommandOutcome): value is CommandOutcome {
  return 'ok' in value;
}

/** `knight.recruit { vertex }` */
export function recruitKnight(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const guard = requireAction(state, actorId, ctx);
  if (guard) return guard;
  const vertex = command.vertex;
  if (typeof vertex !== 'number' || !recruitSites(state, actorId).includes(vertex)) return kit.fail('E_ILLEGAL_TARGET', { vertex });
  if (knightsInSupply(state, actorId, 1) <= 0) return kit.fail('E_NO_PIECES', { piece: 'knight', level: 1 });
  const player = playerById(state, actorId)!;
  if (!kit.canAfford(player, KNIGHT_COST)) return kit.fail('E_INSUFFICIENT_RESOURCES', { cost: KNIGHT_COST });
  kit.payBuild(state, player, KNIGHT_COST);
  ckState(state).knights.push({ player: actorId, vertex, level: 1, active: false });
  kit.emit(state, 'ck.knightRecruited', { playerId: actorId, vertex });
  kit.afterBoardChange(state);
  kit.checkVictory(state);
  return kit.accept(state);
}

/** `knight.activate { vertex }` */
export function activateKnight(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const guard = requireAction(state, actorId, ctx);
  if (guard) return guard;
  const knight = ownKnight(state, actorId, command.vertex, ctx);
  if (isOutcome(knight)) return knight;
  if (knight.active) return kit.fail('E_KNIGHT_ACTIVE', { vertex: knight.vertex });
  const player = playerById(state, actorId)!;
  if (!kit.canAfford(player, ACTIVATE_COST)) return kit.fail('E_INSUFFICIENT_RESOURCES', { cost: ACTIVATE_COST });
  kit.payBuild(state, player, ACTIVATE_COST);
  knight.active = true;
  knight.activatedIn = state.windowId;
  kit.emit(state, 'ck.knightActivated', { playerId: actorId, vertex: knight.vertex, level: knight.level });
  return kit.accept(state);
}

/** `knight.promote { vertex }` */
export function promoteKnight(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const guard = requireAction(state, actorId, ctx);
  if (guard) return guard;
  const knight = ownKnight(state, actorId, command.vertex, ctx);
  if (isOutcome(knight)) return knight;
  if (knight.level >= 3) return kit.fail('E_ILLEGAL_TARGET', { vertex: knight.vertex, reason: 'max-level' });
  if (knight.promotedIn === state.windowId) return kit.fail('E_KNIGHT_PROMOTED');
  const next = (knight.level + 1) as KnightLevel;
  if (next === 3 && playerById(state, actorId)!.improvements.politics < ABILITY_LEVEL) {
    return kit.fail('E_IMPROVEMENT_REQUIRED', { track: 'politics', level: ABILITY_LEVEL });
  }
  if (knightsInSupply(state, actorId, next) <= 0) return kit.fail('E_NO_PIECES', { piece: 'knight', level: next });
  const player = playerById(state, actorId)!;
  if (!kit.canAfford(player, PROMOTE_COST)) return kit.fail('E_INSUFFICIENT_RESOURCES', { cost: PROMOTE_COST });
  kit.payBuild(state, player, PROMOTE_COST);
  knight.level = next;
  knight.promotedIn = state.windowId;
  kit.emit(state, 'ck.knightPromoted', { playerId: actorId, vertex: knight.vertex, level: next });
  return kit.accept(state);
}

function actingKnight(state: GameState, actorId: string, vertex: unknown, ctx: ModuleContext): Knight | CommandOutcome {
  const knight = ownKnight(state, actorId, vertex, ctx);
  if (isOutcome(knight)) return knight;
  if (!knight.active) return ctx.kit.fail('E_KNIGHT_INACTIVE', { vertex: knight.vertex });
  if (knight.activatedIn === state.windowId) return ctx.kit.fail('E_KNIGHT_JUST_ACTIVATED', { vertex: knight.vertex });
  return knight;
}

/** `knight.move { from, to }` */
export function moveKnight(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const guard = requireAction(state, actorId, ctx);
  if (guard) return guard;
  const knight = actingKnight(state, actorId, command.from, ctx);
  if (isOutcome(knight)) return knight;
  const to = command.to;
  if (typeof to !== 'number' || !knightReach(state, actorId, knight.vertex).moves.includes(to)) {
    return kit.fail('E_ILLEGAL_TARGET', { vertex: to });
  }
  const from = knight.vertex;
  knight.vertex = to;
  knight.active = false;
  kit.emit(state, 'ck.knightMoved', { playerId: actorId, from, to, level: knight.level });
  kit.afterBoardChange(state);
  kit.checkVictory(state);
  return kit.accept(state);
}

/** `knight.displace { from, to }` */
export function displaceKnight(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const guard = requireAction(state, actorId, ctx);
  if (guard) return guard;
  const knight = actingKnight(state, actorId, command.from, ctx);
  if (isOutcome(knight)) return knight;
  const to = command.to;
  const victim = typeof to === 'number' ? knightAt(state, to) : undefined;
  if (typeof to !== 'number' || !victim || victim.player === actorId || !knightReach(state, actorId, knight.vertex).knights.includes(to)) {
    return kit.fail('E_ILLEGAL_TARGET', { vertex: to });
  }
  if (victim.level >= knight.level) return kit.fail('E_KNIGHT_TOO_WEAK', { vertex: to });
  const slot = ckState(state);
  const from = knight.vertex;
  slot.knights = slot.knights.filter((candidate) => candidate !== victim);
  knight.vertex = to;
  knight.active = false;
  kit.emit(state, 'ck.knightDisplaced', { playerId: actorId, victim: victim.player, from, to, level: knight.level, victimLevel: victim.level });
  const options = knightReach(state, victim.player, to).moves;
  if (options.length === 0) {
    kit.emit(state, 'ck.knightRemoved', { playerId: victim.player, vertex: to, level: victim.level });
  } else {
    const data: DisplacedData = { knight: { ...victim }, from: to };
    kit.enqueuePending(state, { kind: DISPLACED_FRAME, module: CITIES_KNIGHTS, responders: [victim.player], data: data as unknown as Record<string, unknown> });
  }
  kit.afterBoardChange(state);
  kit.checkVictory(state);
  return kit.accept(state);
}

/** Legal retreat intersections for the displaced knight's owner. */
export function retreatOptions(state: GameState, frame: ModulePending): number[] {
  const data = frame.data as unknown as DisplacedData;
  return knightReach(state, data.knight.player, data.from).moves;
}

/** `knight.retreat { vertex }` — the owner of a displaced knight moves it. */
export function retreatKnight(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const frame = state.pending as ModulePending | null;
  if (!frame || frame.kind !== DISPLACED_FRAME) return kit.fail('E_PENDING_EFFECT', { pending: frame?.kind ?? 'none' });
  if (!frame.responders.includes(actorId)) return kit.fail('E_NOT_ACTOR');
  const vertex = command.vertex;
  if (typeof vertex !== 'number' || !retreatOptions(state, frame).includes(vertex)) return kit.fail('E_ILLEGAL_TARGET', { vertex });
  const data = frame.data as unknown as DisplacedData;
  ckState(state).knights.push({ ...data.knight, vertex });
  kit.emit(state, 'ck.knightRetreated', { playerId: actorId, from: data.from, to: vertex, level: data.knight.level });
  frame.responders = [];
  kit.afterBoardChange(state);
  kit.completePending(state, ctx.rng);
  return kit.accept(state);
}

/** `knight.chaseRobber { vertex }` — then the actor moves the robber and steals. */
export function chaseRobber(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const { kit } = ctx;
  const guard = requireAction(state, actorId, ctx);
  if (guard) return guard;
  if (ckState(state).attacks === 0) return kit.fail('E_ROBBER_INACTIVE');
  const knight = actingKnight(state, actorId, command.vertex, ctx);
  if (isOutcome(knight)) return knight;
  if (!adjacentToRobber(state, knight)) return kit.fail('E_ILLEGAL_TARGET', { vertex: knight.vertex, reason: 'not-adjacent' });
  knight.active = false;
  kit.emit(state, 'ck.knightChasedRobber', { playerId: actorId, vertex: knight.vertex, hex: state.board.robber });
  kit.enqueuePending(state, { kind: 'moveRobber', actor: actorId, cause: 'knight', pirate: false });
  return kit.accept(state);
}
