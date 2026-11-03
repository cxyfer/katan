/**
 * The Movement phase (EP25 pp. 10–12, 14): moving ships edge by edge, tribute,
 * exploring, loading and unloading, settling with a settler, and the mission
 * actions done with a ship (crews on lairs and spice farms, fish hauls, spice
 * sacks, deliveries at the Council).
 */

import { neighborsOfVertex, topologyOf } from '../../analysis.ts';
import type { CommandOutcome, GameState } from '../../types.ts';
import type { ModuleCommand, ModuleContext } from '../types.ts';
import {
  advanceTrack,
  BASE_MP,
  EP_PIECES,
  EXTRA_MP,
  goldOf,
  hasMission,
  payGold,
  plainSettlements,
  requireMovement,
  requirePirates,
} from './core.ts';
import { abilityCount, ownShip } from './economy.ts';
import { revealHex } from './explore.ts';
import {
  closedSite,
  councilAnchors,
  fogAtEnds,
  harborAt,
  hexesAtShip,
  isExploredLand,
  isSeaRoute,
  shipEnds,
  shipsOnEdge,
  vertexTouchesFog,
} from './geometry.ts';
import { cargoPiece, epState, epTurn, hasRoom, shipTurn, siteAt, viewTurn, type Cargo, type EpShip, type EpTurn } from './state.ts';

/** MP of a ship this turn: 4, 6 with the extra wool, +1/+2 with Swift Voyage. */
export function shipAllowance(state: GameState, ship: EpShip, turn: EpTurn): number {
  const record = turn.ships[ship.id];
  return BASE_MP + (record?.extra ? EXTRA_MP : 0) + Math.min(2, abilityCount(state, ship.player, 'swift'));
}

export function movesLeft(state: GameState, ship: EpShip, turn: EpTurn): number {
  const record = turn.ships[ship.id];
  if (record?.done) return 0;
  return Math.max(0, shipAllowance(state, ship, turn) - (record?.used ?? 0));
}

/** The active ship sits on an edge with two other ships and may not stop there. */
export function activeShipStranded(state: GameState): boolean {
  const slot = epState(state);
  const turn = viewTurn(state);
  if (!turn.active) return false;
  const ship = slot.ships.find((candidate) => candidate.id === turn.active);
  return !!ship && shipsOnEdge(slot, ship.edge).length > 2;
}

function pirateTouches(state: GameState, edge: number, playerId: string): boolean {
  const pirate = epState(state).pirate;
  if (!pirate || pirate.owner === playerId) return false;
  return topologyOf(state).edges[edge]!.hexes.includes(pirate.hex);
}

export interface StepTarget {
  edge: number;
  /** The step needs the 1-gold tribute (not yet paid for this ship). */
  tribute: boolean;
  /** Two ships already there: the ship may pass but not stop. */
  full: boolean;
  /** The step reveals unexplored hexes (and ends the movement). */
  explores: boolean;
}

/** Edges the ship can move to next (one MP each). */
export function stepTargets(state: GameState, ship: EpShip): StepTarget[] {
  const slot = epState(state);
  const turn = viewTurn(state);
  const left = movesLeft(state, ship, turn);
  if (left <= 0) return [];
  const topo = topologyOf(state);
  const paid = turn.ships[ship.id]?.tribute ?? false;
  const gold = goldOf(slot, ship.player);
  const out: StepTarget[] = [];
  const seen = new Set<number>();
  for (const vertex of topo.edges[ship.edge]!.vertices) {
    for (const edge of topo.vertices[vertex]!.edges) {
      if (edge === ship.edge || seen.has(edge) || !isSeaRoute(state, edge)) continue;
      seen.add(edge);
      const tribute = !paid && (pirateTouches(state, ship.edge, ship.player) || pirateTouches(state, edge, ship.player));
      if (tribute && gold < 1) continue;
      const others = shipsOnEdge(slot, edge).length;
      const explores = fogAtEnds(state, edge).length > 0;
      const full = others >= 2;
      if (full && (left <= 1 || explores)) continue;
      out.push({ edge, tribute, full, explores });
    }
  }
  return out.sort((a, b) => a.edge - b.edge);
}

/** One edge of movement (EP25 p. 10). */
export function moveShip(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireMovement(state, actorId, ctx.kit);
  if (refused) return refused;
  const slot = epState(state);
  const ship = ownShip(state, actorId, command.ship);
  if (!ship) return ctx.kit.fail('E_EP_UNKNOWN_SHIP');
  const turn = epTurn(state);
  if (turn.active && turn.active !== ship.id) {
    // Finish the previous ship first; it may not stay on a full edge.
    if (activeShipStranded(state)) return ctx.kit.fail('E_EP_EDGE_FULL');
    shipTurn(turn, turn.active).done = true;
    turn.active = null;
  }
  const record = shipTurn(turn, ship.id);
  if (record.done) return ctx.kit.fail('E_EP_SHIP_DONE');
  if (movesLeft(state, ship, turn) <= 0) return ctx.kit.fail('E_EP_NO_MP');
  const edge = command.edge as number;
  const target = stepTargets(state, ship).find((candidate) => candidate.edge === edge);
  if (!target) {
    const reachable = topologyOf(state).edges[ship.edge]!.vertices.some((vertex) =>
      topologyOf(state).vertices[vertex]!.edges.includes(edge)) && isSeaRoute(state, edge) && edge !== ship.edge;
    if (reachable && !record.tribute && (pirateTouches(state, ship.edge, actorId) || pirateTouches(state, edge, actorId))) {
      return ctx.kit.fail('E_EP_TRIBUTE');
    }
    if (reachable && shipsOnEdge(slot, edge).length >= 2) return ctx.kit.fail('E_EP_EDGE_FULL');
    return ctx.kit.fail('E_ILLEGAL_TARGET', { edge });
  }
  if (target.tribute) {
    payGold(slot, actorId, 1);
    record.tribute = true;
    ctx.kit.emit(state, 'ep.tributePaid', { playerId: actorId, ship: ship.id, owner: slot.pirate!.owner, hex: slot.pirate!.hex });
  }
  const from = ship.edge;
  ship.edge = edge;
  record.used += 1;
  turn.active = ship.id;
  ctx.kit.emit(state, 'ep.shipMoved', { playerId: actorId, ship: ship.id, from, to: edge, used: record.used });
  const fog = fogAtEnds(state, edge);
  if (fog.length > 0) {
    for (const hex of fog) revealHex(state, hex, actorId, ctx);
    // Exploring ends this ship's movement (EP25 p. 12).
    record.done = true;
    turn.active = null;
  }
  ctx.kit.afterBoardChange(state);
  return ctx.kit.accept(state);
}

/** Marks the active ship's movement as finished (fish roll, turn end). */
export function finishActiveShip(state: GameState): void {
  const turn = epTurn(state);
  if (!turn.active) return;
  shipTurn(turn, turn.active).done = true;
  turn.active = null;
}

// -- loading and unloading ---------------------------------------------------------

function ownHarborAtShip(state: GameState, ship: EpShip, vertex: unknown) {
  const harbor = harborAt(epState(state), vertex as number);
  if (!harbor || harbor.player !== ship.player) return undefined;
  return shipEnds(state, ship).includes(harbor.vertex) ? harbor : undefined;
}

function removeOne(cargo: Cargo[], piece: Cargo): boolean {
  const at = cargo.indexOf(piece);
  if (at < 0) return false;
  cargo.splice(at, 1);
  return true;
}

/** Harbour → ship or ship → harbour (EP25 p. 11, no MP). */
export function transfer(direction: 'load' | 'unload') {
  return (state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome => {
    const refused = requireMovement(state, actorId, ctx.kit);
    if (refused) return refused;
    const ship = ownShip(state, actorId, command.ship);
    if (!ship) return ctx.kit.fail('E_EP_UNKNOWN_SHIP');
    const harbor = ownHarborAtShip(state, ship, command.harbor);
    if (!harbor) return ctx.kit.fail('E_EP_NOT_ADJACENT');
    const piece = cargoPiece(command.piece);
    if (!piece) return ctx.kit.fail('E_INVALID_SELECTION');
    const [from, to] = direction === 'load' ? [harbor.cargo, ship.cargo] : [ship.cargo, harbor.cargo];
    if (!from.includes(piece)) return ctx.kit.fail('E_INVALID_SELECTION', { piece });
    if (!hasRoom(to, piece)) return ctx.kit.fail('E_EP_NO_ROOM');
    removeOne(from, piece);
    to.push(piece);
    const params = { playerId: actorId, ship: ship.id, harbor: harbor.vertex, piece };
    if (direction === 'load') ctx.kit.emit(state, 'ep.loaded', params);
    else ctx.kit.emit(state, 'ep.unloaded', params);
    return ctx.kit.accept(state);
  };
}

/** Swaps the pieces of a ship and the harbour settlement it touches (EP25 p. 11). */
export function swapCargo(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireMovement(state, actorId, ctx.kit);
  if (refused) return refused;
  const ship = ownShip(state, actorId, command.ship);
  if (!ship) return ctx.kit.fail('E_EP_UNKNOWN_SHIP');
  const harbor = ownHarborAtShip(state, ship, command.harbor);
  if (!harbor) return ctx.kit.fail('E_EP_NOT_ADJACENT');
  if (ship.cargo.length === 0 && harbor.cargo.length === 0) return ctx.kit.fail('E_INVALID_SELECTION');
  const held = ship.cargo;
  ship.cargo = harbor.cargo;
  harbor.cargo = held;
  ctx.kit.emit(state, 'ep.swapped', { playerId: actorId, ship: ship.id, harbor: harbor.vertex });
  return ctx.kit.accept(state);
}

// -- settling ------------------------------------------------------------------------

/** Intersections at the ship's ends where its settler may found a settlement (EP25 p. 12). */
export function foundTargets(state: GameState, ship: EpShip): number[] {
  if (!ship.cargo.includes('settler')) return [];
  if (plainSettlements(state, ship.player) >= EP_PIECES.settlements) return [];
  const slot = epState(state);
  const topo = topologyOf(state);
  return shipEnds(state, ship).filter((vertex) => {
    if (state.board.buildings[vertex]) return false;
    const hexes = topo.vertices[vertex]!.hexes;
    if (!hexes.some((hex) => isExploredLand(state, slot, hex))) return false;
    if (vertexTouchesFog(state, vertex)) return false;
    if (hexes.some((hex) => closedSite(state, hex, ship.player))) return false;
    return neighborsOfVertex(topo, vertex).every((neighbor) => !state.board.buildings[neighbor]);
  });
}

export function foundSettlement(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireMovement(state, actorId, ctx.kit);
  if (refused) return refused;
  const ship = ownShip(state, actorId, command.ship);
  if (!ship) return ctx.kit.fail('E_EP_UNKNOWN_SHIP');
  if (!ship.cargo.includes('settler')) return ctx.kit.fail('E_EP_NO_SETTLER');
  const vertex = command.vertex as number;
  if (!foundTargets(state, ship).includes(vertex)) return ctx.kit.fail('E_ILLEGAL_TARGET', { vertex });
  const slot = epState(state);
  // The ship and the settler return to the supply; its other cargo with it.
  slot.ships = slot.ships.filter((candidate) => candidate !== ship);
  for (const piece of ship.cargo) if (piece === 'fish') slot.fishSupply += 1;
  const turn = epTurn(state);
  if (turn.active === ship.id) turn.active = null;
  state.board.buildings[vertex] = { player: actorId, city: false };
  ctx.kit.emit(state, 'ep.settlementFounded', { playerId: actorId, ship: ship.id, vertex });
  ctx.kit.afterBoardChange(state);
  ctx.kit.checkVictory(state);
  return ctx.kit.accept(state);
}

// -- missions with ships ---------------------------------------------------------------

function siteAtShip(state: GameState, ship: EpShip, hex: unknown) {
  if (!hexesAtShip(state, ship).includes(hex as number)) return undefined;
  return siteAt(epState(state), hex as number);
}

/** Lands a crew on a pirate lair or a spice farm (EP25 pp. 13–14). */
export function dropCrew(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireMovement(state, actorId, ctx.kit) ?? requirePirates(state, ctx.kit);
  if (refused) return refused;
  const ship = ownShip(state, actorId, command.ship);
  if (!ship) return ctx.kit.fail('E_EP_UNKNOWN_SHIP');
  if (!ship.cargo.includes('crew')) return ctx.kit.fail('E_EP_NO_CREW');
  const site = siteAtShip(state, ship, command.hex);
  if (!site) return ctx.kit.fail('E_EP_NOT_ADJACENT');
  const slot = epState(state);
  if (site.kind === 'lair') {
    if (site.captured || site.crews.length >= 3) return ctx.kit.fail('E_EP_SITE_CLOSED');
    site.crews.push(actorId);
    if (site.crews.length === 3) slot.captures.push(site.hex);
  } else if (site.kind === 'spice') {
    if (site.crews.includes(actorId)) return ctx.kit.fail('E_EP_SITE_CLOSED');
    site.crews.push(actorId);
  } else {
    return ctx.kit.fail('E_EP_NOT_ADJACENT');
  }
  removeOne(ship.cargo, 'crew');
  ctx.kit.emit(state, 'ep.crewLanded', { playerId: actorId, ship: ship.id, hex: site.hex, site: site.kind, crews: site.crews.length });
  if (site.kind === 'spice') ctx.kit.afterBoardChange(state);
  return ctx.kit.accept(state);
}

/** Takes an own crew back from a captured lair (EP25-M p. 13: "free to leave"). */
export function pickCrew(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireMovement(state, actorId, ctx.kit) ?? requirePirates(state, ctx.kit);
  if (refused) return refused;
  const ship = ownShip(state, actorId, command.ship);
  if (!ship) return ctx.kit.fail('E_EP_UNKNOWN_SHIP');
  const site = siteAtShip(state, ship, command.hex);
  if (!site || site.kind !== 'lair') return ctx.kit.fail('E_EP_NOT_ADJACENT');
  if (!site.captured || !site.crews.includes(actorId)) return ctx.kit.fail('E_EP_SITE_CLOSED');
  if (!hasRoom(ship.cargo, 'crew')) return ctx.kit.fail('E_EP_NO_ROOM');
  site.crews.splice(site.crews.indexOf(actorId), 1);
  ship.cargo.push('crew');
  ctx.kit.emit(state, 'ep.crewPicked', { playerId: actorId, ship: ship.id, hex: site.hex });
  return ctx.kit.accept(state);
}

/** Loads the player's spice sack at a farm where their crew lives (EP25 p. 14). */
export function loadSpice(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireMovement(state, actorId, ctx.kit);
  if (refused) return refused;
  if (!hasMission(state, 'spices')) return ctx.kit.fail('E_EP_NOT_IN_SCENARIO');
  const ship = ownShip(state, actorId, command.ship);
  if (!ship) return ctx.kit.fail('E_EP_UNKNOWN_SHIP');
  const site = siteAtShip(state, ship, command.hex);
  if (!site || site.kind !== 'spice') return ctx.kit.fail('E_EP_NOT_ADJACENT');
  if (!site.crews.includes(actorId) || !site.sacks.includes(actorId)) return ctx.kit.fail('E_EP_SITE_CLOSED');
  if (!hasRoom(ship.cargo, 'spice')) return ctx.kit.fail('E_EP_NO_ROOM');
  site.sacks.splice(site.sacks.indexOf(actorId), 1);
  ship.cargo.push('spice');
  ctx.kit.emit(state, 'ep.spiceLoaded', { playerId: actorId, ship: ship.id, hex: site.hex });
  return ctx.kit.accept(state);
}

/** Loads a fish haul from a shoal next to the ship (EP25 p. 14). */
export function loadFish(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireMovement(state, actorId, ctx.kit);
  if (refused) return refused;
  if (!hasMission(state, 'fish')) return ctx.kit.fail('E_EP_NOT_IN_SCENARIO');
  const ship = ownShip(state, actorId, command.ship);
  if (!ship) return ctx.kit.fail('E_EP_UNKNOWN_SHIP');
  const site = siteAtShip(state, ship, command.hex);
  if (!site || site.kind !== 'shoal') return ctx.kit.fail('E_EP_NOT_ADJACENT');
  if (!site.fish) return ctx.kit.fail('E_EP_SITE_CLOSED');
  if (!hasRoom(ship.cargo, 'fish')) return ctx.kit.fail('E_EP_NO_ROOM');
  site.fish = false;
  ship.cargo.push('fish');
  ctx.kit.emit(state, 'ep.fishLoaded', { playerId: actorId, ship: ship.id, hex: site.hex });
  return ctx.kit.accept(state);
}

export function atCouncil(state: GameState, ship: EpShip): boolean {
  const anchors = councilAnchors(state, epState(state));
  return shipEnds(state, ship).some((vertex) => anchors.includes(vertex));
}

/** Unloads fish hauls and spice sacks at a Council anchor: +1 track each (EP25 p. 14). */
export function deliver(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireMovement(state, actorId, ctx.kit);
  if (refused) return refused;
  const ship = ownShip(state, actorId, command.ship);
  if (!ship) return ctx.kit.fail('E_EP_UNKNOWN_SHIP');
  if (!atCouncil(state, ship)) return ctx.kit.fail('E_EP_NOT_ADJACENT');
  const goods = ship.cargo.filter((piece) => (piece === 'fish' && hasMission(state, 'fish')) || (piece === 'spice' && hasMission(state, 'spices')));
  if (goods.length === 0) return ctx.kit.fail('E_INVALID_SELECTION');
  const slot = epState(state);
  ship.cargo = ship.cargo.filter((piece) => !goods.includes(piece));
  ctx.kit.emit(state, 'ep.delivered', { playerId: actorId, ship: ship.id, goods });
  for (const piece of goods) {
    if (piece === 'fish') {
      slot.fishSupply += 1;
      advanceTrack(state, 'fish', actorId, ctx, 'fish');
    } else {
      advanceTrack(state, 'spices', actorId, ctx, 'spice');
    }
  }
  ctx.kit.checkVictory(state);
  return ctx.kit.accept(state);
}

/**
 * Once per Movement phase, before or after moving a ship, roll for a fish
 * haul (EP25 p. 14). Rolling finishes the ship in motion.
 */
export function fishRoll(state: GameState, actorId: string, _command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = requireMovement(state, actorId, ctx.kit);
  if (refused) return refused;
  if (!hasMission(state, 'fish')) return ctx.kit.fail('E_EP_NOT_IN_SCENARIO');
  const turn = epTurn(state);
  if (turn.fishRolled) return ctx.kit.fail('E_EP_TURN_LIMIT', { limit: 1 });
  if (activeShipStranded(state)) return ctx.kit.fail('E_EP_EDGE_FULL');
  finishActiveShip(state);
  turn.fishRolled = true;
  const slot = epState(state);
  const die = ctx.rng.int(6) + 1;
  const placed: number[] = [];
  for (const site of slot.sites) {
    if (site.kind !== 'shoal' || site.number !== die) continue;
    if (site.fish || slot.pirate?.hex === site.hex || slot.fishSupply <= 0) continue;
    site.fish = true;
    slot.fishSupply -= 1;
    placed.push(site.hex);
  }
  ctx.kit.emit(state, 'ep.fishRolled', { playerId: actorId, die, hexes: placed });
  return ctx.kit.accept(state);
}
