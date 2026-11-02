/**
 * R-SF clauses added after the Seafarers review: piece supplies, connectivity
 * past opponent buildings, ship-move timing, the pirate, open ships, the
 * distance rule across a strait, Road Building with ships, gold edge cases,
 * the Longest Trade Route and paired turns. Corner/edge names as in
 * seafarers-ships.test.ts: the ring around the sea hex (2,0) on the printed
 * 4-player map (SF25 p. 5); paired cases use the 6-player board (SF56-25).
 */

import { describe, expect, it } from 'vitest';
import { countRoads, isLandHex, scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, canPlaceBuilding, partnerSeat, routeLength } from '../src/engine.ts';
import { countShips } from '../src/modules/seafarers/ships.ts';
import { enqueuePending } from '../src/pending.ts';
import type { GameEvent, GameState } from '../src/types.ts';
import { act, expectRejected, scriptedRng, setHand } from './helpers.ts';
import { corner, emptySeafarersGame, hex, road, seafarersGame, settle, ship, side } from './seafarers-helpers.ts';

function ring(state: GameState) {
  const k = (n: number) => corner(state, 2, 0, n);
  const s = (n: number) => side(state, 2, 0, n);
  return {
    k0: k(0), k1: k(1), k2: k(2), k3: k(3), k4: k(4), k5: k(5),
    E: s(0), NE: s(1), NW: s(2), W: s(3), SW: s(4), SE: s(5),
  };
}

const SEVEN = () => scriptedRng([2, 3]); // dice 3 + 4
const TEN = () => scriptedRng([3, 5]); // dice 4 + 6

/**
 * Puts `count` of the player's roads (inland edges in the west) or ships
 * (edges touching no land) on the board, clear of the ring under test.
 */
function fill(state: GameState, playerId: string, count: number, kind: 'road' | 'ship'): void {
  const topo = topologyOf(state);
  const near = new Set(Object.values(ring(state)));
  const edges = topo.edges
    .map((info, edge) => ({ info, edge }))
    .filter(({ info, edge }) => {
      if (state.board.roads[edge] || info.vertices.some((vertex) => near.has(vertex))) return false;
      if (kind === 'road' && info.x > 0) return false;
      const land = info.hexes.filter((cell) => isLandHex(state, cell)).length;
      return kind === 'road' ? land === 2 : land === 0;
    })
    .map(({ edge }) => edge);
  expect(edges.length).toBeGreaterThanOrEqual(count);
  for (const edge of edges.slice(0, count)) state.board.roads[edge] = { player: playerId, ship: kind === 'ship' };
}

function eventsOf(events: readonly GameEvent[], type: string) {
  return events.filter((event) => event.type === type).map((event) => event.params);
}

describe('road and ship supplies (SF25 p. 2)', () => {
  it('ships do not use up the road supply: 8 roads and 7 ships still allow a 9th road', () => {
    const state = emptySeafarersGame();
    settle(state, 'p1', ring(state).k3);
    fill(state, 'p1', 8, 'road');
    fill(state, 'p1', 7, 'ship');
    setHand(state, 'p1', { lumber: 1, brick: 1 });
    const next = act(state, 'p1', { type: 'build.road', edge: side(state, 1, 0, 1) }).state;
    expect(countRoads(next, 'p1')).toBe(9);
    expect(countShips(next, 'p1')).toBe(7);
  });

  it('15 roads and 15 ships are independent supplies', () => {
    const ships = emptySeafarersGame();
    settle(ships, 'p1', ring(ships).k3);
    fill(ships, 'p1', 15, 'ship');
    setHand(ships, 'p1', { lumber: 1, brick: 1 });
    act(ships, 'p1', { type: 'build.road', edge: side(ships, 1, 0, 1) });

    const roads = emptySeafarersGame();
    const r = ring(roads);
    settle(roads, 'p1', r.k3);
    fill(roads, 'p1', 15, 'road');
    setHand(roads, 'p1', { lumber: 2, brick: 1, wool: 1 });
    expectRejected(roads, 'p1', { type: 'build.road', edge: side(roads, 1, 0, 1) }, 'E_NO_PIECES');
    act(roads, 'p1', { type: 'build.ship', edge: r.NW } as never);
  });

  it('Road Building with 8 roads and 7 ships grants two roads and does not end early', () => {
    const state = emptySeafarersGame();
    settle(state, 'p1', ring(state).k3);
    fill(state, 'p1', 8, 'road');
    fill(state, 'p1', 7, 'ship');
    state.players[0]!.devCards = ['roadBuilding'];
    let next = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    expect(next.pending).toMatchObject({ kind: 'freeRoads', remaining: 2 });
    next = act(next, 'p1', { type: 'build.road', edge: side(next, 1, 0, 1) }).state;
    expect(next.pending).toMatchObject({ kind: 'freeRoads', remaining: 1 });
    const done = act(next, 'p1', { type: 'build.road', edge: side(next, 1, 0, 2) });
    expect(done.state.pending).toBeNull();
    expect(eventsOf(done.events, 'dev.roadBuildingFinished')).toEqual([{ playerId: 'p1', placed: 2 }]);
  });
});

describe('no route past an opponent building (SF25 p. 2, B25)', () => {
  it('a road stops at an opponent settlement it reaches', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    const top = corner(state, 1, 0, 4);
    settle(state, 'p1', r.k3);
    road(state, 'p1', side(state, 1, 0, 1)); // k3 – top of (1,0)
    const beyond = [side(state, 1, 0, 2), side(state, 1, -1, 0)];
    expect(actionHints(state, 'p1').legalRoads).toEqual(expect.arrayContaining(beyond));
    settle(state, 'p2', top);
    expect(actionHints(state, 'p1').legalRoads).not.toEqual(expect.arrayContaining([beyond[0]]));
    setHand(state, 'p1', { lumber: 2, brick: 2 });
    for (const edge of beyond) expectRejected(state, 'p1', { type: 'build.road', edge }, 'E_ILLEGAL_TARGET');
  });

  it('a ship stops at an opponent settlement on the far coast', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    settle(state, 'p1', r.k3);
    ship(state, 'p1', r.NW);
    expect((actionHints(state, 'p1').modules!.seafarers as { legalShips: number[] }).legalShips).toContain(r.NE);
    settle(state, 'p2', r.k4);
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    expectRejected(state, 'p1', { type: 'build.ship', edge: r.NE } as never, 'E_ILLEGAL_TARGET');
    expect((actionHints(state, 'p1').modules!.seafarers as { legalShips: number[] }).legalShips).not.toContain(r.NE);
  });
});

describe('ships and the pirate (SF25 pp. 2–3, SF-FAQ 11, 18)', () => {
  it('a ship may only move in the action phase, not before the roll (SF25 p. 2)', () => {
    const state = emptySeafarersGame(4, 0, 'preroll');
    const r = ring(state);
    settle(state, 'p1', r.k3);
    ship(state, 'p1', r.NW);
    ship(state, 'p1', r.NE);
    expectRejected(state, 'p1', { type: 'ship.move', from: r.NE, to: r.W } as never, 'E_WRONG_PHASE');
  });

  it('a Knight may send the pirate to the frame without a theft (SF25 p. 3)', () => {
    const state = emptySeafarersGame(4, 0, 'preroll');
    const r = ring(state);
    ship(state, 'p2', r.NE);
    setHand(state, 'p2', { wool: 1 });
    state.board.pirate = hex(state, 2, 0);
    const robber = state.board.robber;
    state.players[0]!.devCards = ['knight'];
    const played = act(state, 'p1', { type: 'dev.playKnight', hex: null } as never).state;
    expect(played.board.pirate).toBeNull();
    expect(played.board.robber).toBe(robber);
    expect(played.pending).toBeNull();
    expect(played.players[0]!.playedKnights).toBe(1);
  });

  it('no theft when only the mover has ships there or the ship owner has no cards (SF25 p. 2)', () => {
    for (const [owner, hand] of [['p1', { ore: 1 }], ['p2', {}]] as const) {
      const state = emptySeafarersGame(4, 0, 'preroll');
      ship(state, owner, ring(state).NE);
      setHand(state, owner, hand);
      const rolled = act(state, 'p1', { type: 'turn.roll' }, SEVEN()).state;
      const moved = act(rolled, 'p1', { type: 'pending.moveRobber', hex: hex(rolled, 2, 0) });
      expect(moved.state.board.pirate).toBe(hex(rolled, 2, 0));
      expect(moved.state.pending).toBeNull();
      expect(eventsOf(moved.events, 'robber.stole')).toEqual([]);
    }
  });

  it('open fixture: a ship line that returns to its own building has no movable ship under SF25 p. 2', () => {
    // SF-FAQ 18 special case 1 lets either end ship of such a loop move; SF25
    // p. 2 defines an open end as one not next to an own ship or building,
    // which neither end has. The engine follows SF25 (FIDELITY open fixtures).
    const state = emptySeafarersGame();
    const r = ring(state);
    settle(state, 'p1', r.k3);
    for (const edge of [r.NW, r.NE, r.E, r.SE, r.SW, r.W]) ship(state, 'p1', edge);
    expect((actionHints(state, 'p1').modules!.seafarers as { movableShips: unknown[] }).movableShips).toEqual([]);
    for (const edge of [r.NW, r.W]) {
      expectRejected(state, 'p1', { type: 'ship.move', from: edge, to: side(state, 2, -1, 0) } as never, 'E_SHIP_NOT_MOVABLE');
    }
  });

  it('the distance rule spans a narrow strait between islands (SF-FAQ 11)', () => {
    const { state } = seafarersGame(4);
    const r = ring(state);
    // k3 (main island) and k4 (north-east island) share the sea edge NW.
    settle(state, 'p2', r.k4);
    expectRejected(state, 'p1', { type: 'setup.placeBuilding', vertex: r.k3 }, 'E_ILLEGAL_TARGET');
    const later = emptySeafarersGame();
    settle(later, 'p2', ring(later).k4);
    expect(canPlaceBuilding(later, 'p1', ring(later).k3, { requireConnection: false })).toBe(false);
  });
});

describe('Road Building with ships (SF25 p. 3, SF-FAQ 1)', () => {
  it('may be played before the roll and place a ship; the free ship cannot move this turn', () => {
    const state = emptySeafarersGame(4, 0, 'preroll');
    const r = ring(state);
    settle(state, 'p1', r.k3);
    state.players[0]!.devCards = ['roadBuilding'];
    let next = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    next = act(next, 'p1', { type: 'build.ship', edge: r.NW } as never).state;
    expect(next.pending).toMatchObject({ kind: 'freeRoads', remaining: 1 });
    next = act(next, 'p1', { type: 'build.road', edge: side(next, 1, 0, 1) }).state;
    expect(next.pending).toBeNull();
    expect(next.turn.phase).toBe('preroll');
    next = act(next, 'p1', { type: 'turn.roll' }, TEN()).state;
    expect(next.turn.phase).toBe('action');
    expectRejected(next, 'p1', { type: 'ship.move', from: r.NW, to: r.W } as never, 'E_SHIP_BUILT_THIS_TURN');
  });

  it('ends after one ship when the ship supply runs out mid-effect', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    settle(state, 'p1', r.k5);
    // k5's inland edge and the coastal edge E are taken: NE is the last edge
    // for either a road or a ship, and only one ship is left in the supply.
    road(state, 'p2', side(state, 3, -1, 5));
    road(state, 'p2', r.E);
    fill(state, 'p1', 14, 'ship');
    state.players[0]!.devCards = ['roadBuilding'];
    const played = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    expect(played.pending).toMatchObject({ kind: 'freeRoads', remaining: 2 });
    const built = act(played, 'p1', { type: 'build.ship', edge: r.NE } as never);
    expect(countShips(built.state, 'p1')).toBe(15);
    expect(built.state.pending).toBeNull();
    expect(eventsOf(built.events, 'dev.roadBuildingFinished')).toEqual([{ playerId: 'p1', placed: 1 }]);
  });
});

describe('gold fields (SF25 p. 2)', () => {
  it('a 7 produces no gold', () => {
    const state = emptySeafarersGame(4, 0, 'preroll');
    settle(state, 'p1', ring(state).k5); // on (3,0) gold 10
    const rolled = act(state, 'p1', { type: 'turn.roll' }, SEVEN());
    expect(rolled.state.pending).toMatchObject({ kind: 'moveRobber' });
    expect(eventsOf(rolled.events, 'gold.required')).toEqual([]);
  });

  it('a supply already empty when gold is produced gives nothing and leaves no frame', () => {
    const state = emptySeafarersGame(4, 0, 'preroll');
    settle(state, 'p1', ring(state).k5);
    settle(state, 'p2', corner(state, 3, 0, 0), true);
    state.bank = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    const rolled = act(state, 'p1', { type: 'turn.roll' }, TEN());
    expect(rolled.state.pending).toBeNull();
    expect(eventsOf(rolled.events, 'gold.chosen')).toEqual([
      { playerId: 'p1', resources: [], shortBy: 1 },
      { playerId: 'p2', resources: [], shortBy: 2 },
    ]);
  });

  it('a queued gold frame that activates on an empty supply skips every player', () => {
    const state = emptySeafarersGame();
    state.bank = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 1 };
    enqueuePending(
      state,
      { kind: 'yearOfPlenty', actor: 'p1', remaining: 1 },
      { kind: 'seafarers.gold', module: 'seafarers', responders: ['p1', 'p2'], data: { picks: { p1: 1, p2: 2 } } },
    );
    const taken = act(state, 'p1', { type: 'pending.takeResource', resource: 'ore' });
    expect(taken.state.pending).toBeNull();
    expect('pendingQueue' in taken.state).toBe(false);
    expect(eventsOf(taken.events, 'gold.chosen')).toEqual([
      { playerId: 'p1', resources: [], shortBy: 1 },
      { playerId: 'p2', resources: [], shortBy: 2 },
    ]);
  });

  it('5–6 players: gold is chosen in turn order from the roller (SF56-25 p. 2)', () => {
    const { state } = seafarersGame(6, 5);
    state.turn.setup = null;
    state.turn.phase = 'preroll';
    state.turn.seat = 3;
    state.windowId += 1;
    const gold = { q: 2, r: 3 }; // gold 10
    settle(state, 'p2', corner(state, gold.q, gold.r, 1));
    settle(state, 'p5', corner(state, gold.q, gold.r, 3));
    settle(state, 'p4', corner(state, gold.q, gold.r, 5), true);
    const rolled = act(state, 'p4', { type: 'turn.roll' }, TEN()).state;
    expect(rolled.pending).toMatchObject({ kind: 'seafarers.gold', responders: ['p4', 'p5', 'p2'] });
    expectRejected(rolled, 'p2', { type: 'gold.choose', resources: ['ore'] } as never, 'E_NOT_YOUR_TURN');
  });
});

describe('Longest Trade Route (SF25 p. 2, SF-FAQ 16)', () => {
  it('a ship loop counts each ship once, with or without a building on it', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    for (const edge of [r.NW, r.NE, r.E, r.SE, r.SW, r.W]) ship(state, 'p1', edge);
    expect(routeLength(state, 'p1')).toBe(6);
    settle(state, 'p1', r.k3);
    expect(routeLength(state, 'p1')).toBe(6);
  });

  it('roads and ships meeting at an opponent building stay separate', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    road(state, 'p1', side(state, 1, 0, 1));
    road(state, 'p1', side(state, 1, 0, 2));
    settle(state, 'p1', corner(state, 1, 0, 3));
    for (const edge of [r.NW, r.NE, r.E]) ship(state, 'p1', edge);
    settle(state, 'p2', r.k3);
    expect(routeLength(state, 'p1')).toBe(3);
  });
});

describe('paired turns with ships (SF56-25 pp. 2–3)', () => {
  function paired(): { state: GameState; p2: string } {
    const { state } = seafarersGame(6, 5);
    state.turn.setup = null;
    state.turn.phase = 'action';
    state.turn.seat = 0;
    state.windowId += 1;
    const p2 = state.players[partnerSeat(state, 0)]!.id;
    settle(state, 'p1', corner(state, 2, 2, 3));
    ship(state, 'p1', side(state, 2, 2, 2));
    ship(state, 'p1', side(state, 2, 2, 1));
    settle(state, p2, corner(state, 2, 3, 3));
    ship(state, p2, side(state, 2, 3, 3));
    return { state, p2 };
  }

  it('Player 2 may move a ship after Player 1 moved one in the same round', () => {
    const { state, p2 } = paired();
    let next = act(state, 'p1', { type: 'ship.move', from: side(state, 2, 2, 1), to: side(state, 2, 2, 3) } as never).state;
    next = act(next, 'p1', { type: 'turn.end' }).state;
    expect(next.turn).toMatchObject({ pairedActor: 2 });
    const moved = act(next, p2, { type: 'ship.move', from: side(next, 2, 3, 3), to: side(next, 2, 3, 2) } as never).state;
    expect(moved.board.roads[side(next, 2, 3, 2)]).toEqual({ player: p2, ship: true });
  });

  it('Player 2 cannot move a ship built in their own action phase', () => {
    const { state, p2 } = paired();
    const next = act(state, 'p1', { type: 'turn.end' }).state;
    setHand(next, p2, { lumber: 1, wool: 1 });
    const built = act(next, p2, { type: 'build.ship', edge: side(next, 2, 3, 2) } as never).state;
    expectRejected(built, p2, { type: 'ship.move', from: side(next, 2, 3, 2), to: side(next, 2, 3, 1) } as never, 'E_SHIP_BUILT_THIS_TURN');
  });

  it('Player 2 wins at 14 in their own action phase', () => {
    const { state, p2 } = paired();
    const next = act(state, 'p1', { type: 'turn.end' }).state;
    const player = next.players.find((candidate) => candidate.id === p2)!;
    // The gold hex (2,3) is a small island: the city's board change also
    // claims its +2, so city 2 + island 2 + 10 = 14.
    player.bonusPoints = 10;
    setHand(next, p2, { grain: 2, ore: 3 });
    const won = act(next, p2, { type: 'build.city', vertex: corner(next, 2, 3, 3) }).state;
    expect(scoreOf(won, p2, { includeHidden: true })).toBe(14);
    expect(won.result).toMatchObject({ playerId: p2, reason: 'victory' });
  });

  it('a Player 1 win ends the game before Player 2 acts', () => {
    const { state, p2 } = paired();
    state.players[0]!.bonusPoints = 12;
    setHand(state, 'p1', { grain: 2, ore: 3 });
    const won = act(state, 'p1', { type: 'build.city', vertex: corner(state, 2, 2, 3) }).state;
    expect(won.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
    expect(won.turn.pairedActor).toBe(1);
    setHand(won, p2, { lumber: 1, wool: 1 });
    expectRejected(won, p2, { type: 'build.ship', edge: side(won, 2, 3, 2) } as never, 'E_GAME_OVER');
  });
});
