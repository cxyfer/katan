/** Integration-test harness: boots the service on an ephemeral port. */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GameEvent, GameState } from '@catan/rules';
import { startService, type Logger, type RunningService } from '../src/main.ts';
import type { ServerConfig } from '../src/config.ts';

export interface ApiResponse<T = unknown> {
  status: number;
  body: { ok: true; data: T } | { ok: false; error: { code: string; messageId: string; params?: Record<string, unknown> } };
}

export interface TestClient {
  cookie: string | null;
  playerId: string | null;
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>>;
  get<T = unknown>(path: string): Promise<ApiResponse<T>>;
  post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>>;
  patch<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>>;
  expectOk<T = unknown>(response: ApiResponse<T>): T;
  expectError(response: ApiResponse, code: string): void;
}

export interface TestHarness {
  service: RunningService;
  base: string;
  client(nickname?: string): Promise<TestClient>;
  close(): Promise<void>;
  dataDir: string;
}

export function createClient(base: string): TestClient {
  const client: TestClient = {
    cookie: null,
    playerId: null,
    async request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
      const headers: Record<string, string> = {};
      if (client.cookie) headers.cookie = client.cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) client.cookie = setCookie.split(';')[0]!;
      const parsed = (await response.json()) as ApiResponse<T>['body'];
      return { status: response.status, body: parsed };
    },
    get<T>(path: string) {
      return client.request<T>('GET', path);
    },
    post<T>(path: string, body?: unknown) {
      return client.request<T>('POST', path, body ?? {});
    },
    patch<T>(path: string, body?: unknown) {
      return client.request<T>('PATCH', path, body ?? {});
    },
    expectOk<T>(response: ApiResponse<T>): T {
      if (!response.body.ok) {
        throw new Error(`expected ok, got ${response.body.error.code} (${response.status})`);
      }
      return response.body.data;
    },
    expectError(response: ApiResponse, code: string): void {
      if (response.body.ok) throw new Error(`expected error ${code}, got ok`);
      if (response.body.error.code !== code) {
        throw new Error(`expected error ${code}, got ${response.body.error.code}`);
      }
    },
  };
  return client;
}

/**
 * 在 harness 的同一份持久資料上啟動另一個服務實例（SQLite 檔，或 PostgreSQL
 * 的同一個 schema），讓重啟測試在兩種資料庫上都能執行。呼叫前先關閉原本的服務。
 */
export function restartService(harness: TestHarness, log: Logger = () => undefined): Promise<RunningService> {
  return startService({ ...harness.service.config, port: 0 }, log);
}

export async function startHarness(
  overrides: Partial<ServerConfig> = {},
  options: { postgresUrl?: string; log?: Logger } = {},
): Promise<TestHarness> {
  const dataDir = mkdtempSync(join(tmpdir(), 'catan-test-'));
  // The whole service suite can be replayed against PostgreSQL by exporting
  // TEST_POSTGRES_URL; the default remains the single-instance SQLite mode.
  const postgresUrl = options.postgresUrl ?? process.env.TEST_POSTGRES_URL;
  // One schema per harness: the room sweep and registry are global by design,
  // so a shared database would let one suite reclaim another suite's lobbies.
  const schema = postgresUrl ? `t_${Math.random().toString(36).slice(2, 10)}` : null;
  const service = await startService(
    {
      port: 0,
      host: '127.0.0.1',
      sqlitePath: postgresUrl ? ':memory:' : join(dataDir, 'test.sqlite'),
      ...(postgresUrl ? { databaseUrl: postgresUrl } : {}),
      ...(schema ? { databaseSchema: schema } : {}),
      ...overrides,
    },
    options.log ?? (() => undefined),
  );
  const base = `http://127.0.0.1:${service.port}`;
  return {
    service,
    base,
    dataDir,
    async client(nickname = 'Tester') {
      const client = createClient(base);
      const created = await client.post<{ player: { id: string } }>('/api/session', {
        nickname,
        locale: 'en',
      });
      if (!created.body.ok) throw new Error('failed to create session');
      client.playerId = created.body.data.player.id;
      return client;
    },
    async close() {
      await service.close();
      // The disposable schema is left behind; the test database is dropped by
      // the operator between runs.
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Creates a lobby with `count` ready players and starts the game. */
export async function startedGame(
  harness: TestHarness,
  count: number,
  options: {
    profileId?: string;
    setupMode?: 'fixed' | 'variable';
    orderMode?: 'join' | 'random';
  } = {},
): Promise<{ clients: TestClient[]; roomId: string; gameId: string }> {
  const clients: TestClient[] = [];
  for (let i = 0; i < count; i++) clients.push(await harness.client(`P${i + 1}`));
  const host = clients[0]!;
  const room = host.expectOk(
    await host.post<{ id: string }>('/api/rooms', {
      visibility: 'private',
      capacity: count,
      profileId: options.profileId ?? 'base-2025',
      setupMode: options.setupMode ?? 'fixed',
      orderMode: options.orderMode ?? 'join',
    }),
  );
  const code = (room as unknown as { code: string }).code;
  for (let i = 1; i < count; i++) {
    clients[i]!.expectOk(await clients[i]!.post('/api/rooms/join', { code }));
  }
  for (const client of clients) {
    client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
  }
  const started = host.expectOk(await host.post<{ gameId: string }>(`/api/rooms/${room.id}/start`));
  return { clients, roomId: room.id, gameId: started.gameId };
}

export interface GameViewLike {
  seq: number;
  turn: { playerId: string; phase: string; setup: unknown };
  players: { id: string; resources?: Record<string, number>; handSize: number }[];
  board: { topologyId: string; buildings: unknown[]; roads: unknown[] };
}

/** Drives the whole initial placement phase through the HTTP API. */
export async function runSetupOverApi(
  clients: TestClient[],
  gameId: string,
  options: { maxSteps?: number } = {},
): Promise<{ revision: number; view: GameViewLike }> {
  const host = clients[0]!;
  let revision = 1;
  let view = host.expectOk(await host.get<{ revision: number; view: GameViewLike }>(`/api/games/${gameId}`));
  revision = view.revision;
  let current = view.view;
  let steps = 0;
  const limit = options.maxSteps ?? 200;
  while (current.turn.phase === 'setup' && steps < limit) {
    steps += 1;
    const actorId = current.turn.playerId;
    const client = clients.find((candidate) => candidate.playerId === actorId)!;
    // Hints are per-viewer: ask the actor's own client for its legal targets.
    const hints = client.expectOk(
      await client.get<{ view: { hints?: { legalRoads: number[]; legalSettlements: number[] } } }>(
        `/api/games/${gameId}`,
      ),
    ).view.hints;
    const setup = current.turn.setup as { stage: string } | null;
    const command =
      setup?.stage === 'road'
        ? { type: 'setup.placeRoad', edge: hints!.legalRoads[0]! }
        : { type: 'setup.placeBuilding', vertex: hints!.legalSettlements[0]! };
    const receipt = client.expectOk(
      await client.post<{ revision: number }>(`/api/games/${gameId}/commands`, {
        commandId: `setup-${steps}-${Math.random().toString(36).slice(2)}`,
        expectedRevision: revision,
        command,
      }),
    );
    revision = receipt.revision;
    const refreshed = host.expectOk(
      await host.get<{ revision: number; view: GameViewLike }>(`/api/games/${gameId}`),
    );
    current = refreshed.view;
  }
  return { revision, view: current };
}

/**
 * 讓目前的行動者直接進入行動階段並握有一張羊毛，再透過 API 對全桌開出一則報價
 * （羊毛換礦石）。回傳開出報價的玩家與報價被接受後的修訂版本。
 */
export async function openOfferOverApi(
  harness: TestHarness,
  clients: TestClient[],
  gameId: string,
): Promise<{ actor: TestClient; revision: number }> {
  const row = (await harness.service.repo.findGame(gameId))!;
  const state = JSON.parse(row.state_json) as GameState;
  state.turn.phase = 'action';
  state.turn.dice = [3, 4];
  const seated = state.players[state.turn.seat]!;
  seated.resources.wool += 1;
  await harness.service.repo.db.run('UPDATE games SET state_json = ? WHERE id = ?', [JSON.stringify(state), gameId]);
  const actor = clients.find((client) => client.playerId === seated.id)!;
  const receipt = actor.expectOk<{ outcome: string; revision: number }>(
    await actor.post(`/api/games/${gameId}/commands`, {
      commandId: `offer-${Math.random().toString(36).slice(2)}`,
      expectedRevision: row.revision,
      command: { type: 'trade.offer', to: 'all', give: { wool: 1 }, want: { ore: 1 } },
    }),
  );
  if (receipt.outcome !== 'accepted') throw new Error(`offer rejected: ${JSON.stringify(receipt)}`);
  return { actor, revision: receipt.revision };
}

/** 事件庫內這局的全部事件（依序號），以及目前狀態的序號與 log 長度。 */
export async function storedHistory(
  harness: TestHarness,
  gameId: string,
): Promise<{ events: (GameEvent & { revision: number })[]; seq: number; logLength: number }> {
  const rows = await harness.service.repo.db.all<{ seq: number; revision: number; type: string; params_json: string }>(
    'SELECT seq, revision, type, params_json FROM game_events WHERE game_id = ? ORDER BY seq ASC',
    [gameId],
  );
  const state = JSON.parse((await harness.service.repo.findGame(gameId))!.state_json) as GameState;
  return {
    events: rows.map((row) => ({
      seq: Number(row.seq),
      revision: Number(row.revision),
      type: row.type,
      params: JSON.parse(row.params_json) as Record<string, unknown>,
    })),
    seq: state.seq,
    logLength: state.log.length,
  };
}

/** `from + 1` 到 `to` 的連續序號。 */
export function seqRange(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, index) => from + index + 1);
}
