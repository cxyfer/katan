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
  ENGINE_VERSION,
  projectGame,
  requireProfile,
  secureRng,
  type Command,
  type GameEvent,
  type GameState,
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
import { digestPayload, newId, type GameRow, type MemberRow, type Repository, type RoomRow } from './db.ts';
import { ServiceError, type RoomService } from './rooms.ts';
import { humanMembers, isBotMember } from './bot-seats.ts';

const RECEIPT_EVENT_LIMIT = 200;

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

    const state = createGame({
      profileId: profile.id,
      players: ordered,
      setupMode: room.setup_mode as 'fixed' | 'variable',
      rng: secureRng(),
    });
    const gameId = newId('game');
    const now = new Date().toISOString();
    await this.repo.transaction(async () => {
      await this.repo.insertGame({
        id: gameId,
        room_id: room.id,
        profile_id: profile.id,
        engine_version: ENGINE_VERSION,
        state_json: JSON.stringify(state),
        revision: 1,
        status: 'playing',
        pause_reason: null,
        result_json: null,
        created_at: now,
        updated_at: now,
      });
      await this.repo.appendEvents(gameId, 1, state.log);
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
        allSeatsNeeded: true,
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
        return this.receiptFromRow(existing);
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
        events,
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
  }): CommandReceipt {
    const receipt: CommandReceipt = {
      commandId: row.command_id,
      outcome: row.outcome as 'accepted' | 'rejected',
      revision: row.revision,
      events: JSON.parse(row.events_json) as CommandReceipt['events'],
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

  /** All-seat save/suspend proposal; the table freezes once everyone consents. */
  async proposeSuspend(playerId: string, gameId: string): Promise<{ proposalId: string }> {
    return this.withLock(gameId, async () => {
      const game = await this.requireGame(gameId);
      await this.requireSeat(game, playerId);
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
