/** R-SAVE / R-REC: save barriers, suspension, restart recovery and terminality. */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { legalRoadEdges, requireProfile, type GameState, type GameView } from '@catan/rules';
import type { AbandonProposeResult, ResumableGameView, RoomView, ServerMessage } from '@catan/protocol';
import { newId } from '../src/db.ts';
import { startService } from '../src/main.ts';
import {
  createClient,
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

interface Receipt {
  outcome: 'accepted' | 'rejected';
  revision: number;
  error?: { messageId: string };
}

interface Snapshot {
  gameId: string;
  revision: number;
  view: GameView;
}

function id(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('R-SAVE individual save barrier', () => {
  it('acknowledges the committed revision and is idempotent by request id', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const host = clients[0]!;
    const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));

    const first = host.expectOk<{ requestId: string; revision: number; outcome: string; savedAt: string }>(
      await host.post(`/api/games/${gameId}/save`, { requestId: 'save-1' }),
    );
    expect(first.outcome).toBe('saved');
    expect(first.revision).toBe(snapshot.revision);
    expect(first.savedAt).toBeTruthy();

    const replay = host.expectOk<{ revision: number; savedAt: string }>(
      await host.post(`/api/games/${gameId}/save`, { requestId: 'save-1' }),
    );
    expect(replay.revision).toBe(first.revision);
    expect(replay.savedAt).toBe(first.savedAt);
  });

  it('refuses a save from a player without a seat', async () => {
    const { gameId } = await startedGame(harness, 3);
    const outsider = await harness.client('SaveOutsider');
    outsider.expectError(
      await outsider.post(`/api/games/${gameId}/save`, { requestId: 'nope' }),
      'E_NOT_SEATED',
    );
  });

  it('does not pause the table when one player saves', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    clients[1]!.expectOk(await clients[1]!.post(`/api/games/${gameId}/save`, { requestId: 'leave-1' }));
    const room = clients[0]!.expectOk<{ status: string }>(await clients[0]!.get(`/api/rooms/${roomId}`));
    expect(room.status).toBe('playing');
    const snapshot = clients[0]!.expectOk<Snapshot>(await clients[0]!.get(`/api/games/${gameId}`));
    expect(snapshot.view.turn.phase).toBe('preroll');
  });
});

describe('R-SAVE all-seat suspension', () => {
  it('requires every seated player to consent before freezing the game', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];

    const proposal = host.expectOk<{ proposalId: string }>(
      await host.post(`/api/games/${gameId}/suspend`, {}),
    );
    let room = host.expectOk<{ status: string }>(await host.get(`/api/rooms/${roomId}`));
    expect(room.status).toBe('playing');

    const partial = second.expectOk<{ suspended: boolean }>(
      await second.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true }),
    );
    expect(partial.suspended).toBe(false);

    const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    const actor = clients.find((client) => client.playerId === snapshot.view.turn.playerId)!;
    const beforeSuspend = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: id('pre-suspend'),
        expectedRevision: snapshot.revision,
        command: { type: 'turn.roll' },
      }),
    );
    expect(beforeSuspend.outcome).toBe('accepted');

    const complete = third.expectOk<{ suspended: boolean }>(
      await third.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true }),
    );
    expect(complete.suspended).toBe(true);
    room = host.expectOk<{ status: string }>(await host.get(`/api/rooms/${roomId}`));
    expect(room.status).toBe('suspended');
  });

  it('rejects strategic commands while suspended and resumes only with all seats ready', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    const proposal = host.expectOk<{ proposalId: string }>(await host.post(`/api/games/${gameId}/suspend`, {}));
    await second.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });
    await third.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });
    const { games } = host.expectOk<{ games: ResumableGameView[] }>(await host.get('/api/games'));
    expect(games.find((game) => game.gameId === gameId)!.allSeatsNeeded).toBe(true);

    const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    const actor = clients.find((client) => client.playerId === snapshot.view.turn.playerId)!;
    actor.expectError(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: id('suspended'),
        expectedRevision: snapshot.revision,
        command: { type: 'turn.roll' },
      }),
      'E_GAME_SUSPENDED',
    );

    const first = host.expectOk<{ resumed: boolean; waitingFor: string[] }>(
      await host.post(`/api/games/${gameId}/resume`, { ready: true }),
    );
    expect(first.resumed).toBe(false);
    expect(first.waitingFor.length).toBeGreaterThan(0);

    await second.post(`/api/games/${gameId}/resume`, { ready: true });
    const final = third.expectOk<{ resumed: boolean }>(
      await third.post(`/api/games/${gameId}/resume`, { ready: true }),
    );
    // Seats are connected over HTTP in this test, so readiness alone resumes.
    expect(final.resumed).toBe(true);
  });

  it('cancels a suspend proposal when a seat rejects it', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    const [host, second] = clients as [TestClient, TestClient];
    const proposal = host.expectOk<{ proposalId: string }>(await host.post(`/api/games/${gameId}/suspend`, {}));
    const result = second.expectOk<{ suspended: boolean }>(
      await second.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: false }),
    );
    expect(result.suspended).toBe(false);
    const room = host.expectOk<{ status: string }>(await host.get(`/api/rooms/${roomId}`));
    expect(room.status).toBe('playing');
  });
});

/** 訂閱房間的真實 socket，收集伺服器推送的房間檢視。 */
async function watchRoom(client: TestClient, roomId: string): Promise<{
  rooms: () => RoomView[];
  snapshots: () => Snapshot[];
  close: () => Promise<void>;
}> {
  const socket = new WebSocket(`${harness.base.replace('http', 'ws')}/ws`, { headers: { cookie: client.cookie! } });
  const messages: ServerMessage[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const rooms = () => messages.flatMap((message) => (message.type === 'room' ? [message.payload] : []));
  const snapshots = () => messages.flatMap((message) => (message.type === 'snapshot' ? [message.payload] : []));
  socket.send(JSON.stringify({ type: 'subscribe', payload: { roomId } }));
  await vi.waitFor(() => expect(rooms().length).toBeGreaterThan(0));
  return {
    rooms,
    snapshots: () => snapshots() as unknown as Snapshot[],
    close: () => new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) return resolve();
      socket.once('close', () => resolve());
      socket.close();
    }),
  };
}

describe('R-SAVE suspension in the room view', () => {
  it('shows the open proposal and its consents, and pushes every change to the table', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    const tab = await watchRoom(second, roomId);
    try {
      const proposal = host.expectOk<{ proposalId: string; suspended: boolean }>(
        await host.post(`/api/games/${gameId}/suspend`, {}),
      );
      expect(proposal.suspended).toBe(false);
      // 其他座位靠推送看到投票，不必自己重新整理。
      await vi.waitFor(() => expect(tab.rooms().at(-1)?.pendingSuspend?.id).toBe(proposal.proposalId));
      let view = host.expectOk<RoomView>(await host.get(`/api/rooms/${roomId}`));
      expect(view.pendingSuspend).toMatchObject({ id: proposal.proposalId, proposedBy: host.playerId, consents: [host.playerId] });
      expect(view.resumeReady).toBeNull();

      await second.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });
      await vi.waitFor(() => expect(tab.rooms().at(-1)?.pendingSuspend?.consents).toHaveLength(2));
      view = host.expectOk<RoomView>(await host.get(`/api/rooms/${roomId}`));
      expect([...view.pendingSuspend!.consents].sort()).toEqual([host.playerId, second.playerId].sort());

      await third.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: false });
      await vi.waitFor(() => expect(tab.rooms().at(-1)?.pendingSuspend).toBeNull());
      view = host.expectOk<RoomView>(await host.get(`/api/rooms/${roomId}`));
      expect(view.status).toBe('playing');
      expect(view.pendingSuspend).toBeNull();
    } finally {
      await tab.close();
    }
  });

  it('lists who is ready to resume while suspended and refuses another proposal', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    const proposal = host.expectOk<{ proposalId: string }>(await host.post(`/api/games/${gameId}/suspend`, {}));
    await second.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });
    await third.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });

    let view = host.expectOk<RoomView>(await host.get(`/api/rooms/${roomId}`));
    expect(view.status).toBe('suspended');
    expect(view.pendingSuspend).toBeNull();
    expect(view.resumeReady).toEqual([]);
    host.expectError(await host.post(`/api/games/${gameId}/suspend`, {}), 'E_GAME_SUSPENDED');

    const tab = await watchRoom(third, roomId);
    try {
      await host.post(`/api/games/${gameId}/resume`, { ready: true });
      await vi.waitFor(() => expect(tab.rooms().at(-1)?.resumeReady).toEqual([host.playerId]));
      view = host.expectOk<RoomView>(await host.get(`/api/rooms/${roomId}`));
      expect(view.resumeReady).toEqual([host.playerId]);

      await host.post(`/api/games/${gameId}/resume`, { ready: false });
      await vi.waitFor(() => expect(tab.rooms().at(-1)?.resumeReady).toEqual([]));
    } finally {
      await tab.close();
    }
  });

  it('takes back readiness when a ready person drops off or leaves', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    const proposal = host.expectOk<{ proposalId: string }>(await host.post(`/api/games/${gameId}/suspend`, {}));
    await second.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });
    await third.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });

    const watcher = await watchRoom(third, roomId);
    const secondTab = await watchRoom(second, roomId);
    try {
      await second.post(`/api/games/${gameId}/resume`, { ready: true });
      await vi.waitFor(() => expect(watcher.rooms().at(-1)?.resumeReady).toEqual([second.playerId]));
      // 斷線後回來，不能因為留著舊的準備紀錄而讓全桌卡在「都準備好了卻沒恢復」。
      await secondTab.close();
      await vi.waitFor(() => expect(watcher.rooms().at(-1)?.resumeReady).toEqual([]));

      await host.post(`/api/games/${gameId}/resume`, { ready: true });
      await vi.waitFor(() => expect(watcher.rooms().at(-1)?.resumeReady).toEqual([host.playerId]));
      host.expectOk(await host.post(`/api/rooms/${roomId}/leave`));
      const view = third.expectOk<RoomView>(await third.get(`/api/rooms/${roomId}`));
      expect(view.status).toBe('suspended');
      expect(view.resumeReady).toEqual([]);
    } finally {
      await secondTab.close();
      await watcher.close();
    }
  });
});

describe('R-SAVE suspension cancels negotiation (SPEC §4.8)', () => {
  /** 讓目前的行動者直接進入行動階段並握有一張羊毛，才能發出報價。 */
  async function actionWindow(gameId: string): Promise<string> {
    const row = (await harness.service.repo.findGame(gameId))!;
    const state = JSON.parse(row.state_json) as GameState;
    state.turn.phase = 'action';
    state.turn.dice = [3, 4];
    const actor = state.players[state.turn.seat]!;
    actor.resources.wool += 1;
    await harness.service.repo.db.run('UPDATE games SET state_json = ? WHERE id = ?', [JSON.stringify(state), gameId]);
    return actor.id;
  }

  it('expires open offers, cancels the room-policy proposal and pushes the new state', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    const actorId = await actionWindow(gameId);
    const actor = clients.find((client) => client.playerId === actorId)!;
    const before = actor.expectOk<Snapshot>(await actor.get(`/api/games/${gameId}`));
    const offered = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: id('offer-before-suspend'),
        expectedRevision: before.revision,
        command: { type: 'trade.offer', to: 'all', give: { wool: 1 }, want: { ore: 1 } },
      }),
    );
    expect(offered.outcome).toBe('accepted');
    const proposed = host.expectOk<RoomView>(
      await host.post(`/api/rooms/${roomId}/policy`, { policy: { turnClockSeconds: 30 } }),
    );
    expect(proposed.pendingPolicy).not.toBeNull();

    const tab = await watchRoom(third, roomId);
    try {
      const proposal = host.expectOk<{ proposalId: string }>(await host.post(`/api/games/${gameId}/suspend`, {}));
      await second.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });
      await third.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });

      const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
      expect(snapshot.revision).toBe(offered.revision + 1);
      expect(snapshot.view.offers.map((offer) => offer.status)).toEqual(['expired']);
      const { events } = host.expectOk<{ events: { type: string; params: Record<string, unknown> }[] }>(
        await host.get(`/api/games/${gameId}/events?after=${before.view.events.at(-1)?.seq ?? 0}`),
      );
      expect(events.filter((event) => event.type === 'trade.expired').map((event) => event.params.reason)).toEqual(['suspended']);
      // 其他座位收到新的投影，牌桌上不會留著已取消的報價。
      await vi.waitFor(() => expect(tab.snapshots().at(-1)?.revision).toBe(offered.revision + 1));

      const view = host.expectOk<RoomView>(await host.get(`/api/rooms/${roomId}`));
      expect(view.status).toBe('suspended');
      expect(view.pendingPolicy).toBeNull();
      expect(view.policy.turnClockSeconds).not.toBe(30);
    } finally {
      await tab.close();
    }
  });

  it('keeps the revision when there is nothing to cancel', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    const before = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    const proposal = host.expectOk<{ proposalId: string }>(await host.post(`/api/games/${gameId}/suspend`, {}));
    await second.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });
    await third.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });
    const after = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    expect(after.revision).toBe(before.revision);
  });
});

describe('R-SAVE a suspended table is not ended over its expected absences (SPEC §4.6, §4.8)', () => {
  /** 所有真人同意暫停；回傳時房間已是 suspended。 */
  async function suspendAll(clients: TestClient[], gameId: string, roomId: string): Promise<void> {
    const [proposer, ...others] = clients as [TestClient, ...TestClient[]];
    const proposal = proposer.expectOk<{ proposalId: string }>(await proposer.post(`/api/games/${gameId}/suspend`, {}));
    for (const client of others) {
      client.expectOk(await client.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true }));
    }
    expect((await harness.service.repo.findRoom(roomId))?.status).toBe('suspended');
  }

  async function setOffline(roomId: string, playerId: string): Promise<void> {
    await harness.service.repo.updateMembership(roomId, playerId, {
      connected: 0,
      disconnected_at: new Date().toISOString(),
    });
  }

  async function roomOf(client: TestClient, roomId: string): Promise<RoomView> {
    return client.expectOk<RoomView>(await client.get(`/api/rooms/${roomId}`));
  }

  it('refuses an abandonment proposal from the one person back at the table', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    await suspendAll(clients, gameId, roomId);
    second.expectOk(await second.post(`/api/rooms/${roomId}/leave`));
    third.expectOk(await third.post(`/api/rooms/${roomId}/leave`));

    host.expectError(await host.post(`/api/games/${gameId}/abandon`, {}), 'E_GAME_SUSPENDED');
    const view = await roomOf(host, roomId);
    expect(view.status).toBe('suspended');
    expect(view.pendingAbandon).toBeNull();
    // 兩人確實離線：拒絕的理由是暫停，而不是沒人缺席。
    expect(view.members.filter((member) => !member.connected).map((member) => member.playerId).sort())
      .toEqual([second.playerId, third.playerId].sort());
    expect((await harness.service.repo.findGame(gameId))?.status).toBe('suspended');
  });

  it('cancels a vote opened before the suspension instead of letting it end the table', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    await setOffline(roomId, third.playerId!);
    const vote = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));
    expect(vote.abandoned).toBe(false);

    // 離線的人也能透過 HTTP 同意暫停；暫停成立後，他的離線就是預期中的。
    await suspendAll(clients, gameId, roomId);
    expect((await roomOf(host, roomId)).pendingAbandon).toBeNull();
    second.expectError(
      await second.post(`/api/games/${gameId}/abandon`, { proposalId: vote.proposalId, approve: true }),
      'E_NO_PROPOSAL',
    );
    expect((await harness.service.repo.findRoom(roomId))?.status).toBe('suspended');
  });

  it("refuses to commit a leftover vote that only the suspension's absences carry", async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    await suspendAll(clients, gameId, roomId);
    second.expectOk(await second.post(`/api/rooms/${roomId}/leave`));
    third.expectOk(await third.post(`/api/rooms/${roomId}/leave`));
    // 修正前留下的 open 提案：暫停中、只靠離線成立。提交時必須重查資格。
    const proposalId = newId('abandon');
    await harness.service.repo.insertGameProposal({
      id: proposalId,
      game_id: gameId,
      kind: 'abandon',
      proposed_by: host.playerId!,
      status: 'open',
      created_at: new Date().toISOString(),
    });

    host.expectError(
      await host.post(`/api/games/${gameId}/abandon`, { proposalId, approve: true }),
      'E_GAME_SUSPENDED',
    );
    expect(await harness.service.repo.findOpenGameProposal(gameId, 'abandon')).toBeNull();
    const view = await roomOf(host, roomId);
    expect(view.status).toBe('suspended');
    expect(view.pendingAbandon).toBeNull();
  });

  it('counts an explicit withdrawal, but an offline person still has to vote', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    await suspendAll(clients, gameId, roomId);
    second.expectOk(await second.post(`/api/rooms/${roomId}/leave`));
    third.expectOk(await third.post(`/api/games/${gameId}/withdraw`, { withdrawn: true }));

    // 退出照算，所以可以提案；但離線的 P2 仍是投票者，P1 一個人結束不了。
    const vote = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));
    expect(vote.abandoned).toBe(false);
    const view = await roomOf(host, roomId);
    expect(view.status).toBe('suspended');
    expect(view.pendingAbandon).toMatchObject({ id: vote.proposalId, consents: [host.playerId], absent: [third.playerId] });

    // P2 透過真正的 socket 回來：他本來就是投票者、也不算缺席，回來不會讓投票失效。
    const tab = await watchRoom(second, roomId);
    try {
      expect((await roomOf(host, roomId)).pendingAbandon?.id).toBe(vote.proposalId);
      const final = second.expectOk<{ abandoned: boolean }>(
        await second.post(`/api/games/${gameId}/abandon`, { proposalId: vote.proposalId, approve: true }),
      );
      expect(final.abandoned).toBe(true);
    } finally {
      await tab.close();
    }
    expect((await harness.service.repo.findRoom(roomId))?.status).toBe('abandoned');
  });

  it('lets the offline person turn the vote down, keeping the table suspended', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    await suspendAll(clients, gameId, roomId);
    second.expectOk(await second.post(`/api/rooms/${roomId}/leave`));
    third.expectOk(await third.post(`/api/games/${gameId}/withdraw`, { withdrawn: true }));
    const vote = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));
    expect(vote.abandoned).toBe(false);

    // 還沒重連也能透過 HTTP 表態；否決就取消投票。
    const answer = second.expectOk<{ abandoned: boolean }>(
      await second.post(`/api/games/${gameId}/abandon`, { proposalId: vote.proposalId, approve: false }),
    );
    expect(answer.abandoned).toBe(false);
    expect(await harness.service.repo.findOpenGameProposal(gameId, 'abandon')).toBeNull();
    const view = await roomOf(host, roomId);
    expect(view.status).toBe('suspended');
    expect(view.pendingAbandon).toBeNull();
  });

  it('keeps an open vote and its consents when the table resumes', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    await suspendAll(clients, gameId, roomId);
    third.expectOk(await third.post(`/api/games/${gameId}/withdraw`, { withdrawn: true }));
    const vote = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));
    expect(vote.abandoned).toBe(false);

    // 恢復時每個人都在線，暫停中與進行中的投票者名單相同，投票與已表態的同意照舊有效。
    for (const client of clients) client.expectOk(await client.post(`/api/games/${gameId}/resume`, { ready: true }));
    const view = await roomOf(host, roomId);
    expect(view.status).toBe('playing');
    expect(view.pendingAbandon).toMatchObject({ id: vote.proposalId, consents: [host.playerId] });
    const final = second.expectOk<{ abandoned: boolean }>(
      await second.post(`/api/games/${gameId}/abandon`, { proposalId: vote.proposalId, approve: true }),
    );
    expect(final.abandoned).toBe(true);
  });

  it('names only withdrawn people, not offline ones, as absent on a suspended table', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 4);
    const [host, , third, fourth] = clients as [TestClient, TestClient, TestClient, TestClient];
    await suspendAll(clients, gameId, roomId);
    fourth.expectOk(await fourth.post(`/api/rooms/${roomId}/leave`));
    third.expectOk(await third.post(`/api/games/${gameId}/withdraw`, { withdrawn: true }));

    const vote = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));
    expect(vote.abandoned).toBe(false);
    expect((await roomOf(host, roomId)).pendingAbandon?.absent).toEqual([third.playerId]);
  });

  it('still lets the sole person at a bot table end a suspended game', async () => {
    const host = await harness.client('SuspendedSolo');
    let room = host.expectOk<RoomView>(
      await host.post('/api/rooms', { visibility: 'private', capacity: 3, profileId: 'base-2025', setupMode: 'fixed' }),
    );
    for (let index = 0; index < 2; index++) {
      room = host.expectOk<RoomView>(await host.post(`/api/rooms/${room.id}/bots`, { level: 'easy' }));
    }
    host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
    await suspendAll([host], gameId, room.id);

    // 唯一的真人結束對局不靠任何缺席條件（§4.6），暫停中照樣可以。
    const result = host.expectOk<AbandonProposeResult>(await host.post(`/api/games/${gameId}/abandon`, {}));
    expect(result.abandoned).toBe(true);
    expect((await harness.service.repo.findRoom(room.id))?.status).toBe('abandoned');
  });
});

describe('R-REC restart recovery', () => {
  for (const kind of ['freeRoads', 'yearOfPlenty'] as const) {
    for (const available of [0, 1]) {
      it(`recovers a persisted legacy ${kind} effect with ${available} choices left`, async () => {
        const { clients, gameId } = await startedGame(harness, 3);
        await runSetupOverApi(clients, gameId);
        const row = (await harness.service.repo.findGame(gameId))!;
        const state = JSON.parse(row.state_json) as GameState;
        const actorId = state.players[state.turn.seat]!.id;
        const actor = clients.find((client) => client.playerId === actorId)!;
        state.engineVersion = 'base-2025.2';
        state.turn.phase = 'action';
        if (kind === 'freeRoads') {
          const target = requireProfile(state.profileId).pieces.roads - available;
          let count = state.board.roads.filter((road) => road?.player === actorId).length;
          for (let edge = 0; edge < state.board.roads.length && count < target; edge++) {
            if (state.board.roads[edge] || legalRoadEdges(state, actorId).includes(edge)) continue;
            state.board.roads[edge] = { player: actorId, ship: false };
            count += 1;
          }
          expect(count).toBe(target);
          expect(legalRoadEdges(state, actorId).length).toBeGreaterThan(0);
          state.pending = { kind, actor: actorId, remaining: available === 0 ? 1 : 2 };
        } else {
          state.bank = { lumber: available, brick: 0, wool: 0, grain: 0, ore: 0 };
          state.pending = { kind, actor: actorId, remaining: 2 };
        }
        await harness.service.repo.saveGame(gameId, state, row.revision, 'playing', null);
        await harness.service.repo.db.run('UPDATE games SET engine_version = ? WHERE id = ?', [
          'base-2025.2', gameId,
        ]);
        const saved = (await harness.service.repo.findGame(gameId))!;
        const snapshot = actor.expectOk<Snapshot>(await actor.get(`/api/games/${gameId}`));
        expect(snapshot.revision).toBe(row.revision);
        expect(snapshot.view.pending).toEqual(available > 0 ? { kind, actor: actorId, remaining: 1 } : null);
        expect((await harness.service.repo.findGame(gameId))!.state_json).toBe(saved.state_json);
        const command = available === 0
          ? { type: 'turn.end' }
          : kind === 'freeRoads'
            ? { type: 'build.road', edge: snapshot.view.hints!.legalRoads[0]! }
            : { type: 'pending.takeResource', resource: 'lumber' };
        const request = {
          commandId: id('legacy-pending'),
          expectedRevision: snapshot.revision,
          command,
        };
        const receipt = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, request));
        expect(receipt.outcome).toBe('accepted');
        expect(receipt.revision).toBe(row.revision + 1);
        const replay = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, request));
        expect(replay).toEqual(receipt);
        const restored = (await harness.service.repo.findGame(gameId))!;
        expect(restored.revision).toBe(receipt.revision);
        expect((JSON.parse(restored.state_json) as GameState).pending).toBeNull();
      });
    }
  }

  it('restores the same revision, seat and receipts after a service restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'catan-restart-'));
    const sqlitePath = join(dir, 'restart.sqlite');
    const first = await startService({ port: 0, host: '127.0.0.1', sqlitePath }, () => undefined);
    const base1 = `http://127.0.0.1:${first.port}`;

    try {
      const clients: TestClient[] = [];
      for (let i = 0; i < 3; i++) {
        const client = createClient(base1);
        const session = client.expectOk<{ player: { id: string } }>(
          await client.post('/api/session', { nickname: `R${i}`, locale: 'en' }),
        );
        client.playerId = session.player.id;
        clients.push(client);
      }
      const host = clients[0]!;
      const room = host.expectOk<{ id: string; code: string }>(
        await host.post('/api/rooms', {
          visibility: 'private',
          capacity: 3,
          profileId: 'base-2025',
          setupMode: 'fixed',
        }),
      );
      for (let i = 1; i < 3; i++) {
        clients[i]!.expectOk(await clients[i]!.post('/api/rooms/join', { code: room.code }));
        clients[i]!.expectOk(await clients[i]!.post(`/api/rooms/${room.id}/ready`, { ready: true }));
      }
      host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
      const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));

      const { revision } = await runSetupOverApi(clients, gameId);
      const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
      const actor = clients.find((client) => client.playerId === snapshot.view.turn.playerId)!;
      const rollId = id('restart-roll');
      const receipt = actor.expectOk<Receipt>(
        await actor.post(`/api/games/${gameId}/commands`, {
          commandId: rollId,
          expectedRevision: revision,
          command: { type: 'turn.roll' },
        }),
      );
      expect(receipt.outcome).toBe('accepted');
      const before = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));

      await first.close();

      const second = await startService({ port: 0, host: '127.0.0.1', sqlitePath }, () => undefined);
      try {
        const base2 = `http://127.0.0.1:${second.port}`;
        const resumed = createClient(base2);
        resumed.cookie = host.cookie;
        const after = resumed.expectOk<Snapshot>(await resumed.get(`/api/games/${gameId}`));
        expect(after.revision).toBe(before.revision);
        expect(after.view.seq).toBe(before.view.seq);
        expect(after.view.turn.playerId).toBe(before.view.turn.playerId);

        // The receipt survives, so a blind retry cannot draw the dice twice.
        const replay = actor.cookie
          ? await (async () => {
              const retryClient = createClient(base2);
              retryClient.cookie = actor.cookie;
              return retryClient.expectOk<Receipt>(
                await retryClient.post(`/api/games/${gameId}/commands`, {
                  commandId: rollId,
                  expectedRevision: revision,
                  command: { type: 'turn.roll' },
                }),
              );
            })()
          : null;
        expect(replay?.revision).toBe(receipt.revision);

        // The game is still listed for its original seat owner.
        const games = resumed.expectOk<{ games: { gameId: string }[] }>(await resumed.get('/api/games'));
        expect(games.games.map((game) => game.gameId)).toContain(gameId);
      } finally {
        await second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists a terminal result and rejects later strategic commands', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const host = clients[0]!;

    // Deterministic fixture: the next seat already holds the winning score and
    // the current actor simply ends the turn, so the victory boundary is the
    // start of that seat's own turn (R-B07).
    const row = await harness.service.repo.findGame(gameId);
    const state = JSON.parse(row!.state_json) as GameState;
    const currentSeat = state.turn.seat;
    const winnerSeat = (currentSeat + 1) % state.players.length;
    state.players[winnerSeat]!.bonusPoints = 10;
    state.turn.phase = 'action';
    await harness.service.repo.saveGame(gameId, state, row!.revision, 'playing', null);

    const current = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    const actor = clients.find((client) => client.playerId === current.view.turn.playerId)!;
    const receipt = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: id('endgame-end'),
        expectedRevision: current.revision,
        command: { type: 'turn.end' },
      }),
    );
    expect(receipt.outcome).toBe('accepted');

    const final = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    expect(final.view.result).not.toBeNull();
    const room = host.expectOk<{ status: string }>(await host.get(`/api/rooms/${roomId}`));
    expect(room.status).toBe('completed');

    actor.expectError(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: id('after-terminal'),
        expectedRevision: final.revision,
        command: { type: 'turn.roll' },
      }),
      'E_GAME_OVER',
    );
  });
});
