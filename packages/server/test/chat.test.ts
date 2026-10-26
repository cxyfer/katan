/** R-CHAT: audience, deduplication, rate limits, mute and epoch isolation. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, startedGame, type TestClient, type TestHarness } from './helpers.ts';
import { loadConfig } from '../src/config.ts';

let harness: TestHarness;
let limited: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
  limited = await startHarness({ limits: { ...loadConfig().limits, chatRatePerMinute: 2 } });
});

afterAll(async () => {
  await harness.close();
  await limited.close();
});

interface ChatShape {
  id: string;
  seq: number;
  playerId: string;
  nickname: string;
  text: string;
  kind: string;
  clientMessageId?: string;
}

interface ChatPageShape {
  messages: ChatShape[];
  nextSeq: number;
  hasMore: boolean;
}

async function lobbyWithTwo(): Promise<{ host: TestClient; guest: TestClient; roomId: string }> {
  const host = await harness.client('ChatHost');
  const guest = await harness.client('ChatGuest');
  const room = host.expectOk<{ id: string; code: string }>(
    await host.post('/api/rooms', {
      visibility: 'private',
      capacity: 3,
      profileId: 'base-2025',
      setupMode: 'fixed',
    }),
  );
  guest.expectOk(await guest.post('/api/rooms/join', { code: room.code }));
  return { host, guest, roomId: room.id };
}

describe('R-CHAT room text chat', () => {
  it('sends a message, echoes the client id and orders it by server sequence', async () => {
    const { host, guest, roomId } = await lobbyWithTwo();
    const sent = host.expectOk<ChatShape>(
      await host.post(`/api/rooms/${roomId}/chat`, {
        clientMessageId: 'c1',
        text: 'hello table',
      }),
    );
    expect(sent.text).toBe('hello table');
    expect(sent.clientMessageId).toBe('c1');
    expect(sent.kind).toBe('player');

    const second = guest.expectOk<ChatShape>(
      await guest.post(`/api/rooms/${roomId}/chat`, {
        clientMessageId: 'g1',
        text: 'hi',
      }),
    );
    expect(second.seq).toBeGreaterThan(sent.seq);

    const page = guest.expectOk<ChatPageShape>(await guest.get(`/api/rooms/${roomId}/chat`));
    expect(page.messages.map((message) => message.text)).toEqual(['hello table', 'hi']);
  });

  it('deduplicates a retried client message id', async () => {
    const { host, roomId } = await lobbyWithTwo();
    const first = host.expectOk<ChatShape>(
      await host.post(`/api/rooms/${roomId}/chat`, { clientMessageId: 'dup', text: 'once' }),
    );
    const retry = host.expectOk<ChatShape>(
      await host.post(`/api/rooms/${roomId}/chat`, { clientMessageId: 'dup', text: 'once' }),
    );
    expect(retry.id).toBe(first.id);
    const page = host.expectOk<ChatPageShape>(await host.get(`/api/rooms/${roomId}/chat`));
    expect(page.messages.filter((message) => message.text === 'once')).toHaveLength(1);
  });

  it('rejects empty, over-long and control-character messages', async () => {
    const { host, roomId } = await lobbyWithTwo();
    host.expectError(
      await host.post(`/api/rooms/${roomId}/chat`, { clientMessageId: 'e1', text: '   ' }),
      'E_BAD_REQUEST',
    );
    host.expectError(
      await host.post(`/api/rooms/${roomId}/chat`, { clientMessageId: 'e2', text: 'x'.repeat(2000) }),
      'E_CHAT_TOO_LONG',
    );
    host.expectError(
      await host.post(`/api/rooms/${roomId}/chat`, { clientMessageId: 'e3', text: 'bad\u0000text' }),
      'E_CHAT_INVALID',
    );
  });

  it('stores markup verbatim without executing or stripping it', async () => {
    const { host, roomId } = await lobbyWithTwo();
    const text = '<script>alert(1)</script> **not markdown**';
    const sent = host.expectOk<ChatShape>(
      await host.post(`/api/rooms/${roomId}/chat`, { clientMessageId: 'x1', text }),
    );
    expect(sent.text).toBe(text);
  });

  it('rate limits a sender but not the rest of the table', async () => {
    const host = await limited.client('RateHost');
    const guest = await limited.client('RateGuest');
    const room = host.expectOk<{ id: string; code: string }>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    guest.expectOk(await guest.post('/api/rooms/join', { code: room.code }));
    host.expectOk(await host.post(`/api/rooms/${room.id}/chat`, { clientMessageId: 'r1', text: 'one' }));
    host.expectOk(await host.post(`/api/rooms/${room.id}/chat`, { clientMessageId: 'r2', text: 'two' }));
    host.expectError(
      await host.post(`/api/rooms/${room.id}/chat`, { clientMessageId: 'r3', text: 'three' }),
      'E_CHAT_RATE_LIMITED',
    );
    guest.expectOk(await guest.post(`/api/rooms/${room.id}/chat`, { clientMessageId: 'r4', text: 'mine' }));
  });

  it('hides muted senders from that viewer only', async () => {
    const { host, guest, roomId } = await lobbyWithTwo();
    host.expectOk(await host.post(`/api/rooms/${roomId}/chat`, { clientMessageId: 'm1', text: 'from host' }));
    guest.expectOk(await guest.post(`/api/rooms/${roomId}/chat`, { clientMessageId: 'm2', text: 'from guest' }));

    host.expectOk(
      await host.post(`/api/rooms/${roomId}/mutes`, { playerId: guest.playerId, muted: true }),
    );
    const hostPage = host.expectOk<ChatPageShape>(await host.get(`/api/rooms/${roomId}/chat`));
    expect(hostPage.messages.map((message) => message.text)).toEqual(['from host']);

    const guestPage = guest.expectOk<ChatPageShape>(await guest.get(`/api/rooms/${roomId}/chat`));
    expect(guestPage.messages.map((message) => message.text)).toEqual(['from host', 'from guest']);

    // A mute never removes the sender's seat.
    const room = host.expectOk<{ members: unknown[] }>(await host.get(`/api/rooms/${roomId}`));
    expect(room.members).toHaveLength(2);
  });

  it('refuses chat access to non-members', async () => {
    const { roomId } = await lobbyWithTwo();
    const outsider = await harness.client('ChatOutsider');
    outsider.expectError(await outsider.get(`/api/rooms/${roomId}/chat`), 'E_NOT_A_MEMBER');
    outsider.expectError(
      await outsider.post(`/api/rooms/${roomId}/chat`, { clientMessageId: 'o1', text: 'hi' }),
      'E_NOT_A_MEMBER',
    );
  });

  it('does not expose an earlier game history to a new membership epoch', async () => {
    const { clients, roomId } = await startedGame(harness, 3);
    const host = clients[0]!;
    host.expectOk(
      await host.post(`/api/rooms/${roomId}/chat`, { clientMessageId: 'old', text: 'pre-start chat' }),
    );
    // Simulate the next game in the same room: the epoch changes.
    const room = await harness.service.repo.findRoom(roomId);
    await harness.service.repo.updateRoom(roomId, { game_id: 'game_next_epoch' });
    void room;
    const page = host.expectOk<ChatPageShape>(await host.get(`/api/rooms/${roomId}/chat`));
    expect(page.messages).toHaveLength(0);
  });

  it('paginates history with the after cursor', async () => {
    const { host, roomId } = await lobbyWithTwo();
    for (let i = 0; i < 5; i++) {
      host.expectOk(
        await host.post(`/api/rooms/${roomId}/chat`, { clientMessageId: `p${i}`, text: `msg ${i}` }),
      );
    }
    const firstPage = host.expectOk<ChatPageShape>(
      await host.get(`/api/rooms/${roomId}/chat?limit=2`),
    );
    expect(firstPage.messages).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    const secondPage = host.expectOk<ChatPageShape>(
      await host.get(`/api/rooms/${roomId}/chat?after=${firstPage.nextSeq}&limit=10`),
    );
    expect(secondPage.messages.map((message) => message.text)).toEqual(['msg 2', 'msg 3', 'msg 4']);
    expect(secondPage.hasMore).toBe(false);
  });
});
