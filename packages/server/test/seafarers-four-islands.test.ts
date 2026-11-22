/**
 * The Four Islands（S2）經由服務：大廳選擇鏈、房間建立、3/4 人開局、設置後的
 * home islands、中途重啟的還原、一局到結束，以及 bot 座位仍被拒絕。
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

  it('records home islands, survives a mid-game restart and plays to a 13-point win', async () => {
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

      // 重啟後可繼續：下一個座位已有 13 分，目前行動者結束回合即在其回合開始勝利（R-B07）。
      const row = (await restarted.repo.findGame(gameId))!;
      const state = JSON.parse(row.state_json) as GameState;
      const winnerSeat = (state.turn.seat + 1) % state.players.length;
      state.players[winnerSeat]!.bonusPoints = 11; // 2 個起始村落 + 11 = 13
      state.turn.phase = 'action';
      await restarted.repo.saveGame(gameId, state, row.revision, 'playing', null);
      const current = await snapshot(resumed(host), gameId);
      const actor = resumed(clients.find((client) => client.playerId === current.view.turn.playerId)!);
      const receipt = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, {
        commandId: 'fi-end', expectedRevision: current.revision, command: { type: 'turn.end' },
      }));
      expect(receipt.outcome).toBe('accepted');
      const final = await snapshot(resumed(host), gameId);
      expect(final.view.result).toMatchObject({ playerId: state.players[winnerSeat]!.id, reason: 'victory' });
      const room = resumed(host).expectOk<{ status: string }>(await resumed(host).get(`/api/rooms/${roomId}`));
      expect(room.status).toBe('completed');
    } finally {
      if (restarted) await restarted.close();
      else await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  }, 60_000);
});
