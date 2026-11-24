/**
 * New World（S9）經由服務：建房、3/4 人開局（隨機 42 格圖）、輪流放港口、重新產生版圖的全體同意
 * （接受／拒絕／房主單方被拒、第一個港口放下後失效）、中途重啟還原、一局到結束，以及 bot 與 5/6 人被拒。
 */

import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameState } from '@katan/rules';
import {
  createClient,
  restartService,
  runSetupOverApi,
  startHarness,
  startedGame,
  type TestClient,
  type TestHarness,
} from './helpers.ts';

const PROFILE = 'sf-new-world-2025';
let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface NwSnapshot {
  revision: number;
  view: {
    engineVersion: string;
    victoryTarget: number;
    players: { id: string; ownScore?: number }[];
    result: { playerId: string | null; reason: string } | null;
    turn: { playerId: string; phase: string; setup: { stage: string; seat: number } | null };
    board: { topologyId: string; pirate: number | null; robber: number; terrain: string[]; numbers: (number | null)[]; islands: number[]; harbors: { edge: number; type: string }[]; buildings: ({ player: string; city: boolean } | null)[] };
    hints?: { modules?: { seafarers?: { harborChoices: { harbors: string[]; edges: number[] }; board: { commandType: string } | null } } };
    modules?: { seafarers?: { world?: { drawn: string | null; placed: number; total: number; rerolls: number; canRegenerate: boolean }; home?: Record<string, number[]> } };
  };
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  error?: unknown;
  revision: number;
}

interface RoomShape {
  status: string;
  pendingRegenerate?: { id: string; proposedBy: string; consents: string[] } | null;
}

const snapshot = async (client: TestClient, gameId: string): Promise<NwSnapshot> =>
  client.expectOk<NwSnapshot>(await client.get(`/api/games/${gameId}`));

const clientOf = (clients: TestClient[], id: string): TestClient => clients.find((client) => client.playerId === id)!;

async function placeHarbor(clients: TestClient[], gameId: string, commandId: string, pick = 0): Promise<Receipt> {
  const host = clients[0]!;
  const current = await snapshot(host, gameId);
  const actor = clientOf(clients, current.view.turn.playerId);
  const mine = await snapshot(actor, gameId);
  const edges = mine.view.hints!.modules!.seafarers!.harborChoices.edges;
  return actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, {
    commandId, expectedRevision: mine.revision, command: { type: 'world.harbor', edge: edges[pick % edges.length]! },
  }));
}

const roomOf = async (client: TestClient, roomId: string) => client.expectOk<RoomShape>(await client.get(`/api/rooms/${roomId}`));
const tally = (values: readonly unknown[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const value of values) out[String(value)] = (out[String(value)] ?? 0) + 1;
  return out;
};

describe('New World over the API', () => {
  it('is listed as enabled and selectable, without bot seats', async () => {
    const host = await harness.client('NwLister');
    const data = host.expectOk<{
      profiles: { id: string; enabled: boolean; botSeats: boolean; playerCounts: number[]; setupModes: string[] }[];
      selectable: string[];
    }>(await host.get('/api/profiles'));
    expect(data.profiles.find((profile) => profile.id === PROFILE)).toMatchObject({ enabled: true, botSeats: false, playerCounts: [3, 4], setupModes: ['variable'] });
    expect(data.selectable).toContain(PROFILE);
  });

  it('resolves the ruleset by parts for 3 and 4 players and rejects 5 and 6', async () => {
    const host = await harness.client('NwHost');
    for (const capacity of [3, 4]) {
      const room = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'variable',
        ruleset: { expansions: ['seafarers'], scenario: 'new-world', variants: [] },
      }));
      expect(room.profileId).toBe(PROFILE);
    }
    for (const capacity of [5, 6]) {
      const response = await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'variable',
        ruleset: { expansions: ['seafarers'], scenario: 'new-world' },
      });
      host.expectError(response, 'E_UNSUPPORTED_COMBINATION');
      expect(response.body.ok ? null : response.body.error.params).toMatchObject({ reason: 'bad-player-count' });
    }
  });

  it('refuses a bot seat with reason profile', async () => {
    const host = await harness.client('NwBotHost');
    const room = host.expectOk<{ id: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'variable', profileId: PROFILE,
    }));
    const refused = await host.post(`/api/rooms/${room.id}/bots`, { level: 'standard' });
    host.expectError(refused, 'E_INVALID_BOT');
    expect(refused.body.ok ? null : refused.body.error.params).toMatchObject({ reason: 'profile' });
  });

  it('starts 3 and 4 players on a random 42-hex map in the harbor stage, with no undrawn port in any view', async () => {
    for (const count of [3, 4] as const) {
      const { clients, gameId } = await startedGame(harness, count, { profileId: PROFILE, setupMode: 'variable' });
      const state = await snapshot(clients[0]!, gameId);
      expect(state.view.board.topologyId).toBe('sf-new-world');
      expect(state.view.engineVersion).toBe('sf-2025.3');
      expect(state.view.victoryTarget).toBe(12);
      expect(state.view.board.harbors).toEqual([]);
      expect(state.view.board.pirate).toBeNull();
      expect(state.view.board.robber).toBe(-1);
      expect(tally(state.view.board.terrain)).toEqual({ sea: 19, fields: 5, hills: 4, mountains: 4, pasture: 5, forest: 5 });
      expect(state.view.turn.setup).toMatchObject({ stage: 'harbor' });
      const world = state.view.modules!.seafarers!.world!;
      expect(world).toMatchObject({ placed: 0, total: 10, rerolls: 0, canRegenerate: true });
      expect(world.drawn).not.toBeNull();
      // 資料庫裡有尚未抽的港口，任何玩家的視圖都沒有。
      const stored = JSON.parse((await harness.service.repo.findGame(gameId))!.state_json) as GameState;
      const pool = (stored.moduleState as unknown as { seafarers: { world: { pool: string[] } } }).seafarers.world.pool;
      expect(pool).toHaveLength(9);
      for (const client of clients) expect(JSON.stringify(await snapshot(client, gameId))).not.toContain('"pool"');
    }
  });

  it('lets the players place the ten ports in turn, then run the starting settlements', async () => {
    const { clients, gameId } = await startedGame(harness, 3, { profileId: PROFILE, setupMode: 'variable' });
    const host = clients[0]!;
    // 輪不到的玩家放港口被拒絕。
    const first = await snapshot(host, gameId);
    const wrong = clients[1]!;
    const early = wrong.expectOk<Receipt>(await wrong.post(`/api/games/${gameId}/commands`, {
      commandId: 'nw-wrong-turn', expectedRevision: first.revision,
      command: { type: 'world.harbor', edge: first.view.hints?.modules?.seafarers?.harborChoices.edges[0] ?? 0 },
    }));
    expect(early.outcome).toBe('rejected');
    // 輪到的玩家以外沒有選項，也沒有棋盤提示。
    const other = await snapshot(wrong, gameId);
    expect(other.view.hints?.modules?.seafarers?.harborChoices).toEqual({ harbors: [], edges: [] });
    const order: string[] = [];
    for (let step = 0; step < 10; step++) {
      const before = await snapshot(host, gameId);
      expect(before.view.turn.setup?.stage).toBe('harbor');
      order.push(before.view.turn.playerId);
      const receipt = await placeHarbor(clients, gameId, `nw-harbor-${step}`, step * 3);
      expect(receipt, JSON.stringify(receipt)).toMatchObject({ outcome: 'accepted' });
    }
    expect(order).toEqual(clients.map((client) => client.playerId).concat(clients.map((client) => client.playerId), clients.map((client) => client.playerId), [clients[0]!.playerId]));
    const done = await snapshot(host, gameId);
    expect(done.view.board.harbors).toHaveLength(10);
    expect(done.view.turn.setup).toMatchObject({ stage: 'building' });
    expect(done.view.turn.playerId).toBe(clients[0]!.playerId);
    expect(done.view.modules!.seafarers!.world).toMatchObject({ drawn: null, placed: 10, canRegenerate: false });
    const finished = await runSetupOverApi(clients, gameId);
    expect(finished.view.turn.phase).not.toBe('setup');
    const after = await snapshot(host, gameId);
    expect(Object.keys(after.view.modules!.seafarers!.home!).sort()).toEqual(clients.map((client) => client.playerId).sort());
  });

  it('regenerates the board only after every human seat agrees; a refusal cancels; the host alone cannot', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3, { profileId: PROFILE, setupMode: 'variable' });
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    const layout = async () => JSON.stringify((await snapshot(host, gameId)).view.board);
    const original = await layout();
    const revision0 = (await snapshot(host, gameId)).revision;

    // 只有房主可以提出。
    second.expectError(await second.post(`/api/games/${gameId}/regenerate`, {}), 'E_NOT_HOST');
    // 房主提出：提案即同意，但還差兩位，版圖不動。
    const proposed = host.expectOk<{ proposalId: string; regenerated: boolean }>(await host.post(`/api/games/${gameId}/regenerate`, {}));
    expect(proposed.regenerated).toBe(false);
    expect(await layout()).toBe(original);
    const pending = (await roomOf(second, roomId)).pendingRegenerate!;
    expect(pending).toMatchObject({ id: proposed.proposalId, proposedBy: host.playerId, consents: [host.playerId] });
    // 重複提出沿用同一個提案。
    expect(host.expectOk<{ proposalId: string }>(await host.post(`/api/games/${gameId}/regenerate`, {})).proposalId).toBe(proposed.proposalId);
    // 第二位同意，仍不足。
    expect(second.expectOk<{ regenerated: boolean }>(await second.post(`/api/games/${gameId}/regenerate`, { proposalId: proposed.proposalId, approve: true })).regenerated).toBe(false);
    expect(await layout()).toBe(original);
    // 第三位拒絕：提案取消，版圖不動。
    expect(third.expectOk<{ regenerated: boolean }>(await third.post(`/api/games/${gameId}/regenerate`, { proposalId: proposed.proposalId, approve: false })).regenerated).toBe(false);
    expect((await roomOf(host, roomId)).pendingRegenerate).toBeNull();
    expect(await layout()).toBe(original);
    expect((await snapshot(host, gameId)).revision).toBe(revision0);
    // 已取消的提案不能再表態。
    host.expectError(await host.post(`/api/games/${gameId}/regenerate`, { proposalId: proposed.proposalId, approve: true }), 'E_NO_PROPOSAL');

    // 重新提出，全員接受：用新的隨機數整盤重排，修訂版本加一，提案結案。
    const again = host.expectOk<{ proposalId: string }>(await host.post(`/api/games/${gameId}/regenerate`, {}));
    expect(again.proposalId).not.toBe(proposed.proposalId);
    second.expectOk(await second.post(`/api/games/${gameId}/regenerate`, { proposalId: again.proposalId, approve: true }));
    const last = third.expectOk<{ regenerated: boolean }>(await third.post(`/api/games/${gameId}/regenerate`, { proposalId: again.proposalId, approve: true }));
    expect(last.regenerated).toBe(true);
    const after = await snapshot(host, gameId);
    expect(await layout()).not.toBe(original);
    expect(after.revision).toBe(revision0 + 1);
    expect(tally(after.view.board.terrain)).toEqual({ sea: 19, fields: 5, hills: 4, mountains: 4, pasture: 5, forest: 5 });
    expect(after.view.board.harbors).toEqual([]);
    expect(after.view.modules!.seafarers!.world).toMatchObject({ placed: 0, rerolls: 1, canRegenerate: true });
    expect((await roomOf(host, roomId)).pendingRegenerate).toBeNull();
    // 不限次數：可以再提一次（每次都要全員同意）。
    const third2 = host.expectOk<{ proposalId: string; regenerated: boolean }>(await host.post(`/api/games/${gameId}/regenerate`, {}));
    expect(third2.regenerated).toBe(false);
    host.expectOk(await host.post(`/api/games/${gameId}/regenerate`, { proposalId: third2.proposalId, approve: false }));
  });

  it('refuses to regenerate once the first port is placed, and a placement cancels an open proposal', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3, { profileId: PROFILE, setupMode: 'variable' });
    const host = clients[0]!;
    const proposed = host.expectOk<{ proposalId: string }>(await host.post(`/api/games/${gameId}/regenerate`, {}));
    expect((await roomOf(host, roomId)).pendingRegenerate).not.toBeNull();
    // 提案還開著時第一個港口放下：提案失效。
    expect(await placeHarbor(clients, gameId, 'nw-first-port')).toMatchObject({ outcome: 'accepted' });
    expect((await roomOf(host, roomId)).pendingRegenerate).toBeNull();
    host.expectError(await clients[1]!.post(`/api/games/${gameId}/regenerate`, { proposalId: proposed.proposalId, approve: true }), 'E_NO_PROPOSAL');
    host.expectError(await host.post(`/api/games/${gameId}/regenerate`, {}), 'E_REGENERATE_UNAVAILABLE');
    expect((await snapshot(host, gameId)).view.modules!.seafarers!.world).toMatchObject({ placed: 1, canRegenerate: false });
  });

  it('does not offer regeneration in other scenarios', async () => {
    const { clients, gameId } = await startedGame(harness, 3, { profileId: 'sf-new-shores-2025' });
    clients[0]!.expectError(await clients[0]!.post(`/api/games/${gameId}/regenerate`, {}), 'E_REGENERATE_UNAVAILABLE');
  });

  it('restores a mid-harbor snapshot after a restart, then plays to a 12-point finish', async () => {
    const local = await startHarness();
    let restarted: Awaited<ReturnType<typeof restartService>> | undefined;
    try {
      const { clients, gameId, roomId } = await startedGame(local, 3, { profileId: PROFILE, setupMode: 'variable' });
      for (let step = 0; step < 4; step++) expect(await placeHarbor(clients, gameId, `nw-r-${step}`, step)).toMatchObject({ outcome: 'accepted' });
      const before = await snapshot(clients[0]!, gameId);
      const saved = (await local.service.repo.findGame(gameId))!.state_json;
      await local.service.close();
      restarted = await restartService(local);
      const base = `http://127.0.0.1:${restarted.port}`;
      const resumed = clients.map((client) => Object.assign(createClient(base), { cookie: client.cookie, playerId: client.playerId }));
      expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);
      const after = await snapshot(resumed[0]!, gameId);
      expect(after.revision).toBe(before.revision);
      expect(after.view.modules!.seafarers!.world).toEqual(before.view.modules!.seafarers!.world);
      expect(after.view.board.harbors).toEqual(before.view.board.harbors);
      expect(after.view.turn.playerId).toBe(before.view.turn.playerId);
      // 重啟前抽到的那個港口，重啟後仍是同一個（抽籤結果存在 snapshot）。
      const mine = await snapshot(clientOf(resumed, after.view.turn.playerId), gameId);
      expect(mine.view.hints!.modules!.seafarers!.harborChoices.harbors).toEqual([after.view.modules!.seafarers!.world!.drawn]);
      for (let step = 4; step < 10; step++) expect(await placeHarbor(resumed, gameId, `nw-r-${step}`, step)).toMatchObject({ outcome: 'accepted' });
      await runSetupOverApi(resumed, gameId);

      // 最後一分：test-only 準備 11 分與一座可升級的村落，再用合法的 build.city 升到 12 分。
      const row = (await restarted.repo.findGame(gameId))!;
      const state = JSON.parse(row.state_json) as GameState;
      const actorId = state.players[state.turn.seat]!.id;
      const settlement = state.board.buildings.findIndex((building) => building?.player === actorId && !building.city);
      expect(settlement).toBeGreaterThanOrEqual(0);
      const me = state.players.find((player) => player.id === actorId)!;
      me.resources = { lumber: 0, brick: 0, wool: 0, grain: 2, ore: 3 };
      state.turn.phase = 'action';
      state.turn.dice = [3, 4];
      state.windowId += 1;
      const current = JSON.parse(JSON.stringify(state)) as GameState;
      await restarted.repo.saveGame(gameId, current, row.revision, 'playing', null);
      const actor = clientOf(resumed, actorId);
      const view = await snapshot(actor, gameId);
      const score = view.view.players.find((player) => player.id === actorId)!.ownScore!;
      me.bonusPoints += 11 - score;
      await restarted.repo.saveGame(gameId, state, row.revision, 'playing', null);
      const prepared = await snapshot(actor, gameId);
      expect(prepared.view.players.find((player) => player.id === actorId)!.ownScore).toBe(11);
      const win = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, {
        commandId: 'nw-city', expectedRevision: prepared.revision, command: { type: 'build.city', vertex: settlement },
      }));
      expect(win, JSON.stringify(win)).toMatchObject({ outcome: 'accepted' });
      const final = await snapshot(actor, gameId);
      expect(final.view.result).toMatchObject({ playerId: actorId, reason: 'victory' });
      expect((await roomOf(actor, roomId)).status).toBe('completed');
    } finally {
      if (restarted) await restarted.close();
      else await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  }, 90_000);
});
