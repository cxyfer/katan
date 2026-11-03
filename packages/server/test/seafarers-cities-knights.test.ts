/**
 * Seafarers + Cities & Knights through the service: both New Shores combined
 * profiles are offered in the lobby and resolved from their parts, bot seats
 * are refused, the combination layer's commands keep durable, idempotent
 * receipts, and progress hands stay private.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { topologyOf, type GameState } from '@catan/rules';
import type { CommandReceipt, GameSnapshot, ServerMessage } from '@catan/protocol';
import { startHarness, runSetupOverApi, type TestClient, type TestHarness } from './helpers.ts';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface CombinedView {
  revision: number;
  view: {
    engineVersion: string;
    victoryTarget: number;
    turn: { playerId: string; phase: string };
    board: { robber: number; pirate: number | null };
    players: { id: string; progressCards?: string[] }[];
    modules?: { seafarersCitiesKnights?: { pirateActive: boolean }; citiesKnights?: { robberActive: boolean }; seafarers?: object };
    hints?: { modules?: { seafarersCitiesKnights?: { pirateChase: number[]; bandit: string | null } } };
  };
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  revision: number;
  error?: { messageId: string };
}

async function snapshot(client: TestClient, gameId: string): Promise<CombinedView> {
  return client.expectOk<CombinedView>(await client.get(`/api/games/${gameId}`));
}

describe('Seafarers + Cities & Knights over the API', () => {
  it.each(['brick', 'cloth'] as const)('keeps a pirate-stolen %s private in receipts, HTTP/WS snapshots and event history', async (card) => {
    const clients = await Promise.all([1, 2, 3].map((index) => harness.client(`PiratePrivacy${index}`)));
    const host = clients[0]!;
    const room = host.expectOk<{ id: string; code: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 3, profileId: 'sf-ck-new-shores-2025', setupMode: 'fixed',
    }));
    for (const client of clients.slice(1)) client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
    for (const client of clients) client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
    await runSetupOverApi(clients, gameId);
    const row = (await harness.service.repo.findGame(gameId))!;
    const state = JSON.parse(row.state_json) as GameState;
    state.turn.phase = 'action';
    const actor = clients.find((client) => client.playerId === state.players[state.turn.seat]!.id)!;
    const victim = clients.find((client) => client !== actor)!;
    const bystander = clients.find((client) => client !== actor && client !== victim)!;
    (state.moduleState!.citiesKnights as { attacks: number }).attacks = 1;
    state.board.roads.fill(null);
    state.board.buildings.fill(null);
    const sea = state.board.layout.terrain.findIndex((terrain) => terrain === 'sea');
    const edge = topologyOf(state).edges.findIndex((edge) => edge.hexes.includes(sea));
    state.board.roads[edge] = { player: victim.playerId!, ship: true };
    for (const player of state.players) {
      for (const resource of Object.keys(player.resources) as (keyof typeof player.resources)[]) {
        state.bank[resource] += player.resources[resource];
        player.resources[resource] = 0;
      }
    }
    const hand = state.players.find((player) => player.id === victim.playerId)!;
    if (card === 'brick') { hand.resources.brick = 1; state.bank.brick -= 1; }
    else { hand.commodities.cloth = 1; state.commodityBank.cloth -= 1; }
    state.pending = { kind: 'moveRobber', actor: actor.playerId!, cause: 'seven', pirate: false };
    await harness.service.repo.saveGame(gameId, state, row.revision, 'playing', null);

    const feeds: { client: TestClient; socket: WebSocket; messages: ServerMessage[] }[] = [];
    try {
      for (const client of clients) {
        const socket = new WebSocket(`${harness.base.replace('http', 'ws')}/ws`, { headers: { cookie: client.cookie! } });
        const messages: ServerMessage[] = [];
        feeds.push({ client, socket, messages });
        socket.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
        await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
        socket.send(JSON.stringify({ type: 'subscribe', payload: { roomId: room.id } }));
        await vi.waitFor(() => expect(messages.some((message) => message.type === 'snapshot')).toBe(true));
      }
      const moved = actor.expectOk<CommandReceipt>(await actor.post(`/api/games/${gameId}/commands`, {
        commandId: `pirate-move-${card}`, expectedRevision: row.revision, command: { type: 'pending.moveRobber', hex: sea },
      }));
      expect(moved.outcome).toBe('accepted');
      const body = { commandId: `pirate-steal-${card}`, expectedRevision: moved.revision, command: { type: 'pending.steal', victim: victim.playerId } };
      const receipt = actor.expectOk<CommandReceipt>(await actor.post(`/api/games/${gameId}/commands`, body));
      expect(receipt.outcome).toBe('accepted');
      expect(actor.expectOk<CommandReceipt>(await actor.post(`/api/games/${gameId}/commands`, body))).toEqual(receipt);
      expect(receipt.events.find((event) => event.type === 'robber.stole')!.params).toMatchObject({ resource: card, pirate: true });
      expect(receipt.events.every((event) => event.private === undefined)).toBe(true);

      for (const feed of feeds) {
        await vi.waitFor(() => expect(feed.messages.some((message) => message.type === 'snapshot' && message.payload.revision === receipt.revision)).toBe(true));
        const http = feed.client.expectOk<GameSnapshot>(await feed.client.get(`/api/games/${gameId}`));
        const ws = feed.messages.findLast((message) => message.type === 'snapshot') as Extract<ServerMessage, { type: 'snapshot' }>;
        const events = feed.client.expectOk<{ events: CommandReceipt['events'] }>(await feed.client.get(`/api/games/${gameId}/events?after=0`));
        const batches = [http.view.events, ws.payload.view.events];
        if (feed.client === actor) batches.push(receipt.events);
        for (const batch of batches) {
          expect(batch.every((event) => event.private === undefined)).toBe(true);
          const thefts = batch.filter((event) => event.type === 'robber.stole');
          expect(thefts).toHaveLength(1);
          expect(thefts[0]!.params).toMatchObject({ playerId: actor.playerId, victim: victim.playerId, pirate: true });
          if (feed.client === bystander) {
            expect(thefts[0]!.params).not.toHaveProperty('resource');
          } else {
            expect(thefts[0]!.params).toMatchObject({ resource: card });
          }
        }
        // events 路由會省略非收件人的 private event；snapshot 保留遮蔽後的公開事件。
        expect(events.events.every((event) => event.private === undefined)).toBe(true);
        const historyThefts = events.events.filter((event) => event.type === 'robber.stole');
        expect(historyThefts).toHaveLength(feed.client === bystander ? 0 : 1);
        if (feed.client !== bystander) expect(historyThefts[0]!.params).toMatchObject({ resource: card });
        for (const snapshot of [http, ws.payload]) {
          for (const player of snapshot.view.players) {
            if (player.id === feed.client.playerId) continue;
            expect(player.resources).toBeUndefined();
            expect(player.commodities).toBeUndefined();
          }
        }
      }
      // 重新從 durable state 取回；重送相同 commandId 未再轉移第二張牌。
      const persisted = JSON.parse((await harness.service.repo.findGame(gameId))!.state_json) as GameState;
      const winner = persisted.players.find((player) => player.id === actor.playerId)!;
      const loser = persisted.players.find((player) => player.id === victim.playerId)!;
      expect(card === 'brick' ? winner.resources.brick : winner.commodities.cloth).toBe(1);
      expect(card === 'brick' ? loser.resources.brick : loser.commodities.cloth).toBe(0);
    } finally {
      for (const feed of feeds) feed.socket.close();
    }
  });

  it('offers both combined profiles, resolves them from their parts and refuses bot seats', async () => {
    const host = await harness.client('SfCkLobby');
    const { profiles, selectable } = host.expectOk<{ profiles: { id: string; botSeats: boolean }[]; selectable: string[] }>(await host.get('/api/profiles'));
    expect(selectable).toEqual(expect.arrayContaining(['sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025']));
    expect(profiles.filter((profile) => profile.id.startsWith('sf-ck-')).map((profile) => profile.botSeats)).toEqual([false, false]);
    const room = host.expectOk<{ id: string; profileId: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 3, setupMode: 'fixed', ruleset: { expansions: ['citiesKnights', 'seafarers'], scenario: 'new-shores' },
    }));
    expect(room.profileId).toBe('sf-ck-new-shores-2025');
    const paired = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 6, setupMode: 'variable', ruleset: { expansions: ['seafarers', 'citiesKnights'], scenario: 'new-shores' },
    }));
    expect(paired.profileId).toBe('sf-ck-new-shores-paired-2025');
    host.expectError(await host.post(`/api/rooms/${room.id}/bots`, {}), 'E_INVALID_BOT');
  });

  it('starts a combined game with both bandits waiting, keeps receipts idempotent and hands private', async () => {
    const clients: TestClient[] = [];
    for (let i = 0; i < 3; i++) clients.push(await harness.client(`SfCk${i + 1}`));
    const host = clients[0]!;
    const room = host.expectOk(await host.post<{ id: string; code: string }>('/api/rooms', {
      visibility: 'private', capacity: 3, profileId: 'sf-ck-new-shores-2025', setupMode: 'fixed',
    }));
    for (const client of clients.slice(1)) client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
    for (const client of clients) client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    const { gameId } = host.expectOk(await host.post<{ gameId: string }>(`/api/rooms/${room.id}/start`));

    const first = await snapshot(host, gameId);
    expect(first.view.engineVersion).toBe('sf-ck-2025.1');
    expect(first.view.victoryTarget).toBe(16);
    expect(first.view.board).toMatchObject({ robber: -1, pirate: null });
    expect(first.view.modules?.seafarersCitiesKnights).toEqual({ pirateActive: false });
    expect(first.view.modules?.citiesKnights?.robberActive).toBe(false);
    expect(first.view.modules?.seafarers).toBeDefined();

    const setup = await runSetupOverApi(clients, gameId);
    expect(setup.view.turn.phase).toBe('preroll');
    const actor = clients.find((client) => client.playerId === setup.view.turn.playerId)!;
    const body = { commandId: 'sfck-roll', expectedRevision: setup.revision, command: { type: 'turn.roll' } };
    const rolled = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(rolled.outcome).toBe('accepted');
    const again = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(again.revision).toBe(rolled.revision);

    // The pirate cannot be chased before the first attack; the rejection is catalogued and durable.
    const after = await snapshot(actor, gameId);
    const chase = { commandId: 'sfck-chase', expectedRevision: after.revision, command: { type: 'knight.chasePirate', vertex: 0 } };
    const refused = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, chase));
    expect(refused.outcome).toBe('rejected');
    expect(refused.error?.messageId).toMatch(/^error\.E_/);
    const refusedAgain = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, chase));
    expect(refusedAgain).toEqual(refused);

    const other = clients.find((client) => client !== actor)!;
    const theirs = await snapshot(other, gameId);
    for (const player of theirs.view.players) {
      if (player.id !== other.playerId) expect(player.progressCards).toBeUndefined();
    }
  });
});
