/**
 * Thin, typed wrapper over the HTTP contract in `docs/API.md`.
 *
 * The client owns no rules: it serialises a `CommandRequest` and returns the
 * server's `CommandReceipt` verbatim. Every method resolves to `ApiResult<T>`,
 * so a transport failure is a value (`E_NETWORK`) rather than a thrown error —
 * the UI must be able to distinguish "rejected" from "outcome unknown".
 */

import type {
  ApiError,
  ApiResult,
  ChatMessageView,
  ChatPage,
  CommandReceipt,
  CommandRequest,
  GameEvent,
  GameSnapshot,
  Locale,
  PlayerIdentity,
  ProfileView,
  ResumableGameView,
  RoomPolicy,
  RoomSummaryView,
  RoomView,
  SaveReceipt,
  ServerConfigView,
} from '@catan/protocol';

export type { ApiError, ApiResult };

/** Minimal response shape, satisfied by the DOM `Response`. */
export interface HttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** Minimal request shape, satisfied by the DOM `RequestInit`. */
export interface HttpRequestLike {
  method: string;
  headers: Record<string, string>;
  credentials: 'same-origin';
  body?: string;
}

/** Injectable transport. Tests pass a fake; the app passes `globalThis.fetch`. */
export type FetchLike = (input: string, init?: HttpRequestLike) => Promise<HttpResponseLike>;

export const NETWORK_ERROR: ApiError = {
  code: 'E_NETWORK',
  messageId: 'error.E_NETWORK',
};

/** A type alias (not an interface) so it is assignable to a query record. */
export type RoomQuery = {
  playerCount?: number;
  profileId?: string;
  hasSeats?: boolean;
};

export interface CreateRoomBody {
  visibility: 'private' | 'public';
  capacity: number;
  profileId: string;
  setupMode: 'fixed' | 'variable';
  policy?: RoomPolicy;
}

export interface RoomSettingsBody {
  capacity?: number;
  profileId?: string;
  setupMode?: 'fixed' | 'variable';
  policy?: RoomPolicy;
}

/** The full surface the UI depends on. Faked wholesale in tests. */
export interface CatanApi {
  getConfig(): Promise<ApiResult<ServerConfigView>>;
  getSession(): Promise<ApiResult<{ player: PlayerIdentity | null }>>;
  createSession(body: { nickname: string; locale?: Locale }): Promise<ApiResult<{ player: PlayerIdentity }>>;
  updateSession(body: { nickname?: string; locale?: Locale }): Promise<ApiResult<{ player: PlayerIdentity }>>;
  listProfiles(): Promise<ApiResult<{ profiles: ProfileView[] }>>;
  listRooms(query?: RoomQuery): Promise<ApiResult<{ rooms: RoomSummaryView[] }>>;
  createRoom(body: CreateRoomBody): Promise<ApiResult<RoomView>>;
  joinRoom(body: { code: string }): Promise<ApiResult<RoomView>>;
  getRoom(roomId: string): Promise<ApiResult<RoomView>>;
  leaveRoom(roomId: string): Promise<ApiResult<{ left: true; hostTransferredTo: string | null }>>;
  takeSeat(roomId: string, color: string): Promise<ApiResult<RoomView>>;
  setReady(roomId: string, ready: boolean): Promise<ApiResult<RoomView>>;
  updateSettings(roomId: string, body: RoomSettingsBody): Promise<ApiResult<RoomView>>;
  proposePolicy(roomId: string, policy: RoomPolicy): Promise<ApiResult<RoomView>>;
  respondPolicy(
    roomId: string,
    body: { proposalId: string; approve: boolean },
  ): Promise<ApiResult<RoomView>>;
  startGame(roomId: string): Promise<ApiResult<{ gameId: string }>>;
  closeRoom(roomId: string): Promise<ApiResult<{ closed: true }>>;
  listGames(): Promise<ApiResult<{ games: ResumableGameView[] }>>;
  getGame(gameId: string): Promise<ApiResult<GameSnapshot>>;
  getEvents(
    gameId: string,
    query?: { after?: number; limit?: number },
  ): Promise<ApiResult<{ events: GameEvent[]; revision: number }>>;
  sendCommand(gameId: string, request: CommandRequest): Promise<ApiResult<CommandReceipt>>;
  saveGame(gameId: string, requestId: string): Promise<ApiResult<SaveReceipt>>;
  suspendGame(gameId: string, proposalId?: string): Promise<ApiResult<RoomView>>;
  resumeGame(gameId: string, ready: boolean): Promise<ApiResult<RoomView>>;
  getChat(roomId: string, query?: { after?: number; limit?: number }): Promise<ApiResult<ChatPage>>;
  sendChat(
    roomId: string,
    body: { clientMessageId: string; text: string },
  ): Promise<ApiResult<ChatMessageView>>;
}

function encodeQuery(query: Record<string, string | number | boolean | undefined> | undefined): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['code'] === 'string' && typeof candidate['messageId'] === 'string';
}

/** Parses an `ApiResult<T>` body, tolerating a missing/!JSON payload. */
export function parseApiResult<T>(status: number, body: unknown): ApiResult<T> {
  if (typeof body === 'object' && body !== null) {
    const envelope = body as Record<string, unknown>;
    if (envelope['ok'] === true) return { ok: true, data: envelope['data'] as T };
    if (envelope['ok'] === false && isApiError(envelope['error'])) {
      return { ok: false, error: envelope['error'] };
    }
  }
  return {
    ok: false,
    error: {
      code: status === 401 ? 'E_UNAUTHORIZED' : 'E_INVALID_COMMAND',
      messageId: status === 401 ? 'error.E_UNAUTHORIZED' : 'error.unknown',
      params: { code: String(status) },
    },
  };
}

export class ApiClient implements CatanApi {
  readonly #fetch: FetchLike;
  readonly #baseUrl: string;

  constructor(fetchImpl: FetchLike, baseUrl = '') {
    this.#fetch = fetchImpl;
    this.#baseUrl = baseUrl;
  }

  async #request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<ApiResult<T>> {
    const init: HttpRequestLike = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}${encodeQuery(query)}`, init);
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      return parseApiResult<T>(response.status, parsed);
    } catch {
      return { ok: false, error: NETWORK_ERROR };
    }
  }

  getConfig() {
    return this.#request<ServerConfigView>('GET', '/api/config');
  }
  getSession() {
    return this.#request<{ player: PlayerIdentity | null }>('GET', '/api/session');
  }
  createSession(body: { nickname: string; locale?: Locale }) {
    return this.#request<{ player: PlayerIdentity }>('POST', '/api/session', body);
  }
  updateSession(body: { nickname?: string; locale?: Locale }) {
    return this.#request<{ player: PlayerIdentity }>('PATCH', '/api/session', body);
  }
  listProfiles() {
    return this.#request<{ profiles: ProfileView[] }>('GET', '/api/profiles');
  }
  listRooms(query?: RoomQuery) {
    return this.#request<{ rooms: RoomSummaryView[] }>('GET', '/api/rooms', undefined, query);
  }
  createRoom(body: CreateRoomBody) {
    return this.#request<RoomView>('POST', '/api/rooms', body);
  }
  joinRoom(body: { code: string }) {
    return this.#request<RoomView>('POST', '/api/rooms/join', body);
  }
  getRoom(roomId: string) {
    return this.#request<RoomView>('GET', `/api/rooms/${encodeURIComponent(roomId)}`);
  }
  leaveRoom(roomId: string) {
    return this.#request<{ left: true; hostTransferredTo: string | null }>(
      'POST',
      `/api/rooms/${encodeURIComponent(roomId)}/leave`,
    );
  }
  takeSeat(roomId: string, color: string) {
    return this.#request<RoomView>('POST', `/api/rooms/${encodeURIComponent(roomId)}/seat`, { color });
  }
  setReady(roomId: string, ready: boolean) {
    return this.#request<RoomView>('POST', `/api/rooms/${encodeURIComponent(roomId)}/ready`, { ready });
  }
  updateSettings(roomId: string, body: RoomSettingsBody) {
    return this.#request<RoomView>('POST', `/api/rooms/${encodeURIComponent(roomId)}/settings`, body);
  }
  proposePolicy(roomId: string, policy: RoomPolicy) {
    return this.#request<RoomView>('POST', `/api/rooms/${encodeURIComponent(roomId)}/policy`, { policy });
  }
  respondPolicy(roomId: string, body: { proposalId: string; approve: boolean }) {
    return this.#request<RoomView>(
      'POST',
      `/api/rooms/${encodeURIComponent(roomId)}/policy/consent`,
      body,
    );
  }
  startGame(roomId: string) {
    return this.#request<{ gameId: string }>('POST', `/api/rooms/${encodeURIComponent(roomId)}/start`);
  }
  closeRoom(roomId: string) {
    return this.#request<{ closed: true }>('POST', `/api/rooms/${encodeURIComponent(roomId)}/close`);
  }
  listGames() {
    return this.#request<{ games: ResumableGameView[] }>('GET', '/api/games');
  }
  getGame(gameId: string) {
    return this.#request<GameSnapshot>('GET', `/api/games/${encodeURIComponent(gameId)}`);
  }
  getEvents(gameId: string, query?: { after?: number; limit?: number }) {
    return this.#request<{ events: GameEvent[]; revision: number }>(
      'GET',
      `/api/games/${encodeURIComponent(gameId)}/events`,
      undefined,
      query,
    );
  }
  sendCommand(gameId: string, request: CommandRequest) {
    return this.#request<CommandReceipt>(
      'POST',
      `/api/games/${encodeURIComponent(gameId)}/commands`,
      request,
    );
  }
  saveGame(gameId: string, requestId: string) {
    return this.#request<SaveReceipt>('POST', `/api/games/${encodeURIComponent(gameId)}/save`, {
      requestId,
    });
  }
  suspendGame(gameId: string, proposalId?: string) {
    return this.#request<RoomView>('POST', `/api/games/${encodeURIComponent(gameId)}/suspend`, {
      proposalId,
    });
  }
  resumeGame(gameId: string, ready: boolean) {
    return this.#request<RoomView>('POST', `/api/games/${encodeURIComponent(gameId)}/resume`, { ready });
  }
  getChat(roomId: string, query?: { after?: number; limit?: number }) {
    return this.#request<ChatPage>(
      'GET',
      `/api/rooms/${encodeURIComponent(roomId)}/chat`,
      undefined,
      query,
    );
  }
  sendChat(roomId: string, body: { clientMessageId: string; text: string }) {
    return this.#request<ChatMessageView>(
      'POST',
      `/api/rooms/${encodeURIComponent(roomId)}/chat`,
      body,
    );
  }
}

/** Builds the production client from the browser's `fetch`. */
export function createApiClient(fetchImpl?: FetchLike, baseUrl = ''): ApiClient {
  const transport = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  return new ApiClient(transport, baseUrl);
}
