/** R-B05: development cards, purchase timing and effects. */

import { describe, expect, it } from 'vitest';
import { scoreOf } from '../src/analysis.ts';
import { legalRoadEdges } from '../src/engine.ts';
import {
  act,
  expectRejected,
  forceTurn,
  handOf,
  handSize,
  playableGame,
  scriptedRng,
  setHand,
} from './helpers.ts';
import type { DevCardType } from '../src/types.ts';

function withDeck(state: ReturnType<typeof playableGame>['state'], cards: DevCardType[]) {
  state.devDeck = cards;
}

describe('R-B05 development cards', () => {
  it('charges wool, grain and ore and keeps the card unplayable this turn', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { wool: 1, grain: 1, ore: 1 });
    withDeck(state, ['knight', 'monopoly']);
    const bought = act(state, 'p1', { type: 'build.devCard' }, scriptedRng([0])).state;
    expect(handSize(bought, 'p1')).toBe(0);
    expect(bought.players[0]!.newDevCards).toEqual(['knight']);
    expect(bought.players[0]!.devCards).toEqual([]);
    expect(bought.devDeck).toEqual(['monopoly']);

    const target = bought.board.layout.numbers.findIndex((value) => value === 6);
    expectRejected(bought, 'p1', { type: 'dev.playKnight', hex: target }, 'E_CARD_JUST_BOUGHT');
  });

  it('rejects buying without the cost or with an empty deck', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { wool: 1, grain: 1 });
    withDeck(state, ['knight']);
    expectRejected(state, 'p1', { type: 'build.devCard' }, 'E_INSUFFICIENT_RESOURCES');

    setHand(state, 'p1', { wool: 1, grain: 1, ore: 1 });
    withDeck(state, []);
    expectRejected(state, 'p1', { type: 'build.devCard' }, 'E_DECK_EMPTY');
  });

  it('becomes playable on the next own turn', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { wool: 1, grain: 1, ore: 1 });
    withDeck(state, ['knight']);
    let current = act(state, 'p1', { type: 'build.devCard' }, scriptedRng([0])).state;
    current = act(current, 'p1', { type: 'turn.end' }, scriptedRng([0])).state;
    for (const seat of [1, 2, 3]) {
      forceTurn(current, seat, 'action');
      current = act(current, current.players[seat]!.id, { type: 'turn.end' }, scriptedRng([0])).state;
    }
    expect(current.turn.seat).toBe(0);
    expect(current.players[0]!.devCards).toEqual(['knight']);
    expect(current.players[0]!.newDevCards).toEqual([]);

    forceTurn(current, 0, 'preroll');
    const target = current.board.layout.numbers.findIndex(
      (value, hex) => value === 6 && hex !== current.board.robber,
    );
    const played = act(current, 'p1', { type: 'dev.playKnight', hex: target }, scriptedRng([0])).state;
    expect(played.players[0]!.playedKnights).toBe(1);
    expect(played.board.robber).toBe(target);
  });

  it('allows only one development card per turn', () => {
    const { state } = playableGame({ players: 4 });
    state.players[0]!.devCards = ['knight', 'monopoly'];
    setHand(state, 'p2', { ore: 2 });
    const target = state.board.layout.numbers.findIndex((value) => value === 6);
    const played = act(state, 'p1', { type: 'dev.playKnight', hex: target }, scriptedRng([0])).state;
    expectRejected(played, 'p1', { type: 'dev.playMonopoly', resource: 'ore' }, 'E_CARD_ALREADY_PLAYED');
  });

  it('monopoly transfers every card of one resource from all opponents', () => {
    const { state } = playableGame({ players: 4 });
    state.players[0]!.devCards = ['monopoly'];
    setHand(state, 'p2', { ore: 3, wool: 1 });
    setHand(state, 'p3', { ore: 2 });
    setHand(state, 'p4', {});
    const played = act(state, 'p1', { type: 'dev.playMonopoly', resource: 'ore' }, scriptedRng([0])).state;
    expect(handOf(played, 'p1').ore).toBe(5);
    expect(handOf(played, 'p2').ore).toBe(0);
    expect(handOf(played, 'p2').wool).toBe(1);
    expect(handOf(played, 'p3').ore).toBe(0);
  });

  it('year of plenty takes two cards from the bank, one at a time', () => {
    const { state } = playableGame({ players: 4 });
    state.players[0]!.devCards = ['yearOfPlenty'];
    state.bank.ore = 0;
    setHand(state, 'p1', {});
    const bankBefore = { ...state.bank };
    let current = act(state, 'p1', { type: 'dev.playYearOfPlenty' }, scriptedRng([0])).state;
    expect(current.pending).toEqual({ kind: 'yearOfPlenty', actor: 'p1', remaining: 2 });
    expectRejected(current, 'p1', { type: 'pending.takeResource', resource: 'ore' }, 'E_BANK_EMPTY');
    current = act(current, 'p1', { type: 'pending.takeResource', resource: 'lumber' }, scriptedRng([0])).state;
    expect(current.pending).toEqual({ kind: 'yearOfPlenty', actor: 'p1', remaining: 1 });
    current = act(current, 'p1', { type: 'pending.takeResource', resource: 'lumber' }, scriptedRng([0])).state;
    expect(current.pending).toBeNull();
    expect(handOf(current, 'p1').lumber).toBe(2);
    expect(current.bank.lumber).toBe(bankBefore.lumber - 2);
  });

  it('road building places two roads without cost', () => {
    const { state } = playableGame({ players: 4 });
    state.players[0]!.devCards = ['roadBuilding'];
    setHand(state, 'p1', {});
    const placed = act(state, 'p1', { type: 'dev.playRoadBuilding' }, scriptedRng([0])).state;
    expect(placed.pending).toEqual({ kind: 'freeRoads', actor: 'p1', remaining: 2 });

    const options = legalRoadEdges(placed, 'p1');
    let current = act(placed, 'p1', { type: 'build.road', edge: options[0]! }, scriptedRng([0])).state;
    expect(current.pending).toEqual({ kind: 'freeRoads', actor: 'p1', remaining: 1 });
    const next = legalRoadEdges(current, 'p1');
    current = act(current, 'p1', { type: 'build.road', edge: next[0]! }, scriptedRng([0])).state;
    expect(current.pending).toBeNull();
    expect(handSize(current, 'p1')).toBe(0);
    expect(current.board.roads.filter((road) => road?.player === 'p1').length).toBe(
      state.board.roads.filter((road) => road?.player === 'p1').length + 2,
    );
  });

  it('cannot be played outside the actor window or when not held', () => {
    const { state } = playableGame({ players: 4 });
    const target = state.board.layout.numbers.findIndex((value) => value === 6);
    expectRejected(state, 'p1', { type: 'dev.playKnight', hex: target }, 'E_CARD_NOT_HELD');
    state.players[0]!.devCards = ['knight'];
    expectRejected(state, 'p2', { type: 'dev.playKnight', hex: target }, 'E_NOT_YOUR_TURN');
  });

  it('counts a purchased victory-point card towards the owner score only', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { wool: 1, grain: 1, ore: 1 });
    withDeck(state, ['victoryPoint']);
    const bought = act(state, 'p1', { type: 'build.devCard' }, scriptedRng([0])).state;
    expect(bought.players[0]!.newDevCards).toEqual(['victoryPoint']);

    const own = scoreOf(bought, 'p1', { includeHidden: true });
    const publicScore = scoreOf(bought, 'p1', { includeHidden: false });
    expect(own - publicScore).toBe(1);
  });

  it('does not allow a knight to move the robber onto its own hex', () => {
    const { state } = playableGame({ players: 4 });
    state.players[0]!.devCards = ['knight'];
    expectRejected(
      state,
      'p1',
      { type: 'dev.playKnight', hex: state.board.robber },
      'E_ROBBER_SAME_HEX',
    );
  });

  it('keeps the deck order stable across a purchase', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { wool: 1, grain: 1, ore: 1 });
    withDeck(state, ['monopoly', 'knight', 'yearOfPlenty']);
    const bought = act(state, 'p1', { type: 'build.devCard' }, scriptedRng([1])).state;
    expect(bought.players[0]!.newDevCards).toEqual(['knight']);
    expect(bought.devDeck).toEqual(['monopoly', 'yearOfPlenty']);
  });
});
