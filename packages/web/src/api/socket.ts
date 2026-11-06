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

/**
 * 取消訂閱逾時而強制關閉舊連線後，等它真的關閉（`onClose`）的上限（毫秒）。
 * 關閉的交握走完，代表伺服器已處理這條連線的 close；超過上限就不等了，半斷的連線本來就等不到。
 */
export const FORCED_CLOSE_WAIT_MS = 1_000;

/** 伺服器 `unsubscribed` 確認的內容；型別直接取自協定，之後新增的欄位（例如進房世代）會跟著帶出。 */
export type UnsubscribeAck = Extract<ServerMessage, { type: 'unsubscribed' }>['payload'];

/**
 * `unsubscribe()` 的結果：
 * - `acked`：收到伺服器的 `unsubscribed`，連線已移出房間；`ack` 保留確認的完整內容；
 * - `idle`：本來就沒有訂閱，沒送任何訊息；
 * - `disconnected`：socket 未開啟或已關閉，伺服器會因連線關閉而取消登記；
 * - `timeout`：等不到確認，伺服器可能還沒處理這次取消訂閱、連線仍在房內；這時已強制關閉目前的
 *   transport（見 `unsubscribe()`），呼叫端可用 `whenTransportDropped()` 等它關閉。
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
  /**
   * 強制關閉的 transport 最多可以多久不回報 `onClose`，超過就放棄它並另開新連線；預設 `FORCED_CLOSE_WAIT_MS`。
   * 半斷的連線可能永遠等不到 `onClose`。
   */
  closeWaitMs?: number;
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
  /** 取消訂閱逾時而強制關閉、但 `onClose` 還沒到的 transport。 */
  #dropping: { socket: SocketLike; closed: Promise<void>; markClosed: () => void; watchdog: ReturnType<typeof setTimeout> } | null = null;
  /** 已放棄的舊 transport：它之後遲到的事件一律忽略，不能再觸發重連或改動目前連線的狀態。 */
  readonly #abandoned = new WeakSet<SocketLike>();

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
      if (this.#abandoned.has(socket)) return;
      this.#isOpen = true;
      this.#attempt = 0;
      this.#options.onStatus?.('open');
      if (this.#subscription) {
        this.#rawSend({ type: 'subscribe', payload: this.#subscription });
      }
    });
    socket.onMessage((data) => {
      if (this.#abandoned.has(socket)) return;
      const message = parseServerMessage(data);
      if (!message) return;
      if (message.type === 'unsubscribed') this.#unsubscribing?.settle({ outcome: 'acked', ack: message.payload });
      this.#options.onMessage(message);
    });
    socket.onError(() => {
      // `onClose` always follows; nothing to do beyond surfacing the state.
    });
    socket.onClose(() => {
      // 已放棄的舊 transport 遲到的 close：連線早已另開，不能再清掉新連線或排第二次重連。
      if (this.#abandoned.has(socket)) return;
      this.#socket = null;
      this.#isOpen = false;
      this.#markDropped(socket);
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
    // transport 還沒 open（連線中、關閉中或已關閉）時不送：訂閱已記住，新連線 `onOpen` 會重送。
    if (!this.#socket || !this.#isOpen) return;
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
   *
   * 逾時代表伺服器可能根本還沒處理這次取消訂閱（很慢，或連線已半斷而伺服器沒有心跳察覺）：訂閱已經
   * 清掉，之後再呼叫只會是 `idle`，若不處理，伺服器會一直把這條連線當成在線。所以逾時時強制關閉目前的
   * transport，讓伺服器的 close handler 取消登記。這裡不設 `closedByCaller`：既有的重連照常開一條
   * 新連線，而因為訂閱已清掉，新連線開啟後不會再訂回去。
   */
  unsubscribe(): Promise<UnsubscribeResult> {
    if (this.#unsubscribing) return this.#unsubscribing.promise;
    if (this.#subscription === null) return Promise.resolve({ outcome: 'idle' });
    this.#subscription = null;
    if (!this.#socket || !this.#isOpen) return Promise.resolve({ outcome: 'disconnected' });

    const socket = this.#socket;
    let settle: (result: UnsubscribeResult) => void = () => {};
    const promise = new Promise<UnsubscribeResult>((resolve) => {
      settle = resolve;
    });
    const timer = globalThis.setTimeout(() => {
      this.#drop(socket);
      finish({ outcome: 'timeout' });
    }, this.#options.unsubscribeTimeoutMs ?? UNSUBSCRIBE_ACK_TIMEOUT_MS);
    const finish = (result: UnsubscribeResult) => {
      globalThis.clearTimeout(timer);
      if (this.#unsubscribing?.promise === promise) this.#unsubscribing = null;
      settle(result);
    };
    this.#unsubscribing = { promise, settle: finish };
    this.#rawSend({ type: 'subscribe', payload: {} });
    return promise;
  }

  /** 強制關閉 transport（不設 `closedByCaller`）；`onClose` 到時走既有的重連，等不到就放棄它（見 `#abandon`）。 */
  #drop(socket: SocketLike): void {
    // 已經不是目前的連線（先一步關閉或被取代），沒有東西要關。
    if (this.#socket !== socket || this.#dropping) return;
    let markClosed: () => void = () => {};
    const closed = new Promise<void>((resolve) => {
      markClosed = resolve;
    });
    const watchdog = globalThis.setTimeout(
      () => this.#abandon(socket),
      this.#options.closeWaitMs ?? FORCED_CLOSE_WAIT_MS,
    );
    this.#dropping = { socket, closed, markClosed, watchdog };
    // 關閉交握完成前不再視為可用，但保留 `#socket`，讓 `onClose` 的重連邏輯接手。
    this.#isOpen = false;
    try {
      socket.close();
    } catch {
      // 已在關閉中；`onClose` 仍會到。
    }
  }

  #markDropped(socket: SocketLike): void {
    if (this.#dropping?.socket !== socket) return;
    globalThis.clearTimeout(this.#dropping.watchdog);
    this.#dropping.markClosed();
    this.#dropping = null;
  }

  /**
   * 強制關閉的 transport 一直等不到 `onClose`（半斷的連線）：放棄它。之後它遲到的任何事件都被忽略，
   * 不會再觸發第二次重連；清掉 `#socket` 並立即另開一條新連線（走既有的 `#open()`），`#attempt` 照常
   * 加一，新連線若也連不上，後續的重連退避會跟著拉長，不會形成重連風暴。呼叫端已經 `close()` 就什麼都不做。
   */
  #abandon(socket: SocketLike): void {
    const dropping = this.#dropping;
    if (!dropping || dropping.socket !== socket || this.#socket !== socket) return;
    globalThis.clearTimeout(dropping.watchdog);
    this.#abandoned.add(socket);
    this.#dropping = null;
    this.#socket = null;
    this.#isOpen = false;
    dropping.markClosed();
    this.#options.onStatus?.('closed');
    if (this.#closedByCaller) return;
    this.#attempt += 1;
    this.#open();
  }

  /**
   * 取消訂閱逾時後，等被強制關閉的舊 transport 真的關閉（`onClose`），最多等 `maxMs`（預設 `closeWaitMs`）。
   * 沒有待關閉的 transport 就立刻 resolve。關閉交握走完，伺服器已處理這條連線的 close，之後送的 `/leave`
   * 才不會看到它還在線。到上限仍沒關閉就放棄那條 transport 並另開新連線（半斷的連線等不到 `onClose`），
   * 之後的訂閱走新連線；呼叫端照常送 `/leave`。
   */
  async whenTransportDropped(maxMs: number = this.#options.closeWaitMs ?? FORCED_CLOSE_WAIT_MS): Promise<void> {
    const dropping = this.#dropping;
    if (!dropping) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<void>((resolve) => {
      timer = globalThis.setTimeout(resolve, maxMs);
    });
    try {
      await Promise.race([dropping.closed, cap]);
    } finally {
      globalThis.clearTimeout(timer);
    }
    this.#abandon(dropping.socket);
  }

  ping(): void {
    this.#rawSend({ type: 'ping' });
  }

  close(): void {
    this.#closedByCaller = true;
    this.#unsubscribing?.settle({ outcome: 'disconnected' });
    if (this.#dropping) {
      globalThis.clearTimeout(this.#dropping.watchdog);
      this.#dropping.markClosed();
      this.#dropping = null;
    }
    this.#socket?.close();
    this.#socket = null;
    this.#isOpen = false;
  }
}
