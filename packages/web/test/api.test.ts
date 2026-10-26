import { describe, expect, it, vi } from 'vitest';
import { ApiClient, type FetchLike, type HttpResponseLike } from '../src/api/client.ts';
import { makeConfig } from '../src/test/fixtures.ts';

function jsonResponse(status: number, body: unknown): HttpResponseLike {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
  credentials: string;
}

function recordingFetch(
  responder: (call: Call) => HttpResponseLike | Promise<HttpResponseLike>,
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
      credentials: init?.credentials ?? '',
    };
    calls.push(call);
    return responder(call);
  };
  return { fetch: fetchImpl, calls };
}

describe('ApiClient', () => {
  it('issues the documented request shape with same-origin credentials', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(200, { ok: true, data: makeConfig() }));
    const api = new ApiClient(fetch, '');
    const result = await api.getConfig();
    expect(result.ok).toBe(true);
    expect(calls[0]).toMatchObject({ url: '/api/config', method: 'GET', credentials: 'same-origin' });
  });

  it('serialises a command request verbatim', async () => {
    const { fetch, calls } = recordingFetch(() =>
      jsonResponse(200, {
        ok: true,
        data: { commandId: 'c1', outcome: 'accepted', revision: 13, events: [] },
      }),
    );
    const api = new ApiClient(fetch);
    await api.sendCommand('g1', {
      commandId: 'c1',
      expectedRevision: 12,
      command: { type: 'build.road', edge: 41 },
    });
    expect(calls[0]!.url).toBe('/api/games/g1/commands');
    expect(calls[0]!.body).toEqual({
      commandId: 'c1',
      expectedRevision: 12,
      command: { type: 'build.road', edge: 41 },
    });
  });

  it('encodes query parameters and skips undefined ones', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(200, { ok: true, data: { rooms: [] } }));
    const api = new ApiClient(fetch);
    await api.listRooms({ playerCount: 4, hasSeats: true });
    expect(calls[0]!.url).toBe('/api/rooms?hasSeats=true&playerCount=4');
    await api.getChat('r 1', { after: 7, limit: 50 });
    expect(calls[1]!.url).toBe('/api/rooms/r%201/chat?after=7&limit=50');
  });

  it('returns a typed network error instead of throwing', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('socket hang up');
    };
    const api = new ApiClient(fetchImpl);
    const result = await api.getGame('g1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('E_NETWORK');
      expect(result.error.messageId).toBe('error.E_NETWORK');
    }
  });

  it('surfaces a server rejection envelope unchanged', async () => {
    const { fetch } = recordingFetch(() =>
      jsonResponse(200, {
        ok: false,
        error: { code: 'E_ILLEGAL_TARGET', messageId: 'error.E_ILLEGAL_TARGET', params: { edge: 3 } },
      }),
    );
    const api = new ApiClient(fetch);
    const result = await api.sendCommand('g1', {
      commandId: 'c2',
      expectedRevision: 1,
      command: { type: 'build.road', edge: 3 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.params).toEqual({ edge: 3 });
  });

  it('tolerates a non-JSON error body', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    })) as unknown as FetchLike;
    const api = new ApiClient(fetchImpl);
    const result = await api.getSession();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.messageId).toBe('error.unknown');
  });
});
