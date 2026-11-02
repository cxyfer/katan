/** Guest identity, nickname validation and session cookies. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type TestHarness } from './helpers.ts';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

describe('guest session', () => {
  it('issues an HTTP-only cookie and a stable player id', async () => {
    const response = await fetch(`${harness.base}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: '  Alice  ', locale: 'en' }),
    });
    const body = (await response.json()) as { ok: boolean; data: { player: { id: string; nickname: string; locale: string } } };
    expect(body.ok).toBe(true);
    expect(body.data.player.nickname).toBe('Alice');
    expect(body.data.player.locale).toBe('en');
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toContain(body.data.player.id);
  });

  it('recognises the same browser on the next request', async () => {
    const client = await harness.client('Bob');
    const first = client.expectOk<{ player: { id: string } }>(await client.get('/api/session'));
    const second = client.expectOk<{ player: { id: string } }>(await client.get('/api/session'));
    expect(second.player.id).toBe(first.player.id);
  });

  it('allows changing the display nickname without changing the player id', async () => {
    const client = await harness.client('Carol');
    const before = client.expectOk<{ player: { id: string } }>(await client.get('/api/session'));
    const updated = client.expectOk<{ player: { id: string; nickname: string } }>(
      await client.patch('/api/session', { nickname: 'Carolyn' }),
    );
    expect(updated.player.nickname).toBe('Carolyn');
    expect(updated.player.id).toBe(before.player.id);
  });

  it('rejects empty, over-long and control-character nicknames', async () => {
    const client = await harness.client('Dave');
    client.expectError(await client.patch('/api/session', { nickname: '   ' }), 'E_BAD_REQUEST');
    client.expectError(
      await client.patch('/api/session', { nickname: 'x'.repeat(200) }),
      'E_BAD_REQUEST',
    );
    client.expectError(await client.patch('/api/session', { nickname: 'bad\u0007name' }), 'E_BAD_REQUEST');
  });

  it('rejects unauthenticated room creation', async () => {
    const response = await fetch(`${harness.base}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: 'private', capacity: 3, profileId: 'base-2025' }),
    });
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('E_NO_SESSION');
    expect(response.status).toBe(401);
  });

  it('publishes the profile matrix and configuration', async () => {
    const client = await harness.client('Erin');
    const profiles = client.expectOk<{ profiles: { id: string; enabled: boolean }[]; selectable: string[] }>(
      await client.get('/api/profiles'),
    );
    expect(profiles.profiles.length).toBe(13);
    expect(profiles.selectable).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025', 'ep-land-ho-2025', 'ep-pirate-lairs-2025', 'ep-fish-2025', 'ep-spices-2025', 'ep-full-2025']);
    const config = client.expectOk<{ limits: { chatMaxLength: number }; defaultPolicy: { disconnectGraceSeconds: number } }>(
      await client.get('/api/config'),
    );
    expect(config.limits.chatMaxLength).toBeGreaterThan(0);
    expect(config.defaultPolicy.disconnectGraceSeconds).toBe(300);
  });

  it('serves health and readiness', async () => {
    const health = await fetch(`${harness.base}/healthz`);
    expect(health.status).toBe(200);
    const ready = await fetch(`${harness.base}/readyz`);
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as { data: { status: string; database: string } };
    expect(body.data.status).toBe('ready');
  });
});
