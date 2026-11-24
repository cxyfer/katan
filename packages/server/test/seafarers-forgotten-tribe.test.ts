/**
 * The Forgotten Tribe（S5）經由服務：房間建立、3/4 人開局（同一張 49 格圖與 18 個禮物）、
 * 設置只放大島、發展牌禮物的隱私、拿到港口後在 pending 港口放置 frame 中重啟並還原、
 * 放下港口，最後以 VP 標記拿到 13 分結束。
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

const PROFILE = 'sf-forgotten-tribe-2025';
let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface Gift {
  edge: number;
  kind: 'vp' | 'devcard' | 'port';
  harbor?: string;
  card?: string;
}

interface FtSnapshot {
  revision: number;
  view: {
    engineVersion: string;
    victoryTarget: number;
    devDeckSize: number;
    players: { id: string; ownScore?: number }[];
    result: { playerId: string | null; reason: string } | null;
    pending: { kind: string; responders: string[]; data: { harbors?: string[] } } | null;
    turn: { playerId: string };
    board: { topologyId: string; pirate: number | null; robber: number; terrain: string[]; harbors: { edge: number; type: string }[] };
    hints?: { legalSettlements: number[]; modules?: { seafarers?: { harborChoices: { harbors: string[]; edges: number[] } } } };
    modules?: { seafarers?: { tribe?: { gifts: Gift[]; vp: Record<string, number>; held: Record<string, string[]> } } };
  };
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  error?: unknown;
  revision: number;
}

const snapshot = async (client: TestClient, gameId: string): Promise<FtSnapshot> =>
  client.expectOk<FtSnapshot>(await client.get(`/api/games/${gameId}`));

const scoreOfActor = (state: FtSnapshot, id: string): number | undefined => state.view.players.find((player) => player.id === id)?.ownScore;

const tribeOf = (state: GameState) => (state.moduleState as unknown as { seafarers: { tribe: { gifts: Gift[]; held: Record<string, string[]> } } }).seafarers.tribe;

describe('The Forgotten Tribe over the API', () => {
  it('is listed as enabled and selectable, without bot seats', async () => {
    const host = await harness.client('FtLister');
    const data = host.expectOk<{
      profiles: { id: string; enabled: boolean; botSeats: boolean; playerCounts: number[] }[];
      selectable: string[];
    }>(await host.get('/api/profiles'));
    expect(data.profiles.find((profile) => profile.id === PROFILE)).toMatchObject({ enabled: true, botSeats: false, playerCounts: [3, 4] });
    expect(data.selectable).toContain(PROFILE);
  });

  it('resolves the ruleset by parts for 3 and 4 players and rejects 5 and 6', async () => {
    const host = await harness.client('FtHost');
    for (const capacity of [3, 4]) {
      const room = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'fixed',
        ruleset: { expansions: ['seafarers'], scenario: 'forgotten-tribe', variants: [] },
      }));
      expect(room.profileId).toBe(PROFILE);
    }
    for (const capacity of [5, 6]) {
      const response = await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'fixed',
        ruleset: { expansions: ['seafarers'], scenario: 'forgotten-tribe' },
      });
      host.expectError(response, 'E_UNSUPPORTED_COMBINATION');
      expect(response.body.ok ? null : response.body.error.params).toMatchObject({ reason: 'bad-player-count' });
    }
  });

  it('refuses a bot seat with reason profile', async () => {
    const host = await harness.client('FtBotHost');
    const room = host.expectOk<{ id: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'fixed', profileId: PROFILE,
    }));
    const refused = await host.post(`/api/rooms/${room.id}/bots`, { level: 'standard' });
    host.expectError(refused, 'E_INVALID_BOT');
    expect(refused.body.ok ? null : refused.body.error.params).toMatchObject({ reason: 'profile' });
  });

  it('starts 3 and 4 players on the one 49-hex map with 18 gifts and no development card identity', async () => {
    for (const count of [3, 4] as const) {
      const { clients, gameId, } = await startedGame(harness, count, { profileId: PROFILE });
      const state = await snapshot(clients[0]!, gameId);
      expect(state.view.board.topologyId).toBe('sf-forgotten-tribe');
      expect(getTopology('sf-forgotten-tribe').hexes).toHaveLength(49);
      expect(state.view.engineVersion).toBe('sf-2025.3');
      expect(state.view.victoryTarget).toBe(13);
      expect(state.view.board.harbors).toEqual([]);
      expect(state.view.board.pirate).not.toBeNull();
      expect(state.view.board.terrain[state.view.board.pirate!]).toBe('sea');
      expect(state.view.board.terrain[state.view.board.robber]).toBe('desert');
      expect(state.view.devDeckSize).toBe(21);
      const tribe = state.view.modules!.seafarers!.tribe!;
      expect(tribe.gifts).toHaveLength(18);
      expect(tribe.gifts.filter((gift) => gift.kind === 'devcard').every((gift) => gift.card === undefined)).toBe(true);
      // 資料庫裡有牌的身分，任何玩家的視圖都沒有。
      const stored = JSON.parse((await harness.service.repo.findGame(gameId))!.state_json) as GameState;
      const cards = tribeOf(stored).gifts.filter((gift) => gift.kind === 'devcard').map((gift) => gift.card!);
      expect(cards).toHaveLength(4);
      for (const client of clients) {
        const text = JSON.stringify(await snapshot(client, gameId));
        expect(text).not.toContain('"card"');
        for (const card of new Set(cards.filter((card) => card !== 'knight'))) expect(text, card).not.toContain(card);
      }
    }
  });

  it('starts only on the large island, restores a pending harbour placement after a restart and wins on 13 points', async () => {
    const local = await startHarness();
    let restarted: Awaited<ReturnType<typeof restartService>> | undefined;
    try {
      const { clients, gameId, roomId } = await startedGame(local, 3, { profileId: PROFILE });
      const topology = getTopology('sf-forgotten-tribe');
      const layout0 = (JSON.parse((await local.service.repo.findGame(gameId))!.state_json) as GameState).board.layout;
      const touched = (vertex: number): number[] => [...new Set(topology.vertices[vertex]!.hexes
        .filter((hex) => layout0.terrain[hex] !== 'sea').map((hex) => layout0.islands[hex]!))];
      const hints = (await snapshot(clients[0]!, gameId)).view.hints!;
      expect(hints.legalSettlements.length).toBeGreaterThan(0);
      for (const vertex of hints.legalSettlements) expect(touched(vertex), `vertex ${vertex}`).toContain(1);
      await runSetupOverApi(clients, gameId);

      // test-only 準備：行動者有一個大島海岸村落與一艘接到港口禮物邊的船。
      const row = (await local.service.repo.findGame(gameId))!;
      const state = JSON.parse(row.state_json) as GameState;
      state.board.buildings.forEach((building, vertex) => {
        if (building) expect(touched(vertex), `settlement ${vertex}`).toContain(1);
      });
      const actorId = state.players[state.turn.seat]!.id;
      const sea = (edge: number): boolean => topology.edges[edge]!.hexes.length === 1
        || topology.edges[edge]!.hexes.some((hex) => state.board.layout.terrain[hex] === 'sea');
      const neighbours = (vertex: number): number[] => topology.vertices[vertex]!.edges
        .flatMap((edge) => topology.edges[edge]!.vertices).filter((other) => other !== vertex);
      const coast = topology.vertices.findIndex((info, vertex) => touched(vertex).includes(1) && info.edges.length === 3
        && info.edges.filter(sea).length === 2 && !state.board.buildings[vertex]
        && neighbours(vertex).every((other) => !state.board.buildings[other]));
      expect(coast).toBeGreaterThanOrEqual(0);
      state.board.buildings[coast] = { player: actorId, city: false };
      const gifts = tribeOf(state).gifts;
      const portGift = gifts.find((gift) => gift.kind === 'port')!;
      // 接到禮物邊的鄰邊（優先不是別的禮物邊，船直接放在盤面上，不經指令）。
      const chain = (gift: Gift): number => {
        const [a, b] = topology.edges[gift.edge]!.vertices as [number, number];
        const options = [b, a].flatMap((shared) => topology.vertices[shared]!.edges.filter((edge) => edge !== gift.edge && sea(edge)
          && !topology.edges[edge]!.hexes.includes(state.board.pirate ?? -1)));
        const near = options.find((edge) => !gifts.some((other) => other.edge === edge)) ?? options[0];
        if (near === undefined) throw new Error('no chain edge');
        state.board.roads[near] = { player: actorId, ship: true };
        return near;
      };
      chain(portGift);
      const me = state.players[state.turn.seat]!;
      me.resources = { lumber: 2, brick: 0, wool: 2, grain: 0, ore: 0 };
      state.turn.phase = 'action';
      state.turn.dice = [3, 4];
      await local.service.repo.saveGame(gameId, state, row.revision, 'playing', null);

      const actor = clients.find((client) => client.playerId === actorId)!;
      const prepared = await snapshot(actor, gameId);
      const built = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, {
        commandId: 'ft-ship-port', expectedRevision: prepared.revision, command: { type: 'build.ship', edge: portGift.edge },
      }));
      expect(built, JSON.stringify(built)).toMatchObject({ outcome: 'accepted' });
      const pendingState = await snapshot(actor, gameId);
      expect(pendingState.view.pending).toMatchObject({ kind: 'seafarers.harbor', responders: [actorId], data: { harbors: [portGift.harbor] } });
      const choices = pendingState.view.hints!.modules!.seafarers!.harborChoices;
      expect(choices.harbors).toEqual([portGift.harbor]);
      expect(choices.edges.length).toBeGreaterThan(0);
      expect(pendingState.view.modules!.seafarers!.tribe!.gifts).toHaveLength(17);
      // 其他玩家看到同一個 frame，但沒有選項。
      const other = clients.find((client) => client.playerId !== actorId)!;
      const otherView = await snapshot(other, gameId);
      expect(otherView.view.pending).toMatchObject({ kind: 'seafarers.harbor', responders: [actorId] });
      expect(otherView.view.hints?.modules?.seafarers?.harborChoices).toEqual({ harbors: [], edges: [] });
      // frame 未解決前不能結束回合。
      const refused = await actor.post(`/api/games/${gameId}/commands`, {
        commandId: 'ft-end-early', expectedRevision: pendingState.revision, command: { type: 'turn.end' },
      });
      expect(refused.body.ok ? (refused.body.data as Receipt).outcome : 'error').not.toBe('accepted');

      // 中途重啟：pending 港口放置 frame 還原。
      const saved = (await local.service.repo.findGame(gameId))!.state_json;
      await local.service.close();
      restarted = await restartService(local);
      const base = `http://127.0.0.1:${restarted.port}`;
      const resumed = (client: TestClient) => Object.assign(createClient(base), { cookie: client.cookie, playerId: client.playerId });
      expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);
      const back = resumed(actor);
      const after = await snapshot(back, gameId);
      expect(after.revision).toBe(pendingState.revision);
      expect(after.view.pending).toMatchObject({ kind: 'seafarers.harbor', responders: [actorId] });
      expect(after.view.hints!.modules!.seafarers!.harborChoices).toEqual(choices);

      const placed = back.expectOk<Receipt>(await back.post(`/api/games/${gameId}/commands`, {
        commandId: 'ft-place-harbor', expectedRevision: after.revision,
        command: { type: 'harbor.place', edge: choices.edges[0]!, harbor: portGift.harbor },
      }));
      expect(placed, JSON.stringify(placed)).toMatchObject({ outcome: 'accepted' });
      const settled = await snapshot(back, gameId);
      expect(settled.view.pending).toBeNull();
      expect(settled.view.board.harbors).toEqual([{ edge: choices.edges[0], type: portGift.harbor }]);

      // 最後一分：拿 VP 標記到 13 分（test-only 準備分數與船，命令仍是合法的 build.ship）。
      const row2 = (await restarted.repo.findGame(gameId))!;
      const state2 = JSON.parse(row2.state_json) as GameState;
      const vpGift = tribeOf(state2).gifts.find((gift) => gift.kind === 'vp' && !state2.board.roads[gift.edge])!;
      const sea2 = (edge: number): boolean => topology.edges[edge]!.hexes.length === 1
        || topology.edges[edge]!.hexes.some((hex) => state2.board.layout.terrain[hex] === 'sea');
      const [a, b] = topology.edges[vpGift.edge]!.vertices as [number, number];
      const options2 = [b, a].flatMap((shared) => topology.vertices[shared]!.edges.filter((edge) => edge !== vpGift.edge && sea2(edge)
        && !topology.edges[edge]!.hexes.includes(state2.board.pirate ?? -1) && !state2.board.roads[edge]));
      const near2 = options2.find((edge) => !tribeOf(state2).gifts.some((entry) => entry.edge === edge)) ?? options2[0];
      const placedNear = near2 !== undefined;
      if (placedNear) state2.board.roads[near2] = { player: actorId, ship: true };
      expect(placedNear).toBe(true);
      const me2 = state2.players.find((player) => player.id === actorId)!;
      me2.resources = { lumber: 1, brick: 0, wool: 1, grain: 0, ore: 0 };
      me2.bonusPoints += 12 - scoreOfActor(settled, actorId)!;
      state2.windowId += 1;
      await restarted.repo.saveGame(gameId, state2, row2.revision, 'playing', null);
      const current = await snapshot(back, gameId);
      expect(scoreOfActor(current, actorId)).toBe(12);
      const win = back.expectOk<Receipt>(await back.post(`/api/games/${gameId}/commands`, {
        commandId: 'ft-vp-token', expectedRevision: current.revision, command: { type: 'build.ship', edge: vpGift.edge },
      }));
      expect(win, JSON.stringify(win)).toMatchObject({ outcome: 'accepted' });
      const final = await snapshot(back, gameId);
      expect(final.view.result).toMatchObject({ playerId: actorId, reason: 'victory' });
      expect(final.view.modules!.seafarers!.tribe!.vp[actorId]).toBe(1);
      const room = back.expectOk<{ status: string }>(await back.get(`/api/rooms/${roomId}`));
      expect(room.status).toBe('completed');
    } finally {
      if (restarted) await restarted.close();
      else await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  }, 90_000);
});
