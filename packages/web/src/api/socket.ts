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
    'unsubscribed',
  ];
  if (!known.includes(envelope.type)) return null;
  return parsed as ServerMessage;
}

/** 等待伺服器確認取消訂閱（`unsubscribed`）的上限（毫秒）；逾時視為沒有確認，仍會繼續後續流程。 */
export const UNSUBSCRIBE_ACK_TIMEOUT_MS = 3_000;

/** 伺服器 `unsubscribed` 確認的內容；型別直接取自協定，之後新增的欄位（例如進房世代）會跟著帶出。 */
export type UnsubscribeAck = Extract<ServerMessage, { type: 'unsubscribed' }>['payload'];

/**
 * `unsubscribe()` 的結果：
 * - `acked`：收到伺服器的 `unsubscribed`，連線已移出房間；`ack` 保留確認的完整內容；
 * - `idle`：本來就沒有訂閱，沒送任何訊息；
 * - `disconnected`：socket 未開啟或已關閉，伺服器會因連線關閉而取消登記；
 * - `timeout`：等不到確認，連線可能仍在房內。
 */
export type UnsubscribeResult =
  | { outcome: 'acked'; ack: UnsubscribeAck }
  | { outcome: 'idle' | 'disconnected' | 'timeout' };

export interface SocketClientOptions {
  url: string;
  onMessage(message: ServerMessage): void;
  onStatus?(status: SocketStatus): void;
  /** Injected so tests never need real timers. */
  factory?: SocketFactory;
  schedule?: (handler: () => void, delayMs: number) => void;
  maxBackoffMs?: number;
  /** 等待 `unsubscribed` 確認的上限；預設 `UNSUBSCRIBE_ACK_TIMEOUT_MS`。 */
  unsubscribeTimeoutMs?: number;
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
  #isOpen = false;
  /** 進行中的取消訂閱；重複呼叫共用同一個，不重送訊息。 */
  #unsubscribing: { promise: Promise<UnsubscribeResult>; settle: (result: UnsubscribeResult) => void } | null = null;

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
      this.#isOpen = true;
      this.#attempt = 0;
      this.#options.onStatus?.('open');
      if (this.#subscription) {
        this.#rawSend({ type: 'subscribe', payload: this.#subscription });
      }
    });
    socket.onMessage((data) => {
      const message = parseServerMessage(data);
      if (!message) return;
      if (message.type === 'unsubscribed') this.#unsubscribing?.settle({ outcome: 'acked', ack: message.payload });
      this.#options.onMessage(message);
    });
    socket.onError(() => {
      // `onClose` always follows; nothing to do beyond surfacing the state.
    });
    socket.onClose(() => {
      this.#socket = null;
      this.#isOpen = false;
      // 連線關閉時伺服器會自行取消登記，不必再等確認。
      this.#unsubscribing?.settle({ outcome: 'disconnected' });
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
   * 會讓伺服器取消登記這條連線並回覆 `unsubscribed`；同時清掉記住的訂閱，重連時才不會自動訂回去。
   *
   * 回傳的 Promise 在收到確認、socket 未開啟或已關閉、或逾時（`unsubscribeTimeoutMs`）時 resolve，
   * 值說明是哪一種，收到確認時並帶著確認的內容。呼叫端要先等它，再送 HTTP `/leave`，否則 `/leave`
   * 可能比取消訂閱先到，伺服器會因連線還在而忽略離開。
   */
  unsubscribe(): Promise<UnsubscribeResult> {
    if (this.#unsubscribing) return this.#unsubscribing.promise;
    if (this.#subscription === null) return Promise.resolve({ outcome: 'idle' });
    this.#subscription = null;
    if (!this.#socket || !this.#isOpen) return Promise.resolve({ outcome: 'disconnected' });

    let settle: (result: UnsubscribeResult) => void = () => {};
    const promise = new Promise<UnsubscribeResult>((resolve) => {
      settle = resolve;
    });
    const timer = globalThis.setTimeout(
      () => finish({ outcome: 'timeout' }),
      this.#options.unsubscribeTimeoutMs ?? UNSUBSCRIBE_ACK_TIMEOUT_MS,
    );
    const finish = (result: UnsubscribeResult) => {
      globalThis.clearTimeout(timer);
      if (this.#unsubscribing?.promise === promise) this.#unsubscribing = null;
      settle(result);
    };
    this.#unsubscribing = { promise, settle: finish };
    this.#rawSend({ type: 'subscribe', payload: {} });
    return promise;
  }

  ping(): void {
    this.#rawSend({ type: 'ping' });
  }

  close(): void {
    this.#closedByCaller = true;
    this.#unsubscribing?.settle({ outcome: 'disconnected' });
    this.#socket?.close();
    this.#socket = null;
    this.#isOpen = false;
  }
}
