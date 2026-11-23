/**
 * The Four Islands（S2）經由服務：大廳選擇鏈、房間建立、3/4 人開局、設置後的
 * home islands、中途重啟的還原、一局到結束，以及 bot 座位仍被拒絕。
 */

import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTopology, type GameState } from '@katan/rules';
import {
  createClient,
  restartService,
  runSetupOverApi,
  startHarness,
  startedGame,
  type TestClient,
  type TestHarness,
} from './helpers.ts';

const PROFILE = 'sf-four-islands-2025';
let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface FiSnapshot {
  revision: number;
  view: {
    engineVersion: string;
    victoryTarget: number;
    result: { playerId: string | null; reason: string } | null;
    turn: { playerId: string };
    board: { topologyId: string; pirate: number | null; layout?: { islands: number[] } };
    modules?: { seafarers?: { islandBonus: Record<string, number[]>; home?: Record<string, number[]> } };
  };
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  error?: unknown;
  revision: number;
}

const snapshot = async (client: TestClient, gameId: string): Promise<FiSnapshot> =>
  client.expectOk<FiSnapshot>(await client.get(`/api/games/${gameId}`));

describe('The Four Islands over the API', () => {
  it('is listed as enabled and selectable, without bot seats', async () => {
    const host = await harness.client('FiLister');
    const data = host.expectOk<{
      profiles: { id: string; enabled: boolean; botSeats: boolean; playerCounts: number[] }[];
      selectable: string[];
    }>(await host.get('/api/profiles'));
    expect(data.profiles.find((profile) => profile.id === PROFILE)).toMatchObject({ enabled: true, botSeats: false, playerCounts: [3, 4] });
    expect(data.selectable).toContain(PROFILE);
  });

  it('resolves the ruleset by parts for 3 and 4 players and rejects 5 and 6', async () => {
    const host = await harness.client('FiHost');
    for (const capacity of [3, 4]) {
      const room = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'fixed',
        ruleset: { expansions: ['seafarers'], scenario: 'four-islands', variants: [] },
      }));
      expect(room.profileId).toBe(PROFILE);
    }
    for (const capacity of [5, 6]) {
      const response = await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'fixed',
        ruleset: { expansions: ['seafarers'], scenario: 'four-islands' },
      });
      host.expectError(response, 'E_UNSUPPORTED_COMBINATION');
      expect(response.body.ok ? null : response.body.error.params).toMatchObject({ reason: 'bad-player-count' });
    }
  });

  it('refuses a bot seat with reason profile', async () => {
    const host = await harness.client('FiBotHost');
    const room = host.expectOk<{ id: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'fixed', profileId: PROFILE,
    }));
    const refused = await host.post(`/api/rooms/${room.id}/bots`, { level: 'standard' });
    host.expectError(refused, 'E_INVALID_BOT');
    expect(refused.body.ok ? null : refused.body.error.params).toMatchObject({ reason: 'profile' });
  });

  it('starts the 3- and 4-player maps with 13 VP, sf-2025.3 and the pirate on the frame', async () => {
    for (const [count, topologyId] of [[3, 'sf-four-islands-3'], [4, 'sf-four-islands-4']] as const) {
      const { clients, gameId } = await startedGame(harness, count, { profileId: PROFILE });
      const state = await snapshot(clients[0]!, gameId);
      expect(state.view.board.topologyId).toBe(topologyId);
      expect(state.view.engineVersion).toBe('sf-2025.3');
      expect(state.view.victoryTarget).toBe(13);
      expect(state.view.board.pirate).toBeNull();
      expect(state.view.modules?.seafarers?.islandBonus).toBeDefined();
      expect(state.view.modules?.seafarers?.home).toBeUndefined();
    }
  });

  it('records home islands, survives a mid-game restart and wins on 13 points by settling a new island', async () => {
    const local = await startHarness();
    let restarted: Awaited<ReturnType<typeof restartService>> | undefined;
    try {
      const { clients, gameId, roomId } = await startedGame(local, 4, { profileId: PROFILE });
      await runSetupOverApi(clients, gameId);
      const host = clients[0]!;
      const before = await snapshot(host, gameId);
      const home = before.view.modules!.seafarers!.home!;
      expect(Object.keys(home).sort()).toEqual(clients.map((client) => client.playerId!).sort());
      for (const islands of Object.values(home)) {
        expect(islands.length).toBeGreaterThanOrEqual(1);
        expect(islands.every((island) => island >= 2 && island <= 5)).toBe(true);
      }
      const saved = (await local.service.repo.findGame(gameId))!.state_json;

      await local.service.close();
      restarted = await restartService(local);
      const base = `http://127.0.0.1:${restarted.port}`;
      const resumed = (client: TestClient) => Object.assign(createClient(base), { cookie: client.cookie, playerId: client.playerId });
      const after = await snapshot(resumed(host), gameId);
      expect(after.revision).toBe(before.revision);
      expect(after.view.modules!.seafarers!.home).toEqual(home);
      expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);

      // 重啟後可繼續（test-only 準備盤面）：目前行動者在行動階段，手上有蓋村落的牌，
      // 在一座**非 home 島**上有一條自己的路接到空交叉點；其他分數先記到 8 分
      // （2 個起始村落 + 8 = 10），村落 +1 = 11 還不夠 13，要靠島嶼獎勵 +2 才到 13。
      const row = (await restarted.repo.findGame(gameId))!;
      const state = JSON.parse(row.state_json) as GameState;
      const actorId = state.players[state.turn.seat]!.id;
      const homeIslands = (state.moduleState as unknown as { seafarers: { home: Record<string, number[]> } }).seafarers.home[actorId]!;
      const { terrain, islands } = state.board.layout;
      const topology = getTopology(state.board.layout.topologyId);
      const islandOf = (vertex: number): number[] => [...new Set(topology.vertices[vertex]!.hexes
        .filter((hex) => terrain[hex] !== 'sea').map((hex) => islands[hex]!))];
      const near = (vertex: number): number[] => topology.vertices[vertex]!.edges
        .flatMap((edge) => topology.edges[edge]!.vertices).filter((other) => other !== vertex);
      const target = topology.vertices.findIndex((info, vertex) => !info.interior && !state.board.buildings[vertex]
        && islandOf(vertex).length === 1 && !homeIslands.includes(islandOf(vertex)[0]!)
        && near(vertex).every((other) => !state.board.buildings[other]));
      expect(target).toBeGreaterThanOrEqual(0);
      const edge = topology.vertices[target]!.edges.find((candidate) =>
        topology.edges[candidate]!.hexes.some((hex) => terrain[hex] !== 'sea'))!;
      expect(edge).toBeDefined();
      state.board.roads[edge] = { player: actorId, ship: false };
      const me = state.players[state.turn.seat]!;
      me.resources = { lumber: 1, brick: 1, wool: 1, grain: 1, ore: 0 };
      me.bonusPoints = 8;
      state.turn.phase = 'action';
      state.turn.dice = [3, 4];
      await restarted.repo.saveGame(gameId, state, row.revision, 'playing', null);
      const current = await snapshot(resumed(host), gameId);
      const actor = resumed(clients.find((client) => client.playerId === actorId)!);
      const receipt = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, {
        commandId: 'fi-settle-new-island', expectedRevision: current.revision, command: { type: 'build.settlement', vertex: target },
      }));
      expect(receipt, JSON.stringify(receipt)).toMatchObject({ outcome: 'accepted' });
      const final = await snapshot(resumed(host), gameId);
      // 村落 +1 = 11，島嶼獎勵 +2 = 13：勝者是這位行動者。
      expect(final.view.modules!.seafarers!.islandBonus[actorId]).toEqual(islandOf(target));
      expect(final.view.result).toMatchObject({ playerId: actorId, reason: 'victory' });
      const room = resumed(host).expectOk<{ status: string }>(await resumed(host).get(`/api/rooms/${roomId}`));
      expect(room.status).toBe('completed');
    } finally {
      if (restarted) await restarted.close();
      else await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  }, 60_000);
});
