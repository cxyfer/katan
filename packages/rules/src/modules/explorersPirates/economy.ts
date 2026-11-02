/**
 * Production, trading with the supply and building (EP25 pp. 8–10).
 */

import { topologyOf } from '../../analysis.ts';
import type { ProductionResult } from '../../analysis.ts';
import { RESOURCES, type CommandOutcome, type GameState, type Resource } from '../../types.ts';
import type { ModuleCommand, ModuleContext, RollResult } from '../types.ts';
import {
  COSTS,
  EP_PIECES,
  gainGold,
  goldOf,
  harborsOf,
  payGold,
  piecesInPlay,
  requireAction,
  requirePirates,
  requireMovement,
} from './core.ts';
import { cornersOf, harborAt, harborsAtShip, isCoastalVertex, isSeaRoute, shipsOnEdge, vertexTouchesFog } from './geometry.ts';
import { cargoPiece, epState, epTurn, hasRoom, removableFor, shipTurn, type Cargo, type EpHarbor, type EpShip } from './state.ts';

// -- production --------------------------------------------------------------------

/**
 * Pays the coins of a production roll (EP25 p. 8): 2 gold per building on a
 * captured gold field, and 1 gold to every player who received nothing. The
 * resource results are paid by the engine unchanged.
 */
export function modifyProduction(state: GameState, results: ProductionResult[], roll: RollResult, ctx: ModuleContext): ProductionResult[] {
  const slot = epState(state);
  const received = new Set<string>();
  for (const result of results) for (const share of result.granted) if (share.amount > 0) received.add(share.playerId);
  const goldGrants: Record<string, number> = {};
  for (const site of slot.sites) {
    if (site.kind !== 'lair' || !site.captured || state.board.layout.numbers[site.hex] !== roll.total) continue;
    for (const vertex of cornersOf(state, site.hex)) {
      const building = state.board.buildings[vertex];
      if (!building) continue;
      const paid = gainGold(slot, building.player, 2);
      if (paid > 0) {
        goldGrants[building.player] = (goldGrants[building.player] ?? 0) + paid;
        received.add(building.player);
      }
    }
  }
  const compensated: string[] = [];
  for (const player of state.players) {
    if (received.has(player.id)) continue;
    if (gainGold(slot, player.id, 1) > 0) compensated.push(player.id);
  }
  if (Object.keys(goldGrants).length > 0 || compensated.length > 0) {
    ctx.kit.emit(state, 'ep.goldProduced', { total: roll.total, grants: goldGrants, compensated });
  }
  return results;
}

// -- trading with the supply -------------------------------------------------------

function resourceOf(value: unknown): Resource | null {
  return RESOURCES.includes(value as Resource) ? (value as Resource) : null;
}

/** 3 of a kind → 1 gold (EP25 p. 9; resource ↔ resource uses `trade.bank` at 3:1). */
export function sellForGold(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireAction(state, actorId, ctx.kit);
  if (refused) return refused;
  const give = resourceOf(command.give);
  if (!give) return ctx.kit.fail('E_INVALID_SELECTION');
  const player = ctx.kit.currentPlayer(state);
  if (player.resources[give] < 3) return ctx.kit.fail('E_INSUFFICIENT_RESOURCES', { resource: give, required: 3 });
  const slot = epState(state);
  if (slot.goldSupply <= 0) return ctx.kit.fail('E_EP_NO_GOLD_SUPPLY');
  player.resources[give] -= 3;
  state.bank[give] += 3;
  gainGold(slot, actorId, 1);
  ctx.kit.emit(state, 'ep.soldForGold', { playerId: actorId, give, count: 3 });
  return ctx.kit.accept(state);
}

/** Twice per turn: 2 gold → 1 resource of choice (EP25 p. 9). */
export function buyResource(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireAction(state, actorId, ctx.kit);
  if (refused) return refused;
  const receive = resourceOf(command.receive);
  if (!receive) return ctx.kit.fail('E_INVALID_SELECTION');
  const slot = epState(state);
  const turn = epTurn(state);
  if (turn.goldBuys >= 2) return ctx.kit.fail('E_EP_TURN_LIMIT', { limit: 2 });
  if (goldOf(slot, actorId) < 2) return ctx.kit.fail('E_EP_NO_GOLD', { required: 2 });
  if (state.bank[receive] <= 0) return ctx.kit.fail('E_BANK_EMPTY', { resource: receive });
  payGold(slot, actorId, 2);
  state.bank[receive] -= 1;
  ctx.kit.currentPlayer(state).resources[receive] += 1;
  turn.goldBuys += 1;
  ctx.kit.emit(state, 'ep.boughtResource', { playerId: actorId, receive, gold: 2 });
  return ctx.kit.accept(state);
}

/** Spice farms with the player's crew that grant an ability (EP25 p. 14). */
export function abilityCount(state: GameState, playerId: string, ability: 'swift' | 'fastGold' | 'pirateBonus'): number {
  return epState(state).sites.filter((site) => site.kind === 'spice' && site.ability === ability && site.crews.includes(playerId)).length;
}

/** Fast Gold: once (twice with both farms) per Action phase, 1 resource → 1 gold. */
export function fastGold(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireAction(state, actorId, ctx.kit);
  if (refused) return refused;
  const give = resourceOf(command.give);
  if (!give) return ctx.kit.fail('E_INVALID_SELECTION');
  const allowed = abilityCount(state, actorId, 'fastGold');
  if (allowed === 0) return ctx.kit.fail('E_EP_NO_ABILITY');
  const turn = epTurn(state);
  if (turn.fastGold >= allowed) return ctx.kit.fail('E_EP_TURN_LIMIT', { limit: allowed });
  const player = ctx.kit.currentPlayer(state);
  if (player.resources[give] < 1) return ctx.kit.fail('E_INSUFFICIENT_RESOURCES', { resource: give, required: 1 });
  const slot = epState(state);
  if (slot.goldSupply <= 0) return ctx.kit.fail('E_EP_NO_GOLD_SUPPLY');
  player.resources[give] -= 1;
  state.bank[give] += 1;
  gainGold(slot, actorId, 1);
  turn.fastGold += 1;
  ctx.kit.emit(state, 'ep.fastGold', { playerId: actorId, give });
  return ctx.kit.accept(state);
}

// -- building ----------------------------------------------------------------------

export function harborTargets(state: GameState, playerId: string): number[] {
  const slot = epState(state);
  if (harborsOf(slot, playerId).length >= EP_PIECES.harbors) return [];
  const out: number[] = [];
  state.board.buildings.forEach((building, vertex) => {
    if (building?.player !== playerId || harborAt(slot, vertex)) return;
    if (isCoastalVertex(state, vertex)) out.push(vertex);
  });
  return out;
}

/** Harbour settlement: replaces an own coastal settlement (EP25 p. 9). */
export function buildHarbor(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireAction(state, actorId, ctx.kit);
  if (refused) return refused;
  const vertex = command.vertex as number;
  const slot = epState(state);
  if (harborsOf(slot, actorId).length >= EP_PIECES.harbors) return ctx.kit.fail('E_NO_PIECES', { piece: 'harbor' });
  if (!harborTargets(state, actorId).includes(vertex)) return ctx.kit.fail('E_ILLEGAL_TARGET', { vertex });
  const player = ctx.kit.currentPlayer(state);
  if (!ctx.kit.canAfford(player, COSTS.harbor)) return ctx.kit.fail('E_INSUFFICIENT_RESOURCES', { cost: COSTS.harbor });
  ctx.kit.payBuild(state, player, COSTS.harbor);
  slot.harbors.push({ vertex, player: actorId, cargo: [] });
  ctx.kit.emit(state, 'ep.harborBuilt', { playerId: actorId, vertex });
  ctx.kit.afterBoardChange(state);
  ctx.kit.checkVictory(state);
  return ctx.kit.accept(state);
}

/** Ship placement: an empty sea edge next to an own harbour settlement (EP25 p. 9). */
export function shipTargets(state: GameState, playerId: string): number[] {
  const slot = epState(state);
  const topo = topologyOf(state);
  const out = new Set<number>();
  for (const harbor of harborsOf(slot, playerId)) {
    for (const edge of topo.vertices[harbor.vertex]!.edges) {
      if (!isSeaRoute(state, edge) || shipsOnEdge(slot, edge).length > 0) continue;
      const info = topo.edges[edge]!;
      // Next to an unexplored hex a new ship would explore on the spot (interpretation 7).
      if (info.vertices.some((vertex) => vertexTouchesFog(state, vertex))) continue;
      // On the Council only where it touches land (EP25-M p. 15).
      if (slot.council !== null && info.hexes.includes(slot.council)
        && !info.hexes.some((hex) => hex !== slot.council && state.board.layout.terrain[hex] !== 'sea')) continue;
      out.add(edge);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function ownShip(state: GameState, playerId: string, id: unknown): EpShip | undefined {
  return epState(state).ships.find((ship) => ship.id === id && ship.player === playerId);
}

export function buildShip(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireAction(state, actorId, ctx.kit);
  if (refused) return refused;
  const edge = command.edge as number;
  const slot = epState(state);
  const own = slot.ships.filter((ship) => ship.player === actorId);
  let replaced: EpShip | undefined;
  if (own.length >= EP_PIECES.ships) {
    // No ship in the supply: return one (and its cargo) first (EP25 p. 9).
    replaced = ownShip(state, actorId, command.replace);
    if (!replaced) return ctx.kit.fail('E_NO_PIECES', { piece: 'ship' });
  }
  // The returned ship's edge is free again for the new one.
  const ships = slot.ships;
  if (replaced) slot.ships = ships.filter((ship) => ship !== replaced);
  const legal = shipTargets(state, actorId).includes(edge);
  slot.ships = ships;
  if (!legal) return ctx.kit.fail('E_ILLEGAL_TARGET', { edge });
  const player = ctx.kit.currentPlayer(state);
  if (!ctx.kit.canAfford(player, COSTS.ship)) return ctx.kit.fail('E_INSUFFICIENT_RESOURCES', { cost: COSTS.ship });
  if (replaced) {
    slot.ships = slot.ships.filter((ship) => ship !== replaced);
    returnCargo(state, replaced.cargo);
    ctx.kit.emit(state, 'ep.shipReturned', { playerId: actorId, ship: replaced.id, edge: replaced.edge, cargo: replaced.cargo.slice() });
  }
  ctx.kit.payBuild(state, player, COSTS.ship);
  const id = `s${slot.nextShip++}`;
  slot.ships.push({ id, player: actorId, edge, cargo: [] });
  ctx.kit.emit(state, 'ep.shipBuilt', { playerId: actorId, edge, ship: id });
  return ctx.kit.accept(state);
}

/** Pieces taken off the board go back to the supply; fish hauls to the fish supply. */
export function returnCargo(state: GameState, cargo: readonly Cargo[]): void {
  const slot = epState(state);
  for (const piece of cargo) if (piece === 'fish') slot.fishSupply += 1;
}

type Holder = { harbor: EpHarbor } | { ship: EpShip };

/** Harbours and ships next to a harbour that may receive a newly built piece (EP25 p. 10). */
export function pieceTargets(state: GameState, playerId: string): Holder[] {
  const slot = epState(state);
  const out: Holder[] = harborsOf(slot, playerId).map((harbor) => ({ harbor }));
  for (const ship of slot.ships) {
    if (ship.player === playerId && harborsAtShip(state, ship).length > 0) out.push({ ship });
  }
  return out;
}

function holderCargo(holder: Holder): Cargo[] {
  return 'harbor' in holder ? holder.harbor.cargo : holder.ship.cargo;
}

export function buildPiece(piece: 'settler' | 'crew') {
  return (state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome => {
    const refused = requireAction(state, actorId, ctx.kit);
    if (refused) return refused;
    if (piece === 'crew') {
      const off = requirePirates(state, ctx.kit);
      if (off) return off;
    }
    const limit = piece === 'settler' ? EP_PIECES.settlers : EP_PIECES.crews;
    if (piecesInPlay(state, actorId, piece) >= limit) return ctx.kit.fail('E_NO_PIECES', { piece });
    const targets = pieceTargets(state, actorId);
    const target = targets.find((holder) =>
      'harbor' in holder ? holder.harbor.vertex === command.harbor : holder.ship.id === command.ship);
    if (!target) return ctx.kit.fail('E_ILLEGAL_TARGET');
    const cargo = holderCargo(target);
    // The piece to return when every slot is full (EP25 p. 10): exactly one.
    const remove = command.remove === undefined ? null : cargoPiece(command.remove);
    if (command.remove !== undefined && !remove) return ctx.kit.fail('E_INVALID_SELECTION', { remove: command.remove });
    if (hasRoom(cargo, piece)) {
      if (remove) return ctx.kit.fail('E_INVALID_SELECTION', { remove });
    } else {
      if (!remove) return ctx.kit.fail('E_EP_NO_ROOM');
      if (targets.some((holder) => hasRoom(holderCargo(holder), piece))) return ctx.kit.fail('E_EP_ROOM_ELSEWHERE');
      if (!cargo.includes(remove)) return ctx.kit.fail('E_INVALID_SELECTION', { remove });
      if (!removableFor(cargo, piece).includes(remove)) return ctx.kit.fail('E_EP_NO_ROOM', { remove });
    }
    const player = ctx.kit.currentPlayer(state);
    const cost = piece === 'settler' ? COSTS.settler : COSTS.crew;
    if (!ctx.kit.canAfford(player, cost)) return ctx.kit.fail('E_INSUFFICIENT_RESOURCES', { cost });
    ctx.kit.payBuild(state, player, cost);
    const removed: Cargo[] = [];
    if (remove) {
      cargo.splice(cargo.indexOf(remove), 1);
      removed.push(remove);
      returnCargo(state, removed);
    }
    cargo.push(piece);
    const where = 'harbor' in target ? { harbor: target.harbor.vertex } : { ship: target.ship.id };
    if (piece === 'settler') ctx.kit.emit(state, 'ep.settlerBuilt', { playerId: actorId, ...where, removed });
    else ctx.kit.emit(state, 'ep.crewBuilt', { playerId: actorId, ...where, removed });
    return ctx.kit.accept(state);
  };
}

/** 1 wool: this ship moves up to 6 edges this turn (EP25 p. 10). */
export function extraMove(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireMovement(state, actorId, ctx.kit);
  if (refused) return refused;
  const ship = ownShip(state, actorId, command.ship);
  if (!ship) return ctx.kit.fail('E_EP_UNKNOWN_SHIP');
  const turn = epTurn(state);
  const record = shipTurn(turn, ship.id);
  if (record.extra) return ctx.kit.fail('E_EP_TURN_LIMIT', { limit: 1 });
  if (record.done) return ctx.kit.fail('E_EP_SHIP_DONE');
  const player = ctx.kit.currentPlayer(state);
  if (!ctx.kit.canAfford(player, COSTS.extraMove)) return ctx.kit.fail('E_INSUFFICIENT_RESOURCES', { cost: COSTS.extraMove });
  ctx.kit.payBuild(state, player, COSTS.extraMove);
  record.extra = true;
  ctx.kit.emit(state, 'ep.extraMove', { playerId: actorId, ship: ship.id });
  return ctx.kit.accept(state);
}

/** Ends trading and building: the Movement phase begins (EP25 p. 10). */
export function startMovement(state: GameState, actorId: string, _command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireAction(state, actorId, ctx.kit);
  if (refused) return refused;
  epTurn(state).phase = 'movement';
  ctx.kit.emit(state, 'ep.movementStarted', { playerId: actorId });
  return ctx.kit.accept(state);
}
