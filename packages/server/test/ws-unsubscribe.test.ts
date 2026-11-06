/** WebSocket 取消訂閱：沒有 roomId 的 subscribe 讓連線離開房間（§4.6、§4.8）。 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '@catan/protocol';
import { runSetupOverApi, startHarness, startedGame, type TestClient, type TestHarness } from './helpers.ts';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface Feed {
  messages: ServerMessage[];
  subscribe(roomId: string): void;
  unsubscribe(payload?: Record<string, never>): void;
  close(): Promise<void>;
}

/** 開一條真實 socket，不自動訂閱。 */
async function openSocket(client: TestClient): Promise<Feed> {
  const socket = new WebSocket(`${harness.base.replace('http', 'ws')}/ws`, { headers: { cookie: client.cookie! } });
  const messages: ServerMessage[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  let closing: Promise<void> | null = null;
  return {
    messages,
    subscribe: (roomId) => socket.send(JSON.stringify({ type: 'subscribe', payload: { roomId } })),
    unsubscribe: (payload = {}) => socket.send(JSON.stringify({ type: 'subscribe', payload })),
    close: () =>
      (closing ??= new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
        socket.close();
      })),
  };
}

const live = (roomId: string): boolean => harness.service.rooms.hasLiveConnection(roomId);
const connected = async (roomId: string, playerId: string): Promise<number | undefined> =>
  (await harness.service.repo.findMembership(roomId, playerId))?.connected;
const roomMessages = (feed: Feed): ServerMessage[] => feed.messages.filter((message) => message.type === 'room');

async function table(): Promise<{ clients: TestClient[]; roomId: string; gameId: string }> {
  const game = await startedGame(harness, 3);
  await runSetupOverApi(game.clients, game.gameId);
  return game;
}

describe('WebSocket unsubscribe', () => {
  it('leaves the room, marks the seat disconnected and stops every push', async () => {
    const { clients, roomId } = await table();
    const [host, guest] = clients as [TestClient, TestClient];
    const guestFeed = await openSocket(guest);
    const hostFeed = await openSocket(host);
    try {
      guestFeed.subscribe(roomId);
      hostFeed.subscribe(roomId);
      await vi.waitFor(() => expect(roomMessages(guestFeed).length).toBeGreaterThan(0));
      await vi.waitFor(() => expect(roomMessages(hostFeed).length).toBeGreaterThan(0));
      expect(await connected(roomId, guest.playerId!)).toBe(1);

      guestFeed.unsubscribe();
      await vi.waitFor(async () => expect(await connected(roomId, guest.playerId!)).toBe(0));
      // 房裡還有房主的 socket：整房仍有 live 連線，guest 已經不在其中。
      expect(live(roomId)).toBe(true);
      expect(
        harness.service.rooms.connectionsInRoom(roomId).some((connection) => connection.playerId === guest.playerId),
      ).toBe(false);

      // 之後的房間推送、聊天與 snapshot 推送只送給還訂閱的人。
      const guestBefore = guestFeed.messages.length;
      const hostBefore = hostFeed.messages.length;
      harness.service.rooms.broadcastRoom(roomId);
      host.expectOk(await host.post(`/api/rooms/${roomId}/chat`, { clientMessageId: `c-${Date.now()}`, text: 'hi' }));
      await vi.waitFor(() => expect(hostFeed.messages.length).toBeGreaterThan(hostBefore));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(guestFeed.messages.length).toBe(guestBefore);
    } finally {
      await guestFeed.close();
      await hostFeed.close();
    }
  });

  it('makes the room idle when the last socket unsubscribes, and resubscribing restores it', async () => {
    const { clients, roomId } = await table();
    const guest = clients[1]!;
    const feed = await openSocket(guest);
    try {
      feed.subscribe(roomId);
      await vi.waitFor(() => expect(live(roomId)).toBe(true));
      expect(await connected(roomId, guest.playerId!)).toBe(1);

      feed.unsubscribe();
      await vi.waitFor(() => expect(live(roomId)).toBe(false));
      expect(await connected(roomId, guest.playerId!)).toBe(0);

      const before = roomMessages(feed).length;
      feed.subscribe(roomId);
      await vi.waitFor(() => expect(live(roomId)).toBe(true));
      await vi.waitFor(() => expect(roomMessages(feed).length).toBeGreaterThan(before));
      expect(await connected(roomId, guest.playerId!)).toBe(1);
    } finally {
      await feed.close();
    }
  });

  it('is idempotent and keeps the socket usable', async () => {
    const { clients, roomId } = await table();
    const guest = clients[1]!;
    const feed = await openSocket(guest);
    try {
      // 沒訂閱就取消、取消兩次、不帶 payload，都不報錯。
      feed.unsubscribe();
      feed.unsubscribe();
      feed.subscribe(roomId);
      await vi.waitFor(() => expect(live(roomId)).toBe(true));
      feed.unsubscribe();
      feed.unsubscribe();
      await vi.waitFor(() => expect(live(roomId)).toBe(false));
      expect(feed.messages.some((message) => message.type === 'error')).toBe(false);
    } finally {
      await feed.close();
    }
  });

  it('keeps the seat connected while another tab of the same person is subscribed', async () => {
    const { clients, roomId } = await table();
    const guest = clients[1]!;
    const first = await openSocket(guest);
    const second = await openSocket(guest);
    try {
      first.subscribe(roomId);
      second.subscribe(roomId);
      await vi.waitFor(() => expect(harness.service.rooms.connectionsInRoom(roomId)).toHaveLength(2));
      first.unsubscribe();
      await vi.waitFor(() => expect(harness.service.rooms.connectionsInRoom(roomId)).toHaveLength(1));
      expect(live(roomId)).toBe(true);
      expect(await connected(roomId, guest.playerId!)).toBe(1);
      second.unsubscribe();
      await vi.waitFor(() => expect(live(roomId)).toBe(false));
      expect(await connected(roomId, guest.playerId!)).toBe(0);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('applies an unsubscribe followed at once by a subscribe in order', async () => {
    const { clients, roomId } = await table();
    const guest = clients[1]!;
    const feed = await openSocket(guest);
    try {
      feed.subscribe(roomId);
      await vi.waitFor(() => expect(live(roomId)).toBe(true));
      const before = roomMessages(feed).length;
      feed.unsubscribe();
      feed.subscribe(roomId);
      // 兩個訊息不能交錯：最後一定是訂閱中，並收到新的 room 檢視。
      await vi.waitFor(() => expect(roomMessages(feed).length).toBeGreaterThan(before));
      expect(live(roomId)).toBe(true);
      expect(await connected(roomId, guest.playerId!)).toBe(1);
      expect(harness.service.rooms.connectionsInRoom(roomId)).toHaveLength(1);
    } finally {
      await feed.close();
    }
  });
});
