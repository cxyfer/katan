/**
 * The Wonders of Catan（S8）經由服務：房間建立、3/4 人開局（同一張 49 格圖、9 個隨機港口、強盜在沙漠、
 * 沒有海盜）、起始村落只在大島且不在標記點、認領與施工、中途重啟還原，最後完成奇觀結束。
 */

import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTopology, WONDERS, type GameState } from '@katan/rules';
import {
  createClient,
  restartService,
  runSetupOverApi,
  startHarness,
  startedGame,
  type TestClient,
  type TestHarness,
} from './helpers.ts';

const PROFILE = 'sf-wonders-of-catan-2025';
let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface WondersView {
  markers: { greatWall: number[]; greatBridge: number[]; x: number[] };
  owned: Record<string, string | null>;
  levels: Record<string, number>;
}

interface WondersSnapshot {
  revision: number;
  view: {
    engineVersion: string;
    victoryTarget: number;
    result: { playerId: string | null; reason: string; score?: number; playerIds?: string[]; cause?: string } | null;
    turn: { playerId: string; phase: string };
    board: { topologyId: string; pirate: number | null; robber: number; terrain: string[]; harbors: { edge: number; type: string }[] };
    hints?: { modules?: { seafarers?: { wonders?: { claimable: string[]; buildable: boolean } } } };
    modules?: { seafarers?: { wonders?: WondersView } };
  };
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  error?: unknown;
  revision: number;
}

const snapshot = async (client: TestClient, gameId: string): Promise<WondersSnapshot> =>
  client.expectOk<WondersSnapshot>(await client.get(`/api/games/${gameId}`));

describe('The Wonders of Catan over the API', () => {
  it('is listed as enabled and selectable, without bot seats', async () => {
    const host = await harness.client('WocLister');
    const data = host.expectOk<{
      profiles: { id: string; enabled: boolean; botSeats: boolean; playerCounts: number[] }[];
      selectable: string[];
    }>(await host.get('/api/profiles'));
    expect(data.profiles.find((profile) => profile.id === PROFILE)).toMatchObject({ enabled: true, botSeats: false, playerCounts: [3, 4] });
    expect(data.selectable).toContain(PROFILE);
  });

  it('resolves the ruleset by parts for 3 and 4 players and rejects 5 and 6', async () => {
    const host = await harness.client('WocHost');
    for (const capacity of [3, 4]) {
      const room = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'fixed',
        ruleset: { expansions: ['seafarers'], scenario: 'wonders-of-catan', variants: [] },
      }));
      expect(room.profileId).toBe(PROFILE);
    }
    for (const capacity of [5, 6]) {
      const response = await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'fixed',
        ruleset: { expansions: ['seafarers'], scenario: 'wonders-of-catan' },
      });
      host.expectError(response, 'E_UNSUPPORTED_COMBINATION');
      expect(response.body.ok ? null : response.body.error.params).toMatchObject({ reason: 'bad-player-count' });
    }
  });

  it('refuses a bot seat with reason profile', async () => {
    const host = await harness.client('WocBotHost');
    const room = host.expectOk<{ id: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'fixed', profileId: PROFILE,
    }));
    const refused = await host.post(`/api/rooms/${room.id}/bots`, { level: 'standard' });
    host.expectError(refused, 'E_INVALID_BOT');
    expect(refused.body.ok ? null : refused.body.error.params).toMatchObject({ reason: 'profile' });
  });

  it('starts 3 and 4 players on the one 49-hex map: robber on a desert, no pirate, 9 random harbours, 11 markers', async () => {
    for (const count of [3, 4] as const) {
      const { clients, gameId } = await startedGame(harness, count, { profileId: PROFILE });
      const state = await snapshot(clients[0]!, gameId);
      expect(state.view.board.topologyId).toBe('sf-wonders-of-catan');
      expect(getTopology('sf-wonders-of-catan').hexes).toHaveLength(49);
      expect(state.view.engineVersion).toBe('sf-2025.3');
      expect(state.view.victoryTarget).toBe(10);
      expect(state.view.board.pirate).toBeNull();
      expect(state.view.board.terrain[state.view.board.robber]).toBe('desert');
      expect(state.view.board.harbors).toHaveLength(9);
      expect(state.view.board.harbors.filter((harbor) => harbor.type === 'generic')).toHaveLength(4);
      const wonders = state.view.modules!.seafarers!.wonders!;
      expect([wonders.markers.greatWall.length, wonders.markers.greatBridge.length, wonders.markers.x.length]).toEqual([5, 2, 4]);
      expect(Object.values(wonders.owned).every((id) => id === null)).toBe(true);
      for (const client of clients) expect((await snapshot(client, gameId)).view.modules!.seafarers!.wonders).toEqual(wonders);
    }
  });

  it('keeps starting settlements on the large island and off the markers, then claims, builds, restarts and completes a wonder', async () => {
    const local = await startHarness();
    let restarted: Awaited<ReturnType<typeof restartService>> | undefined;
    try {
      const { clients, gameId, roomId } = await startedGame(local, 3, { profileId: PROFILE });
      const topology = getTopology('sf-wonders-of-catan');
      await runSetupOverApi(clients, gameId);
      const row = (await local.service.repo.findGame(gameId))!;
      const state = JSON.parse(row.state_json) as GameState;
      const markers = (state.moduleState as unknown as { seafarers: { wonders: WondersView } }).seafarers.wonders.markers;
      const forbidden = new Set([...markers.greatWall, ...markers.greatBridge, ...markers.x]);
      state.board.buildings.forEach((building, vertex) => {
        if (!building) return;
        expect(forbidden.has(vertex)).toBe(false);
        expect(topology.vertices[vertex]!.hexes.some((hex) => state.board.layout.islands[hex] === 1)).toBe(true);
      });
      expect(state.turn.phase).toBe('preroll');

      // test-only 準備：行動者在 Great Wall 標記上有村落、手上有 4 層的資源（直接進行動階段）。
      const actorId = state.players[state.turn.seat]!.id;
      const wall = markers.greatWall.find((vertex) => topology.vertices[vertex]!.edges.every((edge) =>
        topology.edges[edge]!.vertices.every((other) => !state.board.buildings[other])))!;
      state.board.buildings[wall] = { player: actorId, city: false };
      const cost = WONDERS.find((def) => def.id === 'greatWall')!.cost;
      const hand = state.players[state.turn.seat]!.resources;
      for (const [resource, amount] of Object.entries(cost)) hand[resource as keyof typeof hand] += (amount ?? 0) * 4;
      state.turn.phase = 'action';
      state.turn.dice = [3, 4];
      await local.service.repo.saveGame(gameId, state, row.revision, 'playing', null);

      const actor = clients.find((client) => client.playerId === actorId)!;
      const prepared = await snapshot(actor, gameId);
      expect(prepared.view.hints!.modules!.seafarers!.wonders!.claimable).toEqual(['greatWall']);
      const send = async (client: TestClient, id: string, revision: number, command: Record<string, unknown>) =>
        client.expectOk<Receipt>(await client.post(`/api/games/${gameId}/commands`, { commandId: id, expectedRevision: revision, command }));

      const claimed = await send(actor, 'woc-claim', prepared.revision, { type: 'wonder.choose', wonder: 'greatWall' });
      expect(claimed, JSON.stringify(claimed)).toMatchObject({ outcome: 'accepted' });
      const built = await send(actor, 'woc-build-1', claimed.revision, { type: 'wonder.build' });
      expect(built).toMatchObject({ outcome: 'accepted' });
      const afterOne = await snapshot(actor, gameId);
      expect(afterOne.view.modules!.seafarers!.wonders!.owned[actorId]).toBe('greatWall');
      expect(afterOne.view.modules!.seafarers!.wonders!.levels[actorId]).toBe(1);

      // 中途重啟：奇觀與層數還原，所有玩家看到同一份。
      const saved = (await local.service.repo.findGame(gameId))!.state_json;
      await local.service.close();
      restarted = await restartService(local);
      expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);
      const resumed = (client: TestClient) => Object.assign(createClient(`http://127.0.0.1:${restarted!.port}`), { cookie: client.cookie, playerId: client.playerId });
      const back = resumed(actor);
      const after = await snapshot(back, gameId);
      expect(after.view.modules!.seafarers!.wonders).toEqual(afterOne.view.modules!.seafarers!.wonders);

      // 其他人不能認領同一座，也不能蓋。
      const other = resumed(clients.find((client) => client.playerId !== actorId)!);
      const otherReceipt = await other.post(`/api/games/${gameId}/commands`, {
        commandId: 'woc-other', expectedRevision: after.revision, command: { type: 'wonder.build' },
      });
      expect(otherReceipt.body.ok ? (otherReceipt.body.data as Receipt).outcome : 'error').not.toBe('accepted');

      let revision = after.revision;
      for (const level of [2, 3, 4]) {
        const receipt = await send(back, `woc-build-${level}`, revision, { type: 'wonder.build' });
        expect(receipt, JSON.stringify(receipt)).toMatchObject({ outcome: 'accepted' });
        revision = receipt.revision;
      }
      for (const client of clients) {
        const view = (await snapshot(resumed(client), gameId)).view;
        expect(view.result).toMatchObject({ reason: 'victory', playerId: actorId, playerIds: [actorId], cause: 'wonderComplete' });
        expect(view.turn.phase).toBe('gameOver');
      }
      const stored = JSON.parse((await restarted.repo.findGame(gameId))!.state_json) as GameState;
      expect(stored.log.find((event) => event.type === 'game.finished')!.params).toMatchObject({ playerIds: [actorId], cause: 'wonderComplete' });
      expect(stored.log.find((event) => event.type === 'game.finished')!.params).not.toHaveProperty('target');
      const room = back.expectOk<{ status: string }>(await back.get(`/api/rooms/${roomId}`));
      expect(room.status).toBe('completed');
    } finally {
      if (restarted) await restarted.close();
      else await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  }, 90_000);
});
