/** Minimal HTTP layer: JSON API plus static delivery of the built client. */

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiResult, Locale } from '@catan/protocol';
import { BOT_LEVELS, LOCALES } from '@catan/protocol';
import { selectableProfiles, PROFILES } from '@catan/rules';
import type { ServerConfig } from './config.ts';
import { validateNickname } from './config.ts';
import type { Repository } from './db.ts';
import type { SessionService } from './session.ts';
import { clearCookie } from './session.ts';
import { ServiceError, type RoomService } from './rooms.ts';
import type { GameCoordinator } from './game.ts';
import type { ChatService } from './chat.ts';

export interface HttpDeps {
  repo: Repository;
  config: ServerConfig;
  sessions: SessionService;
  rooms: RoomService;
  games: GameCoordinator;
  chat: ChatService;
  version: string;
}

type Handler = (
  context: RequestContext,
) => Promise<{ status?: number; data: unknown; cookies?: string[] } | void>;

interface RequestContext {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  playerId: string | null;
  query: URLSearchParams;
}

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res: ServerResponse, status: number, payload: unknown, cookies?: string[]): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...(cookies ? { 'set-cookie': cookies } : {}),
  });
  res.end(body);
}

function ok<T>(res: ServerResponse, data: T, cookies?: string[]): void {
  sendJson(res, 200, { ok: true, data } satisfies ApiResult<T>, cookies);
}

function fail(res: ServerResponse, status: number, error: ServiceError | Error): void {
  if (error instanceof ServiceError) {
    sendJson(res, error.status, {
      ok: false,
      error: { code: error.code, messageId: error.messageId, params: error.params },
    } satisfies ApiResult<never>);
    return;
  }
  sendJson(res, status, {
    ok: false,
    error: { code: 'E_INTERNAL', messageId: 'error.E_INTERNAL' },
  } satisfies ApiResult<never>);
}

function badRequest(messageId: string, params?: Record<string, unknown>): ServiceError {
  return new ServiceError('E_BAD_REQUEST', messageId, params, 400);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw badRequest('error.E_BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('error.E_INVALID_JSON');
  }
}

function requireString(body: unknown, key: string): string {
  if (typeof body !== 'object' || body === null) throw badRequest('error.E_BAD_REQUEST');
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest('error.E_MISSING_FIELD', { field: key });
  }
  return value;
}

function optionalString(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function requireNumber(body: unknown, key: string): number {
  if (typeof body !== 'object' || body === null) throw badRequest('error.E_BAD_REQUEST');
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw badRequest('error.E_MISSING_FIELD', { field: key });
  }
  return value;
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) throw badRequest('error.E_BAD_REQUEST');
  return body as Record<string, unknown>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function serveStatic(res: ServerResponse, root: string, pathname: string): boolean {
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let target = resolve(join(root, safe));
  if (!target.startsWith(resolve(root))) return false;
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
  if (!existsSync(target) || !statSync(target).isFile()) return false;
  const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
  createReadStream(target).pipe(res);
  return true;
}

const ORIGIN_PLACEHOLDER = '__PUBLIC_ORIGIN__';
const HOST_PATTERN = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:]+\])(?::\d{1,5})?$/i;

/** 對外 origin：優先採用 PUBLIC_URL，否則由（反向代理）請求標頭推導；無法確認時回傳空字串（退回相對路徑）。 */
function publicOrigin(req: IncomingMessage, configured: string | null): string {
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
    } catch {
      // 設定無效時改由標頭推導
    }
  }
  const first = (value: string | string[] | undefined): string =>
    (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim().toLowerCase() ?? '';
  const host = first(req.headers['x-forwarded-host']) || first(req.headers.host);
  if (!HOST_PATTERN.test(host)) return '';
  const proto = first(req.headers['x-forwarded-proto']) === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

/** 提供 index.html，並把 og:image 等 meta 的絕對網址佔位符換成實際 origin（爬蟲不會解析相對路徑）。 */
function serveIndex(req: IncomingMessage, res: ServerResponse, root: string, origin: string | null): boolean {
  const target = resolve(join(root, 'index.html'));
  if (!existsSync(target) || !statSync(target).isFile()) return false;
  const html = readFileSync(target, 'utf8').replaceAll(ORIGIN_PLACEHOLDER, publicOrigin(req, origin));
  res.writeHead(200, { 'content-type': MIME['.html']!, 'cache-control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : html);
  return true;
}

export function createHttpHandler(deps: HttpDeps) {
  const routes: { method: string; parts: string[]; handler: Handler }[] = [];

  const route = (method: string, pattern: string, handler: Handler): void => {
    routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  };

  // -- meta ----------------------------------------------------------------
  route('GET', '/healthz', async () => ({
    data: { status: 'ok', uptimeSeconds: Math.round(process.uptime()), version: deps.version },
  }));

  route('GET', '/readyz', async () => {
    let database = 'ok';
    try {
      await deps.repo.db.ping();
    } catch {
      database = 'unavailable';
    }
    return {
      status: database === 'ok' ? 200 : 503,
      data: { status: database === 'ok' ? 'ready' : 'degraded', database, activeRooms: 0 },
    };
  });

  route('GET', '/api/config', async () => ({
    data: {
      locales: LOCALES,
      policyBounds: deps.config.policyBounds,
      defaultPolicy: deps.config.defaultPolicy,
      limits: {
        nicknameMaxLength: deps.config.limits.nicknameMaxLength,
        chatMaxLength: deps.config.limits.chatMaxLength,
        chatRatePerMinute: deps.config.limits.chatRatePerMinute,
        roomCapacityMax: deps.config.limits.roomCapacityMax,
      },
      bots: { enabled: deps.config.bots.enabled, levels: [...BOT_LEVELS] },
    },
  }));

  // -- session -------------------------------------------------------------
  route('GET', '/api/session', async ({ playerId }) => {
    if (!playerId) return { data: { player: null } };
    const row = await deps.repo.findGuest(playerId);
    return {
      data: {
        player: row
          ? { id: row.id, nickname: row.nickname, locale: row.locale, createdAt: row.created_at }
          : null,
      },
    };
  });

  route('POST', '/api/session', async ({ body }) => {
    const nicknameInput = requireString(body, 'nickname');
    const validated = validateNickname(nicknameInput, deps.config.limits.nicknameMaxLength);
    if (!validated.ok) throw badRequest('error.E_INVALID_NICKNAME', { reason: validated.reason });
    const localeInput = optionalString(body, 'locale');
    const locale: Locale = LOCALES.includes(localeInput as Locale) ? (localeInput as Locale) : 'zh-Hant';
    const created = await deps.sessions.create(validated.nickname, locale);
    return { data: { player: created.identity }, cookies: [created.setCookie] };
  });

  route('PATCH', '/api/session', async ({ body, playerId }) => {
    if (!playerId) throw new ServiceError('E_NO_SESSION', 'error.E_NO_SESSION', {}, 401);
    const nicknameInput = optionalString(body, 'nickname');
    const localeInput = optionalString(body, 'locale');
    const fields: { nickname?: string; locale?: Locale } = {};
    if (nicknameInput !== undefined) {
      const validated = validateNickname(nicknameInput, deps.config.limits.nicknameMaxLength);
      if (!validated.ok) throw badRequest('error.E_INVALID_NICKNAME', { reason: validated.reason });
      fields.nickname = validated.nickname;
    }
    if (localeInput !== undefined && LOCALES.includes(localeInput as Locale)) {
      fields.locale = localeInput as Locale;
    }
    const updated = await deps.sessions.update(playerId, fields);
    return { data: { player: updated } };
  });

  route('DELETE', '/api/session', async () => ({
    data: { cleared: true },
    cookies: [clearCookie(deps.config.sessionCookieName, deps.config.cookieSecure)],
  }));

  // -- profiles and rooms --------------------------------------------------
  route('GET', '/api/profiles', async () => ({
    data: {
      profiles: PROFILES.map((profile) => ({
        id: profile.id,
        labelKey: profile.labelKey,
        playerCounts: profile.playerCounts,
        paired: profile.paired,
        modules: { seafarers: profile.modules.seafarers, citiesKnights: profile.modules.citiesKnights },
        scenario: profile.scenario,
        victoryTarget: profile.victoryTarget,
        setupModes: profile.setupModes,
        enabled: profile.enabled,
        ...(profile.unavailableReasonKey ? { unavailableReasonKey: profile.unavailableReasonKey } : {}),
      })),
      selectable: selectableProfiles().map((profile) => profile.id),
    },
  }));

  route('GET', '/api/rooms', async ({ query }) => {
    const playerCount = query.get('playerCount');
    const profileId = query.get('profileId');
    const rooms = await deps.rooms.summaries({
      ...(playerCount ? { playerCount: Number(playerCount) } : {}),
      ...(profileId ? { profileId } : {}),
    });
    return { data: { rooms } };
  });

  route('POST', '/api/rooms', async ({ body, playerId }) => {
    requireSession(playerId);
    const visibility = requireString(body, 'visibility');
    if (visibility !== 'private' && visibility !== 'public') {
      throw badRequest('error.E_INVALID_VISIBILITY');
    }
    const input = asObject(body);
    const view = await deps.rooms.createRoom(playerId!, {
      visibility,
      capacity: requireNumber(body, 'capacity'),
      profileId: requireString(body, 'profileId'),
      setupMode: (optionalString(body, 'setupMode') ?? 'fixed') as 'fixed' | 'variable',
      policy: (input.policy ?? {}) as never,
      // 數量的型別與範圍由 RoomService 驗證；非數字一律視為不合法的數量。
      ...(input.bots !== undefined ? { bots: typeof input.bots === 'number' ? input.bots : Number.NaN } : {}),
      ...(input.botLevel !== undefined ? { botLevel: input.botLevel } : {}),
    });
    return { data: view };
  });

  route('POST', '/api/rooms/join', async ({ body, playerId }) => {
    requireSession(playerId);
    const view = await deps.rooms.joinByCode(playerId!, requireString(body, 'code'));
    return { data: view };
  });

  route('GET', '/api/rooms/:roomId', async ({ params, playerId }) => ({
    data: await deps.rooms.view(params.roomId!, playerId),
  }));

  route('POST', '/api/rooms/:roomId/leave', async ({ params, playerId }) => {
    requireSession(playerId);
    return { data: await deps.rooms.leave(playerId!, params.roomId!) };
  });

  route('POST', '/api/rooms/:roomId/seat', async ({ params, body, playerId }) => {
    requireSession(playerId);
    return { data: await deps.rooms.setColor(playerId!, params.roomId!, requireString(body, 'color')) };
  });

  route('POST', '/api/rooms/:roomId/ready', async ({ params, body, playerId }) => {
    requireSession(playerId);
    const ready = asObject(body).ready;
    if (typeof ready !== 'boolean') throw badRequest('error.E_MISSING_FIELD', { field: 'ready' });
    return { data: await deps.rooms.setReady(playerId!, params.roomId!, ready) };
  });

  route('POST', '/api/rooms/:roomId/settings', async ({ params, body, playerId }) => {
    requireSession(playerId);
    const input = asObject(body);
    return {
      data: await deps.rooms.updateSettings(playerId!, params.roomId!, {
        ...(typeof input.capacity === 'number' ? { capacity: input.capacity } : {}),
        ...(typeof input.profileId === 'string' ? { profileId: input.profileId } : {}),
        ...(input.setupMode === 'fixed' || input.setupMode === 'variable'
          ? { setupMode: input.setupMode }
          : {}),
        ...(input.policy ? { policy: input.policy as never } : {}),
      }),
    };
  });

  route('POST', '/api/rooms/:roomId/policy', async ({ params, body, playerId }) => {
    requireSession(playerId);
    return {
      data: await deps.rooms.setPolicy(playerId!, params.roomId!, asObject(body).policy as never),
    };
  });

  route('POST', '/api/rooms/:roomId/policy/consent', async ({ params, body, playerId }) => {
    requireSession(playerId);
    const approve = asObject(body).approve;
    if (typeof approve !== 'boolean') throw badRequest('error.E_MISSING_FIELD', { field: 'approve' });
    return {
      data: await deps.rooms.consentPolicy(
        playerId!,
        params.roomId!,
        requireString(body, 'proposalId'),
        approve,
      ),
    };
  });

  route('POST', '/api/rooms/:roomId/start', async ({ params, playerId }) => {
    requireSession(playerId);
    return { data: await deps.rooms.start(playerId!, params.roomId!) };
  });

  route('POST', '/api/rooms/:roomId/close', async ({ params, playerId }) => {
    requireSession(playerId);
    return { data: await deps.rooms.closeRoom(playerId!, params.roomId!) };
  });

  route('POST', '/api/rooms/:roomId/bots', async ({ params, body, playerId }) => {
    requireSession(playerId);
    return { data: await deps.rooms.addBot(playerId!, params.roomId!, asObject(body).level) };
  });

  route('DELETE', '/api/rooms/:roomId/bots/:playerId', async ({ params, playerId }) => {
    requireSession(playerId);
    return { data: await deps.rooms.removeBot(playerId!, params.roomId!, params.playerId!) };
  });

  // -- games ---------------------------------------------------------------
  route('GET', '/api/games', async ({ playerId }) => {
    requireSession(playerId);
    return { data: { games: await deps.games.resumableGames(playerId!) } };
  });

  route('GET', '/api/games/:gameId', async ({ params, playerId }) => {
    requireSession(playerId);
    return { data: await deps.games.snapshot(params.gameId!, playerId!) };
  });

  route('GET', '/api/games/:gameId/events', async ({ params, query, playerId }) => {
    requireSession(playerId);
    const after = Number(query.get('after') ?? 0);
    const limit = Math.min(Number(query.get('limit') ?? 100), 500);
    return { data: await deps.games.events(playerId!, params.gameId!, after, limit) };
  });

  route('POST', '/api/games/:gameId/commands', async ({ params, body, playerId }) => {
    requireSession(playerId);
    const command = asObject(body).command;
    if (typeof command !== 'object' || command === null) {
      throw badRequest('error.E_MISSING_FIELD', { field: 'command' });
    }
    return {
      data: await deps.games.submit(playerId!, params.gameId!, {
        commandId: requireString(body, 'commandId'),
        expectedRevision: requireNumber(body, 'expectedRevision'),
        command: command as { type: string },
      }),
    };
  });

  route('POST', '/api/games/:gameId/abandon', async ({ params, body, playerId }) => {
    requireSession(playerId);
    const proposalId = optionalString(body, 'proposalId');
    if (proposalId) {
      const approve = asObject(body).approve;
      return {
        data: await deps.games.consentAbandon(
          playerId!,
          params.gameId!,
          proposalId,
          approve === undefined ? true : approve === true,
        ),
      };
    }
    return { data: await deps.games.proposeAbandon(playerId!, params.gameId!) };
  });

  route('POST', '/api/rooms/:roomId/withdraw', async ({ params, body, playerId }) => {
    requireSession(playerId);
    const withdrawn = asObject(body).withdrawn;
    if (typeof withdrawn !== 'boolean') throw badRequest('error.E_MISSING_FIELD', { field: 'withdrawn' });
    return { data: await deps.rooms.setWithdrawn(playerId!, params.roomId!, withdrawn) };
  });

  route('POST', '/api/games/:gameId/save', async ({ params, body, playerId }) => {
    requireSession(playerId);
    return { data: await deps.games.save(playerId!, params.gameId!, requireString(body, 'requestId')) };
  });

  route('POST', '/api/games/:gameId/suspend', async ({ params, body, playerId }) => {
    requireSession(playerId);
    const proposalId = optionalString(body, 'proposalId');
    if (proposalId) {
      const approve = asObject(body).approve;
      return {
        data: await deps.games.consentSuspend(
          playerId!,
          params.gameId!,
          proposalId,
          approve === undefined ? true : approve === true,
        ),
      };
    }
    return { data: await deps.games.proposeSuspend(playerId!, params.gameId!) };
  });

  route('POST', '/api/games/:gameId/resume', async ({ params, body, playerId }) => {
    requireSession(playerId);
    const ready = asObject(body).ready;
    return {
      data: await deps.games.setResumeReady(playerId!, params.gameId!, ready === undefined ? true : ready === true),
    };
  });

  // -- chat ----------------------------------------------------------------
  route('GET', '/api/rooms/:roomId/chat', async ({ params, query, playerId }) => {
    requireSession(playerId);
    const after = Number(query.get('after') ?? 0);
    const limit = Number(query.get('limit') ?? deps.config.limits.chatHistoryPageSize);
    return { data: await deps.chat.history(playerId!, params.roomId!, after, limit) };
  });

  route('POST', '/api/rooms/:roomId/chat', async ({ params, body, playerId }) => {
    requireSession(playerId);
    return {
      data: await deps.chat.send(
        playerId!,
        params.roomId!,
        requireString(body, 'clientMessageId'),
        requireString(body, 'text'),
      ),
    };
  });

  route('GET', '/api/rooms/:roomId/mutes', async ({ params, playerId }) => {
    requireSession(playerId);
    return { data: { mutes: await deps.chat.mutes(playerId!, params.roomId!) } };
  });

  route('POST', '/api/rooms/:roomId/mutes', async ({ params, body, playerId }) => {
    requireSession(playerId);
    const muted = asObject(body).muted;
    if (typeof muted !== 'boolean') throw badRequest('error.E_MISSING_FIELD', { field: 'muted' });
    await deps.chat.mute(playerId!, params.roomId!, requireString(body, 'playerId'), muted);
    return { data: { mutes: await deps.chat.mutes(playerId!, params.roomId!) } };
  });

  function requireSession(playerId: string | null): void {
    if (!playerId) throw new ServiceError('E_NO_SESSION', 'error.E_NO_SESSION', {}, 401);
  }

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    if (pathname.startsWith('/api/') || pathname === '/healthz' || pathname === '/readyz') {
      const parts = pathname.split('/').filter(Boolean);
      for (const candidate of routes) {
        if (candidate.method !== method) continue;
        if (candidate.parts.length !== parts.length) continue;
        const params: Record<string, string> = {};
        let matched = true;
        for (let i = 0; i < parts.length; i++) {
          const expected = candidate.parts[i]!;
          if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(parts[i]!);
          else if (expected !== parts[i]) {
            matched = false;
            break;
          }
        }
        if (!matched) continue;

        try {
          const player = await deps.sessions.resolve(req.headers.cookie);
          const body = method === 'GET' || method === 'HEAD' ? {} : await readBody(req);
          const result = await candidate.handler({
            req,
            url,
            params,
            body,
            playerId: player?.id ?? null,
            query: url.searchParams,
          });
          if (result) ok(res, result.data, result.cookies);
          else ok(res, {});
        } catch (error) {
          fail(res, error instanceof ServiceError ? error.status : 500, error as Error);
        }
        return;
      }
      fail(res, 404, new ServiceError('E_NOT_FOUND', 'error.E_NOT_FOUND', { path: pathname }, 404));
      return;
    }

    if (deps.config.webDistPath && (method === 'GET' || method === 'HEAD')) {
      const root = deps.config.webDistPath;
      const { publicUrl } = deps.config;
      if (pathname === '/' || pathname === '/index.html') {
        if (serveIndex(req, res, root, publicUrl)) return;
      } else if (serveStatic(res, root, pathname)) return;
      // Single-page application fallback.
      if (serveIndex(req, res, root, publicUrl)) return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  };
}
