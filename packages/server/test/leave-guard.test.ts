/**
 * 遲到的 `/leave` 不得變更已重新進入的房間：同一身分在房內仍有 live 訂閱連線時，
 * `leave` 回 `left: false` 且不做任何變更；刻意離開的 client 先取消訂閱並等
 * `unsubscribed` 確認，再送 HTTP `/leave`。
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { LeaveRoomResult, RoomView, ServerMessage } from '@catan/protocol';
import type { Connection } from '../src/rooms.ts';
import { runSetupOverApi, startHarness, startedGame, type TestClient, type TestHarness } from './helpers.ts';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface Tab {
  messages: ServerMessage[];
  subscribe(roomId: string): Promise<void>;
  /** 送出取消訂閱並等到 `unsubscribed`，回傳它的 roomId。 */
  unsubscribe(): Promise<string | null>;
  close(): Promise<void>;
}

const unsubscribedCount = (tab: Tab): number => tab.messages.filter((m) => m.type === 'unsubscribed').length;

/** 一個瀏覽器分頁：一條真實 socket。 */
async function openTab(client: TestClient): Promise<Tab> {
  const socket = new WebSocket(`${harness.base.replace('http', 'ws')}/ws`, { headers: { cookie: client.cookie! } });
  const messages: ServerMessage[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  let closing: Promise<void> | null = null;
  const tab: Tab = {
    messages,
    async subscribe(roomId) {
      const rooms = () => messages.filter((m) => m.type === 'room').length;
      const before = rooms();
      socket.send(JSON.stringify({ type: 'subscribe', payload: { roomId } }));
      await vi.waitFor(() => expect(rooms()).toBeGreaterThan(before));
    },
    async unsubscribe() {
      const before = unsubscribedCount(tab);
      socket.send(JSON.stringify({ type: 'subscribe', payload: {} }));
      await vi.waitFor(() => expect(unsubscribedCount(tab)).toBeGreaterThan(before));
      const ack = messages.filter((m) => m.type === 'unsubscribed').at(-1);
      return ack?.type === 'unsubscribed' ? ack.payload.roomId : null;
    },
    close: () =>
      (closing ??= new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
        socket.close();
      })),
  };
  return tab;
}

const leave = async (client: TestClient, roomId: string): Promise<LeaveRoomResult> =>
  client.expectOk<LeaveRoomResult>(await client.post(`/api/rooms/${roomId}/leave`));

async function lobby(): Promise<{ host: TestClient; guest: TestClient; roomId: string }> {
  const host = await harness.client('LobbyHost');
  const guest = await harness.client('LobbyGuest');
  const room = host.expectOk<RoomView>(
    await host.post('/api/rooms', { visibility: 'private', capacity: 3, profileId: 'base-2025', setupMode: 'fixed' }),
  );
  guest.expectOk(await guest.post('/api/rooms/join', { code: room.code }));
  return { host, guest, roomId: room.id };
}

async function playing(): Promise<{ clients: TestClient[]; roomId: string }> {
  const game = await startedGame(harness, 3);
  await runSetupOverApi(game.clients, game.gameId);
  return { clients: game.clients, roomId: game.roomId };
}

const membership = (roomId: string, playerId: string) => harness.service.repo.findMembership(roomId, playerId);
const hostOf = async (roomId: string): Promise<string> => (await harness.service.repo.findRoom(roomId))!.host_id;

describe('leave while the player is still subscribed', () => {
  it('ignores the leave in a lobby', async () => {
    const { host, guest, roomId } = await lobby();
    const tab = await openTab(guest);
    try {
      await tab.subscribe(roomId);
      expect(await leave(guest, roomId)).toEqual({ left: false, hostTransferredTo: null });
      expect(await membership(roomId, guest.playerId!)).not.toBeNull();
      expect((await host.get<RoomView>(`/api/rooms/${roomId}`)).body.ok).toBe(true);
    } finally {
      await tab.close();
    }
  });

  it('ignores the leave in a game: still connected, host kept', async () => {
    const { clients, roomId } = await playing();
    const host = clients[0]!;
    const tab = await openTab(host);
    try {
      await tab.subscribe(roomId);
      expect(await leave(host, roomId)).toEqual({ left: false, hostTransferredTo: null });
      expect((await membership(roomId, host.playerId!))?.connected).toBe(1);
      expect(await hostOf(roomId)).toBe(host.playerId);
    } finally {
      await tab.close();
    }
  });

  it('takes effect for a plain HTTP caller with no socket', async () => {
    const { clients, roomId } = await playing();
    expect(await leave(clients[2]!, roomId)).toEqual({ left: true, hostTransferredTo: null });
    expect((await membership(roomId, clients[2]!.playerId!))?.connected).toBe(0);
  });
});

describe('leave after unsubscribing and receiving the ack', () => {
  it('removes the lobby membership', async () => {
    const { guest, roomId } = await lobby();
    const tab = await openTab(guest);
    try {
      await tab.subscribe(roomId);
      expect(await tab.unsubscribe()).toBe(roomId);
      expect(await leave(guest, roomId)).toEqual({ left: true, hostTransferredTo: null });
      expect(await membership(roomId, guest.playerId!)).toBeNull();
    } finally {
      await tab.close();
    }
  });

  it('marks the player offline in a game and hands the host role on', async () => {
    const { clients, roomId } = await playing();
    const [host, second] = clients as [TestClient, TestClient];
    const tab = await openTab(host);
    try {
      await tab.subscribe(roomId);
      expect(await tab.unsubscribe()).toBe(roomId);
      const result = await leave(host, roomId);
      expect(result.left).toBe(true);
      expect(result.hostTransferredTo).toBe(second.playerId);
      expect(await hostOf(roomId)).toBe(second.playerId);
      expect((await membership(roomId, host.playerId!))?.connected).toBe(0);
    } finally {
      await tab.close();
    }
  });
});

describe('a late leave after the player came back', () => {
  it('changes nothing in a lobby', async () => {
    const { host, guest, roomId } = await lobby();
    const tab = await openTab(host);
    try {
      await tab.subscribe(roomId);
      await tab.unsubscribe();
      // 之後 client 重新進入同一房間；此時遲到的 /leave 才到 server。
      await tab.subscribe(roomId);
      expect(await leave(host, roomId)).toEqual({ left: false, hostTransferredTo: null });
      expect(await membership(roomId, host.playerId!)).not.toBeNull();
      expect(await membership(roomId, guest.playerId!)).not.toBeNull();
      expect(await hostOf(roomId)).toBe(host.playerId);
      expect((await harness.service.repo.findRoom(roomId))?.status).toBe('lobby');
    } finally {
      await tab.close();
    }
  });

  it('changes nothing in a game', async () => {
    const { clients, roomId } = await playing();
    const host = clients[0]!;
    const tab = await openTab(host);
    try {
      await tab.subscribe(roomId);
      await tab.unsubscribe();
      await tab.subscribe(roomId);
      expect(await leave(host, roomId)).toEqual({ left: false, hostTransferredTo: null });
      expect((await membership(roomId, host.playerId!))?.connected).toBe(1);
      expect(await hostOf(roomId)).toBe(host.playerId);
    } finally {
      await tab.close();
    }
  });
});

describe('several tabs of one person', () => {
  it('only counts once every tab has left the room', async () => {
    const { clients, roomId } = await playing();
    const host = clients[0]!;
    const first = await openTab(host);
    const second = await openTab(host);
    try {
      await first.subscribe(roomId);
      await second.subscribe(roomId);
      await first.unsubscribe();
      expect(await leave(host, roomId)).toEqual({ left: false, hostTransferredTo: null });
      expect((await membership(roomId, host.playerId!))?.connected).toBe(1);

      await second.unsubscribe();
      const result = await leave(host, roomId);
      expect(result.left).toBe(true);
      expect((await membership(roomId, host.playerId!))?.connected).toBe(0);
    } finally {
      await first.close();
      await second.close();
    }
  });
});

describe('unsubscribed acknowledgement', () => {
  it('answers with a null roomId when nothing was subscribed, and is repeatable', async () => {
    const { clients } = await playing();
    const tab = await openTab(clients[1]!);
    try {
      expect(await tab.unsubscribe()).toBeNull();
      expect(await tab.unsubscribe()).toBeNull();
      expect(tab.messages.some((message) => message.type === 'error')).toBe(false);
    } finally {
      await tab.close();
    }
  });

  it('names the room that was left, then null for the repeat', async () => {
    const { clients, roomId } = await playing();
    const tab = await openTab(clients[1]!);
    try {
      await tab.subscribe(roomId);
      expect(await tab.unsubscribe()).toBe(roomId);
      expect(await tab.unsubscribe()).toBeNull();
    } finally {
      await tab.close();
    }
  });

  it('arrives only after the connection has left the room', async () => {
    const { clients, roomId } = await playing();
    const tab = await openTab(clients[1]!);
    try {
      await tab.subscribe(roomId);
      expect(harness.service.rooms.hasLiveConnection(roomId)).toBe(true);
      await tab.unsubscribe();
      // 收到確認的那一刻，連線已移出房間、座位已標離線。
      expect(harness.service.rooms.hasLiveConnection(roomId)).toBe(false);
      expect((await membership(roomId, clients[1]!.playerId!))?.connected).toBe(0);
    } finally {
      await tab.close();
    }
  });
});

describe('leave is serialised with connection registration', () => {
  it('queues a registering connection behind a leave that is already changing state', async () => {
    const { clients, roomId } = await playing();
    const guest = clients[2]!;

    // 讓 leave 在「已確認沒有連線、正要標離線」時停住，再讓新連線進來。
    const repo = harness.service.repo;
    const original = repo.updateMembership.bind(repo);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => (entered = resolve));
    const spy = vi.spyOn(repo, 'updateMembership').mockImplementation(async (room, player, patch) => {
      if (player === guest.playerId && patch.connected === 0) {
        entered();
        await gate;
      }
      return original(room, player, patch);
    });
    const connection: Connection = { id: randomUUID(), playerId: guest.playerId!, roomId, send() {}, close() {} };
    try {
      const leaving = guest.post<LeaveRoomResult>(`/api/rooms/${roomId}/leave`);
      await reached;

      const registering = harness.service.rooms.registerConnection(connection);
      await new Promise((resolve) => setTimeout(resolve, 150));
      // 同一把鎖：leave 還沒做完，新連線不能已經登記。
      expect(harness.service.rooms.hasLiveConnection(roomId)).toBe(false);

      release();
      const response = await leaving;
      expect(guest.expectOk(response)).toEqual({ left: true, hostTransferredTo: null });
      await registering;
      // leave 先完成，之後連線才登記並把座位標回在線；不會被 leave 的離線標記蓋掉。
      expect(harness.service.rooms.hasLiveConnection(roomId)).toBe(true);
      expect((await membership(roomId, guest.playerId!))?.connected).toBe(1);
    } finally {
      release();
      spy.mockRestore();
      await harness.service.rooms.unregisterConnection(connection);
    }
  });

  it('queues a leave behind a connection that is registering', async () => {
    const { clients, roomId } = await playing();
    const guest = clients[2]!;
    const repo = harness.service.repo;
    const original = repo.updateMembership.bind(repo);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => (entered = resolve));
    const spy = vi.spyOn(repo, 'updateMembership').mockImplementation(async (room, player, patch) => {
      if (player === guest.playerId && patch.connected === 1) {
        entered();
        await gate;
      }
      return original(room, player, patch);
    });
    const connection: Connection = { id: randomUUID(), playerId: guest.playerId!, roomId, send() {}, close() {} };
    try {
      const registering = harness.service.rooms.registerConnection(connection);
      await reached;
      const leaving = guest.post<LeaveRoomResult>(`/api/rooms/${roomId}/leave`);
      let answered = false;
      void leaving.then(() => (answered = true));
      await new Promise((resolve) => setTimeout(resolve, 150));
      // 登記還沒做完時，leave 要排在同一把鎖後面，不能先回答。
      expect(answered).toBe(false);
      release();
      await registering;
      expect(guest.expectOk(await leaving)).toEqual({ left: false, hostTransferredTo: null });
      expect((await membership(roomId, guest.playerId!))?.connected).toBe(1);
    } finally {
      release();
      spy.mockRestore();
      await harness.service.rooms.unregisterConnection(connection);
    }
  });
});
