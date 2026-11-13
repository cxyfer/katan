/**
 * socket 在 subscribe 還沒做完時結束（自己斷線，或關機）。
 * 斷線清理若搶在 handler 指派 `connection.roomId` 之前執行，等於什麼都沒清；之後
 * 恢復的 handler 會把已關閉的連線登記進房間，座位永遠顯示在線（#175 review）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '@catan/protocol';
import { restartService, startHarness, type TestClient, type TestHarness } from './helpers.ts';

const rejections: unknown[] = [];
const onRejection = (reason: unknown): void => {
  rejections.push(reason);
};
process.on('unhandledRejection', onRejection);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const harnesses: TestHarness[] = [];
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
  rejections.length = 0;
});

interface Feed {
  socket: WebSocket;
  rooms: ServerMessage[];
  closed: Promise<void>;
}

async function openSocket(harness: TestHarness, client: TestClient): Promise<Feed> {
  const socket = new WebSocket(`${harness.base.replace('http', 'ws')}/ws`, { headers: { cookie: client.cookie! } });
  const rooms: ServerMessage[] = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    if (message.type === 'room') rooms.push(message);
  });
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return { socket, rooms, closed };
}

const subscribe = (feed: Feed, roomId: string): void =>
  feed.socket.send(JSON.stringify({ type: 'subscribe', payload: { roomId } }));

/** 房主進房後連線再斷開：座位已寫成離線，之後沒有任何登記中的連線。 */
async function lobbyWithOfflineHost(): Promise<{
  harness: TestHarness;
  host: TestClient;
  roomId: string;
  playerId: string;
}> {
  const harness = await startHarness();
  harnesses.push(harness);
  const host = await harness.client('Host');
  const room = host.expectOk<{ id: string }>(
    await host.post('/api/rooms', {
      visibility: 'private',
      capacity: 3,
      profileId: 'base-2025',
      setupMode: 'fixed',
      orderMode: 'join',
    }),
  );
  const first = await openSocket(harness, host);
  subscribe(first, room.id);
  await vi.waitFor(() => expect(first.rooms.length).toBeGreaterThan(0));
  first.socket.close();
  await first.closed;
  const playerId = host.playerId!;
  await vi.waitFor(async () =>
    expect((await harness.service.repo.findMembership(room.id, playerId))?.connected).toBe(0),
  );
  return { harness, host, roomId: room.id, playerId };
}

type HoldPoint = 'requireMembership' | 'registerConnection';

/**
 * 讓第二條 socket 的 subscribe 停在指定步驟，直到 release：
 * `requireMembership` 時 handler 還沒指派 `connection.roomId`；
 * `registerConnection` 時 roomId 已指派、但連線還沒進 registry。
 */
function holdNext(harness: TestHarness, point: HoldPoint): { isHeld(): boolean; release(): void } {
  const rooms = harness.service.rooms;
  const original = rooms[point].bind(rooms) as (...args: unknown[]) => Promise<unknown>;
  let held = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  (rooms as unknown as Record<HoldPoint, (...args: unknown[]) => Promise<unknown>>)[point] = async (...args) => {
    if (!held) {
      held = true;
      await gate;
    }
    return original(...args);
  };
  return { isHeld: () => held, release };
}

async function connectedAfterRestart(harness: TestHarness, roomId: string, playerId: string): Promise<number | undefined> {
  const again = await restartService(harness);
  try {
    return (await again.repo.findMembership(roomId, playerId))?.connected;
  } finally {
    await again.close();
  }
}

describe.each<HoldPoint>(['requireMembership', 'registerConnection'])('socket ends while subscribe waits in %s', (point) => {
  it('leaves no registration when the client disconnects first', async () => {
    const { harness, host, roomId, playerId } = await lobbyWithOfflineHost();
    const hold = holdNext(harness, point);

    const second = await openSocket(harness, host);
    subscribe(second, roomId);
    await vi.waitFor(() => expect(hold.isHeld()).toBe(true));
    second.socket.close();
    await second.closed;
    // 讓伺服器端的 close 事件先處理完，再放開停住的 subscribe。
    await sleep(100);
    hold.release();
    await sleep(200);

    expect(harness.service.rooms.connectionsInRoom(roomId)).toEqual([]);
    expect(harness.service.rooms.hasLiveConnection(roomId)).toBe(false);
    expect((await harness.service.repo.findMembership(roomId, playerId))?.connected).toBe(0);
    expect(rejections).toEqual([]);
  });

  it('shutdown with a subscribe still in flight persists the seat as disconnected', async () => {
    const { harness, host, roomId, playerId } = await lobbyWithOfflineHost();
    const hold = holdNext(harness, point);

    const second = await openSocket(harness, host);
    subscribe(second, roomId);
    await vi.waitFor(() => expect(hold.isHeld()).toBe(true));

    // socket 仍開著：關機以 1001 關閉它；進行中的 subscribe 要先做完，之後資料庫才關。
    let settled = false;
    const closing = harness.service.close().then(() => {
      settled = true;
    });
    await second.closed;
    await sleep(200);
    expect(settled).toBe(false);

    hold.release();
    await closing;
    await sleep(50);
    expect(rejections).toEqual([]);
    expect(await connectedAfterRestart(harness, roomId, playerId)).toBe(0);
  });
});
