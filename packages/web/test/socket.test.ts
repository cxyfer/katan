import { describe, expect, it, vi } from 'vitest';
import { parseServerMessage, SocketClient, UNSUBSCRIBE_ACK_TIMEOUT_MS, type SocketLike } from '../src/api/socket.ts';
import type { ClientMessage, ServerMessage } from '@catan/protocol';

class FakeSocket implements SocketLike {
  readonly sent: string[] = [];
  closed = false;
  #open: (() => void) | null = null;
  #close: ((info: { code: number; reason: string }) => void) | null = null;
  #message: ((data: string) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  onOpen(handler: () => void): void {
    this.#open = handler;
  }
  onClose(handler: (info: { code: number; reason: string }) => void): void {
    this.#close = handler;
  }
  onMessage(handler: (data: string) => void): void {
    this.#message = handler;
  }
  onError(): void {
    // unused
  }

  simulateOpen(): void {
    this.#open?.();
  }
  simulateClose(): void {
    this.#close?.({ code: 1006, reason: 'lost' });
  }
  simulateMessage(data: string): void {
    this.#message?.(data);
  }
}

describe('parseServerMessage', () => {
  it('accepts known envelopes and rejects unknown or malformed ones', () => {
    expect(parseServerMessage('{"type":"pong","payload":{"at":"x"}}')).toEqual({
      type: 'pong',
      payload: { at: 'x' },
    });
    expect(parseServerMessage('{"type":"unsubscribed","payload":{"roomId":null}}')).toEqual({
      type: 'unsubscribed',
      payload: { roomId: null },
    });
    expect(parseServerMessage('{"type":"not-a-message"}')).toBeNull();
    expect(parseServerMessage('not json')).toBeNull();
    expect(parseServerMessage('"string"')).toBeNull();
  });
});

describe('SocketClient', () => {
  it('reports status, replays the subscription after a reconnect and pings', () => {
    const sockets: FakeSocket[] = [];
    const scheduled: Array<() => void> = [];
    const statuses: string[] = [];
    const messages: ServerMessage[] = [];

    const client = new SocketClient({
      url: 'ws://example/ws',
      factory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: (handler) => scheduled.push(handler),
      onStatus: (status) => statuses.push(status),
      onMessage: (message) => messages.push(message),
    });

    client.connect();
    expect(statuses).toEqual(['connecting']);
    expect(sockets).toHaveLength(1);

    sockets[0]!.simulateOpen();
    expect(statuses).toEqual(['connecting', 'open']);

    client.subscribe({ roomId: 'r1', gameId: 'g1' });
    const first = JSON.parse(sockets[0]!.sent[0]!) as ClientMessage;
    expect(first).toEqual({ type: 'subscribe', payload: { roomId: 'r1', gameId: 'g1' } });

    client.ping();
    expect(JSON.parse(sockets[0]!.sent[1]!)).toEqual({ type: 'ping' });

    sockets[0]!.simulateMessage('{"type":"notice","payload":{"messageId":"lobby.settingsSaved"}}');
    expect(messages).toHaveLength(1);
    sockets[0]!.simulateMessage('garbage');
    expect(messages).toHaveLength(1);

    sockets[0]!.simulateClose();
    expect(statuses.at(-1)).toBe('closed');
    expect(scheduled).toHaveLength(1);

    // Reconnect: a fresh socket opens and re-subscribes without the caller
    // doing anything.
    scheduled[0]!();
    expect(sockets).toHaveLength(2);
    sockets[1]!.simulateOpen();
    expect(JSON.parse(sockets[1]!.sent[0]!)).toEqual({
      type: 'subscribe',
      payload: { roomId: 'r1', gameId: 'g1' },
    });
    expect(client.attempt).toBe(0);
  });

  it('backs off exponentially and stops reconnecting after an explicit close', () => {
    const delays: number[] = [];
    const scheduled: Array<() => void> = [];
    const sockets: FakeSocket[] = [];
    const client = new SocketClient({
      url: 'ws://example/ws',
      factory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: (handler, delay) => {
        delays.push(delay);
        scheduled.push(handler);
      },
      onMessage: () => undefined,
    });

    client.connect();
    sockets[0]!.simulateClose();
    scheduled[0]!();
    sockets[1]!.simulateClose();
    expect(delays).toEqual([500, 1000]);

    client.close();
    scheduled[1]!();
    const before = delays.length;
    sockets[2]!.simulateClose();
    expect(delays).toHaveLength(before);
  });
});

describe('SocketClient.unsubscribe', () => {
  function connected(options: { unsubscribeTimeoutMs?: number } = {}) {
    const sockets: FakeSocket[] = [];
    const scheduled: Array<() => void> = [];
    const client = new SocketClient({
      url: 'ws://example/ws',
      factory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: (handler) => void scheduled.push(handler),
      onMessage: () => undefined,
      ...options,
    });
    client.connect();
    sockets[0]!.simulateOpen();
    return { client, sockets, scheduled };
  }
  const ack = (roomId: string | null = 'r1') => JSON.stringify({ type: 'unsubscribed', payload: { roomId } });
  const sentOf = (socket: FakeSocket) => socket.sent.map((raw) => JSON.parse(raw));

  it('sends an empty subscribe and resolves once the server acknowledges it', async () => {
    const { client, sockets } = connected();
    client.subscribe({ roomId: 'r1', gameId: 'g1' });
    let result: unknown = null;
    const pending = client.unsubscribe().then((value) => { result = value; });
    expect(sentOf(sockets[0]!)).toEqual([
      { type: 'subscribe', payload: { roomId: 'r1', gameId: 'g1' } },
      { type: 'subscribe', payload: {} },
    ]);
    // 確認還沒到之前不會 resolve。
    await Promise.resolve();
    expect(result).toBeNull();
    sockets[0]!.simulateMessage(ack());
    await pending;
    // 結果保留確認的內容，呼叫端之後可以從裡面取值。
    expect(result).toEqual({ outcome: 'acked', ack: { roomId: 'r1' } });
  });

  it('keeps the whole acknowledgement payload, including fields added later', async () => {
    const { client, sockets } = connected();
    client.subscribe({ roomId: 'r1' });
    const pending = client.unsubscribe();
    sockets[0]!.simulateMessage(JSON.stringify({ type: 'unsubscribed', payload: { roomId: 'r1', entryEpoch: 7 } }));
    expect(await pending).toEqual({ outcome: 'acked', ack: { roomId: 'r1', entryEpoch: 7 } });
  });

  it('shares one request between concurrent calls', async () => {
    const { client, sockets } = connected();
    client.subscribe({ roomId: 'r1' });
    const first = client.unsubscribe();
    const second = client.unsubscribe();
    expect(second).toBe(first);
    expect(sentOf(sockets[0]!).filter((message) => message.payload.roomId === undefined)).toHaveLength(1);
    sockets[0]!.simulateMessage(ack());
    expect(await first).toEqual({ outcome: 'acked', ack: { roomId: 'r1' } });
  });

  it('does not replay the old subscription after an acknowledged unsubscribe and a reconnect', async () => {
    const { client, sockets, scheduled } = connected();
    client.subscribe({ roomId: 'r1', gameId: 'g1' });
    const pending = client.unsubscribe();
    sockets[0]!.simulateMessage(ack());
    await pending;

    sockets[0]!.simulateClose();
    scheduled[0]!();
    sockets[1]!.simulateOpen();
    expect(sockets[1]!.sent).toEqual([]);
  });

  it('resolves immediately, and sends nothing, when the socket is not open', async () => {
    const socket = new FakeSocket();
    const client = new SocketClient({ url: 'ws://example/ws', factory: () => socket, onMessage: () => undefined });
    client.connect(); // 尚未 open
    client.subscribe({ roomId: 'r1' });
    const before = socket.sent.length;
    expect(await client.unsubscribe()).toEqual({ outcome: 'disconnected' });
    expect(socket.sent).toHaveLength(before);
    // 之後連上線也不會訂回去，也沒有送出取消訂閱。
    socket.simulateOpen();
    expect(socket.sent).toHaveLength(before);
  });

  it('resolves immediately when the socket has closed', async () => {
    const { client, sockets } = connected();
    client.subscribe({ roomId: 'r1' });
    sockets[0]!.simulateClose();
    expect(await client.unsubscribe()).toEqual({ outcome: 'disconnected' });
  });

  it('resolves as disconnected when the socket closes while waiting', async () => {
    const { client, sockets } = connected();
    client.subscribe({ roomId: 'r1' });
    const pending = client.unsubscribe();
    sockets[0]!.simulateClose();
    expect(await pending).toEqual({ outcome: 'disconnected' });
  });

  it('resolves as timeout when the acknowledgement never arrives', async () => {
    vi.useFakeTimers();
    try {
      const { client } = connected({ unsubscribeTimeoutMs: 100 });
      client.subscribe({ roomId: 'r1' });
      const pending = client.unsubscribe();
      await vi.advanceTimersByTimeAsync(99);
      let settled = false;
      void pending.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ outcome: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults to a three second wait', async () => {
    expect(UNSUBSCRIBE_ACK_TIMEOUT_MS).toBe(3000);
  });

  it('a late acknowledgement after the timeout does nothing', async () => {
    vi.useFakeTimers();
    try {
      const { client, sockets } = connected({ unsubscribeTimeoutMs: 50 });
      client.subscribe({ roomId: 'r1' });
      const pending = client.unsubscribe();
      await vi.advanceTimersByTimeAsync(50);
      expect(await pending).toEqual({ outcome: 'timeout' });
      sockets[0]!.simulateMessage(ack());
      // 之後可以再次訂閱並再次取消。
      client.subscribe({ roomId: 'r1' });
      const again = client.unsubscribe();
      sockets[0]!.simulateMessage(ack());
      expect(await again).toEqual({ outcome: 'acked', ack: { roomId: 'r1' } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('is idle, and stays silent, when nothing is subscribed', async () => {
    const { client, sockets } = connected();
    expect(await client.unsubscribe()).toEqual({ outcome: 'idle' });
    expect(sockets[0]!.sent).toEqual([]);
    client.subscribe({ roomId: 'r1' });
    const pending = client.unsubscribe();
    sockets[0]!.simulateMessage(ack());
    await pending;
    expect(await client.unsubscribe()).toEqual({ outcome: 'idle' });
    expect(sentOf(sockets[0]!)).toEqual([
      { type: 'subscribe', payload: { roomId: 'r1' } },
      { type: 'subscribe', payload: {} },
    ]);
  });
});
