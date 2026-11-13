/**
 * 關機順序：WebSocket 斷線後的清理（unregister）要在資料庫關閉前完成。
 * 回歸 #115：清理仍在等待時 PostgreSQL pool 先 end，產生
 * `Cannot use a pool after calling end on the pool` 的 unhandled rejection。
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

async function lobbyWithSubscriber(): Promise<{
  harness: TestHarness;
  roomId: string;
  playerId: string;
  socket: WebSocket;
  closed: Promise<void>;
}> {
  const harness = await startHarness();
  harnesses.push(harness);
  const host: TestClient = await harness.client('Host');
  const room = host.expectOk<{ id: string }>(
    await host.post('/api/rooms', {
      visibility: 'private',
      capacity: 3,
      profileId: 'base-2025',
      setupMode: 'fixed',
      orderMode: 'join',
    }),
  );
  const socket = new WebSocket(`${harness.base.replace('http', 'ws')}/ws`, { headers: { cookie: host.cookie! } });
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
  socket.send(JSON.stringify({ type: 'subscribe', payload: { roomId: room.id } }));
  await vi.waitFor(() => expect(rooms.length).toBeGreaterThan(0));
  const membership = await harness.service.repo.findMembership(room.id, host.playerId!);
  expect(membership?.connected).toBe(1);
  return { harness, roomId: room.id, playerId: host.playerId!, socket, closed };
}

/** 服務重啟後讀取座位的連線旗標；原服務的資料庫在關閉後不能再讀。 */
async function connectedAfterRestart(harness: TestHarness, roomId: string, playerId: string): Promise<number | undefined> {
  const again = await restartService(harness);
  try {
    return (await again.repo.findMembership(roomId, playerId))?.connected;
  } finally {
    await again.close();
  }
}

describe('shutdown drains in-flight connection cleanup', () => {
  it('waits for a held unregister before closing the database', async () => {
    const { harness, roomId, playerId, socket, closed } = await lobbyWithSubscriber();

    // 把斷線清理固定在「已開始、尚未寫入」：模擬資料庫變慢（兩種資料庫都一樣）。
    const repo = harness.service.repo;
    const original = repo.findRoom.bind(repo);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    repo.findRoom = async (id) => {
      if (!held) {
        held = true;
        await gate;
      }
      return original(id);
    };

    socket.close();
    await closed;
    await vi.waitFor(() => expect(held).toBe(true));

    let settled = false;
    const closing = harness.service.close().then(() => {
      settled = true;
    });
    await sleep(200);
    // 清理還沒結束，關機不能先走完。
    expect(settled).toBe(false);

    release();
    await closing;
    await sleep(50);
    expect(rejections).toEqual([]);
    expect(await connectedAfterRestart(harness, roomId, playerId)).toBe(0);
  });

  it('persists the disconnect of sockets that are still open at shutdown', async () => {
    const { harness, roomId, playerId, closed } = await lobbyWithSubscriber();

    // 不先關 socket：關機本身會以 1001 關掉它，清理由伺服器端的 close 事件觸發。
    await harness.service.close();
    await closed;
    await sleep(50);
    expect(rejections).toEqual([]);
    expect(await connectedAfterRestart(harness, roomId, playerId)).toBe(0);
  });
});
