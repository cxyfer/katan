/**
 * The Pirate Islands（S7）經由服務：房間建立（只有 3、4 人，bot 座位被拒）、開局（49 格圖、預置、4 個堡壘各 3 枚 lair）、
 * 中途重啟後還原待答的 `pirateGift` 與 `sevenSteal`（S7b 延後到這裡的項目），以及一局從船線到收復堡壘、10 分獲勝。
 */

import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actionHints, applyCommand, getTopology, projectGame, seededRng, type Command, type GameState } from '@katan/rules';
import {
  createClient,
  restartService,
  runSetupOverApi,
  startHarness,
  startedGame,
  type TestClient,
  type TestHarness,
} from './helpers.ts';

const PROFILE = 'sf-pirate-islands-2025';
let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface PiView {
  fortresses: { player: string; vertex: number; lairs: number }[];
  beachheads: { player: string; vertex: number }[];
  lines: Record<string, { start: number | null; edges: number[]; end: number | null; next: string }>;
  route: number[];
  warships: Record<string, number[]>;
}

interface Snapshot {
  revision: number;
  view: {
    engineVersion: string;
    victoryTarget: number;
    result: { playerId: string | null; reason: string; playerIds?: string[]; cause?: string } | null;
    turn: { playerId: string; phase: string };
    pending: { kind: string; responders: string[] } | null;
    board: { topologyId: string; pirate: number | null; robber: number; harbors: unknown[] };
    modules?: { seafarers?: { pirateIslands?: PiView } };
  };
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  error?: { code?: string };
  revision: number;
}

const snapshot = async (client: TestClient, gameId: string): Promise<Snapshot> => client.expectOk<Snapshot>(await client.get(`/api/games/${gameId}`));

describe('The Pirate Islands over the API', () => {
  it('is listed as enabled and selectable for 3–4 players, without bot seats', async () => {
    const host = await harness.client('PiLister');
    const data = host.expectOk<{
      profiles: { id: string; enabled: boolean; botSeats: boolean; playerCounts: number[] }[];
      selectable: string[];
    }>(await host.get('/api/profiles'));
    expect(data.profiles.find((profile) => profile.id === PROFILE)).toMatchObject({ enabled: true, botSeats: false, playerCounts: [3, 4] });
    expect(data.selectable).toContain(PROFILE);
  });

  it('resolves the ruleset by parts for 3 and 4 players and rejects 5 and 6', async () => {
    const host = await harness.client('PiHost');
    for (const capacity of [3, 4]) {
      const room = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'fixed',
        ruleset: { expansions: ['seafarers'], scenario: 'pirate-islands', variants: [] },
      }));
      expect(room.profileId).toBe(PROFILE);
    }
    for (const capacity of [5, 6]) {
      const response = await host.post('/api/rooms', {
        visibility: 'private', capacity, setupMode: 'fixed',
        ruleset: { expansions: ['seafarers'], scenario: 'pirate-islands' },
      });
      host.expectError(response, 'E_UNSUPPORTED_COMBINATION');
      expect(response.body.ok ? null : response.body.error.params).toMatchObject({ reason: 'bad-player-count' });
    }
  });

  it('refuses a bot seat with reason profile', async () => {
    const host = await harness.client('PiBotHost');
    const room = host.expectOk<{ id: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'fixed', profileId: PROFILE,
    }));
    const refused = await host.post(`/api/rooms/${room.id}/bots`, { level: 'standard' });
    host.expectError(refused, 'E_INVALID_BOT');
    expect(refused.body.ok ? null : refused.body.error.params).toMatchObject({ reason: 'profile' });
  });

  it('starts 3 and 4 players on the one 49-hex map with the preset fortresses, beachheads and the pirate on its route', async () => {
    for (const count of [3, 4] as const) {
      const { clients, gameId } = await startedGame(harness, count, { profileId: PROFILE });
      const state = await snapshot(clients[0]!, gameId);
      expect(state.view.board.topologyId).toBe('sf-pirate-islands');
      expect(getTopology('sf-pirate-islands').hexes).toHaveLength(49);
      expect(state.view.engineVersion).toBe('sf-2025.3');
      expect(state.view.victoryTarget).toBe(10);
      expect(state.view.board.robber).toBe(-1);
      expect(state.view.board.harbors).toHaveLength(8);
      const pi = state.view.modules!.seafarers!.pirateIslands!;
      expect(pi.fortresses).toHaveLength(count);
      expect(pi.fortresses.every((fortress) => fortress.lairs === 3)).toBe(true);
      expect(pi.beachheads).toHaveLength(count);
      expect(pi.route).toHaveLength(14);
      expect(state.view.board.pirate).toBe(pi.route[0]);
      expect(Object.values(pi.warships).every((edges) => edges.length === 0)).toBe(true);
      for (const client of clients) expect((await snapshot(client, gameId)).view.modules!.seafarers!.pirateIslands).toEqual(pi);
    }
  });
});

const piOf = (state: GameState, viewer: string): PiView => (projectGame(state, viewer, {}).modules as unknown as { seafarers: { pirateIslands: PiView } }).seafarers.pirateIslands;

/** 直接以規則引擎推進（測試準備）：把行動者的船線建到堡壘（每步取第一個真的延伸了船線的合法船位）。 */
function buildLine(state: GameState, actorId: string): GameState {
  let current = state;
  const rng = seededRng(99);
  const lineOf = (s: GameState) => piOf(s, actorId).lines[actorId]!;
  for (let guard = 0; guard < 20 && lineOf(current).next !== 'done'; guard++) {
    current.players.find((player) => player.id === actorId)!.resources = { lumber: 5, brick: 5, wool: 5, grain: 5, ore: 5 };
    const before = lineOf(current).edges.length;
    const hints = actionHints(current, actorId).modules!.seafarers as { legalShips: number[] };
    const end = lineOf(current).end;
    const topology = getTopology('sf-pirate-islands');
    let moved = false;
    for (const edge of hints.legalShips) {
      if (end !== null && !topology.edges[edge]!.vertices.includes(end)) continue;
      const outcome = applyCommand(current, actorId, { type: 'build.ship', edge } as unknown as Command, rng);
      if (outcome.ok && lineOf(outcome.state).edges.length === before + 1) {
        current = outcome.state;
        moved = true;
        break;
      }
    }
    if (!moved) throw new Error('line cannot be extended');
  }
  return current;
}

describe('The Pirate Islands: restarts with a pending answer and a whole game', () => {
  async function withService<T>(run: (local: TestHarness) => Promise<T>): Promise<T> {
    const local = await startHarness();
    try {
      return await run(local);
    } finally {
      await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  }

  async function prepared(local: TestHarness) {
    const { clients, gameId, roomId } = await startedGame(local, 4, { profileId: PROFILE });
    await runSetupOverApi(clients, gameId);
    const row = (await local.service.repo.findGame(gameId))!;
    return { clients, gameId, roomId, row, state: JSON.parse(row.state_json) as GameState };
  }

  const send = async (client: TestClient, gameId: string, id: string, revision: number, command: Record<string, unknown>) =>
    client.expectOk<Receipt>(await client.post(`/api/games/${gameId}/commands`, { commandId: id, expectedRevision: revision, command }));

  it('restores a pending pirateGift (the continuation included) and resumes the roll when answered', async () => {
    await withService(async (local) => {
      const { clients, gameId, row, state } = await prepared(local);
      const topology = getTopology('sf-pirate-islands');
      const pi = (state.moduleState as unknown as { seafarers: { pirateIslands: { route: number[]; warships: Record<string, number[]> } } }).seafarers.pirateIslands;
      // 航道第 9 格旁有預置的村落；海盜從第 7 格走 2 步（骰 2 與 2）到那裡，村落的主人有 3 艘戰船 → 他贏了，要選牌。
      const victimHex = pi.route[9]!;
      const owner = state.board.buildings.find((building, vertex) => !!building && topology.vertices[vertex]!.hexes.includes(victimHex))!.player;
      pi.warships[owner] = [1000, 1001, 1002];
      state.board.pirate = pi.route[7]!;
      state.turn.phase = 'preroll';
      const rolled = applyCommand(state, state.players[state.turn.seat]!.id, { type: 'turn.roll' }, { int: (() => { const values = [1, 1]; let i = 0; return () => values[i++]!; })() } as never);
      expect(rolled.ok).toBe(true);
      const after = (rolled as { state: GameState }).state;
      expect(after.pending?.kind).toBe('seafarers.pirateGift');
      await local.service.repo.saveGame(gameId, after, row.revision, 'playing', null);

      const before = await snapshot(clients[0]!, gameId);
      expect(before.view.pending).toMatchObject({ kind: 'seafarers.pirateGift', responders: [owner] });
      const saved = (await local.service.repo.findGame(gameId))!.state_json;
      await local.service.close();
      const restarted = await restartService(local);
      try {
        expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);
        const resumed = (client: TestClient) => Object.assign(createClient(`http://127.0.0.1:${restarted.port}`), { cookie: client.cookie, playerId: client.playerId });
        const winner = resumed(clients.find((client) => client.playerId === owner)!);
        const back = await snapshot(winner, gameId);
        expect(back.view.pending).toMatchObject({ kind: 'seafarers.pirateGift', responders: [owner] });
        const receipt = await send(winner, gameId, 'pi-gift', back.revision, { type: 'pirate.gift', resource: 'grain' });
        expect(receipt).toMatchObject({ outcome: 'accepted' });
        const done = await snapshot(winner, gameId);
        expect(done.view.pending).toBeNull();
        expect(done.view.turn.phase).toBe('action');
        const stored = JSON.parse((await restarted.repo.findGame(gameId))!.state_json) as GameState;
        const types = stored.log.map((event) => event.type);
        expect(types.filter((type) => type === 'pirate.cruised')).toHaveLength(1);
        expect(types).toContain('pirate.gifted');
      } finally {
        await restarted.close();
      }
    });
  }, 90_000);

  it('restores a pending sevenSteal and the steal still works after the restart', async () => {
    await withService(async (local) => {
      const { clients, gameId, row, state } = await prepared(local);
      const pi = (state.moduleState as unknown as { seafarers: { pirateIslands: { route: number[] } } }).seafarers.pirateIslands;
      // 擲 7（3 與 4）：海盜從第 0 格走 3 步到第 3 格（旁邊只有空的 beachhead，沒有攻擊）；沒有人超過 7 張，擲骰者可偷。
      state.board.pirate = pi.route[0]!;
      state.turn.phase = 'preroll';
      const roller = state.players[state.turn.seat]!.id;
      const rolled = applyCommand(state, roller, { type: 'turn.roll' }, { int: (() => { const values = [2, 3]; let i = 0; return () => values[i++]!; })() } as never);
      expect(rolled.ok).toBe(true);
      const after = (rolled as { state: GameState }).state;
      expect(after.pending?.kind).toBe('seafarers.sevenSteal');
      await local.service.repo.saveGame(gameId, after, row.revision, 'playing', null);
      const saved = (await local.service.repo.findGame(gameId))!.state_json;
      await local.service.close();
      const restarted = await restartService(local);
      try {
        expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);
        const resumed = (client: TestClient) => Object.assign(createClient(`http://127.0.0.1:${restarted.port}`), { cookie: client.cookie, playerId: client.playerId });
        const actor = resumed(clients.find((client) => client.playerId === roller)!);
        const back = await snapshot(actor, gameId);
        expect(back.view.pending).toMatchObject({ kind: 'seafarers.sevenSteal', responders: [roller] });
        // 其他人不能代答。
        const other = resumed(clients.find((client) => client.playerId !== roller)!);
        const refused = await other.post(`/api/games/${gameId}/commands`, { commandId: 'pi-other', expectedRevision: back.revision, command: { type: 'seven.steal', victim: null } });
        expect(refused.body.ok ? (refused.body.data as Receipt).outcome : 'error').not.toBe('accepted');
        const victim = (actionHints(after, roller).modules!.seafarers as { sevenSteal: string[] }).sevenSteal[0]!;
        const receipt = await send(actor, gameId, 'pi-steal', back.revision, { type: 'seven.steal', victim });
        expect(receipt).toMatchObject({ outcome: 'accepted' });
        expect((await snapshot(actor, gameId)).view.pending).toBeNull();
        const stored = JSON.parse((await restarted.repo.findGame(gameId))!.state_json) as GameState;
        expect(stored.log.map((event) => event.type)).toContain('seven.stole');
      } finally {
        await restarted.close();
      }
    });
  }, 90_000);

  it('plays a whole game: line, warships, the end-of-turn attack, the recapture and the 10-point win', async () => {
    await withService(async (local) => {
      const { clients, gameId, roomId, row, state } = await prepared(local);
      const actorId = state.players[state.turn.seat]!.id;
      state.turn.phase = 'action';
      state.turn.dice = [3, 4];
      state.board.pirate = null;
      let current = buildLine(state, actorId);
      const view = piOf(current, actorId);
      const line = view.lines[actorId]!;
      expect(line.next).toBe('done');
      // 9 艘戰船：戰力 9 比任何骰值都大，一次進攻必勝；堡壘只剩 1 枚 lair；10 分靠分數牌。
      const slot = (current.moduleState as unknown as { seafarers: { pirateIslands: { warships: Record<string, number[]>; fortresses: { player: string; lairs: number }[]; route: number[] } } }).seafarers.pirateIslands;
      slot.warships[actorId] = line.edges.slice();
      slot.fortresses.find((fortress) => fortress.player === actorId)!.lairs = 1;
      current.board.pirate = slot.route[0]!;
      const player = current.players.find((candidate) => candidate.id === actorId)!;
      for (let i = 0; i < 6; i++) player.devCards.push('victoryPoint');
      current.turn.phase = 'action';
      await local.service.repo.saveGame(gameId, current, row.revision, 'playing', null);

      const actor = clients.find((client) => client.playerId === actorId)!;
      const ready = await snapshot(actor, gameId);
      expect(ready.view.result).toBeNull();
      const receipt = await send(actor, gameId, 'pi-end', ready.revision, { type: 'turn.end' });
      expect(receipt, JSON.stringify(receipt)).toMatchObject({ outcome: 'accepted' });
      for (const client of clients) {
        const finished = (await snapshot(client, gameId)).view;
        expect(finished.result).toMatchObject({ reason: 'victory', playerId: actorId, playerIds: [actorId], cause: 'fortressRecaptured' });
        expect(finished.turn.phase).toBe('gameOver');
        const pi = finished.modules!.seafarers!.pirateIslands!;
        expect(pi.fortresses.find((fortress) => fortress.player === actorId)!.lairs).toBe(0);
      }
      const stored = JSON.parse((await local.service.repo.findGame(gameId))!.state_json) as GameState;
      const types = stored.log.map((event) => event.type);
      expect(types).toEqual(expect.arrayContaining(['fortress.attacked', 'fortress.recaptured', 'game.finished']));
      expect(stored.log.find((event) => event.type === 'game.finished')!.params).toMatchObject({ playerIds: [actorId], cause: 'fortressRecaptured' });
      const room = actor.expectOk<{ status: string }>(await actor.get(`/api/rooms/${roomId}`));
      expect(room.status).toBe('completed');
    });
  }, 90_000);
});
