/**
 * Explorers & Pirates through the service: rooms resolve one profile per
 * mission, games start on the mission maps with fog, bots are refused, and
 * module commands go through the same durable, idempotent receipts.
 */

import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Command, type GameState } from '@catan/rules';
import { startService } from '../src/main.ts';
import { createClient, startHarness, startedGame, type TestClient, type TestHarness } from './helpers.ts';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface EpSnapshot {
  revision: number;
  view: {
    engineVersion: string;
    victoryTarget: number;
    turn: { playerId: string; phase: string; setup: unknown };
    board: { topologyId: string };
    hints?: { modules?: { explorersPirates?: { setup: { step: string; harbor: number[] } | null } } };
    modules?: { explorersPirates?: { fog: unknown[]; setupStep: string | null; harbors: { vertex: number }[] } };
  };
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  revision: number;
}

const MISSIONS = [
  ['land-ho', 'ep-land-ho-2025', 'fixed'],
  ['pirate-lairs', 'ep-pirate-lairs-2025', 'fixed'],
  ['fish', 'ep-fish-2025', 'variable'],
  ['spices', 'ep-spices-2025', 'variable'],
  ['explorers-pirates', 'ep-full-2025', 'variable'],
] as const;

describe('Explorers & Pirates over the API', () => {
  it('resolves one profile per mission and never combines with Seafarers', async () => {
    const host = await harness.client('EpHost');
    for (const [scenario, profileId, setupMode] of MISSIONS) {
      const room = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
        visibility: 'private', capacity: 4, setupMode,
        ruleset: { expansions: ['explorersPirates'], scenario, variants: [] },
      }));
      expect(room.profileId).toBe(profileId);
    }
    const combined = await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'variable',
      ruleset: { expansions: ['explorersPirates', 'seafarers'], scenario: 'fish', variants: [] },
    });
    expect(combined.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses bot seats in every mission', async () => {
    const host = await harness.client('EpBots');
    for (const [, profileId, setupMode] of MISSIONS) {
      const room = host.expectOk<{ id: string }>(await host.post('/api/rooms', {
        visibility: 'private', capacity: 3, profileId, setupMode,
      }));
      host.expectError(await host.post(`/api/rooms/${room.id}/bots`, {}), 'E_INVALID_BOT');
    }
  });

  it('starts a variable-setup mission and accepts an idempotent harbour placement', async () => {
    const { clients, gameId } = await startedGame(harness, 3, { profileId: 'ep-fish-2025', setupMode: 'variable' });
    const first = clients[0]!.expectOk<EpSnapshot>(await clients[0]!.get(`/api/games/${gameId}`));
    expect(first.view.engineVersion).toBe('ep-2025.2');
    expect(first.view.victoryTarget).toBe(15);
    expect(first.view.modules?.explorersPirates?.fog.length).toBeGreaterThan(0);
    expect(first.view.modules?.explorersPirates?.setupStep).toBe('harbor');
    const actor = clients.find((client) => client.playerId === first.view.turn.playerId)!;
    const mine = actor.expectOk<EpSnapshot>(await actor.get(`/api/games/${gameId}`));
    const vertex = mine.view.hints!.modules!.explorersPirates!.setup!.harbor[0]!;
    const body = { commandId: 'ep-harbor', expectedRevision: mine.revision, command: { type: 'ep.setupHarbor', vertex } };
    const receipt = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(receipt.outcome).toBe('accepted');
    const again = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(again).toEqual(receipt);
    const after = actor.expectOk<EpSnapshot>(await actor.get(`/api/games/${gameId}`));
    expect(after.view.modules?.explorersPirates?.harbors.map((harbor) => harbor.vertex)).toEqual([vertex]);
  });

  it.skipIf(!!process.env.TEST_POSTGRES_URL)('keeps fog, pools and a pirate frame across a restart without drawing again', async () => {
    const local = await startHarness();
    let restarted: Awaited<ReturnType<typeof startService>> | null = null;
    try {
      const { clients, gameId } = await startedGame(local, 3, { profileId: 'ep-pirate-lairs-2025', setupMode: 'fixed' });
      // Variable placement on the printed island, through the API.
      for (let guard = 0; guard < 40; guard++) {
        const view = clients[0]!.expectOk<EpSnapshot>(await clients[0]!.get(`/api/games/${gameId}`)).view;
        if (!view.modules?.explorersPirates?.setupStep) break;
        const actor = clients.find((client) => client.playerId === view.turn.playerId)!;
        const mine = actor.expectOk<EpSnapshot & { view: { hints: { modules: { explorersPirates: { setup: { step: string; harbor: number[]; settlement: number[]; road: number[]; ship: number[] } } } } } }>(
          await actor.get(`/api/games/${gameId}`));
        const setup = mine.view.hints.modules.explorersPirates.setup;
        const command = setup.step === 'harbor' ? { type: 'ep.setupHarbor', vertex: setup.harbor[0] }
          : setup.step === 'settlement' ? { type: 'ep.setupSettlement', vertex: setup.settlement[0] }
            : setup.ship.length > 0 ? { type: 'ep.setupShip', edge: setup.ship[0] } : { type: 'ep.setupRoad', edge: setup.road[0] };
        actor.expectOk(await actor.post(`/api/games/${gameId}/commands`, { commandId: `setup-${guard}`, expectedRevision: mine.revision, command }));
      }
      // The engine rolls a 7 on the persisted state: the roller's pirate frame is pending.
      const row = (await local.service.repo.findGame(gameId))!;
      const state = JSON.parse(row.state_json) as GameState;
      expect(state.turn.phase).toBe('preroll');
      const dice = [3, 2];
      const rolled = applyCommand(state, state.players[state.turn.seat]!.id, { type: 'turn.roll' } as Command, { int: () => dice.shift()! });
      expect(rolled.ok).toBe(true);
      if (!rolled.ok) return;
      expect(rolled.state.pending?.kind).toBe('explorersPirates.pirate');
      await local.service.repo.saveGame(gameId, rolled.state, row.revision, 'playing', null);
      const saved = (await local.service.repo.findGame(gameId))!.state_json;
      const host = clients[0]!;
      const roller = clients.find((client) => client.playerId === rolled.state.players[rolled.state.turn.seat]!.id)!;
      const before = host.expectOk<EpSnapshot>(await host.get(`/api/games/${gameId}`));
      expect((before.view as unknown as { pending: { kind: string } | null }).pending?.kind).toBe('explorersPirates.pirate');
      expect(before.view.modules?.explorersPirates?.fog.length).toBeGreaterThan(0);

      await local.service.close();
      restarted = await startService({ port: 0, host: '127.0.0.1', sqlitePath: join(local.dataDir, 'test.sqlite') }, () => undefined);
      const base = `http://127.0.0.1:${restarted.port}`;
      const resumed = (client: TestClient) => Object.assign(createClient(base), { cookie: client.cookie, playerId: client.playerId });
      const after = resumed(host).expectOk<EpSnapshot>(await resumed(host).get(`/api/games/${gameId}`));
      expect(after.revision).toBe(before.revision);
      expect(after.view.modules?.explorersPirates?.fog).toEqual(before.view.modules?.explorersPirates?.fog);
      expect((after.view as unknown as { pending: unknown }).pending).toEqual((before.view as unknown as { pending: unknown }).pending);
      // Reading the restored game changed nothing in storage: no draw was repeated.
      expect((await restarted.repo.findGame(gameId))!.state_json).toBe(saved);
      expect((JSON.parse(saved) as GameState).moduleState).toEqual(rolled.state.moduleState);
      expect(rolled.state.moduleState?.explorersPirates).toBeDefined();
      // The frame resolves after the restart.
      const mine = resumed(roller).expectOk<{ revision: number; view: { hints: { modules: { explorersPirates: { pirateTargets: number[] } } } } }>(
        await resumed(roller).get(`/api/games/${gameId}`));
      const hex = mine.view.hints.modules.explorersPirates.pirateTargets[0]!;
      const receipt = resumed(roller).expectOk<Receipt>(await resumed(roller).post(`/api/games/${gameId}/commands`, {
        commandId: 'pirate-after-restart', expectedRevision: mine.revision, command: { type: 'ep.placePirate', hex },
      }));
      expect(receipt.outcome).toBe('accepted');
    } finally {
      if (restarted) await restarted.close();
      else await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  });

  // #97：未完成的 ep-2025.1 卡死存檔在重啟後以 ep-2025.2 的行為救援，不重做事件。
  it.skipIf(!!process.env.TEST_POSTGRES_URL)('rescues a persisted ep-2025.1 stranded ship across restarts (#97)', async () => {
    const local = await startHarness();
    const sqlitePath = join(local.dataDir, 'test.sqlite');
    let running: Awaited<ReturnType<typeof startService>> | null = null;
    try {
      const { clients, gameId } = await startedGame(local, 3, { profileId: 'ep-land-ho-2025', setupMode: 'fixed' });
      // 以固定骰點擲骰（5，無 7 的棄牌），直接寫回存檔。
      const row = (await local.service.repo.findGame(gameId))!;
      const state = JSON.parse(row.state_json) as GameState;
      expect(state.turn.phase).toBe('preroll');
      const dice = [3, 2];
      const rolled = applyCommand(state, state.players[state.turn.seat]!.id, { type: 'turn.roll' } as Command, { int: () => dice.shift()! });
      expect(rolled.ok).toBe(true);
      if (!rolled.ok) return;
      await local.service.repo.saveGame(gameId, rolled.state, row.revision, 'playing', null);
      const actorId = rolled.state.players[rolled.state.turn.seat]!.id;
      const actor = clients.find((client) => client.playerId === actorId)!;
      const movementRequest = { commandId: 'strand-movement', expectedRevision: row.revision, command: { type: 'ep.startMovement' } };
      const movement = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, movementRequest));
      expect(movement.outcome).toBe('accepted');

      // 卡死局：作用中的船在滿格邊、剩 1 MP；每條邊都另有兩艘船，沒有羊毛也沒有 settler。
      const moving = (await local.service.repo.findGame(gameId))!;
      const stuck = JSON.parse(moving.state_json) as GameState;
      const slot = stuck.moduleState!.explorersPirates as {
        ships: { id: string; player: string; edge: number; cargo: string[] }[];
        turn: { active: string | null; ships: Record<string, unknown> };
      };
      const ship = { ...slot.ships.find((entry) => entry.player === actorId)!, cargo: [] };
      const others = stuck.players.map((player) => player.id).filter((id) => id !== actorId);
      const edges = stuck.board.roads.length;
      slot.ships = [ship, ...Array.from({ length: edges * 2 }, (_, index) => ({
        id: `blocker-${index}`, player: others[index % others.length]!, edge: Math.floor(index / 2), cargo: [],
      }))];
      slot.turn.active = ship.id;
      slot.turn.ships = { [ship.id]: { used: 3, extra: false, done: false, tribute: false, chased: false } };
      const player = stuck.players.find((entry) => entry.id === actorId)!;
      stuck.bank.wool += player.resources.wool;
      player.resources.wool = 0;
      stuck.engineVersion = 'ep-2025.1';
      await local.service.repo.saveGame(gameId, stuck, moving.revision, 'playing', null);
      await local.service.repo.db.run('UPDATE games SET engine_version = ? WHERE id = ?', ['ep-2025.1', gameId]);
      const saved = (await local.service.repo.findGame(gameId))!.state_json;
      await local.service.close();

      running = await startService({ port: 0, host: '127.0.0.1', sqlitePath }, () => undefined);
      let base = `http://127.0.0.1:${running.port}`;
      const resumed = () => Object.assign(createClient(base), { cookie: actor.cookie, playerId: actor.playerId });
      type StrandView = EpSnapshot & {
        view: { seq: number; hints: { canEndTurn: boolean; modules: { explorersPirates: { stranded: boolean } } } };
      };
      const before = resumed().expectOk<StrandView>(await resumed().get(`/api/games/${gameId}`));
      expect(before.revision).toBe(moving.revision);
      expect(before.view.engineVersion).toBe('ep-2025.1');
      expect(before.view.hints.canEndTurn).toBe(true);
      expect(before.view.hints.modules.explorersPirates.stranded).toBe(false);
      // 讀取不改動儲存；舊 receipt 原樣重播。
      expect((await running.repo.findGame(gameId))!.state_json).toBe(saved);
      expect(resumed().expectOk<Receipt>(await resumed().post(`/api/games/${gameId}/commands`, movementRequest))).toEqual(movement);

      const endRequest = { commandId: 'strand-rescue', expectedRevision: before.revision, command: { type: 'turn.end' } };
      const ended = resumed().expectOk<Receipt>(await resumed().post(`/api/games/${gameId}/commands`, endRequest));
      expect(ended.outcome).toBe('accepted');
      expect(ended.revision).toBe(before.revision + 1);
      const rescued = (await running.repo.findGame(gameId))!;
      const after = JSON.parse(rescued.state_json) as GameState;
      expect(after.engineVersion).toBe('ep-2025.1');
      expect(after.turn.seat).not.toBe(stuck.turn.seat);
      const afterSlot = after.moduleState!.explorersPirates as typeof slot;
      expect(afterSlot.ships.filter((entry) => entry.edge === ship.edge)).toHaveLength(3);
      const events = await running.repo.listEvents(gameId, 0, 10_000);
      const view = resumed().expectOk<StrandView>(await resumed().get(`/api/games/${gameId}`));
      await running.close();
      running = null;

      // 再次重啟：版本、事件與 receipt 不變，救援不會重做。
      running = await startService({ port: 0, host: '127.0.0.1', sqlitePath }, () => undefined);
      base = `http://127.0.0.1:${running.port}`;
      const again = resumed().expectOk<StrandView>(await resumed().get(`/api/games/${gameId}`));
      expect(again.revision).toBe(ended.revision);
      expect(again.view.seq).toBe(view.view.seq);
      expect(resumed().expectOk<Receipt>(await resumed().post(`/api/games/${gameId}/commands`, endRequest))).toEqual(ended);
      expect((await running.repo.findGame(gameId))!.state_json).toBe(rescued.state_json);
      expect(await running.repo.listEvents(gameId, 0, 10_000)).toEqual(events);
    } finally {
      if (running) await running.close();
      else await local.service.close().catch(() => undefined);
      rmSync(local.dataDir, { recursive: true, force: true });
    }
  });
});

