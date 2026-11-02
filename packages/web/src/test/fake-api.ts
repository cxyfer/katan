/**
 * In-memory `CatanApi` used by tests. Every call is recorded so a test can
 * assert what the UI actually asked the server to do, and every response can be
 * overridden per test.
 */

import type {
  ApiResult,
  BotLevel,
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
import type { CatanApi, CreateRoomBody, RoomQuery, RoomSettingsBody } from '../api/client.ts';
import {
  makeBotMember,
  makeChatMessage,
  makeConfig,
  makeIdentity,
  makeProfile,
  makeResumable,
  makeRoom,
  makeRoomSummary,
  makeSnapshot,
} from './fixtures.ts';

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export interface FakeApiOptions {
  identity?: PlayerIdentity | null;
  config?: ServerConfigView;
  profiles?: ProfileView[];
  rooms?: RoomSummaryView[];
  room?: RoomView | null;
  games?: ResumableGameView[];
  snapshot?: GameSnapshot | null;
  chat?: ChatPage;
  commandResult?: ApiResult<CommandReceipt>;
  chatSendResult?: ApiResult<ChatMessageView>;
  saveResult?: ApiResult<SaveReceipt>;
  sessionResult?: ApiResult<{ player: PlayerIdentity }>;
}

export interface FakeApi extends CatanApi {
  calls: RecordedCall[];
  setSnapshot(snapshot: GameSnapshot | null): void;
  setRoom(room: RoomView | null): void;
  setCommandResult(result: ApiResult<CommandReceipt>): void;
  setChatSendResult(result: ApiResult<ChatMessageView>): void;
  setSessionResult(result: ApiResult<{ player: PlayerIdentity }>): void;
  callsOf(method: string): RecordedCall[];
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

const SEAT_COLORS = ['red', 'blue', 'orange', 'white', 'green', 'brown'] as const;
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dax', 'Esme'] as const;

/** 依伺服器規則把電腦放進最小空位與第一個未使用的顏色。 */
function withBot(room: RoomView, level: BotLevel): RoomView {
  const seats = new Set(room.members.map((member) => member.seat));
  const colors = new Set(room.members.map((member) => member.color));
  const names = new Set(room.members.map((member) => member.nickname));
  let seat = 0;
  while (seats.has(seat)) seat += 1;
  const count = room.members.filter((member) => member.bot).length;
  const bot = makeBotMember({
    playerId: `bot${count + 1}`,
    nickname: BOT_NAMES.find((name) => !names.has(name)) ?? `Bot ${count + 1}`,
    seat,
    color: SEAT_COLORS.find((color) => !colors.has(color)) ?? 'red',
    botLevel: level,
  });
  return { ...room, members: [...room.members, bot] };
}

export function createFakeApi(options: FakeApiOptions = {}): FakeApi {
  const calls: RecordedCall[] = [];
  let snapshot = options.snapshot === undefined ? makeSnapshot() : options.snapshot;
  let room = options.room === undefined ? makeRoom() : options.room;
  let commandResult: ApiResult<CommandReceipt> = options.commandResult ?? ok({
    commandId: 'cmd',
    outcome: 'accepted',
    revision: 13,
    events: [],
  });
  let chatSendResult: ApiResult<ChatMessageView> =
    options.chatSendResult ?? ok(makeChatMessage({ id: 'sent-1', seq: 5, playerId: 'p1', text: 'hello' }));
  let sessionResult: ApiResult<{ player: PlayerIdentity }> =
    options.sessionResult ?? ok({ player: options.identity ?? makeIdentity() });

  const record = (method: string, ...args: unknown[]) => {
    calls.push({ method, args });
  };

  const api: FakeApi = {
    calls,
    callsOf(method) {
      return calls.filter((call) => call.method === method);
    },
    setSnapshot(next) {
      snapshot = next;
    },
    setRoom(next) {
      room = next;
    },
    setCommandResult(result) {
      commandResult = result;
    },
    setChatSendResult(result) {
      chatSendResult = result;
    },
    setSessionResult(result) {
      sessionResult = result;
    },

    async getConfig() {
      record('getConfig');
      return ok(options.config ?? makeConfig());
    },
    async getSession() {
      record('getSession');
      return ok({ player: options.identity === undefined ? makeIdentity() : options.identity });
    },
    async createSession(body: { nickname: string; locale?: Locale }) {
      record('createSession', body);
      return sessionResult;
    },
    async updateSession(body: { nickname?: string; locale?: Locale }) {
      record('updateSession', body);
      return sessionResult;
    },
    async listProfiles() {
      record('listProfiles');
      return ok({ profiles: options.profiles ?? [makeProfile()] });
    },
    async listRooms(query?: RoomQuery) {
      record('listRooms', query);
      return ok({ rooms: options.rooms ?? [makeRoomSummary()] });
    },
    async createRoom(body: CreateRoomBody) {
      record('createRoom', body);
      room = makeRoom({
        visibility: body.visibility,
        capacity: body.capacity,
        profileId: body.profileId,
        orderMode: body.orderMode ?? 'join',
      });
      return ok(room);
    },
    async joinRoom(body: { code: string }) {
      record('joinRoom', body);
      return room ? ok(room) : { ok: false, error: { code: 'E_ROOM_NOT_FOUND', messageId: 'error.E_ROOM_NOT_FOUND' } };
    },
    async getRoom(roomId: string) {
      record('getRoom', roomId);
      return room ? ok(room) : { ok: false, error: { code: 'E_ROOM_NOT_FOUND', messageId: 'error.E_ROOM_NOT_FOUND' } };
    },
    async leaveRoom(roomId: string) {
      record('leaveRoom', roomId);
      return ok({ left: true as const, hostTransferredTo: null });
    },
    async takeSeat(roomId: string, color: string) {
      record('takeSeat', roomId, color);
      return room ? ok(room) : { ok: false, error: { code: 'E_ROOM_NOT_FOUND', messageId: 'error.E_ROOM_NOT_FOUND' } };
    },
    async setReady(roomId: string, ready: boolean) {
      record('setReady', roomId, ready);
      return room ? ok(room) : { ok: false, error: { code: 'E_ROOM_NOT_FOUND', messageId: 'error.E_ROOM_NOT_FOUND' } };
    },
    async updateSettings(roomId: string, body: RoomSettingsBody) {
      record('updateSettings', roomId, body);
      if (!room) {
        return { ok: false, error: { code: 'E_ROOM_NOT_FOUND', messageId: 'error.E_ROOM_NOT_FOUND' } };
      }
      room = {
        ...room,
        ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
        ...(body.profileId !== undefined ? { profileId: body.profileId } : {}),
        ...(body.setupMode !== undefined ? { setupMode: body.setupMode } : {}),
        ...(body.orderMode !== undefined ? { orderMode: body.orderMode } : {}),
        ...(body.policy !== undefined ? { policy: body.policy } : {}),
      };
      return ok(room);
    },
    async addBot(roomId: string, level: BotLevel) {
      record('addBot', roomId, level);
      if (!room) return { ok: false, error: { code: 'E_ROOM_NOT_FOUND', messageId: 'error.E_ROOM_NOT_FOUND' } };
      if (room.members.length >= room.capacity) {
        return { ok: false, error: { code: 'E_ROOM_FULL', messageId: 'error.E_ROOM_FULL', params: { capacity: room.capacity } } };
      }
      room = withBot(room, level);
      return ok(room);
    },
    async removeBot(roomId: string, playerId: string) {
      record('removeBot', roomId, playerId);
      if (!room) return { ok: false, error: { code: 'E_ROOM_NOT_FOUND', messageId: 'error.E_ROOM_NOT_FOUND' } };
      if (!room.members.some((member) => member.playerId === playerId && member.bot)) {
        return { ok: false, error: { code: 'E_NOT_A_BOT', messageId: 'error.E_NOT_A_BOT' } };
      }
      room = { ...room, members: room.members.filter((member) => member.playerId !== playerId) };
      return ok(room);
    },
    async proposePolicy(roomId: string, policy: RoomPolicy) {
      record('proposePolicy', roomId, policy);
      return room ? ok(room) : { ok: false, error: { code: 'E_ROOM_NOT_FOUND', messageId: 'error.E_ROOM_NOT_FOUND' } };
    },
    async respondPolicy(roomId: string, body: { proposalId: string; approve: boolean }) {
      record('respondPolicy', roomId, body);
      return room ? ok(room) : { ok: false, error: { code: 'E_ROOM_NOT_FOUND', messageId: 'error.E_ROOM_NOT_FOUND' } };
    },
    async startGame(roomId: string) {
      record('startGame', roomId);
      return ok({ gameId: 'g1' });
    },
    async closeRoom(roomId: string) {
      record('closeRoom', roomId);
      return ok({ closed: true as const });
    },
    async listGames() {
      record('listGames');
      return ok({ games: options.games ?? [makeResumable()] });
    },
    async getGame(gameId: string) {
      record('getGame', gameId);
      return snapshot
        ? ok(snapshot)
        : { ok: false, error: { code: 'E_ROOM_NOT_FOUND', messageId: 'error.E_ROOM_NOT_FOUND' } };
    },
    async getEvents(gameId: string, query?: { after?: number; limit?: number }) {
      record('getEvents', gameId, query);
      const events: GameEvent[] = snapshot?.view.events ?? [];
      return ok({ events, revision: snapshot?.revision ?? 0 });
    },
    async sendCommand(gameId: string, request: CommandRequest) {
      record('sendCommand', gameId, request);
      return commandResult;
    },
    async saveGame(gameId: string, requestId: string) {
      record('saveGame', gameId, requestId);
      return (
        options.saveResult ??
        ok({
          requestId,
          gameId,
          revision: 12,
          savedAt: '2026-01-02T00:00:00.000Z',
          outcome: 'saved' as const,
        })
      );
    },
    async suspendGame(gameId: string, proposalId?: string) {
      record('suspendGame', gameId, proposalId);
      return room ? ok(room) : { ok: false, error: { code: 'E_ROOM_NOT_FOUND', messageId: 'error.E_ROOM_NOT_FOUND' } };
    },
    async resumeGame(gameId: string, ready: boolean) {
      record('resumeGame', gameId, ready);
      return room ? ok(room) : { ok: false, error: { code: 'E_ROOM_NOT_FOUND', messageId: 'error.E_ROOM_NOT_FOUND' } };
    },
    async getChat(roomId: string, query?: { after?: number; limit?: number }) {
      record('getChat', roomId, query);
      return ok(options.chat ?? { messages: [], nextSeq: 0, hasMore: false });
    },
    async sendChat(roomId: string, body: { clientMessageId: string; text: string }) {
      record('sendChat', roomId, body);
      return chatSendResult;
    },
  };

  return api;
}
