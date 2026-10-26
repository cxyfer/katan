import { describe, expect, it } from 'vitest';
import { parseServerMessage, SocketClient, type SocketLike } from '../src/api/socket.ts';
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
