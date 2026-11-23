/**
 * Through the Desert（S4）經由服務：房間建立、3/4 人開局（兩種外框）、設置只放主島、
 * 中途重啟的還原、以外地的第一個村落拿到 14 分，以及 bot 座位仍被拒絕。
 */

import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, getTopology, type GameState } from '@katan/rules';
import {
  createClient,
  restartService,
  runSetupOverApi,
  startHarness,
  startedGame,
  type TestClient,
  type TestHarness,
} from './helpers.ts';

const PROFILE = 'sf-through-the-desert-2025';
let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface TdSnapshot {
  revision: number;
  view: {
    engineVersion: string;
    victoryTarget: number;
    result: { playerId: string | null; reason: string } | null;
    turn: { playerId: string };
    board: { topologyId: string; pirate: number | null; robber: number; terrain: string[]; layout?: { islands: number[] } };
    modules?: { seafarers?: { islandBonus: Record<string, number[]>; home?: Record<string, number[]> } };
  };
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  error?: unknown;
  revision: number;
}

const snapshot = async (client: TestClient, gameId: string): Promise<TdSnapshot> =>
  client.expectOk<TdSnapshot>(await client.get(`/api/games/${gameId}`));

describe('Through the Desert over the API', () => {
  it('is listed as enabled and selectable, without bot seats', async () => {
    const host = await harness.client('TdLister');
    const data = host.expectOk<{
      profiles: { id: string; enabled: boolean; botSeats: boolean; playerCounts: number[] }[];
      selectable: string[];
    }>(await host.get('/api/profiles'));
    expect(data.profiles.find((profile) => profile.id === PROFILE)).toMatchObject({ enabled: true, botSeats: false, playerCounts: [3, 4] });
    expect(data.selectable).toContain(PROFILE);
  });

  it('resolves the ruleset by parts for 3 and 4 players and rejects 5 and 6', async () => {
    const host = await harness.client('TdHost');
    for (const capacity of [3, 4]) {
      const room = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'fixed',
        ruleset: { expansions: ['seafarers'], scenario: 'through-the-desert', variants: [] },
      }));
      expect(room.profileId).toBe(PROFILE);
    }
    for (const capacity of [5, 6]) {
      const response = await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'fixed',
        ruleset: { expansions: ['seafarers'], scenario: 'through-the-desert' },
      });
      host.expectError(response, 'E_UNSUPPORTED_COMBINATION');
      expect(response.body.ok ? null : response.body.error.params).toMatchObject({ reason: 'bad-player-count' });
    }
  });

  it('refuses a bot seat with reason profile', async () => {
    const host = await harness.client('TdBotHost');
    const room = host.expectOk<{ id: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'fixed', profileId: PROFILE,
    }));
    const refused = await host.post(`/api/rooms/${room.id}/bots`, { level: 'standard' });
    host.expectError(refused, 'E_INVALID_BOT');
    expect(refused.body.ok ? null : refused.body.error.params).toMatchObject({ reason: 'profile' });
  });

  it('starts the 3- and 4-player maps with 14 VP, sf-2025.3, the pirate on the frame and the robber on a desert', async () => {
    for (const [count, topologyId, hexes] of [[3, 'sf-through-the-desert-3', 35], [4, 'sf-through-the-desert-4', 42]] as const) {
      const { clients, gameId } = await startedGame(harness, count, { profileId: PROFILE });
      const state = await snapshot(clients[0]!, gameId);
      expect(state.view.board.topologyId).toBe(topologyId);
      expect(getTopology(topologyId).hexes).toHaveLength(hexes);
      expect(state.view.engineVersion).toBe('sf-2025.3');
      expect(state.view.victoryTarget).toBe(14);
      expect(state.view.board.pirate).toBeNull();
      expect(state.view.board.terrain[state.view.board.robber]).toBe('desert');
      expect(state.view.modules?.seafarers?.islandBonus).toBeDefined();
      // 穿越荒漠不記 home（獎勵只排除主島）。
      expect(state.view.modules?.seafarers?.home).toBeUndefined();
    }
  });

  it('starts only on the main island, survives a mid-game restart and wins on 14 points by settling an unexplored region', async () => {
    const local = await startHarness();
    let restarted: Awaited<ReturnType<typeof restartService>> | undefined;
    try {
      const { clients, gameId, roomId } = await startedGame(local, 4, { profileId: PROFILE });
      // 設置全程經由 API：每一步的合法交叉點都只碰到主島（島編號 1）。
      const topology = getTopology('sf-through-the-desert-4');
      const first = await snapshot(clients[0]!, gameId);
      const hints = clients[0]!.expectOk<{ view: { hints?: { legalSettlements: number[] } } }>(await clients[0]!.get(`/api/games/${gameId}`)).view.hints!;
      const row0 = (await local.service.repo.findGame(gameId))!;
      const layout0 = (JSON.parse(row0.state_json) as GameState).board.layout;
      const touched = (vertex: number): number[] => [...new Set(topology.vertices[vertex]!.hexes
        .filter((hex) => layout0.terrain[hex] !== 'sea').map((hex) => layout0.islands[hex]!))];
      expect(hints.legalSettlements.length).toBeGreaterThan(0);
      for (const vertex of hints.legalSettlements) expect(touched(vertex), `vertex ${vertex}`).toEqual([1]);
      expect(first.view.turn.playerId).toBe(clients[0]!.playerId);
      await runSetupOverApi(clients, gameId);
      const host = clients[0]!;
      const before = await snapshot(host, gameId);
      const saved = (await local.service.repo.findGame(gameId))!.state_json;
      const setupState = JSON.parse(saved) as GameState;
      setupState.board.buildings.forEach((building, vertex) => {
        if (building) expect(touched(vertex), `settlement ${vertex}`).toEqual([1]);
      });
      expect(before.view.modules!.seafarers!.islandBonus).toEqual(Object.fromEntries(clients.map((client) => [client.playerId!, []])));

      await local.service.close();
      restarted = await restartService(local);
      const base = `http://127.0.0.1:${restarted.port}`;
      const resumed = (client: TestClient) => Object.assign(createClient(base), { cookie: client.cookie, playerId: client.playerId });
      const after = await snapshot(resumed(host), gameId);
      expect(after.revision).toBe(before.revision);
      expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);

      // 重啟後可繼續（test-only 準備盤面）：目前行動者在行動階段，手上有蓋村落的牌，在一處
      // unexplored region 上有一條自己的路接到空交叉點；其他分數先記到 9 分
      // （2 個起始村落 + 9 = 11），村落 +1 = 12 還不夠 14，要靠區域獎勵 +2 才到 14。
      const row = (await restarted.repo.findGame(gameId))!;
      const state = JSON.parse(row.state_json) as GameState;
      const actorId = state.players[state.turn.seat]!.id;
      const { terrain } = state.board.layout;
      const near = (vertex: number): number[] => topology.vertices[vertex]!.edges
        .flatMap((edge) => topology.edges[edge]!.vertices).filter((other) => other !== vertex);
      const target = topology.vertices.findIndex((info, vertex) => !info.interior && !state.board.buildings[vertex]
        && touched(vertex).length === 1 && touched(vertex)[0]! > 1 && near(vertex).every((other) => !state.board.buildings[other]));
      expect(target).toBeGreaterThanOrEqual(0);
      const edge = topology.vertices[target]!.edges.find((candidate) =>
        topology.edges[candidate]!.hexes.some((hex) => terrain[hex] !== 'sea'))!;
      expect(edge).toBeDefined();
      state.board.roads[edge] = { player: actorId, ship: false };
      const me = state.players[state.turn.seat]!;
      me.resources = { lumber: 1, brick: 1, wool: 1, grain: 1, ore: 0 };
      me.bonusPoints = 9;
      state.turn.phase = 'action';
      state.turn.dice = [3, 4];
      await restarted.repo.saveGame(gameId, state, row.revision, 'playing', null);
      const current = await snapshot(resumed(host), gameId);
      const actor = resumed(clients.find((client) => client.playerId === actorId)!);
      const receipt = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, {
        commandId: 'td-settle-region', expectedRevision: current.revision, command: { type: 'build.settlement', vertex: target },
      }));
      expect(receipt, JSON.stringify(receipt)).toMatchObject({ outcome: 'accepted' });
      const final = await snapshot(resumed(host), gameId);
      // 村落 +1 = 12，區域獎勵 +2 = 14：勝者是這位行動者。
      expect(final.view.modules!.seafarers!.islandBonus[actorId]).toEqual(touched(target));
      expect(final.view.result).toMatchObject({ playerId: actorId, reason: 'victory' });
      const room = resumed(host).expectOk<{ status: string }>(await resumed(host).get(`/api/rooms/${roomId}`));
      expect(room.status).toBe('completed');
    } finally {
      if (restarted) await restarted.close();
      else await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('restores a pending gold choice after a restart and completes it (spec 11.3)', async () => {
    const local = await startHarness();
    let restarted: Awaited<ReturnType<typeof restartService>> | undefined;
    try {
      const { clients, gameId } = await startedGame(local, 4, { profileId: PROFILE });
      await runSetupOverApi(clients, gameId);
      // test-only 準備：行動者在外地金礦（島 4，(2,1) 圓片 5）旁有一個村落，擲出 5 產生金礦選擇 frame。
      const row = (await local.service.repo.findGame(gameId))!;
      const state = JSON.parse(row.state_json) as GameState;
      const topology = getTopology(state.board.layout.topologyId);
      const actorId = state.players[state.turn.seat]!.id;
      const gold = topology.hexes.findIndex((cell) => cell.q === 2 && cell.r === 1);
      expect(state.board.layout.terrain[gold]).toBe('gold');
      expect(state.board.layout.numbers[gold]).toBe(5);
      const near = (vertex: number): number[] => topology.vertices[vertex]!.edges
        .flatMap((edge) => topology.edges[edge]!.vertices).filter((other) => other !== vertex);
      const spot = topology.vertices.findIndex((info, vertex) => info.hexes.includes(gold) && !state.board.buildings[vertex]
        && near(vertex).every((other) => !state.board.buildings[other]));
      expect(spot).toBeGreaterThanOrEqual(0);
      state.board.buildings[spot] = { player: actorId, city: false };
      state.turn.phase = 'preroll';
      const rolled = applyCommand(state, actorId, { type: 'turn.roll' }, { int: (() => { const dice = [1, 2]; return () => dice.shift()!; })() });
      if (!rolled.ok) throw new Error(rolled.error.code);
      expect(rolled.state.pending).toMatchObject({ kind: 'seafarers.gold', responders: [actorId] });
      await local.service.repo.saveGame(gameId, rolled.state, row.revision, 'playing', null);
      const host = clients[0]!;
      const before = await snapshot(host, gameId);
      const pendingBefore = (before.view as unknown as { pending: { kind: string } | null }).pending;
      expect(pendingBefore).toMatchObject({ kind: 'seafarers.gold' });
      const saved = (await local.service.repo.findGame(gameId))!.state_json;

      await local.service.close();
      restarted = await restartService(local);
      const base = `http://127.0.0.1:${restarted.port}`;
      const resumed = (client: TestClient) => Object.assign(createClient(base), { cookie: client.cookie, playerId: client.playerId });
      expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);
      const actor = resumed(clients.find((client) => client.playerId === actorId)!);
      const after = await snapshot(actor, gameId);
      // 重連後仍有該選擇提示，且行動者要選 1 張。
      expect((after.view as unknown as { pending: { kind: string } | null }).pending).toMatchObject({ kind: 'seafarers.gold' });
      expect(after.revision).toBe(before.revision);
      const receipt = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, {
        commandId: 'td-gold-choose', expectedRevision: after.revision, command: { type: 'gold.choose', resources: ['ore'] },
      }));
      expect(receipt, JSON.stringify(receipt)).toMatchObject({ outcome: 'accepted' });
      const done = await snapshot(actor, gameId);
      expect((done.view as unknown as { pending: unknown }).pending).toBeNull();
    } finally {
      if (restarted) await restarted.close();
      else await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  }, 60_000);
});
