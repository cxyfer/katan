/**
 * Persistence layer.
 *
 * A single repository contract backed by SQLite (default, single instance) or
 * PostgreSQL (externally managed). SQL is authored with `?` placeholders and
 * rewritten to `$n` for PostgreSQL, so no statement is dialect-specific.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { GameEvent, GameState } from '@catan/rules';

export type DialectKind = 'sqlite' | 'postgres';

export interface SqlDialect {
  readonly kind: DialectKind;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<void>;
  /** Runs `fn` inside one transaction; nested calls join the outer one. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
  ping(): Promise<boolean>;
}

export function toPostgresPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

interface SqliteStatement {
  all(...params: unknown[]): Record<string, unknown>[];
  run(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

export async function createSqliteDialect(filename: string): Promise<SqlDialect> {
  const { DatabaseSync } = (await import('node:sqlite')) as unknown as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  // 只有同一條呼叫鏈內的巢狀交易會併入外層；其他呼叫者的交易在單一連線上
  // 依序排隊，避免一筆回滾帶走另一間房同時提交的寫入。
  const scope = new AsyncLocalStorage<true>();
  let tail: Promise<unknown> = Promise.resolve();
  const dialect: SqlDialect = {
    kind: 'sqlite',
    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: unknown[] = []): Promise<void> {
      db.prepare(sql).run(...params);
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (scope.getStore()) return fn();
      const run = async (): Promise<T> => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = await scope.run(true, fn);
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      };
      const next = tail.then(run, run);
      tail = next.catch(() => undefined);
      return next;
    },
    async close(): Promise<void> {
      db.close();
    },
    async ping(): Promise<boolean> {
      db.prepare('SELECT 1 AS ok').all();
      return true;
    },
  };
  return dialect;
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

interface PgClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}
interface PgPool {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}

export async function createPostgresDialect(
  connectionString: string,
  schema?: string,
): Promise<SqlDialect> {
  const { default: pg } = (await import('pg')) as unknown as {
    default: {
      Pool: new (options: { connectionString: string; options?: string }) => PgPool;
    };
  };
  let pool: PgPool;
  if (schema) {
    // Isolate this deployment (or test harness) in its own schema. The sweep
    // and room registry are global by design, so two instances sharing one
    // database would otherwise see each other's rooms.
    const bootstrap = new pg.Pool({ connectionString });
    await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await bootstrap.end();
    pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
  } else {
    pool = new pg.Pool({ connectionString });
  }
  // 交易連線綁在呼叫鏈上：同一條鏈的查詢與巢狀交易走這條連線，其他房間同時
  // 進行的查詢與交易各自使用連線池，不會混進別人的交易。
  const scope = new AsyncLocalStorage<PgClient>();

  const dialect: SqlDialect = {
    kind: 'postgres',
    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const runner = scope.getStore() ?? pool;
      const result = await runner.query(toPostgresPlaceholders(sql), params);
      return result.rows as T[];
    },
    async run(sql: string, params: unknown[] = []): Promise<void> {
      const runner = scope.getStore() ?? pool;
      await runner.query(toPostgresPlaceholders(sql), params);
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (scope.getStore()) return fn();
      const acquired = await pool.connect();
      try {
        await acquired.query('BEGIN');
        const result = await scope.run(acquired, fn);
        await acquired.query('COMMIT');
        return result;
      } catch (error) {
        await acquired.query('ROLLBACK');
        throw error;
      } finally {
        acquired.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
    async ping(): Promise<boolean> {
      await pool.query('SELECT 1');
      return true;
    },
  };
  return dialect;
}

export async function createDialect(options: {
  databaseUrl?: string;
  sqlitePath?: string;
  /** PostgreSQL schema to isolate this instance in. */
  schema?: string;
}): Promise<SqlDialect> {
  if (options.databaseUrl && options.databaseUrl.startsWith('postgres')) {
    return createPostgresDialect(options.databaseUrl, options.schema);
  }
  if (options.databaseUrl && options.databaseUrl.startsWith('sqlite')) {
    return createSqliteDialect(options.databaseUrl.replace(/^sqlite:(\/\/)?/, ''));
  }
  return createSqliteDialect(options.sqlitePath ?? './.data/catan.sqlite');
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Portable DDL: no dialect-specific types beyond the portable subset, and
 * `INTEGER`/`TEXT` are accepted by both engines.
 */
export const MIGRATIONS: { id: string; statements: string[] }[] = [
  {
    id: '0001_core',
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS guests (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        nickname TEXT NOT NULL,
        locale TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        visibility TEXT NOT NULL,
        status TEXT NOT NULL,
        host_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        setup_mode TEXT NOT NULL,
        capacity INTEGER NOT NULL,
        policy_json TEXT NOT NULL,
        policy_revision INTEGER NOT NULL,
        game_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS memberships (
        room_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        seat INTEGER NOT NULL,
        color TEXT NOT NULL,
        ready INTEGER NOT NULL,
        connected INTEGER NOT NULL,
        withdrawn INTEGER NOT NULL,
        joined_at TEXT NOT NULL,
        last_seen_at TEXT,
        disconnected_at TEXT,
        connection_id TEXT,
        PRIMARY KEY (room_id, player_id)
      )`,
      `CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        state_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        pause_reason TEXT,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS game_events (
        game_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        type TEXT NOT NULL,
        params_json TEXT NOT NULL,
        private_json TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (game_id, seq)
      )`,
      `CREATE TABLE IF NOT EXISTS command_receipts (
        game_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        outcome TEXT NOT NULL,
        revision INTEGER NOT NULL,
        error_json TEXT,
        events_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (game_id, player_id, command_id)
      )`,
      `CREATE TABLE IF NOT EXISTS save_receipts (
        game_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        PRIMARY KEY (game_id, player_id, request_id)
      )`,
      `CREATE TABLE IF NOT EXISTS policy_proposals (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        base_revision INTEGER NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        proposed_by TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS policy_consents (
        proposal_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (proposal_id, player_id)
      )`,
      `CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        epoch TEXT NOT NULL,
        seq INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        UNIQUE (room_id, seq)
      )`,
      `CREATE TABLE IF NOT EXISTS chat_receipts (
        room_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        client_message_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (room_id, player_id, client_message_id)
      )`,
      `CREATE TABLE IF NOT EXISTS chat_mutes (
        room_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        muted_player_id TEXT NOT NULL,
        PRIMARY KEY (room_id, player_id, muted_player_id)
      )`,
      `CREATE TABLE IF NOT EXISTS game_proposals (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        proposed_by TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS game_consents (
        proposal_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (proposal_id, player_id)
      )`,
      `CREATE TABLE IF NOT EXISTS game_readiness (
        game_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        ready INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (game_id, player_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_memberships_player ON memberships (player_id)`,
      `CREATE INDEX IF NOT EXISTS idx_games_room ON games (room_id)`,
      `CREATE INDEX IF NOT EXISTS idx_chat_room_seq ON chat_messages (room_id, seq)`,
    ],
  },
  {
    // 電腦對手是 guests 的一列；既有資料列都是真人。
    id: '0002_bots',
    statements: [
      `ALTER TABLE guests ADD COLUMN kind TEXT NOT NULL DEFAULT 'human'`,
      `ALTER TABLE guests ADD COLUMN bot_level TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_guests_kind ON guests (kind)`,
    ],
  },
];

export async function migrate(db: SqlDialect): Promise<string[]> {
  await db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = await db.all<{ id: string }>('SELECT id FROM schema_migrations');
  const done = new Set(applied.map((row) => row.id));
  const newlyApplied: string[] = [];
  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    await db.transaction(async () => {
      for (const statement of migration.statements) await db.run(statement);
      await db.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [
        migration.id,
        new Date().toISOString(),
      ]);
    });
    newlyApplied.push(migration.id);
  }
  return newlyApplied;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface GuestRow {
  id: string;
  token_hash: string;
  nickname: string;
  locale: string;
  created_at: string;
  updated_at: string;
  /** `'human'` 或 `'bot'`；是判斷 Bot 席位的唯一來源。 */
  kind: string;
  /** 只有 Bot 有值。 */
  bot_level: string | null;
}

export interface RoomRow {
  id: string;
  code: string;
  visibility: string;
  status: string;
  host_id: string;
  profile_id: string;
  setup_mode: string;
  capacity: number;
  policy_json: string;
  policy_revision: number;
  game_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MembershipRow {
  room_id: string;
  player_id: string;
  seat: number;
  color: string;
  ready: number;
  connected: number;
  withdrawn: number;
  joined_at: string;
  last_seen_at: string | null;
  disconnected_at: string | null;
  connection_id: string | null;
}

/** membership 加上席位擁有者的 guest 欄位（暱稱、種類、難度）。 */
export interface MemberRow extends MembershipRow {
  nickname: string | null;
  kind: string | null;
  bot_level: string | null;
}

export interface GameRow {
  id: string;
  room_id: string;
  profile_id: string;
  engine_version: string;
  state_json: string;
  revision: number;
  status: string;
  pause_reason: string | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReceiptRow {
  game_id: string;
  player_id: string;
  command_id: string;
  payload_digest: string;
  outcome: string;
  revision: number;
  error_json: string | null;
  events_json: string;
  created_at: string;
}

export interface ChatRow {
  id: string;
  room_id: string;
  epoch: string;
  seq: number;
  player_id: string;
  kind: string;
  text: string;
  created_at: string;
  status: string;
}

export interface PolicyProposalRow {
  id: string;
  room_id: string;
  base_revision: number;
  before_json: string;
  after_json: string;
  proposed_by: string;
  status: string;
  created_at: string;
}

export function digestPayload(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** Random, unguessable invite code (no ambiguous characters). */
export function newRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

export class Repository {
  constructor(readonly db: SqlDialect) {}

  /** Runs `fn` inside one database transaction. */
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  // -- guests --------------------------------------------------------------
  async findGuestByTokenHash(tokenHash: string): Promise<GuestRow | null> {
    // Bot 的 token_hash 是哨兵值，本來就比對不到；再以 kind 擋一次作為縱深防禦。
    const rows = await this.db.all<GuestRow>(
      `SELECT * FROM guests WHERE token_hash = ? AND kind = 'human'`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async findGuest(id: string): Promise<GuestRow | null> {
    const rows = await this.db.all<GuestRow>('SELECT * FROM guests WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async insertGuest(row: GuestRow): Promise<void> {
    await this.db.run(
      `INSERT INTO guests (id, token_hash, nickname, locale, created_at, updated_at, kind, bot_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.token_hash,
        row.nickname,
        row.locale,
        row.created_at,
        row.updated_at,
        row.kind,
        row.bot_level,
      ],
    );
  }

  /** 只刪除 Bot guest；真人身分永遠不經由這裡刪除。 */
  async deleteBotGuest(id: string): Promise<void> {
    await this.db.run(`DELETE FROM guests WHERE id = ? AND kind = 'bot'`, [id]);
  }

  /**
   * 刪除早於 `createdBefore`、且已沒有任何席位的 Bot guest。年齡門檻避免與
   * 「先建 guest、再建 membership」的新增流程競爭。
   */
  async deleteOrphanBotGuests(createdBefore: string): Promise<string[]> {
    const rows = await this.db.all<{ id: string }>(
      `SELECT id FROM guests WHERE kind = 'bot' AND created_at < ?
       AND NOT EXISTS (SELECT 1 FROM memberships WHERE memberships.player_id = guests.id)`,
      [createdBefore],
    );
    for (const row of rows) await this.deleteBotGuest(row.id);
    return rows.map((row) => row.id);
  }

  async updateGuest(id: string, fields: { nickname?: string; locale?: string }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (fields.nickname !== undefined) {
      sets.push('nickname = ?');
      params.push(fields.nickname);
    }
    if (fields.locale !== undefined) {
      sets.push('locale = ?');
      params.push(fields.locale);
    }
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);
    await this.db.run(`UPDATE guests SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  // -- rooms ---------------------------------------------------------------
  async insertRoom(row: RoomRow): Promise<void> {
    await this.db.run(
      `INSERT INTO rooms (id, code, visibility, status, host_id, profile_id, setup_mode, capacity,
        policy_json, policy_revision, game_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.code,
        row.visibility,
        row.status,
        row.host_id,
        row.profile_id,
        row.setup_mode,
        row.capacity,
        row.policy_json,
        row.policy_revision,
        row.game_id,
        row.created_at,
        row.updated_at,
      ],
    );
  }

  async findRoom(id: string): Promise<RoomRow | null> {
    const rows = await this.db.all<RoomRow>('SELECT * FROM rooms WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async findRoomByCode(code: string): Promise<RoomRow | null> {
    const rows = await this.db.all<RoomRow>('SELECT * FROM rooms WHERE code = ?', [code]);
    return rows[0] ?? null;
  }

  async listAllRooms(): Promise<RoomRow[]> {
    return this.db.all<RoomRow>('SELECT * FROM rooms ORDER BY created_at ASC');
  }

  async listPublicRooms(): Promise<RoomRow[]> {
    return this.db.all<RoomRow>(
      `SELECT * FROM rooms WHERE visibility = 'public' AND status IN ('lobby', 'playing')
       ORDER BY created_at DESC LIMIT 100`,
    );
  }

  async updateRoom(id: string, fields: Partial<RoomRow>): Promise<void> {
    const allowed: (keyof RoomRow)[] = [
      'status',
      'host_id',
      'profile_id',
      'setup_mode',
      'capacity',
      'policy_json',
      'policy_revision',
      'game_id',
    ];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const key of allowed) {
      if (fields[key] === undefined) continue;
      sets.push(`${key} = ?`);
      params.push(fields[key] as unknown);
    }
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);
    await this.db.run(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async deleteRoom(id: string): Promise<void> {
    await this.db.transaction(async () => {
      // 每個 Bot guest 只屬於一間房，房間刪除時一併移除。
      await this.db.run(
        `DELETE FROM guests WHERE kind = 'bot'
         AND id IN (SELECT player_id FROM memberships WHERE room_id = ?)`,
        [id],
      );
      await this.db.run('DELETE FROM memberships WHERE room_id = ?', [id]);
      await this.db.run('DELETE FROM rooms WHERE id = ?', [id]);
    });
  }

  // -- memberships ---------------------------------------------------------
  async insertMembership(row: MembershipRow): Promise<void> {
    await this.db.run(
      `INSERT INTO memberships (room_id, player_id, seat, color, ready, connected, withdrawn,
        joined_at, last_seen_at, disconnected_at, connection_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.room_id,
        row.player_id,
        row.seat,
        row.color,
        row.ready,
        row.connected,
        row.withdrawn,
        row.joined_at,
        row.last_seen_at,
        row.disconnected_at,
        row.connection_id,
      ],
    );
  }

  async listMemberships(roomId: string): Promise<MembershipRow[]> {
    return this.db.all<MembershipRow>(
      'SELECT * FROM memberships WHERE room_id = ? ORDER BY seat ASC',
      [roomId],
    );
  }

  /** 依座位排序的成員，附帶 guest 的暱稱、種類與 Bot 難度。 */
  async listMembers(roomId: string): Promise<MemberRow[]> {
    return this.db.all<MemberRow>(
      `SELECT memberships.*, guests.nickname AS nickname, guests.kind AS kind, guests.bot_level AS bot_level
       FROM memberships LEFT JOIN guests ON guests.id = memberships.player_id
       WHERE memberships.room_id = ? ORDER BY memberships.seat ASC`,
      [roomId],
    );
  }

  async findMembership(roomId: string, playerId: string): Promise<MembershipRow | null> {
    const rows = await this.db.all<MembershipRow>(
      'SELECT * FROM memberships WHERE room_id = ? AND player_id = ?',
      [roomId, playerId],
    );
    return rows[0] ?? null;
  }

  async updateMembership(
    roomId: string,
    playerId: string,
    fields: Partial<MembershipRow>,
  ): Promise<void> {
    const allowed: (keyof MembershipRow)[] = [
      'seat',
      'color',
      'ready',
      'connected',
      'withdrawn',
      'last_seen_at',
      'disconnected_at',
      'connection_id',
    ];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const key of allowed) {
      if (fields[key] === undefined) continue;
      sets.push(`${key} = ?`);
      params.push(fields[key] as unknown);
    }
    if (sets.length === 0) return;
    params.push(roomId, playerId);
    await this.db.run(
      `UPDATE memberships SET ${sets.join(', ')} WHERE room_id = ? AND player_id = ?`,
      params,
    );
  }

  async deleteMembership(roomId: string, playerId: string): Promise<void> {
    await this.db.run('DELETE FROM memberships WHERE room_id = ? AND player_id = ?', [roomId, playerId]);
  }

  async listRoomsForPlayer(playerId: string): Promise<RoomRow[]> {
    return this.db.all<RoomRow>(
      `SELECT rooms.* FROM rooms
       JOIN memberships ON memberships.room_id = rooms.id
       WHERE memberships.player_id = ? ORDER BY rooms.updated_at DESC`,
      [playerId],
    );
  }

  // -- games ---------------------------------------------------------------
  async insertGame(row: GameRow): Promise<void> {
    await this.db.run(
      `INSERT INTO games (id, room_id, profile_id, engine_version, state_json, revision, status,
        pause_reason, result_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.room_id,
        row.profile_id,
        row.engine_version,
        row.state_json,
        row.revision,
        row.status,
        row.pause_reason,
        row.result_json,
        row.created_at,
        row.updated_at,
      ],
    );
  }

  async findGame(id: string): Promise<GameRow | null> {
    const rows = await this.db.all<GameRow>('SELECT * FROM games WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async findGameByRoom(roomId: string): Promise<GameRow | null> {
    const rows = await this.db.all<GameRow>(
      'SELECT * FROM games WHERE room_id = ? ORDER BY created_at DESC LIMIT 1',
      [roomId],
    );
    return rows[0] ?? null;
  }

  async saveGame(
    id: string,
    state: GameState,
    revision: number,
    status: string,
    pauseReason: string | null,
  ): Promise<void> {
    await this.db.run(
      `UPDATE games SET state_json = ?, revision = ?, status = ?, pause_reason = ?, result_json = ?, updated_at = ?
       WHERE id = ?`,
      [
        JSON.stringify(state),
        revision,
        status,
        pauseReason,
        state.result ? JSON.stringify(state.result) : null,
        new Date().toISOString(),
        id,
      ],
    );
  }

  async appendEvents(gameId: string, revision: number, events: GameEvent[]): Promise<void> {
    const now = new Date().toISOString();
    for (const event of events) {
      await this.db.run(
        `INSERT INTO game_events (game_id, seq, revision, type, params_json, private_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          gameId,
          event.seq,
          revision,
          event.type,
          JSON.stringify(event.params),
          event.private ? JSON.stringify(event.private) : null,
          now,
        ],
      );
    }
  }

  async listEvents(gameId: string, after: number, limit: number): Promise<GameEvent[]> {
    const rows = await this.db.all<{
      seq: number;
      type: string;
      params_json: string;
      private_json: string | null;
    }>(
      'SELECT seq, type, params_json, private_json FROM game_events WHERE game_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
      [gameId, after, limit],
    );
    return rows.map((row) => {
      const event: GameEvent = {
        seq: row.seq,
        type: row.type,
        params: JSON.parse(row.params_json) as Record<string, unknown>,
      };
      if (row.private_json) {
        event.private = JSON.parse(row.private_json) as { to: string[]; params: Record<string, unknown> };
      }
      return event;
    });
  }

  // -- receipts ------------------------------------------------------------
  async findReceipt(gameId: string, playerId: string, commandId: string): Promise<ReceiptRow | null> {
    const rows = await this.db.all<ReceiptRow>(
      'SELECT * FROM command_receipts WHERE game_id = ? AND player_id = ? AND command_id = ?',
      [gameId, playerId, commandId],
    );
    return rows[0] ?? null;
  }

  async insertReceipt(row: ReceiptRow): Promise<void> {
    await this.db.run(
      `INSERT INTO command_receipts (game_id, player_id, command_id, payload_digest, outcome, revision,
        error_json, events_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.game_id,
        row.player_id,
        row.command_id,
        row.payload_digest,
        row.outcome,
        row.revision,
        row.error_json,
        row.events_json,
        row.created_at,
      ],
    );
  }

  // -- saves ---------------------------------------------------------------
  async findSaveReceipt(
    gameId: string,
    playerId: string,
    requestId: string,
  ): Promise<{ revision: number; outcome: string; saved_at: string } | null> {
    const rows = await this.db.all<{ revision: number; outcome: string; saved_at: string }>(
      'SELECT revision, outcome, saved_at FROM save_receipts WHERE game_id = ? AND player_id = ? AND request_id = ?',
      [gameId, playerId, requestId],
    );
    return rows[0] ?? null;
  }

  async insertSaveReceipt(row: {
    game_id: string;
    player_id: string;
    request_id: string;
    revision: number;
    outcome: string;
    saved_at: string;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO save_receipts (game_id, player_id, request_id, revision, outcome, saved_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.game_id, row.player_id, row.request_id, row.revision, row.outcome, row.saved_at],
    );
  }

  // -- policy --------------------------------------------------------------
  async insertPolicyProposal(row: PolicyProposalRow): Promise<void> {
    await this.db.run(
      `INSERT INTO policy_proposals (id, room_id, base_revision, before_json, after_json, proposed_by, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.room_id,
        row.base_revision,
        row.before_json,
        row.after_json,
        row.proposed_by,
        row.status,
        row.created_at,
      ],
    );
  }

  async findOpenProposal(roomId: string): Promise<PolicyProposalRow | null> {
    const rows = await this.db.all<PolicyProposalRow>(
      `SELECT * FROM policy_proposals WHERE room_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
      [roomId],
    );
    return rows[0] ?? null;
  }

  async updateProposalStatus(id: string, status: string): Promise<void> {
    await this.db.run('UPDATE policy_proposals SET status = ? WHERE id = ?', [status, id]);
  }

  async insertPolicyConsent(proposalId: string, playerId: string): Promise<void> {
    await this.db.run(
      'INSERT INTO policy_consents (proposal_id, player_id, created_at) VALUES (?, ?, ?)',
      [proposalId, playerId, new Date().toISOString()],
    );
  }

  async listPolicyConsents(proposalId: string): Promise<string[]> {
    const rows = await this.db.all<{ player_id: string }>(
      'SELECT player_id FROM policy_consents WHERE proposal_id = ?',
      [proposalId],
    );
    return rows.map((row) => row.player_id);
  }

  async cancelOpenProposals(roomId: string): Promise<void> {
    await this.db.run(
      `UPDATE policy_proposals SET status = 'cancelled' WHERE room_id = ? AND status = 'open'`,
      [roomId],
    );
  }

  // -- game proposals, consents and resume readiness -----------------------
  async insertGameProposal(row: {
    id: string;
    game_id: string;
    kind: string;
    proposed_by: string;
    status: string;
    created_at: string;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO game_proposals (id, game_id, kind, proposed_by, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.game_id, row.kind, row.proposed_by, row.status, row.created_at],
    );
  }

  async findOpenGameProposal(
    gameId: string,
    kind: string,
  ): Promise<{ id: string; game_id: string; kind: string; proposed_by: string; status: string } | null> {
    const rows = await this.db.all<{
      id: string;
      game_id: string;
      kind: string;
      proposed_by: string;
      status: string;
    }>(
      `SELECT id, game_id, kind, proposed_by, status FROM game_proposals
       WHERE game_id = ? AND kind = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
      [gameId, kind],
    );
    return rows[0] ?? null;
  }

  async updateGameProposalStatus(id: string, status: string): Promise<void> {
    await this.db.run('UPDATE game_proposals SET status = ? WHERE id = ?', [status, id]);
  }

  async cancelOpenGameProposals(gameId: string): Promise<void> {
    await this.db.run(
      `UPDATE game_proposals SET status = 'cancelled' WHERE game_id = ? AND status = 'open'`,
      [gameId],
    );
  }

  async insertGameConsent(proposalId: string, playerId: string): Promise<void> {
    await this.db.run(
      'INSERT INTO game_consents (proposal_id, player_id, created_at) VALUES (?, ?, ?)',
      [proposalId, playerId, new Date().toISOString()],
    );
  }

  async listGameConsents(proposalId: string): Promise<string[]> {
    const rows = await this.db.all<{ player_id: string }>(
      'SELECT player_id FROM game_consents WHERE proposal_id = ?',
      [proposalId],
    );
    return rows.map((row) => row.player_id);
  }

  async setGameReady(gameId: string, playerId: string, ready: boolean): Promise<void> {
    const existing = await this.db.all<{ player_id: string }>(
      'SELECT player_id FROM game_readiness WHERE game_id = ? AND player_id = ?',
      [gameId, playerId],
    );
    if (existing.length > 0) {
      await this.db.run(
        'UPDATE game_readiness SET ready = ?, updated_at = ? WHERE game_id = ? AND player_id = ?',
        [ready ? 1 : 0, new Date().toISOString(), gameId, playerId],
      );
      return;
    }
    await this.db.run(
      'INSERT INTO game_readiness (game_id, player_id, ready, updated_at) VALUES (?, ?, ?, ?)',
      [gameId, playerId, ready ? 1 : 0, new Date().toISOString()],
    );
  }

  async listGameReady(gameId: string): Promise<{ player_id: string; ready: number }[]> {
    return this.db.all<{ player_id: string; ready: number }>(
      'SELECT player_id, ready FROM game_readiness WHERE game_id = ?',
      [gameId],
    );
  }

  async clearGameReady(gameId: string): Promise<void> {
    await this.db.run('DELETE FROM game_readiness WHERE game_id = ?', [gameId]);
  }

  // -- chat ----------------------------------------------------------------
  async nextChatSeq(roomId: string): Promise<number> {
    const rows = await this.db.all<{ max_seq: number | null }>(
      'SELECT MAX(seq) AS max_seq FROM chat_messages WHERE room_id = ?',
      [roomId],
    );
    return (rows[0]?.max_seq ?? 0) + 1;
  }

  async insertChat(row: ChatRow): Promise<void> {
    await this.db.run(
      `INSERT INTO chat_messages (id, room_id, epoch, seq, player_id, kind, text, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.room_id, row.epoch, row.seq, row.player_id, row.kind, row.text, row.created_at, row.status],
    );
  }

  async findChatReceipt(
    roomId: string,
    playerId: string,
    clientMessageId: string,
  ): Promise<string | null> {
    const rows = await this.db.all<{ message_id: string }>(
      'SELECT message_id FROM chat_receipts WHERE room_id = ? AND player_id = ? AND client_message_id = ?',
      [roomId, playerId, clientMessageId],
    );
    return rows[0]?.message_id ?? null;
  }

  async insertChatReceipt(
    roomId: string,
    playerId: string,
    clientMessageId: string,
    messageId: string,
  ): Promise<void> {
    await this.db.run(
      `INSERT INTO chat_receipts (room_id, player_id, client_message_id, message_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [roomId, playerId, clientMessageId, messageId, new Date().toISOString()],
    );
  }

  async listChat(roomId: string, epoch: string, after: number, limit: number): Promise<ChatRow[]> {
    return this.db.all<ChatRow>(
      `SELECT * FROM chat_messages WHERE room_id = ? AND epoch = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
      [roomId, epoch, after, limit],
    );
  }

  async findChatById(id: string): Promise<ChatRow | null> {
    const rows = await this.db.all<ChatRow>('SELECT * FROM chat_messages WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async countRecentChat(roomId: string, playerId: string, sinceIso: string): Promise<number> {
    const rows = await this.db.all<{ total: number }>(
      'SELECT COUNT(*) AS total FROM chat_messages WHERE room_id = ? AND player_id = ? AND created_at > ?',
      [roomId, playerId, sinceIso],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async setMute(roomId: string, playerId: string, mutedId: string, muted: boolean): Promise<void> {
    if (muted) {
      await this.db.run(
        'INSERT INTO chat_mutes (room_id, player_id, muted_player_id) VALUES (?, ?, ?)',
        [roomId, playerId, mutedId],
      );
    } else {
      await this.db.run(
        'DELETE FROM chat_mutes WHERE room_id = ? AND player_id = ? AND muted_player_id = ?',
        [roomId, playerId, mutedId],
      );
    }
  }

  async listMutes(roomId: string, playerId: string): Promise<string[]> {
    const rows = await this.db.all<{ muted_player_id: string }>(
      'SELECT muted_player_id FROM chat_mutes WHERE room_id = ? AND player_id = ?',
      [roomId, playerId],
    );
    return rows.map((row) => row.muted_player_id);
  }
}
