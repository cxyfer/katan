/**
 * R-EP clause fixtures, part 2: every clause of the transcription
 * (docs/aegis/work/2026-11-02-explorers-pirates.md, "Rule clauses") that
 * `ep-rules.test.ts` does not already pin down, with its source page.
 */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints } from '../src/engine.ts';
import type { EpTile } from '../src/explorers-pirates-boards.ts';
import { LAIR_TOKENS } from '../src/modules/explorersPirates/core.ts';
import { councilAnchors, fogAtEnds, isSeaRoute, vertexTouchesFog } from '../src/modules/explorersPirates/geometry.ts';
import { foundTargets, movesLeft } from '../src/modules/explorersPirates/movement.ts';
import { pieceTargets } from '../src/modules/explorersPirates/economy.ts';
import { piecesInPlay } from '../src/modules/explorersPirates/core.ts';
import { pirateTargets } from '../src/modules/explorersPirates/pirate.ts';
import { epState, viewTurn, type EpRegionPool, type EpShip } from '../src/modules/explorersPirates/state.ts';
import { hexNeighbors, type BoardTopology } from '../src/topology.ts';
import type { GameState } from '../src/types.ts';
import { edgeOfHex, exploringPair, gold, landHo, nextEdges, refused, run, shipOf } from './ep-helpers.ts';
import { epHints, epPlayable, epView as projectEpView } from './ep-sim.ts';
import { forceTurn, newGame, scriptedRng, setHand } from './helpers.ts';

/** Intersections one edge away from `vertex`. */
function neighborsOfVertex(topo: BoardTopology, vertex: number): number[] {
  return topo.vertices[vertex]!.edges.map((edge) => topo.edges[edge]!.vertices.find((other) => other !== vertex)!);
}

const TILE_ORDER: readonly EpTile[] = ['sea', 'hills', 'forest', 'pasture', 'fields', 'mountains', 'gold', 'shoal', 'spice'];

/** The scripted draw that picks `tile` from a region pool (tiles are drawn in TILE_ORDER). */
function pickOf(pool: EpRegionPool, tile: EpTile): number {
  let index = 0;
  for (const entry of TILE_ORDER) {
    if (entry === tile) {
      if (!pool.tiles[entry]) throw new Error(`no ${tile} left`);
      return index;
    }
    index += pool.tiles[entry] ?? 0;
  }
  throw new Error('unknown tile');
}

/** A ship of `playerId` placed one step from a fog hex of a region whose pool holds `tile`. */
function aimAt(state: GameState, playerId: string, tile: EpTile): { ship: EpShip; to: number; hex: number; pick: number } {
  const slot = epState(state);
  const topo = topologyOf(state);
  const ship = shipOf(state, playerId);
  for (let from = 0; from < topo.edges.length; from++) {
    if (!isSeaRoute(state, from) || fogAtEnds(state, from).length > 0) continue;
    for (const to of nextEdges(state, from)) {
      const fog = fogAtEnds(state, to);
      if (fog.length !== 1) continue;
      const region = slot.fog.find((entry) => entry.hex === fog[0])!.region;
      if (!slot.pools[region].tiles[tile]) continue;
      ship.edge = from;
      return { ship, to, hex: fog[0]!, pick: pickOf(slot.pools[region], tile) };
    }
  }
  throw new Error(`no fog hex with ${tile} reachable`);
}

/** Moves the turn to the Movement phase of seat 0. */
function moving(state: GameState): GameState {
  return run(state, 'p1', { type: 'ep.startMovement' }).state;
}

/** A sea edge with a settler ship next to its own harbour settlement. */
function shipAtHarbor(state: GameState, playerId: string): { ship: EpShip; harbor: number } {
  const slot = epState(state);
  const topo = topologyOf(state);
  const harbor = slot.harbors.find((entry) => entry.player === playerId)!;
  const ship = shipOf(state, playerId);
  ship.edge = topo.vertices[harbor.vertex]!.edges.find((edge) => isSeaRoute(state, edge) && fogAtEnds(state, edge).length === 0)!;
  return { ship, harbor: harbor.vertex };
}

describe('R-EP building limits (EP25 p. 9, EP25-M pp. 5–6)', () => {
  it('R-EP-25 no road or settlement touching an unexplored hex (EP25 p. 9; EP25-M p. 5)', () => {
    const state = landHo();
    const slot = epState(state);
    const topo = topologyOf(state);
    setHand(state, 'p1', { lumber: 5, brick: 5, wool: 5, grain: 5 });
    const hints = actionHints(state, 'p1');
    for (const edge of hints.legalRoads) {
      expect(topo.edges[edge]!.hexes.some((hex) => slot.fog.some((entry) => entry.hex === hex))).toBe(false);
    }
    for (const vertex of hints.legalSettlements) expect(vertexTouchesFog(state, vertex)).toBe(false);
    // A revealed hex F next to an unexplored hex G: their shared corner and edge stay closed until G is explored.
    let pair: { f: number; g: number } | null = null;
    for (const entry of slot.fog) {
      const g = hexNeighbors(topo, entry.hex).find((hex) => slot.fog.some((other) => other.hex === hex));
      if (g !== undefined) { pair = { f: entry.hex, g }; break; }
    }
    expect(pair).not.toBeNull();
    const { f, g } = pair!;
    slot.fog = slot.fog.filter((entry) => entry.hex !== f);
    state.board.layout.terrain[f] = 'forest';
    const shared = topo.edges.findIndex((info) => info.hexes.includes(f) && info.hexes.includes(g));
    const vertex = topo.edges[shared]!.vertices.find((corner) => neighborsOfVertex(topo, corner).every((neighbor) => !state.board.buildings[neighbor]))!;
    const road = topo.vertices[vertex]!.edges.find((edge) => edge !== shared && topo.edges[edge]!.hexes.includes(f))!;
    state.board.roads[road] = { player: 'p1', ship: false };
    expect(refused(state, 'p1', { type: 'build.settlement', vertex })).toBe('E_ILLEGAL_TARGET');
    expect(refused(state, 'p1', { type: 'build.road', edge: shared })).toBe('E_ILLEGAL_TARGET');
    // Control: the same moves are legal once G (and any other unexplored hex at that corner) is explored land.
    const open = JSON.parse(JSON.stringify(state)) as GameState;
    for (const hex of topo.vertices[vertex]!.hexes.filter((cell) => cell !== f)) {
      epState(open).fog = epState(open).fog.filter((entry) => entry.hex !== hex);
      open.board.layout.terrain[hex] = 'hills';
    }
    expect(run(open, 'p1', { type: 'build.road', edge: shared }).state.board.roads[shared]).toEqual({ player: 'p1', ship: false });
    expect(run(open, 'p1', { type: 'build.settlement', vertex }).state.board.buildings[vertex]).toMatchObject({ player: 'p1' });
  });

  it('R-EP-26 at most 4 harbour settlements; a harbour holds 1 large or 2 small pieces (EP25 pp. 9–10)', () => {
    let state = epPlayable('pirate-lairs', 3);
    const slot = epState(state);
    const topo = topologyOf(state);
    // Three more own harbour settlements anywhere on the coast make four.
    const coast = topo.vertices.map((_, index) => index).filter((index) => !state.board.buildings[index]
      && topo.vertices[index]!.hexes.some((hex) => slot.startIsland.includes(hex))
      && topo.vertices[index]!.hexes.some((hex) => state.board.layout.terrain[hex] === 'sea')
      && neighborsOfVertex(topo, index).every((neighbor) => !state.board.buildings[neighbor]));
    const spare: number[] = [];
    for (const index of coast) {
      if (spare.length === 4) break;
      if (spare.some((other) => neighborsOfVertex(topo, other).includes(index))) continue;
      spare.push(index);
    }
    for (const vertex of spare.slice(0, 3)) {
      state.board.buildings[vertex] = { player: 'p1', city: false };
      slot.harbors.push({ vertex, player: 'p1', cargo: [] });
    }
    state.board.buildings[spare[3]!] = { player: 'p1', city: false };
    setHand(state, 'p1', { grain: 2, ore: 2, wool: 4, lumber: 1, brick: 1 });
    expect(epHints(state, 'p1').harbors).toEqual([]);
    expect(refused(state, 'p1', { type: 'ep.buildHarbor', vertex: spare[3]! })).toBe('E_NO_PIECES');
    // Capacity: two crews fill a harbour.
    const harbor = spare[0]!;
    state = run(state, 'p1', { type: 'ep.buildCrew', harbor }).state;
    state = run(state, 'p1', { type: 'ep.buildCrew', harbor }).state;
    expect(epState(state).harbors.find((entry) => entry.vertex === harbor)!.cargo).toEqual(['crew', 'crew']);
    expect(refused(state, 'p1', { type: 'ep.buildCrew', harbor })).toBe('E_EP_NO_ROOM');
  });

  it('R-EP-27 no ship left in the supply: return one with its cargo, then build (EP25 p. 9)', () => {
    let state = epPlayable('fish', 3);
    const slot = epState(state);
    const own = slot.ships.filter((ship) => ship.player === 'p1');
    const harbor = slot.harbors.find((entry) => entry.player === 'p1')!;
    const topo = topologyOf(state);
    const free = topo.edges.map((_, index) => index).filter((edge) => isSeaRoute(state, edge)
      && fogAtEnds(state, edge).length === 0 && !slot.ships.some((ship) => ship.edge === edge));
    while (slot.ships.filter((ship) => ship.player === 'p1').length < 3) {
      slot.ships.push({ id: `x${slot.nextShip++}`, player: 'p1', edge: free.pop()!, cargo: [] });
    }
    const old = slot.ships.filter((ship) => ship.player === 'p1').at(-1)!;
    old.cargo = ['fish'];
    slot.fishSupply -= 1;
    setHand(state, 'p1', { lumber: 2, wool: 2 });
    const edge = epHints(state, 'p1').shipEdges[0]!;
    expect(topo.edges[edge]!.vertices).toContain(harbor.vertex);
    expect(epHints(state, 'p1').shipReplace).toBe(true);
    expect(refused(state, 'p1', { type: 'ep.buildShip', edge })).toBe('E_NO_PIECES');
    const fish = epState(state).fishSupply;
    const outcome = run(state, 'p1', { type: 'ep.buildShip', edge, replace: old.id });
    state = outcome.state;
    expect(epState(state).ships.some((ship) => ship.id === old.id)).toBe(false);
    expect(epState(state).ships.filter((ship) => ship.player === 'p1')).toHaveLength(3);
    expect(epState(state).fishSupply).toBe(fish + 1);
    expect(outcome.events.map((event) => event.type)).toEqual(expect.arrayContaining(['ep.shipReturned', 'ep.shipBuilt']));
    expect(own.length).toBeGreaterThan(0);
  });

  it('R-EP-28 a full holder returns exactly one named piece, only when every holder is full (EP25 p. 10)', () => {
    let state = epPlayable('fish', 3);
    const { ship, harbor } = shipAtHarbor(state, 'p1');
    const holders = pieceTargets(state, 'p1');
    const harborOf = (s: GameState) => epState(s).harbors.find((entry) => entry.vertex === harbor)!;
    setHand(state, 'p1', { lumber: 4, brick: 4, wool: 4, grain: 4, ore: 4 });
    // Every other holder is full of crews; the ship holds its settler and this harbour is empty.
    for (const holder of holders) {
      if ('harbor' in holder && holder.harbor.vertex !== harbor) holder.harbor.cargo = ['crew', 'crew'];
      if ('ship' in holder && holder.ship.id !== ship.id) holder.ship.cargo = ['crew', 'crew'];
    }
    harborOf(state).cargo = [];
    expect(refused(state, 'p1', { type: 'ep.buildCrew', ship: ship.id })).toBe('E_EP_NO_ROOM');
    expect(refused(state, 'p1', { type: 'ep.buildCrew', ship: ship.id, remove: 'settler' })).toBe('E_EP_ROOM_ELSEWHERE');
    expect(refused(state, 'p1', { type: 'ep.buildCrew', harbor, remove: 'crew' })).toBe('E_INVALID_SELECTION');
    // Now every slot is full: harbour [crew, spice], ship [settler].
    harborOf(state).cargo = ['crew', 'spice'];
    expect(refused(state, 'p1', { type: 'ep.buildCrew', harbor })).toBe('E_EP_NO_ROOM');
    expect(refused(state, 'p1', { type: 'ep.buildCrew', harbor, remove: 'fish' })).toBe('E_INVALID_SELECTION');
    expect(refused(state, 'p1', { type: 'ep.buildCrew', harbor, remove: 'anchor' })).toBe('E_INVALID_SELECTION');
    // A crew replaces one small piece: the other one stays.
    let outcome = run(state, 'p1', { type: 'ep.buildCrew', harbor, remove: 'spice' });
    expect(harborOf(outcome.state).cargo).toEqual(['crew', 'crew']);
    expect(outcome.events.find((event) => event.type === 'ep.crewBuilt')!.params).toMatchObject({ harbor, removed: ['spice'] });
    // A crew replacing a crew keeps the count of crews on the board.
    const crews = piecesInPlay(outcome.state, 'p1', 'crew');
    outcome = run(outcome.state, 'p1', { type: 'ep.buildCrew', harbor, remove: 'crew' });
    expect(harborOf(outcome.state).cargo).toEqual(['crew', 'crew']);
    expect(piecesInPlay(outcome.state, 'p1', 'crew')).toBe(crews);
    // A settler needs an empty holder: removing one of two small pieces is not enough.
    state = outcome.state;
    expect(refused(state, 'p1', { type: 'ep.buildSettler', harbor, remove: 'crew' })).toBe('E_EP_NO_ROOM');
    // A large piece leaves the holder empty: a fish haul goes back to the fish supply.
    shipOf(state, 'p1').cargo = ['fish'];
    epState(state).fishSupply -= 1;
    const fish = epState(state).fishSupply;
    outcome = run(state, 'p1', { type: 'ep.buildSettler', ship: ship.id, remove: 'fish' });
    expect(shipOf(outcome.state, 'p1').cargo).toEqual(['settler']);
    expect(epState(outcome.state).fishSupply).toBe(fish + 1);
    // A crew onto a holder with one large piece returns that piece.
    outcome = run(outcome.state, 'p1', { type: 'ep.buildCrew', ship: ship.id, remove: 'settler' });
    expect(shipOf(outcome.state, 'p1').cargo).toEqual(['crew']);
  });

  it('R-EP-48 piece limits: 2 settlers, 9 crews, 5 settlements and 4 harbour settlements (EP25 pp. 2, 9–10)', () => {
    const state = epPlayable('fish', 3);
    const { harbor } = shipAtHarbor(state, 'p1');
    const slot = epState(state);
    setHand(state, 'p1', { lumber: 4, brick: 4, wool: 4, grain: 4, ore: 4 });
    // Settlers: the ship's settler plus one in the harbour make two.
    slot.harbors.find((entry) => entry.vertex === harbor)!.cargo = ['settler'];
    for (const holder of pieceTargets(state, 'p1')) if ('ship' in holder) holder.ship.cargo = [];
    expect(piecesInPlay(state, 'p1', 'settler')).toBe(1);
    const free = pieceTargets(state, 'p1').find((holder) => 'ship' in holder)!;
    const first = run(state, 'p1', { type: 'ep.buildSettler', ship: (free as { ship: EpShip }).ship.id });
    expect(piecesInPlay(first.state, 'p1', 'settler')).toBe(2);
    // Both settlers are in play: no third, even by returning a piece.
    expect(refused(first.state, 'p1', { type: 'ep.buildSettler', harbor, remove: 'settler' })).toBe('E_NO_PIECES');
    // Crews: nine anywhere (here on lairs) leave none to build.
    const crewState = JSON.parse(JSON.stringify(state)) as GameState;
    epState(crewState).harbors.find((entry) => entry.vertex === harbor)!.cargo = [];
    epState(crewState).sites.push({ hex: -1, kind: 'lair', crews: Array.from({ length: 9 }, () => 'p1'), captured: false });
    expect(refused(crewState, 'p1', { type: 'ep.buildCrew', harbor })).toBe('E_NO_PIECES');
    // Settlements: 5 plain settlements in play leave none for building or founding.
    const topo = topologyOf(state);
    const own = state.board.buildings.filter((building) => building?.player === 'p1').length;
    const harbors = epState(state).harbors.filter((entry) => entry.player === 'p1').length;
    const spots = topo.vertices.map((_, index) => index).filter((index) => !state.board.buildings[index]
      && neighborsOfVertex(topo, index).every((neighbor) => !state.board.buildings[neighbor]));
    const picked: number[] = [];
    for (const index of spots) {
      if (picked.length === 5 - (own - harbors)) break;
      if (picked.some((other) => neighborsOfVertex(topo, other).includes(index))) continue;
      picked.push(index);
    }
    for (const index of picked) state.board.buildings[index] = { player: 'p1', city: false };
    expect(actionHints(state, 'p1').legalSettlements).toEqual([]);
    expect(foundTargets(state, shipOf(state, 'p1'))).toEqual([]);
  });
});

describe('R-EP movement and cargo (EP25 pp. 10–12, EP25-M pp. 6–7)', () => {
  it('R-EP-29 one ship at a time: moving another finishes the first; never leave a ship on a full edge (EP25 p. 10)', () => {
    let state = epPlayable('fish', 3);
    const slot = epState(state);
    const first = shipOf(state, 'p1');
    const topo = topologyOf(state);
    const second: EpShip = { id: 'x9', player: 'p1', edge: topo.edges.findIndex((_, edge) => isSeaRoute(state, edge)
      && fogAtEnds(state, edge).length === 0 && edge !== first.edge && !slot.ships.some((ship) => ship.edge === edge)), cargo: [] };
    slot.ships.push(second);
    state = moving(state);
    const step = epHints(state, 'p1').ships.find((ship) => ship.id === first.id)!.steps.find((entry) => !entry.explores && !entry.full)!.edge;
    state = run(state, 'p1', { type: 'ep.moveShip', ship: first.id, edge: step }).state;
    const away = epHints(state, 'p1').ships.find((ship) => ship.id === second.id)!.steps.find((entry) => !entry.explores && !entry.full)!.edge;
    state = run(state, 'p1', { type: 'ep.moveShip', ship: 'x9', edge: away }).state;
    expect(viewTurn(state).ships[first.id]!.done).toBe(true);
    expect(refused(state, 'p1', { type: 'ep.moveShip', ship: first.id, edge: first.edge })).toBe('E_EP_SHIP_DONE');
    // A ship that stopped on a full edge must move on before another ship starts.
    let full = epPlayable('fish', 3);
    const mine = shipOf(full, 'p1');
    const extra: EpShip = { id: 'x8', player: 'p1', edge: second.edge, cargo: [] };
    epState(full).ships.push(extra);
    const crowded = nextEdges(full, mine.edge).find((edge) => fogAtEnds(full, edge).length === 0 && edge !== extra.edge)!;
    epState(full).ships.push({ id: 'y1', player: 'p2', edge: crowded, cargo: [] }, { id: 'y2', player: 'p3', edge: crowded, cargo: [] });
    full = moving(full);
    full = run(full, 'p1', { type: 'ep.moveShip', ship: mine.id, edge: crowded }).state;
    const other = epHints(full, 'p1').ships.find((ship) => ship.id === 'x8')!.steps[0]!.edge;
    expect(refused(full, 'p1', { type: 'ep.moveShip', ship: 'x8', edge: other })).toBe('E_EP_EDGE_FULL');
  });

  it('R-EP-30 load, unload and swap cost no MP and may happen mid-move; only at an own adjacent harbour (EP25 p. 11)', () => {
    let state = epPlayable('pirate-lairs', 3);
    const { ship, harbor } = shipAtHarbor(state, 'p1');
    const cargoAt = () => epState(state).harbors.find((entry) => entry.vertex === harbor)!.cargo;
    state = moving(state);
    const left = () => movesLeft(state, shipOf(state, 'p1'), viewTurn(state));
    const start = left();
    state = run(state, 'p1', { type: 'ep.unload', ship: ship.id, harbor, piece: 'settler' }).state;
    expect(shipOf(state, 'p1').cargo).toEqual([]);
    expect(cargoAt()).toEqual(['settler']);
    state = run(state, 'p1', { type: 'ep.load', ship: ship.id, harbor, piece: 'settler' }).state;
    expect(shipOf(state, 'p1').cargo).toEqual(['settler']);
    epState(state).harbors.find((entry) => entry.vertex === harbor)!.cargo = ['crew', 'crew'];
    expect(refused(state, 'p1', { type: 'ep.load', ship: ship.id, harbor, piece: 'crew' })).toBe('E_EP_NO_ROOM');
    state = run(state, 'p1', { type: 'ep.swap', ship: ship.id, harbor }).state;
    expect(shipOf(state, 'p1').cargo).toEqual(['crew', 'crew']);
    expect(cargoAt()).toEqual(['settler']);
    expect(left()).toBe(start);
    // Mid-move: one step away and back, then swap again without losing MP.
    const away = epHints(state, 'p1').ships.find((entry) => entry.id === ship.id)!.steps.find((entry) => !entry.explores && !entry.full
      && !topologyOf(state).edges[entry.edge]!.vertices.includes(harbor))!.edge;
    const home = shipOf(state, 'p1').edge;
    state = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: away }).state;
    expect(refused(state, 'p1', { type: 'ep.swap', ship: ship.id, harbor })).toBe('E_EP_NOT_ADJACENT');
    state = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: home }).state;
    state = run(state, 'p1', { type: 'ep.swap', ship: ship.id, harbor }).state;
    expect(shipOf(state, 'p1').cargo).toEqual(['settler']);
    expect(left()).toBe(start - 2);
    // Never at an opponent's harbour.
    const theirs = epState(state).harbors.find((entry) => entry.player === 'p2')!;
    expect(refused(state, 'p1', { type: 'ep.load', ship: ship.id, harbor: theirs.vertex, piece: 'crew' })).toBe('E_EP_NOT_ADJACENT');
  });

  it('R-EP-31 exploring a gold field, spice farm or fish shoal places its site and pays 2 gold (EP25 p. 12; EP25-M p. 7)', () => {
    for (const [scenario, tile, kind] of [['pirate-lairs', 'gold', 'lair'], ['spices', 'spice', 'spice'], ['fish', 'shoal', 'shoal']] as const) {
      let state = epPlayable(scenario, 3);
      const { ship, to, hex, pick } = aimAt(state, 'p1', tile);
      const before = gold(state, 'p1');
      state = moving(state);
      // The second draw is the spice ability or the shoal number (index 0).
      const outcome = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: to }, scriptedRng([pick, 0]));
      state = outcome.state;
      const site = epState(state).sites.find((entry) => entry.hex === hex)!;
      expect(site.kind, scenario).toBe(kind);
      expect(state.board.layout.numbers[hex]).toBeNull();
      expect(gold(state, 'p1')).toBe(before + 2);
      const explored = outcome.events.find((event) => event.type === 'ep.explored')!;
      expect(explored.params).toMatchObject({ hex, tile, reward: { gold: 2 } });
      if (site.kind === 'spice') expect(site.sacks).toEqual(['p1', 'p2', 'p3']);
      if (site.kind === 'lair') expect(site).toMatchObject({ crews: [], captured: false });
      if (site.kind === 'shoal') expect(explored.params.shoal).toBe(site.number);
    }
  });

  it('R-EP-32 a step touching two unexplored hexes reveals both, in hex order (EP25 p. 12; interpretation 6)', () => {
    let state = landHo();
    const topo = topologyOf(state);
    const ship = shipOf(state, 'p1');
    // Every corner of the printed fog touches it, so the ship starts one step from an edge with two unexplored hexes.
    let pair: { from: number; to: number } | null = null;
    for (let from = 0; from < topo.edges.length && !pair; from++) {
      if (!isSeaRoute(state, from)) continue;
      const to = nextEdges(state, from).find((edge) => fogAtEnds(state, edge).length === 2);
      if (to !== undefined) pair = { from, to };
    }
    expect(pair).not.toBeNull();
    ship.edge = pair!.from;
    const hexes = fogAtEnds(state, pair!.to);
    state = moving(state);
    const outcome = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: pair!.to }, scriptedRng([0, 0, 0, 0, 0, 0, 0, 0]));
    const explored = outcome.events.filter((event) => event.type === 'ep.explored').map((event) => event.params.hex);
    expect(explored).toEqual(hexes);
    expect(epHints(outcome.state, 'p1').ships[0]!.done).toBe(true);
  });

  it('R-EP-33 empty supplies pay nothing; a region pool runs out exactly with its last hex (EP25 p. 12; interpretation 10)', () => {
    let state = landHo();
    const slot = epState(state);
    const { from, to } = exploringPair(state);
    const ship = shipOf(state, 'p1');
    ship.edge = from;
    const [hex] = fogAtEnds(state, to);
    const region = slot.fog.find((entry) => entry.hex === hex)!.region;
    // A forest from an empty lumber bank pays no card.
    state.bank.lumber = 0;
    const lumber = state.players[0]!.resources.lumber;
    state = moving(state);
    const outcome = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: to }, scriptedRng([pickOf(slot.pools[region], 'forest'), 0]));
    expect(outcome.state.players[0]!.resources.lumber).toBe(lumber);
    expect(outcome.events.find((event) => event.type === 'ep.explored')!.params.reward).toBeNull();
    // An empty coin supply pays no discovery gold.
    let poor = landHo();
    const poorShip = shipOf(poor, 'p1');
    poorShip.edge = from;
    epState(poor).goldSupply = 0;
    poor = moving(poor);
    const sea = run(poor, 'p1', { type: 'ep.moveShip', ship: poorShip.id, edge: to }, scriptedRng([0]));
    expect(gold(sea.state, 'p1')).toBe(2);
    expect(sea.events.find((event) => event.type === 'ep.explored')!.params.reward).toBeNull();
    // Each region holds exactly one tile per unexplored hex.
    const fresh = landHo();
    const fs = epState(fresh);
    for (const name of ['parrot', 'goose'] as const) {
      const tiles = Object.values(fs.pools[name].tiles).reduce((sum, value) => sum + (value ?? 0), 0);
      expect(tiles).toBe(fs.fog.filter((entry) => entry.region === name).length);
    }
  });

  it('R-EP-34 a frame edge of an unexplored hex is no route until the hex is explored (EP25 p. 10)', () => {
    const state = landHo();
    const slot = epState(state);
    const topo = topologyOf(state);
    const frame = topo.edges.findIndex((info) => info.hexes.length === 1 && slot.fog.some((entry) => entry.hex === info.hexes[0]));
    expect(frame).toBeGreaterThanOrEqual(0);
    expect(isSeaRoute(state, frame)).toBe(false);
    const hex = topo.edges[frame]!.hexes[0]!;
    slot.fog = slot.fog.filter((entry) => entry.hex !== hex);
    expect(isSeaRoute(state, frame)).toBe(true);
  });

  it('R-EP-35 a settler founds only on explored land and keeps the distance rule (EP25 p. 12)', () => {
    const state = landHo();
    const ship = shipOf(state, 'p1');
    const topo = topologyOf(state);
    for (let edge = 0; edge < topo.edges.length; edge++) {
      if (!isSeaRoute(state, edge)) continue;
      ship.edge = edge;
      for (const vertex of foundTargets(state, ship)) {
        expect(vertexTouchesFog(state, vertex)).toBe(false);
        expect(neighborsOfVertex(topo, vertex).every((neighbor) => !state.board.buildings[neighbor])).toBe(true);
        expect(topo.vertices[vertex]!.hexes.some((hex) => state.board.layout.terrain[hex] !== 'sea')).toBe(true);
      }
    }
    // A settlement next to the target blocks it.
    const target = topo.edges.findIndex((_, edge) => {
      if (!isSeaRoute(state, edge)) return false;
      ship.edge = edge;
      return foundTargets(state, ship).length > 0;
    });
    ship.edge = target;
    const vertex = foundTargets(state, ship)[0]!;
    state.board.buildings[neighborsOfVertex(topo, vertex)[0]!] = { player: 'p2', city: false };
    expect(foundTargets(state, ship)).not.toContain(vertex);
  });
});

describe('R-EP pirates, lairs and gold fields (EP25 pp. 8–13, EP25-M pp. 9–13)', () => {
  function sevenFor(state: GameState): GameState {
    state.turn.phase = 'preroll';
    for (const player of state.players) setHand(state, player.id, {});
    return run(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3])).state;
  }

  it('R-EP-36 the pirate: never on the Council or next to the starting island; own moves on; an opponent’s goes home (EP25 p. 8; EP25-M pp. 9–10)', () => {
    let state = sevenFor(epPlayable('explorers-pirates', 3));
    const slot = epState(state);
    const targets = epHints(state, 'p1').pirateTargets;
    expect(slot.council).not.toBeNull();
    expect(targets).not.toContain(slot.council);
    expect(targets.length).toBeGreaterThan(1);
    // An opponent's pirate on the board: it returns, and the roller's takes its place elsewhere.
    slot.pirate = { hex: targets[0]!, owner: 'p2' };
    expect(pirateTargets(state)).not.toContain(targets[0]);
    const outcome = run(state, 'p1', { type: 'ep.placePirate', hex: targets[1]! });
    state = outcome.state;
    expect(epState(state).pirate).toEqual({ hex: targets[1], owner: 'p1' });
    expect(outcome.events.find((event) => event.type === 'ep.pirateReturned')!.params).toMatchObject({ playerId: 'p2', hex: targets[0] });
    // The own pirate must move to another hex next time.
    expect(pirateTargets(state)).not.toContain(targets[1]);
  });

  it('R-EP-37 several ships at the pirate: the roller chooses whom to rob (EP25 p. 8)', () => {
    let state = sevenFor(epPlayable('pirate-lairs', 3));
    const target = epHints(state, 'p1').pirateTargets[0]!;
    shipOf(state, 'p2').edge = edgeOfHex(state, target);
    shipOf(state, 'p3').edge = edgeOfHex(state, target);
    setHand(state, 'p2', { ore: 1 });
    setHand(state, 'p3', { wool: 1 });
    state = run(state, 'p1', { type: 'ep.placePirate', hex: target }).state;
    expect(epHints(state, 'p1').robCandidates).toEqual(['p2', 'p3']);
    expect(refused(state, 'p1', { type: 'ep.robPlayer', victim: 'p1' })).toBe('E_NO_ELIGIBLE_VICTIM');
    state = run(state, 'p1', { type: 'ep.robPlayer', victim: 'p3' }, scriptedRng([0])).state;
    expect(state.players[2]!.resources.wool).toBe(0);
    expect(state.players[0]!.resources.wool).toBe(1);
    expect(state.pending).toBeNull();
  });

  it('R-EP-38 building next to an opponent’s pirate pays no tribute (EP25 p. 10)', () => {
    let state = epPlayable('pirate-lairs', 3);
    const harbor = epState(state).harbors.find((entry) => entry.player === 'p1')!;
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    const edge = epHints(state, 'p1').shipEdges[0]!;
    const pirateHex = topologyOf(state).edges[edge]!.hexes.find((hex) => state.board.layout.terrain[hex] === 'sea')!;
    epState(state).pirate = { hex: pirateHex, owner: 'p2' };
    const before = gold(state, 'p1');
    state = run(state, 'p1', { type: 'ep.buildShip', edge }).state;
    expect(gold(state, 'p1')).toBe(before);
    expect(topologyOf(state).edges[edge]!.vertices).toContain(harbor.vertex);
  });

  it('R-EP-39 a gold field is closed to building until its lair is captured (EP25 pp. 8–9, 13)', () => {
    const state = epPlayable('pirate-lairs', 3);
    const slot = epState(state);
    const topo = topologyOf(state);
    const lair = slot.fog[0]!.hex;
    slot.fog.shift();
    state.board.layout.terrain[lair] = 'gold';
    const site = { hex: lair, kind: 'lair' as const, crews: [] as string[], captured: false };
    slot.sites.push(site);
    const vertex = topo.vertices.findIndex((info, index) => info.hexes.includes(lair) && !vertexTouchesFog(state, index)
      && neighborsOfVertex(topo, index).every((neighbor) => !state.board.buildings[neighbor]));
    expect(vertex).toBeGreaterThanOrEqual(0);
    const road = topo.vertices[vertex]!.edges.find((edge) => topo.edges[edge]!.hexes.includes(lair))!;
    state.board.roads[topo.vertices[vertex]!.edges.find((edge) => edge !== road) ?? road] = { player: 'p1', ship: false };
    setHand(state, 'p1', { lumber: 2, brick: 2, wool: 1, grain: 1 });
    expect(actionHints(state, 'p1').legalSettlements).not.toContain(vertex);
    expect(actionHints(state, 'p1').legalRoads).not.toContain(road);
    // A settler ship at that corner cannot found there either.
    const seaEdge = topo.vertices[vertex]!.edges.find((edge) => isSeaRoute(state, edge))!;
    expect(seaEdge).toBeDefined();
    const ship = shipOf(state, 'p1');
    ship.edge = seaEdge;
    ship.cargo = ['settler'];
    expect(foundTargets(state, ship)).not.toContain(vertex);
    site.captured = true;
    expect(actionHints(state, 'p1').legalSettlements).toContain(vertex);
    expect(foundTargets(state, ship)).toContain(vertex);
  });

  it('R-EP-40 lair hero ties: the higher total wins, then more crews, then the tied reroll (EP25 p. 13; EP25-M p. 12)', () => {
    const setup = (crews: string[]) => {
      const state = epPlayable('pirate-lairs', 3);
      const slot = epState(state);
      const lair = slot.fog[0]!.hex;
      slot.fog.shift();
      state.board.layout.terrain[lair] = 'gold';
      slot.sites.push({ hex: lair, kind: 'lair', crews, captured: false });
      slot.captures.push(lair);
      return { state, lair };
    };
    // p1 one crew, p2 two crews; dice p2 (seat order from p1): p1 4 → 5, p2 3 → 5; more crews wins.
    {
      const { state, lair } = setup(['p2', 'p1', 'p2']);
      const outcome = run(state, 'p1', { type: 'turn.end' }, scriptedRng([3, 2, 0]));
      const captured = outcome.events.find((event) => event.type === 'ep.lairCaptured')!.params as { hero: string; involved: string[] };
      expect(captured.involved).toEqual(['p1', 'p2']);
      expect(captured.hero).toBe('p2');
      expect(epState(outcome.state).sites.find((site) => site.hex === lair)).toMatchObject({ crews: ['p1', 'p2'] });
      // Rewards go clockwise from the active player.
      expect(outcome.events.filter((event) => event.type === 'ep.lairReward').map((event) => event.params.playerId)).toEqual(['p1', 'p2']);
    }
    // One crew each: a tie on the total rerolls between the tied players only.
    {
      const { state } = setup(['p1', 'p2', 'p3']);
      // Round 1: p1 6, p2 6, p3 1 → p1/p2 tie; round 2: p1 2, p2 5 → p2.
      const outcome = run(state, 'p1', { type: 'turn.end' }, scriptedRng([5, 5, 0, 1, 4, 0]));
      const captured = outcome.events.find((event) => event.type === 'ep.lairCaptured')!.params as { hero: string; rounds: unknown[][] };
      expect(captured.hero).toBe('p2');
      expect(captured.rounds).toHaveLength(2);
      expect(captured.rounds[1]).toHaveLength(2);
    }
  });

  it('R-EP-41 a full or captured lair takes no more crews; a captured one lets own crews leave (EP25 p. 13; EP25-M p. 13)', () => {
    let state = epPlayable('pirate-lairs', 3);
    const slot = epState(state);
    const ship = shipOf(state, 'p1');
    const lair = slot.fog[0]!.hex;
    slot.fog.shift();
    state.board.layout.terrain[lair] = 'gold';
    const site = { hex: lair, kind: 'lair' as const, crews: ['p2', 'p3', 'p2'], captured: false };
    slot.sites.push(site);
    ship.edge = edgeOfHex(state, lair);
    ship.cargo = ['crew'];
    state = moving(state);
    expect(refused(state, 'p1', { type: 'ep.dropCrew', ship: ship.id, hex: lair })).toBe('E_EP_SITE_CLOSED');
    Object.assign(epState(state).sites.find((entry) => entry.hex === lair)!, { crews: ['p1', 'p2'], captured: true });
    expect(refused(state, 'p1', { type: 'ep.dropCrew', ship: ship.id, hex: lair })).toBe('E_EP_SITE_CLOSED');
    shipOf(state, 'p1').cargo = [];
    state = run(state, 'p1', { type: 'ep.pickCrew', ship: ship.id, hex: lair }).state;
    expect(shipOf(state, 'p1').cargo).toEqual(['crew']);
    expect(epState(state).sites.find((entry) => entry.hex === lair)).toMatchObject({ crews: ['p2'] });
  });

  it('R-EP-47 a ship that chased (and missed) may still move with its full MP (EP25 p. 11)', () => {
    let state = epPlayable('pirate-lairs', 3);
    const ship = shipOf(state, 'p1');
    const pirateHex = topologyOf(state).edges[ship.edge]!.hexes.find((cell) => state.board.layout.terrain[cell] === 'sea')!;
    epState(state).pirate = { hex: pirateHex, owner: 'p2' };
    state = moving(state);
    const full = movesLeft(state, shipOf(state, 'p1'), viewTurn(state));
    state = run(state, 'p1', { type: 'ep.chase', ship: ship.id }, scriptedRng([0])).state;
    expect(movesLeft(state, shipOf(state, 'p1'), viewTurn(state))).toBe(full);
    const step = epHints(state, 'p1').ships[0]!.steps.find((entry) => !entry.explores && !entry.full)!.edge;
    state = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: step }).state;
    expect(shipOf(state, 'p1').edge).toBe(step);
  });

  it('R-EP-42 the lair token pool is the single provisional constant 2, 3, 5, 6, 8, 11 (FIDELITY: provisional, maintainer decision 2026-11-03)', () => {
    expect([...LAIR_TOKENS]).toEqual([2, 3, 5, 6, 8, 11]);
    expect(epState(epPlayable('pirate-lairs', 3)).lairTokens).toEqual([2, 3, 5, 6, 8, 11]);
    expect(epState(epPlayable('fish', 3)).lairTokens).toEqual([2, 3, 5, 6, 8, 11]);
    // Spices for Catan has no gold fields and no lair tokens.
    expect(epState(epPlayable('spices', 3)).lairTokens).toEqual([]);
    expect(epState(landHo()).lairTokens).toEqual([]);
  });
});

describe('R-EP fish, spices, Council and victory (EP25 pp. 13–15, EP25-M pp. 14–18)', () => {
  function shoalNextToShip(scenario: 'fish' | 'explorers-pirates') {
    const state = epPlayable(scenario, 3);
    const slot = epState(state);
    const ship = shipOf(state, 'p1');
    const shoal = topologyOf(state).edges[ship.edge]!.hexes.find((cell) => state.board.layout.terrain[cell] === 'sea' && cell !== slot.council)!;
    slot.sites.push({ hex: shoal, kind: 'shoal', number: 3, fish: false });
    return { state, shoal, ship };
  }

  it('R-EP-43 no haul where one lies already or when the supply is empty; rolling ends the ship in motion (EP25 p. 14)', () => {
    let { state, shoal, ship } = shoalNextToShip('fish');
    const site = epState(state).sites.find((entry) => entry.hex === shoal)! as { fish: boolean };
    site.fish = true;
    epState(state).fishSupply = 5;
    state = moving(state);
    const step = epHints(state, 'p1').ships[0]!.steps.find((entry) => !entry.explores && !entry.full)!.edge;
    state = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: step }).state;
    const outcome = run(state, 'p1', { type: 'ep.fishRoll' }, scriptedRng([2]));
    expect(outcome.events.find((event) => event.type === 'ep.fishRolled')!.params).toMatchObject({ die: 3, hexes: [] });
    expect(epState(outcome.state).fishSupply).toBe(5);
    expect(viewTurn(outcome.state).ships[ship.id]!.done).toBe(true);
    // Empty supply.
    let empty = shoalNextToShip('fish').state;
    epState(empty).fishSupply = 0;
    empty = moving(empty);
    const none = run(empty, 'p1', { type: 'ep.fishRoll' }, scriptedRng([2]));
    expect(none.events.find((event) => event.type === 'ep.fishRolled')!.params).toMatchObject({ hexes: [] });
  });

  it('R-EP-44 deliveries at a Council anchor: fish and spice each advance their own track; nothing to deliver is refused (EP25 p. 14)', () => {
    let state = epPlayable('explorers-pirates', 3);
    const ship = shipOf(state, 'p1');
    const anchor = councilAnchors(state, epState(state))[0]!;
    ship.edge = topologyOf(state).vertices[anchor]!.edges.find((edge) => isSeaRoute(state, edge))!;
    ship.cargo = [];
    state = moving(state);
    expect(refused(state, 'p1', { type: 'ep.deliver', ship: ship.id })).toBe('E_INVALID_SELECTION');
    shipOf(state, 'p1').cargo = ['spice', 'spice'];
    state = run(state, 'p1', { type: 'ep.deliver', ship: ship.id }).state;
    expect(epState(state).tracks.spices!.positions.p1).toBe(2);
    expect(shipOf(state, 'p1').cargo).toEqual([]);
    shipOf(state, 'p1').cargo = ['fish'];
    epState(state).fishSupply -= 1;
    state = run(state, 'p1', { type: 'ep.deliver', ship: ship.id }).state;
    expect(epState(state).tracks.fish!.positions.p1).toBe(1);
    // Away from the anchors nothing is delivered.
    const away = epHints(state, 'p1').ships[0]!.steps.find((entry) => !entry.explores && !entry.full
      && !councilAnchors(state, epState(state)).some((vertex) => topologyOf(state).edges[entry.edge]!.vertices.includes(vertex)));
    if (away) {
      state = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: away.edge }).state;
      shipOf(state, 'p1').cargo = ['spice'];
      expect(refused(state, 'p1', { type: 'ep.deliver', ship: ship.id })).toBe('E_EP_NOT_ADJACENT');
    }
  });

  it('R-EP-45 spice abilities: Swift Voyage +1 MP (+2 with both), Pirate Bonus numbers, Fast Gold once (twice with both) (EP25 p. 14; EP25-M p. 18)', () => {
    let state = epPlayable('spices', 3);
    const slot = epState(state);
    const farm = (ability: 'swift' | 'fastGold' | 'pirateBonus', bonus: number | null = null) => {
      const hex = slot.fog.shift()!.hex;
      state.board.layout.terrain[hex] = 'desert';
      slot.sites.push({ hex, kind: 'spice', ability, bonus, crews: ['p1'], sacks: ['p2', 'p3'] });
    };
    // One Swift Voyage farm: 5 MP; both (one per region): 6 MP.
    farm('swift');
    expect(movesLeft(state, shipOf(state, 'p1'), viewTurn(state))).toBe(5);
    farm('swift');
    expect(movesLeft(state, shipOf(state, 'p1'), viewTurn(state))).toBe(6);
    farm('fastGold');
    farm('pirateBonus', 2);
    expect(epView(state).players.p1!.abilities).toEqual({ swift: 2, fastGold: 1, pirateBonus: 1 });
    expect(epView(state).players.p1!.chaseNumbers).toEqual([2, 6]);
    farm('pirateBonus', 3);
    expect(epView(state).players.p1!.chaseNumbers).toEqual([4, 5, 6]);
    setHand(state, 'p1', { ore: 3 });
    state = run(state, 'p1', { type: 'ep.fastGold', give: 'ore' }).state;
    expect(refused(state, 'p1', { type: 'ep.fastGold', give: 'ore' })).toBe('E_EP_TURN_LIMIT');
    epState(state).sites.push({ hex: -1, kind: 'spice', ability: 'fastGold', bonus: null, crews: ['p1'], sacks: [] });
    state = run(state, 'p1', { type: 'ep.fastGold', give: 'ore' }).state;
    expect(gold(state, 'p1')).toBe(gold(epPlayable('spices', 3), 'p1') + 2);
  });

  it('R-EP-46 a player past the target on another’s turn wins only on their own turn (EP25 p. 15)', () => {
    let state = landHo();
    // Give p2 the target in buildings without it being their turn.
    const topo = topologyOf(state);
    const free = topo.vertices.map((_, index) => index).filter((index) => !state.board.buildings[index]
      && topo.vertices[index]!.hexes.every((hex) => state.board.layout.terrain[hex] === 'sea')
      && neighborsOfVertex(topo, index).every((neighbor) => !state.board.buildings[neighbor]));
    const spare: number[] = [];
    for (const index of free) {
      if (spare.length === 5) break;
      if (spare.some((other) => neighborsOfVertex(topo, other).includes(index))) continue;
      spare.push(index);
    }
    while (scoreOf(state, 'p2', { includeHidden: true }) < 8) state.board.buildings[spare.pop()!] = { player: 'p2', city: false };
    // p1 keeps playing: a build checks victory for the active player only.
    setHand(state, 'p1', { lumber: 1, brick: 1 });
    state = run(state, 'p1', { type: 'build.road', edge: actionHints(state, 'p1').legalRoads[0]! }).state;
    expect(state.result).toBeNull();
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    expect(state.result).toBeNull();
    // The win is declared as p2's turn begins.
    const ended = run(state, 'p1', { type: 'turn.end' });
    expect(ended.state.turn.seat).toBe(1);
    expect(ended.state.result).toMatchObject({ playerId: 'p2', reason: 'victory' });
    expect(scoreOf(ended.state, 'p1', { includeHidden: true })).toBeLessThan(8);
  });
});

/** The public E&P view with the per-player spice abilities. */
function epView(state: GameState) {
  return projectEpView(state, 'p1') as unknown as { players: Record<string, { abilities: Record<string, number>; chaseNumbers: number[] }> };
}

describe('R-EP domestic trade with coins (EP25 p. 9, EP25-M p. 5)', () => {
  it('R-EP-49 offers may carry gold on either side; settling moves the coins and checks both balances', () => {
    let state = landHo();
    setHand(state, 'p1', { lumber: 1 });
    setHand(state, 'p2', { ore: 1 });
    const slot = epState(state);
    slot.gold.p1 = 3;
    slot.gold.p2 = 1;
    const supply = slot.goldSupply;
    // Unknown goods and negative amounts are refused.
    expect(refused(state, 'p1', { type: 'trade.offer', to: 'p2', give: { lumber: 1 }, want: {}, wantGoods: { fish: 1 } })).toBe('E_INVALID_SELECTION');
    expect(refused(state, 'p1', { type: 'trade.offer', to: 'p2', give: {}, want: { ore: 1 }, giveGoods: { gold: -1 } })).toBe('E_INVALID_SELECTION');
    // 2 gold for 1 ore: coins alone may make up one side.
    let outcome = run(state, 'p1', { type: 'trade.offer', to: 'p2', give: {}, want: { ore: 1 }, giveGoods: { gold: 2 } });
    expect(outcome.events.find((event) => event.type === 'trade.offered')!.params).toMatchObject({ giveGoods: { gold: 2 } });
    state = outcome.state;
    const offerId = state.offers[0]!.id;
    expect(state.offers[0]).toMatchObject({ give: {}, want: { ore: 1 }, giveGoods: { gold: 2 } });
    state = run(state, 'p2', { type: 'trade.respond', offerId, response: 'consented' }).state;
    // The proposer must still hold the coins when settling.
    const poor = JSON.parse(JSON.stringify(state)) as GameState;
    epState(poor).gold.p1 = 1;
    expect(refused(poor, 'p1', { type: 'trade.settle', offerId, counterparty: 'p2' })).toBe('E_INSUFFICIENT_RESOURCES');
    outcome = run(state, 'p1', { type: 'trade.settle', offerId, counterparty: 'p2' });
    state = outcome.state;
    expect(epState(state).gold).toMatchObject({ p1: 1, p2: 3 });
    expect(epState(state).goldSupply).toBe(supply);
    expect(state.players[0]!.resources.ore).toBe(1);
    expect(outcome.events.find((event) => event.type === 'trade.completed')?.params).toMatchObject({ giveGoods: { gold: 2 } });
    // Asking for coins: the partner's balance is checked.
    state = run(state, 'p1', { type: 'trade.offer', to: 'p2', give: { lumber: 1 }, want: {}, wantGoods: { gold: 4 } }).state;
    const second = state.offers.at(-1)!.id;
    expect(refused(state, 'p2', { type: 'trade.respond', offerId: second, response: 'consented' })).toBe('E_INSUFFICIENT_RESOURCES');
    // Revising to an affordable amount settles.
    state = run(state, 'p1', { type: 'trade.revise', offerId: second, give: { lumber: 1 }, want: {}, wantGoods: { gold: 3 } }).state;
    state = run(state, 'p2', { type: 'trade.respond', offerId: second, response: 'consented' }).state;
    state = run(state, 'p1', { type: 'trade.settle', offerId: second, counterparty: 'p2' }).state;
    expect(epState(state).gold).toMatchObject({ p1: 4, p2: 0 });
    expect(state.players[1]!.resources.lumber).toBe(1);
  });

  it('R-EP-50 profiles without coins refuse goods in offers', () => {
    const { state } = newGame({ players: 3 });
    forceTurn(state, 0, 'action');
    setHand(state, 'p1', { lumber: 1 });
    expect(refused(state, 'p1', { type: 'trade.offer', to: 'p2', give: { lumber: 1 }, want: {}, wantGoods: { gold: 1 } })).toBe('E_INVALID_SELECTION');
  });
});

/** Turns a fog hex into an uncaptured lair with `count` distinct sea edges free of fog and ships. */
function lairWithEdges(state: GameState, count: number): { lair: number; edges: number[] } {
  const slot = epState(state);
  const topo = topologyOf(state);
  for (const entry of slot.fog.slice()) {
    const hex = entry.hex;
    const saved = slot.fog;
    slot.fog = slot.fog.filter((other) => other.hex !== hex);
    state.board.layout.terrain[hex] = 'gold';
    const edges = topo.edges.map((_, index) => index).filter((edge) => topo.edges[edge]!.hexes.includes(hex)
      && isSeaRoute(state, edge) && fogAtEnds(state, edge).length === 0 && !slot.ships.some((ship) => ship.edge === edge));
    if (edges.length >= count) {
      slot.sites.push({ hex, kind: 'lair', crews: [], captured: false });
      return { lair: hex, edges: edges.slice(0, count) };
    }
    slot.fog = saved;
    state.board.layout.terrain[hex] = 'sea';
  }
  throw new Error('no lair site with enough free edges');
}

/** Ends the current turn and plays the next player's roll (dice 1 + 2) into their Movement phase. */
function passTurn(state: GameState, endRng = scriptedRng([])): GameState {
  const actor = state.players[state.turn.seat]!.id;
  let next = run(state, actor, { type: 'turn.end' }, endRng).state;
  const id = next.players[next.turn.seat]!.id;
  next = run(next, id, { type: 'turn.roll' }, scriptedRng([0, 1])).state;
  return run(next, id, { type: 'ep.startMovement' }).state;
}

describe('R-EP lairs through commands (EP25 p. 13, EP25-M pp. 11–13)', () => {
  it('R-EP-53 one player with all three crews: capture, the cap, rewards and the number', () => {
    let state = epPlayable('pirate-lairs', 3);
    const { lair, edges } = lairWithEdges(state, 2);
    const slot = epState(state);
    const [a, b] = slot.ships.filter((ship) => ship.player === 'p1').length >= 2
      ? slot.ships.filter((ship) => ship.player === 'p1')
      : [shipOf(state, 'p1'), (() => { const extra: EpShip = { id: 'x1', player: 'p1', edge: edges[1]!, cargo: [] }; slot.ships.push(extra); return extra; })()];
    a!.edge = edges[0]!;
    b!.edge = edges[1]!;
    a!.cargo = ['crew', 'crew'];
    b!.cargo = ['crew', 'crew'];
    state = moving(state);
    state = run(state, 'p1', { type: 'ep.dropCrew', ship: a!.id, hex: lair }).state;
    state = run(state, 'p1', { type: 'ep.dropCrew', ship: a!.id, hex: lair }).state;
    const third = run(state, 'p1', { type: 'ep.dropCrew', ship: b!.id, hex: lair });
    state = third.state;
    expect(third.events.find((event) => event.type === 'ep.crewLanded')!.params).toMatchObject({ crews: 3 });
    // The third crew fills the lair: no fourth.
    expect(refused(state, 'p1', { type: 'ep.dropCrew', ship: b!.id, hex: lair })).toBe('E_EP_SITE_CLOSED');
    const before = gold(state, 'p1');
    // Resolution after the Movement phase: one die for the lone hero, then the lair token.
    const ended = run(state, 'p1', { type: 'turn.end' }, scriptedRng([4, 0]));
    const captured = ended.events.find((event) => event.type === 'ep.lairCaptured')!.params as { hero: string; involved: string[]; number: number };
    expect(captured).toMatchObject({ hero: 'p1', involved: ['p1'] });
    expect(gold(ended.state, 'p1')).toBe(before + 2);
    // Involved +1, hero +1: two spaces; the hero takes one crew back.
    expect(epState(ended.state).tracks.lairs!.positions.p1).toBe(2);
    expect(epState(ended.state).sites.find((site) => site.hex === lair)).toMatchObject({ crews: ['p1', 'p1'], captured: true });
    expect(ended.state.board.layout.numbers[lair]).toBe(captured.number);
    expect(epState(ended.state).lairTokens).not.toContain(captured.number);
  });

  it('R-EP-54 crews from two players: rewards clockwise from the active player, a tie goes to more crews', () => {
    let state = epPlayable('pirate-lairs', 3);
    const { lair, edges } = lairWithEdges(state, 2);
    const mine = shipOf(state, 'p1');
    const theirs = shipOf(state, 'p2');
    mine.edge = edges[0]!;
    mine.cargo = ['crew'];
    theirs.edge = edges[1]!;
    theirs.cargo = ['crew', 'crew'];
    state = moving(state);
    state = run(state, 'p1', { type: 'ep.dropCrew', ship: mine.id, hex: lair }).state;
    // p2's turn (p1 → p2): two crews make three.
    state = passTurn(state);
    expect(state.turn.seat).toBe(1);
    state = run(state, 'p2', { type: 'ep.dropCrew', ship: theirs.id, hex: lair }).state;
    state = run(state, 'p2', { type: 'ep.dropCrew', ship: theirs.id, hex: lair }).state;
    // Rolls in clockwise order from p2: p2 3 + 2 crews = 5, p1 4 + 1 crew = 5 → p2 has more crews.
    const ended = run(state, 'p2', { type: 'turn.end' }, scriptedRng([2, 3, 0]));
    const captured = ended.events.find((event) => event.type === 'ep.lairCaptured')!.params as { hero: string; involved: string[]; rounds: { playerId: string; total: number }[][] };
    expect(captured.involved).toEqual(['p2', 'p1']);
    expect(captured.rounds).toHaveLength(1);
    expect(captured.rounds[0]!.map((roll) => roll.total)).toEqual([5, 5]);
    expect(captured.hero).toBe('p2');
    expect(ended.events.filter((event) => event.type === 'ep.lairReward').map((event) => event.params.playerId)).toEqual(['p2', 'p1']);
    expect(epState(ended.state).tracks.lairs!.positions).toMatchObject({ p1: 1, p2: 2 });
    expect(epState(ended.state).sites.find((site) => site.hex === lair)).toMatchObject({ crews: ['p1', 'p2'] });
  });

  it('R-EP-55 crews from three players: an equal tie rerolls between the tied players only', () => {
    let state = epPlayable('pirate-lairs', 3);
    const { lair, edges } = lairWithEdges(state, 2);
    // p1 and p3 share one edge (two ships per edge), p2 takes the other.
    for (const [player, edge] of [['p1', edges[0]], ['p2', edges[1]], ['p3', edges[0]]] as const) {
      const ship = shipOf(state, player);
      ship.edge = edge!;
      ship.cargo = ['crew'];
    }
    state = moving(state);
    state = run(state, 'p1', { type: 'ep.dropCrew', ship: shipOf(state, 'p1').id, hex: lair }).state;
    state = passTurn(state);
    state = run(state, 'p2', { type: 'ep.dropCrew', ship: shipOf(state, 'p2').id, hex: lair }).state;
    state = passTurn(state);
    state = run(state, 'p3', { type: 'ep.dropCrew', ship: shipOf(state, 'p3').id, hex: lair }).state;
    // Clockwise from p3: p3 6, p1 6, p2 1 → p3 and p1 reroll: p3 2, p1 5 → p1.
    const ended = run(state, 'p3', { type: 'turn.end' }, scriptedRng([5, 5, 0, 1, 4, 0]));
    const captured = ended.events.find((event) => event.type === 'ep.lairCaptured')!.params as { hero: string; involved: string[]; rounds: { playerId: string }[][] };
    expect(captured.involved).toEqual(['p3', 'p1', 'p2']);
    expect(captured.rounds.map((round) => round.map((roll) => roll.playerId))).toEqual([['p3', 'p1', 'p2'], ['p3', 'p1']]);
    expect(captured.hero).toBe('p1');
  });

  it('R-EP-56 a lair capture that reaches the target wins as the turn ends (EP25 pp. 13, 15)', () => {
    let state = epPlayable('pirate-lairs', 3);
    const { lair, edges } = lairWithEdges(state, 1);
    const ship = shipOf(state, 'p1');
    ship.edge = edges[0]!;
    ship.cargo = ['crew'];
    (epState(state).sites.find((site) => site.hex === lair) as { crews: string[] }).crews.push('p2', 'p2');
    // Find how many points the capture brings, then put p1 just below the target.
    const probe = run(moving(JSON.parse(JSON.stringify(state)) as GameState), 'p1', { type: 'ep.dropCrew', ship: ship.id, hex: lair }).state;
    const resolved = run(probe, 'p1', { type: 'turn.end' }, scriptedRng([5, 0, 0]));
    const gain = scoreOf(resolved.state, 'p1', { includeHidden: true }) - scoreOf(state, 'p1', { includeHidden: true });
    expect(gain).toBeGreaterThan(0);
    const topo = topologyOf(state);
    const spots = topo.vertices.map((_, index) => index).filter((index) => !state.board.buildings[index]
      && topo.vertices[index]!.hexes.every((hex) => state.board.layout.terrain[hex] === 'sea')
      && neighborsOfVertex(topo, index).every((neighbor) => !state.board.buildings[neighbor]));
    for (const index of spots) {
      if (scoreOf(state, 'p1', { includeHidden: true }) >= 12 - gain) break;
      if (neighborsOfVertex(topo, index).some((neighbor) => state.board.buildings[neighbor])) continue;
      state.board.buildings[index] = { player: 'p1', city: false };
    }
    expect(scoreOf(state, 'p1', { includeHidden: true })).toBe(12 - gain);
    state = moving(state);
    state = run(state, 'p1', { type: 'ep.dropCrew', ship: ship.id, hex: lair }).state;
    expect(state.result).toBeNull();
    const ended = run(state, 'p1', { type: 'turn.end' }, scriptedRng([5, 0, 0]));
    expect(ended.state.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
    expect(ended.events.map((event) => event.type)).not.toContain('turn.ended');
  });
});

describe('R-EP cargo capacity, spice farms and delivery wins (EP25 pp. 9–15)', () => {
  it('R-EP-51 ships and harbours hold 1 large or 2 small pieces, both ways (EP25 pp. 9, 11)', () => {
    let state = epPlayable('fish', 3);
    const { ship, harbor } = shipAtHarbor(state, 'p1');
    const harborOf = () => epState(state).harbors.find((entry) => entry.vertex === harbor)!;
    ship.cargo = [];
    harborOf().cargo = ['crew', 'crew'];
    state = moving(state);
    state = run(state, 'p1', { type: 'ep.load', ship: ship.id, harbor, piece: 'crew' }).state;
    state = run(state, 'p1', { type: 'ep.load', ship: ship.id, harbor, piece: 'crew' }).state;
    expect(shipOf(state, 'p1').cargo).toEqual(['crew', 'crew']);
    expect(harborOf().cargo).toEqual([]);
    // A settler (large) does not fit beside a crew, in either holder.
    harborOf().cargo = ['settler'];
    shipOf(state, 'p1').cargo = ['crew'];
    expect(refused(state, 'p1', { type: 'ep.load', ship: ship.id, harbor, piece: 'settler' })).toBe('E_EP_NO_ROOM');
    expect(refused(state, 'p1', { type: 'ep.unload', ship: ship.id, harbor, piece: 'crew' })).toBe('E_EP_NO_ROOM');
    // A fish haul is large too; a spice sack is small.
    shipOf(state, 'p1').cargo = ['fish'];
    harborOf().cargo = ['crew'];
    expect(refused(state, 'p1', { type: 'ep.unload', ship: ship.id, harbor, piece: 'fish' })).toBe('E_EP_NO_ROOM');
    shipOf(state, 'p1').cargo = ['spice'];
    state = run(state, 'p1', { type: 'ep.unload', ship: ship.id, harbor, piece: 'spice' }).state;
    expect(harborOf().cargo).toEqual(['crew', 'spice']);
    // Loading something the harbour does not hold is refused.
    expect(refused(state, 'p1', { type: 'ep.load', ship: ship.id, harbor, piece: 'settler' })).toBe('E_INVALID_SELECTION');
  });

  it('R-EP-52 no road or settlement at a spice farm until the player has a crew there (EP25 p. 14)', () => {
    let state = epPlayable('spices', 3);
    const slot = epState(state);
    const topo = topologyOf(state);
    const ship = shipOf(state, 'p1');
    // A farm with a free corner next to explored sea, reachable by a ship edge.
    let farm = -1;
    let vertex = -1;
    for (const entry of slot.fog.slice()) {
      const hex = entry.hex;
      slot.fog = slot.fog.filter((other) => other.hex !== hex);
      state.board.layout.terrain[hex] = 'desert';
      const corner = topo.vertices.findIndex((info, index) => info.hexes.includes(hex) && !vertexTouchesFog(state, index)
        && !state.board.buildings[index] && neighborsOfVertex(topo, index).every((neighbor) => !state.board.buildings[neighbor])
        && info.edges.some((edge) => isSeaRoute(state, edge) && topo.edges[edge]!.hexes.includes(hex)));
      if (corner >= 0) { farm = hex; vertex = corner; break; }
      slot.fog.push(entry);
      state.board.layout.terrain[hex] = 'sea';
    }
    expect(farm).toBeGreaterThanOrEqual(0);
    slot.sites.push({ hex: farm, kind: 'spice', ability: 'swift', bonus: null, crews: ['p2'], sacks: ['p1', 'p2', 'p3'] });
    const edge = topo.vertices[vertex]!.edges.find((candidate) => isSeaRoute(state, candidate) && topo.edges[candidate]!.hexes.includes(farm))!;
    const road = topo.vertices[vertex]!.edges.find((candidate) => candidate !== edge)!;
    state.board.roads[road] = { player: 'p1', ship: false };
    setHand(state, 'p1', { lumber: 2, brick: 2, wool: 1, grain: 1 });
    expect(actionHints(state, 'p1').legalSettlements).not.toContain(vertex);
    expect(refused(state, 'p1', { type: 'build.settlement', vertex })).toBe('E_ILLEGAL_TARGET');
    // A settler ship cannot found there either.
    ship.edge = edge;
    ship.cargo = ['settler'];
    expect(foundTargets(state, ship)).not.toContain(vertex);
    // Another player's crew does not open it; the player's own crew does.
    ship.cargo = ['crew'];
    state = moving(state);
    state = run(state, 'p1', { type: 'ep.dropCrew', ship: ship.id, hex: farm }).state;
    expect(foundTargets(state, { ...shipOf(state, 'p1'), cargo: ['settler'] })).toContain(vertex);
    const open = JSON.parse(JSON.stringify(state)) as GameState;
    Object.assign(open.turn, { phase: 'action' });
    epState(open).turn.phase = 'action';
    expect(actionHints(open, 'p1').legalSettlements).toContain(vertex);
  });

  it('R-EP-57 a delivery that reaches the target wins at once, during the Movement phase (EP25 pp. 14–15)', () => {
    let state = epPlayable('spices', 3);
    const ship = shipOf(state, 'p1');
    const anchor = councilAnchors(state, epState(state))[0]!;
    ship.edge = topologyOf(state).vertices[anchor]!.edges.find((edge) => isSeaRoute(state, edge))!;
    ship.cargo = ['spice', 'spice'];
    const probe = run(moving(JSON.parse(JSON.stringify(state)) as GameState), 'p1', { type: 'ep.deliver', ship: ship.id }).state;
    const gain = scoreOf(probe, 'p1', { includeHidden: true }) - scoreOf(state, 'p1', { includeHidden: true });
    expect(gain).toBeGreaterThan(0);
    const topo = topologyOf(state);
    for (let index = 0; index < topo.vertices.length && scoreOf(state, 'p1', { includeHidden: true }) < 15 - gain; index++) {
      if (state.board.buildings[index] || neighborsOfVertex(topo, index).some((neighbor) => state.board.buildings[neighbor])) continue;
      state.board.buildings[index] = { player: 'p1', city: false };
    }
    expect(scoreOf(state, 'p1', { includeHidden: true })).toBe(15 - gain);
    state = moving(state);
    const outcome = run(state, 'p1', { type: 'ep.deliver', ship: ship.id });
    expect(outcome.state.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
  });
});

describe('R-EP chase details (EP25 pp. 11, 14)', () => {
  /** p1's two ships at the hex of p2's pirate, in the Movement phase. */
  function chaseSetup() {
    const state = epPlayable('spices', 3);
    const slot = epState(state);
    const first = shipOf(state, 'p1');
    const topo = topologyOf(state);
    const pirateHex = topo.edges[first.edge]!.hexes.find((cell) => state.board.layout.terrain[cell] === 'sea' && cell !== slot.council)!;
    slot.pirate = { hex: pirateHex, owner: 'p2' };
    const other = topo.edges.findIndex((info, edge) => edge !== first.edge && info.hexes.includes(pirateHex)
      && isSeaRoute(state, edge) && !slot.ships.some((ship) => ship.edge === edge));
    const second: EpShip = { id: 'x2', player: 'p1', edge: other, cargo: [] };
    slot.ships.push(second);
    return { state: moving(state), first, second, pirateHex };
  }

  it('R-EP-58 each battle-ready ship chases once; a moved ship cannot; Pirate Bonus adds its number', () => {
    let { state, first, second } = chaseSetup();
    // Without the bonus, a 2 misses.
    state = run(state, 'p1', { type: 'ep.chase', ship: first.id }, scriptedRng([1])).state;
    expect(epState(state).pirate).not.toBeNull();
    expect(refused(state, 'p1', { type: 'ep.chase', ship: first.id }, scriptedRng([5]))).toBe('E_EP_NOT_BATTLE_READY');
    // The second ship is still battle-ready; after it moves it is not.
    const moved = JSON.parse(JSON.stringify(state)) as GameState;
    const step = epHints(moved, 'p1').ships.find((ship) => ship.id === second.id)!.steps.find((entry) => !entry.explores && !entry.full)!.edge;
    const afterMove = run(moved, 'p1', { type: 'ep.moveShip', ship: second.id, edge: step }).state;
    expect(refused(afterMove, 'p1', { type: 'ep.chase', ship: second.id }, scriptedRng([5]))).toBe('E_EP_NOT_BATTLE_READY');
    // With a Pirate Bonus farm on 2, the second ship's 2 chases the pirate away.
    epState(state).sites.push({ hex: -1, kind: 'spice', ability: 'pirateBonus', bonus: 2, crews: ['p1'], sacks: [] });
    const chased = run(state, 'p1', { type: 'ep.chase', ship: second.id }, scriptedRng([1]));
    expect(chased.events.find((event) => event.type === 'ep.chaseRolled')!.params).toMatchObject({ die: 2, success: true });
    expect(epState(chased.state).pirate).toBeNull();
    expect(chased.state.pending?.kind).toBe('explorersPirates.pirate');
  });
});

