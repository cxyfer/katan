/**
 * R-SF pirate, gold, Road Building, Longest Trade Route, island bonus,
 * victory, paired ship moves and privacy, on the printed 4-player map
 * (SF25 p. 5) unless stated otherwise. Corner/edge names as in
 * seafarers-ships.test.ts: the ring around the sea hex (2,0).
 */

import { describe, expect, it } from 'vitest';
import { scoreOf } from '../src/analysis.ts';
import { partnerSeat, routeLength } from '../src/engine.ts';
import { projectGame } from '../src/project.ts';
import type { GameState } from '../src/types.ts';
import { act, expectRejected, scriptedRng, setHand } from './helpers.ts';
import { corner, emptySeafarersGame, hex, road, seafarersGame, settle, ship, side, totalSupply } from './seafarers-helpers.ts';

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

describe('pirate (SF25 pp. 2–3, SF-FAQ 4–7)', () => {
  function sevenRolled(): { state: GameState; r: ReturnType<typeof ring> } {
    const state = emptySeafarersGame(4, 0, 'preroll');
    const r = ring(state);
    settle(state, 'p1', corner(state, -2, 0, 3));
    ship(state, 'p2', r.NW);
    settle(state, 'p2', r.k3);
    settle(state, 'p3', r.k1); // coastal settlement on (2,0), no ship
    setHand(state, 'p2', { ore: 1 });
    setHand(state, 'p3', { grain: 2 });
    const rolled = act(state, 'p1', { type: 'turn.roll' }, SEVEN()).state;
    expect(rolled.pending).toMatchObject({ kind: 'moveRobber', actor: 'p1', cause: 'seven' });
    return { state: rolled, r };
  }

  it('a 7 may move the pirate to a sea hex and rob a player with a ship there', () => {
    const { state } = sevenRolled();
    const moved = act(state, 'p1', { type: 'pending.moveRobber', hex: hex(state, 2, 0) });
    expect(moved.state.board.pirate).toBe(hex(state, 2, 0));
    expect(moved.state.board.robber).toBe(state.board.robber);
    expect(moved.events.map((event) => event.type)).toContain('pirate.moved');
    // Only the ship owner is a candidate; the coastal settlement is not (SF-FAQ 7).
    expect(moved.state.pending).toMatchObject({ kind: 'steal', candidates: ['p2'], pirate: true });
    const stolen = act(moved.state, 'p1', { type: 'pending.steal', victim: 'p2' }, scriptedRng([0]));
    expect(stolen.state.players[0]!.resources.ore).toBe(1);
    expect(stolen.events.find((event) => event.type === 'robber.stole')!.params).toMatchObject({ pirate: true });
    expect(stolen.state.pending).toBeNull();
  });

  it('the pirate may go to the frame, must change place and never lands on land', () => {
    const { state } = sevenRolled();
    expectRejected(state, 'p1', { type: 'pending.moveRobber', hex: null }, 'E_PIRATE_SAME_HEX');
    const toSea = act(state, 'p1', { type: 'pending.moveRobber', hex: hex(state, 2, 1) }).state;
    expect(toSea.board.pirate).toBe(hex(state, 2, 1));
    expect(toSea.pending).toBeNull(); // nobody to rob there
    toSea.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
    expectRejected(toSea, 'p1', { type: 'pending.moveRobber', hex: hex(state, 2, 1) }, 'E_PIRATE_SAME_HEX');
    const frame = act(toSea, 'p1', { type: 'pending.moveRobber', hex: null }).state;
    expect(frame.board.pirate).toBeNull();
    expect(frame.pending).toBeNull();
  });

  it('the robber stays on land: a land hex moves the robber, not the pirate', () => {
    const { state } = sevenRolled();
    const target = hex(state, 1, 0);
    const moved = act(state, 'p1', { type: 'pending.moveRobber', hex: target }).state;
    expect(moved.board.robber).toBe(target);
    expect(moved.board.pirate).toBeNull();
    expectRejected(state, 'p1', { type: 'pending.moveRobber', hex: state.board.robber }, 'E_ROBBER_SAME_HEX');
  });

  it('a Knight may activate the pirate instead of the robber (SF25 p. 3)', () => {
    const state = emptySeafarersGame(4, 0, 'preroll');
    const r = ring(state);
    ship(state, 'p2', r.NE);
    setHand(state, 'p2', { wool: 1 });
    state.players[0]!.devCards = ['knight'];
    const played = act(state, 'p1', { type: 'dev.playKnight', hex: hex(state, 2, 0) });
    expect(played.state.board.pirate).toBe(hex(state, 2, 0));
    expect(played.state.players[0]!.playedKnights).toBe(1);
    expect(played.state.turn.devCardPlayed).toBe(true);
    expect(played.state.pending).toMatchObject({ kind: 'steal', candidates: ['p2'], pirate: true });
  });
});

describe('gold fields (SF25 p. 2, SF-FAQ 2)', () => {
  function goldRoll(): GameState {
    const state = emptySeafarersGame(4, 0, 'preroll');
    const r = ring(state);
    settle(state, 'p1', r.k5); // on (3,0) gold 10
    settle(state, 'p2', corner(state, 3, 0, 0), true); // city on (3,0)
    return act(state, 'p1', { type: 'turn.roll' }, TEN()).state;
  }

  it('a settlement takes one resource of choice, a city two in any combination, in turn order', () => {
    const state = goldRoll();
    expect(state.pending).toMatchObject({ kind: 'seafarers.gold', responders: ['p1', 'p2'] });
    expectRejected(state, 'p2', { type: 'gold.choose', resources: ['ore', 'ore'] } as never, 'E_NOT_YOUR_TURN');
    expectRejected(state, 'p1', { type: 'gold.choose', resources: ['ore', 'ore'] } as never, 'E_INVALID_SELECTION');
    expectRejected(state, 'p3', { type: 'gold.choose', resources: ['ore'] } as never, 'E_NOT_ACTOR');
    const before = totalSupply(state);
    let next = act(state, 'p1', { type: 'gold.choose', resources: ['ore'] } as never).state;
    next = act(next, 'p2', { type: 'gold.choose', resources: ['brick', 'grain'] } as never).state;
    expect(next.pending).toBeNull();
    expect(next.players[0]!.resources.ore).toBe(1);
    expect(next.players[1]!.resources).toMatchObject({ brick: 1, grain: 1 });
    expect(totalSupply(next)).toEqual(before);
  });

  it('gold is public and visible to every seat while pending', () => {
    const state = goldRoll();
    const view = projectGame(state, 'p3');
    expect(view.pending).toMatchObject({ kind: 'seafarers.gold', data: { picks: { p1: 1, p2: 2 } } });
  });

  it('a short supply is taken in turn order; an empty supply gives nothing', () => {
    const state = emptySeafarersGame(4, 0, 'preroll');
    const r = ring(state);
    settle(state, 'p1', r.k5);
    settle(state, 'p2', corner(state, 3, 0, 0), true);
    state.bank = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 1 };
    const rolled = act(state, 'p1', { type: 'turn.roll' }, TEN()).state;
    expectRejected(rolled, 'p1', { type: 'gold.choose', resources: ['grain'] } as never, 'E_BANK_EMPTY');
    const chosen = act(rolled, 'p1', { type: 'gold.choose', resources: ['ore'] } as never);
    expect(chosen.state.pending).toBeNull();
    const skipped = chosen.events.find((event) => event.type === 'gold.chosen' && event.params.playerId === 'p2');
    expect(skipped!.params).toEqual({ playerId: 'p2', resources: [], shortBy: 2 });
  });

  it('the robber on a gold field blocks it', () => {
    const state = emptySeafarersGame(4, 0, 'preroll');
    settle(state, 'p1', ring(state).k5);
    state.board.robber = hex(state, 3, 0);
    const rolled = act(state, 'p1', { type: 'turn.roll' }, TEN()).state;
    expect(rolled.pending).toBeNull();
  });
});

describe('Road Building with ships (SF25 p. 3, SF-FAQ 1)', () => {
  it('builds one road and one ship for free', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    settle(state, 'p1', r.k3);
    state.players[0]!.devCards = ['roadBuilding'];
    let next = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    expect(next.pending).toMatchObject({ kind: 'freeRoads', remaining: 2 });
    next = act(next, 'p1', { type: 'build.ship', edge: r.NW } as never).state;
    expect(next.pending).toMatchObject({ kind: 'freeRoads', remaining: 1 });
    // No paid action in between (SF-FAQ 1).
    expectRejected(next, 'p1', { type: 'build.devCard' }, 'E_PENDING_EFFECT');
    const done = act(next, 'p1', { type: 'build.road', edge: side(next, 1, 0, 1) });
    expect(done.state.pending).toBeNull();
    expect(done.events.find((event) => event.type === 'dev.roadBuildingFinished')!.params).toMatchObject({ placed: 2 });
    expect(done.state.players[0]!.resources).toMatchObject({ lumber: 0, brick: 0, wool: 0 });
  });

  it('builds two ships when no road can be placed', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    settle(state, 'p1', r.k5);
    road(state, 'p2', side(state, 3, -1, 5)); // the only land edge at k5
    state.players[0]!.devCards = ['roadBuilding'];
    let next = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    expect(next.pending).toMatchObject({ kind: 'freeRoads', remaining: 2 });
    next = act(next, 'p1', { type: 'build.ship', edge: r.NE } as never).state;
    next = act(next, 'p1', { type: 'build.ship', edge: r.NW } as never).state;
    expect(next.pending).toBeNull();
  });
});

describe('Longest Trade Route (SF25 p. 2, SF-FAQ 16)', () => {
  function mixed(): { state: GameState; r: ReturnType<typeof ring> } {
    const state = emptySeafarersGame();
    const r = ring(state);
    // Two roads ending at k3 and three ships starting at k3.
    road(state, 'p1', side(state, 1, 0, 1));
    road(state, 'p1', side(state, 1, 0, 2));
    for (const edge of [r.NW, r.NE, r.E]) ship(state, 'p1', edge);
    settle(state, 'p1', corner(state, 1, 0, 3));
    return { state, r };
  }

  it('roads and ships only join at the player\'s own building', () => {
    const { state, r } = mixed();
    expect(routeLength(state, 'p1')).toBe(3);
    setHand(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    // A settlement at the junction links two roads and three ships into five.
    const built = act(state, 'p1', { type: 'build.settlement', vertex: r.k3 }).state;
    expect(built.players[0]!.longestRoadLength).toBe(5);
    expect(built.awards.longestRoad).toBe('p1');
  });

  it('without the junction building the parts stay separate', () => {
    const { state, r } = mixed();
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    const extended = act(state, 'p1', { type: 'build.ship', edge: r.SE } as never).state;
    expect(extended.players[0]!.longestRoadLength).toBe(4);
    expect(extended.awards.longestRoad).toBeNull();
  });

  it('an opponent building interrupts a shipping route', () => {
    const { state, r } = mixed();
    settle(state, 'p1', r.k3);
    settle(state, 'p2', r.k4);
    setHand(state, 'p2', { lumber: 1, wool: 1 });
    state.turn.seat = 1;
    const built = act(state, 'p2', { type: 'build.ship', edge: side(state, 2, -1, 0) } as never).state;
    expect(built.players[0]!.longestRoadLength).toBe(3);
  });
});

describe('island bonus and victory (SF25 p. 4)', () => {
  it('+2 for each player\'s first settlement on each small island', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    settle(state, 'p1', r.k3);
    ship(state, 'p1', r.NW);
    ship(state, 'p1', r.NE);
    setHand(state, 'p1', { lumber: 3, brick: 3, wool: 1, grain: 1 });
    const first = act(state, 'p1', { type: 'build.settlement', vertex: r.k5 });
    expect(first.events.find((event) => event.type === 'island.bonus')!.params).toMatchObject({ playerId: 'p1', island: 3, points: 2 });
    expect(first.state.players[0]!.bonusPoints).toBe(2);
    expect(scoreOf(first.state, 'p1', { includeHidden: false })).toBe(2 + 2);
    // A second settlement on the same island earns nothing more.
    settle(first.state, 'p1', corner(first.state, 3, -2, 4));
    const second = act(first.state, 'p1', { type: 'build.road', edge: side(first.state, 1, 0, 1) });
    expect(second.state.players[0]!.bonusPoints).toBe(2);
    expect(second.events.some((event) => event.type === 'island.bonus')).toBe(false);
    // The south-east island is a new one.
    settle(second.state, 'p1', corner(second.state, 1, 3, 1));
    const third = act(second.state, 'p1', { type: 'build.road', edge: side(second.state, 1, 0, 2) });
    expect(third.state.players[0]!.bonusPoints).toBe(4);
  });

  it('every player may claim the same island once', () => {
    const state = emptySeafarersGame();
    settle(state, 'p2', ring(state).k5);
    settle(state, 'p1', corner(state, 3, -3, 3));
    ship(state, 'p1', side(state, 3, -3, 3));
    setHand(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    // A board change triggers the claims for both players.
    const next = act(state, 'p1', { type: 'build.road', edge: side(state, 3, -3, 2) }, scriptedRng([])).state;
    expect(next.players[0]!.bonusPoints).toBe(2);
    expect(next.players[1]!.bonusPoints).toBe(2);
    const islands = (projectGame(next, 'p3').modules!.seafarers as { islandBonus: Record<string, number[]> }).islandBonus;
    expect(islands).toMatchObject({ p1: [3], p2: [3], p3: [], p4: [] });
  });

  it('5–6 players: the outlined 6 + 12 island counts once (SF56-25 p. 4)', () => {
    const { state } = seafarersGame(6, 3);
    state.turn.setup = null;
    state.turn.phase = 'action';
    state.turn.seat = 0;
    settle(state, 'p1', corner(state, 5, -3, 1));
    settle(state, 'p1', corner(state, 5, -1, 4));
    road(state, 'p1', side(state, 5, -1, 3));
    setHand(state, 'p1', { lumber: 1, brick: 1 });
    const next = act(state, 'p1', { type: 'build.road', edge: side(state, 5, -1, 2) }).state;
    expect(next.players[0]!.bonusPoints).toBe(2);
  });

  it('starting settlements on the main island earn no bonus', () => {
    const { state } = seafarersGame(4);
    let next = act(state, 'p1', { type: 'setup.placeBuilding', vertex: ring(state).k3 }).state;
    next = act(next, 'p1', { type: 'setup.placeRoad', edge: side(next, 1, 0, 1) }).state;
    expect(next.players[0]!.bonusPoints).toBe(0);
  });

  it('14 VP on the own turn wins; 13 does not', () => {
    const state = emptySeafarersGame();
    const r = ring(state);
    settle(state, 'p1', r.k3);
    ship(state, 'p1', r.NW);
    ship(state, 'p1', r.NE);
    state.players[0]!.bonusPoints = 10; // 11 points
    setHand(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    // settlement (+1) and island bonus (+2) = 14
    const won = act(state, 'p1', { type: 'build.settlement', vertex: r.k5 }).state;
    expect(scoreOf(won, 'p1', { includeHidden: true })).toBe(14);
    expect(won.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
    const short = emptySeafarersGame();
    settle(short, 'p1', ring(short).k3);
    short.players[0]!.bonusPoints = 11;
    setHand(short, 'p1', { lumber: 1, brick: 1 });
    const notYet = act(short, 'p1', { type: 'build.road', edge: side(short, 1, 0, 1) }).state;
    expect(scoreOf(notYet, 'p1', { includeHidden: true })).toBe(12);
    expect(notYet.result).toBeNull();
  });
});

describe('paired players (SF56-25 pp. 2–3)', () => {
  it('Player 2 builds and moves a ship in their own action phase', () => {
    const { state } = seafarersGame(6, 5);
    state.turn.setup = null;
    state.turn.phase = 'action';
    state.turn.seat = 0;
    state.windowId += 1;
    const partner = partnerSeat(state, 0);
    const p2 = state.players[partner]!.id;
    // Player 1's ship move uses only Player 1's window.
    const coast = corner(state, 2, 3, 3);
    settle(state, p2, coast);
    const edges = [side(state, 2, 3, 3), side(state, 2, 3, 2)];
    ship(state, p2, edges[0]!);
    let next = act(state, 'p1', { type: 'turn.end' }).state;
    expect(next.turn).toMatchObject({ seat: partner, pairedActor: 2 });
    setHand(next, p2, { lumber: 1, wool: 1 });
    next = act(next, p2, { type: 'build.ship', edge: edges[1]! } as never).state;
    const moved = act(next, p2, { type: 'ship.move', from: edges[0]!, to: side(next, 2, 3, 1) } as never).state;
    expect(moved.board.roads[side(next, 2, 3, 1)]).toEqual({ player: p2, ship: true });
    expectRejected(moved, p2, { type: 'trade.offer', to: 'p1', give: { wool: 1 }, want: { ore: 1 } }, 'E_PAIRED_NO_DOMESTIC_TRADE');
  });
});

describe('privacy', () => {
  it('module projections carry only public data and theft stays private', () => {
    const state = emptySeafarersGame(4, 0, 'preroll');
    const r = ring(state);
    ship(state, 'p2', r.NE);
    setHand(state, 'p2', { ore: 2, wool: 1 });
    state.players[0]!.devCards = ['knight'];
    const played = act(state, 'p1', { type: 'dev.playKnight', hex: hex(state, 2, 0) }).state;
    const stolen = act(played, 'p1', { type: 'pending.steal', victim: 'p2' }, scriptedRng([0]));
    const event = stolen.events.find((candidate) => candidate.type === 'robber.stole')!;
    for (const viewer of ['p3', 'p4']) {
      const view = projectGame(stolen.state, viewer, { events: [event] });
      expect(view.events[0]!.params).not.toHaveProperty('resource');
      expect(view.players.find((player) => player.id === 'p2')!.resources).toBeUndefined();
      expect(Object.keys(view.modules!.seafarers as object).sort()).toEqual(['islandBonus', 'shipMoved', 'shipsBuiltThisTurn']);
    }
    expect(projectGame(stolen.state, 'p2', { events: [event] }).events[0]!.params).toHaveProperty('resource');
  });
});
