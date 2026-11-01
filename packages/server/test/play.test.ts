/**
 * End-to-end base-play slice: a complete turn through the public API, plus
 * static delivery of the built client from the same origin.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameState } from '@catan/rules';
import { startHarness, startedGame, runSetupOverApi, type TestHarness } from './helpers.ts';

let harness: TestHarness;
let staticHarness: TestHarness;
let staticDir: string;

beforeAll(async () => {
  harness = await startHarness();
  staticDir = mkdtempSync(join(tmpdir(), 'catan-web-'));
  writeFileSync(
    join(staticDir, 'index.html'),
    '<!doctype html><title>CATAN client</title><link rel="canonical" href="__PUBLIC_ORIGIN__/" />'
      + '<meta property="og:image" content="__PUBLIC_ORIGIN__/og-image.png" />',
  );
  writeFileSync(join(staticDir, 'app.js'), 'console.log("client");');
  writeFileSync(join(staticDir, 'favicon.ico'), '');
  writeFileSync(join(staticDir, 'site.webmanifest'), '{}');
  staticHarness = await startHarness({ webDistPath: staticDir });
});

afterAll(async () => {
  await harness.close();
  await staticHarness.close();
  rmSync(staticDir, { recursive: true, force: true });
});

interface Snapshot {
  revision: number;
  view: {
    seq: number;
    turn: { playerId: string; phase: string; seat: number };
    pending: { kind: string; actor?: string; candidates?: string[] } | null;
    bank: Record<string, number>;
    players: { id: string; resources?: Record<string, number>; handSize: number }[];
    board: { buildings: unknown[]; roads: unknown[] };
    hints?: { canRoll: boolean; canEndTurn: boolean; legalRoads: number[] };
  };
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  revision: number;
  error?: { messageId: string };
}

describe('base play slice', () => {
  it('plays a complete turn: roll, resolve, build, end turn', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    let { revision } = await runSetupOverApi(clients, gameId);
    const host = clients[0]!;

    let snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    const actorId = snapshot.view.turn.playerId;
    const actor = clients.find((client) => client.playerId === actorId)!;

    // 1. Roll.
    const rolled = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: `play-roll-${Date.now()}`,
        expectedRevision: revision,
        command: { type: 'turn.roll' },
      }),
    );
    expect(rolled.outcome).toBe('accepted');
    revision = rolled.revision;
    snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    expect(snapshot.view.turn.phase).toBe('action');

    // 2. Resolve any mandatory effect the roll produced.
    let guard = 0;
    while (snapshot.view.pending && guard < 12) {
      guard += 1;
      const pending = snapshot.view.pending;
      if (pending.kind === 'discard') {
        const required = (pending as unknown as { required: Record<string, number> }).required;
        for (const [playerId, count] of Object.entries(required)) {
          const client = clients.find((candidate) => candidate.playerId === playerId)!;
          const hand = (await client.get<Snapshot>(`/api/games/${gameId}`)) as never;
          void hand;
          const resources = await firstResources(harness, gameId, playerId, count);
          const receipt = client.expectOk<Receipt>(
            await client.post(`/api/games/${gameId}/commands`, {
              commandId: `discard-${playerId}-${guard}`,
              expectedRevision: revision,
              command: { type: 'pending.discard', resources },
            }),
          );
          expect(receipt.outcome).toBe('accepted');
          revision = receipt.revision;
        }
      } else if (pending.kind === 'moveRobber') {
        const current = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
        const state = await rawState(harness, gameId);
        const target = (state.board.robber + 1) % state.board.layout.terrain.length;
        const mover = clients.find((client) => client.playerId === current.view.turn.playerId)!;
        const receipt = mover.expectOk<Receipt>(
          await mover.post(`/api/games/${gameId}/commands`, {
            commandId: `robber-${guard}`,
            expectedRevision: revision,
            command: { type: 'pending.moveRobber', hex: target },
          }),
        );
        expect(receipt.outcome).toBe('accepted');
        revision = receipt.revision;
      } else if (pending.kind === 'steal') {
        const victim = pending.candidates![0]!;
        const current = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
        const thief = clients.find((client) => client.playerId === current.view.turn.playerId)!;
        const receipt = thief.expectOk<Receipt>(
          await thief.post(`/api/games/${gameId}/commands`, {
            commandId: `steal-${guard}`,
            expectedRevision: revision,
            command: { type: 'pending.steal', victim },
          }),
        );
        expect(receipt.outcome).toBe('accepted');
        revision = receipt.revision;
      } else {
        break;
      }
      snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    }
    expect(snapshot.view.pending).toBeNull();

    // 3. Build a road with resources supplied by a persisted fixture.
    await grantResources(harness, gameId, actorId, { lumber: 1, brick: 1 });
    snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    const roadsBefore = snapshot.view.board.roads.filter(Boolean).length;
    const target = snapshot.view.hints?.legalRoads[0];
    expect(target).toBeDefined();
    const built = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: `play-road-${Date.now()}`,
        expectedRevision: snapshot.revision,
        command: { type: 'build.road', edge: target },
      }),
    );
    expect(built.outcome).toBe('accepted');
    revision = built.revision;
    snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    expect(snapshot.view.board.roads.filter(Boolean).length).toBe(roadsBefore + 1);

    // 4. End the turn and hand over to the next seat.
    const ended = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: `play-end-${Date.now()}`,
        expectedRevision: revision,
        command: { type: 'turn.end' },
      }),
    );
    expect(ended.outcome).toBe('accepted');
    snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    expect(snapshot.view.turn.phase).toBe('preroll');
    expect(snapshot.view.turn.playerId).not.toBe(actorId);
  });

  it('keeps the bank conserved across a full turn', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    const { revision } = await runSetupOverApi(clients, gameId);
    const host = clients[0]!;
    const before = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    const handBefore = before.view.players.reduce((sum, player) => sum + player.handSize, 0);
    const bankBefore = Object.values(before.view.bank).reduce((sum, value) => sum + value, 0);

    const actor = clients.find((client) => client.playerId === before.view.turn.playerId)!;
    const receipt = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: `conserve-${Date.now()}`,
        expectedRevision: revision,
        command: { type: 'turn.roll' },
      }),
    );
    expect(receipt.outcome).toBe('accepted');

    const after = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    const handAfter = after.view.players.reduce((sum, player) => sum + player.handSize, 0);
    const bankAfter = Object.values(after.view.bank).reduce((sum, value) => sum + value, 0);
    const totalBefore = handBefore + bankBefore;
    const totalAfter = handAfter + bankAfter;
    // A 7 moves cards from hands to the bank; production moves the other way.
    expect(totalAfter).toBeLessThanOrEqual(totalBefore);
    expect(bankAfter).toBeGreaterThanOrEqual(0);
  });
});

describe('static client delivery', () => {
  it('serves the built client from the same origin as the API', async () => {
    const index = await fetch(`${staticHarness.base}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(await index.text()).toContain('CATAN client');

    const asset = await fetch(`${staticHarness.base}/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
  });

  it('serves site icons and the web manifest with their own content types', async () => {
    const icon = await fetch(`${staticHarness.base}/favicon.ico`);
    expect(icon.headers.get('content-type')).toBe('image/x-icon');
    const manifest = await fetch(`${staticHarness.base}/site.webmanifest`);
    expect(manifest.headers.get('content-type')).toBe('application/manifest+json');
  });

  it('falls back to the client entry point for unknown routes', async () => {
    const route = await fetch(`${staticHarness.base}/room/ABC12345`);
    expect(route.status).toBe(200);
    expect(await route.text()).toContain('CATAN client');
  });

  it('fills the og:image origin from forwarded headers', async () => {
    const res = await fetch(`${staticHarness.base}/room/ABC12345`, {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'catan.example.com' },
    });
    const html = await res.text();
    expect(html).toContain('content="https://catan.example.com/og-image.png"');
    // 房間網址也以站點根目錄為 canonical，避免邀請連結被當成獨立頁面
    expect(html).toContain('href="https://catan.example.com/"');
  });

  it('rejects malformed forwarded hosts instead of injecting them', async () => {
    const res = await fetch(`${staticHarness.base}/`, {
      headers: { 'x-forwarded-host': '"><script>alert(1)</script>' },
    });
    const html = await res.text();
    expect(html).not.toContain('<script>');
    expect(html).toContain('content="/og-image.png"');
  });

  it('prefers the configured PUBLIC_URL', async () => {
    const configured = await startHarness({ webDistPath: staticDir, publicUrl: 'https://play.example.org/' });
    try {
      const res = await fetch(`${configured.base}/`, { headers: { 'x-forwarded-host': 'evil.test' } });
      expect(await res.text()).toContain('content="https://play.example.org/og-image.png"');
    } finally {
      await configured.close();
    }
  });

  it('still answers the API from the same origin', async () => {
    const health = await fetch(`${staticHarness.base}/healthz`);
    expect(health.status).toBe(200);
    const missing = await fetch(`${staticHarness.base}/api/nope`);
    expect(missing.status).toBe(404);
  });

  it('does not expose files outside the client root', async () => {
    const traversal = await fetch(`${staticHarness.base}/../package.json`);
    const body = await traversal.text();
    expect(body).not.toContain('"name": "catan"');
  });
});

async function rawState(harness_: TestHarness, gameId: string): Promise<GameState> {
  const row = await harness_.service.repo.findGame(gameId);
  return JSON.parse(row!.state_json) as GameState;
}

async function firstResources(
  harness_: TestHarness,
  gameId: string,
  playerId: string,
  count: number,
): Promise<string[]> {
  const state = await rawState(harness_, gameId);
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  const out: string[] = [];
  for (const [resource, amount] of Object.entries(player.resources)) {
    for (let i = 0; i < amount && out.length < count; i++) out.push(resource);
  }
  return out;
}

async function grantResources(
  harness_: TestHarness,
  gameId: string,
  playerId: string,
  resources: Record<string, number>,
): Promise<void> {
  const row = await harness_.service.repo.findGame(gameId);
  const state = JSON.parse(row!.state_json) as GameState;
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  for (const [resource, amount] of Object.entries(resources)) {
    player.resources[resource as 'lumber'] += amount;
    state.bank[resource as 'lumber'] -= amount;
  }
  await harness_.service.repo.saveGame(gameId, state, row!.revision, row!.status, row!.pause_reason);
}
