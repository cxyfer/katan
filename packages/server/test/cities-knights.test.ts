/**
 * Cities & Knights through the service: rooms are created through the lobby
 * (profiles `ck-2025` and `ck-paired-2025` are enabled), bot seats are
 * refused, module commands keep durable, idempotent receipts and the progress
 * hands stay private.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as rules from '@catan/rules';
import type { GameState } from '@catan/rules';
import type { CommandReceipt } from '@catan/protocol';
import { startHarness, runSetupOverApi, startedGame, type TestClient, type TestHarness } from './helpers.ts';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface CkView {
  revision: number;
  view: {
    engineVersion: string;
    victoryTarget: number;
    turn: { playerId: string; phase: string };
    players: { id: string; progressCards?: string[]; commodities?: Record<string, number> }[];
    modules?: { citiesKnights?: { barbarian: { position: number }; robberActive: boolean; lastRoll: { event: string; red: number } | null; commodityBank: Record<string, number> } };
    hints?: { modules?: { citiesKnights?: { recruitSites: number[] } } };
  };
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  revision: number;
  error?: { messageId: string };
}

async function snapshot(client: TestClient, gameId: string): Promise<CkView> {
  return client.expectOk<CkView>(await client.get(`/api/games/${gameId}`));
}

async function startCkGame(count: number): Promise<{ clients: TestClient[]; gameId: string }> {
  const clients: TestClient[] = [];
  for (let i = 0; i < count; i++) clients.push(await harness.client(`CK${i + 1}`));
  const host = clients[0]!;
  const room = host.expectOk(await host.post<{ id: string; code: string }>('/api/rooms', {
    visibility: 'private', capacity: count, profileId: 'ck-2025', setupMode: 'fixed',
  }));
  for (const client of clients.slice(1)) client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
  for (const client of clients) client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
  const started = host.expectOk(await host.post<{ gameId: string }>(`/api/rooms/${room.id}/start`));
  return { clients, gameId: started.gameId };
}

describe('Cities & Knights over the API (test-only profile path)', () => {
  it('projects another seat’s progress draw out of first and replayed roll receipts', async () => {
    const { clients, gameId } = await startCkGame(3);
    await runSetupOverApi(clients, gameId);
    const row = (await harness.service.repo.findGame(gameId))!;
    const state = JSON.parse(row.state_json) as rules.GameState;
    const actorId = state.players[state.turn.seat]!.id;
    const recipient = state.players.find((player) => player.id !== actorId)!;
    recipient.improvements.science = 1;
    state.progressDecks.science = ['crane'];
    await harness.service.repo.saveGame(gameId, state, row.revision, 'playing', null);
    const actor = clients.find((client) => client.playerId === actorId)!;
    const body = { commandId: 'private-progress-roll', expectedRevision: row.revision, command: { type: 'turn.roll' } };
    const draws = [0, 0, 3]; // 黃骰 1、紅骰 1、科學城門。
    const rng = vi.spyOn(rules, 'secureRng').mockReturnValue({ int: () => draws.shift() ?? 0 });
    try {
      const first = actor.expectOk<CommandReceipt>(await actor.post(`/api/games/${gameId}/commands`, body));
      expect(first.outcome).toBe('accepted');
      expect(first.events.find((event) => event.type === 'ck.progressDrawn')).toMatchObject({ params: { playerId: recipient.id } });
      const replay = actor.expectOk<CommandReceipt>(await actor.post(`/api/games/${gameId}/commands`, body));
      expect(replay).toEqual(first);
      for (const receipt of [first, replay]) {
        expect(receipt.events.every((event) => event.private === undefined)).toBe(true);
        expect(receipt.events.every((event) => event.params.card === undefined)).toBe(true);
        expect(JSON.stringify(receipt)).not.toContain('crane');
      }
      const own = await snapshot(clients.find((client) => client.playerId === recipient.id)!, gameId);
      expect(own.view.players.find((player) => player.id === recipient.id)!.progressCards).toEqual(['crane']);
      const persisted = (await harness.service.repo.findGame(gameId))!;
      expect((JSON.parse(persisted.state_json) as rules.GameState).players.find((player) => player.id === recipient.id)!.progressCards).toEqual(['crane']);
    } finally {
      rng.mockRestore();
    }
  });

  it.each(['buy', 'steal'] as const)('preserves the actor’s private %s result in first and replayed base receipts', async (kind) => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const row = (await harness.service.repo.findGame(gameId))!;
    const state = JSON.parse(row.state_json) as rules.GameState;
    const actorId = state.players[state.turn.seat]!.id;
    const actor = clients.find((client) => client.playerId === actorId)!;
    state.turn.phase = 'action';
    const self = state.players.find((player) => player.id === actorId)!;
    self.resources = { lumber: 0, brick: 0, wool: 1, grain: 1, ore: 1 };
    const victim = state.players.find((player) => player.id !== actorId)!;
    victim.resources = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 1 };
    state.devDeck = ['monopoly'];
    if (kind === 'steal') state.pending = { kind: 'steal', actor: actorId, hex: 0, candidates: [victim.id], pirate: false };
    await harness.service.repo.saveGame(gameId, state, row.revision, 'playing', null);
    const command = kind === 'buy' ? { type: 'build.devCard' } : { type: 'pending.steal', victim: victim.id };
    const body = { commandId: `private-base-${kind}`, expectedRevision: row.revision, command };
    const first = actor.expectOk<CommandReceipt>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(first.outcome).toBe('accepted');
    const replay = actor.expectOk<CommandReceipt>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(replay).toEqual(first);
    const event = first.events.find((event) => event.type === (kind === 'buy' ? 'build.devCard' : 'robber.stole'))!;
    expect(event.params).toMatchObject(kind === 'buy' ? { card: 'monopoly' } : { resource: 'ore' });
    expect(event.private).toBeUndefined();
  });

  it('offers both profiles in the lobby and refuses bot seats', async () => {
    const host = await harness.client('CkLobby');
    const { profiles, selectable } = host.expectOk<{ profiles: { id: string; botSeats: boolean }[]; selectable: string[] }>(await host.get('/api/profiles'));
    expect(selectable).toEqual(expect.arrayContaining(['ck-2025', 'ck-paired-2025']));
    expect(profiles.filter((profile) => profile.id.startsWith('ck-')).map((profile) => profile.botSeats)).toEqual([false, false]);
    const room = host.expectOk<{ id: string; profileId: string; capacity: number }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'fixed', ruleset: { expansions: ['citiesKnights'] },
    }));
    expect(room.profileId).toBe('ck-2025');
    const paired = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 5, setupMode: 'variable', ruleset: { expansions: ['citiesKnights'] },
    }));
    expect(paired.profileId).toBe('ck-paired-2025');
    host.expectError(await host.post(`/api/rooms/${room.id}/bots`, {}), 'E_INVALID_BOT');
  });

  it('starts a C&K game, rolls three dice and keeps module receipts idempotent', async () => {
    const { clients, gameId } = await startCkGame(3);
    const first = await snapshot(clients[0]!, gameId);
    expect(first.view.engineVersion).toBe('ck-2025.1');
    expect(first.view.victoryTarget).toBe(13);
    expect(first.view.modules?.citiesKnights).toMatchObject({ barbarian: { position: 0 }, robberActive: false, commodityBank: { paper: 12, cloth: 12, coin: 12 } });

    const setup = await runSetupOverApi(clients, gameId);
    expect(setup.view.turn.phase).toBe('preroll');
    const actor = clients.find((client) => client.playerId === setup.view.turn.playerId)!;
    const body = { commandId: 'ck-roll', expectedRevision: setup.revision, command: { type: 'turn.roll' } };
    const rolled = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(rolled.outcome).toBe('accepted');
    const again = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(again.revision).toBe(rolled.revision);
    const after = await snapshot(actor, gameId);
    expect(after.view.modules?.citiesKnights?.lastRoll?.event).toMatch(/^(ship|science|trade|politics)$/);

    // Development cards do not exist in C&K; the rejection has a catalogued id.
    const devCard = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, {
      commandId: 'ck-dev', expectedRevision: after.revision, command: { type: 'build.devCard' },
    }));
    expect(devCard.outcome).toBe('rejected');
    expect(devCard.error?.messageId).toBe('error.E_INVALID_COMMAND');

    // Other players never see a progress hand.
    const other = clients.find((client) => client !== actor)!;
    const theirs = await snapshot(other, gameId);
    for (const player of theirs.view.players) {
      if (player.id !== other.playerId) expect(player.progressCards).toBeUndefined();
    }
  });

  it('replays a progress.play command id as the original receipt without applying it again', async () => {
    const { clients, gameId } = await startCkGame(3);
    const setup = await runSetupOverApi(clients, gameId);
    const actor = clients.find((client) => client.playerId === setup.view.turn.playerId)!;
    // Put the turn in its action phase with a Mining card in hand (a test-only fixture edit of the snapshot).
    const row = (await harness.service.repo.findGame(gameId))!;
    const state = JSON.parse(row.state_json) as GameState;
    state.turn.phase = 'action';
    state.players.find((player) => player.id === actor.playerId)!.progressCards = ['mining'];
    await harness.service.repo.saveGame(gameId, state, row.revision, row.status, row.pause_reason);

    const before = await snapshot(actor, gameId);
    const body = { commandId: 'ck-mining', expectedRevision: before.revision, command: { type: 'progress.play', card: 'mining' } };
    const played = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(played.outcome).toBe('accepted');
    const afterFirst = await snapshot(actor, gameId);
    const me = (view: CkView) => view.view.players.find((player) => player.id === actor.playerId)!;
    expect(me(afterFirst).progressCards).toEqual([]);

    const again = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(again).toEqual(played);
    const afterSecond = await snapshot(actor, gameId);
    expect(afterSecond.revision).toBe(afterFirst.revision);
    expect(afterSecond.view).toEqual(afterFirst.view);
  });
});
