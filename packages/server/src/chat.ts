/**
 * Room text chat.
 *
 * Chat is a separate sequence from the strategic game revision, is bound to the
 * room/game membership epoch, and can never move cards or mutate game state.
 */

import type { ChatMessageView, ChatPage } from '@catan/protocol';
import type { ServerConfig } from './config.ts';
import { validateChatText } from './config.ts';
import { newId, type ChatRow, type Repository } from './db.ts';
import { ServiceError, type RoomService } from './rooms.ts';

export class ChatService {
  constructor(
    private readonly repo: Repository,
    private readonly rooms: RoomService,
    private readonly config: ServerConfig,
  ) {}

  /** Membership epoch: a new game starts a new, inaccessible-to-others history. */
  epochOf(gameId: string | null): string {
    return gameId ?? 'lobby';
  }

  async history(
    playerId: string,
    roomId: string,
    after: number,
    limit: number,
  ): Promise<ChatPage> {
    const room = await this.rooms.requireRoom(roomId);
    await this.rooms.requireMembership(roomId, playerId);
    const epoch = this.epochOf(room.game_id);
    const pageSize = Math.min(Math.max(limit, 1), this.config.limits.chatHistoryPageSize);
    const rows = await this.repo.listChat(roomId, epoch, after, pageSize + 1);
    const hasMore = rows.length > pageSize;
    const page = rows.slice(0, pageSize);
    const mutes = new Set(await this.repo.listMutes(roomId, playerId));
    const messages: ChatMessageView[] = [];
    for (const row of page) {
      if (row.kind === 'player' && mutes.has(row.player_id)) continue;
      messages.push(await this.toView(row, roomId));
    }
    return {
      messages,
      nextSeq: page.length > 0 ? page[page.length - 1]!.seq : after,
      hasMore,
    };
  }

  async send(
    playerId: string,
    roomId: string,
    clientMessageId: string,
    text: string,
  ): Promise<ChatMessageView> {
    const room = await this.rooms.requireRoom(roomId);
    await this.rooms.requireMembership(roomId, playerId);

    const existingId = await this.repo.findChatReceipt(roomId, playerId, clientMessageId);
    if (existingId) {
      const row = await this.repo.findChatById(existingId);
      if (row) return this.toView(row, roomId);
    }

    const validated = validateChatText(text, this.config.limits.chatMaxLength);
    if (!validated.ok) {
      throw new ServiceError(
        validated.reason === 'text too long' ? 'E_CHAT_TOO_LONG' : 'E_CHAT_INVALID',
        validated.reason === 'text too long' ? 'error.E_CHAT_TOO_LONG' : 'error.E_CHAT_INVALID',
        { max: this.config.limits.chatMaxLength },
      );
    }

    const since = new Date(Date.now() - 60_000).toISOString();
    const recent = await this.repo.countRecentChat(roomId, playerId, since);
    if (recent >= this.config.limits.chatRatePerMinute) {
      throw new ServiceError('E_CHAT_RATE_LIMITED', 'error.E_CHAT_RATE_LIMITED', {
        limit: this.config.limits.chatRatePerMinute,
      }, 429);
    }

    const epoch = this.epochOf(room.game_id);
    const row: ChatRow = {
      id: newId('chat'),
      room_id: roomId,
      epoch,
      seq: 0,
      player_id: playerId,
      kind: 'player',
      text: validated.text,
      created_at: new Date().toISOString(),
      status: 'sent',
    };
    await this.repo.transaction(async () => {
      row.seq = await this.repo.nextChatSeq(roomId);
      await this.repo.insertChat(row);
      await this.repo.insertChatReceipt(roomId, playerId, clientMessageId, row.id);
    });

    const view = await this.toView(row, roomId, clientMessageId);
    this.rooms.broadcastToRoom(roomId, { type: 'chat', payload: view });
    return view;
  }

  /** System notices are authored by the engine, never by a player. */
  async systemNotice(roomId: string, messageId: string, params: Record<string, unknown> = {}): Promise<void> {
    const room = await this.repo.findRoom(roomId);
    if (!room) return;
    const row: ChatRow = {
      id: newId('chat'),
      room_id: roomId,
      epoch: this.epochOf(room.game_id),
      seq: 0,
      player_id: 'system',
      kind: 'system',
      text: JSON.stringify({ messageId, params }),
      created_at: new Date().toISOString(),
      status: 'sent',
    };
    await this.repo.transaction(async () => {
      row.seq = await this.repo.nextChatSeq(roomId);
      await this.repo.insertChat(row);
    });
    const view = await this.toView(row, roomId);
    this.rooms.broadcastToRoom(roomId, { type: 'chat', payload: view });
  }

  async mute(playerId: string, roomId: string, mutedId: string, muted: boolean): Promise<void> {
    await this.rooms.requireMembership(roomId, playerId);
    await this.repo.setMute(roomId, playerId, mutedId, muted);
  }

  async mutes(playerId: string, roomId: string): Promise<string[]> {
    await this.rooms.requireMembership(roomId, playerId);
    return this.repo.listMutes(roomId, playerId);
  }

  private async toView(row: ChatRow, roomId: string, clientMessageId?: string): Promise<ChatMessageView> {
    const membership = await this.repo.findMembership(roomId, row.player_id);
    const guest = membership ? await this.repo.findGuest(row.player_id) : null;
    const view: ChatMessageView = {
      id: row.id,
      seq: row.seq,
      playerId: row.player_id,
      nickname: guest?.nickname ?? row.player_id,
      seat: membership?.seat ?? -1,
      color: membership?.color ?? 'grey',
      text: row.text,
      createdAt: row.created_at,
      kind: row.kind === 'system' ? 'system' : 'player',
    };
    if (clientMessageId) view.clientMessageId = clientMessageId;
    return view;
  }
}
