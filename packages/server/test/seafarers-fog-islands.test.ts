/**
 * The Fog Islands（S3）經由服務：大廳選擇鏈、房間建立、3/4 人開局、設置、
 * 含未翻開格與一個 pending 選擇 frame 的重啟還原，以及一局到結束（用合法命令觸發
 * 翻開與勝利）；bot 座位仍被拒絕。
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

const PROFILE = 'sf-fog-islands-2025';
let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface FogSnapshot {
  revision: number;
  view: {
    engineVersion: string;
    victoryTarget: number;
    result: { playerId: string | null; reason: string } | null;
    turn: { playerId: string };
    pending?: { kind: string; responders: string[]; data: { hexes?: number[] } } | null;
    board: { topologyId: string; pirate: number | null; terrain: string[]; numbers: (number | null)[] };
    modules?: { seafarers?: { islandBonus: Record<string, number[]>; fog?: number[]; home?: unknown } };
  };
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  error?: unknown;
  revision: number;
}

const snapshot = async (client: TestClient, gameId: string): Promise<FogSnapshot> =>
  client.expectOk<FogSnapshot>(await client.get(`/api/games/${gameId}`));

describe('The Fog Islands over the API', () => {
  it('is listed as enabled and selectable, without bot seats', async () => {
    const host = await harness.client('FogLister');
    const data = host.expectOk<{
      profiles: { id: string; enabled: boolean; botSeats: boolean; playerCounts: number[] }[];
      selectable: string[];
    }>(await host.get('/api/profiles'));
    expect(data.profiles.find((profile) => profile.id === PROFILE)).toMatchObject({ enabled: true, botSeats: false, playerCounts: [3, 4] });
    expect(data.selectable).toContain(PROFILE);
  });

  it('resolves the ruleset by parts for 3 and 4 players and rejects 5 and 6', async () => {
    const host = await harness.client('FogHost');
    for (const capacity of [3, 4]) {
      const room = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'fixed',
        ruleset: { expansions: ['seafarers'], scenario: 'fog-islands', variants: [] },
      }));
      expect(room.profileId).toBe(PROFILE);
    }
    for (const capacity of [5, 6]) {
      const response = await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'fixed',
        ruleset: { expansions: ['seafarers'], scenario: 'fog-islands' },
      });
      host.expectError(response, 'E_UNSUPPORTED_COMBINATION');
      expect(response.body.ok ? null : response.body.error.params).toMatchObject({ reason: 'bad-player-count' });
    }
  });

  it('refuses a bot seat with reason profile', async () => {
    const host = await harness.client('FogBotHost');
    const room = host.expectOk<{ id: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'fixed', profileId: PROFILE,
    }));
    const refused = await host.post(`/api/rooms/${room.id}/bots`, { level: 'standard' });
    host.expectError(refused, 'E_INVALID_BOT');
    expect(refused.body.ok ? null : refused.body.error.params).toMatchObject({ reason: 'profile' });
  });

  it('starts the 3- and 4-player maps with 12 VP, 12 unrevealed hexes and no deck in the view', async () => {
    for (const [count, topologyId] of [[3, 'sf-fog-islands-3'], [4, 'sf-fog-islands-4']] as const) {
      const { clients, gameId } = await startedGame(harness, count, { profileId: PROFILE });
      const state = await snapshot(clients[0]!, gameId);
      expect(state.view.board.topologyId).toBe(topologyId);
      expect(state.view.engineVersion).toBe('sf-2025.3');
      expect(state.view.victoryTarget).toBe(12);
      expect(state.view.board.pirate).toBeNull();
      const fog = state.view.modules!.seafarers!.fog!;
      expect(fog).toHaveLength(12);
      for (const hex of fog) expect([state.view.board.terrain[hex], state.view.board.numbers[hex]]).toEqual(['sea', null]);
      expect(JSON.stringify(state.view)).not.toMatch(/"(tiles|discs|deck)"/);
    }
  });

  it('restarts mid-game with unrevealed hexes and a pending choice, reveals over the API and wins on 12 points', async () => {
    const local = await startHarness();
    let restarted: Awaited<ReturnType<typeof restartService>> | undefined;
    try {
      const { clients, gameId, roomId } = await startedGame(local, 3, { profileId: PROFILE });
      await runSetupOverApi(clients, gameId);
      const host = clients[0]!;
      const topology = getTopology('sf-fog-islands-3');

      // 準備盤面（test-only）：行動者在行動階段，手上有一艘船的料，
      // 在碰到兩個空格的海邊一端有自己的村落；之後用合法命令建造那艘船。
      const row = (await local.service.repo.findGame(gameId))!;
      const state = JSON.parse(row.state_json) as GameState;
      const actorId = state.players[state.turn.seat]!.id;
      const fogHexes = (state.moduleState as unknown as { seafarers: { fog: { hexes: number[] } } }).seafarers.fog.hexes;
      const edge = topology.edges.findIndex((info, index) => {
        if (state.board.roads[index] || !info.hexes.every((hex) => state.board.layout.terrain[hex] === 'sea')) return false;
        const touched = new Set(info.vertices.flatMap((vertex) => topology.vertices[vertex]!.hexes.filter((hex) => fogHexes.includes(hex))));
        return touched.size === 2;
      });
      expect(edge).toBeGreaterThanOrEqual(0);
      const start = topology.edges[edge]!.vertices[0];
      state.board.buildings[start] = { player: actorId, city: false };
      const me = state.players[state.turn.seat]!;
      me.resources = { lumber: 1, brick: 0, wool: 1, grain: 0, ore: 0 };
      state.turn.phase = 'action';
      state.turn.dice = [3, 4];
      await local.service.repo.saveGame(gameId, state, row.revision, 'playing', null);

      const actorClient = clients.find((client) => client.playerId === actorId)!;
      const prepared = await snapshot(host, gameId);
      const built = actorClient.expectOk<Receipt>(await actorClient.post(`/api/games/${gameId}/commands`, {
        commandId: 'fog-build-ship', expectedRevision: prepared.revision, command: { type: 'build.ship', edge },
      }));
      expect(built, JSON.stringify(built)).toMatchObject({ outcome: 'accepted' });
      const waiting = await snapshot(host, gameId);
      expect(waiting.view.pending).toMatchObject({ kind: 'seafarers.fog', responders: [actorId] });
      const candidates = waiting.view.pending!.data.hexes!;
      expect(candidates).toHaveLength(2);
      expect(waiting.view.modules!.seafarers!.fog).toHaveLength(12);
      const saved = (await local.service.repo.findGame(gameId))!.state_json;

      await local.service.close();
      restarted = await restartService(local);
      const base = `http://127.0.0.1:${restarted.port}`;
      const resumed = (client: TestClient) => Object.assign(createClient(base), { cookie: client.cookie, playerId: client.playerId });
      const after = await snapshot(resumed(host), gameId);
      expect(after.revision).toBe(waiting.revision);
      expect(after.view.pending).toEqual(waiting.view.pending);
      expect(after.view.modules!.seafarers!.fog).toEqual(waiting.view.modules!.seafarers!.fog);
      expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);

      // 還原後選擇仍可作答：別人不行、候選以外不行、放置者選一個才翻開。
      const other = resumed(clients.find((client) => client.playerId !== actorId)!);
      const refused = other.expectOk<Receipt>(await other.post(`/api/games/${gameId}/commands`, {
        commandId: 'fog-intruder', expectedRevision: after.revision, command: { type: 'fog.choose', hex: candidates[0] },
      }));
      expect(refused.outcome).toBe('rejected');
      expect(JSON.stringify(refused.error)).toContain('E_NOT_ACTOR');
      const actor = resumed(actorClient);
      const chosen = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, {
        commandId: 'fog-choose', expectedRevision: after.revision, command: { type: 'fog.choose', hex: candidates[1] },
      }));
      expect(chosen, JSON.stringify(chosen)).toMatchObject({ outcome: 'accepted' });
      let revealed = await snapshot(resumed(host), gameId);
      // 翻到金礦（隨機）時，探索者要先自選一種資源。
      if (revealed.view.pending?.kind === 'seafarers.gold') {
        const picked = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, {
          commandId: 'fog-gold', expectedRevision: revealed.revision, command: { type: 'gold.choose', resources: ['ore'] },
        }));
        expect(picked).toMatchObject({ outcome: 'accepted' });
        revealed = await snapshot(resumed(host), gameId);
      }
      expect(revealed.view.pending ?? null).toBeNull();
      expect(revealed.view.modules!.seafarers!.fog).toHaveLength(11);
      expect(revealed.view.modules!.seafarers!.fog).not.toContain(candidates[1]);
      expect(revealed.view.modules!.seafarers!.fog).toContain(candidates[0]);
      // 翻開的是公開資訊；其餘空格仍是無數字的海。
      for (const hex of revealed.view.modules!.seafarers!.fog!) expect(revealed.view.board.numbers[hex]).toBeNull();

      // 收尾（test-only 準備分數與一條接到空交叉點的路）：最後的分數來自合法的蓋村落命令。
      // 這個劇本沒有島嶼獎勵，12 分 = 村落 + 其他分數。
      const row2 = (await restarted.repo.findGame(gameId))!;
      const state2 = JSON.parse(row2.state_json) as GameState;
      const { terrain } = state2.board.layout;
      const near = (vertex: number): number[] => topology.vertices[vertex]!.edges
        .flatMap((e) => topology.edges[e]!.vertices).filter((v) => v !== vertex);
      const target = topology.vertices.findIndex((info, vertex) => !info.interior && !state2.board.buildings[vertex]
        && info.hexes.some((hex) => terrain[hex] !== 'sea')
        && near(vertex).every((v) => !state2.board.buildings[v]));
      expect(target).toBeGreaterThanOrEqual(0);
      const landEdge = topology.vertices[target]!.edges.find((e) => topology.edges[e]!.hexes.some((hex) => terrain[hex] !== 'sea'))!;
      state2.board.roads[landEdge] = { player: actorId, ship: false };
      const mine = state2.players.find((player) => player.id === actorId)!;
      const owned = state2.board.buildings.filter((b) => b?.player === actorId).length;
      mine.resources = { lumber: 1, brick: 1, wool: 1, grain: 1, ore: 0 };
      mine.bonusPoints = 12 - owned - 1;
      await restarted.repo.saveGame(gameId, state2, row2.revision, 'playing', null);
      const current = await snapshot(resumed(host), gameId);
      expect(current.view.result).toBeNull();
      const settled = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, {
        commandId: 'fog-settle-win', expectedRevision: current.revision, command: { type: 'build.settlement', vertex: target },
      }));
      expect(settled, JSON.stringify(settled)).toMatchObject({ outcome: 'accepted' });
      const final = await snapshot(resumed(host), gameId);
      expect(final.view.result).toMatchObject({ playerId: actorId, reason: 'victory' });
      expect(final.view.modules!.seafarers!.islandBonus[actorId]).toEqual([]);
      const room = resumed(host).expectOk<{ status: string }>(await resumed(host).get(`/api/rooms/${roomId}`));
      expect(room.status).toBe('completed');
    } finally {
      if (restarted) await restarted.close();
      else await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  }, 60_000);
});
