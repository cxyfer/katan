import { describe, expect, it, vi } from 'vitest';
import {
  FORCED_CLOSE_WAIT_MS,
  parseServerMessage,
  SocketClient,
  UNSUBSCRIBE_ACK_TIMEOUT_MS,
  type SocketLike,
} from '../src/api/socket.ts';
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

  it('does not send before the transport is open, and replays the subscription when it opens', () => {
    const sockets: FakeSocket[] = [];
    const client = new SocketClient({
      url: 'ws://example/ws',
      factory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      onMessage: () => undefined,
    });
    client.connect();
    client.subscribe({ roomId: 'r1' });
    client.ping();
    expect(sockets[0]!.sent).toEqual([]);
    sockets[0]!.simulateOpen();
    expect(sockets[0]!.sent.map((raw) => JSON.parse(raw))).toEqual([{ type: 'subscribe', payload: { roomId: 'r1' } }]);
  });
});

describe('SocketClient.unsubscribe', () => {
  function connected(options: { unsubscribeTimeoutMs?: number; closeWaitMs?: number } = {}) {
    const sockets: FakeSocket[] = [];
    const scheduled: Array<() => void> = [];
    const delays: number[] = [];
    const statuses: string[] = [];
    const received: ServerMessage[] = [];
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
      onMessage: (message) => void received.push(message),
      onStatus: (status) => void statuses.push(status),
      ...options,
    });
    client.connect();
    sockets[0]!.simulateOpen();
    return { client, sockets, scheduled, delays, statuses, received };
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
      const { client, sockets, scheduled } = connected({ unsubscribeTimeoutMs: 50 });
      client.subscribe({ roomId: 'r1' });
      const pending = client.unsubscribe();
      await vi.advanceTimersByTimeAsync(50);
      expect(await pending).toEqual({ outcome: 'timeout' });
      // 舊連線在關閉交握完成前還可能送來遲到的確認：不影響任何東西。
      sockets[0]!.simulateMessage(ack());
      sockets[0]!.simulateClose();
      // 重連後的新連線可以再次訂閱並再次取消。
      scheduled[0]!();
      sockets[1]!.simulateOpen();
      client.subscribe({ roomId: 'r1' });
      const again = client.unsubscribe();
      sockets[1]!.simulateMessage(ack());
      expect(await again).toEqual({ outcome: 'acked', ack: { roomId: 'r1' } });
    } finally {
      vi.useRealTimers();
    }
  });

  describe('when the acknowledgement never arrives', () => {
    async function timedOut(options: { unsubscribeTimeoutMs?: number; closeWaitMs?: number } = { unsubscribeTimeoutMs: 100 }) {
      const context = connected(options);
      context.client.subscribe({ roomId: 'r1', gameId: 'g1' });
      const pending = context.client.unsubscribe();
      await vi.advanceTimersByTimeAsync(options.unsubscribeTimeoutMs ?? UNSUBSCRIBE_ACK_TIMEOUT_MS);
      expect(await pending).toEqual({ outcome: 'timeout' });
      return context;
    }

    it('force-closes the old transport and reconnects without subscribing again', async () => {
      vi.useFakeTimers();
      try {
        const { sockets, scheduled } = await timedOut();
        // 伺服器可能根本沒處理取消訂閱：強制關閉，讓它的 close handler 取消登記。
        expect(sockets[0]!.closed).toBe(true);
        // 沒設 closedByCaller：onClose 之後照常排程重連，開出新連線。
        expect(sockets).toHaveLength(1);
        sockets[0]!.simulateClose();
        expect(scheduled).toHaveLength(1);
        scheduled[0]!();
        expect(sockets).toHaveLength(2);
        sockets[1]!.simulateOpen();
        // 訂閱早已清掉，新連線開啟後不會再訂回去。
        expect(sockets[1]!.sent).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('waits for the transport to close, up to a cap', async () => {
      vi.useFakeTimers();
      try {
        const { client, sockets } = await timedOut({ unsubscribeTimeoutMs: 100, closeWaitMs: 60_000 });
        let closedWait = false;
        void client.whenTransportDropped(5_000).then(() => { closedWait = true; });
        await vi.advanceTimersByTimeAsync(4_000);
        expect(closedWait).toBe(false);
        sockets[0]!.simulateClose();
        await vi.advanceTimersByTimeAsync(0);
        expect(closedWait).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    describe('a transport that never reports its close (half-open)', () => {
      it('is abandoned once the wait is up: the waiter returns and a new connection opens at once', async () => {
        vi.useFakeTimers();
        try {
          const { client, sockets, scheduled, statuses } = await timedOut({ unsubscribeTimeoutMs: 100, closeWaitMs: 60_000 });
          let waited = false;
          void client.whenTransportDropped(300).then(() => { waited = true; });
          await vi.advanceTimersByTimeAsync(299);
          expect(waited).toBe(false);
          expect(sockets).toHaveLength(1);
          await vi.advanceTimersByTimeAsync(1);
          expect(waited).toBe(true);
          // 立即另開新連線，不經退避排程。
          expect(sockets).toHaveLength(2);
          expect(scheduled).toHaveLength(0);
          expect(statuses.slice(-2)).toEqual(['closed', 'connecting']);
        } finally {
          vi.useRealTimers();
        }
      });

      it('is abandoned by the client itself even when nobody is waiting', async () => {
        vi.useFakeTimers();
        try {
          const { sockets } = await timedOut({ unsubscribeTimeoutMs: 100, closeWaitMs: 400 });
          await vi.advanceTimersByTimeAsync(399);
          expect(sockets).toHaveLength(1);
          await vi.advanceTimersByTimeAsync(1);
          expect(sockets).toHaveLength(2);
        } finally {
          vi.useRealTimers();
        }
      });

      it('defaults the abandon wait to one second', async () => {
        vi.useFakeTimers();
        try {
          const { sockets } = await timedOut();
          await vi.advanceTimersByTimeAsync(FORCED_CLOSE_WAIT_MS - 1);
          expect(sockets).toHaveLength(1);
          await vi.advanceTimersByTimeAsync(1);
          expect(sockets).toHaveLength(2);
        } finally {
          vi.useRealTimers();
        }
      });

      it('replays the remembered subscription only once the new socket opens, never on the old one', async () => {
        vi.useFakeTimers();
        try {
          const { client, sockets } = await timedOut({ unsubscribeTimeoutMs: 100, closeWaitMs: 400 });
          const sentToOld = sockets[0]!.sent.length;
          // 還在等舊連線關閉時，只記住訂閱，不送進舊 transport。
          client.subscribe({ roomId: 'r2', gameId: 'g2' });
          await vi.advanceTimersByTimeAsync(400);
          expect(sockets).toHaveLength(2);
          // 新連線尚未 open：什麼都不送。
          client.subscribe({ roomId: 'r2', gameId: 'g2' });
          expect(sockets[1]!.sent).toEqual([]);
          sockets[1]!.simulateOpen();
          expect(sentOf(sockets[1]!)).toEqual([{ type: 'subscribe', payload: { roomId: 'r2', gameId: 'g2' } }]);
          // 舊 transport 從頭到尾沒有再收到任何 send。
          expect(sockets[0]!.sent).toHaveLength(sentToOld);
        } finally {
          vi.useRealTimers();
        }
      });

      it('ignores a late close, open or message from the abandoned transport', async () => {
        vi.useFakeTimers();
        try {
          const { client, sockets, scheduled, statuses, received } = await timedOut({ unsubscribeTimeoutMs: 100, closeWaitMs: 400 });
          await vi.advanceTimersByTimeAsync(400);
          expect(sockets).toHaveLength(2);
          sockets[1]!.simulateOpen();
          const statusCount = statuses.length;
          sockets[0]!.simulateClose();
          sockets[0]!.simulateOpen();
          sockets[0]!.simulateMessage(JSON.stringify({ type: 'pong', payload: { at: 'x' } }));
          // 沒有第二次重連、沒有第三條連線，也沒有狀態或訊息被改動。
          expect(scheduled).toHaveLength(0);
          expect(sockets).toHaveLength(2);
          expect(statuses).toHaveLength(statusCount);
          expect(received).toEqual([]);
          // 新連線不受影響，仍然可用。
          client.subscribe({ roomId: 'r3' });
          expect(sentOf(sockets[1]!)).toEqual([{ type: 'subscribe', payload: { roomId: 'r3' } }]);
        } finally {
          vi.useRealTimers();
        }
      });

      it('keeps backing off if the new connection also fails, instead of storming', async () => {
        vi.useFakeTimers();
        try {
          const { sockets, scheduled, delays } = await timedOut({ unsubscribeTimeoutMs: 100, closeWaitMs: 400 });
          await vi.advanceTimersByTimeAsync(400);
          sockets[1]!.simulateClose();
          scheduled[0]!();
          sockets[2]!.simulateClose();
          expect(delays).toEqual([1000, 2000]);
          expect(sockets).toHaveLength(3);
        } finally {
          vi.useRealTimers();
        }
      });

      it('does nothing more once the caller closed the client', async () => {
        vi.useFakeTimers();
        try {
          const { client, sockets, scheduled } = await timedOut({ unsubscribeTimeoutMs: 100, closeWaitMs: 400 });
          client.close();
          await vi.advanceTimersByTimeAsync(10_000);
          expect(sockets).toHaveLength(1);
          expect(scheduled).toHaveLength(0);
        } finally {
          vi.useRealTimers();
        }
      });

      it('is not abandoned when the close arrives in time', async () => {
        vi.useFakeTimers();
        try {
          const { sockets, scheduled } = await timedOut({ unsubscribeTimeoutMs: 100, closeWaitMs: 400 });
          sockets[0]!.simulateClose();
          await vi.advanceTimersByTimeAsync(10_000);
          // 走既有的重連（一次），沒有重複另開連線。
          expect(scheduled).toHaveLength(1);
          expect(sockets).toHaveLength(1);
          scheduled[0]!();
          expect(sockets).toHaveLength(2);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    it('defaults to a one second wait for the close', () => {
      expect(FORCED_CLOSE_WAIT_MS).toBe(1000);
    });

    it('resolves the wait straight away once the transport has closed', async () => {
      vi.useFakeTimers();
      try {
        const { client, sockets } = await timedOut();
        sockets[0]!.simulateClose();
        await expect(client.whenTransportDropped(10_000)).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('replays a subscription made while the old transport is still closing on the new connection', async () => {
      vi.useFakeTimers();
      try {
        const { client, sockets, scheduled } = await timedOut();
        client.subscribe({ roomId: 'r2' });
        sockets[0]!.simulateClose();
        scheduled[0]!();
        sockets[1]!.simulateOpen();
        expect(sentOf(sockets[1]!)).toEqual([{ type: 'subscribe', payload: { roomId: 'r2' } }]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops reconnecting when the caller closes the client afterwards', async () => {
      vi.useFakeTimers();
      try {
        const { client, sockets, scheduled } = await timedOut();
        client.close();
        await expect(client.whenTransportDropped(10_000)).resolves.toBeUndefined();
        sockets[0]!.simulateClose();
        scheduled.forEach((run) => run());
        expect(sockets).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('does not close the transport when the acknowledgement arrives, the socket is idle or already closed', async () => {
    const acked = connected();
    acked.client.subscribe({ roomId: 'r1' });
    const pending = acked.client.unsubscribe();
    acked.sockets[0]!.simulateMessage(ack());
    await pending;
    await expect(acked.client.whenTransportDropped(10)).resolves.toBeUndefined();
    expect(acked.sockets[0]!.closed).toBe(false);

    const idle = connected();
    await idle.client.unsubscribe();
    expect(idle.sockets[0]!.closed).toBe(false);

    const gone = connected();
    gone.client.subscribe({ roomId: 'r1' });
    gone.sockets[0]!.simulateClose();
    expect(await gone.client.unsubscribe()).toEqual({ outcome: 'disconnected' });
    expect(gone.sockets[0]!.closed).toBe(false);
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
