/** R-B03: rolling a 7, discards, robber movement and theft. */

import { describe, expect, it } from 'vitest';
import { topologyOf } from '../src/analysis.ts';
import { verticesOfHex } from '../src/topology.ts';
import {
  act,
  expectRejected,
  handOf,
  handSize,
  placeBuilding,
  playableGame,
  setHand,
  scriptedRng,
} from './helpers.ts';

function rollSeven(state: ReturnType<typeof playableGame>['state']) {
  return act(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3])).state;
}

describe('R-B03 rolling a seven', () => {
  it('requires half (rounded down) from every hand over seven', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    setHand(state, 'p1', { lumber: 8 });
    setHand(state, 'p2', { lumber: 7 });
    setHand(state, 'p3', { lumber: 9 });
    setHand(state, 'p4', {});
    const rolled = rollSeven(state);
    expect(rolled.pending).toEqual({
      kind: 'discard',
      required: { p1: 4, p3: 4 },
      submitted: {},
    });
  });

  it('does not trigger discards when a knight is played', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    setHand(state, 'p1', { lumber: 9 });
    state.players[0]!.devCards = ['knight'];
    const target = state.board.layout.numbers.findIndex((value) => value === 6);
    const played = act(state, 'p1', { type: 'dev.playKnight', hex: target }, scriptedRng([0])).state;
    expect(played.pending?.kind === 'discard').toBe(false);
  });

  it('blocks trades and other actions until discards resolve', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    setHand(state, 'p1', { lumber: 8 });
    const rolled = rollSeven(state);
    expectRejected(
      rolled,
      'p1',
      { type: 'trade.offer', to: 'all', give: { lumber: 1 }, want: { ore: 1 } },
      'E_PENDING_EFFECT',
    );
    expectRejected(rolled, 'p1', { type: 'build.road', edge: 0 }, 'E_PENDING_EFFECT');
    expectRejected(rolled, 'p1', { type: 'turn.end' }, 'E_PENDING_EFFECT');
  });

  it('rejects discards from players who are not required and wrong counts', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    setHand(state, 'p1', { lumber: 8 });
    setHand(state, 'p2', { wool: 2 });
    const rolled = rollSeven(state);
    expectRejected(rolled, 'p2', { type: 'pending.discard', resources: ['wool'] }, 'E_NOT_ACTOR');
    expectRejected(
      rolled,
      'p1',
      { type: 'pending.discard', resources: ['lumber', 'lumber'] },
      'E_INVALID_DISCARD_COUNT',
    );
    expectRejected(
      rolled,
      'p1',
      { type: 'pending.discard', resources: ['lumber', 'lumber', 'lumber', 'ore'] },
      'E_INVALID_SELECTION',
    );
  });

  it('waits for every required player before the robber may move', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    setHand(state, 'p1', { lumber: 8 });
    setHand(state, 'p3', { lumber: 9 });
    let rolled = rollSeven(state);
    rolled = act(
      rolled,
      'p1',
      { type: 'pending.discard', resources: ['lumber', 'lumber', 'lumber', 'lumber'] },
      scriptedRng([0]),
    ).state;
    expect(rolled.pending).toEqual({
      kind: 'discard',
      required: { p1: 4, p3: 4 },
      submitted: { p1: ['lumber', 'lumber', 'lumber', 'lumber'] },
    });
    expect(handSize(rolled, 'p1')).toBe(4);
    expect(rolled.bank.lumber).toBe(state.bank.lumber + 4);

    rolled = act(
      rolled,
      'p3',
      { type: 'pending.discard', resources: ['lumber', 'lumber', 'lumber', 'lumber'] },
      scriptedRng([0]),
    ).state;
    expect(rolled.pending).toEqual({
      kind: 'moveRobber',
      actor: 'p1',
      cause: 'seven',
      pirate: false,
    });
  });

  it('forbids keeping the robber on its current hex and allows the desert', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    setHand(state, 'p1', { lumber: 8 });
    let rolled = rollSeven(state);
    rolled = act(
      rolled,
      'p1',
      { type: 'pending.discard', resources: ['lumber', 'lumber', 'lumber', 'lumber'] },
      scriptedRng([0]),
    ).state;
    expectRejected(rolled, 'p1', { type: 'pending.moveRobber', hex: rolled.board.robber }, 'E_ROBBER_SAME_HEX');
    expectRejected(rolled, 'p2', { type: 'pending.moveRobber', hex: 0 }, 'E_NOT_ACTOR');

    // The robber may be moved onto the desert, but only from another hex.
    const desert = rolled.board.layout.terrain.indexOf('desert');
    const elsewhere = rolled.board.layout.terrain.findIndex((_, hex) => hex !== desert);
    const prepared = { ...rolled, board: { ...rolled.board, robber: elsewhere } };
    const moved = act(prepared, 'p1', { type: 'pending.moveRobber', hex: desert }, scriptedRng([0])).state;
    expect(moved.board.robber).toBe(desert);
    expect(moved.pending).toBeNull();
  });

  it('offers only adjacent opponents that actually hold cards', () => {
    const { state } = playableGame({ players: 4 });
    const topo = topologyOf(state);
    const target = state.board.layout.numbers.findIndex((value) => value === 6);
    const vertices = verticesOfHex(topo, target);
    state.board.buildings = state.board.buildings.map(() => null);
    placeBuilding(state, 'p2', vertices[0]!, false);
    placeBuilding(state, 'p3', vertices[3]!, false);
    setHand(state, 'p2', {});
    setHand(state, 'p3', { ore: 2 });
    state.board.robber = state.board.layout.robber === target ? 0 : state.board.layout.robber;
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
    state.turn.seat = 0;
    state.turn.phase = 'action';

    const moved = act(state, 'p1', { type: 'pending.moveRobber', hex: target }, scriptedRng([0])).state;
    expect(moved.pending).toEqual({
      kind: 'steal',
      actor: 'p1',
      hex: target,
      candidates: ['p3'],
      pirate: false,
    });
    expectRejected(moved, 'p1', { type: 'pending.steal', victim: 'p2' }, 'E_NO_ELIGIBLE_VICTIM');

    const before = handOf(moved, 'p1').ore;
    const stolen = act(moved, 'p1', { type: 'pending.steal', victim: 'p3' }, scriptedRng([0])).state;
    expect(handOf(stolen, 'p1').ore).toBe(before + 1);
    expect(handOf(stolen, 'p3').ore).toBe(1);
    expect(stolen.pending).toBeNull();
  });

  it('steals only one card even when the victim owns several buildings on the hex', () => {
    const { state } = playableGame({ players: 4 });
    const topo = topologyOf(state);
    const target = state.board.layout.numbers.findIndex((value) => value === 6);
    const vertices = verticesOfHex(topo, target);
    state.board.buildings = state.board.buildings.map(() => null);
    placeBuilding(state, 'p2', vertices[0]!, false);
    placeBuilding(state, 'p2', vertices[3]!, false);
    setHand(state, 'p2', { ore: 2, wool: 2 });
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
    state.turn.seat = 0;
    state.turn.phase = 'action';

    const moved = act(state, 'p1', { type: 'pending.moveRobber', hex: target }, scriptedRng([0])).state;
    expect(moved.pending).toMatchObject({ kind: 'steal', candidates: ['p2'] });
    const stolen = act(moved, 'p1', { type: 'pending.steal', victim: 'p2' }, scriptedRng([0])).state;
    expect(handSize(stolen, 'p2')).toBe(3);
    expect(handSize(stolen, 'p1')).toBe(handSize(state, 'p1') + 1);
  });

  it('clears the pending effect when no adjacent opponent holds cards', () => {
    const { state } = playableGame({ players: 4 });
    const topo = topologyOf(state);
    const target = state.board.layout.numbers.findIndex((value) => value === 6);
    state.board.buildings = state.board.buildings.map(() => null);
    placeBuilding(state, 'p2', verticesOfHex(topo, target)[0]!, false);
    setHand(state, 'p2', {});
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
    state.turn.seat = 0;
    state.turn.phase = 'action';
    const moved = act(state, 'p1', { type: 'pending.moveRobber', hex: target }, scriptedRng([0])).state;
    expect(moved.pending).toBeNull();
  });

  it('does not charge discards when the hand is exactly seven', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    setHand(state, 'p1', { lumber: 7 });
    setHand(state, 'p2', { lumber: 7 });
    setHand(state, 'p3', { lumber: 7 });
    setHand(state, 'p4', { lumber: 7 });
    const rolled = rollSeven(state);
    expect(rolled.pending).toEqual({
      kind: 'moveRobber',
      actor: 'p1',
      cause: 'seven',
      pirate: false,
    });
  });
});
