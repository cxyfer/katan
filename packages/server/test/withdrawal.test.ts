/** R-ROOM / R-POLICY: explicit withdrawal, solo end and Save and leave (§4.6, §4.8). */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { GameState, GameView } from '@catan/rules';
import type {
  AbandonProposeResult,
  ResumableGameView,
  RoomView,
  ServerMessage,
  WithdrawResult,
} from '@catan/protocol';
import type { Connection } from '../src/rooms.ts';
import {
  runSetupOverApi,
  startHarness,
  startedGame,
  type TestClient,
  type TestHarness,
} from './helpers.ts';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface Snapshot {
  revision: number;
  view: GameView;
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  revision: number;
}

function id(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function setOffline(roomId: string, playerId: string, offline: boolean): Promise<void> {
  await harness.service.repo.updateMembership(roomId, playerId, {
    connected: offline ? 0 : 1,
    disconnected_at: offline ? new Date().toISOString() : null,
  });
}

/** 模擬真人的 live socket 回來（走真正的 registerConnection 路徑）。 */
async function reconnect(roomId: string, playerId: string): Promise<() => Promise<void>> {
  const connection: Connection = { id: randomUUID(), playerId, roomId, send() {}, close() {} };
  await harness.service.rooms.registerConnection(connection);
  return () => harness.service.rooms.unregisterConnection(connection);
}

async function roomOf(client: TestClient, roomId: string): Promise<RoomView> {
  return client.expectOk<RoomView>(await client.get(`/api/rooms/${roomId}`));
}

async function withdraw(client: TestClient, gameId: string, withdrawn: boolean): Promise<WithdrawResult> {
  return client.expectOk<WithdrawResult>(await client.post(`/api/games/${gameId}/withdraw`, { withdrawn }));
}

async function stateOf(gameId: string): Promise<GameState> {
  return harness.service.games.rawState(gameId);
}

/** 一位真人房主加上 `bots` 個 Bot 並開局（沒有 socket，Bot 不會自己行動）。 */
async function botTable(bots = 2): Promise<{ host: TestClient; roomId: string; gameId: string }> {
  const host = await harness.client('SoloHost');
  let room = host.expectOk<RoomView>(
    await host.post('/api/rooms', {
      visibility: 'private',
      capacity: bots + 1,
      profileId: 'base-2025',
      setupMode: 'fixed',
    }),
  );
  for (let index = 0; index < bots; index++) {
    room = host.expectOk<RoomView>(await host.post(`/api/rooms/${room.id}/bots`, { level: 'easy' }));
  }
  host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
  const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
  return { host, roomId: room.id, gameId };
}

/** 開局時就關閉放棄選項的多人桌。 */
async function tableWithoutAbandonment(count: number): Promise<{ clients: TestClient[]; roomId: string; gameId: string }> {
  const clients: TestClient[] = [];
  for (let i = 0; i < count; i++) clients.push(await harness.client(`NA${i + 1}`));
  const host = clients[0]!;
  const room = host.expectOk<RoomView>(
    await host.post('/api/rooms', {
      visibility: 'private',
      capacity: count,
      profileId: 'base-2025',
      setupMode: 'fixed',
      policy: { allowAbandonment: false },
    }),
  );
  for (let i = 1; i < count; i++) {
    clients[i]!.expectOk(await clients[i]!.post('/api/rooms/join', { code: room.code }));
  }
  for (const client of clients) {
    client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
  }
  const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
  return { clients, roomId: room.id, gameId };
}

/**
 * 決定性的勝利局面：下一個席位已有勝利分數，目前行動者結束回合即在該席位回合
 * 開始時產生勝利（與 recovery.test 相同的手法）。回傳目前行動者的 playerId。
 */
async function armVictory(gameId: string): Promise<{ actorId: string; winnerId: string }> {
  const row = await harness.service.repo.findGame(gameId);
  const state = JSON.parse(row!.state_json) as GameState;
  const currentSeat = state.turn.seat;
  const winnerSeat = (currentSeat + 1) % state.players.length;
  state.players[winnerSeat]!.bonusPoints = 10;
  state.turn.phase = 'action';
  await harness.service.repo.saveGame(gameId, state, row!.revision, 'playing', null);
  return { actorId: state.players[currentSeat]!.id, winnerId: state.players[winnerSeat]!.id };
}

async function endTurn(client: TestClient, gameId: string): Promise<Receipt> {
  const current = client.expectOk<Snapshot>(await client.get(`/api/games/${gameId}`));
  return client.expectOk<Receipt>(
    await client.post(`/api/games/${gameId}/commands`, {
      commandId: id('end'),
      expectedRevision: current.revision,
      command: { type: 'turn.end' },
    }),
  );
}

describe('solo table: end the game or keep it', () => {
  it('ends at once with no winner and drops out of the resumable list', async () => {
    const { host, roomId, gameId } = await botTable(2);
    const listed = host.expectOk<{ games: ResumableGameView[] }>(await host.get('/api/games'));
    expect(listed.games.map((game) => game.gameId)).toContain(gameId);

    const result = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));
    expect(result.abandoned).toBe(true);
    expect(result.proposalId).toBeTruthy();

    expect((await harness.service.repo.findRoom(roomId))!.status).toBe('abandoned');
    const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    expect(snapshot.view.result?.playerId).toBeNull();
    expect(snapshot.view.result?.reason).toBe('abandoned');
    const after = host.expectOk<{ games: ResumableGameView[] }>(await host.get('/api/games'));
    expect(after.games.map((game) => game.gameId)).not.toContain(gameId);
  });

  it('does not bypass a disabled abandonment policy', async () => {
    const host = await harness.client('SoloPolicy');
    let room = host.expectOk<RoomView>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
        policy: { allowAbandonment: false },
      }),
    );
    for (let index = 0; index < 2; index++) {
      room = host.expectOk<RoomView>(await host.post(`/api/rooms/${room.id}/bots`, { level: 'easy' }));
    }
    host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
    host.expectError(await host.post(`/api/games/${gameId}/abandon`, {}), 'E_ABANDON_DISABLED');
    // 唯一的真人退出也不會結束：policy 關閉時保留對局。
    expect(await withdraw(host, gameId, true)).toEqual({ withdrawn: true, abandoned: false });
    expect((await harness.service.repo.findRoom(room.id))!.status).toBe('playing');
  });

  it('keeps the game resumable and un-withdrawn after Save and leave', async () => {
    const { host, roomId, gameId } = await botTable(2);
    const saved = host.expectOk<{ outcome: string }>(
      await host.post(`/api/games/${gameId}/save`, { requestId: id('save') }),
    );
    expect(saved.outcome).toBe('saved');
    host.expectOk(await host.post(`/api/rooms/${roomId}/leave`, {}));

    const listed = host.expectOk<{ games: ResumableGameView[] }>(await host.get('/api/games'));
    const entry = listed.games.find((game) => game.gameId === gameId);
    expect(entry).toBeDefined();
    expect(entry!.withdrawn).toBe(false);
    expect(entry!.status).toBe('playing');
    const me = (await roomOf(host, roomId)).members.find((member) => member.self);
    expect(me?.withdrawn).toBe(false);
  });
});

describe('explicit withdrawal at a multi-person table', () => {
  it('shows in the room view and refuses the seat any command', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    const { revision } = await runSetupOverApi(clients, gameId);
    const [host, , third] = clients as [TestClient, TestClient, TestClient];

    expect(await withdraw(third, gameId, true)).toEqual({ withdrawn: true, abandoned: false });
    const view = await roomOf(host, roomId);
    expect(view.members.find((member) => member.playerId === third.playerId)?.withdrawn).toBe(true);
    expect(view.members.filter((member) => member.withdrawn)).toHaveLength(1);

    third.expectError(
      await third.post(`/api/games/${gameId}/commands`, {
        commandId: id('withdrawn-act'),
        expectedRevision: revision,
        command: { type: 'turn.roll' },
      }),
      'E_SEAT_WITHDRAWN',
    );
    // 冪等：同樣的狀態再送一次不報錯、不改變任何東西。
    expect(await withdraw(third, gameId, true)).toEqual({ withdrawn: true, abandoned: false });
  });

  it('lists the withdrawn game for its owner so it can be taken back', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, , third] = clients as [TestClient, TestClient, TestClient];
    await withdraw(third, gameId, true);

    const mine = third.expectOk<{ games: ResumableGameView[] }>(await third.get('/api/games'));
    expect(mine.games.find((game) => game.gameId === gameId)?.withdrawn).toBe(true);
    const others = host.expectOk<{ games: ResumableGameView[] }>(await host.get('/api/games'));
    expect(others.games.find((game) => game.gameId === gameId)?.withdrawn).toBe(false);
  });

  it('makes abandonment eligible and counts the withdrawn seat as consenting', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 4);
    await runSetupOverApi(clients, gameId);
    const [host, second, third, fourth] = clients as [TestClient, TestClient, TestClient, TestClient];
    host.expectError(await host.post(`/api/games/${gameId}/abandon`, {}), 'E_NO_ABSENT_PLAYER');

    await withdraw(fourth, gameId, true);
    // 退出者仍在線，但不需要投票：其餘三位在線者同意即可。
    const proposal = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));
    expect(proposal.abandoned).toBe(false);

    let view = await roomOf(second, roomId);
    expect(view.pendingAbandon).toMatchObject({
      id: proposal.proposalId,
      proposedBy: host.playerId,
      consents: [host.playerId],
      absent: [fourth.playerId],
    });

    const partial = second.expectOk<{ abandoned: boolean }>(
      await second.post(`/api/games/${gameId}/abandon`, { proposalId: proposal.proposalId, approve: true }),
    );
    expect(partial.abandoned).toBe(false);
    view = await roomOf(second, roomId);
    expect([...view.pendingAbandon!.consents].sort()).toEqual([host.playerId, second.playerId].sort());

    const final = third.expectOk<{ abandoned: boolean }>(
      await third.post(`/api/games/${gameId}/abandon`, { proposalId: proposal.proposalId, approve: true }),
    );
    expect(final.abandoned).toBe(true);
    const ended = await roomOf(host, roomId);
    expect(ended.status).toBe('abandoned');
    expect(ended.pendingAbandon).toBeNull();
    expect((await stateOf(gameId)).result?.playerId).toBeNull();
  });

  it('names offline and withdrawn seats together as absent', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 4);
    await runSetupOverApi(clients, gameId);
    const [host, second, third, fourth] = clients as [TestClient, TestClient, TestClient, TestClient];
    await setOffline(roomId, fourth.playerId!, true);
    await withdraw(third, gameId, true);
    host.expectOk(await host.post(`/api/games/${gameId}/abandon`, {}));
    const view = await roomOf(second, roomId);
    expect([...view.pendingAbandon!.absent].sort()).toEqual([third.playerId, fourth.playerId].sort());
  });

  it('counts a proposal as consent when another proposal is already open', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    await withdraw(third, gameId, true);

    const first = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));
    expect(first.abandoned).toBe(false);
    // 第二位按「提出」＝同意同一份提案，重複提出也不會出錯。
    const again = second.expectOk<AbandonProposeResult>(await second.post(`/api/games/${gameId}/abandon`, {}));
    expect(again.proposalId).toBe(first.proposalId);
    expect(again.abandoned).toBe(true);
  });

  it('retracting cancels the open proposal and returns the seat to play', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    const { revision } = await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    await withdraw(third, gameId, true);
    const proposal = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));

    expect(await withdraw(third, gameId, false)).toEqual({ withdrawn: false, abandoned: false });
    expect((await roomOf(host, roomId)).pendingAbandon).toBeNull();
    second.expectError(
      await second.post(`/api/games/${gameId}/abandon`, { proposalId: proposal.proposalId, approve: true }),
      'E_NO_PROPOSAL',
    );
    expect((await roomOf(host, roomId)).status).toBe('playing');

    // 座位不再被 E_SEAT_WITHDRAWN 擋下（指令可能因輪次被引擎拒絕，但不是退出）。
    const response = await third.post<Receipt>(`/api/games/${gameId}/commands`, {
      commandId: id('after-retract'),
      expectedRevision: revision,
      command: { type: 'turn.roll' },
    });
    if (!response.body.ok) expect(response.body.error.code).not.toBe('E_SEAT_WITHDRAWN');
  });

  it('withdrawing or retracting leaves a suspend proposal alone', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, , third] = clients as [TestClient, TestClient, TestClient];
    const suspend = host.expectOk<{ proposalId: string }>(await host.post(`/api/games/${gameId}/suspend`, {}));
    await withdraw(third, gameId, true);
    await withdraw(third, gameId, false);
    const open = await harness.service.repo.findOpenGameProposal(gameId, 'suspend');
    expect(open?.id).toBe(suspend.proposalId);
  });

  it('refuses a seatless player', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const outsider = await harness.client('WithdrawOutsider');
    outsider.expectError(await outsider.post(`/api/games/${gameId}/withdraw`, { withdrawn: true }), 'E_NOT_SEATED');
    clients[0]!.expectError(await clients[0]!.post(`/api/games/${gameId}/withdraw`, {}), 'E_BAD_REQUEST');
  });
});

describe('everyone withdraws', () => {
  it('ends the game with no winner as soon as the last person withdraws', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    const { revision } = await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];

    expect(await withdraw(host, gameId, true)).toEqual({ withdrawn: true, abandoned: false });
    expect(await withdraw(second, gameId, true)).toEqual({ withdrawn: true, abandoned: false });
    expect(await withdraw(third, gameId, true)).toEqual({ withdrawn: true, abandoned: true });

    expect((await roomOf(host, roomId)).status).toBe('abandoned');
    const state = await stateOf(gameId);
    expect(state.result?.playerId).toBeNull();
    expect(state.result?.reason).toBe('abandoned');

    // 終局後再下指令或再退出一律是 E_GAME_OVER。
    third.expectError(
      await third.post(`/api/games/${gameId}/commands`, {
        commandId: id('after-all-withdrew'),
        expectedRevision: revision,
        command: { type: 'turn.roll' },
      }),
      'E_GAME_OVER',
    );
    second.expectError(await second.post(`/api/games/${gameId}/withdraw`, { withdrawn: false }), 'E_GAME_OVER');
  });

  it('keeps the game playing when the room policy disables abandonment', async () => {
    const { clients, gameId, roomId } = await tableWithoutAbandonment(3);
    await runSetupOverApi(clients, gameId);
    for (const client of clients) {
      expect(await withdraw(client, gameId, true)).toEqual({ withdrawn: true, abandoned: false });
    }
    const room = await roomOf(clients[0]!, roomId);
    expect(room.status).toBe('playing');
    expect(room.members.every((member) => member.withdrawn)).toBe(true);
    expect((await stateOf(gameId)).result).toBeNull();
    // 仍可撤回，對局保留。
    expect(await withdraw(clients[1]!, gameId, false)).toEqual({ withdrawn: false, abandoned: false });
  });
});

describe('reconnection of withdrawn and absent seats', () => {
  it('does not clear the withdrawal or cancel the vote when a withdrawn seat returns', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    await setOffline(roomId, third.playerId!, true);
    await withdraw(third, gameId, true);
    const proposal = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));

    const drop = await reconnect(roomId, third.playerId!);
    try {
      const view = await roomOf(host, roomId);
      expect(view.members.find((member) => member.playerId === third.playerId)?.withdrawn).toBe(true);
      expect(view.pendingAbandon?.id).toBe(proposal.proposalId);
      const applied = second.expectOk<{ abandoned: boolean }>(
        await second.post(`/api/games/${gameId}/abandon`, { proposalId: proposal.proposalId, approve: true }),
      );
      expect(applied.abandoned).toBe(true);
    } finally {
      await drop();
    }
  });

  it('still cancels the vote when an absent, non-withdrawn seat returns', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, , third] = clients as [TestClient, TestClient, TestClient];
    await setOffline(roomId, third.playerId!, true);
    host.expectOk(await host.post(`/api/games/${gameId}/abandon`, {}));
    expect((await roomOf(host, roomId)).pendingAbandon).not.toBeNull();

    const drop = await reconnect(roomId, third.playerId!);
    try {
      expect((await roomOf(host, roomId)).pendingAbandon).toBeNull();
    } finally {
      await drop();
    }
  });

  it('cannot end the game with a stale consent after the absent seat returned', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    await setOffline(roomId, third.playerId!, true);
    const proposal = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));

    const drop = await reconnect(roomId, third.playerId!);
    try {
      second.expectError(
        await second.post(`/api/games/${gameId}/abandon`, { proposalId: proposal.proposalId, approve: true }),
        'E_NO_PROPOSAL',
      );
      expect((await roomOf(host, roomId)).status).toBe('playing');
      expect((await stateOf(gameId)).result).toBeNull();
    } finally {
      await drop();
    }
  });

  it('marks the returning seat connected before it cancels the vote', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, , third] = clients as [TestClient, TestClient, TestClient];
    await setOffline(roomId, third.playerId!, true);
    host.expectOk(await host.post(`/api/games/${gameId}/abandon`, {}));

    // 取消投票的那一刻，重連者必須已經是 connected；否則取消前後之間成立的新提案
    // 仍會把他當成缺席，之後不會再被取消。
    const original = harness.service.rooms.invalidateGameVotes.bind(harness.service.rooms);
    const seen: (number | undefined)[] = [];
    const spy = vi.spyOn(harness.service.rooms, 'invalidateGameVotes').mockImplementation(async (id) => {
      seen.push((await harness.service.repo.findMembership(roomId, third.playerId!))?.connected);
      await original(id);
    });
    const drop = await reconnect(roomId, third.playerId!);
    try {
      expect(seen).toEqual([1]);
    } finally {
      spy.mockRestore();
      await drop();
    }
  });
});

describe('withdrawn seats cannot propose or vote', () => {
  it('refuses propose, approve and reject without touching the proposal', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 4);
    await runSetupOverApi(clients, gameId);
    const [host, , , fourth] = clients as [TestClient, TestClient, TestClient, TestClient];
    await withdraw(fourth, gameId, true);

    // 還沒有提案時，退出者不能開提案。
    fourth.expectError(await fourth.post(`/api/games/${gameId}/abandon`, {}), 'E_SEAT_WITHDRAWN');
    expect((await roomOf(host, roomId)).pendingAbandon).toBeNull();

    const proposal = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));
    const before = (await roomOf(host, roomId)).pendingAbandon;
    expect(before?.id).toBe(proposal.proposalId);

    fourth.expectError(await fourth.post(`/api/games/${gameId}/abandon`, {}), 'E_SEAT_WITHDRAWN');
    fourth.expectError(
      await fourth.post(`/api/games/${gameId}/abandon`, { proposalId: proposal.proposalId, approve: true }),
      'E_SEAT_WITHDRAWN',
    );
    fourth.expectError(
      await fourth.post(`/api/games/${gameId}/abandon`, { proposalId: proposal.proposalId, approve: false }),
      'E_SEAT_WITHDRAWN',
    );

    // 提案仍是 open，同意者不變，其他人還能照常完成它。
    expect((await roomOf(host, roomId)).pendingAbandon).toEqual(before);
    expect((await harness.service.repo.findOpenGameProposal(gameId, 'abandon'))?.id).toBe(proposal.proposalId);
  });

  it('lets the seat vote again once it retracts the withdrawal', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, , third] = clients as [TestClient, TestClient, TestClient];
    await setOffline(roomId, host.playerId!, true);
    await withdraw(third, gameId, true);
    third.expectError(await third.post(`/api/games/${gameId}/abandon`, {}), 'E_SEAT_WITHDRAWN');
    await withdraw(third, gameId, false);
    // 撤回後恢復一般成員身分：離線的房主讓放棄成立資格，第三位可以提案。
    const proposal = third.expectOk<AbandonProposeResult>(await third.post(`/api/games/${gameId}/abandon`, {}));
    expect(proposal.proposalId).toBeTruthy();
  });
});

interface RoomFeed {
  rooms: RoomView[];
  close(): Promise<void>;
}

/** 以真實 WebSocket 訂閱房間，收集推送的 room 訊息。 */
async function subscribeRoom(client: TestClient, roomId: string): Promise<RoomFeed> {
  const socket = new WebSocket(`${harness.base.replace('http', 'ws')}/ws`, { headers: { cookie: client.cookie! } });
  const rooms: RoomView[] = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    if (message.type === 'room') rooms.push(message.payload);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'subscribe', payload: { roomId } }));
  await vi.waitFor(() => expect(rooms.length).toBeGreaterThan(0));
  // 冪等：測試中途關掉的 socket，在 finally 再關一次也要立刻回來。
  let closing: Promise<void> | null = null;
  return {
    rooms,
    close: () =>
      (closing ??= new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
        socket.close();
      })),
  };
}

describe('pendingAbandon is pushed to the other people at the table', () => {
  it('broadcasts the proposal, each consent and a rejection', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 4);
    await runSetupOverApi(clients, gameId);
    const [host, second, third, fourth] = clients as [TestClient, TestClient, TestClient, TestClient];
    await withdraw(fourth, gameId, true);
    const feed = await subscribeRoom(third, roomId);
    try {
      const latest = (): RoomView => feed.rooms[feed.rooms.length - 1]!;
      const proposal = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));
      await vi.waitFor(() => expect(latest().pendingAbandon?.id).toBe(proposal.proposalId));
      expect(latest().pendingAbandon?.consents).toEqual([host.playerId]);
      expect(latest().pendingAbandon?.absent).toEqual([fourth.playerId]);

      second.expectOk(
        await second.post(`/api/games/${gameId}/abandon`, { proposalId: proposal.proposalId, approve: true }),
      );
      await vi.waitFor(() =>
        expect([...(latest().pendingAbandon?.consents ?? [])].sort()).toEqual(
          [host.playerId, second.playerId].sort(),
        ),
      );

      // 再次提出（已有 open 提案）等同同意，同樣要推送。
      const again = third.expectOk<AbandonProposeResult>(await third.post(`/api/games/${gameId}/abandon`, {}));
      expect(again.proposalId).toBe(proposal.proposalId);
      expect(again.abandoned).toBe(true);
      await vi.waitFor(() => expect(latest().status).toBe('abandoned'));
      expect(latest().pendingAbandon).toBeNull();
    } finally {
      await feed.close();
    }
  });

  it('broadcasts the cancellation when someone votes no', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 4);
    await runSetupOverApi(clients, gameId);
    const [host, second, third, fourth] = clients as [TestClient, TestClient, TestClient, TestClient];
    await withdraw(fourth, gameId, true);
    const feed = await subscribeRoom(third, roomId);
    try {
      const latest = (): RoomView => feed.rooms[feed.rooms.length - 1]!;
      const proposal = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));
      await vi.waitFor(() => expect(latest().pendingAbandon?.id).toBe(proposal.proposalId));
      second.expectOk(
        await second.post(`/api/games/${gameId}/abandon`, { proposalId: proposal.proposalId, approve: false }),
      );
      await vi.waitFor(() => expect(latest().pendingAbandon).toBeNull());
    } finally {
      await feed.close();
    }
  });

  it('broadcasts when a returning seat cancels the vote and when a seat drops out of it', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    await setOffline(roomId, third.playerId!, true);
    const hostFeed = await subscribeRoom(host, roomId);
    const secondFeed = await subscribeRoom(second, roomId);
    try {
      const latest = (): RoomView => hostFeed.rooms[hostFeed.rooms.length - 1]!;
      const proposal = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));
      await vi.waitFor(() => expect(latest().pendingAbandon?.id).toBe(proposal.proposalId));
      expect(latest().pendingAbandon?.absent).toEqual([third.playerId]);

      // 另一位在線者斷線：缺席名單必須更新（presence 訊息不含 pendingAbandon）。
      await secondFeed.close();
      await vi.waitFor(() =>
        expect([...(latest().pendingAbandon?.absent ?? [])].sort()).toEqual(
          [second.playerId, third.playerId].sort(),
        ),
      );

      // 缺席者回來：提案被取消，並推送給仍在線的人。
      const drop = await reconnect(roomId, third.playerId!);
      try {
        await vi.waitFor(() => expect(latest().pendingAbandon).toBeNull());
      } finally {
        await drop();
      }
    } finally {
      await hostFeed.close();
      await secondFeed.close();
    }
  });
});

describe('terminal races', () => {
  it('rejects the last person withdrawing after a victory committed first', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const { actorId, winnerId } = await armVictory(gameId);
    const actor = clients.find((client) => client.playerId === actorId)!;
    for (const client of clients) {
      if (client.playerId !== actorId) await withdraw(client, gameId, true);
    }

    expect((await endTurn(actor, gameId)).outcome).toBe('accepted');
    const state = await stateOf(gameId);
    expect(state.result?.reason).not.toBe('abandoned');
    expect(state.result?.playerId).toBe(winnerId);

    actor.expectError(await actor.post(`/api/games/${gameId}/withdraw`, { withdrawn: true }), 'E_GAME_OVER');
    // 結果仍是勝利，沒被退出改寫。
    expect((await stateOf(gameId)).result?.playerId).toBe(winnerId);
    expect((await harness.service.repo.findRoom((await harness.service.repo.findGame(gameId))!.room_id))!.status).toBe(
      'completed',
    );
  });

  it('lets exactly one terminal transition win when victory and withdrawal race', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const { actorId } = await armVictory(gameId);
    const actor = clients.find((client) => client.playerId === actorId)!;
    for (const client of clients) {
      if (client.playerId !== actorId) await withdraw(client, gameId, true);
    }
    const current = actor.expectOk<Snapshot>(await actor.get(`/api/games/${gameId}`));

    const [turnEnd, retire] = await Promise.all([
      actor.post<Receipt>(`/api/games/${gameId}/commands`, {
        commandId: id('race-end'),
        expectedRevision: current.revision,
        command: { type: 'turn.end' },
      }),
      actor.post<WithdrawResult>(`/api/games/${gameId}/withdraw`, { withdrawn: true }),
    ]);

    const state = await stateOf(gameId);
    expect(state.result).not.toBeNull();
    if (state.result?.reason === 'abandoned') {
      // 退出先提交：指令被拒（終局或退出都不得讓它改寫結果）。
      expect(retire.body.ok).toBe(true);
      expect(turnEnd.body.ok).toBe(false);
      if (!turnEnd.body.ok) expect(turnEnd.body.error.code).toBe('E_GAME_OVER');
    } else {
      // 勝利先提交：退出被拒。
      expect(turnEnd.body.ok).toBe(true);
      expect(retire.body.ok).toBe(false);
      if (!retire.body.ok) expect(retire.body.error.code).toBe('E_GAME_OVER');
    }
  });
});

describe('Save and leave is not a withdrawal', () => {
  it('leaves the withdrawn flag alone at a multi-person table', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, , third] = clients as [TestClient, TestClient, TestClient];
    third.expectOk(await third.post(`/api/games/${gameId}/save`, { requestId: id('save') }));
    third.expectOk(await third.post(`/api/rooms/${roomId}/leave`, {}));

    const view = await roomOf(host, roomId);
    expect(view.members.every((member) => member.withdrawn === false)).toBe(true);
    // 沒有退出就沒有放棄資格以外的任何狀態；其他人仍照缺席政策處理。
    const mine = third.expectOk<{ games: ResumableGameView[] }>(await third.get('/api/games'));
    expect(mine.games.find((game) => game.gameId === gameId)?.withdrawn).toBe(false);
  });
});

describe('legacy room withdraw route', () => {
  it('forwards to the game, keeps returning the room view and refuses a lobby', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, , third] = clients as [TestClient, TestClient, TestClient];
    const view = third.expectOk<RoomView>(await third.post(`/api/rooms/${roomId}/withdraw`, { withdrawn: true }));
    expect(view.id).toBe(roomId);
    expect(view.members.find((member) => member.self)?.withdrawn).toBe(true);
    const retracted = third.expectOk<RoomView>(await third.post(`/api/rooms/${roomId}/withdraw`, { withdrawn: false }));
    expect(retracted.members.find((member) => member.self)?.withdrawn).toBe(false);
    third.expectError(await third.post(`/api/rooms/${roomId}/withdraw`, {}), 'E_BAD_REQUEST');

    const lobby = host.expectOk<RoomView>(
      await host.post('/api/rooms', { visibility: 'private', capacity: 3, profileId: 'base-2025', setupMode: 'fixed' }),
    );
    host.expectError(await host.post(`/api/rooms/${lobby.id}/withdraw`, { withdrawn: true }), 'E_GAME_NOT_STARTED');
    const stranger = await harness.client('LegacyStranger');
    stranger.expectError(await stranger.post(`/api/rooms/${roomId}/withdraw`, { withdrawn: true }), 'E_NOT_A_MEMBER');
  });
});
