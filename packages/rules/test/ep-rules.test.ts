/**
 * R-EP rule fixtures (EP25 / EP25-M, CN3085). Each case names the clause it
 * checks; the start state is a real game (Land Ho! fixed start, or a later
 * mission after the scripted variable setup) adjusted on the board.
 */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, type Command } from '../src/engine.ts';
import { councilAnchors, fogAtEnds, isSeaRoute } from '../src/modules/explorersPirates/geometry.ts';
import { foundTargets, movesLeft } from '../src/modules/explorersPirates/movement.ts';
import { epState, viewTurn, type EpShip } from '../src/modules/explorersPirates/state.ts';
import { projectEvent } from '../src/project.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import type { GameState } from '../src/types.ts';
import { epGame } from './ep-helpers.ts';
import { epHints, epPlayable } from './ep-sim.ts';
import { forceTurn, scriptedRng, setHand } from './helpers.ts';
import { corner } from './seafarers-helpers.ts';

type AnyCommand = Command | { type: string; [field: string]: unknown };

function run(state: GameState, actor: string, command: AnyCommand, rng: Rng = seededRng(1)) {
  const outcome = applyCommand(state, actor, command as Command, rng);
  if (!outcome.ok) throw new Error(`rejected ${outcome.error.code} ${JSON.stringify(outcome.error.params)}`);
  return outcome;
}

function refused(state: GameState, actor: string, command: AnyCommand, rng: Rng = seededRng(1)): string {
  const outcome = applyCommand(state, actor, command as Command, rng);
  if (outcome.ok) throw new Error(`expected a refusal of ${command.type}`);
  return outcome.error.code;
}

function landHo(players: 3 | 4 = 4): GameState {
  const { state } = epGame('land-ho', players);
  forceTurn(state, 0, 'action');
  state.windowId += 1;
  return state;
}

function shipOf(state: GameState, playerId: string): EpShip {
  return epState(state).ships.find((ship) => ship.player === playerId)!;
}

/** Edges sharing an end with `edge` that ships may use. */
function nextEdges(state: GameState, edge: number): number[] {
  const topo = topologyOf(state);
  return topo.edges[edge]!.vertices.flatMap((vertex) => topo.vertices[vertex]!.edges)
    .filter((other) => other !== edge && isSeaRoute(state, other));
}

/** A sea route away from fog with a neighbour whose end touches exactly one unexplored hex. */
function exploringPair(state: GameState): { from: number; to: number } {
  const topo = topologyOf(state);
  for (let from = 0; from < topo.edges.length; from++) {
    if (!isSeaRoute(state, from) || fogAtEnds(state, from).length > 0) continue;
    const to = nextEdges(state, from).find((edge) => fogAtEnds(state, edge).length === 1);
    if (to !== undefined) return { from, to };
  }
  throw new Error('no exploring step');
}

function edgeOfHex(state: GameState, hexIndex: number): number {
  const topo = topologyOf(state);
  const edge = topo.edges.findIndex((info, index) => info.hexes.includes(hexIndex) && isSeaRoute(state, index) && fogAtEnds(state, index).length === 0);
  if (edge < 0) throw new Error(`no sea edge at ${hexIndex}`);
  return edge;
}

function gold(state: GameState, playerId: string): number {
  return epState(state).gold[playerId] ?? 0;
}

describe('R-EP turn, production and trade', () => {
  it('R-EP-01 production: buildings yield 1 each; a player who receives nothing takes 1 gold (EP25-M p. 5)', () => {
    const state = landHo();
    state.turn.phase = 'preroll';
    // Dice 4 + 5 = 9: only red's harbour settlement (bottom of the forest 9 at (1,-3)) produces.
    const after = run(state, 'p1', { type: 'turn.roll' }, scriptedRng([3, 4])).state;
    expect(after.players[0]!.resources.lumber).toBe(state.players[0]!.resources.lumber + 1);
    expect(gold(after, 'p1')).toBe(2);
    for (const id of ['p2', 'p3', 'p4']) expect(gold(after, id), id).toBe(3);
    expect(after.log.some((event) => event.type === 'ep.goldProduced')).toBe(true);
  });

  it('R-EP-02 a 7 in Land Ho!: discards only, no pirate, no theft, no gold (EP25-M p. 5; interpretation 4)', () => {
    const state = landHo();
    state.turn.phase = 'preroll';
    setHand(state, 'p2', { ore: 8 });
    const rolled = run(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3])).state;
    expect(rolled.pending?.kind).toBe('discard');
    const after = run(rolled, 'p2', { type: 'pending.discard', resources: ['ore', 'ore', 'ore', 'ore'] }).state;
    expect(after.pending).toBeNull();
    expect(after.turn.phase).toBe('action');
    expect(after.log.some((event) => event.type === 'ep.noPirate')).toBe(true);
    for (const id of ['p1', 'p3', 'p4']) expect(gold(after, id)).toBe(2);
  });

  it('R-EP-03 supply trades: 3:1, 3 of a kind → 1 gold, twice per turn 2 gold → 1 resource (EP25 p. 9)', () => {
    let state = landHo();
    setHand(state, 'p1', { ore: 6 });
    epState(state).gold.p1 = 6;
    state = run(state, 'p1', { type: 'trade.bank', give: 'ore', receive: 'wool' }).state;
    expect(state.players[0]!.resources).toMatchObject({ ore: 3, wool: 1 });
    state = run(state, 'p1', { type: 'ep.sellForGold', give: 'ore' }).state;
    expect(gold(state, 'p1')).toBe(7);
    state = run(state, 'p1', { type: 'ep.buyResource', receive: 'brick' }).state;
    state = run(state, 'p1', { type: 'ep.buyResource', receive: 'brick' }).state;
    expect(state.players[0]!.resources.brick).toBe(2);
    expect(gold(state, 'p1')).toBe(3);
    expect(refused(state, 'p1', { type: 'ep.buyResource', receive: 'brick' })).toBe('E_EP_TURN_LIMIT');
    // No Longest Road / Largest Army and no development cards.
    expect(refused(state, 'p1', { type: 'build.devCard' })).not.toBe('');
  });

  it('R-EP-04 no trading or building in the Movement phase; no ship moves in the Action phase (EP25 p. 8)', () => {
    let state = landHo();
    setHand(state, 'p1', { lumber: 2, brick: 2, wool: 2, grain: 2, ore: 2 });
    const ship = shipOf(state, 'p1');
    const step = epHints(state, 'p1').ships.length === 0 ? nextEdges(state, ship.edge)[0]! : 0;
    expect(refused(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: step })).toBe('E_EP_ACTION_PHASE');
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    expect(epHints(state, 'p1').phase).toBe('movement');
    const road = actionHints(state, 'p1').legalRoads[0];
    expect(refused(state, 'p1', { type: 'build.road', edge: road ?? 0 })).toBe('E_EP_MOVEMENT_PHASE');
    expect(refused(state, 'p1', { type: 'trade.bank', give: 'ore', receive: 'wool' })).toBe('E_EP_MOVEMENT_PHASE');
    expect(refused(state, 'p1', { type: 'ep.buildShip', edge: 0 })).toBe('E_EP_MOVEMENT_PHASE');
    expect(refused(state, 'p1', { type: 'ep.sellForGold', give: 'ore' })).toBe('E_EP_MOVEMENT_PHASE');
  });
});

describe('R-EP building', () => {
  it('R-EP-05 harbour settlement: 2 grain + 2 ore on an own coastal settlement, 2 VP (EP25 p. 9)', () => {
    let state = landHo();
    const coastal = corner(state, 0, -2, 0);
    const inland = corner(state, -3, 2, 0);
    state.board.buildings[coastal] = { player: 'p1', city: false };
    setHand(state, 'p1', { grain: 2, ore: 2 });
    const hints = epHints(state, 'p1');
    expect(hints.harbors).toContain(coastal);
    expect(hints.harbors).not.toContain(inland);
    const before = scoreOf(state, 'p1', { includeHidden: true });
    state = run(state, 'p1', { type: 'ep.buildHarbor', vertex: coastal }).state;
    expect(epState(state).harbors.some((harbor) => harbor.vertex === coastal && harbor.player === 'p1')).toBe(true);
    expect(state.board.buildings[coastal]).toEqual({ player: 'p1', city: false });
    expect(scoreOf(state, 'p1', { includeHidden: true })).toBe(before + 1);
    expect(state.players[0]!.resources).toMatchObject({ grain: 0, ore: 0 });
    expect(refused(state, 'p1', { type: 'ep.buildHarbor', vertex: inland })).not.toBe('');
  });

  it('R-EP-06 ship: lumber + wool on an empty sea edge next to an own harbour settlement, never next to fog (EP25 p. 9; interpretation 7)', () => {
    let state = landHo();
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    const harbor = epState(state).harbors.find((entry) => entry.player === 'p1')!;
    const edges = epHints(state, 'p1').shipEdges;
    expect(edges.length).toBeGreaterThan(0);
    const topo = topologyOf(state);
    for (const edge of edges) {
      expect(topo.edges[edge]!.vertices).toContain(harbor.vertex);
      expect(fogAtEnds(state, edge)).toEqual([]);
    }
    state = run(state, 'p1', { type: 'ep.buildShip', edge: edges[0]! }).state;
    const built = epState(state).ships.filter((ship) => ship.player === 'p1');
    expect(built).toHaveLength(2);
    expect(built[1]!.cargo).toEqual([]);
    expect(state.players[0]!.resources).toMatchObject({ lumber: 0, wool: 0 });
  });

  it('R-EP-07 settler and crew go onto an empty slot; a full ship refuses another large piece (EP25 p. 10)', () => {
    let state = landHo();
    setHand(state, 'p1', { lumber: 2, brick: 2, wool: 2, grain: 2 });
    const ship = shipOf(state, 'p1');
    const harbor = epState(state).harbors.find((entry) => entry.player === 'p1')!;
    expect(refused(state, 'p1', { type: 'ep.buildSettler', ship: ship.id })).toBe('E_EP_NO_ROOM');
    state = run(state, 'p1', { type: 'ep.buildSettler', harbor: harbor.vertex }).state;
    expect(epState(state).harbors.find((entry) => entry.vertex === harbor.vertex)!.cargo).toEqual(['settler']);
    expect(epHints(state, 'p1').settlersLeft).toBe(0);
    // Land Ho! has no crews.
    expect(refused(state, 'p1', { type: 'ep.buildCrew', ship: ship.id })).toBe('E_EP_NOT_IN_SCENARIO');
  });
});

describe('R-EP movement and exploring', () => {
  it('R-EP-08 a ship has 4 MP, 6 with the extra wool; one edge per MP (EP25 p. 10)', () => {
    let state = landHo();
    setHand(state, 'p1', { wool: 1 });
    const ship = shipOf(state, 'p1');
    state = run(state, 'p1', { type: 'ep.extraMove', ship: ship.id }).state;
    expect(state.players[0]!.resources.wool).toBe(0);
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    const moving = shipOf(state, 'p1');
    expect(movesLeft(state, moving, viewTurn(state))).toBe(6);
    // Shuttle between two edges away from the fog.
    const home = moving.edge;
    const away = epHints(state, 'p1').ships[0]!.steps.find((step) => !step.explores && !step.full)!.edge;
    for (let i = 0; i < 6; i++) state = run(state, 'p1', { type: 'ep.moveShip', ship: moving.id, edge: i % 2 === 0 ? away : home }).state;
    expect(movesLeft(state, shipOf(state, 'p1'), viewTurn(state))).toBe(0);
    expect(refused(state, 'p1', { type: 'ep.moveShip', ship: moving.id, edge: away })).toBe('E_EP_NO_MP');
  });

  it('R-EP-09 exploring flips the hex from its region, pays 1 resource or 2 gold, and ends the ship’s move (EP25 p. 12)', () => {
    let state = landHo();
    const ship = shipOf(state, 'p1');
    const { from, to } = exploringPair(state);
    ship.edge = from;
    const [fogHex] = fogAtEnds(state, to);
    const region = epState(state).fog.find((entry) => entry.hex === fogHex)!.region;
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    // Region multiset order: sea, hills, …; pick 0 draws a sea hex → 2 gold.
    const outcome = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: to }, scriptedRng([0]));
    state = outcome.state;
    expect(epState(state).fog.some((entry) => entry.hex === fogHex)).toBe(false);
    expect(state.board.layout.terrain[fogHex!]).toBe('sea');
    expect(gold(state, 'p1')).toBe(4);
    const explored = outcome.events.find((event) => event.type === 'ep.explored')!;
    expect(explored.params).toMatchObject({ playerId: 'p1', hex: fogHex, region, tile: 'sea', reward: { gold: 2 } });
    expect(epHints(state, 'p1').ships[0]!.done).toBe(true);
    expect(refused(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: from })).toBe('E_EP_SHIP_DONE');
  });

  it('R-EP-10 exploring a land hex draws its number disc and pays its resource (EP25 p. 12)', () => {
    let state = landHo();
    const ship = shipOf(state, 'p1');
    const { from, to } = exploringPair(state);
    ship.edge = from;
    const [fogHex] = fogAtEnds(state, to);
    const region = epState(state).fog.find((entry) => entry.hex === fogHex)!.region;
    const disc = epState(state).pools[region].discs[0];
    const lumber = state.players[0]!.resources.lumber;
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    // Index 2 + 1 (hills) … : sea 0–1, hills 2, forest 3.
    state = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: to }, scriptedRng([3, 0])).state;
    expect(state.board.layout.terrain[fogHex!]).toBe('forest');
    expect(state.board.layout.numbers[fogHex!]).toBe(disc);
    expect(state.players[0]!.resources.lumber).toBe(lumber + 1);
    expect(epState(state).pools[region].tiles.forest).toBe(0);
  });

  it('R-EP-11 a settler ship founds a settlement; ship and settler return (EP25 p. 12)', () => {
    let state = landHo();
    const ship = shipOf(state, 'p1');
    const topo = topologyOf(state);
    const original = ship.edge;
    const edge = topo.edges.findIndex((_, index) => {
      if (!isSeaRoute(state, index)) return false;
      ship.edge = index;
      return foundTargets(state, ship).length > 0;
    });
    ship.edge = edge >= 0 ? edge : original;
    const vertex = foundTargets(state, ship)[0]!;
    const before = scoreOf(state, 'p1', { includeHidden: true });
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    expect(epHints(state, 'p1').ships[0]!.found).toContain(vertex);
    state = run(state, 'p1', { type: 'ep.found', ship: ship.id, vertex }).state;
    expect(state.board.buildings[vertex]).toEqual({ player: 'p1', city: false });
    expect(epState(state).ships.some((candidate) => candidate.id === ship.id)).toBe(false);
    expect(scoreOf(state, 'p1', { includeHidden: true })).toBe(before + 1);
    expect(epHints(state, 'p1').settlersLeft).toBe(2);
  });

  it('R-EP-12 two ships per edge: a ship may pass a full edge but not stop there (EP25 p. 10)', () => {
    let state = landHo();
    const mine = shipOf(state, 'p1');
    const full = nextEdges(state, mine.edge).find((edge) => fogAtEnds(state, edge).length === 0
      && nextEdges(state, edge).some((other) => other !== mine.edge && fogAtEnds(state, other).length === 0))!;
    shipOf(state, 'p2').edge = full;
    shipOf(state, 'p3').edge = full;
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    const step = epHints(state, 'p1').ships[0]!.steps.find((candidate) => candidate.edge === full)!;
    expect(step.full).toBe(true);
    state = run(state, 'p1', { type: 'ep.moveShip', ship: mine.id, edge: full }).state;
    expect(epHints(state, 'p1').stranded).toBe(true);
    expect(refused(state, 'p1', { type: 'turn.end' })).toBe('E_EP_EDGE_FULL');
    const onward = epHints(state, 'p1').ships[0]!.steps.find((candidate) => !candidate.full)!.edge;
    state = run(state, 'p1', { type: 'ep.moveShip', ship: mine.id, edge: onward }).state;
    expect(run(state, 'p1', { type: 'turn.end' }).state.turn.seat).toBe(1);
  });

  it('R-EP-13 the target ends the game at once during the own turn (EP25 p. 15: 8 VP in Land Ho!)', () => {
    let state = landHo();
    // 3 VP printed + 2 settlements + 1 harbour settlement = 7 (4 of 5 plain
    // settlements in play); founding the next one makes 8.
    const ship = shipOf(state, 'p1');
    const topo = topologyOf(state);
    const edge = topo.edges.findIndex((_, index) => {
      if (!isSeaRoute(state, index)) return false;
      ship.edge = index;
      return foundTargets(state, ship).length > 0;
    });
    ship.edge = edge;
    const vertex = foundTargets(state, ship)[0]!;
    const spare = topo.vertices.map((_, index) => index).filter((index) => index !== vertex && !state.board.buildings[index]
      && topo.vertices[index]!.hexes.every((cell) => state.board.layout.terrain[cell] === 'sea')
      && !topo.vertices[vertex]!.edges.some((e) => topo.edges[e]!.vertices.includes(index))).slice(0, 3);
    for (const index of spare) state.board.buildings[index] = { player: 'p1', city: false };
    epState(state).harbors.push({ vertex: spare[2]!, player: 'p1', cargo: [] });
    expect(scoreOf(state, 'p1', { includeHidden: true })).toBe(7);
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    state = run(state, 'p1', { type: 'ep.found', ship: ship.id, vertex }).state;
    expect(state.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
  });
});

describe('R-EP variable setup (EP25 p. 7, EP25-M p. 9)', () => {
  it('R-EP-14 harbour on a mark, settlement on the island, then road and settler ship; base setup refused', () => {
    let { state } = epGame('pirate-lairs', 3);
    expect(refused(state, 'p1', { type: 'setup.placeBuilding', vertex: 0 })).toBe('E_INVALID_COMMAND');
    const order: string[] = [];
    while (state.turn.phase === 'setup') {
      const setup = state.turn.setup!;
      const actor = state.players[setup.order[setup.index]!]!.id;
      const hints = epHints(state, actor).setup!;
      order.push(`${actor}:${hints.step}`);
      if (hints.step === 'harbor') {
        for (const vertex of hints.harbor) expect(epState(state).harborMarks).toContain(vertex);
        state = run(state, actor, { type: 'ep.setupHarbor', vertex: hints.harbor[0]! }).state;
      } else if (hints.step === 'settlement') {
        for (const vertex of hints.settlement) {
          expect(topologyOf(state).vertices[vertex]!.hexes.some((cell) => epState(state).startIsland.includes(cell))).toBe(true);
        }
        state = run(state, actor, { type: 'ep.setupSettlement', vertex: hints.settlement[0]! }).state;
      } else if (hints.ship.length > 0 && !epState(state).ships.some((ship) => ship.player === actor)) {
        state = run(state, actor, { type: 'ep.setupShip', edge: hints.ship[0]! }).state;
      } else {
        state = run(state, actor, { type: 'ep.setupRoad', edge: hints.road[0]! }).state;
      }
    }
    expect(order.slice(0, 6)).toEqual(['p1:harbor', 'p2:harbor', 'p3:harbor', 'p3:settlement', 'p2:settlement', 'p1:settlement']);
    expect(order.slice(6).every((entry) => entry.endsWith(':route'))).toBe(true);
    const slot = epState(state);
    for (const player of state.players) {
      expect(slot.harbors.filter((harbor) => harbor.player === player.id)).toHaveLength(1);
      expect(slot.ships.filter((ship) => ship.player === player.id).map((ship) => ship.cargo)).toEqual([['settler']]);
      expect(state.board.roads.filter((road) => road?.player === player.id)).toHaveLength(1);
      expect(scoreOf(state, player.id, { includeHidden: true })).toBe(3);
    }
    expect(state.turn.phase).toBe('preroll');
  });
});

describe('R-EP pirates (Pirate Lairs on)', () => {
  it('R-EP-15 a 7 activates the roller’s pirate ship: not next to the starting island, robs a ship owner (EP25 p. 8)', () => {
    let state = epPlayable('pirate-lairs', 3);
    state.turn.phase = 'preroll';
    for (const player of state.players) setHand(state, player.id, {});
    state = run(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3])).state;
    expect(state.pending?.kind).toBe('explorersPirates.pirate');
    const targets = epHints(state, 'p1').pirateTargets;
    const slot = epState(state);
    const topo = topologyOf(state);
    for (const target of targets) {
      const touchesIsland = topo.hexes.some((_, cell) => slot.startIsland.includes(cell)
        && topo.edges.some((edge) => edge.hexes.includes(cell) && edge.hexes.includes(target)));
      expect(touchesIsland).toBe(false);
      expect(state.board.layout.terrain[target]).toBe('sea');
    }
    const target = targets[0]!;
    shipOf(state, 'p2').edge = edgeOfHex(state, target);
    setHand(state, 'p2', { ore: 1 });
    const outcome = run(state, 'p1', { type: 'ep.placePirate', hex: target }, scriptedRng([0]));
    state = outcome.state;
    expect(epState(state).pirate).toEqual({ hex: target, owner: 'p1' });
    expect(state.players[0]!.resources.ore).toBe(1);
    expect(state.players[1]!.resources.ore).toBe(0);
    const stole = outcome.events.find((event) => event.type === 'ep.pirateStole')!;
    expect(projectEvent(stole, 'p3').params).not.toHaveProperty('resource');
    expect(projectEvent(stole, 'p2').params).toMatchObject({ resource: 'ore' });
    expect(state.pending).toBeNull();
  });

  it('R-EP-16 a victim without resources loses 1 gold (EP25-M p. 10)', () => {
    let state = epPlayable('pirate-lairs', 3);
    state.turn.phase = 'preroll';
    for (const player of state.players) setHand(state, player.id, {});
    state = run(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3])).state;
    const target = epHints(state, 'p1').pirateTargets[0]!;
    shipOf(state, 'p2').edge = edgeOfHex(state, target);
    state = run(state, 'p1', { type: 'ep.placePirate', hex: target }).state;
    expect(gold(state, 'p2')).toBe(1);
    expect(gold(state, 'p1')).toBe(3);
  });

  it('R-EP-17 tribute: 1 gold once per ship per turn next to an opponent’s pirate; none without gold (EP25 p. 10; interpretation 9)', () => {
    let state = epPlayable('pirate-lairs', 3);
    const ship = shipOf(state, 'p1');
    const slot = epState(state);
    const pirateHex = topologyOf(state).edges[ship.edge]!.hexes.find((cell) => state.board.layout.terrain[cell] === 'sea'
      && !slot.fog.some((entry) => entry.hex === cell))!;
    slot.pirate = { hex: pirateHex, owner: 'p2' };
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    const steps = epHints(state, 'p1').ships[0]!.steps;
    expect(steps.every((step) => step.tribute)).toBe(true);
    const first = steps.find((step) => !step.explores)!.edge;
    state = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: first }).state;
    expect(gold(state, 'p1')).toBe(1);
    expect(epHints(state, 'p1').ships[0]!.steps.every((step) => !step.tribute)).toBe(true);
    // Without gold the step is refused.
    let poor = epPlayable('pirate-lairs', 3);
    epState(poor).pirate = { hex: pirateHex, owner: 'p2' };
    epState(poor).gold.p1 = 0;
    poor = run(poor, 'p1', { type: 'ep.startMovement' }).state;
    expect(epHints(poor, 'p1').ships[0]!.steps).toEqual([]);
    expect(refused(poor, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: first })).toBe('E_EP_TRIBUTE');
  });

  it('R-EP-18 chase: an unmoved ship at the pirate’s hex rolls; a 6 returns it and activates the chaser’s pirate (EP25 p. 11)', () => {
    let state = epPlayable('pirate-lairs', 3);
    const ship = shipOf(state, 'p1');
    const pirateHex = topologyOf(state).edges[ship.edge]!.hexes.find((cell) => state.board.layout.terrain[cell] === 'sea')!;
    epState(state).pirate = { hex: pirateHex, owner: 'p2' };
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    expect(epHints(state, 'p1').ships[0]!.chase).toBe(true);
    const missed = run(state, 'p1', { type: 'ep.chase', ship: ship.id }, scriptedRng([4])).state;
    expect(epState(missed).pirate).toEqual({ hex: pirateHex, owner: 'p2' });
    expect(epHints(missed, 'p1').ships[0]!.chase).toBe(false);
    state = run(state, 'p1', { type: 'ep.chase', ship: ship.id }, scriptedRng([5])).state;
    expect(epState(state).pirate).toBeNull();
    expect(state.pending?.kind).toBe('explorersPirates.pirate');
    expect(epHints(state, 'p1').pirateTargets).not.toContain(pirateHex);
  });

  it('R-EP-19 a lair captured by 3 crews: gold and track for each, the hero +1 and loses a crew, the token sets the number (EP25 p. 13)', () => {
    let state = epPlayable('pirate-lairs', 3);
    const slot = epState(state);
    const lair = slot.fog[0]!.hex;
    slot.fog.shift();
    state.board.layout.terrain[lair] = 'gold';
    slot.sites.push({ hex: lair, kind: 'lair', crews: ['p1', 'p2', 'p3'], captured: false });
    slot.captures.push(lair);
    // Dice p1 6, p2 1, p3 1 → p1 is the hero; lair token index 0 → 2.
    const outcome = run(state, 'p1', { type: 'turn.end' }, scriptedRng([5, 0, 0, 0]));
    state = outcome.state;
    const site = epState(state).sites.find((entry) => entry.hex === lair)!;
    expect(site).toMatchObject({ kind: 'lair', captured: true, crews: ['p2', 'p3'] });
    expect(state.board.layout.numbers[lair]).toBe(2);
    expect(epState(state).tracks.lairs!.positions).toEqual({ p1: 2, p2: 1, p3: 1 });
    for (const id of ['p1', 'p2', 'p3']) expect(gold(state, id)).toBe(4);
    expect(outcome.events.find((event) => event.type === 'ep.lairCaptured')!.params).toMatchObject({ hex: lair, hero: 'p1', number: 2 });
    // A captured gold field pays 2 gold per adjacent building on its number.
    const vertex = topologyOf(state).vertices.findIndex((info) => info.hexes.includes(lair));
    state.board.buildings[vertex] = { player: 'p2', city: false };
    state.turn.phase = 'preroll';
    state.turn.seat = 1;
    const produced = run(state, 'p2', { type: 'turn.roll' }, scriptedRng([0, 0])).state;
    expect(gold(produced, 'p2')).toBe(6);
  });

  it('R-EP-20 mission tracks: printed values, bonus tile to the furthest; a tie keeps the earlier arrival (EP25 p. 13)', () => {
    const state = epPlayable('pirate-lairs', 3);
    const track = epState(state).tracks.lairs!;
    track.positions = { p1: 2, p2: 2, p3: 1 };
    track.arrivals = { p1: 5, p2: 3, p3: 4 };
    // Space 2 = 1 VP; p2 arrived first and holds the bonus tile (+1).
    const base = (id: string) => scoreOf(state, id, { includeHidden: true });
    track.positions = { p1: 0, p2: 0, p3: 0 };
    const zero = { p1: base('p1'), p2: base('p2'), p3: base('p3') };
    track.positions = { p1: 2, p2: 2, p3: 1 };
    expect(base('p1') - zero.p1).toBe(1);
    expect(base('p2') - zero.p2).toBe(2);
    expect(base('p3') - zero.p3).toBe(1);
  });
});

describe('R-EP fish and spices', () => {
  function fishState(): { state: GameState; shoal: number } {
    const state = epPlayable('fish', 3);
    const slot = epState(state);
    const ship = shipOf(state, 'p1');
    const shoal = topologyOf(state).edges[ship.edge]!.hexes.find((cell) => state.board.layout.terrain[cell] === 'sea' && cell !== slot.council)!;
    slot.sites.push({ hex: shoal, kind: 'shoal', number: 3, fish: false });
    return { state, shoal };
  }

  it('R-EP-21 fish roll: a haul on the shoal with the number, once per Movement phase (EP25 p. 14)', () => {
    let { state, shoal } = fishState();
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    state = run(state, 'p1', { type: 'ep.fishRoll' }, scriptedRng([2])).state;
    expect(epState(state).sites.find((site) => site.hex === shoal)).toMatchObject({ fish: true });
    expect(epState(state).fishSupply).toBe(5);
    expect(refused(state, 'p1', { type: 'ep.fishRoll' })).toBe('E_EP_TURN_LIMIT');
  });

  it('R-EP-22 a haul loaded and delivered at a Council anchor advances the fish track (EP25 p. 14)', () => {
    let { state, shoal } = fishState();
    Object.assign(epState(state).sites.find((site) => site.hex === shoal)!, { fish: true });
    epState(state).fishSupply = 5;
    const ship = shipOf(state, 'p1');
    ship.cargo = [];
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    state = run(state, 'p1', { type: 'ep.loadFish', ship: ship.id, hex: shoal }).state;
    expect(shipOf(state, 'p1').cargo).toContain('fish');
    // Sail to an anchor of the Council (moved on the board for the fixture).
    const anchor = councilAnchors(state, epState(state))[0]!;
    shipOf(state, 'p1').edge = topologyOf(state).vertices[anchor]!.edges.find((edge) => isSeaRoute(state, edge))!;
    expect(epHints(state, 'p1').ships[0]!.deliver).toBe(true);
    const before = scoreOf(state, 'p1', { includeHidden: true });
    state = run(state, 'p1', { type: 'ep.deliver', ship: ship.id }).state;
    expect(epState(state).tracks.fish!.positions.p1).toBe(1);
    expect(epState(state).fishSupply).toBe(6);
    // Space 1 = 1 VP plus the bonus tile.
    expect(scoreOf(state, 'p1', { includeHidden: true })).toBe(before + 2);
  });

  it('R-EP-23 a pirate placed on a shoal scares its haul away (EP25 p. 14)', () => {
    let state = epPlayable('fish', 3);
    state.turn.phase = 'preroll';
    for (const player of state.players) setHand(state, player.id, {});
    state = run(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3])).state;
    const shoal = epHints(state, 'p1').pirateTargets[0]!;
    epState(state).sites.push({ hex: shoal, kind: 'shoal', number: 4, fish: true });
    epState(state).fishSupply = 5;
    state = run(state, 'p1', { type: 'ep.placePirate', hex: shoal }).state;
    expect(epState(state).sites.find((site) => site.hex === shoal)).toMatchObject({ fish: false });
    expect(epState(state).fishSupply).toBe(6);
    // No haul is placed while the pirate is there.
    state.turn.phase = 'action';
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    state = run(state, 'p1', { type: 'ep.fishRoll' }, scriptedRng([3])).state;
    expect(epState(state).sites.find((site) => site.hex === shoal)).toMatchObject({ fish: false });
  });

  it('R-EP-24 spice farm: a crew stays, grants the ability and loads 1 sack per player (EP25 p. 14)', () => {
    let state = epPlayable('spices', 3);
    const slot = epState(state);
    const ship = shipOf(state, 'p1');
    const farm = slot.fog[0]!.hex;
    slot.fog.shift();
    state.board.layout.terrain[farm] = 'desert';
    slot.sites.push({ hex: farm, kind: 'spice', ability: 'swift', bonus: null, crews: [], sacks: ['p1', 'p2', 'p3'] });
    ship.edge = edgeOfHex(state, farm);
    ship.cargo = ['crew'];
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    const before = movesLeft(state, shipOf(state, 'p1'), viewTurn(state));
    state = run(state, 'p1', { type: 'ep.dropCrew', ship: ship.id, hex: farm }).state;
    expect(epState(state).sites.find((site) => site.hex === farm)).toMatchObject({ crews: ['p1'] });
    expect(movesLeft(state, shipOf(state, 'p1'), viewTurn(state))).toBe(before + 1);
    state = run(state, 'p1', { type: 'ep.loadSpice', ship: ship.id, hex: farm }).state;
    expect(shipOf(state, 'p1').cargo).toEqual(['spice']);
    expect(refused(state, 'p1', { type: 'ep.loadSpice', ship: ship.id, hex: farm })).not.toBe('');
    expect(refused(state, 'p1', { type: 'ep.dropCrew', ship: ship.id, hex: farm })).not.toBe('');
  });
});

describe('R-EP command receipts', () => {
  it('keeps a rejected command from changing the state', () => {
    const state = landHo();
    const before = JSON.stringify(state);
    refused(state, 'p2', { type: 'ep.startMovement' });
    expect(JSON.stringify(state)).toBe(before);
  });
});
