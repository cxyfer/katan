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
    // 已啟用的非 T&B 矩陣列是 21 個（含 S2–S9 全部的 Seafarers 劇本）；沒有只登記未啟用的 profile。
    expect(profiles.profiles.filter((profile) => !profile.id.startsWith('tb-') && profile.enabled).length).toBe(21);
    expect(profiles.profiles.filter((profile) => !profile.id.startsWith('tb-') && !profile.enabled).length).toBe(0);
    expect(profiles.selectable.filter((id) => !id.startsWith('tb-'))).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025', 'ck-2025', 'ck-paired-2025', 'sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025', 'sf-four-islands-2025', 'sf-fog-islands-2025', 'sf-through-the-desert-2025', 'sf-forgotten-tribe-2025', 'sf-cloth-for-catan-2025', 'sf-pirate-islands-2025', 'sf-wonders-of-catan-2025', 'sf-new-world-2025', 'ep-land-ho-2025', 'ep-pirate-lairs-2025', 'ep-fish-2025', 'ep-spices-2025', 'ep-full-2025']);
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

describe('legacy session cookie', () => {
  async function tokenOf(nickname: string): Promise<{ token: string; playerId: string }> {
    const client = await harness.client(nickname);
    const [name, token] = client.cookie!.split('=');
    expect(name).toBe('katan_session');
    return { token: token!, playerId: client.playerId! };
  }

  it('keeps a 0.4.x catan_session identity and renames the cookie', async () => {
    const { token, playerId } = await tokenOf('Legacy');
    const response = await fetch(`${harness.base}/api/session`, { headers: { cookie: `catan_session=${token}` } });
    const body = (await response.json()) as { data: { player: { id: string } } };
    expect(body.data.player.id).toBe(playerId);
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith(`katan_session=${token};`))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith('catan_session=;') && cookie.includes('Max-Age=0'))).toBe(true);
  });

  it('falls back to a valid legacy cookie when the current one is stale', async () => {
    const legacy = await tokenOf('Fallback');
    const response = await fetch(`${harness.base}/api/session`, {
      headers: { cookie: `katan_session=stale-token; catan_session=${legacy.token}` },
    });
    const body = (await response.json()) as { data: { player: { id: string } } };
    expect(body.data.player.id).toBe(legacy.playerId);
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith(`katan_session=${legacy.token};`))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith('catan_session=;') && cookie.includes('Max-Age=0'))).toBe(true);
  });

  it('keeps a legacy cookie that still holds another identity', async () => {
    const current = await tokenOf('Current');
    const other = await tokenOf('Other');
    const response = await fetch(`${harness.base}/api/session`, {
      headers: { cookie: `catan_session=${other.token}; katan_session=${current.token}` },
    });
    const body = (await response.json()) as { data: { player: { id: string } } };
    expect(body.data.player.id).toBe(current.playerId);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('clears a legacy cookie that is already migrated or no longer resolves', async () => {
    const current = await tokenOf('Migrated');
    for (const legacy of [current.token, 'unknown-token']) {
      const response = await fetch(`${harness.base}/api/session`, {
        headers: { cookie: `catan_session=${legacy}; katan_session=${current.token}` },
      });
      const cookies = response.headers.getSetCookie();
      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toMatch(/^catan_session=;.*Max-Age=0/);
    }
  });

  it('sends no cookie rewrite to a browser that already uses the current name', async () => {
    const { token } = await tokenOf('Settled');
    const response = await fetch(`${harness.base}/api/session`, { headers: { cookie: `katan_session=${token}` } });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('clears both cookie names on sign-out', async () => {
    const { token } = await tokenOf('Leaving');
    const response = await fetch(`${harness.base}/api/session`, {
      method: 'DELETE',
      headers: { cookie: `catan_session=${token}` },
    });
    const cleared = response.headers
      .getSetCookie()
      .filter((cookie) => cookie.includes('Max-Age=0'))
      .map((cookie) => cookie.split('=')[0]);
    expect(cleared).toEqual(expect.arrayContaining(['katan_session', 'catan_session']));
    // 登出的清除排在遷移 cookie 之後，瀏覽器最後看到的 katan_session 是清除
    const last = response.headers.getSetCookie().filter((cookie) => cookie.startsWith('katan_session=')).at(-1);
    expect(last).toContain('Max-Age=0');
  });
});
