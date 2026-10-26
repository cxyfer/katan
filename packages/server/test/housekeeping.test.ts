/** R-ROOM: stale-lobby cleanup never reaps a resumable game. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, startedGame, type TestHarness } from './helpers.ts';
import { loadConfig } from '../src/config.ts';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness({
    limits: { ...loadConfig().limits, roomIdleTtlMinutes: 0 },
  });
});

afterAll(async () => {
  await harness.close();
});

describe('stale lobby cleanup', () => {
  it('removes an idle pre-game lobby', async () => {
    const host = await harness.client('SweepHost');
    const room = host.expectOk<{ id: string }>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    // No live connection is registered in this API-only test, so the lobby is
    // eligible once its TTL (configured as 0 minutes) has elapsed.
    const removed = await harness.service.rooms.sweepStaleLobbies(new Date(Date.now() + 60_000));
    expect(removed).toContain(room.id);
    host.expectError(await host.get(`/api/rooms/${room.id}`), 'E_ROOM_NOT_FOUND');
  });

  it('never removes a room whose game has started', async () => {
    const { roomId, gameId } = await startedGame(harness, 3);
    const removed = await harness.service.rooms.sweepStaleLobbies(new Date(Date.now() + 60_000));
    expect(removed).not.toContain(roomId);
    const room = await harness.service.repo.findRoom(roomId);
    expect(room?.status).toBe('playing');
    expect(room?.game_id).toBe(gameId);
  });

  it('never removes a suspended game', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    const [host, second, third] = clients;
    const proposal = host!.expectOk<{ proposalId: string }>(
      await host!.post(`/api/games/${gameId}/suspend`, {}),
    );
    await second!.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });
    await third!.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });
    const removed = await harness.service.rooms.sweepStaleLobbies(new Date(Date.now() + 60_000));
    expect(removed).not.toContain(roomId);
    expect((await harness.service.repo.findRoom(roomId))?.status).toBe('suspended');
  });
});
