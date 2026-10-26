/**
 * Transport contract regression.
 *
 * The browser's native `fetch` enforces its receiver: invoking it as a method
 * of any other object throws `TypeError: ... Illegal invocation`. The client
 * adopts the host's `fetch`, so it must call it as a plain function. A fake
 * transport written as an arrow function cannot catch a violation of that
 * contract, which is how the defect originally escaped the suite.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient, type FetchLike, type HttpResponseLike } from '../src/api/client.ts';

interface ReceiverSensitiveCall {
  url: string;
  receiver: unknown;
}

/**
 * Mimics the browser: it throws unless the receiver is undefined (a plain
 * call) or the global object (an explicit `window.fetch(...)` call).
 */
function browserLikeFetch(): { fetch: FetchLike; calls: ReceiverSensitiveCall[] } {
  const calls: ReceiverSensitiveCall[] = [];
  const impl = function (this: unknown, url: string): Promise<HttpResponseLike> {
    calls.push({ url, receiver: this });
    if (this !== undefined && this !== globalThis) {
      return Promise.reject(
        new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"),
      );
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { locales: ['zh-Hant', 'en'] } }),
    });
  };
  return { fetch: impl as unknown as FetchLike, calls };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('transport receiver contract', () => {
  it('calls an injected transport as a plain function, never as a client method', async () => {
    const { fetch, calls } = browserLikeFetch();
    const client = createApiClient(fetch);
    const result = await client.getConfig();
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    // A plain call: the receiver is undefined, never the ApiClient instance.
    expect(calls[0]!.receiver).toBeUndefined();
  });

  it('calls the adopted global fetch as a plain function too', async () => {
    const { fetch, calls } = browserLikeFetch();
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const client = createApiClient();
    const result = await client.getConfig();
    expect(result.ok).toBe(true);
    expect(calls[0]!.receiver).toBeUndefined();
  });

  it('still reports a genuine transport failure as E_NETWORK', async () => {
    const failing: FetchLike = () => Promise.reject(new TypeError('network down'));
    const client = createApiClient(failing);
    const result = await client.getConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('E_NETWORK');
  });

  it('reports a rejection reason of the client only when the host rejects the receiver', async () => {
    // Guards the regression test itself: if this fake were receiver-tolerant,
    // it could not detect the defect it exists to prevent.
    const { fetch } = browserLikeFetch();
    const asMethod = { transport: fetch as unknown as (url: string) => Promise<HttpResponseLike> };
    await expect(asMethod.transport('/api/config')).rejects.toThrow(/Illegal invocation/);
  });
});
