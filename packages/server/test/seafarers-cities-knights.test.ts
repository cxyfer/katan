/**
 * Seafarers + Cities & Knights through the service: both New Shores combined
 * profiles are offered in the lobby and resolved from their parts, bot seats
 * are refused, the combination layer's commands keep durable, idempotent
 * receipts, and progress hands stay private.
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

interface CombinedView {
  revision: number;
  view: {
    engineVersion: string;
    victoryTarget: number;
    turn: { playerId: string; phase: string };
    board: { robber: number; pirate: number | null };
    players: { id: string; progressCards?: string[] }[];
    modules?: { seafarersCitiesKnights?: { pirateActive: boolean }; citiesKnights?: { robberActive: boolean }; seafarers?: object };
    hints?: { modules?: { seafarersCitiesKnights?: { pirateChase: number[]; bandit: string | null } } };
  };
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  revision: number;
  error?: { messageId: string };
}

async function snapshot(client: TestClient, gameId: string): Promise<CombinedView> {
  return client.expectOk<CombinedView>(await client.get(`/api/games/${gameId}`));
}

describe('Seafarers + Cities & Knights over the API', () => {
  it('offers both combined profiles, resolves them from their parts and refuses bot seats', async () => {
    const host = await harness.client('SfCkLobby');
    const { profiles, selectable } = host.expectOk<{ profiles: { id: string; botSeats: boolean }[]; selectable: string[] }>(await host.get('/api/profiles'));
    expect(selectable).toEqual(expect.arrayContaining(['sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025']));
    expect(profiles.filter((profile) => profile.id.startsWith('sf-ck-')).map((profile) => profile.botSeats)).toEqual([false, false]);
    const room = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 3, setupMode: 'fixed', ruleset: { expansions: ['citiesKnights', 'seafarers'], scenario: 'new-shores' },
    }));
    expect(room.profileId).toBe('sf-ck-new-shores-2025');
    const paired = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 6, setupMode: 'variable', ruleset: { expansions: ['seafarers', 'citiesKnights'], scenario: 'new-shores' },
    }));
    expect(paired.profileId).toBe('sf-ck-new-shores-paired-2025');
    host.expectError(await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, profileId: 'sf-ck-new-shores-2025', setupMode: 'fixed', bots: 1,
    }), 'E_INVALID_BOT');
  });

  it('starts a combined game with both bandits waiting, keeps receipts idempotent and hands private', async () => {
    const clients: TestClient[] = [];
    for (let i = 0; i < 3; i++) clients.push(await harness.client(`SfCk${i + 1}`));
    const host = clients[0]!;
    const room = host.expectOk(await host.post<{ id: string; code: string }>('/api/rooms', {
      visibility: 'private', capacity: 3, profileId: 'sf-ck-new-shores-2025', setupMode: 'fixed',
    }));
    for (const client of clients.slice(1)) client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
    for (const client of clients) client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    const { gameId } = host.expectOk(await host.post<{ gameId: string }>(`/api/rooms/${room.id}/start`));

    const first = await snapshot(host, gameId);
    expect(first.view.engineVersion).toBe('sf-ck-2025.1');
    expect(first.view.victoryTarget).toBe(16);
    expect(first.view.board).toMatchObject({ robber: -1, pirate: null });
    expect(first.view.modules?.seafarersCitiesKnights).toEqual({ pirateActive: false });
    expect(first.view.modules?.citiesKnights?.robberActive).toBe(false);
    expect(first.view.modules?.seafarers).toBeDefined();

    const setup = await runSetupOverApi(clients, gameId);
    expect(setup.view.turn.phase).toBe('preroll');
    const actor = clients.find((client) => client.playerId === setup.view.turn.playerId)!;
    const body = { commandId: 'sfck-roll', expectedRevision: setup.revision, command: { type: 'turn.roll' } };
    const rolled = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(rolled.outcome).toBe('accepted');
    const again = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(again.revision).toBe(rolled.revision);

    // The pirate cannot be chased before the first attack; the rejection is catalogued and durable.
    const after = await snapshot(actor, gameId);
    const chase = { commandId: 'sfck-chase', expectedRevision: after.revision, command: { type: 'knight.chasePirate', vertex: 0 } };
    const refused = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, chase));
    expect(refused.outcome).toBe('rejected');
    expect(refused.error?.messageId).toMatch(/^error\.E_/);
    const refusedAgain = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, chase));
    expect(refusedAgain).toEqual(refused);

    const other = clients.find((client) => client !== actor)!;
    const theirs = await snapshot(other, gameId);
    for (const player of theirs.view.players) {
      if (player.id !== other.playerId) expect(player.progressCards).toBeUndefined();
    }
  });
});
