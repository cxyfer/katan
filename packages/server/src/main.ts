/** Service entry point: configuration, migrations, HTTP + WebSocket, shutdown. */

import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type ServerConfig } from './config.ts';
import { createDialect, migrate, Repository } from './db.ts';
import { SessionService } from './session.ts';
import { RoomService } from './rooms.ts';
import { GameCoordinator } from './game.ts';
import { ChatService } from './chat.ts';
import { createHttpHandler } from './http.ts';
import { createWebSocketServer } from './ws.ts';

// `build.mjs` replaces this with the root package.json version, so a release
// bumps one file and `/healthz` reports the version of the tag that was built.
// Source imports in tests see the fallback instead.
declare const __CATAN_VERSION__: string;
export const VERSION = typeof __CATAN_VERSION__ === 'string' ? __CATAN_VERSION__ : '0.0.0-dev';

export interface Logger {
  (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: unknown): void;
}

export function createLogger(level: ServerConfig['logLevel']): Logger {
  const order = ['debug', 'info', 'warn', 'error'] as const;
  const threshold = order.indexOf(level);
  return (entryLevel, message, meta) => {
    if (order.indexOf(entryLevel) < threshold) return;
    const payload = meta === undefined ? '' : ` ${JSON.stringify(meta)}`;
    process.stdout.write(`${new Date().toISOString()} ${entryLevel} ${message}${payload}\n`);
  };
}

export interface RunningService {
  config: ServerConfig;
  repo: Repository;
  rooms: RoomService;
  games: GameCoordinator;
  chat: ChatService;
  /** Stops accepting work, drains and closes the database. Idempotent. */
  close(): Promise<void>;
  /** Graceful shutdown for a received signal, with a hard-stop deadline. */
  shutdown(reason: string): Promise<void>;
  port: number;
}

export async function startService(
  overrides: Partial<ServerConfig> = {},
  log: Logger = createLogger('info'),
): Promise<RunningService> {
  const config = { ...loadConfig(), ...overrides };
  if (!config.databaseUrl && config.sqlitePath !== ':memory:') {
    const directory = dirname(resolve(config.sqlitePath));
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  }
  const db = await createDialect({
    ...(config.databaseUrl ? { databaseUrl: config.databaseUrl } : {}),
    ...(config.databaseSchema ? { schema: config.databaseSchema } : {}),
    sqlitePath: config.sqlitePath,
  });
  const applied = await migrate(db);
  if (applied.length > 0) log('info', 'applied migrations', { applied });
  const repo = new Repository(db);

  const sessions = new SessionService(repo, config.sessionCookieName, config.cookieSecure);
  const gamesRef: { current: GameCoordinator | null } = { current: null };
  const rooms = new RoomService({
    repo,
    config,
    async onRoomStarted(room, playerIds) {
      if (!gamesRef.current) throw new Error('game coordinator not ready');
      return gamesRef.current.startGame(room, playerIds);
    },
  });
  const games = new GameCoordinator({ repo, rooms, config });
  gamesRef.current = games;
  const chat = new ChatService(repo, rooms, config);

  const handler = createHttpHandler({ repo, config, sessions, rooms, games, chat, version: VERSION });
  const server = createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: { code: 'E_INTERNAL', messageId: 'error.E_INTERNAL' } }));
      }
    });
  });

  const ws = createWebSocketServer({
    config,
    sessions,
    rooms,
    games,
    chat,
    log,
  });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    ws.handleUpgrade(req, socket, head);
  });

  await new Promise<void>((resolvePromise) => server.listen(config.port, config.host, resolvePromise));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  log('info', 'service listening', { host: config.host, port, database: db.kind });

  const sweepTimer = setInterval(() => {
    void rooms
      .sweepStaleLobbies()
      .then((removed) => {
        if (removed.length > 0) log('info', 'swept stale lobbies', { removed: removed.length });
      })
      .catch((error) => log('warn', 'stale lobby sweep failed', { error: String(error) }));
  }, Math.max(config.presenceSweepIntervalMs, 60_000));
  sweepTimer.unref?.();

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      clearInterval(sweepTimer);
      log('info', 'shutting down');
      await ws.close();
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
      await db.close();
    })();
    return closing;
  };

  return {
    config,
    repo,
    rooms,
    games,
    chat,
    close,
    async shutdown(reason: string): Promise<void> {
      log('info', 'received signal', { signal: reason });
      // The hard deadline is armed only once shutdown has actually begun, so a
      // healthy process is never stopped by a startup timer.
      const deadline = setTimeout(() => {
        log('warn', 'shutdown deadline exceeded, exiting');
        process.exit(0);
      }, config.shutdownTimeoutMs);
      deadline.unref?.();
      try {
        await close();
      } finally {
        clearTimeout(deadline);
      }
    },
    port,
  };
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const log = createLogger(loadConfig().logLevel);
  startService({}, log)
    .then((service) => {
      const stop = (signal: string) => {
        void service.shutdown(signal).then(
          () => process.exit(0),
          () => process.exit(1),
        );
      };
      process.on('SIGTERM', () => stop('SIGTERM'));
      process.on('SIGINT', () => stop('SIGINT'));
    })
    .catch((error) => {
      log('error', 'failed to start', { error: String(error) });
      process.exit(1);
    });
}
