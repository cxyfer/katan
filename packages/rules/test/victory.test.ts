/** R-B07: victory timing, terminal state and hidden scoring. */

import { describe, expect, it } from 'vitest';
import { scoreOf } from '../src/analysis.ts';
import { applyCommand } from '../src/engine.ts';
import { seededRng } from '../src/rng.ts';
import { act, expectRejected, forceTurn, playableGame } from './helpers.ts';

function clearBoard(state: ReturnType<typeof playableGame>['state']): void {
  state.board.buildings = state.board.buildings.map(() => null);
  state.board.roads = state.board.roads.map(() => null);
}

describe('R-B07 victory', () => {
  it('wins at the start of an own turn before rolling', () => {
    const { state } = playableGame({ players: 4 });
    clearBoard(state);
    state.players[0]!.bonusPoints = 10;
    forceTurn(state, 3, 'action');
    const ended = act(state, 'p4', { type: 'turn.end' }, seededRng(1)).state;
    expect(ended.turn.phase).toBe('gameOver');
    expect(ended.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
    expect(ended.turn.dice).toBeNull();
  });

  it('does not end the game when ten points are reached outside the own turn', () => {
    const { state } = playableGame({ players: 4 });
    clearBoard(state);
    state.players[0]!.bonusPoints = 9;
    forceTurn(state, 1, 'action');
    // p1 gains a point while p2 is the action-window actor.
    state.players[0]!.bonusPoints = 10;
    const afterP2 = act(state, 'p2', { type: 'turn.end' }, seededRng(1)).state;
    expect(afterP2.result).toBeNull();
    expect(afterP2.turn.seat).toBe(2);

    forceTurn(afterP2, 3, 'action');
    const afterP4 = act(afterP2, 'p4', { type: 'turn.end' }, seededRng(1)).state;
    expect(afterP4.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
  });

  it('counts several victory-point cards revealed together', () => {
    const { state } = playableGame({ players: 4 });
    clearBoard(state);
    state.players[0]!.bonusPoints = 7;
    state.players[0]!.devCards = ['victoryPoint', 'victoryPoint', 'victoryPoint'];
    expect(scoreOf(state, 'p1', { includeHidden: true })).toBe(10);
    expect(scoreOf(state, 'p1', { includeHidden: false })).toBe(7);

    forceTurn(state, 3, 'action');
    const ended = act(state, 'p4', { type: 'turn.end' }, seededRng(1)).state;
    expect(ended.result).toMatchObject({ playerId: 'p1' });
  });

  it('does not end the game when a road award is lost before the next own turn', () => {
    const { state } = playableGame({ players: 4 });
    clearBoard(state);
    // 8 public points plus Longest Road would be 10, but the award is lost
    // during another player's turn.
    state.players[0]!.bonusPoints = 8;
    state.awards.longestRoad = 'p1';
    forceTurn(state, 1, 'action');
    state.awards.longestRoad = null;
    const afterP2 = act(state, 'p2', { type: 'turn.end' }, seededRng(1)).state;
    forceTurn(afterP2, 2, 'action');
    const afterP3 = act(afterP2, 'p3', { type: 'turn.end' }, seededRng(1)).state;
    forceTurn(afterP3, 3, 'action');
    const afterP4 = act(afterP3, 'p4', { type: 'turn.end' }, seededRng(1)).state;
    expect(afterP4.turn.seat).toBe(0);
    expect(afterP4.result).toBeNull();
  });

  it('rejects every later command once a result exists', () => {
    const { state } = playableGame({ players: 4 });
    clearBoard(state);
    state.players[0]!.bonusPoints = 10;
    forceTurn(state, 3, 'action');
    const ended = act(state, 'p4', { type: 'turn.end' }, seededRng(1)).state;
    expect(ended.result).not.toBeNull();

    const outcome = applyCommand(ended, 'p1', { type: 'turn.roll' }, seededRng(1));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('E_GAME_OVER');
    expectRejected(ended, 'p1', { type: 'turn.end' }, 'E_GAME_OVER');
  });

  it('publishes only the public score to other players', () => {
    const { state } = playableGame({ players: 4 });
    clearBoard(state);
    state.players[0]!.devCards = ['victoryPoint'];
    state.players[0]!.bonusPoints = 2;
    expect(scoreOf(state, 'p1', { includeHidden: false })).toBe(2);
    expect(scoreOf(state, 'p1', { includeHidden: true })).toBe(3);
  });

  it('keeps the target from the profile', () => {
    const { state } = playableGame({ players: 4 });
    clearBoard(state);
    state.players[0]!.bonusPoints = 9;
    forceTurn(state, 3, 'action');
    const nine = act(state, 'p4', { type: 'turn.end' }, seededRng(1)).state;
    expect(nine.turn.seat).toBe(0);
    expect(nine.result).toBeNull();
    expect(nine.turn.phase).toBe('preroll');
  });
});
