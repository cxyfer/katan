/**
 * Cloth for Catan（S6）經由服務：房間建立、3/4 人開局（同一張 42 格圖、8 個部落共 50 枚布匹）、
 * 第三個起始村落、部落貿易、中途重啟還原，最後以布匹耗盡的共同勝利結束（重連後結果一致）。
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

const PROFILE = 'sf-cloth-for-catan-2025';
let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface ClothView {
  tribes: { vertex: number; number: number; cloth: number }[];
  supply: number;
  links: Record<string, number[]>;
  cloth: Record<string, number>;
}

interface ClothSnapshot {
  revision: number;
  view: {
    engineVersion: string;
    victoryTarget: number;
    players: { id: string; ownScore?: number; publicScore?: number }[];
    result: { playerId: string | null; reason: string; score?: number; playerIds?: string[]; cause?: string } | null;
    pending: { kind: string } | null;
    turn: { playerId: string; phase: string; setup: { round: number; third?: true; remaining: number } | null };
    board: { topologyId: string; pirate: number | null; robber: number; terrain: string[]; numbers: (number | null)[]; harbors: { edge: number; type: string }[] };
    hints?: { legalSettlements: number[] };
    modules?: { seafarers?: { cloth?: ClothView } };
    events?: { type: string; params: Record<string, unknown> }[];
  };
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  error?: unknown;
  revision: number;
}

const snapshot = async (client: TestClient, gameId: string): Promise<ClothSnapshot> =>
  client.expectOk<ClothSnapshot>(await client.get(`/api/games/${gameId}`));

const clothOf = (state: GameState) => (state.moduleState as unknown as { seafarers: { cloth: ClothView } }).seafarers.cloth;

describe('Cloth for Catan over the API', () => {
  it('is listed as enabled and selectable, without bot seats', async () => {
    const host = await harness.client('CfcLister');
    const data = host.expectOk<{
      profiles: { id: string; enabled: boolean; botSeats: boolean; playerCounts: number[] }[];
      selectable: string[];
    }>(await host.get('/api/profiles'));
    expect(data.profiles.find((profile) => profile.id === PROFILE)).toMatchObject({ enabled: true, botSeats: false, playerCounts: [3, 4] });
    expect(data.selectable).toContain(PROFILE);
  });

  it('resolves the ruleset by parts for 3 and 4 players and rejects 5 and 6', async () => {
    const host = await harness.client('CfcHost');
    for (const capacity of [3, 4]) {
      const room = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'fixed',
        ruleset: { expansions: ['seafarers'], scenario: 'cloth-for-catan', variants: [] },
      }));
      expect(room.profileId).toBe(PROFILE);
    }
    for (const capacity of [5, 6]) {
      const response = await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'fixed',
        ruleset: { expansions: ['seafarers'], scenario: 'cloth-for-catan' },
      });
      host.expectError(response, 'E_UNSUPPORTED_COMBINATION');
      expect(response.body.ok ? null : response.body.error.params).toMatchObject({ reason: 'bad-player-count' });
    }
  });

  it('refuses a bot seat with reason profile', async () => {
    const host = await harness.client('CfcBotHost');
    const room = host.expectOk<{ id: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'fixed', profileId: PROFILE,
    }));
    const refused = await host.post(`/api/rooms/${room.id}/bots`, { level: 'standard' });
    host.expectError(refused, 'E_INVALID_BOT');
    expect(refused.body.ok ? null : refused.body.error.params).toMatchObject({ reason: 'profile' });
  });

  it('starts 3 and 4 players on the one 42-hex map: 8 tribes with 5 cloth each, 10 in the supply, 9 random harbours', async () => {
    for (const count of [3, 4] as const) {
      const { clients, gameId } = await startedGame(harness, count, { profileId: PROFILE });
      const state = await snapshot(clients[0]!, gameId);
      expect(state.view.board.topologyId).toBe('sf-cloth-for-catan');
      expect(getTopology('sf-cloth-for-catan').hexes).toHaveLength(42);
      expect(state.view.engineVersion).toBe('sf-2025.3');
      expect(state.view.victoryTarget).toBe(14);
      expect(state.view.board.pirate).toBeNull();
      expect(state.view.board.terrain[state.view.board.robber]).toBe('fields');
      expect(state.view.board.numbers[state.view.board.robber]).toBe(12);
      expect(state.view.board.harbors).toHaveLength(9);
      expect(state.view.board.harbors.filter((harbor) => harbor.type === 'generic')).toHaveLength(4);
      const cloth = state.view.modules!.seafarers!.cloth!;
      expect(cloth.tribes.map((tribe) => tribe.cloth)).toEqual(Array(8).fill(5));
      expect(cloth.tribes.map((tribe) => tribe.number).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 8, 9, 10, 11]);
      expect(cloth.supply).toBe(10);
      // 三個起始村落：第三個之前沒有人收資源。
      const setupState = state.view.turn.setup!;
      expect(setupState.round).toBe(1);
      expect(setupState.remaining).toBe(count * 3);
      // 所有人看到同一份布匹資訊。
      for (const client of clients) expect((await snapshot(client, gameId)).view.modules!.seafarers!.cloth).toEqual(cloth);
    }
  });

  it('places three starting settlements, trades with a tribe, restarts mid-game and ends in a shared victory after reconnecting', async () => {
    const local = await startHarness();
    let restarted: Awaited<ReturnType<typeof restartService>> | undefined;
    try {
      const { clients, gameId, roomId } = await startedGame(local, 4, { profileId: PROFILE });
      const topology = getTopology('sf-cloth-for-catan');
      await runSetupOverApi(clients, gameId);
      const row = (await local.service.repo.findGame(gameId))!;
      const state = JSON.parse(row.state_json) as GameState;
      // 設置：每位玩家三個村落、三條路／船；第三個村落之前沒有收資源，之後只有一次起始資源。
      for (const player of state.players) {
        expect(state.board.buildings.filter((building) => building?.player === player.id)).toHaveLength(3);
      }
      expect(state.log.filter((event) => event.type === 'setup.startingResources')).toHaveLength(4);
      expect(state.turn.phase).toBe('preroll');
      expect(state.turn.seat).toBe(0);

      // test-only 準備：行動者有一個大島海岸村落，旁邊一艘船就能碰到部落頂點。
      const actorId = state.players[state.turn.seat]!.id;
      const sea = (edge: number): boolean => topology.edges[edge]!.hexes.length === 1
        || topology.edges[edge]!.hexes.some((hex) => state.board.layout.terrain[hex] === 'sea');
      const tribes = clothOf(state).tribes;
      const tribeAt = new Map(tribes.map((tribe, index) => [tribe.vertex, index]));
      const free = (vertex: number): boolean => !state.board.buildings[vertex]
        && topology.vertices[vertex]!.edges.every((edge) => topology.edges[edge]!.vertices.every((other) => !state.board.buildings[other]));
      let route: { start: number; edge: number; tribe: number } | undefined;
      topology.vertices.forEach((info, vertex) => {
        if (route || !free(vertex) || tribeAt.has(vertex)) return;
        if (!info.hexes.some((hex) => [1, 6].includes(state.board.layout.islands[hex]!))) return;
        if (info.hexes.some((hex) => [2, 3, 4, 5].includes(state.board.layout.islands[hex]!))) return;
        for (const edge of info.edges) {
          const other = topology.edges[edge]!.vertices.find((candidate) => candidate !== vertex)!;
          if (sea(edge) && tribeAt.has(other) && !state.board.roads[edge]) route = { start: vertex, edge, tribe: tribeAt.get(other)! };
        }
      });
      expect(route).toBeDefined();
      state.board.buildings[route!.start] = { player: actorId, city: false };
      state.players[state.turn.seat]!.resources = { lumber: 2, brick: 0, wool: 2, grain: 0, ore: 0 };
      state.turn.phase = 'action';
      state.turn.dice = [3, 4];
      await local.service.repo.saveGame(gameId, state, row.revision, 'playing', null);

      const actor = clients.find((client) => client.playerId === actorId)!;
      const prepared = await snapshot(actor, gameId);
      const built = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, {
        commandId: 'cfc-ship-tribe', expectedRevision: prepared.revision, command: { type: 'build.ship', edge: route!.edge },
      }));
      expect(built, JSON.stringify(built)).toMatchObject({ outcome: 'accepted' });
      const traded = await snapshot(actor, gameId);
      const afterTrade = traded.view.modules!.seafarers!.cloth!;
      expect(afterTrade.links[actorId]).toEqual([route!.tribe]);
      expect(afterTrade.cloth[actorId]).toBe(1);
      expect(afterTrade.tribes[route!.tribe]!.cloth).toBe(4);

      // 中途重啟：布匹、關係與供應堆都還原，所有玩家的視圖一致。
      const saved = (await local.service.repo.findGame(gameId))!.state_json;
      await local.service.close();
      restarted = await restartService(local);
      const base = `http://127.0.0.1:${restarted.port}`;
      const resumed = (client: TestClient) => Object.assign(createClient(base), { cookie: client.cookie, playerId: client.playerId });
      expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);
      const back = resumed(actor);
      const after = await snapshot(back, gameId);
      expect(after.revision).toBe(traded.revision);
      expect(after.view.modules!.seafarers!.cloth).toEqual(afterTrade);

      // test-only 準備：5 個部落沒有布匹，且最高分與布匹數兩位玩家相同 → 回合結束時共同勝利。
      const row2 = (await restarted.repo.findGame(gameId))!;
      const state2 = JSON.parse(row2.state_json) as GameState;
      const cloth2 = clothOf(state2);
      for (const tribe of cloth2.tribes.slice(0, 5)) {
        cloth2.supply += tribe.cloth;
        tribe.cloth = 0;
      }
      // 只讓 p1（行動者）與 p3 的總分相同且最高。
      const [first, , third] = state2.players;
      first!.bonusPoints += 3;
      third!.bonusPoints += 3 + (state2.board.buildings.filter((b) => b?.player === first!.id).length - state2.board.buildings.filter((b) => b?.player === third!.id).length);
      // 布匹數也相同（差額從供應堆補，總數仍是 50）。
      const delta = cloth2.cloth[first!.id]! - cloth2.cloth[third!.id]!;
      cloth2.cloth[third!.id] = cloth2.cloth[third!.id]! + delta;
      cloth2.supply -= delta;
      await restarted.repo.saveGame(gameId, state2, row2.revision, 'playing', null);
      const ready = await snapshot(back, gameId);
      const scores = Object.fromEntries(ready.view.players.map((player) => [player.id, player.publicScore]));
      expect(scores[first!.id]).toBe(scores[third!.id]);
      expect(ready.view.result).toBeNull();

      const ended = back.expectOk<Receipt>(await back.post(`/api/games/${gameId}/commands`, {
        commandId: 'cfc-end', expectedRevision: ready.revision, command: { type: 'turn.end' },
      }));
      expect(ended, JSON.stringify(ended)).toMatchObject({ outcome: 'accepted' });
      const winners = [first!.id, third!.id];
      for (const client of clients) {
        const view = (await snapshot(resumed(client), gameId)).view;
        expect(view.result).toMatchObject({ reason: 'victory', playerId: first!.id, playerIds: winners, cause: 'clothExhausted' });
        expect(view.turn.phase).toBe('gameOver');
      }
      // 再重啟一次（重連）：結果仍一致，權威事件紀錄指名同一批勝者。
      await restarted.close();
      restarted = await restartService(local);
      const base2 = `http://127.0.0.1:${restarted.port}`;
      const again = Object.assign(createClient(base2), { cookie: clients[1]!.cookie, playerId: clients[1]!.playerId });
      const finalView = (await snapshot(again, gameId)).view;
      expect(finalView.result).toMatchObject({ playerIds: winners, cause: 'clothExhausted' });
      const stored = JSON.parse((await restarted.repo.findGame(gameId))!.state_json) as GameState;
      expect(stored.log.find((event) => event.type === 'game.finished')!.params).toMatchObject({ playerIds: winners, cause: 'clothExhausted' });
      const room = again.expectOk<{ status: string }>(await again.get(`/api/rooms/${roomId}`));
      expect(room.status).toBe('completed');
    } finally {
      if (restarted) await restarted.close();
      else await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  }, 90_000);

  it('restores a pirate steal waiting on a victim who has only cloth, then steals it and ends the turn', async () => {
    const local = await startHarness();
    let restarted: Awaited<ReturnType<typeof restartService>> | undefined;
    try {
      const { clients, gameId } = await startedGame(local, 3, { profileId: PROFILE });
      const topology = getTopology('sf-cloth-for-catan');
      await runSetupOverApi(clients, gameId);
      const row = (await local.service.repo.findGame(gameId))!;
      const state = JSON.parse(row.state_json) as GameState;
      const actorId = state.players[state.turn.seat]!.id;
      const victimId = state.players[1]!.id;
      const sea = (edge: number): boolean => topology.edges[edge]!.hexes.length === 1
        || topology.edges[edge]!.hexes.some((hex) => state.board.layout.terrain[hex] === 'sea');
      const tribes = clothOf(state).tribes;
      const tribeAt = new Map(tribes.map((tribe, index) => [tribe.vertex, index]));
      const free = (vertex: number): boolean => !state.board.buildings[vertex]
        && topology.vertices[vertex]!.edges.every((edge) => topology.edges[edge]!.vertices.every((other) => !state.board.buildings[other]));
      // 行動者：一個大島海岸村落與一艘碰到部落的船（有通到部落的通路，才可移動海盜）。
      let route: { start: number; edge: number } | undefined;
      topology.vertices.forEach((info, vertex) => {
        if (route || !free(vertex) || tribeAt.has(vertex)) return;
        if (!info.hexes.some((hex) => [1, 6].includes(state.board.layout.islands[hex]!))) return;
        if (info.hexes.some((hex) => [2, 3, 4, 5].includes(state.board.layout.islands[hex]!))) return;
        for (const edge of info.edges) {
          const other = topology.edges[edge]!.vertices.find((candidate) => candidate !== vertex)!;
          if (sea(edge) && tribeAt.has(other) && !state.board.roads[edge]) route = { start: vertex, edge };
        }
      });
      expect(route).toBeDefined();
      state.board.buildings[route!.start] = { player: actorId, city: false };
      state.board.roads[route!.edge] = { player: actorId, ship: true };
      // 受害者：只有布匹、沒有手牌，船在一個海格的邊上。
      const seaHex = topology.hexes.findIndex((_, hex) => state.board.layout.terrain[hex] === 'sea'
        && topology.edges.some((info, edge) => info.hexes.length === 2 && info.hexes.includes(hex) && sea(edge) && !state.board.roads[edge]
          && info.vertices.every((vertex) => !tribeAt.has(vertex) && !state.board.buildings[vertex])));
      const shipEdge = topology.edges.findIndex((info, edge) => info.hexes.length === 2 && info.hexes.includes(seaHex) && sea(edge) && !state.board.roads[edge]
        && info.vertices.every((vertex) => !tribeAt.has(vertex) && !state.board.buildings[vertex]));
      state.board.roads[shipEdge] = { player: victimId, ship: true };
      const victim = state.players.find((player) => player.id === victimId)!;
      for (const resource of Object.keys(victim.resources) as (keyof typeof victim.resources)[]) {
        state.bank[resource] += victim.resources[resource];
        victim.resources[resource] = 0;
      }
      const cloth = clothOf(state);
      cloth.cloth[victimId] = 2;
      cloth.supply -= 2;
      state.turn.phase = 'action';
      state.turn.dice = [3, 4];
      state.pending = { kind: 'moveRobber', actor: actorId, cause: 'seven', pirate: false } as never;
      await local.service.repo.saveGame(gameId, state, row.revision, 'playing', null);

      const actor = clients.find((client) => client.playerId === actorId)!;
      const prepared = await snapshot(actor, gameId);
      const moved = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, {
        commandId: 'cfc-pirate', expectedRevision: prepared.revision, command: { type: 'pending.moveRobber', hex: seaHex },
      }));
      expect(moved, JSON.stringify(moved)).toMatchObject({ outcome: 'accepted' });
      const waiting = await snapshot(actor, gameId);
      expect(waiting.view.pending).toMatchObject({ kind: 'steal', candidates: [victimId] });
      const hints = (waiting.view as unknown as { hints: { modules: { seafarers: { clothVictims: string[] } } } }).hints.modules.seafarers;
      expect(hints.clothVictims).toEqual([victimId]);

      // 尚未選擇偷竊時重啟：frame 與 clothVictims 都還原。
      const saved = (await local.service.repo.findGame(gameId))!.state_json;
      await local.service.close();
      restarted = await restartService(local);
      expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);
      const back = Object.assign(createClient(`http://127.0.0.1:${restarted.port}`), { cookie: actor.cookie, playerId: actor.playerId });
      const after = await snapshot(back, gameId);
      expect(after.view.pending).toMatchObject({ kind: 'steal', candidates: [victimId] });
      expect((after.view as unknown as { hints: { modules: { seafarers: { clothVictims: string[] } } } }).hints.modules.seafarers.clothVictims).toEqual([victimId]);
      // 受害者沒有手牌：偷牌被拒，偷布匹被接受，回合可以結束。
      const refused = await back.post(`/api/games/${gameId}/commands`, {
        commandId: 'cfc-card', expectedRevision: after.revision, command: { type: 'pending.steal', victim: victimId },
      });
      expect(refused.body.ok ? (refused.body.data as Receipt).outcome : 'error').not.toBe('accepted');
      const stolen = back.expectOk<Receipt>(await back.post(`/api/games/${gameId}/commands`, {
        commandId: 'cfc-cloth', expectedRevision: after.revision, command: { type: 'cloth.steal', victim: victimId },
      }));
      expect(stolen, JSON.stringify(stolen)).toMatchObject({ outcome: 'accepted' });
      const done = await snapshot(back, gameId);
      expect(done.view.pending).toBeNull();
      const view = done.view.modules!.seafarers!.cloth!;
      expect(view.cloth[victimId]).toBe(1);
      expect(view.cloth[actorId]).toBe(2); // 通往部落的船先拿了 1 枚，再偷 1 枚
      const ended = back.expectOk<Receipt>(await back.post(`/api/games/${gameId}/commands`, {
        commandId: 'cfc-end2', expectedRevision: done.revision, command: { type: 'turn.end' },
      }));
      expect(ended).toMatchObject({ outcome: 'accepted' });
    } finally {
      if (restarted) await restarted.close();
      else await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  }, 90_000);
});
