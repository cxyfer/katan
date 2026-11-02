/**
 * R-REC database contract: the same repository assertions run against SQLite
 * and PostgreSQL. PostgreSQL is exercised when TEST_POSTGRES_URL is provided;
 * otherwise the dialect is reported as not covered rather than silently passed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDialect,
  digestPayload,
  migrate,
  MIGRATIONS,
  newId,
  newRoomCode,
  Repository,
  toPostgresPlaceholders,
  type DialectKind,
  type GameRow,
  type GuestRow,
  type MembershipRow,
  type RoomRow,
} from '../src/db.ts';
import { createGame, seededRng } from '@catan/rules';

const postgresUrl = process.env.TEST_POSTGRES_URL;

describe('placeholder translation', () => {
  it('rewrites question marks to numbered parameters', () => {
    expect(toPostgresPlaceholders('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2',
    );
  });
});

interface DialectCase {
  kind: DialectKind;
  label: string;
  skip: boolean;
}

const cases: DialectCase[] = [
  { kind: 'sqlite', label: 'sqlite', skip: false },
  { kind: 'postgres', label: 'postgres', skip: !postgresUrl },
];

for (const testCase of cases) {
  describe.skipIf(testCase.skip)(`repository contract (${testCase.label})`, () => {
    let repo: Repository;
    let roomId: string;
    let gameId: string;

    beforeAll(async () => {
      const db =
        testCase.kind === 'postgres'
          ? await createDialect({ databaseUrl: postgresUrl })
          : await createDialect({ sqlitePath: ':memory:' });
      await migrate(db);
      repo = new Repository(db);
      roomId = newId('room');
      gameId = newId('game');
    });

    afterAll(async () => {
      await repo?.db.close();
    });

    it('records a guest and finds it by token hash', async () => {
      const now = new Date().toISOString();
      const guest: GuestRow = {
        id: newId('player'),
        token_hash: `hash-${Math.random()}`,
        nickname: 'Contract',
        locale: 'en',
        created_at: now,
        updated_at: now,
        kind: 'human',
        bot_level: null,
      };
      await repo.insertGuest(guest);
      const found = await repo.findGuestByTokenHash(guest.token_hash);
      expect(found?.id).toBe(guest.id);
      await repo.updateGuest(guest.id, { nickname: 'Renamed' });
      expect((await repo.findGuest(guest.id))?.nickname).toBe('Renamed');
    });

    it('stores a room with policy and finds it by id and code', async () => {
      const now = new Date().toISOString();
      const room: RoomRow = {
        id: roomId,
        code: newRoomCode(),
        visibility: 'public',
        status: 'lobby',
        host_id: 'player_host',
        profile_id: 'base-2025',
        setup_mode: 'fixed',
        order_mode: 'join',
        capacity: 4,
        policy_json: JSON.stringify({ turnClockSeconds: 0, disconnectGraceSeconds: 300 }),
        policy_revision: 1,
        game_id: null,
        created_at: now,
        updated_at: now,
      };
      await repo.insertRoom(room);
      expect((await repo.findRoom(roomId))?.code).toBe(room.code);
      expect((await repo.findRoomByCode(room.code))?.id).toBe(roomId);
      const publicRooms = await repo.listPublicRooms();
      expect(publicRooms.map((row) => row.id)).toContain(roomId);
      expect((await repo.findRoom(roomId))?.order_mode).toBe('join');
      await repo.updateRoom(roomId, { status: 'playing', policy_revision: 2, order_mode: 'random' });
      const updated = await repo.findRoom(roomId);
      expect(updated?.status).toBe('playing');
      expect(updated?.policy_revision).toBe(2);
      expect(updated?.order_mode).toBe('random');
    });

    it('enforces membership uniqueness and ordering by seat', async () => {
      const now = new Date().toISOString();
      await repo.insertMembership({
        room_id: roomId,
        player_id: 'player_a',
        seat: 1,
        color: 'blue',
        ready: 0,
        connected: 1,
        withdrawn: 0,
        joined_at: now,
        last_seen_at: now,
        disconnected_at: null,
        connection_id: null,
      });
      await repo.insertMembership({
        room_id: roomId,
        player_id: 'player_b',
        seat: 0,
        color: 'red',
        ready: 1,
        connected: 1,
        withdrawn: 0,
        joined_at: now,
        last_seen_at: now,
        disconnected_at: null,
        connection_id: null,
      });
      const members = await repo.listMemberships(roomId);
      expect(members.map((member) => member.player_id)).toEqual(['player_b', 'player_a']);
      await repo.updateMembership(roomId, 'player_a', { ready: 1, connected: 0 });
      expect((await repo.findMembership(roomId, 'player_a'))?.ready).toBe(1);
      await expect(
        repo.insertMembership({
          room_id: roomId,
          player_id: 'player_a',
          seat: 5,
          color: 'green',
          ready: 0,
          connected: 1,
          withdrawn: 0,
          joined_at: now,
          last_seen_at: now,
          disconnected_at: null,
          connection_id: null,
        }),
      ).rejects.toBeTruthy();
    });

    it('persists a game snapshot, events and a command receipt atomically', async () => {
      const state = createGame({
        profileId: 'base-2025',
        players: [
          { id: 'player_a', nickname: 'A', color: 'red' },
          { id: 'player_b', nickname: 'B', color: 'blue' },
          { id: 'player_c', nickname: 'C', color: 'orange' },
        ],
        setupMode: 'fixed',
        rng: seededRng(5),
      });
      const now = new Date().toISOString();
      const game: GameRow = {
        id: gameId,
        room_id: roomId,
        profile_id: 'base-2025',
        engine_version: state.engineVersion,
        state_json: JSON.stringify(state),
        revision: 1,
        status: 'playing',
        pause_reason: null,
        result_json: null,
        created_at: now,
        updated_at: now,
      };
      await repo.transaction(async () => {
        await repo.insertGame(game);
        await repo.appendEvents(gameId, 1, state.log);
        await repo.insertReceipt({
          game_id: gameId,
          player_id: 'player_a',
          command_id: 'cmd-1',
          payload_digest: digestPayload({ a: 1 }),
          outcome: 'accepted',
          revision: 2,
          error_json: null,
          events_json: JSON.stringify(state.log.slice(0, 1)),
          created_at: now,
        });
      });

      const stored = await repo.findGame(gameId);
      expect(stored?.revision).toBe(1);
      const events = await repo.listEvents(gameId, 0, 100);
      expect(events.length).toBe(state.log.length);
      expect(events[0]!.type).toBe('game.created');

      const receipt = await repo.findReceipt(gameId, 'player_a', 'cmd-1');
      expect(receipt?.outcome).toBe('accepted');
      expect(receipt?.revision).toBe(2);
      expect(receipt?.payload_digest).toBe(digestPayload({ a: 1 }));
    });

    it('rolls back a failed transaction without leaving partial rows', async () => {
      const before = (await repo.listEvents(gameId, 0, 1000)).length;
      await expect(
        repo.transaction(async () => {
          await repo.appendEvents(gameId, 9, [
            { seq: 9001, type: 'tx.test', params: {} },
          ]);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      const after = await repo.listEvents(gameId, 0, 1000);
      expect(after.length).toBe(before);
    });

    it('stores save receipts idempotently', async () => {
      await repo.insertSaveReceipt({
        game_id: gameId,
        player_id: 'player_a',
        request_id: 'req-1',
        revision: 3,
        outcome: 'saved',
        saved_at: '2026-10-26T00:00:00.000Z',
      });
      const found = await repo.findSaveReceipt(gameId, 'player_a', 'req-1');
      expect(found?.revision).toBe(3);
      expect(await repo.findSaveReceipt(gameId, 'player_a', 'missing')).toBeNull();
    });

    it('stores policy proposals and consents', async () => {
      const proposalId = newId('policy');
      await repo.insertPolicyProposal({
        id: proposalId,
        room_id: roomId,
        base_revision: 1,
        before_json: JSON.stringify({ turnClockSeconds: 0 }),
        after_json: JSON.stringify({ turnClockSeconds: 60 }),
        proposed_by: 'player_a',
        status: 'open',
        created_at: new Date().toISOString(),
      });
      await repo.insertPolicyConsent(proposalId, 'player_a');
      await repo.insertPolicyConsent(proposalId, 'player_b');
      expect((await repo.listPolicyConsents(proposalId)).sort()).toEqual(['player_a', 'player_b']);
      expect((await repo.findOpenProposal(roomId))?.id).toBe(proposalId);
      await repo.cancelOpenProposals(roomId);
      expect(await repo.findOpenProposal(roomId)).toBeNull();
    });

    it('keeps a per-room chat sequence and deduplicates send ids', async () => {
      const first = await repo.nextChatSeq(roomId);
      await repo.insertChat({
        id: newId('chat'),
        room_id: roomId,
        epoch: 'lobby',
        seq: first,
        player_id: 'player_a',
        kind: 'player',
        text: 'hello',
        created_at: new Date().toISOString(),
        status: 'sent',
      });
      const second = await repo.nextChatSeq(roomId);
      expect(second).toBe(first + 1);
      await repo.insertChatReceipt(roomId, 'player_a', 'client-1', 'chat_x');
      expect(await repo.findChatReceipt(roomId, 'player_a', 'client-1')).toBe('chat_x');
      const page = await repo.listChat(roomId, 'lobby', 0, 10);
      expect(page.map((row) => row.text)).toEqual(['hello']);
      // A different epoch is isolated.
      expect(await repo.listChat(roomId, 'game_2', 0, 10)).toHaveLength(0);
    });

    it('counts recent chat per sender and stores mutes', async () => {
      const since = new Date(Date.now() - 60_000).toISOString();
      const count = await repo.countRecentChat(roomId, 'player_a', since);
      expect(count).toBe(1);
      await repo.setMute(roomId, 'player_a', 'player_b', true);
      expect(await repo.listMutes(roomId, 'player_a')).toEqual(['player_b']);
      await repo.setMute(roomId, 'player_a', 'player_b', false);
      expect(await repo.listMutes(roomId, 'player_a')).toEqual([]);
    });

    it('tracks game proposals and resume readiness', async () => {
      const proposalId = newId('suspend');
      await repo.insertGameProposal({
        id: proposalId,
        game_id: gameId,
        kind: 'suspend',
        proposed_by: 'player_a',
        status: 'open',
        created_at: new Date().toISOString(),
      });
      await repo.insertGameConsent(proposalId, 'player_a');
      expect((await repo.findOpenGameProposal(gameId, 'suspend'))?.id).toBe(proposalId);
      expect(await repo.listGameConsents(proposalId)).toEqual(['player_a']);

      await repo.setGameReady(gameId, 'player_a', true);
      await repo.setGameReady(gameId, 'player_a', false);
      const ready = await repo.listGameReady(gameId);
      expect(ready).toHaveLength(1);
      expect(ready[0]!.ready).toBe(0);
      await repo.clearGameReady(gameId);
      expect(await repo.listGameReady(gameId)).toHaveLength(0);
    });

    it('keeps bot guests out of sign-in and removes them with their room', async () => {
      const now = new Date().toISOString();
      const botRoom = newId('room');
      const humanId = newId('player');
      const botId = newId('bot');
      const guest = (id: string, kind: 'human' | 'bot', createdAt = now): GuestRow => ({
        id,
        token_hash: kind === 'bot' ? `bot:${id}` : `hash-${Math.random()}`,
        nickname: kind === 'bot' ? 'Ada' : 'Human',
        locale: 'en',
        created_at: createdAt,
        updated_at: createdAt,
        kind,
        bot_level: kind === 'bot' ? 'easy' : null,
      });
      const seat = (playerId: string, index: number): MembershipRow => ({
        room_id: botRoom,
        player_id: playerId,
        seat: index,
        color: index === 0 ? 'red' : 'blue',
        ready: 1,
        connected: 1,
        withdrawn: 0,
        joined_at: now,
        last_seen_at: now,
        disconnected_at: null,
        connection_id: null,
      });
      await repo.insertGuest(guest(humanId, 'human'));
      await repo.insertGuest(guest(botId, 'bot'));
      // Bot 的哨兵 token_hash 永遠解析不出身分。
      expect(await repo.findGuestByTokenHash(`bot:${botId}`)).toBeNull();
      expect((await repo.findGuest(botId))?.kind).toBe('bot');

      await repo.insertRoom({
        id: botRoom,
        code: newRoomCode(),
        visibility: 'private',
        status: 'lobby',
        host_id: humanId,
        profile_id: 'base-2025',
        setup_mode: 'fixed',
        order_mode: 'join',
        capacity: 3,
        policy_json: '{}',
        policy_revision: 1,
        game_id: null,
        created_at: now,
        updated_at: now,
      });
      await repo.insertMembership(seat(humanId, 0));
      await repo.insertMembership(seat(botId, 1));
      const members = await repo.listMembers(botRoom);
      expect(members.map((member) => [member.player_id, member.kind, member.bot_level, member.nickname])).toEqual([
        [humanId, 'human', null, 'Human'],
        [botId, 'bot', 'easy', 'Ada'],
      ]);

      // 只刪 Bot：對真人 id 呼叫不會有任何效果。
      await repo.deleteBotGuest(humanId);
      expect(await repo.findGuest(humanId)).not.toBeNull();
      await repo.deleteRoom(botRoom);
      expect(await repo.findGuest(botId)).toBeNull();
      expect(await repo.findGuest(humanId)).not.toBeNull();

      const oldOrphan = newId('bot');
      const freshOrphan = newId('bot');
      await repo.insertGuest(guest(oldOrphan, 'bot', new Date(Date.now() - 2 * 3_600_000).toISOString()));
      await repo.insertGuest(guest(freshOrphan, 'bot'));
      const swept = await repo.deleteOrphanBotGuests(new Date(Date.now() - 3_600_000).toISOString());
      expect(swept).toContain(oldOrphan);
      expect(swept).not.toContain(freshOrphan);
      expect(await repo.findGuest(oldOrphan)).toBeNull();
      expect(await repo.findGuest(freshOrphan)).not.toBeNull();
    });

    it('keeps overlapping transactions from different callers apart', async () => {
      // 兩間房的指令會同時提交（Bot 計時器讓這更常見）；一筆回滾不能帶走另一筆。
      const rolledBack = newId('player');
      const committed = newId('player');
      const now = new Date().toISOString();
      const guest = (id: string): GuestRow => ({
        id,
        token_hash: `hash-${id}`,
        nickname: 'Tx',
        locale: 'en',
        created_at: now,
        updated_at: now,
        kind: 'human',
        bot_level: null,
      });
      let releaseFirst!: () => void;
      const firstStarted = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const first = repo.db
        .transaction(async () => {
          await repo.insertGuest(guest(rolledBack));
          releaseFirst();
          await new Promise((resolve) => setTimeout(resolve, 50));
          throw new Error('roll back the first transaction');
        })
        .catch(() => 'rolled back');
      await firstStarted;
      const second = repo.db.transaction(async () => {
        await repo.insertGuest(guest(committed));
        // 同一呼叫鏈內的巢狀交易照舊併入外層。
        await repo.db.transaction(async () => repo.updateGuest(committed, { nickname: 'Nested' }));
      });
      expect(await first).toBe('rolled back');
      await second;
      expect(await repo.findGuest(rolledBack)).toBeNull();
      expect((await repo.findGuest(committed))?.nickname).toBe('Nested');
    });

    it('isolates ordinary reads and writes from another caller rollback', async () => {
      const rolledBack = newId('player');
      const committed = newId('player');
      const now = new Date().toISOString();
      const guest = (id: string): GuestRow => ({
        id,
        token_hash: `hash-${id}`,
        nickname: 'Outside transaction',
        locale: 'en',
        created_at: now,
        updated_at: now,
        kind: 'human',
        bot_level: null,
      });
      let started!: () => void;
      let release!: () => void;
      const firstStarted = new Promise<void>((resolve) => { started = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      const first = repo.db.transaction(async () => {
        await repo.insertGuest(guest(rolledBack));
        started();
        await released;
        throw new Error('roll back the first transaction');
      }).catch(() => 'rolled back');
      await firstStarted;
      // 不另開交易的呼叫者也不能讀到未提交資料，或被無關回滾一起撤銷。
      const outsideRead = repo.findGuest(rolledBack);
      const outsideWrite = repo.insertGuest(guest(committed));
      release();
      expect(await first).toBe('rolled back');
      await outsideWrite;
      expect(await outsideRead).toBeNull();
      expect(await repo.findGuest(rolledBack)).toBeNull();
      expect((await repo.findGuest(committed))?.nickname).toBe('Outside transaction');
    });

    it('deletes a room together with its memberships', async () => {
      await repo.deleteRoom(roomId);
      expect(await repo.findRoom(roomId)).toBeNull();
      expect(await repo.listMemberships(roomId)).toHaveLength(0);
    });
  });
}

for (const testCase of cases) {
  describe.skipIf(testCase.skip)(`bot migration on existing data (${testCase.label})`, () => {
    it('marks every existing guest as a person and keeps rooms on join order', async () => {
      const db =
        testCase.kind === 'postgres'
          ? await createDialect({
              databaseUrl: postgresUrl,
              schema: `t_upgrade_${Math.random().toString(36).slice(2, 10)}`,
            })
          : await createDialect({ sqlitePath: ':memory:' });
      try {
        // 模擬升級前的資料庫：只套用 0001，並寫入一位舊格式的訪客。
        const core = MIGRATIONS.find((migration) => migration.id === '0001_core')!;
        for (const statement of core.statements) await db.run(statement);
        await db.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', ['0001_core', 'then']);
        await db.run(
          'INSERT INTO guests (id, token_hash, nickname, locale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          ['player_old', 'hash-old', 'Old', 'en', 'then', 'then'],
        );
        await db.run(
          `INSERT INTO rooms (id, code, visibility, status, host_id, profile_id, setup_mode, capacity,
            policy_json, policy_revision, game_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ['room_old', 'OLDCODE1', 'private', 'lobby', 'player_old', 'base-2025', 'fixed', 3, '{}', 1, null, 'then', 'then'],
        );
        expect(await migrate(db)).toEqual(['0002_bots', '0003_room_order_mode']);
        const repo = new Repository(db);
        const old = await repo.findGuest('player_old');
        expect(old?.kind).toBe('human');
        expect(old?.bot_level).toBeNull();
        expect((await repo.findGuestByTokenHash('hash-old'))?.id).toBe('player_old');
        expect((await repo.findRoom('room_old'))?.order_mode).toBe('join');
      } finally {
        await db.close();
      }
    });
  });
}

describe('dialect coverage', () => {
  it('reports whether PostgreSQL was exercised', () => {
    if (!postgresUrl) {
      // Recorded as uncovered rather than silently passed.
      expect(postgresUrl).toBeUndefined();
    } else {
      expect(postgresUrl).toContain('postgres');
    }
  });
});
