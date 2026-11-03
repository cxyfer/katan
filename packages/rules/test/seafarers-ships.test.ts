/**
 * R-SF ships: setup ship, sea-aware placement, ship building and movement.
 * Every case runs on the printed 4-player New Shores map (SF25 p. 5) around
 * the sea hex (2,0) east of the main island:
 *
 *   corners of (2,0): k3 = main-island coast (also corner 5 of (1,0)),
 *   k4 top, k5 / k0 on the north-east small island, k1 / k2 on the main island.
 *   ring edges: NW k3–k4, NE k4–k5, E k5–k0, SE k0–k1, SW k1–k2, W k2–k3.
 */

import { describe, expect, it } from 'vitest';
import { scoreOf } from '../src/analysis.ts';
import { actionHints, canPlaceBuilding } from '../src/engine.ts';
import type { GameState } from '../src/types.ts';
import { act, expectRejected, setHand } from './helpers.ts';
import { corner, emptySeafarersGame, hex, road, seafarersGame, settle, ship, side } from './seafarers-helpers.ts';

const SEA = { q: 2, r: 0 };

function ring(state: GameState) {
  const k = (n: number) => corner(state, SEA.q, SEA.r, n);
  const s = (n: number) => side(state, SEA.q, SEA.r, n);
  return {
    k0: k(0), k1: k(1), k2: k(2), k3: k(3), k4: k(4), k5: k(5),
    E: s(0), NE: s(1), NW: s(2), W: s(3), SW: s(4), SE: s(5),
  };
}

describe('setup with ships (SF25 pp. 3–4)', () => {
  it('starting settlements must stand on the main island and on land', () => {
    const { state } = seafarersGame(4);
    const r = ring(state);
    // k5 touches only the north-east small island and sea.
    expectRejected(state, 'p1', { type: 'setup.placeBuilding', vertex: r.k5 }, 'E_ILLEGAL_TARGET');
    // A vertex surrounded by sea (top corner of the sea hex (2,-3)).
    const seaOnly = corner(state, 2, -3, 4);
    expect(canPlaceBuilding(state, 'p1', seaOnly, { setup: true })).toBe(false);
    act(state, 'p1', { type: 'setup.placeBuilding', vertex: r.k3 });
  });

  it('a coastal starting settlement may take an adjacent sea ship instead of its road', () => {
    const { state } = seafarersGame(4);
    const r = ring(state);
    let next = act(state, 'p1', { type: 'setup.placeBuilding', vertex: r.k3 }).state;
    const hints = actionHints(next, 'p1').modules!.seafarers as { setupShips: number[] };
    expect(hints.setupShips.sort((a, b) => a - b)).toEqual([r.NW, r.W, side(next, 1, 0, 1)].sort((a, b) => a - b));
    // A ship that does not touch the new settlement is refused.
    expectRejected(next, 'p1', { type: 'setup.placeShip', edge: r.NE } as never, 'E_ILLEGAL_TARGET');
    // A road may not go out to sea (the sea–sea edge NW).
    expectRejected(next, 'p1', { type: 'setup.placeRoad', edge: r.NW }, 'E_ILLEGAL_TARGET');
    const placed = act(next, 'p1', { type: 'setup.placeShip', edge: r.NW } as never);
    next = placed.state;
    expect(next.board.roads[r.NW]).toEqual({ player: 'p1', ship: true });
    expect(placed.events.map((event) => event.type)).toContain('setup.ship');
    expect(next.turn.setup!.index).toBe(1);
  });

  it('an inland starting settlement has no sea edge for a ship', () => {
    const { state } = seafarersGame(4);
    const inland = corner(state, 0, 0, 1); // touches (0,0), (0,1) and (-1,1)
    const next = act(state, 'p1', { type: 'setup.placeBuilding', vertex: inland }).state;
    const hints = actionHints(next, 'p1').modules!.seafarers as { setupShips: number[] };
    expect(hints.setupShips).toEqual([]);
    expectRejected(next, 'p1', { type: 'setup.placeShip', edge: side(next, 0, 0, 5) } as never, 'E_ILLEGAL_TARGET');
  });
});

describe('sea-aware placement (SF25 p. 2)', () => {
  it('roads need land, ships need sea or the frame, buildings need land', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    settle(state, 'p1', r.k3);
    setHand(state, 'p1', { lumber: 5, brick: 5, wool: 5 });
    expectRejected(state, 'p1', { type: 'build.road', edge: r.NW }, 'E_ILLEGAL_TARGET');
    // The land–land edge (1,0)|(1,1) is never a ship edge.
    settle(state, 'p1', corner(state, 1, 0, 1));
    expectRejected(state, 'p1', { type: 'build.ship', edge: side(state, 1, 0, 5) } as never, 'E_ILLEGAL_TARGET');
    // Boundary edges are the inner edge of the frame: ships may use them.
    const frameEdge = side(state, -3, 1, 4); // (-3,1) faces the frame to the south-west
    settle(state, 'p1', corner(state, -3, 1, 2));
    const next = act(state, 'p1', { type: 'build.ship', edge: frameEdge } as never).state;
    expect(next.board.roads[frameEdge]).toEqual({ player: 'p1', ship: true });
  });

  it('a new ship links to an own ship or building, never to a road', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    setHand(state, 'p1', { lumber: 5, brick: 5, wool: 5 });
    // A road ending at k2 without a building: the coastal W edge is not reachable by ship.
    settle(state, 'p1', corner(state, 1, 0, 1));
    road(state, 'p1', side(state, 1, 0, 5));
    expect(actionHints(state, 'p1').legalRoads).toContain(r.W);
    expectRejected(state, 'p1', { type: 'build.ship', edge: r.W } as never, 'E_ILLEGAL_TARGET');
    // From a settlement, then onward from the ship.
    settle(state, 'p1', r.k3);
    let next = act(state, 'p1', { type: 'build.ship', edge: r.NW } as never).state;
    next = act(next, 'p1', { type: 'build.ship', edge: r.NE } as never).state;
    // A road may not continue a ship without a building (k5 has a ship only).
    expectRejected(next, 'p1', { type: 'build.road', edge: side(next, 3, -1, 5) }, 'E_ILLEGAL_TARGET');
    // But a settlement may: the ship route reaches the small island at k5.
    setHand(next, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    next = act(next, 'p1', { type: 'build.settlement', vertex: r.k5 }).state;
    expect(next.board.buildings[r.k5]).toEqual({ player: 'p1', city: false });
  });

  it('a ship may not pass an opponent building', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    setHand(state, 'p1', { lumber: 5, wool: 5 });
    settle(state, 'p1', r.k3);
    ship(state, 'p1', r.NW);
    settle(state, 'p2', r.k4);
    expectRejected(state, 'p1', { type: 'build.ship', edge: r.NE } as never, 'E_ILLEGAL_TARGET');
  });

  it('a coastal edge holds a road or a ship, not both', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    setHand(state, 'p1', { lumber: 5, wool: 5 });
    settle(state, 'p1', r.k3);
    road(state, 'p1', r.W);
    expectRejected(state, 'p1', { type: 'build.ship', edge: r.W } as never, 'E_ILLEGAL_TARGET');
  });

  it('ships cost lumber and wool and come from a supply of 15', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    settle(state, 'p1', r.k3);
    setHand(state, 'p1', { lumber: 1 });
    expectRejected(state, 'p1', { type: 'build.ship', edge: r.NW } as never, 'E_INSUFFICIENT_RESOURCES');
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    const bank = { ...state.bank };
    const next = act(state, 'p1', { type: 'build.ship', edge: r.NW } as never).state;
    expect(next.players[0]!.resources).toMatchObject({ lumber: 0, wool: 0 });
    expect(next.bank.lumber).toBe(bank.lumber + 1);
    expect(next.bank.wool).toBe(bank.wool + 1);
    // Fill the supply: 15 ships on the board.
    const full = emptySeafarersGame();
    settle(full, 'p1', ring(full).k3);
    let placed = 0;
    for (let edge = 0; placed < 15 && edge < full.board.roads.length; edge++) {
      if (edge === ring(full).NW) continue;
      full.board.roads[edge] = { player: 'p1', ship: true };
      placed++;
    }
    setHand(full, 'p1', { lumber: 1, wool: 1 });
    full.board.roads[ring(full).NW] = null;
    expectRejected(full, 'p1', { type: 'build.ship', edge: ring(full).NW } as never, 'E_NO_PIECES');
  });

  it('no new ship on an edge of the pirate hex (SF25 p. 2, SF-FAQ 6)', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    settle(state, 'p1', r.k3);
    setHand(state, 'p1', { lumber: 2, wool: 2 });
    state.board.pirate = hex(state, 2, 0);
    expectRejected(state, 'p1', { type: 'build.ship', edge: r.NW } as never, 'E_PIRATE_BLOCKS');
    // Roads and settlements next to the pirate are fine (SF-FAQ 6).
    setHand(state, 'p1', { lumber: 1, brick: 1 });
    act(state, 'p1', { type: 'build.road', edge: side(state, 1, 0, 1) });
  });
});

describe('moving ships (SF25 p. 2, SF-FAQ 12–14)', () => {
  function chain(): { state: GameState; r: ReturnType<typeof ring> } {
    const state = emptySeafarersGame();
    const r = ring(state);
    settle(state, 'p1', r.k3);
    ship(state, 'p1', r.NW);
    ship(state, 'p1', r.NE);
    return { state, r };
  }

  it('moves an open ship once per action window', () => {
    const { state, r } = chain();
    const branch = side(state, 2, -1, 0); // (2,-1)|(3,-1), from k4
    const moved = act(state, 'p1', { type: 'ship.move', from: r.NE, to: branch } as never);
    expect(moved.state.board.roads[r.NE]).toBeNull();
    expect(moved.state.board.roads[branch]).toEqual({ player: 'p1', ship: true });
    expect(moved.events.map((event) => event.type)).toContain('ship.moved');
    expectRejected(moved.state, 'p1', { type: 'ship.move', from: branch, to: r.NE } as never, 'E_SHIP_ALREADY_MOVED');
  });

  it('a ship built this turn stays put', () => {
    const { state, r } = chain();
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    const built = act(state, 'p1', { type: 'build.ship', edge: r.E } as never).state;
    expectRejected(built, 'p1', { type: 'ship.move', from: r.E, to: side(built, 2, -1, 0) } as never, 'E_SHIP_BUILT_THIS_TURN');
    // Next turn it may move.
    const later = act(built, 'p1', { type: 'turn.end' }).state;
    later.turn.seat = 0;
    later.turn.phase = 'action';
    later.windowId += 1;
    act(later, 'p1', { type: 'ship.move', from: r.E, to: side(later, 2, -1, 0) } as never);
  });

  it('a ship with no open end cannot move (closed route between own buildings)', () => {
    const { state, r } = chain();
    settle(state, 'p1', r.k5);
    expectRejected(state, 'p1', { type: 'ship.move', from: r.NE, to: r.E } as never, 'E_SHIP_NOT_MOVABLE');
    expectRejected(state, 'p1', { type: 'ship.move', from: r.NW, to: r.E } as never, 'E_SHIP_NOT_MOVABLE');
  });

  it('an opponent building on a closed route does not reopen it (SF-FAQ 14)', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    settle(state, 'p1', r.k3);
    settle(state, 'p1', r.k1);
    for (const edge of [r.NW, r.NE, r.E, r.SE]) ship(state, 'p1', edge);
    settle(state, 'p2', r.k5);
    const elsewhere = side(state, 2, -1, 0);
    for (const edge of [r.NW, r.NE, r.E, r.SE]) {
      expectRejected(state, 'p1', { type: 'ship.move', from: edge, to: elsewhere } as never, 'E_SHIP_NOT_MOVABLE');
    }
    // A branch with an open end is still movable.
    ship(state, 'p1', elsewhere);
    act(state, 'p1', { type: 'ship.move', from: elsewhere, to: r.W } as never);
  });

  it('open fixture: a ship circle without a building cannot move under SF25 p. 2', () => {
    // SF-FAQ 18 calls every ship of such a circle open; SF25 p. 2 defines an
    // open end as one not next to an own ship or building, which no ship of
    // a circle has. The engine follows SF25 (see FIDELITY open fixtures).
    const state = emptySeafarersGame();
    const r = ring(state);
    for (const edge of [r.NW, r.NE, r.E, r.SE, r.SW, r.W]) ship(state, 'p1', edge);
    const hints = actionHints(state, 'p1').modules!.seafarers as { movableShips: unknown[] };
    expect(hints.movableShips).toEqual([]);
    expectRejected(state, 'p1', { type: 'ship.move', from: r.NE, to: side(state, 2, -1, 0) } as never, 'E_SHIP_NOT_MOVABLE');
  });

  it('no move from or to an edge of the pirate hex', () => {
    const { state, r } = chain();
    state.board.pirate = hex(state, 2, 0);
    expectRejected(state, 'p1', { type: 'ship.move', from: r.NE, to: side(state, 2, -1, 0) } as never, 'E_PIRATE_BLOCKS');
    state.board.pirate = hex(state, 2, -1);
    // NE (k4–k5) is not an edge of (2,-1); its target (2,-1)|(3,-1) is.
    expectRejected(state, 'p1', { type: 'ship.move', from: r.NE, to: side(state, 2, -1, 0) } as never, 'E_PIRATE_BLOCKS');
  });

  it('the target must obey the placement rules once the ship is lifted', () => {
    const { state, r } = chain();
    // Lifting NE leaves NW: the far edge E is no longer linked.
    expectRejected(state, 'p1', { type: 'ship.move', from: r.NE, to: r.E } as never, 'E_ILLEGAL_TARGET');
    // A land–land edge is never a ship target.
    expectRejected(state, 'p1', { type: 'ship.move', from: r.NE, to: side(state, 1, 0, 5) } as never, 'E_ILLEGAL_TARGET');
  });

  it('awards are judged on the final board only (SF-FAQ 12)', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    settle(state, 'p1', r.k3);
    for (const edge of [r.NW, r.NE, r.E, r.SE, r.SW]) ship(state, 'p1', edge);
    // p2 ties at five roads on the main island's west coast.
    settle(state, 'p2', corner(state, -3, 3, 2));
    for (const [q, rr, s] of [[-3, 3, 3], [-3, 2, 4], [-3, 2, 3], [-3, 1, 4], [-3, 1, 3]] as const) road(state, 'p2', side(state, q, rr, s));
    state.awards.longestRoad = 'p1';
    const target = side(state, 1, 1, 0); // (1,1)|(2,1), still from k1
    const moved = act(state, 'p1', { type: 'ship.move', from: r.SW, to: target } as never).state;
    expect(moved.players[0]!.longestRoadLength).toBe(5);
    expect(moved.players[1]!.longestRoadLength).toBe(5);
    expect(moved.awards.longestRoad).toBe('p1');
  });

  it('victory is checked after the move, on the final board', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    settle(state, 'p1', r.k3);
    for (const edge of [r.NW, r.NE, r.E, r.SE, r.SW]) ship(state, 'p1', edge);
    ship(state, 'p1', side(state, 2, -1, 0));
    settle(state, 'p2', corner(state, -3, 3, 2));
    for (const [q, rr, s] of [[-3, 3, 3], [-3, 2, 4], [-3, 2, 3], [-3, 1, 4], [-3, 1, 3]] as const) road(state, 'p2', side(state, q, rr, s));
    state.awards.longestRoad = 'p2';
    state.players[0]!.bonusPoints = 11; // 1 settlement + 11 = 12, Longest Trade Route +2 = 14
    expect(scoreOf(state, 'p1', { includeHidden: true })).toBe(12);
    // Moving the branch to close the ring makes a six-ship trail and wins.
    const won = act(state, 'p1', { type: 'ship.move', from: side(state, 2, -1, 0), to: r.W } as never).state;
    expect(won.awards.longestRoad).toBe('p1');
    expect(won.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
  });
});
