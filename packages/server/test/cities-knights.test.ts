/**
 * Cities & Knights through the service. The profiles are implemented but not
 * enabled, so the lobby refuses them; this test-only path patches a lobby
 * room's profile in the repository before the start, as the browser harness
 * does. Module commands keep durable, idempotent receipts and the progress
 * hands stay private.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, runSetupOverApi, type TestClient, type TestHarness } from './helpers.ts';

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
    visibility: 'private', capacity: count, profileId: 'base-2025', setupMode: 'fixed',
  }));
  for (const client of clients.slice(1)) client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
  for (const client of clients) client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
  // Test-only: the lobby never offers a disabled profile.
  await harness.service.repo.updateRoom(room.id, { profile_id: 'ck-2025' });
  const started = host.expectOk(await host.post<{ gameId: string }>(`/api/rooms/${room.id}/start`));
  return { clients, gameId: started.gameId };
}

describe('Cities & Knights over the API (test-only profile path)', () => {
  it('keeps the profiles out of the lobby', async () => {
    const host = await harness.client('CkLobby');
    const refused = await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'fixed', ruleset: { expansions: ['citiesKnights'] },
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
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
});
