/**
 * Game creation and the starting pieces.
 *
 * Land Ho! prints every starting piece (EP25-M p. 4). From Pirate Lairs on the
 * players use the variable setup (EP25 p. 7, EP25-M p. 9): in turn order a
 * harbour settlement on a marked intersection, in reverse order a settlement
 * on the starting island, then in turn order a road next to that settlement
 * and a ship carrying a settler next to the harbour settlement. The engine's
 * setup cursor (`turn.setup`) runs over the three passes; the base setup
 * commands are refused for E&P profiles.
 */

import { neighborsOfVertex, topologyOf } from '../../analysis.ts';
import {
  cornerVertex,
  epBoardIndex,
  epScenario,
  LAND_HO_START,
  sideEdge,
  type FixedStart,
} from '../../explorers-pirates-boards.ts';
import type { CommandOutcome, GameState, PlayerState, Resource } from '../../types.ts';
import type { ModuleCommand, ModuleContext } from '../types.ts';
import { setModuleState } from '../state.ts';
import { COIN_SUPPLY, FISH_HAULS, LAIR_TOKENS, START_GOLD } from './core.ts';
import { harborAt, isSeaRoute, shipsOnEdge, vertexTouchesFog } from './geometry.ts';
import {
  EXPLORERS_PIRATES,
  emptyTurn,
  epState,
  type EpSite,
  type ExplorersPiratesState,
  type SpiceAbility,
} from './state.ts';

const TERRAIN_RESOURCE: Readonly<Record<string, Resource>> = {
  forest: 'lumber',
  hills: 'brick',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
};

export function initGame(state: GameState, ctx: ModuleContext): void {
  const scenario = epScenario(ctx.profile.scenario);
  const topo = topologyOf(state);
  const index = epBoardIndex(topo, scenario);
  const abilities: SpiceAbility[] = ['swift', 'fastGold', 'pirateBonus'];
  const sites: EpSite[] = index.council === null ? [] : [{ hex: index.council, kind: 'council' }];
  const hasGold = (scenario.regions.parrot.tiles.gold ?? 0) + (scenario.regions.goose.tiles.gold ?? 0) > 0;
  const slot: ExplorersPiratesState = {
    scenario: scenario.id,
    startIsland: index.startIsland,
    fog: index.fog,
    council: index.council,
    harborMarks: index.harborMarks,
    pools: {
      parrot: {
        tiles: { ...scenario.regions.parrot.tiles },
        discs: scenario.regions.parrot.discs.slice(),
        shoals: scenario.regions.parrot.shoals.slice(),
        abilities: (scenario.regions.parrot.tiles.spice ?? 0) > 0 ? abilities.slice() : [],
      },
      goose: {
        tiles: { ...scenario.regions.goose.tiles },
        discs: scenario.regions.goose.discs.slice(),
        shoals: scenario.regions.goose.shoals.slice(),
        abilities: (scenario.regions.goose.tiles.spice ?? 0) > 0 ? abilities.slice() : [],
      },
    },
    lairTokens: hasGold ? [...LAIR_TOKENS] : [],
    sites,
    ships: [],
    harbors: [],
    nextShip: 1,
    gold: {},
    goldSupply: COIN_SUPPLY,
    fishSupply: scenario.missions.includes('fish') ? FISH_HAULS : 0,
    pirate: null,
    tracks: Object.fromEntries(scenario.missions.map((mission) => [
      mission,
      { positions: Object.fromEntries(state.players.map((player) => [player.id, 0])), arrivals: {} },
    ])),
    arrivalSeq: 0,
    captures: [],
    turn: emptyTurn(state.windowId),
    setup: null,
  };
  for (const player of state.players) {
    slot.gold[player.id] = START_GOLD;
    slot.goldSupply -= START_GOLD;
  }
  setModuleState(state, EXPLORERS_PIRATES, slot);

  const setup = state.turn.setup!;
  if (scenario.fixedStart) {
    placeFixedStart(state, ctx);
    // Skip the setup rounds: the first player's turn begins.
    setup.index = setup.order.length - 1;
    ctx.kit.finishSetupStep(state);
    return;
  }
  // Third pass (turn order): road + settler ship.
  setup.order = [...setup.order, ...state.players.map((player) => player.seat)];
  slot.setup = { road: false, ship: false };
}

/** Colour positions of Land Ho!; a colour that is not printed takes a free one. */
function fixedPositions(players: readonly PlayerState[]): Map<string, FixedStart> {
  const out = new Map<string, FixedStart>();
  const free = LAND_HO_START.filter((spec) => !players.some((player) => player.color === spec.color));
  for (const player of players) {
    const spec = LAND_HO_START.find((candidate) => candidate.color === player.color) ?? free.shift()!;
    out.set(player.id, spec);
  }
  return out;
}

function placeFixedStart(state: GameState, ctx: ModuleContext): void {
  const slot = epState(state);
  const topo = topologyOf(state);
  for (const [playerId, spec] of fixedPositions(state.players)) {
    const settlement = cornerVertex(topo, spec.settlement.q, spec.settlement.r, spec.settlement.corner);
    const harbor = cornerVertex(topo, spec.harbor.q, spec.harbor.r, spec.harbor.corner);
    const road = sideEdge(topo, spec.road.q, spec.road.r, spec.road.side);
    const ship = sideEdge(topo, spec.ship.q, spec.ship.r, spec.ship.side);
    state.board.buildings[settlement] = { player: playerId, city: false };
    state.board.buildings[harbor] = { player: playerId, city: false };
    state.board.roads[road] = { player: playerId, ship: false };
    slot.harbors.push({ vertex: harbor, player: playerId, cargo: [] });
    slot.ships.push({ id: `s${slot.nextShip++}`, player: playerId, edge: ship, cargo: ['settler'] });
    grantStartingResources(state, playerId, settlement, ctx);
    ctx.kit.emit(state, 'ep.fixedStart', { playerId, settlement, harbor, road, ship });
  }
  ctx.kit.afterBoardChange(state);
}

/** One resource per terrain hex next to the settlement (EP25 p. 7). */
function grantStartingResources(state: GameState, playerId: string, vertex: number, ctx: ModuleContext): void {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  const gained: Partial<Record<Resource, number>> = {};
  for (const hex of topologyOf(state).vertices[vertex]!.hexes) {
    const resource = TERRAIN_RESOURCE[state.board.layout.terrain[hex] ?? ''];
    if (!resource || state.bank[resource] <= 0) continue;
    state.bank[resource] -= 1;
    player.resources[resource] += 1;
    gained[resource] = (gained[resource] ?? 0) + 1;
  }
  ctx.kit.emit(state, 'ep.startingResources', { playerId, resources: gained });
}

// -- variable setup -------------------------------------------------------------------

export type SetupStep = 'harbor' | 'settlement' | 'route';

export function setupStep(state: GameState): SetupStep | null {
  const setup = state.turn.setup;
  if (!setup || !epState(state).setup) return null;
  const count = state.players.length;
  return setup.index < count ? 'harbor' : setup.index < count * 2 ? 'settlement' : 'route';
}

function setupActor(state: GameState): string | null {
  const setup = state.turn.setup;
  if (!setup) return null;
  return state.players[setup.order[setup.index] ?? -1]?.id ?? null;
}

function guard(state: GameState, actorId: string, step: SetupStep, ctx: ModuleContext): CommandOutcome | null {
  if (!state.turn.setup) return ctx.kit.fail('E_WRONG_PHASE', { phase: state.turn.phase });
  if (setupActor(state) !== actorId) return ctx.kit.fail('E_NOT_YOUR_TURN');
  if (setupStep(state) !== step) return ctx.kit.fail('E_EP_SETUP_STEP', { step: setupStep(state) });
  return null;
}

function freeIntersection(state: GameState, vertex: number): boolean {
  const topo = topologyOf(state);
  if (!topo.vertices[vertex] || state.board.buildings[vertex]) return false;
  return neighborsOfVertex(topo, vertex).every((neighbor) => !state.board.buildings[neighbor]);
}

export function setupHarborTargets(state: GameState): number[] {
  return epState(state).harborMarks.filter((vertex) => freeIntersection(state, vertex));
}

export function setupSettlementTargets(state: GameState): number[] {
  const slot = epState(state);
  const topo = topologyOf(state);
  const out: number[] = [];
  topo.vertices.forEach((vertex, index) => {
    if (!vertex.hexes.some((hex) => slot.startIsland.includes(hex))) return;
    if (vertexTouchesFog(state, index) || !freeIntersection(state, index)) return;
    out.push(index);
  });
  return out;
}

/** The settlement the player placed in the second pass. */
function setupSettlement(state: GameState, playerId: string): number | null {
  const slot = epState(state);
  const vertex = state.board.buildings.findIndex(
    (building, index) => building?.player === playerId && !harborAt(slot, index),
  );
  return vertex < 0 ? null : vertex;
}

export function setupRoadTargets(state: GameState, playerId: string): number[] {
  if (epState(state).setup?.road) return [];
  const settlement = setupSettlement(state, playerId);
  if (settlement === null) return [];
  const topo = topologyOf(state);
  return topo.vertices[settlement]!.edges.filter((edge) => {
    if (state.board.roads[edge]) return false;
    const hexes = topo.edges[edge]!.hexes;
    return hexes.some((hex) => state.board.layout.terrain[hex] !== 'sea');
  });
}

export function setupShipTargets(state: GameState, playerId: string): number[] {
  const slot = epState(state);
  if (slot.setup?.ship) return [];
  const topo = topologyOf(state);
  const out = new Set<number>();
  for (const harbor of slot.harbors) {
    if (harbor.player !== playerId) continue;
    for (const edge of topo.vertices[harbor.vertex]!.edges) {
      if (!isSeaRoute(state, edge) || shipsOnEdge(slot, edge).length > 0) continue;
      if (topo.edges[edge]!.vertices.some((vertex) => vertexTouchesFog(state, vertex))) continue;
      out.add(edge);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function setupHarbor(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = guard(state, actorId, 'harbor', ctx);
  if (refused) return refused;
  const vertex = command.vertex as number;
  if (!setupHarborTargets(state).includes(vertex)) return ctx.kit.fail('E_ILLEGAL_TARGET', { vertex });
  state.board.buildings[vertex] = { player: actorId, city: false };
  epState(state).harbors.push({ vertex, player: actorId, cargo: [] });
  ctx.kit.emit(state, 'ep.setupHarbor', { playerId: actorId, vertex });
  ctx.kit.finishSetupStep(state);
  return ctx.kit.accept(state);
}

export function setupSettlementCommand(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = guard(state, actorId, 'settlement', ctx);
  if (refused) return refused;
  const vertex = command.vertex as number;
  if (!setupSettlementTargets(state).includes(vertex)) return ctx.kit.fail('E_ILLEGAL_TARGET', { vertex });
  state.board.buildings[vertex] = { player: actorId, city: false };
  ctx.kit.emit(state, 'ep.setupSettlement', { playerId: actorId, vertex });
  grantStartingResources(state, actorId, vertex, ctx);
  ctx.kit.finishSetupStep(state);
  return ctx.kit.accept(state);
}

export function setupRoad(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = guard(state, actorId, 'route', ctx);
  if (refused) return refused;
  const edge = command.edge as number;
  if (!setupRoadTargets(state, actorId).includes(edge)) return ctx.kit.fail('E_ILLEGAL_TARGET', { edge });
  state.board.roads[edge] = { player: actorId, ship: false };
  ctx.kit.emit(state, 'ep.setupRoad', { playerId: actorId, edge });
  epState(state).setup!.road = true;
  finishRoute(state, ctx);
  return ctx.kit.accept(state);
}

export function setupShip(state: GameState, actorId: string, command: ModuleCommand, ctx: ModuleContext): CommandOutcome {
  const refused = guard(state, actorId, 'route', ctx);
  if (refused) return refused;
  const edge = command.edge as number;
  if (!setupShipTargets(state, actorId).includes(edge)) return ctx.kit.fail('E_ILLEGAL_TARGET', { edge });
  const slot = epState(state);
  const id = `s${slot.nextShip++}`;
  slot.ships.push({ id, player: actorId, edge, cargo: ['settler'] });
  ctx.kit.emit(state, 'ep.setupShip', { playerId: actorId, edge, ship: id });
  slot.setup!.ship = true;
  finishRoute(state, ctx);
  return ctx.kit.accept(state);
}

function finishRoute(state: GameState, ctx: ModuleContext): void {
  const slot = epState(state);
  if (!slot.setup!.road || !slot.setup!.ship) {
    ctx.kit.afterBoardChange(state);
    return;
  }
  slot.setup = { road: false, ship: false };
  const last = state.turn.setup!.index >= state.turn.setup!.order.length - 1;
  if (last) slot.setup = null;
  ctx.kit.finishSetupStep(state);
}

/** Every colour starts with these pieces in its supply (EP25 p. 2). */
