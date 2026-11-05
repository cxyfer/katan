/**
 * §4.6 operator retention: unfinished games idle beyond `GAME_RETENTION_DAYS`
 * are ended without a winner. Runs against SQLite by default and against
 * PostgreSQL when TEST_POSTGRES_URL is exported (the harness switches dialect).
 */

import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { GameState } from '@catan/rules';
import type { GameSnapshot, RoomView, ServerMessage } from '@catan/protocol';
import { loadConfig } from '../src/config.ts';
import { startService, type Logger } from '../src/main.ts';
import { runSetupOverApi, startHarness, startedGame, type TestHarness } from './helpers.ts';

const DAY_MS = 86_400_000;
const daysAgo = (days: number): string => new Date(Date.now() - days * DAY_MS).toISOString();

interface LogEntry {
  level: string;
  message: string;
  meta: Record<string, unknown> | undefined;
}

function capturingLogger(entries: LogEntry[]): Logger {
  return (level, message, meta) => {
    entries.push({ level, message, meta: meta as Record<string, unknown> | undefined });
  };
}

/** 把一局的三個活動時間戳設成指定的「幾天前」；未指定者沿用 `base`。 */
async function backdate(
  harness: TestHarness,
  roomId: string,
  gameId: string,
  base: number,
  signals: { game?: number; room?: number; seen?: number } = {},
): Promise<void> {
  const { db } = harness.service.repo;
  await db.run('UPDATE games SET updated_at = ? WHERE id = ?', [daysAgo(signals.game ?? base), gameId]);
  await db.run('UPDATE rooms SET updated_at = ? WHERE id = ?', [daysAgo(signals.room ?? base), roomId]);
  await db.run('UPDATE memberships SET last_seen_at = ? WHERE room_id = ?', [
    daysAgo(signals.seen ?? base),
    roomId,
  ]);
}

async function suspendTable(harness: TestHarness, count: number) {
  const table = await startedGame(harness, count);
  const [host, ...others] = table.clients;
  const proposal = host!.expectOk<{ proposalId: string }>(
    await host!.post(`/api/games/${table.gameId}/suspend`, {}),
  );
  for (const client of others) {
    await client.post(`/api/games/${table.gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });
  }
  expect((await harness.service.repo.findRoom(table.roomId))?.status).toBe('suspended');
  return table;
}

describe('GAME_RETENTION_DAYS parsing', () => {
  it('is disabled unless an integer day count in range is given', () => {
    expect(loadConfig({}).gameRetentionDays).toBe(0);
    expect(loadConfig({ GAME_RETENTION_DAYS: '' }).gameRetentionDays).toBe(0);
    expect(loadConfig({ GAME_RETENTION_DAYS: '0' }).gameRetentionDays).toBe(0);
    expect(loadConfig({ GAME_RETENTION_DAYS: '30' }).gameRetentionDays).toBe(30);
    expect(loadConfig({ GAME_RETENTION_DAYS: '3650' }).gameRetentionDays).toBe(3650);
    // 非法值一律停用，不會因為誤設而提早終止對局。
    for (const bad of ['-1', '1.5', '0.5', 'abc', '7d', '3651', 'NaN', 'Infinity']) {
      expect(loadConfig({ GAME_RETENTION_DAYS: bad }).gameRetentionDays, bad).toBe(0);
    }
  });

  it('keeps the sweep interval at one second or more', () => {
    expect(loadConfig({}).gameRetentionSweepIntervalMs).toBe(600_000);
    expect(loadConfig({ GAME_RETENTION_SWEEP_INTERVAL_MS: '5' }).gameRetentionSweepIntervalMs).toBe(1_000);
    expect(loadConfig({ GAME_RETENTION_SWEEP_INTERVAL_MS: '30000' }).gameRetentionSweepIntervalMs).toBe(30_000);
  });
});

describe('retention disabled (default)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await startHarness({ gameRetentionDays: 0 });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('never ends a game, however long it has been idle', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await backdate(harness, roomId, gameId, 3000);
    const result = await harness.service.games.expireIdleGames();
    expect(result).toEqual({ expired: [], failed: [], full: false });
    expect((await harness.service.repo.findRoom(roomId))?.status).toBe('playing');
    expect((await harness.service.repo.findGame(gameId))?.status).toBe('playing');
    const config = clients[0]!.expectOk<{ retention: { gameRetentionDays: number } }>(
      await clients[0]!.get('/api/config'),
    );
    expect(config.retention.gameRetentionDays).toBe(0);
  });
});

describe('retention enabled (7 days)', () => {
  let harness: TestHarness;
  const logs: LogEntry[] = [];

  beforeAll(async () => {
    harness = await startHarness({ gameRetentionDays: 7 }, { log: capturingLogger(logs) });
  });

  afterAll(async () => {
    await harness.close();
  });

  // 保留掃描是全域的：每個案例開始前，先讓先前案例留下的對局退出候選。
  beforeEach(async () => {
    logs.length = 0;
    const { db } = harness.service.repo;
    await db.run(`UPDATE games SET status = 'completed' WHERE status IN ('playing', 'suspended')`);
    await db.run(`UPDATE rooms SET status = 'completed' WHERE status IN ('playing', 'suspended')`);
  });

  it('exposes the retention window on /api/config for disclosure', async () => {
    const client = await harness.client('Disclosure');
    const config = client.expectOk<{ retention: { gameRetentionDays: number } }>(await client.get('/api/config'));
    expect(config.retention.gameRetentionDays).toBe(7);
  });

  it('ends an idle in-progress game without a winner and logs it', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const host = clients[0]!;
    const before = host.expectOk<{ revision: number }>(await host.get(`/api/games/${gameId}`));
    // 最新的時間戳（房間 8 天前）才是最後活動時間。
    await backdate(harness, roomId, gameId, 8, { game: 10, room: 8, seen: 9 });
    const latest = (await harness.service.repo.findRoom(roomId))!.updated_at;

    const result = await harness.service.games.expireIdleGames();
    expect(result.expired).toEqual([gameId]);
    expect(result.failed).toEqual([]);

    expect((await harness.service.repo.findRoom(roomId))?.status).toBe('abandoned');
    const row = await harness.service.repo.findGame(gameId);
    expect(row?.status).toBe('abandoned');
    expect(row?.revision).toBe(before.revision + 1);

    const snapshot = host.expectOk<{
      revision: number;
      view: { result: { playerId: string | null; reason: string } | null };
    }>(await host.get(`/api/games/${gameId}`));
    expect(snapshot.view.result?.playerId).toBeNull();
    expect(snapshot.view.result?.reason).toBe('expired');

    const events = await harness.service.repo.listEvents(gameId, 0, 1000);
    expect(events.at(-1)).toMatchObject({ type: 'game.abandoned', params: { reason: 'expired' } });

    host.expectError(
      await host.post(`/api/games/${gameId}/commands`, {
        commandId: 'after-expiry',
        expectedRevision: snapshot.revision,
        command: { type: 'turn.roll' },
      }),
      'E_GAME_OVER',
    );
    const resumable = host.expectOk<{ games: { gameId: string }[] }>(await host.get('/api/games'));
    expect(resumable.games.map((game) => game.gameId)).not.toContain(gameId);

    const entry = logs.find((log) => log.message === 'game expired by retention policy');
    expect(entry?.level).toBe('info');
    expect(entry?.meta).toMatchObject({ gameId, roomId, lastActivityAt: latest, retentionDays: 7 });
  });

  it('ends an idle suspended game', async () => {
    const { gameId, roomId } = await suspendTable(harness, 3);
    await backdate(harness, roomId, gameId, 8);
    const result = await harness.service.games.expireIdleGames();
    expect(result.expired).toEqual([gameId]);
    expect((await harness.service.repo.findRoom(roomId))?.status).toBe('abandoned');
    expect((await harness.service.repo.findGame(gameId))?.status).toBe('abandoned');
  });

  it('ends an interrupted game whose players have all left', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    for (const client of clients) {
      await harness.service.repo.updateMembership(roomId, client.playerId!, {
        connected: 0,
        disconnected_at: daysAgo(8),
      });
    }
    await backdate(harness, roomId, gameId, 8);
    const result = await harness.service.games.expireIdleGames();
    expect(result.expired).toEqual([gameId]);
  });

  it('keeps a game inside the window', async () => {
    const { gameId, roomId } = await startedGame(harness, 3);
    await backdate(harness, roomId, gameId, 6);
    const result = await harness.service.games.expireIdleGames();
    expect(result.expired).toEqual([]);
    expect((await harness.service.repo.findRoom(roomId))?.status).toBe('playing');
    expect((await harness.service.repo.findGame(gameId))?.status).toBe('playing');
  });

  it.each([
    ['a recent committed write', { game: 2 }],
    ['a recent room change', { room: 2 }],
    ['a recent player visit', { seen: 2 }],
  ] as const)('keeps a game with %s', async (_label, signal) => {
    const { gameId, roomId } = await startedGame(harness, 3);
    await backdate(harness, roomId, gameId, 30, signal);
    const result = await harness.service.games.expireIdleGames();
    expect(result.expired).toEqual([]);
    expect((await harness.service.repo.findGame(gameId))?.status).toBe('playing');
  });

  it('leaves finished games and their records untouched', async () => {
    const { gameId, roomId } = await startedGame(harness, 3);
    const { db } = harness.service.repo;
    await db.run(`UPDATE games SET status = 'completed' WHERE id = ?`, [gameId]);
    await db.run(`UPDATE rooms SET status = 'completed' WHERE id = ?`, [roomId]);
    await backdate(harness, roomId, gameId, 365);
    const before = await harness.service.repo.findGame(gameId);
    const result = await harness.service.games.expireIdleGames();
    expect(result.expired).toEqual([]);
    const after = await harness.service.repo.findGame(gameId);
    expect(after?.revision).toBe(before?.revision);
    expect(after?.state_json).toBe(before?.state_json);
    expect((await harness.service.repo.findRoom(roomId))?.status).toBe('completed');
  });

  it('lets a committed victory outrank the retention close', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    // 勝利已寫入對局狀態，但房間尚未來得及標成 completed 的瞬間。
    const row = (await harness.service.repo.findGame(gameId))!;
    const state = JSON.parse(row.state_json) as GameState;
    state.result = { playerId: state.players[0]!.id, reason: 'victory', atSeq: state.seq };
    await harness.service.repo.db.run('UPDATE games SET state_json = ? WHERE id = ?', [
      JSON.stringify(state),
      gameId,
    ]);
    await backdate(harness, roomId, gameId, 30);
    const result = await harness.service.games.expireIdleGames();
    expect(result.expired).toEqual([]);
    const after = await harness.service.repo.findGame(gameId);
    expect(after?.status).toBe('playing');
    expect(JSON.parse(after!.state_json).result.reason).toBe('victory');
  });

  it('does not touch lobbies, whatever their age', async () => {
    const host = await harness.client('LobbyHost');
    const room = host.expectOk<{ id: string }>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    await harness.service.repo.db.run('UPDATE rooms SET updated_at = ? WHERE id = ?', [daysAgo(400), room.id]);
    const result = await harness.service.games.expireIdleGames();
    expect(result.expired).toEqual([]);
    expect((await harness.service.repo.findRoom(room.id))?.status).toBe('lobby');
  });

  it('keeps a game that a command commits while the sweep is queued', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    const { revision, view } = await runSetupOverApi(clients, gameId);
    await backdate(harness, roomId, gameId, 30);
    const actor = clients.find((client) => client.playerId === view.turn.playerId)!;
    // 指令先取得這局的鎖；掃描排在後面，取得鎖後必須看到新的活動。
    const [receipt, result] = await Promise.all([
      harness.service.games.submit(actor.playerId!, gameId, {
        commandId: 'race-roll',
        expectedRevision: revision,
        command: { type: 'turn.roll' },
      } as never),
      harness.service.games.expireIdleGames(),
    ]);
    expect(receipt.outcome).toBe('accepted');
    expect(result.expired).toEqual([]);
    expect((await harness.service.repo.findGame(gameId))?.status).toBe('playing');
  });

  it('processes a bounded batch, oldest first', async () => {
    const tables: { gameId: string; roomId: string; age: number }[] = [];
    for (const age of [10, 30, 20]) {
      const table = await startedGame(harness, 3);
      await backdate(harness, table.roomId, table.gameId, age);
      tables.push({ gameId: table.gameId, roomId: table.roomId, age });
    }
    const idOf = (age: number) => tables.find((table) => table.age === age)!.gameId;

    const first = await harness.service.games.expireIdleGames(new Date(), 2);
    expect(first.expired).toEqual([idOf(30), idOf(20)]);
    expect(first.full).toBe(true);
    expect((await harness.service.repo.findGame(idOf(10)))?.status).toBe('playing');

    const second = await harness.service.games.expireIdleGames(new Date(), 2);
    expect(second.expired).toEqual([idOf(10)]);
    expect(second.full).toBe(false);
  });

  it('logs a failing game and keeps sweeping the rest', async () => {
    const broken = await startedGame(harness, 3);
    const healthy = await startedGame(harness, 3);
    // 最舊的一局狀態損毀；它先被處理，不能拖累後面的對局。
    await backdate(harness, broken.roomId, broken.gameId, 40);
    await backdate(harness, healthy.roomId, healthy.gameId, 20);
    await harness.service.repo.db.run('UPDATE games SET state_json = ? WHERE id = ?', [
      'not json',
      broken.gameId,
    ]);

    const result = await harness.service.games.expireIdleGames();
    expect(result.failed).toEqual([broken.gameId]);
    expect(result.expired).toEqual([healthy.gameId]);
    expect((await harness.service.repo.findGame(broken.gameId))?.status).toBe('playing');
    expect((await harness.service.repo.findGame(healthy.gameId))?.status).toBe('abandoned');
    const warning = logs.find((log) => log.message === 'game retention failed');
    expect(warning?.level).toBe('warn');
    expect(warning?.meta).toMatchObject({ gameId: broken.gameId });
  });

  it('tells a connected client the game ended and why', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const host = clients[0]!;
    const rooms: RoomView[] = [];
    const snapshots: GameSnapshot[] = [];
    const socket = new WebSocket(`${harness.base.replace('http', 'ws')}/ws`, {
      headers: { cookie: host.cookie! },
    });
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      if (message.type === 'room') rooms.push(message.payload);
      if (message.type === 'snapshot') snapshots.push(message.payload);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      socket.send(JSON.stringify({ type: 'subscribe', payload: { roomId } }));
      await vi.waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
      expect(harness.service.rooms.hasLiveConnection(roomId)).toBe(true);

      // 連線時間算活動，所以把連線時間也往前推，模擬一條開了很多天的閒置連線。
      await backdate(harness, roomId, gameId, 8);
      const result = await harness.service.games.expireIdleGames();
      expect(result.expired).toEqual([gameId]);

      await vi.waitFor(() => {
        expect(rooms.at(-1)?.status).toBe('abandoned');
        const last = snapshots.at(-1);
        expect(last?.view.result).toMatchObject({ playerId: null, reason: 'expired' });
        expect(last?.revision).toBeGreaterThan(snapshots[0]!.revision);
      });
    } finally {
      socket.close();
    }
  });
});

// 重啟後的啟動掃描與週期掃描需要同一份持久資料；PostgreSQL 模式的每個 harness
// 使用獨立 schema，沒有共用路徑可重啟，改由上面的案例覆蓋該資料庫。
describe.skipIf(!!process.env.TEST_POSTGRES_URL)('retention sweep scheduling', () => {
  it('sweeps at startup, again on the interval, and stops on shutdown', async () => {
    const first = await startHarness({ gameRetentionDays: 0 });
    const stale = await startedGame(first, 3);
    const recent = await startedGame(first, 3);
    await backdate(first, stale.roomId, stale.gameId, 20);
    await backdate(first, recent.roomId, recent.gameId, 1);
    await first.service.close();

    const logs: LogEntry[] = [];
    const sqlitePath = join(first.dataDir, 'test.sqlite');
    const second = await startService(
      { port: 0, host: '127.0.0.1', sqlitePath, gameRetentionDays: 7, gameRetentionSweepIntervalMs: 100 },
      capturingLogger(logs),
    );
    try {
      expect(logs.some((log) => log.message === 'game retention enabled')).toBe(true);
      // 啟動掃描：不必等第一個間隔，過期的那局就被終止。
      await vi.waitFor(async () => {
        expect((await second.repo.findGame(stale.gameId))?.status).toBe('abandoned');
      });
      expect((await second.repo.findGame(recent.gameId))?.status).toBe('playing');

      // 之後的週期掃描：服務執行中才變得閒置的對局也會被終止。
      await second.repo.db.run('UPDATE games SET updated_at = ? WHERE id = ?', [daysAgo(9), recent.gameId]);
      await second.repo.db.run('UPDATE rooms SET updated_at = ? WHERE id = ?', [daysAgo(9), recent.roomId]);
      await second.repo.db.run('UPDATE memberships SET last_seen_at = ? WHERE room_id = ?', [
        daysAgo(9),
        recent.roomId,
      ]);
      await vi.waitFor(async () => {
        expect((await second.repo.findGame(recent.gameId))?.status).toBe('abandoned');
      });
      const expired = logs.filter((log) => log.message === 'game expired by retention policy');
      expect(expired.map((log) => log.meta?.gameId).sort()).toEqual([recent.gameId, stale.gameId].sort());
    } finally {
      await second.close();
    }

    // 關閉後不再有任何掃描寫入或日誌。
    const settled = logs.length;
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(logs.length).toBe(settled);
  });

  it('schedules nothing when retention is disabled', async () => {
    const logs: LogEntry[] = [];
    const harness = await startHarness(
      { gameRetentionDays: 0, gameRetentionSweepIntervalMs: 50 },
      { log: capturingLogger(logs) },
    );
    try {
      const { gameId, roomId } = await startedGame(harness, 3);
      await backdate(harness, roomId, gameId, 3000);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect((await harness.service.repo.findGame(gameId))?.status).toBe('playing');
      expect(logs.some((log) => log.message.startsWith('game retention'))).toBe(false);
    } finally {
      await harness.close();
    }
  });
});
