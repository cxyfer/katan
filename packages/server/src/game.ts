/**
 * Game coordination: serialised command handling, durable receipts, save
 * barriers, suspension and resume.
 *
 * Every accepted transition is persisted atomically together with its ordered
 * events and command receipt before anything is published (§7.2).
 */

import {
  abandonGame,
  actionHints,
  applyCommand,
  createGame,
  projectEvent,
  projectGame,
  requireProfile,
  secureRng,
  shuffle,
  type Command,
  type GameEvent,
  type GameState,
  type Rng,
} from '@catan/rules';
import type {
  CommandReceipt,
  CommandRequest,
  GameSnapshot,
  Notice,
  ResumableGameView,
  RoomStatus,
  SaveReceipt,
} from '@catan/protocol';
import type { ServerConfig } from './config.ts';
import {
  digestPayload,
  newId,
  type GameRow,
  type IdleGameRow,
  type MemberRow,
  type Repository,
  type RoomRow,
} from './db.ts';
import { ServiceError, type RoomService } from './rooms.ts';
import { humanMembers, isBotMember } from './bot-seats.ts';

const RECEIPT_EVENT_LIMIT = 200;
const DAY_MS = 86_400_000;
/** 保留掃描每一批最多處理的對局數；積壓時由排程器短延遲後接續下一批。 */
export const RETENTION_BATCH_SIZE = 100;

/**
 * Decides the in-game seat order. `random` draws once at start with the same
 * server-side generator that builds the board; `join` keeps the lobby order.
 */
export function orderForGame<T>(players: readonly T[], orderMode: string, rng: Rng): T[] {
  return orderMode === 'random' ? shuffle(players, rng) : players.slice();
}

/** 一筆已提交指令的摘要，供 Bot 排程器喚醒與計時。 */
export interface CommitNotice {
  gameId: string;
  roomId: string;
  revision: number;
  actorId: string;
  commandId: string;
  events: GameEvent[];
  /** 這筆指令讓遊戲結束。 */
  finished: boolean;
}

export type GameLifecycleChange = 'resumed' | 'suspended' | 'abandoned';

export interface GameCoordinatorDeps {
  repo: Repository;
  rooms: RoomService;
  config: ServerConfig;
  /** 指令提交並推送後同步呼叫；實作只能排程，不可等待任何遊戲鎖。 */
  onCommitted?(notice: CommitNotice): void;
  /** 暫停、恢復或放棄生效後同步呼叫。 */
  onLifecycle?(gameId: string, change: GameLifecycleChange): void;
  /** 保留掃描的日誌輸出；未提供時不記錄。 */
  log?(level: 'info' | 'warn', message: string, meta?: unknown): void;
}

/** 一批保留掃描的結果。 */
export interface RetentionSweepResult {
  /** 本批終止的對局 id。 */
  expired: string[];
  /** 本批單筆失敗（已記 warn）的對局 id。 */
  failed: string[];
  /** 本批候選數量達到上限，可能還有積壓。 */
  full: boolean;
}

/**
 * 放棄的缺席條件（SPEC §4.6）：只看真人席位；Bot 永遠不缺席。其他席位全是
 * Bot 時，唯一的真人不需要缺席條件也能結束這局。
 */
function abandonmentEligible(members: readonly MemberRow[]): boolean {
  const humans = humanMembers(members);
  if (humans.length === 1) return true;
  return humans.some((member) => member.connected !== 1 || member.withdrawn === 1);
}

export class GameCoordinator {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: GameCoordinatorDeps) {}

  private get repo(): Repository {
    return this.deps.repo;
  }

  /** Serialises work per game so concurrent handlers cannot race. */
  private withLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(gameId) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.locks.set(
      gameId,
      next.catch(() => undefined),
    );
    return next;
  }

  // -- creation ------------------------------------------------------------

  async startGame(room: RoomRow, playerIds: string[]): Promise<string> {
    const profile = requireProfile(room.profile_id);
    const players: { id: string; nickname: string; color: 'red' }[] = [];
    for (const playerId of playerIds) {
      const guest = await this.repo.findGuest(playerId);
      players.push({
        id: playerId,
        nickname: guest?.nickname ?? 'player',
        color: 'red' as const,
      });
    }
    // Colours and seats come from the lobby membership, not from the client.
    const memberships = await this.repo.listMemberships(room.id);
    const ordered = memberships
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((membership) => {
        const guestIndex = players.findIndex((player) => player.id === membership.player_id);
        return {
          id: membership.player_id,
          nickname: players[guestIndex]?.nickname ?? 'player',
          color: membership.color as never,
        };
      });

    const rng = secureRng();
    const seated = orderForGame(ordered, room.order_mode, rng);
    const state = createGame({
      profileId: profile.id,
      players: seated,
      setupMode: room.setup_mode as 'fixed' | 'variable',
      rng,
    });
    const gameId = newId('game');
    const now = new Date().toISOString();
    await this.repo.transaction(async () => {
      await this.repo.insertGame({
        id: gameId,
        room_id: room.id,
        profile_id: profile.id,
        engine_version: state.engineVersion,
        state_json: JSON.stringify(state),
        revision: 1,
        status: 'playing',
        pause_reason: null,
        result_json: null,
        created_at: now,
        updated_at: now,
      });
      await this.repo.appendEvents(gameId, 1, state.log);
      // 隨機順序會改變遊戲座位；聊天與房間檢視都讀 membership.seat，
      // 因此把抽出的順序持久化，避免同一位玩家在兩個畫面顯示不同座位。
      for (const [seat, player] of seated.entries()) {
        const membership = memberships.find((candidate) => candidate.player_id === player.id);
        if (membership && membership.seat !== seat) {
          await this.repo.updateMembership(room.id, player.id, { seat });
        }
      }
    });
    return gameId;
  }

  // -- reads ---------------------------------------------------------------

  async requireGame(gameId: string): Promise<GameRow> {
    const game = await this.repo.findGame(gameId);
    if (!game) throw new ServiceError('E_GAME_NOT_FOUND', 'error.E_GAME_NOT_FOUND', { gameId }, 404);
    return game;
  }

  /** A player may only read games they hold a seat in. */
  async requireSeat(game: GameRow, playerId: string): Promise<void> {
    const membership = await this.repo.findMembership(game.room_id, playerId);
    if (!membership) {
      throw new ServiceError('E_NOT_SEATED', 'error.E_NOT_SEATED', { gameId: game.id }, 403);
    }
  }

  async snapshot(gameId: string, playerId: string): Promise<GameSnapshot> {
    const game = await this.requireGame(gameId);
    await this.requireSeat(game, playerId);
    const state = JSON.parse(game.state_json) as GameState;
    const events = await this.repo.listEvents(gameId, Math.max(0, state.seq - 40), 40);
    const view = projectGame(state, playerId, {
      events,
      hints: actionHints(state, playerId),
    });
    return { gameId, roomId: game.room_id, revision: game.revision, view };
  }

  async events(
    playerId: string,
    gameId: string,
    after: number,
    limit: number,
  ): Promise<{ events: CommandReceipt['events']; revision: number }> {
    const game = await this.requireGame(gameId);
    await this.requireSeat(game, playerId);
    const events = await this.repo.listEvents(gameId, after, Math.min(limit, 500));
    const filtered = events.filter((event) => !event.private || event.private.to.includes(playerId));
    return {
      events: filtered.map((event) => {
        if (!event.private) return event;
        return { seq: event.seq, type: event.type, params: { ...event.params, ...event.private.params } };
      }),
      revision: game.revision,
    };
  }

  async resumableGames(playerId: string): Promise<ResumableGameView[]> {
    const rooms = await this.repo.listRoomsForPlayer(playerId);
    const out: ResumableGameView[] = [];
    for (const room of rooms) {
      if (room.status === 'lobby' || room.status === 'completed' || room.status === 'abandoned') continue;
      const game = await this.repo.findGameByRoom(room.id);
      if (!game) continue;
      const memberships = await this.repo.listMembers(room.id);
      const players = memberships.map((membership) => ({
        playerId: membership.player_id,
        nickname: membership.nickname ?? 'player',
        color: membership.color,
        ...(isBotMember(membership) ? { bot: true } : {}),
      }));
      out.push({
        gameId: game.id,
        roomId: room.id,
        roomCode: room.code,
        profileId: room.profile_id,
        status: room.status as RoomStatus,
        players,
        lastSavedAt: game.updated_at,
        revision: game.revision,
        allSeatsNeeded: players.every((player) => !player.bot),
      });
    }
    return out;
  }

  // -- commands ------------------------------------------------------------

  async submit(playerId: string, gameId: string, request: CommandRequest): Promise<CommandReceipt> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireSeat(game, playerId);

      const digest = digestPayload({ command: request.command, expectedRevision: request.expectedRevision });
      const existing = await this.repo.findReceipt(gameId, playerId, request.commandId);
      if (existing) {
        if (existing.payload_digest !== digest) {
          throw new ServiceError('E_COMMAND_ID_REUSED', 'error.E_COMMAND_ID_REUSED', {
            commandId: request.commandId,
          });
        }
        return this.receiptFromRow(existing, playerId);
      }

      const room = await this.repo.findRoom(game.room_id);
      if (room?.status === 'suspended') {
        throw new ServiceError('E_GAME_SUSPENDED', 'error.E_GAME_SUSPENDED', { gameId }, 409);
      }
      if (room?.status === 'completed' || room?.status === 'abandoned') {
        throw new ServiceError('E_GAME_OVER', 'error.E_GAME_OVER', { gameId }, 409);
      }

      if (request.expectedRevision !== game.revision) {
        const rejection = await this.recordRejection(game, playerId, request, digest, {
          messageId: 'error.E_STALE_REVISION',
          params: { expected: request.expectedRevision, current: game.revision },
        });
        return rejection;
      }

      const state = JSON.parse(game.state_json) as GameState;
      const outcome = applyCommand(state, playerId, request.command as unknown as Command, secureRng());

      if (!outcome.ok) {
        return this.recordRejection(game, playerId, request, digest, {
          messageId: `error.${outcome.error.code}`,
          params: outcome.error.params ?? {},
        });
      }

      const revision = game.revision + 1;
      const events = outcome.events;
      await this.repo.transaction(async () => {
        await this.repo.saveGame(
          gameId,
          outcome.state,
          revision,
          outcome.state.result ? 'completed' : game.status,
          game.pause_reason,
        );
        await this.repo.appendEvents(gameId, revision, events);
        await this.repo.insertReceipt({
          game_id: gameId,
          player_id: playerId,
          command_id: request.commandId,
          payload_digest: digest,
          outcome: 'accepted',
          revision,
          error_json: null,
          events_json: JSON.stringify(events.slice(-RECEIPT_EVENT_LIMIT)),
          created_at: new Date().toISOString(),
        });
      });

      if (outcome.state.result) {
        await this.repo.updateRoom(game.room_id, { status: 'completed' });
      }
      this.publish(game.room_id, gameId, revision, events);
      this.notifyCommitted({
        gameId,
        roomId: game.room_id,
        revision,
        actorId: playerId,
        commandId: request.commandId,
        events,
        finished: !!outcome.state.result,
      });
      return {
        commandId: request.commandId,
        outcome: 'accepted',
        revision,
        events: events.slice(-RECEIPT_EVENT_LIMIT).map((event) => projectEvent(event, playerId)),
      };
    });
  }

  /** 通知失敗不能影響已提交的指令與回應。 */
  private notifyCommitted(notice: CommitNotice): void {
    try {
      this.deps.onCommitted?.(notice);
    } catch {
      // 排程器自行記錄錯誤；指令結果已持久化。
    }
  }

  private notifyLifecycle(gameId: string, change: GameLifecycleChange): void {
    try {
      this.deps.onLifecycle?.(gameId, change);
    } catch {
      // 同上
    }
  }

  private async recordRejection(
    game: GameRow,
    playerId: string,
    request: CommandRequest,
    digest: string,
    error: Notice,
  ): Promise<CommandReceipt> {
    await this.repo.insertReceipt({
      game_id: game.id,
      player_id: playerId,
      command_id: request.commandId,
      payload_digest: digest,
      outcome: 'rejected',
      revision: game.revision,
      error_json: JSON.stringify(error),
      events_json: '[]',
      created_at: new Date().toISOString(),
    });
    return {
      commandId: request.commandId,
      outcome: 'rejected',
      revision: game.revision,
      error,
      events: [],
    };
  }

  private receiptFromRow(row: {
    outcome: string;
    revision: number;
    error_json: string | null;
    events_json: string;
    command_id: string;
  }, playerId: string): CommandReceipt {
    const receipt: CommandReceipt = {
      commandId: row.command_id,
      outcome: row.outcome as 'accepted' | 'rejected',
      revision: row.revision,
      events: (JSON.parse(row.events_json) as GameEvent[]).map((event) => projectEvent(event, playerId)),
    };
    if (row.error_json) receipt.error = JSON.parse(row.error_json) as Notice;
    return receipt;
  }

  /** Pushes a fresh authorised projection to every connected seated player. */
  private publish(roomId: string, gameId: string, revision: number, events: CommandReceipt['events']): void {
    const memberships = this.deps.rooms.connectionsInRoom(roomId);
    const seen = new Set<string>();
    for (const connection of memberships) {
      if (seen.has(connection.playerId)) continue;
      seen.add(connection.playerId);
      void this.snapshot(gameId, connection.playerId)
        .then((snapshot) => {
          this.deps.rooms.sendTo(connection.playerId, { type: 'snapshot', payload: snapshot }, roomId);
        })
        .catch(() => undefined);
    }
    void events;
    void revision;
  }

  // -- save, suspend, resume ----------------------------------------------

  /** Individual save barrier: acknowledges the current committed revision. */
  async save(playerId: string, gameId: string, requestId: string): Promise<SaveReceipt> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireSeat(game, playerId);
      const existing = await this.repo.findSaveReceipt(gameId, playerId, requestId);
      if (existing) {
        return {
          requestId,
          gameId,
          revision: existing.revision,
          savedAt: existing.saved_at,
          outcome: existing.outcome as 'saved' | 'failed',
        };
      }
      const savedAt = new Date().toISOString();
      try {
        await this.repo.transaction(async () => {
          await this.repo.saveGame(gameId, JSON.parse(game.state_json) as GameState, game.revision, game.status, game.pause_reason);
          await this.repo.insertSaveReceipt({
            game_id: gameId,
            player_id: playerId,
            request_id: requestId,
            revision: game.revision,
            outcome: 'saved',
            saved_at: savedAt,
          });
        });
      } catch (error) {
        void error;
        return {
          requestId,
          gameId,
          revision: game.revision,
          savedAt,
          outcome: 'failed',
          error: { messageId: 'error.E_SAVE_FAILED' },
        };
      }
      return { requestId, gameId, revision: game.revision, savedAt, outcome: 'saved' };
    });
  }

  /**
   * 終局的對局（completed／abandoned，或規則狀態已有結果）不可再暫停或恢復，
   * 否則已結束的桌子會被存檔流程改回 suspended／playing（§4.6：第一個有效的
   * 終局轉換勝出）。
   */
  private assertNotTerminal(game: GameRow): void {
    const finished =
      game.status === 'completed' ||
      game.status === 'abandoned' ||
      !!(JSON.parse(game.state_json) as GameState).result;
    if (finished) {
      throw new ServiceError('E_GAME_OVER', 'error.E_GAME_OVER', { gameId: game.id }, 409);
    }
  }

  /** All-seat save/suspend proposal; the table freezes once everyone consents. */
  async proposeSuspend(playerId: string, gameId: string): Promise<{ proposalId: string }> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireSeat(game, playerId);
      this.assertNotTerminal(game);
      const existing = await this.repo.findOpenGameProposal(gameId, 'suspend');
      if (existing) return { proposalId: existing.id };
      const proposalId = newId('suspend');
      await this.repo.insertGameProposal({
        id: proposalId,
        game_id: gameId,
        kind: 'suspend',
        proposed_by: playerId,
        status: 'open',
        created_at: new Date().toISOString(),
      });
      await this.repo.insertGameConsent(proposalId, playerId);
      await this.tryApplySuspend(game, proposalId);
      return { proposalId };
    });
  }

  async consentSuspend(
    playerId: string,
    gameId: string,
    proposalId: string,
    approve: boolean,
  ): Promise<{ suspended: boolean }> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireSeat(game, playerId);
      this.assertNotTerminal(game);
      const proposal = await this.repo.findOpenGameProposal(gameId, 'suspend');
      if (!proposal || proposal.id !== proposalId) {
        throw new ServiceError('E_NO_PROPOSAL', 'error.E_NO_PROPOSAL', { proposalId }, 404);
      }
      if (!approve) {
        await this.repo.updateGameProposalStatus(proposalId, 'rejected');
        return { suspended: false };
      }
      await this.repo.insertGameConsent(proposalId, playerId);
      return { suspended: await this.tryApplySuspend(game, proposalId) };
    });
  }

  private async tryApplySuspend(game: GameRow, proposalId: string): Promise<boolean> {
    // Bot 席位視為同意，只需要真人一致同意（SPEC §4.6）。
    const memberships = humanMembers(await this.repo.listMembers(game.room_id));
    const consents = new Set(await this.repo.listGameConsents(proposalId));
    if (!memberships.every((membership) => consents.has(membership.player_id))) return false;
    await this.repo.transaction(async () => {
      await this.repo.saveGame(
        game.id,
        JSON.parse(game.state_json) as GameState,
        game.revision,
        'suspended',
        'saved',
      );
      await this.repo.updateGameProposalStatus(proposalId, 'applied');
      await this.repo.updateRoom(game.room_id, { status: 'suspended' });
      await this.repo.clearGameReady(game.id);
    });
    this.deps.rooms.broadcastRoom(game.room_id);
    this.notifyLifecycle(game.id, 'suspended');
    return true;
  }

  /** Resume requires every seat to be connected and explicitly ready. */
  async setResumeReady(
    playerId: string,
    gameId: string,
    ready: boolean,
  ): Promise<{ resumed: boolean; waitingFor: string[] }> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireSeat(game, playerId);
      this.assertNotTerminal(game);
      await this.repo.setGameReady(gameId, playerId, ready);
      // 只等真人；Bot 永遠在線且就緒。
      const memberships = humanMembers(await this.repo.listMembers(game.room_id));
      const readiness = new Map(
        (await this.repo.listGameReady(gameId)).map((row) => [row.player_id, row.ready === 1]),
      );
      const waitingFor = memberships
        .filter((membership) => membership.connected !== 1 || readiness.get(membership.player_id) !== true)
        .map((membership) => membership.player_id);
      if (waitingFor.length > 0) return { resumed: false, waitingFor };
      await this.repo.transaction(async () => {
        await this.repo.saveGame(
          gameId,
          JSON.parse(game.state_json) as GameState,
          game.revision,
          'playing',
          null,
        );
        await this.repo.updateRoom(game.room_id, { status: 'playing' });
        await this.repo.clearGameReady(gameId);
      });
      this.deps.rooms.broadcastRoom(game.room_id);
      this.notifyLifecycle(gameId, 'resumed');
      return { resumed: true, waitingFor: [] };
    });
  }

  // -- abandonment of an interrupted table --------------------------------

  /**
   * §4.6: any connected seated player may propose abandonment once the policy
   * allows it and at least one seat is absent or has withdrawn. Every currently
   * connected seated player must confirm the same proposal.
   */
  async proposeAbandon(playerId: string, gameId: string): Promise<{ proposalId: string }> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireSeat(game, playerId);
      const room = await this.repo.findRoom(game.room_id);
      if (!room) throw new ServiceError('E_ROOM_NOT_FOUND', 'error.E_ROOM_NOT_FOUND', {}, 404);
      const policy = this.policyOfRoom(room.policy_json);
      if (!policy.allowAbandonment) {
        throw new ServiceError('E_ABANDON_DISABLED', 'error.E_ABANDON_DISABLED', {}, 409);
      }
      const state = JSON.parse(game.state_json) as GameState;
      if (state.result) {
        throw new ServiceError('E_GAME_OVER', 'error.E_GAME_OVER', { gameId }, 409);
      }
      const memberships = await this.repo.listMembers(game.room_id);
      if (!abandonmentEligible(memberships)) {
        throw new ServiceError('E_NO_ABSENT_PLAYER', 'error.E_NO_ABSENT_PLAYER', {}, 409);
      }
      const existing = await this.repo.findOpenGameProposal(gameId, 'abandon');
      if (existing) return { proposalId: existing.id };
      const proposalId = newId('abandon');
      await this.repo.insertGameProposal({
        id: proposalId,
        game_id: gameId,
        kind: 'abandon',
        proposed_by: playerId,
        status: 'open',
        created_at: new Date().toISOString(),
      });
      await this.repo.insertGameConsent(proposalId, playerId);
      await this.tryApplyAbandon(game, proposalId);
      return { proposalId };
    });
  }

  async consentAbandon(
    playerId: string,
    gameId: string,
    proposalId: string,
    approve: boolean,
  ): Promise<{ abandoned: boolean }> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireSeat(game, playerId);
      const proposal = await this.repo.findOpenGameProposal(gameId, 'abandon');
      if (!proposal || proposal.id !== proposalId) {
        throw new ServiceError('E_NO_PROPOSAL', 'error.E_NO_PROPOSAL', { proposalId }, 404);
      }
      if (!approve) {
        await this.repo.updateGameProposalStatus(proposalId, 'rejected');
        return { abandoned: false };
      }
      await this.repo.insertGameConsent(proposalId, playerId);
      return { abandoned: await this.tryApplyAbandon(game, proposalId) };
    });
  }

  private async tryApplyAbandon(game: GameRow, proposalId: string): Promise<boolean> {
    const room = await this.repo.findRoom(game.room_id);
    if (!room) return false;
    if (!this.policyOfRoom(room.policy_json).allowAbandonment) {
      await this.repo.updateGameProposalStatus(proposalId, 'cancelled');
      return false;
    }
    const memberships = await this.repo.listMembers(game.room_id);
    // Recheck the absence condition: a reconnection invalidates the vote.
    if (!abandonmentEligible(memberships)) {
      await this.repo.updateGameProposalStatus(proposalId, 'cancelled');
      return false;
    }
    // Bot 席位不投票。
    const voters = humanMembers(memberships).filter((member) => member.connected === 1);
    const consents = new Set(await this.repo.listGameConsents(proposalId));
    if (!voters.every((voter) => consents.has(voter.player_id))) return false;

    const fresh = await this.requireGame(game.id);
    const current = JSON.parse(fresh.state_json) as GameState;
    if (current.result) {
      // A committed victory outranks a later abandonment request.
      await this.repo.updateGameProposalStatus(proposalId, 'cancelled');
      return false;
    }
    const abandoned = abandonGame(current);
    await this.repo.transaction(async () => {
      await this.repo.saveGame(game.id, abandoned, fresh.revision + 1, 'abandoned', null);
      await this.repo.appendEvents(game.id, fresh.revision + 1, abandoned.log.slice(-1));
      await this.repo.updateGameProposalStatus(proposalId, 'applied');
      await this.repo.updateRoom(game.room_id, { status: 'abandoned' });
      await this.repo.cancelOpenGameProposals(game.id);
    });
    this.deps.rooms.broadcastRoom(game.room_id);
    this.notifyLifecycle(game.id, 'abandoned');
    return true;
  }

  // -- operator retention --------------------------------------------------

  /**
   * §4.6 營運者保留機制：終止超過 `gameRetentionDays` 天沒有活動的未結束對局
   * （進行中、interrupted、suspended 皆是）。每次最多處理 `limit` 筆（依對局最後
   * 寫入時間由舊到新）候選；單筆失敗只記 warn，不中斷整批。停用（0 天）時什麼都不做。
   */
  async expireIdleGames(
    now: Date = new Date(),
    limit: number = RETENTION_BATCH_SIZE,
  ): Promise<RetentionSweepResult> {
    const result: RetentionSweepResult = { expired: [], failed: [], full: false };
    const days = this.deps.config.gameRetentionDays;
    if (days <= 0) return result;
    const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString();
    const candidates = await this.repo.listIdleGames(cutoff, limit);
    result.full = candidates.length >= limit;
    for (const candidate of candidates) {
      try {
        if (await this.expireIdleGame(candidate.id, cutoff)) result.expired.push(candidate.id);
      } catch (error) {
        result.failed.push(candidate.id);
        this.deps.log?.('warn', 'game retention failed', { gameId: candidate.id, error: String(error) });
      }
    }
    return result;
  }

  /** 與一般指令共用每局的鎖：取得鎖之後重新確認仍閒置、仍未結束，勝利優先。 */
  private expireIdleGame(gameId: string, cutoff: string): Promise<boolean> {
    return this.withLock(gameId, async () => {
      const fresh = await this.requireGame(gameId);
      const current = JSON.parse(fresh.state_json) as GameState;
      // 排隊期間可能已有終局（勝利優先）。
      if (current.result) return false;
      const abandoned = abandonGame(current, 'expired');
      const idle = await this.repo.transaction<IdleGameRow | null>(async () => {
        // 閒置確認與終止寫入放在同一個交易：連線、房主轉移等不經每局鎖的活動
        // 不會在兩者之間插入。SQLite 的交易會讓其他呼叫者排隊，視窗完全關閉；
        // PostgreSQL 為 READ COMMITTED，只能縮小視窗，無法完全消除。
        const [row] = await this.repo.listIdleGames(cutoff, 1, gameId);
        if (!row) return null;
        await this.repo.saveGame(gameId, abandoned, fresh.revision + 1, 'abandoned', null);
        await this.repo.appendEvents(gameId, fresh.revision + 1, abandoned.log.slice(-1));
        await this.repo.updateRoom(fresh.room_id, { status: 'abandoned' });
        await this.repo.cancelOpenGameProposals(gameId);
        return row;
      });
      // 期間出現了新活動，這局保留。
      if (!idle) return false;
      this.deps.rooms.broadcastRoom(fresh.room_id);
      // 仍連線的客戶端要拿到帶有 `expired` 原因的終局投影，而不只是房間狀態。
      this.publish(fresh.room_id, gameId, fresh.revision + 1, abandoned.log.slice(-1));
      this.notifyLifecycle(gameId, 'abandoned');
      const lastActivity = [idle.updated_at, idle.room_updated_at, idle.last_seen_at ?? ''].sort().pop();
      this.deps.log?.('info', 'game expired by retention policy', {
        gameId,
        roomId: fresh.room_id,
        lastActivityAt: lastActivity,
        retentionDays: this.deps.config.gameRetentionDays,
      });
      return true;
    });
  }

  private policyOfRoom(policyJson: string): { allowAbandonment: boolean } {
    try {
      const parsed = JSON.parse(policyJson) as { allowAbandonment?: boolean };
      return { allowAbandonment: parsed.allowAbandonment !== false };
    } catch {
      return { allowAbandonment: true };
    }
  }

  /** Game state for tests and diagnostics; never exposed over HTTP directly. */
  async rawState(gameId: string): Promise<GameState> {
    const game = await this.requireGame(gameId);
    return JSON.parse(game.state_json) as GameState;
  }
}
