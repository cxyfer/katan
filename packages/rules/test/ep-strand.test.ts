/**
 * Issue #97: a ship must be able to end its movement legally. Steps into a
 * full edge are offered and accepted only if a legal stop (a non-full edge,
 * or founding with a settler aboard) can still be reached with the MP the
 * ship has; a ship already stuck with no way out may end its movement there
 * (FIDELITY E&P interpretation 15, `ep-2025.2`). Every case runs on all five
 * profiles.
 */

import { describe, expect, it } from 'vitest';
import { neighborsOfVertex, topologyOf } from '../src/analysis.ts';
import { actionHints } from '../src/engine.ts';
import type { EpScenarioId } from '../src/explorers-pirates-boards.ts';
import { fogAtEnds, isExploredLand, isSeaRoute, isWater } from '../src/modules/explorersPirates/geometry.ts';
import { plainSettlements } from '../src/modules/explorersPirates/core.ts';
import { activeShipMustMove, canStopFrom, foundTargets, stepTargets } from '../src/modules/explorersPirates/movement.ts';
import { emptyTurn, epState, siteAt, viewTurn, type Cargo, type EpShip, type EpShipTurn } from '../src/modules/explorersPirates/state.ts';
import { getProfile } from '../src/profiles.ts';
import type { GameState } from '../src/types.ts';
import { EP_PROFILE, epGame, nextEdges, refused, run, type AnyCommand } from './ep-helpers.ts';
import { epHints, epPlayable } from './ep-sim.ts';
import { forceTurn } from './helpers.ts';

const SCENARIOS = Object.keys(EP_PROFILE) as EpScenarioId[];
const FISH: readonly EpScenarioId[] = ['fish', 'spices', 'explorers-pirates'];
const CASES = SCENARIOS.map((scenario) => [EP_PROFILE[scenario], scenario] as const);
/** Spice farms, and so Swift Voyage, exist only in Spices for Catan and the full game (EP25 p. 14). */
const SPICE_CASES = CASES.filter(([, scenario]) => scenario === 'spices' || scenario === 'explorers-pirates');

// -- boards ------------------------------------------------------------------------

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function board(scenario: EpScenarioId): GameState {
  const state = epPlayable(scenario, 4, 1);
  epState(state).pirate = null;
  // No wool: the extra move is not an escape unless a case grants it.
  state.bank.wool += state.players[0]!.resources.wool;
  state.players[0]!.resources.wool = 0;
  return state;
}

function clear(state: GameState, edge: number): boolean {
  return isSeaRoute(state, edge) && fogAtEnds(state, edge).length === 0;
}

function ship(id: string, player: string, edge: number, cargo: Cargo[] = []): EpShip {
  return { id, player, edge, cargo };
}

/** The ship `x` of p1 is in motion with `used` MP spent (Movement phase). */
function inMotion(state: GameState, used: number, record: Partial<EpShipTurn> = {}): GameState {
  epState(state).turn = {
    ...emptyTurn(state.windowId),
    phase: 'movement',
    active: 'x',
    ships: { x: { used, extra: false, done: false, tribute: false, chased: false, ...record } },
  };
  return state;
}

interface Strand { s0: number; s1: number; a: number; b: number; c: number; y: number }

/**
 * The issue's map: S0 → S1 → A → B, where B's only sea neighbours are A and
 * C, all clear of fog, plus an edge Y far from them for p1's second ship.
 */
function strandEdges(state: GameState): Strand {
  const topo = topologyOf(state);
  for (let b = 0; b < topo.edges.length; b++) {
    const around = nextEdges(state, b);
    if (!clear(state, b) || around.length !== 2 || !around.every((edge) => clear(state, edge))) continue;
    for (const [a, c] of [[around[0]!, around[1]!], [around[1]!, around[0]!]] as const) {
      for (const s1 of nextEdges(state, a).filter((edge) => edge !== b && edge !== c && clear(state, edge))) {
        for (const s0 of nextEdges(state, s1).filter((edge) => ![a, b, c].includes(edge) && clear(state, edge))) {
          const used = [s0, s1, a, b, c];
          const y = topo.edges.findIndex((_, edge) => clear(state, edge) && !used.includes(edge)
            && !nextEdges(state, edge).some((other) => used.includes(other)));
          if (y >= 0) return { s0, s1, a, b, c, y };
        }
      }
    }
  }
  throw new Error('no strand map');
}

/** Two other ships on A, B and C; p1's `x` on S0 and `y` on Y (the issue's reproduction). */
function issueBoard(scenario: EpScenarioId): { state: GameState; e: Strand } {
  const state = board(scenario);
  const e = strandEdges(state);
  const [p1, p2, p3, p4] = state.players.map((player) => player.id) as [string, string, string, string];
  epState(state).ships = [
    ship('x', p1, e.s0), ship('y', p1, e.y),
    ship('a1', p2, e.a), ship('a2', p3, e.a),
    ship('b1', p2, e.b), ship('b2', p3, e.b),
    ship('c1', p4, e.c), ship('c2', p4, e.c),
  ];
  return { state, e };
}

/** The deadlock of issue #97 written into the state: `x` on B with 1 MP left. */
function stuck(scenario: EpScenarioId): { state: GameState; e: Strand } {
  const { state, e } = issueBoard(scenario);
  epState(state).ships.find((entry) => entry.id === 'x')!.edge = e.b;
  return { state: inMotion(state, 3), e };
}

/**
 * p1's `own` ships plus two other ships on every sea route, except the
 * edges in `others` (edge → number of other ships there).
 */
function crowd(state: GameState, own: EpShip[], others: Record<number, number> = {}): void {
  const opponents = state.players.slice(1).map((player) => player.id);
  const ships = own.slice();
  topologyOf(state).edges.forEach((_, edge) => {
    if (!isSeaRoute(state, edge)) return;
    for (let i = 0; i < (others[edge] ?? 2); i++) ships.push(ship(`f${edge}-${i}`, opponents[(edge + i) % opponents.length]!, edge));
  });
  epState(state).ships = ships;
}

/** Distance (in steps) from every edge to `target`, through edges that pass `through`. */
function distanceTo(state: GameState, target: number, through: (edge: number) => boolean = () => true): Map<number, number> {
  const out = new Map([[target, 0]]);
  const queue = [target];
  while (queue.length > 0) {
    const edge = queue.shift()!;
    for (const next of nextEdges(state, edge)) {
      if (out.has(next) || !through(next)) continue;
      out.set(next, out.get(edge)! + 1);
      queue.push(next);
    }
  }
  return out;
}

/**
 * A shortest route e0 → e1 → … → e{length} over clear edges: the last edge
 * is `length - 1` steps from e1 and `length` from e0.
 */
function corridor(state: GameState, length = 3, accept: (e0: number) => boolean = () => true): number[] {
  const topo = topologyOf(state);
  const through = (edge: number) => clear(state, edge);
  for (let last = 0; last < topo.edges.length; last++) {
    if (!clear(state, last)) continue;
    const dist = distanceTo(state, last, through);
    for (const [e0, d0] of dist) {
      if (d0 !== length || !accept(e0)) continue;
      const route = [e0];
      while (route.length <= length) {
        const here = route[route.length - 1]!;
        route.push(nextEdges(state, here).find((edge) => dist.get(edge) === dist.get(here)! - 1)!);
      }
      return route;
    }
  }
  throw new Error(`no corridor of ${length}`);
}

type Touch = Partial<Record<'e0' | 'e1' | 'e2', boolean>>;

/** e0 → e1 → e2 (e2 not next to e0), all clear, and a water hex touching them as `touch` says. */
function pirateRoute(state: GameState, touch: Touch): { e0: number; e1: number; e2: number; hex: number } {
  const topo = topologyOf(state);
  const slot = epState(state);
  for (let e1 = 0; e1 < topo.edges.length; e1++) {
    if (!clear(state, e1)) continue;
    for (const e0 of nextEdges(state, e1).filter((edge) => clear(state, edge))) {
      for (const e2 of nextEdges(state, e1).filter((edge) => edge !== e0 && clear(state, edge) && !nextEdges(state, e0).includes(edge))) {
        const route = { e0, e1, e2 };
        for (const hex of new Set([e0, e1, e2].flatMap((edge) => topo.edges[edge]!.hexes))) {
          if (!isWater(state, slot, hex)) continue;
          const fits = (Object.entries(route) as [keyof Touch, number][])
            .every(([name, edge]) => touch[name] === undefined || topo.edges[edge]!.hexes.includes(hex) === touch[name]);
          if (fits) return { ...route, hex };
        }
      }
    }
  }
  throw new Error(`no pirate route ${JSON.stringify(touch)}`);
}

/**
 * Every edge full except the `free` ones; x passes through e0 (two other
 * ships there) with `used` MP spent; p2's pirate on `hex`. Land Ho! has no
 * pirate ships: the pirate is written into the state to exercise the tribute
 * rule the five profiles share.
 */
function tributeBoard(scenario: EpScenarioId, touch: Touch, options: {
  free: (route: { e0: number; e1: number; e2: number }) => number[];
  gold: number;
  used?: number;
  paid?: boolean;
}) {
  const state = board(scenario);
  const route = pirateRoute(state, touch);
  crowd(state, [ship('x', 'p1', route.e0)], Object.fromEntries(options.free(route).map((edge) => [edge, 0])));
  epState(state).pirate = { hex: route.hex, owner: 'p2' };
  epState(state).gold.p1 = options.gold;
  inMotion(state, options.used ?? 2, { tribute: options.paid ?? false });
  return { state, ...route };
}

/** An edge where a settler aboard could found a settlement, and a clear neighbour. */
function foundingEdge(state: GameState): { from: number; site: number } {
  const topo = topologyOf(state);
  for (let site = 0; site < topo.edges.length; site++) {
    if (!clear(state, site) || foundTargets(state, ship('probe', 'p1', site, ['settler'])).length === 0) continue;
    const from = nextEdges(state, site).find((edge) => clear(state, edge));
    if (from !== undefined) return { from, site };
  }
  throw new Error('no founding edge');
}

/** A clear edge where a settler aboard has nowhere to found. */
function barrenEdge(state: GameState): number {
  const topo = topologyOf(state);
  const edge = topo.edges.findIndex((_, index) => clear(state, index)
    && foundTargets(state, ship('probe', 'p1', index, ['settler'])).length === 0);
  if (edge < 0) throw new Error('no barren edge');
  return edge;
}

// -- probes ------------------------------------------------------------------------

function shipHint(state: GameState, id: string) {
  return epHints(state, 'p1').ships.find((entry) => entry.id === id)!;
}

function stepsOf(state: GameState, id: string): number[] {
  return shipHint(state, id).steps.map((step) => step.edge);
}

function outcome(state: GameState, command: AnyCommand, actor = 'p1'): string {
  try {
    run(state, actor, command);
    return 'accepted';
  } catch {
    return refused(state, actor, command);
  }
}

function shipsOn(state: GameState, edge: number): string[] {
  return epState(state).ships.filter((entry) => entry.edge === edge).map((entry) => entry.id).sort();
}

/** Every state `x` can reach with accepted steps from `state`. */
function reachable(state: GameState): GameState[] {
  const out: GameState[] = [];
  const stack = [state];
  while (stack.length > 0) {
    const current = stack.pop()!;
    out.push(current);
    for (const edge of stepsOf(current, 'x')) stack.push(run(current, 'p1', { type: 'ep.moveShip', ship: 'x', edge }).state);
  }
  return out;
}

// -- (1) no new dead ends ------------------------------------------------------------

describe('#97 steps into a full edge need a reachable legal stop', () => {
  it.each(CASES)('%s: the issue route S0 → S1 → A is open, A → B is not', (_profile, scenario) => {
    const { state: start, e } = issueBoard(scenario);
    let state = run(start, 'p1', { type: 'ep.startMovement' }).state;
    state = run(state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e.s1 }).state;
    // A is full but still has a way back to S1.
    expect(shipHint(state, 'x').steps.find((step) => step.edge === e.a)).toMatchObject({ full: true, explores: false });
    state = run(state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e.a }).state;
    expect(epHints(state, 'p1').stranded).toBe(true);
    // From B, 1 MP is left and both A and C are full: no step, so B is closed.
    expect(stepsOf(state, 'x')).not.toContain(e.b);
    expect(stepsOf(state, 'x')).toContain(e.s1);
    expect(refused(state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e.b })).toBe('E_EP_EDGE_FULL');
  });

  it.each(CASES)('%s: no sequence of accepted steps leaves the turn unable to end', (_profile, scenario) => {
    const { state: start } = issueBoard(scenario);
    const states = reachable(run(start, 'p1', { type: 'ep.startMovement' }).state);
    expect(states.length).toBeGreaterThan(10);
    for (const state of states) {
      const hints = actionHints(state, 'p1');
      const x = shipHint(state, 'x');
      // Either the turn can end, or the ship in motion has a step to take.
      expect(hints.canEndTurn || (epHints(state, 'p1').stranded && x.steps.length > 0)).toBe(true);
    }
  });

  it.each(CASES)('%s: passing through needs exactly the MP of the route', (_profile, scenario) => {
    const state = board(scenario);
    const [e0, e1, e2, e3] = corridor(state);
    // Everything is full except e3; x passes through e0 in motion.
    crowd(state, [ship('x', 'p1', e0)], { [e3]: 0 });
    const enough = inMotion(copy(state), 1);
    expect(stepsOf(enough, 'x')).toContain(e1);
    let moved = run(enough, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e1 }).state;
    moved = run(moved, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e2 }).state;
    moved = run(moved, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e3 }).state;
    expect(actionHints(moved, 'p1').canEndTurn).toBe(true);
    // One MP short: e3 is out of reach from e1, so e1 is closed.
    const short = inMotion(copy(state), 2);
    expect(stepsOf(short, 'x')).not.toContain(e1);
    expect(refused(short, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e1 })).toBe('E_EP_EDGE_FULL');
  });

  it.each(CASES)('%s: the edge the ship left does not count the ship itself', (_profile, scenario) => {
    let state = board(scenario);
    const e0 = topologyOf(state).edges.findIndex((_, edge) => clear(state, edge) && nextEdges(state, edge).some((next) => clear(state, next)));
    const e1 = nextEdges(state, e0).find((edge) => clear(state, edge))!;
    // x shares e0 with one ship; every other edge is full.
    crowd(state, [ship('x', 'p1', e0)], { [e0]: 1 });
    state = inMotion(state, 2);
    expect(shipHint(state, 'x').steps.find((step) => step.edge === e1)).toMatchObject({ full: true });
    state = run(state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e1 }).state;
    expect(shipHint(state, 'x').steps.find((step) => step.edge === e0)).toMatchObject({ full: false });
    state = run(state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e0 }).state;
    expect(run(state, 'p1', { type: 'turn.end' }).state.turn.seat).toBe(1);
  });

  it.each(CASES)('%s: a route back through the start edge counts (the start is full)', (_profile, scenario) => {
    const state = board(scenario);
    const topo = topologyOf(state);
    let route: [number, number, number] | null = null;
    for (let e0 = 0; e0 < topo.edges.length && !route; e0++) {
      if (!clear(state, e0)) continue;
      const around = nextEdges(state, e0).filter((edge) => clear(state, edge));
      for (const e1 of around) {
        // e1 and e2 sit at opposite ends of e0, and e0 is their only common neighbour.
        const e2 = around.find((edge) => edge !== e1 && !nextEdges(state, e1).includes(edge)
          && nextEdges(state, e1).filter((next) => nextEdges(state, edge).includes(next)).join() === `${e0}`);
        if (e2 !== undefined) {
          route = [e0, e1, e2];
          break;
        }
      }
    }
    const [e0, e1, e2] = route!;
    crowd(state, [ship('x', 'p1', e0)], { [e2]: 0 });
    // 3 MP: e1, back through e0 (two other ships), then e2.
    let moved = inMotion(copy(state), 1);
    moved = run(moved, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e1 }).state;
    expect(shipHint(moved, 'x').steps).toEqual([{ edge: e0, tribute: false, full: true, explores: false }]);
    moved = run(moved, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e0 }).state;
    moved = run(moved, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e2 }).state;
    expect(actionHints(moved, 'p1').canEndTurn).toBe(true);
    const short = inMotion(copy(state), 2);
    expect(refused(short, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e1 })).toBe('E_EP_EDGE_FULL');
  });

  it.each(CASES)('%s: an exit behind unpayable tribute is no exit', (_profile, scenario) => {
    // p2's pirate touches e2 only: the step into e1 is free, the step out of it costs 1 gold.
    const touch = { e0: false, e1: false, e2: true };
    const free = ({ e2 }: { e2: number }) => [e2];
    const poor = tributeBoard(scenario, touch, { free, gold: 0 });
    expect(stepsOf(poor.state, 'x')).not.toContain(poor.e1);
    expect(refused(poor.state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: poor.e1 })).toBe('E_EP_EDGE_FULL');
    const paying = tributeBoard(scenario, touch, { free, gold: 1 });
    expect(shipHint(paying.state, 'x').steps.find((step) => step.edge === paying.e1)).toMatchObject({ full: true, tribute: false });
    let moved = run(paying.state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: paying.e1 }).state;
    expect(shipHint(moved, 'x').steps).toEqual([{ edge: paying.e2, tribute: true, full: false, explores: false }]);
    moved = run(moved, 'p1', { type: 'ep.moveShip', ship: 'x', edge: paying.e2 }).state;
    expect(epState(moved).gold.p1).toBe(0);
    expect(actionHints(moved, 'p1').canEndTurn).toBe(true);
    // Tribute already paid this turn: no coin is needed any more.
    const paid = tributeBoard(scenario, touch, { free, gold: 0, paid: true });
    expect(shipHint(paid.state, 'x').steps.find((step) => step.edge === paid.e1)).toMatchObject({ full: true, tribute: false });
    moved = run(paid.state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: paid.e1 }).state;
    expect(shipHint(moved, 'x').steps).toEqual([{ edge: paid.e2, tribute: false, full: false, explores: false }]);
    moved = run(moved, 'p1', { type: 'ep.moveShip', ship: 'x', edge: paid.e2 }).state;
    expect(actionHints(moved, 'p1').canEndTurn).toBe(true);
  });

  it.each(CASES)('%s: tribute is paid once, also when the route stays at the pirate', (_profile, scenario) => {
    const touch = { e0: false, e1: true, e2: true };
    const free = ({ e2 }: { e2: number }) => [e2];
    const board1 = tributeBoard(scenario, touch, { free, gold: 1 });
    expect(shipHint(board1.state, 'x').steps.find((step) => step.edge === board1.e1)).toMatchObject({ full: true, tribute: true });
    let moved = run(board1.state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: board1.e1 }).state;
    expect(epState(moved).gold.p1).toBe(0);
    expect(shipHint(moved, 'x').steps).toEqual([{ edge: board1.e2, tribute: false, full: false, explores: false }]);
    moved = run(moved, 'p1', { type: 'ep.moveShip', ship: 'x', edge: board1.e2 }).state;
    expect(actionHints(moved, 'p1').canEndTurn).toBe(true);
    const poor = tributeBoard(scenario, touch, { free, gold: 0 });
    expect(refused(poor.state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: poor.e1 })).toBe('E_EP_TRIBUTE');
  });

  it.each(CASES)('%s: leaving the pirate costs tribute even when the next edge is clear of it', (_profile, scenario) => {
    const touch = { e0: true, e1: false, e2: false };
    const free = ({ e2 }: { e2: number }) => [e2];
    const poor = tributeBoard(scenario, touch, { free, gold: 0 });
    expect(stepsOf(poor.state, 'x')).toEqual([]);
    expect(refused(poor.state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: poor.e1 })).toBe('E_EP_TRIBUTE');
    const paying = tributeBoard(scenario, touch, { free, gold: 1 });
    expect(shipHint(paying.state, 'x').steps.find((step) => step.edge === paying.e1)).toMatchObject({ full: true, tribute: true });
    const moved = run(paying.state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: paying.e1 }).state;
    expect(shipHint(moved, 'x').steps).toEqual([{ edge: paying.e2, tribute: false, full: false, explores: false }]);
  });

  it.each(CASES)('%s: a dead-end full step is E_EP_EDGE_FULL even when the tribute is affordable', (_profile, scenario) => {
    // The pirate touches e1; every edge is full, so e1 has no exit.
    const touch = { e1: true };
    const none = () => [];
    for (const used of [2, 3]) {
      const rich = tributeBoard(scenario, touch, { free: none, gold: 1, used });
      expect(stepsOf(rich.state, 'x')).not.toContain(rich.e1);
      expect(refused(rich.state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: rich.e1 })).toBe('E_EP_EDGE_FULL');
    }
    const poor = tributeBoard(scenario, touch, { free: none, gold: 0 });
    expect(refused(poor.state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: poor.e1 })).toBe('E_EP_TRIBUTE');
  });

  it.each(SPICE_CASES)('%s: 8 MP with both Swift Voyage farms and the extra move is the bound', (_profile, scenario) => {
    const state = board(scenario);
    const slot = epState(state);
    // An explored sea everywhere, so a shortest route of 8 steps exists on every map.
    slot.fog = [];
    const route = corridor(state, 8);
    const land = topologyOf(state).hexes.map((_, hex) => hex)
      .filter((hex) => isExploredLand(state, slot, hex) && !siteAt(slot, hex)).slice(0, 2);
    for (const hex of land) slot.sites.push({ hex, kind: 'spice', ability: 'swift', bonus: null, crews: ['p1'], sacks: [] });
    crowd(state, [ship('x', 'p1', route[0]!)], { [route[8]!]: 0 });
    let moved = inMotion(copy(state), 0, { extra: true });
    expect(shipHint(moved, 'x').movesLeft).toBe(8);
    for (const edge of route.slice(1)) moved = run(moved, 'p1', { type: 'ep.moveShip', ship: 'x', edge }).state;
    expect(actionHints(moved, 'p1').canEndTurn).toBe(true);
    const short = inMotion(copy(state), 1, { extra: true });
    expect(stepsOf(short, 'x')).not.toContain(route[1]);
    expect(refused(short, 'p1', { type: 'ep.moveShip', ship: 'x', edge: route[1]! })).toBe('E_EP_EDGE_FULL');
  });

  it.each(SPICE_CASES)('%s: a Swift Voyage crew landed mid-move opens the step at once', (_profile, scenario) => {
    const state = board(scenario);
    const slot = epState(state);
    const landAt = (edge: number) => topologyOf(state).edges[edge]!.vertices
      .flatMap((vertex) => topologyOf(state).vertices[vertex]!.hexes)
      .find((hex) => isExploredLand(state, slot, hex) && !siteAt(slot, hex));
    const [e0, e1, , e3] = corridor(state, 3, (edge) => landAt(edge) !== undefined);
    const hex = landAt(e0!)!;
    slot.sites.push({ hex, kind: 'spice', ability: 'swift', bonus: null, crews: [], sacks: [] });
    crowd(state, [ship('x', 'p1', e0!, ['crew'])], { [e3!]: 0 });
    inMotion(state, 2);
    expect(stepsOf(state, 'x')).not.toContain(e1);
    const landed = run(state, 'p1', { type: 'ep.dropCrew', ship: 'x', hex }).state;
    expect(shipHint(landed, 'x').movesLeft).toBe(3);
    expect(stepsOf(landed, 'x')).toContain(e1);
  });

  it.each(CASES)('%s: founding with the settler aboard is an exit from a full edge', (_profile, scenario) => {
    const state = board(scenario);
    const { from, site } = foundingEdge(state);
    crowd(state, [ship('x', 'p1', from, ['settler'])]);
    inMotion(state, 2);
    expect(stepsOf(state, 'x')).toContain(site);
    const moved = run(state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: site }).state;
    expect(epHints(moved, 'p1').stranded).toBe(true);
    const vertex = shipHint(moved, 'x').found[0]!;
    const founded = run(moved, 'p1', { type: 'ep.found', ship: 'x', vertex }).state;
    expect(run(founded, 'p1', { type: 'turn.end' }).state.turn.seat).toBe(1);
    // Without the settler the same step leads nowhere.
    const empty = copy(state);
    epState(empty).ships.find((entry) => entry.id === 'x')!.cargo = [];
    expect(stepsOf(empty, 'x')).not.toContain(site);
    expect(refused(empty, 'p1', { type: 'ep.moveShip', ship: 'x', edge: site })).toBe('E_EP_EDGE_FULL');
  });
});

// -- (2) rescue: a stuck ship may end its movement ------------------------------------

describe('#97 a ship stuck on a full edge with no exit ends its movement there', () => {
  it.each(CASES)('%s: turn end, ship switch and fish roll are accepted; the edge holds three ships', (_profile, scenario) => {
    const { state, e } = stuck(scenario);
    const hints = actionHints(state, 'p1');
    expect(shipHint(state, 'x').steps).toEqual([]);
    expect(epHints(state, 'p1').stranded).toBe(false);
    expect(hints.canEndTurn).toBe(true);

    const ended = run(state, 'p1', { type: 'turn.end' }).state;
    expect(ended.turn.seat).toBe(1);
    expect(shipsOn(ended, e.b)).toEqual(['b1', 'b2', 'x']);
    expect(epState(ended).turn.active).toBeNull();
    expect(epState(ended).turn.ships.x!.done).toBe(true);

    const away = stepsOf(state, 'y');
    expect(away.length).toBeGreaterThan(0);
    const switched = run(state, 'p1', { type: 'ep.moveShip', ship: 'y', edge: away[0]! }).state;
    expect(epState(switched).turn.ships.x!.done).toBe(true);
    expect(epState(switched).turn.active).toBe('y');
    expect(refused(switched, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e.a })).toBe('E_EP_SHIP_DONE');
    expect(shipsOn(switched, e.b)).toEqual(['b1', 'b2', 'x']);
    expect(actionHints(switched, 'p1').canEndTurn).toBe(true);

    expect(epHints(state, 'p1').fishRoll).toBe(FISH.includes(scenario));
    expect(outcome(state, { type: 'ep.fishRoll' })).toBe(FISH.includes(scenario) ? 'accepted' : 'E_EP_NOT_IN_SCENARIO');
    if (FISH.includes(scenario)) {
      const rolled = run(state, 'p1', { type: 'ep.fishRoll' }).state;
      expect(epState(rolled).turn.ships.x!.done).toBe(true);
      expect(epState(rolled).turn.active).toBeNull();
      expect(run(rolled, 'p1', { type: 'turn.end' }).state.turn.seat).toBe(1);
    }
  });

  it.each(CASES)('%s: next turn a fourth ship may only pass through, and ships on the edge sail off', (_profile, scenario) => {
    const { state: start, e } = stuck(scenario);
    const next = run(start, 'p1', { type: 'turn.end' }).state;
    forceTurn(next, 1, 'action');
    next.windowId += 1;
    // A new action window starts with an empty movement record.
    expect(viewTurn(next)).toMatchObject({ phase: 'action', active: null, ships: {} });
    const moving = run(next, 'p2', { type: 'ep.startMovement' }).state;
    const p2Steps = (state: GameState, id: string) =>
      epHints(state, 'p2').ships.find((entry) => entry.id === id)!.steps;

    // a1 may pass through B (back to A), but not stop on it.
    expect(p2Steps(moving, 'a1').find((step) => step.edge === e.b)).toMatchObject({ full: true });
    const passing = run(moving, 'p2', { type: 'ep.moveShip', ship: 'a1', edge: e.b }).state;
    expect(shipsOn(passing, e.b)).toEqual(['a1', 'b1', 'b2', 'x']);
    expect(epHints(passing, 'p2').stranded).toBe(true);
    expect(actionHints(passing, 'p2').canEndTurn).toBe(false);
    expect(refused(passing, 'p2', { type: 'turn.end' })).toBe('E_EP_EDGE_FULL');
    const back = run(passing, 'p2', { type: 'ep.moveShip', ship: 'a1', edge: e.a }).state;
    expect(run(back, 'p2', { type: 'turn.end' }).state.turn.seat).toBe(2);
    // With 1 MP left it may not enter at all.
    const tired = copy(moving);
    epState(tired).turn.ships.a1 = { used: 3, extra: false, done: false, tribute: false, chased: false };
    expect(refused(tired, 'p2', { type: 'ep.moveShip', ship: 'a1', edge: e.b })).toBe('E_EP_EDGE_FULL');

    // b1 leaves B through A and stops on S1.
    expect(p2Steps(moving, 'b1').map((step) => step.edge)).toContain(e.a);
    let leaving = run(moving, 'p2', { type: 'ep.moveShip', ship: 'b1', edge: e.a }).state;
    leaving = run(leaving, 'p2', { type: 'ep.moveShip', ship: 'b1', edge: e.s1 }).state;
    expect(shipsOn(leaving, e.b)).toEqual(['b2', 'x']);
    expect(run(leaving, 'p2', { type: 'turn.end' }).state.turn.seat).toBe(2);
  });

  it.each(CASES)('%s: a wool that would open a step is an exit; one that would not is not', (_profile, scenario) => {
    const { state: start, e } = stuck(scenario);
    const wool = copy(start);
    wool.players[0]!.resources.wool = 1;
    wool.bank.wool -= 1;
    expect(epHints(wool, 'p1').stranded).toBe(true);
    expect(actionHints(wool, 'p1').canEndTurn).toBe(false);
    expect(refused(wool, 'p1', { type: 'turn.end' })).toBe('E_EP_EDGE_FULL');
    let state = run(wool, 'p1', { type: 'ep.extraMove', ship: 'x' }).state;
    expect(shipHint(state, 'x').steps.find((step) => step.edge === e.a)).toMatchObject({ full: true });
    state = run(state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e.a }).state;
    state = run(state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e.s1 }).state;
    expect(run(state, 'p1', { type: 'turn.end' }).state.turn.seat).toBe(1);

    // Every edge full: even 2 more MP lead nowhere, so the ship may stop.
    const packed = board(scenario);
    const edge = barrenEdge(packed);
    crowd(packed, [ship('x', 'p1', edge)]);
    inMotion(packed, 3);
    packed.players[0]!.resources.wool = 1;
    packed.bank.wool -= 1;
    expect(epHints(packed, 'p1').stranded).toBe(false);
    const ended = run(packed, 'p1', { type: 'turn.end' }).state;
    expect(ended.players[0]!.resources.wool).toBe(1);
    expect(shipsOn(ended, edge)).toHaveLength(3);
  });

  it.each(CASES)('%s: a settler with a site is an exit; a settler without one is not', (_profile, scenario) => {
    const state = board(scenario);
    const { site } = foundingEdge(state);
    crowd(state, [ship('x', 'p1', site, ['settler'])]);
    inMotion(state, 3);
    expect(epHints(state, 'p1').stranded).toBe(true);
    expect(refused(state, 'p1', { type: 'turn.end' })).toBe('E_EP_EDGE_FULL');
    const founded = run(state, 'p1', { type: 'ep.found', ship: 'x', vertex: shipHint(state, 'x').found[0]! }).state;
    expect(run(founded, 'p1', { type: 'turn.end' }).state.turn.seat).toBe(1);

    const barren = board(scenario);
    const edge = barrenEdge(barren);
    crowd(barren, [ship('x', 'p1', edge, ['settler'])]);
    inMotion(barren, 3);
    expect(epHints(barren, 'p1').stranded).toBe(false);
    expect(run(barren, 'p1', { type: 'turn.end' }).state.turn.seat).toBe(1);
  });
});

describe('#97 a legal command can take the last exit away', () => {
  /** A site edge, one of its found vertices, a clear way in, and another sea edge at that vertex. */
  function sharedSite(state: GameState) {
    const topo = topologyOf(state);
    for (let site = 0; site < topo.edges.length; site++) {
      if (!clear(state, site)) continue;
      for (const vertex of foundTargets(state, ship('probe', 'p1', site, ['settler']))) {
        const other = topo.vertices[vertex]!.edges.find((edge) => edge !== site && isSeaRoute(state, edge));
        const from = nextEdges(state, site).find((edge) => edge !== other && clear(state, edge));
        if (other !== undefined && from !== undefined) return { site, vertex, other, from };
      }
    }
    throw new Error('no shared site');
  }

  it.each(CASES)('%s: another ship founding on the site leaves the stranded ship no exit, so it may stop', (_profile, scenario) => {
    let state = board(scenario);
    const { site, vertex, other, from } = sharedSite(state);
    // x may enter the full site edge because its settler can found there.
    crowd(state, [ship('x', 'p1', from, ['settler']), ship('y', 'p1', other, ['settler'])]);
    state = inMotion(state, 2);
    state = run(state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: site }).state;
    expect(shipHint(state, 'x').found).toContain(vertex);
    expect(epHints(state, 'p1').stranded).toBe(true);
    expect(refused(state, 'p1', { type: 'turn.end' })).toBe('E_EP_EDGE_FULL');
    // y founds first: the site is taken and both ends of x's edge break the distance rule.
    state = run(state, 'p1', { type: 'ep.found', ship: 'y', vertex }).state;
    expect(shipHint(state, 'x').found).toEqual([]);
    expect(shipHint(state, 'x').steps).toEqual([]);
    expect(epHints(state, 'p1').stranded).toBe(false);
    const ended = run(state, 'p1', { type: 'turn.end' }).state;
    expect(shipsOn(ended, site)).toHaveLength(3);
  });

  it('Land Ho!: another ship reaching the settlement limit takes the founding exit away (FIDELITY E&P interpretation 15)', () => {
    // The reviewer's case on the issue map: S0 58 → S1 33 → A 34 → B 2; C 3; y on 83.
    const state = board('land-ho');
    expect(strandEdges(state)).toMatchObject({ s0: 58, s1: 33, a: 34, b: 2, c: 3 });
    const [p1, p2, p3, p4] = state.players.map((player) => player.id) as [string, string, string, string];
    epState(state).ships = [
      ship('x', p1, 58, ['settler']), ship('y', p1, 83, ['settler']),
      ship('a1', p2, 34), ship('a2', p3, 34), ship('b1', p2, 2), ship('b2', p3, 2), ship('c1', p4, 3), ship('c2', p4, 3),
    ];
    // Four plain settlements, away from the two founding sites.
    const topo = topologyOf(state);
    const keep = new Set([3, 64, ...neighborsOfVertex(topo, 3), ...neighborsOfVertex(topo, 64)]);
    for (let vertex = 0; vertex < topo.vertices.length && plainSettlements(state, p1) < 4; vertex++) {
      if (state.board.buildings[vertex] || keep.has(vertex) || neighborsOfVertex(topo, vertex).some((next) => state.board.buildings[next])) continue;
      state.board.buildings[vertex] = { player: p1, city: false };
    }
    expect(plainSettlements(state, p1)).toBe(4);
    let moved = run(state, p1, { type: 'ep.startMovement' }).state;
    for (const edge of [33, 34, 2]) moved = run(moved, p1, { type: 'ep.moveShip', ship: 'x', edge }).state;
    expect(shipHint(moved, 'x').found).toEqual([3]);
    expect(epHints(moved, p1).stranded).toBe(true);
    moved = run(moved, p1, { type: 'ep.found', ship: 'y', vertex: 64 }).state;
    expect(plainSettlements(moved, p1)).toBe(5);
    expect(shipHint(moved, 'x').found).toEqual([]);
    expect(epHints(moved, p1).stranded).toBe(false);
    expect(actionHints(moved, p1).canEndTurn).toBe(true);
    expect(shipsOn(moved, 2)).toEqual(['b1', 'b2', 'x']);
    expect(run(moved, p1, { type: 'turn.end' }).state.turn.seat).toBe(1);
  });

  it.each(CASES)('%s: the checks never change the state they read', (_profile, scenario) => {
    const { state: start } = stuck(scenario);
    start.players[0]!.resources.wool = 1;
    start.bank.wool -= 1;
    epState(start).ships.find((entry) => entry.id === 'x')!.cargo = ['settler'];
    const before = copy(start);
    const x = epState(start).ships.find((entry) => entry.id === 'x')!;
    activeShipMustMove(start);
    stepTargets(start, x);
    canStopFrom(start, x, x.edge, 3, false, 0);
    actionHints(start, 'p1');
    expect(start).toEqual(before);
  });
});

// -- (3) hints agree with the engine --------------------------------------------------

describe('#97 hints match the engine while a ship must sail on', () => {
  it.each(CASES)('%s: no fish roll and no other ship steps while the ship in motion must move', (_profile, scenario) => {
    const { state: start, e } = issueBoard(scenario);
    let state = run(start, 'p1', { type: 'ep.startMovement' }).state;
    state = run(state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e.s1 }).state;
    state = run(state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e.a }).state;
    expect(epHints(state, 'p1').stranded).toBe(true);
    expect(epHints(state, 'p1').fishRoll).toBe(false);
    expect(outcome(state, { type: 'ep.fishRoll' })).toBe(FISH.includes(scenario) ? 'E_EP_EDGE_FULL' : 'E_EP_NOT_IN_SCENARIO');
    expect(shipHint(state, 'y').steps).toEqual([]);
    for (const edge of nextEdges(state, e.y)) {
      expect(refused(state, 'p1', { type: 'ep.moveShip', ship: 'y', edge })).toBe('E_EP_EDGE_FULL');
    }
  });

  it.each(CASES)('%s: once rescued, the fish roll and the other ship steps are offered and accepted', (_profile, scenario) => {
    const { state } = stuck(scenario);
    expect(outcome(state, { type: 'ep.fishRoll' }) === 'accepted').toBe(epHints(state, 'p1').fishRoll);
    const away = stepsOf(state, 'y');
    expect(away.length).toBeGreaterThan(0);
    for (const edge of away) expect(outcome(state, { type: 'ep.moveShip', ship: 'y', edge })).toBe('accepted');
  });
});

// -- (4) rule version -------------------------------------------------------------------

describe('#97 rule version ep-2025.2', () => {
  it.each(CASES)('%s: new games record ep-2025.2', (profile, scenario) => {
    expect(getProfile(profile)!.ruleVersion).toBe('ep-2025.2');
    expect(epGame(scenario).state.engineVersion).toBe('ep-2025.2');
  });

  it.each(CASES)('%s: an unfinished ep-2025.1 game runs the fixed rules and is rescued', (_profile, scenario) => {
    const { state: current } = stuck(scenario);
    const saved = copy(current);
    saved.engineVersion = 'ep-2025.1';
    expect(actionHints(saved, 'p1')).toEqual(actionHints(current, 'p1'));
    const away = stepsOf(current, 'y')[0]!;
    const commands: AnyCommand[] = [
      { type: 'turn.end' },
      { type: 'ep.fishRoll' },
      { type: 'ep.moveShip', ship: 'y', edge: away },
      { type: 'ep.extraMove', ship: 'x' },
    ];
    for (const command of commands) {
      expect(outcome(saved, command)).toBe(outcome(current, command));
    }
    const ended = run(saved, 'p1', { type: 'turn.end' }).state;
    expect(ended.engineVersion).toBe('ep-2025.1');
    expect({ ...ended, engineVersion: 'ep-2025.2' }).toEqual(run(current, 'p1', { type: 'turn.end' }).state);

    // Steps into a dead end are closed on the stored version as well.
    const { state: route, e } = issueBoard(scenario);
    route.engineVersion = 'ep-2025.1';
    let state = run(route, 'p1', { type: 'ep.startMovement' }).state;
    state = run(state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e.s1 }).state;
    state = run(state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e.a }).state;
    expect(refused(state, 'p1', { type: 'ep.moveShip', ship: 'x', edge: e.b })).toBe('E_EP_EDGE_FULL');
  });
});
