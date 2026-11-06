/**
 * Typed WebSocket client for `/ws` (docs/API.md).
 *
 * Responsibilities are deliberately narrow: serialise `ClientMessage`, parse
 * `ServerMessage`, track connection status and re-subscribe after a reconnect.
 * The caller is responsible for the "after a gap, refetch the snapshot" rule,
 * because only it knows which game/room it is currently showing.
 */

import type { ClientMessage, ServerMessage } from '@catan/protocol';

export type SocketStatus = 'connecting' | 'open' | 'closed';

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onOpen(handler: () => void): void;
  onClose(handler: (info: { code: number; reason: string }) => void): void;
  onMessage(handler: (data: string) => void): void;
  onError(handler: () => void): void;
}

export type SocketFactory = (url: string) => SocketLike;

/** Adapts the DOM `WebSocket` to `SocketLike` without leaking DOM event types. */
export function createBrowserSocket(url: string): SocketLike {
  const socket = new WebSocket(url);
  return {
    send(data) {
      socket.send(data);
    },
    close() {
      socket.close();
    },
    onOpen(handler) {
      socket.onopen = () => handler();
    },
    onClose(handler) {
      socket.onclose = (event) => handler({ code: event.code, reason: event.reason });
    },
    onMessage(handler) {
      socket.onmessage = (event) => handler(String(event.data));
    },
    onError(handler) {
      socket.onerror = () => handler();
    },
  };
}

export function parseServerMessage(data: string): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const envelope = parsed as { type?: unknown; payload?: unknown };
  if (typeof envelope.type !== 'string') return null;
  const known = [
    'hello',
    'room',
    'snapshot',
    'events',
    'chat',
    'presence',
    'notice',
    'error',
    'pong',
  ];
  if (!known.includes(envelope.type)) return null;
  return parsed as ServerMessage;
}

export interface SocketClientOptions {
  url: string;
  onMessage(message: ServerMessage): void;
  onStatus?(status: SocketStatus): void;
  /** Injected so tests never need real timers. */
  factory?: SocketFactory;
  schedule?: (handler: () => void, delayMs: number) => void;
  maxBackoffMs?: number;
}

/**
 * Owns one WebSocket with exponential-backoff reconnection. `subscribe` is
 * remembered and replayed after every successful (re)connect, which is what
 * makes a reconnect converge without the user re-navigating.
 */
export class SocketClient {
  readonly #options: SocketClientOptions;
  readonly #factory: SocketFactory;
  readonly #schedule: (handler: () => void, delayMs: number) => void;
  #socket: SocketLike | null = null;
  #attempt = 0;
  #closedByCaller = false;
  #subscription: { roomId?: string; gameId?: string } | null = null;

  constructor(options: SocketClientOptions) {
    this.#options = options;
    this.#factory = options.factory ?? createBrowserSocket;
    this.#schedule =
      options.schedule ?? ((handler, delayMs) => void setTimeout(handler, delayMs));
  }

  get attempt(): number {
    return this.#attempt;
  }

  connect(): void {
    this.#closedByCaller = false;
    this.#open();
  }

  #open(): void {
    this.#options.onStatus?.('connecting');
    const socket = this.#factory(this.#options.url);
    this.#socket = socket;
    socket.onOpen(() => {
      this.#attempt = 0;
      this.#options.onStatus?.('open');
      if (this.#subscription) {
        this.#rawSend({ type: 'subscribe', payload: this.#subscription });
      }
    });
    socket.onMessage((data) => {
      const message = parseServerMessage(data);
      if (message) this.#options.onMessage(message);
    });
    socket.onError(() => {
      // `onClose` always follows; nothing to do beyond surfacing the state.
    });
    socket.onClose(() => {
      this.#socket = null;
      this.#options.onStatus?.('closed');
      if (this.#closedByCaller) return;
      const max = this.#options.maxBackoffMs ?? 30_000;
      const delay = Math.min(max, 500 * 2 ** this.#attempt);
      this.#attempt += 1;
      this.#schedule(() => this.#open(), delay);
    });
  }

  #rawSend(message: ClientMessage): void {
    if (!this.#socket) return;
    try {
      this.#socket.send(JSON.stringify(message));
    } catch {
      // A send on a closing socket is not an application error; the reconnect
      // path (and the HTTP fallback) is authoritative.
    }
  }

  send(message: ClientMessage): void {
    this.#rawSend(message);
  }

  subscribe(target: { roomId?: string; gameId?: string }): void {
    this.#subscription = { ...target };
    this.#rawSend({ type: 'subscribe', payload: this.#subscription });
  }

  /**
   * 取消目前的訂閱（SPEC §4.6：保存並離開、退出等刻意離開）。不帶 roomId 的 `subscribe`
   * 會讓伺服器取消登記這條連線；同時清掉記住的訂閱，重連時才不會自動訂回去。
   */
  unsubscribe(): void {
    if (this.#subscription === null) return;
    this.#subscription = null;
    this.#rawSend({ type: 'subscribe', payload: {} });
  }

  ping(): void {
    this.#rawSend({ type: 'ping' });
  }

  close(): void {
    this.#closedByCaller = true;
    this.#socket?.close();
    this.#socket = null;
  }
}
