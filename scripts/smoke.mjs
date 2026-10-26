/**
 * Post-build smoke test.
 *
 * Boots the bundled service against the built client and plays a complete
 * three-player initial placement through the public HTTP API, so the shipped
 * artefacts are exercised together rather than only through unit tests.
 *
 * Usage: node scripts/smoke.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const serverEntry = join(root, 'packages/server/dist/server.mjs');
const webDist = join(root, 'packages/web/dist');
const port = Number(process.env.SMOKE_PORT ?? 3411);
// With SMOKE_BASE_URL the script verifies an already-running deployment
// (for example the published container) instead of spawning a local service.
const externalBase = process.env.SMOKE_BASE_URL ?? null;

if (!externalBase && !existsSync(serverEntry)) {
  console.error(`missing ${serverEntry}; run "pnpm build" first`);
  process.exit(1);
}
if (!externalBase && !existsSync(join(webDist, 'index.html'))) {
  console.error(`missing ${webDist}/index.html; run "pnpm --filter @catan/web build" first`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), 'catan-smoke-'));
const child = externalBase
  ? null
  : spawn('node', [serverEntry], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        SQLITE_PATH: join(dataDir, 'smoke.sqlite'),
        WEB_DIST_PATH: webDist,
        LOG_LEVEL: 'warn',
      },
    });

const log = [];
child?.stdout.on('data', (chunk) => log.push(String(chunk)));
child?.stderr.on('data', (chunk) => log.push(String(chunk)));

const base = externalBase ?? `http://127.0.0.1:${port}`;
const checks = [];

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
}

async function waitForHealth(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  return false;
}

function client() {
  const state = { cookie: null, playerId: null };
  return {
    state,
    get playerId() {
      return state.playerId;
    },
    async call(method, path, body) {
      const headers = {};
      if (state.cookie) headers.cookie = state.cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) state.cookie = setCookie.split(';')[0];
      const payload = await response.json();
      if (!payload.ok) {
        throw new Error(`${method} ${path} → ${payload.error.code}: ${payload.error.messageId}`);
      }
      return payload.data;
    },
    post(path, body) {
      return this.call('POST', path, body ?? {});
    },
    get(path) {
      return this.call('GET', path);
    },
  };
}

function commandId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

try {
  record('service answers /healthz', await waitForHealth());

  const index = await fetch(`${base}/`);
  const html = await index.text();
  record(
    'built client is served from the same origin',
    index.ok && html.includes('<div id="root"'),
    `${html.length} bytes`,
  );
  const assetPath = /src="([^"]+\.js)"/.exec(html)?.[1];
  if (assetPath) {
    const asset = await fetch(`${base}${assetPath}`);
    record('client bundle is reachable', asset.ok, assetPath);
  }

  const players = [client(), client(), client()];
  for (const [index_, player] of players.entries()) {
    const session = await player.post('/api/session', { nickname: `Smoke${index_ + 1}`, locale: 'en' });
    player.state.playerId = session.player.id;
  }
  record('guest sessions issued', players.every((player) => player.playerId !== null));

  const config = await players[0].get('/api/config');
  record('configuration is published', config.locales.length === 2, config.locales.join(','));

  const room = await players[0].post('/api/rooms', {
    visibility: 'public',
    capacity: 3,
    profileId: 'base-2025',
    setupMode: 'fixed',
  });
  // A public room is discoverable only while it still has an open seat.
  const listed = await players[0].get('/api/rooms');
  record(
    'public room with an open seat is discoverable',
    listed.rooms.some((entry) => entry.id === room.id && entry.openSeats > 0),
  );
  for (const player of players.slice(1)) await player.post('/api/rooms/join', { code: room.code });
  const full = await players[0].get('/api/rooms');
  record(
    'a full lobby is no longer advertised',
    !full.rooms.some((entry) => entry.id === room.id),
  );

  for (const player of players) await player.post(`/api/rooms/${room.id}/ready`, { ready: true });
  const started = await players[0].post(`/api/rooms/${room.id}/start`);
  record('game starts once every seat is ready', typeof started.gameId === 'string');

  let revision = 1;
  let view = (await players[0].get(`/api/games/${started.gameId}`)).view;
  let steps = 0;
  while (view.turn.phase === 'setup' && steps < 60) {
    steps += 1;
    const actor = players.find((player) => player.playerId === view.turn.playerId);
    const hints = (await actor.get(`/api/games/${started.gameId}`)).view.hints;
    const command =
      view.turn.setup.stage === 'road'
        ? { type: 'setup.placeRoad', edge: hints.legalRoads[0] }
        : { type: 'setup.placeBuilding', vertex: hints.legalSettlements[0] };
    const receipt = await actor.post(`/api/games/${started.gameId}/commands`, {
      commandId: commandId(`setup-${steps}`),
      expectedRevision: revision,
      command,
    });
    if (receipt.outcome !== 'accepted') {
      throw new Error(`setup step ${steps} rejected: ${receipt.error?.messageId}`);
    }
    revision = receipt.revision;
    view = (await players[0].get(`/api/games/${started.gameId}`)).view;
  }
  record(
    'initial placement completes through the API',
    view.turn.phase === 'preroll',
    `${steps} commands, revision ${revision}`,
  );
  record(
    'board has the base inventory',
    view.board.buildings.filter(Boolean).length === 6 && view.board.roads.filter(Boolean).length === 6,
  );

  const actor = players.find((player) => player.playerId === view.turn.playerId);
  const rolled = await actor.post(`/api/games/${started.gameId}/commands`, {
    commandId: commandId('roll'),
    expectedRevision: revision,
    command: { type: 'turn.roll' },
  });
  record('a dice roll is accepted', rolled.outcome === 'accepted', `revision ${rolled.revision}`);

  const chat = await players[0].post(`/api/rooms/${room.id}/chat`, {
    clientMessageId: 'smoke-1',
    text: 'hello from the smoke test',
  });
  record('room chat accepts a message', chat.text === 'hello from the smoke test');

  const hidden = (await players[1].get(`/api/games/${started.gameId}`)).view.players.find(
    (player) => player.id === players[0].playerId,
  );
  record('other seats never receive hidden resources', hidden.resources === undefined);
} catch (error) {
  record('smoke run completed without an exception', false, String(error));
} finally {
  if (child) {
    child.kill('SIGTERM');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  rmSync(dataDir, { recursive: true, force: true });
}

const failed = checks.filter((check) => !check.ok);
process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
if (failed.length > 0 && log.length > 0) {
  process.stdout.write(`service output:\n${log.join('').slice(-2000)}\n`);
}
process.exit(failed.length === 0 ? 0 : 1);
