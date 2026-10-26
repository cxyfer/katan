/** R-56: paired-player turns for 5–6 players (B56-25, §5.5). */

import { describe, expect, it } from 'vitest';
import { legalRoadEdges, partnerSeat } from '../src/engine.ts';
import { getProfile } from '../src/profiles.ts';
import {
  act,
  expectRejected,
  forceTurn,
  handOf,
  newGame,
  runSetup,
  scriptedRng,
  setHand,
} from './helpers.ts';
import type { GameState } from '../src/types.ts';

function pairedGame(players: 5 | 6): GameState {
  const { state } = newGame({ players, profileId: 'base-paired-2025', seed: 2026 });
  return runSetup(state, scriptedRng(9));
}

/** Ends the current action window without rolling (fixture shortcut). */
function endWindow(state: GameState): GameState {
  const actor = state.players[state.turn.seat]!.id;
  const prepared: GameState = { ...state, turn: { ...state.turn, phase: 'action' } };
  return act(prepared, actor, { type: 'turn.end' }, scriptedRng(0)).state;
}

describe('R-56 paired profiles', () => {
  it('keeps the paired profile implemented but not advertised until verified', () => {
    const profile = getProfile('base-paired-2025')!;
    expect(profile.paired).toBe(true);
    expect(profile.implemented).toBe(true);
    expect(profile.enabled).toBe(false);
    expect(profile.bankPerResource).toBe(24);
  });

  it('pairs a seat with the third player to its left', () => {
    const five = pairedGame(5);
    expect(partnerSeat(five, 0)).toBe(3);
    expect(partnerSeat(five, 4)).toBe(2);
    const six = pairedGame(6);
    expect(partnerSeat(six, 0)).toBe(3);
    expect(partnerSeat(six, 5)).toBe(2);
  });

  it('runs the six-seat pair cycle without repeating a seat inside a pair', () => {
    let state = pairedGame(6);
    const sequence: { seat: number; role: 1 | 2 }[] = [];
    for (let i = 0; i < 12; i++) {
      sequence.push({ seat: state.turn.seat, role: state.turn.pairedActor });
      state = endWindow(state);
    }
    expect(sequence).toEqual([
      { seat: 0, role: 1 },
      { seat: 3, role: 2 },
      { seat: 1, role: 1 },
      { seat: 4, role: 2 },
      { seat: 2, role: 1 },
      { seat: 5, role: 2 },
      { seat: 3, role: 1 },
      { seat: 0, role: 2 },
      { seat: 4, role: 1 },
      { seat: 1, role: 2 },
      { seat: 5, role: 1 },
      { seat: 2, role: 2 },
    ]);
    // Every seat is Player 1 exactly once and Player 2 exactly once per cycle.
    for (const seat of [0, 1, 2, 3, 4, 5]) {
      expect(sequence.filter((entry) => entry.seat === seat && entry.role === 1)).toHaveLength(1);
      expect(sequence.filter((entry) => entry.seat === seat && entry.role === 2)).toHaveLength(1);
    }
  });

  it('runs the five-seat pair cycle so every seat acts once per cycle', () => {
    let state = pairedGame(5);
    const sequence: { seat: number; role: 1 | 2 }[] = [];
    for (let i = 0; i < 10; i++) {
      sequence.push({ seat: state.turn.seat, role: state.turn.pairedActor });
      state = endWindow(state);
    }
    expect(sequence.map((entry) => entry.seat)).toEqual([0, 3, 1, 4, 2, 0, 3, 1, 4, 2]);
    expect(sequence.map((entry) => entry.role)).toEqual([1, 2, 1, 2, 1, 2, 1, 2, 1, 2]);
    for (const seat of [0, 1, 2, 3, 4]) {
      expect(sequence.filter((entry) => entry.seat === seat)).toHaveLength(2);
    }
  });

  it('produces resources only when Player 1 rolls', () => {
    let state = pairedGame(6);
    state = endWindow(state); // now Player 2 acts
    expect(state.turn.pairedActor).toBe(2);
    expect(state.turn.phase).toBe('action');
    expectRejected(state, state.players[state.turn.seat]!.id, { type: 'turn.roll' }, 'E_WRONG_PHASE');
  });

  it('denies Player 2 any domestic trade entry', () => {
    let state = pairedGame(6);
    state = endWindow(state);
    const actor = state.players[state.turn.seat]!.id;
    expectRejected(
      state,
      actor,
      { type: 'trade.offer', to: 'all', give: { lumber: 1 }, want: { ore: 1 } },
      'E_PAIRED_NO_DOMESTIC_TRADE',
    );
  });

  it('lets Player 2 build, bank-trade and buy development cards', () => {
    let state = pairedGame(6);
    state = endWindow(state);
    const seat = state.turn.seat;
    const actor = state.players[seat]!.id;
    setHand(state, actor, { lumber: 4, brick: 4, ore: 1, grain: 1, wool: 1 });
    state.devDeck = ['knight'];

    const afterBank = act(
      state,
      actor,
      { type: 'trade.bank', give: 'lumber', receive: 'ore' },
      scriptedRng(0),
    ).state;
    expect(handOf(afterBank, actor).ore).toBe(2);

    const afterBuy = act(afterBank, actor, { type: 'build.devCard' }, scriptedRng(0)).state;
    expect(afterBuy.players[seat]!.newDevCards).toEqual(['knight']);

    const roadsBefore = afterBuy.board.roads.filter((road) => road?.player === actor).length;
    const target = legalRoadEdges(afterBuy, actor)[0];
    expect(target).toBeDefined();
    const afterRoad = act(afterBuy, actor, { type: 'build.road', edge: target! }, scriptedRng(0)).state;
    expect(afterRoad.board.roads.filter((road) => road?.player === actor).length).toBe(roadsBefore + 1);
  });

  it('lets either role win immediately', () => {
    let state = pairedGame(5);
    state = endWindow(state); // Player 2 of the first pair
    const seat = state.turn.seat;
    const actor = state.players[seat]!.id;
    state.players[seat]!.bonusPoints = 10;
    // A scoring effect during Player 2's own window ends the game.
    state.players[seat]!.devCards = ['monopoly'];
    setHand(state, actor, {});
    const played = act(state, actor, { type: 'dev.playMonopoly', resource: 'ore' }, scriptedRng(0)).state;
    expect(played.result).toMatchObject({ playerId: actor, reason: 'victory' });
    expect(played.turn.phase).toBe('gameOver');
  });

  it('carries a card bought in one role into the same seat next role', () => {
    let state = pairedGame(6);
    const firstSeat = state.turn.seat;
    const firstActor = state.players[firstSeat]!.id;
    // Fixture shortcut: skip the roll so Player 1 is already in the action phase.
    state = { ...state, turn: { ...state.turn, phase: 'action' } };
    setHand(state, firstActor, { wool: 1, grain: 1, ore: 1 });
    state.devDeck = ['knight'];
    state = act(state, firstActor, { type: 'build.devCard' }, scriptedRng(0)).state;
    expect(state.players[firstSeat]!.newDevCards).toEqual(['knight']);

    // Player 1 ends, then advance until the same seat acts again as Player 2.
    state = endWindow(state);
    for (let i = 0; i < 8 && state.turn.seat !== firstSeat; i++) state = endWindow(state);
    expect(state.turn.seat).toBe(firstSeat);
    expect(state.turn.pairedActor).toBe(2);
    expect(state.players[firstSeat]!.devCards).toEqual(['knight']);
    expect(state.players[firstSeat]!.newDevCards).toEqual([]);
  });

  it('rejects a paired command from the wrong seat', () => {
    const state = pairedGame(6);
    const other = state.players[(state.turn.seat + 1) % 6]!.id;
    expectRejected(state, other, { type: 'turn.end' }, 'E_NOT_YOUR_TURN');
  });

  it('keeps the three- and four-player regression on the unpaired profile', () => {
    const { state } = newGame({ players: 4, profileId: 'base-2025' });
    const finished = runSetup(state);
    expect(finished.turn.pairedActor).toBe(1);
    expect(finished.turn.pairIndex).toBe(0);
    const after = endWindow(finished);
    expect(after.turn.seat).toBe(1);
    expect(after.turn.phase).toBe('preroll');
    void forceTurn;
  });
});
