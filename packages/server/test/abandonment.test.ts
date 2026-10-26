/** R-ROOM / R-POLICY: abandonment of an interrupted table (§4.6). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, startedGame, runSetupOverApi, type TestClient, type TestHarness } from './helpers.ts';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

async function setOffline(roomId: string, playerId: string, offline: boolean): Promise<void> {
  await harness.service.repo.updateMembership(roomId, playerId, {
    connected: offline ? 0 : 1,
    disconnected_at: offline ? new Date().toISOString() : null,
  });
}

describe('abandonment of an interrupted table', () => {
  it('refuses to propose while every seat is connected', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    clients[0]!.expectError(await clients[0]!.post(`/api/games/${gameId}/abandon`, {}), 'E_NO_ABSENT_PLAYER');
  });

  it('ends the game without a winner once every connected seat agrees', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    await setOffline(roomId, third.playerId!, true);

    // Only the absent seat is excused; the two connected seats must both agree.
    const proposal = host.expectOk<{ proposalId: string }>(
      await host.post(`/api/games/${gameId}/abandon`, {}),
    );
    let room = host.expectOk<{ status: string }>(await host.get(`/api/rooms/${roomId}`));
    expect(room.status).toBe('playing');

    const applied = second.expectOk<{ abandoned: boolean }>(
      await second.post(`/api/games/${gameId}/abandon`, {
        proposalId: proposal.proposalId,
        approve: true,
      }),
    );
    expect(applied.abandoned).toBe(true);

    room = host.expectOk<{ status: string }>(await host.get(`/api/rooms/${roomId}`));
    expect(room.status).toBe('abandoned');
    const snapshot = host.expectOk<{
      revision: number;
      view: { result: { playerId: string | null; reason: string } | null };
    }>(await host.get(`/api/games/${gameId}`));
    expect(snapshot.view.result?.playerId).toBeNull();
    expect(snapshot.view.result?.reason).toBe('abandoned');

    // A committed abandonment rejects later strategic commands.
    host.expectError(
      await host.post(`/api/games/${gameId}/commands`, {
        commandId: 'after-abandon',
        expectedRevision: snapshot.revision,
        command: { type: 'turn.roll' },
      }),
      'E_GAME_OVER',
    );
  });

  it('requires an explicit confirmation from each connected seat', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 4);
    await runSetupOverApi(clients, gameId);
    const [host, second, third, fourth] = clients as [TestClient, TestClient, TestClient, TestClient];
    await setOffline(roomId, fourth.playerId!, true);

    const proposal = host.expectOk<{ proposalId: string }>(
      await host.post(`/api/games/${gameId}/abandon`, {}),
    );
    const partial = second.expectOk<{ abandoned: boolean }>(
      await second.post(`/api/games/${gameId}/abandon`, {
        proposalId: proposal.proposalId,
        approve: true,
      }),
    );
    expect(partial.abandoned).toBe(false);
    const stillPlaying = host.expectOk<{ status: string }>(await host.get(`/api/rooms/${roomId}`));
    expect(stillPlaying.status).toBe('playing');

    const final = third.expectOk<{ abandoned: boolean }>(
      await third.post(`/api/games/${gameId}/abandon`, {
        proposalId: proposal.proposalId,
        approve: true,
      }),
    );
    expect(final.abandoned).toBe(true);
  });

  it('cancels the vote when an absent seat reconnects', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    await setOffline(roomId, third.playerId!, true);
    const proposal = host.expectOk<{ proposalId: string }>(
      await host.post(`/api/games/${gameId}/abandon`, {}),
    );
    // The third seat returns before the vote completes.
    await setOffline(roomId, third.playerId!, false);
    const late = third.expectOk<{ abandoned: boolean }>(
      await third.post(`/api/games/${gameId}/abandon`, { proposalId: proposal.proposalId, approve: true }),
    );
    expect(late.abandoned).toBe(false);
    const room = host.expectOk<{ status: string }>(await host.get(`/api/rooms/${roomId}`));
    expect(room.status).toBe('playing');
    void second;
  });

  it('refuses abandonment when the room policy disables it', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    // Pre-start policy change would clear readiness, so apply the confirmed
    // post-start route: propose, then have every seat consent.
    const proposed = host.expectOk<{ pendingPolicy: { id: string } }>(
      await host.post(`/api/rooms/${roomId}/policy`, {
        policy: { allowAbandonment: false },
      }),
    );
    const proposalId = proposed.pendingPolicy.id;
    await second.post(`/api/rooms/${roomId}/policy/consent`, { proposalId, approve: true });
    const applied = third.expectOk<{ policy: { allowAbandonment: boolean } }>(
      await third.post(`/api/rooms/${roomId}/policy/consent`, { proposalId, approve: true }),
    );
    expect(applied.policy.allowAbandonment).toBe(false);

    await setOffline(roomId, third.playerId!, true);
    host.expectError(await host.post(`/api/games/${gameId}/abandon`, {}), 'E_ABANDON_DISABLED');
  });

  it('accepts an explicit withdrawal as an absence and lets it be retracted', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];

    const withdrawn = third.expectOk<{ members: { playerId: string }[] }>(
      await third.post(`/api/rooms/${roomId}/withdraw`, { withdrawn: true }),
    );
    expect(withdrawn.members).toHaveLength(3);

    const proposal = host.expectOk<{ proposalId: string }>(
      await host.post(`/api/games/${gameId}/abandon`, {}),
    );
    // Retracting the withdrawal invalidates the vote before it commits.
    third.expectOk(await third.post(`/api/rooms/${roomId}/withdraw`, { withdrawn: false }));
    const after = second.expectOk<{ abandoned: boolean }>(
      await second.post(`/api/games/${gameId}/abandon`, { proposalId: proposal.proposalId, approve: true }),
    );
    expect(after.abandoned).toBe(false);
    const room = host.expectOk<{ status: string }>(await host.get(`/api/rooms/${roomId}`));
    expect(room.status).toBe('playing');
  });

  it('refuses an abandonment vote from a player without a seat', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const outsider = await harness.client('AbandonOutsider');
    outsider.expectError(await outsider.post(`/api/games/${gameId}/abandon`, {}), 'E_NOT_SEATED');
  });
});
