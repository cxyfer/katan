/** R-VIS: per-player projection and information visibility. */

import { describe, expect, it } from 'vitest';
import { projectEvent, projectGame, projectRoomSummary } from '../src/project.ts';
import type { GameEvent } from '../src/types.ts';
import { playableGame, setHand } from './helpers.ts';

describe('R-VIS projections', () => {
  it('never sends another player hidden resources or cards', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p2', { ore: 3, grain: 1 });
    state.players[1]!.devCards = ['knight', 'victoryPoint'];
    state.players[1]!.newDevCards = ['monopoly'];

    const view = projectGame(state, 'p1');
    const p1 = view.players.find((player) => player.id === 'p1')!;
    const p2 = view.players.find((player) => player.id === 'p2')!;

    expect(p1.resources).toBeDefined();
    expect(p2.resources).toBeUndefined();
    expect(p2.devCards).toBeUndefined();
    expect(p2.newDevCards).toBeUndefined();
    expect(p2.handSize).toBe(4);
    expect(p2.devCardCount).toBe(2);
    expect(p2.newDevCardCount).toBe(1);

    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('"monopoly"');
    expect(serialised).not.toContain('"victoryPoint"');
  });

  it('exposes the own total score only to its owner', () => {
    const { state } = playableGame({ players: 4 });
    state.players[1]!.devCards = ['victoryPoint', 'victoryPoint'];
    const view = projectGame(state, 'p1');
    const p1 = view.players.find((player) => player.id === 'p1')!;
    const p2 = view.players.find((player) => player.id === 'p2')!;
    expect(p1.ownScore).toBeDefined();
    expect(p2.ownScore).toBeUndefined();
    expect(p2.publicScore).toBe(p2.publicScore);
    expect(p2.publicScore).toBeLessThanOrEqual(p2.handSize + 10);
  });

  it('hides deck order and only publishes its size', () => {
    const { state } = playableGame({ players: 4 });
    const view = projectGame(state, 'p1');
    expect(view.devDeckSize).toBe(state.devDeck.length);
    expect(JSON.stringify(view)).not.toContain('"devDeck":');
  });

  it('filters private event parameters by audience', () => {
    const event: GameEvent = {
      seq: 3,
      type: 'robber.stole',
      params: { playerId: 'p1', victim: 'p2' },
      private: { to: ['p1', 'p2'], params: { resource: 'ore' } },
    };
    const thief = projectEvent(event, 'p1');
    const victim = projectEvent(event, 'p2');
    const bystander = projectEvent(event, 'p3');
    expect(thief.params.resource).toBe('ore');
    expect(victim.params.resource).toBe('ore');
    expect(bystander.params.resource).toBeUndefined();
    expect(bystander.params.victim).toBe('p2');
  });

  it('keeps pending discard counts public but not the discarded identities', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { ore: 4, grain: 4 });
    state.pending = { kind: 'discard', required: { p1: 4 }, submitted: {} };
    const view = projectGame(state, 'p2');
    expect(view.pending).toEqual({ kind: 'discard', required: { p1: 4 }, waitingFor: ['p1'] });
    expect(JSON.stringify(view)).not.toContain('"ore":4');
  });

  it('hides the invite code of a private room in discovery metadata', () => {
    const summary = projectRoomSummary({
      id: 'room-1',
      code: 'SECRET',
      visibility: 'private',
      status: 'lobby',
      hostId: 'p1',
      profileId: 'base-2025',
      playerCount: 2,
      capacity: 4,
      createdAt: '2026-10-26T00:00:00.000Z',
    });
    expect(summary.code).toBeUndefined();
    const publicSummary = projectRoomSummary({
      id: 'room-2',
      code: 'OPEN',
      visibility: 'public',
      status: 'lobby',
      hostId: 'p1',
      profileId: 'base-2025',
      playerCount: 1,
      capacity: 4,
      createdAt: '2026-10-26T00:00:00.000Z',
    });
    expect(publicSummary.code).toBe('OPEN');
    expect(publicSummary.openSeats).toBe(3);
  });

  it('reports the action-window actor separately from the turn owner', () => {
    const { state } = playableGame({ players: 4 });
    state.pending = { kind: 'steal', actor: 'p3', hex: 0, candidates: ['p2'], pirate: false };
    const view = projectGame(state, 'p2');
    expect(view.turn.playerId).toBe('p1');
    expect(view.pending).toEqual({ kind: 'steal', actor: 'p3', hex: 0, candidates: ['p2'] });
  });
});
