/** T&B 私密結果經 receipt、HTTP、WS 與事件歷史的逐座位驗證。 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import * as rules from '@catan/rules';
import type { CommandReceipt, GameSnapshot, ServerMessage } from '@catan/protocol';
import { runSetupOverApi, startHarness, startedGame, type TestClient, type TestHarness } from './helpers.ts';

let harness: TestHarness;
beforeAll(async () => { harness = await startHarness(); });
afterAll(async () => { await harness.close(); });

async function subscribe(client: TestClient, roomId: string) {
  const socket = new WebSocket(`${harness.base.replace('http', 'ws')}/ws`, { headers: { cookie: client.cookie! } });
  const snapshots: GameSnapshot[] = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    if (message.type === 'snapshot') snapshots.push(message.payload);
  });
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'subscribe', payload: { roomId } }));
  await vi.waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
  return { socket, snapshots };
}

describe('T&B service privacy', () => {
  it.each(['draw', 'steal', 'devCard', 'swap'] as const)('%s projects first/replayed receipts and each seat’s delivery', async (kind) => {
    const { clients, roomId, gameId } = await startedGame(harness, 3, { profileId: 'tb-fishing-2025', setupMode: 'variable' });
    await runSetupOverApi(clients, gameId);
    const row = (await harness.service.repo.findGame(gameId))!;
    const state = JSON.parse(row.state_json) as rules.GameState;
    const actor = clients.find((client) => client.playerId === state.players[state.turn.seat]!.id)!;
    const other = clients.find((client) => client !== actor)!;
    const fish = rules.moduleStateOf<Record<string, {
      hands: Record<string, number[]>; lake: number; supply: { fish: number[]; boot: number };
    }>>(state, 'tradersBarbarians')!['tb-fishing']!;
    state.turn.phase = kind === 'draw' ? 'preroll' : 'action';
    state.board.buildings.fill(null);
    state.board.robber = -1;
    for (const player of state.players) {
      fish.hands[player.id] = [];
      player.resources = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    }
    fish.supply = { fish: [0, 0, 8], boot: 0 };
    fish.hands[actor.playerId!] = kind === 'devCard' ? [3, 3, 1] : kind === 'swap' ? [1, 1, 1, 1, 1, 1, 1] : [3];
    state.players.find((player) => player.id === other.playerId)!.resources.ore = 1;
    state.devDeck = ['monopoly'];
    if (kind === 'draw') {
      const vertex = rules.topologyOf(state).vertices.findIndex((vertex) => vertex.hexes.includes(fish.lake));
      state.board.buildings[vertex] = { player: other.playerId!, city: false };
    }
    if (kind === 'swap') state.pending = {
      kind: 'tradersBarbarians.fishSwap', module: 'tradersBarbarians', responders: [actor.playerId!], data: { queue: [] },
    };
    await harness.service.repo.saveGame(gameId, state, row.revision, 'playing', null);
    const feeds = await Promise.all(clients.map((client) => subscribe(client, roomId)));
    const command = kind === 'draw' ? { type: 'turn.roll' }
      : kind === 'swap' ? { type: 'tb.fishSwap', token: 1 }
        : { type: 'tb.spendFish', action: kind, tokens: kind === 'devCard' ? [3, 3, 1] : [3], ...(kind === 'steal' ? { victim: other.playerId } : {}) };
    const body = { commandId: `tb-private-${kind}`, expectedRevision: row.revision, command };
    const dice = [0, 1]; // 湖泊在 3 生產，抽魚再取供應堆第一項。
    const rng = vi.spyOn(rules, 'secureRng').mockReturnValue({ int: () => dice.shift() ?? 0 });
    const type = kind === 'draw' ? 'tb.fishDrawn' : kind === 'steal' ? 'tb.fishStole' : kind === 'swap' ? 'tb.fishSwapped' : 'tb.fishDevCard';
    const secret = kind === 'draw' ? { tokens: [3] } : kind === 'steal' ? { resource: 'ore' } : kind === 'swap' ? { drawn: 3 } : { card: 'monopoly' };
    const maySee = (client: TestClient) => kind === 'draw' ? client === other : client === actor || (kind === 'steal' && client === other);
    try {
      const first = actor.expectOk<CommandReceipt>(await actor.post(`/api/games/${gameId}/commands`, body));
      expect(first.outcome).toBe('accepted');
      const replay = actor.expectOk<CommandReceipt>(await actor.post(`/api/games/${gameId}/commands`, body));
      expect(replay).toEqual(first);
      for (const client of clients) {
        const feed = feeds[clients.indexOf(client)]!;
        await vi.waitFor(() => expect(feed.snapshots.at(-1)?.revision).toBe(first.revision));
        const http = client.expectOk<GameSnapshot>(await client.get(`/api/games/${gameId}`));
        const batches = [http.view.events, feed.snapshots.at(-1)!.view.events];
        if (client === actor) batches.push(first.events, replay.events);
        for (const batch of batches) {
          expect(batch.every((event) => event.private === undefined)).toBe(true);
          const event = batch.find((event) => event.type === type && event.seq > state.seq)!;
          expect(event).toBeDefined();
          if (maySee(client)) expect(event.params).toMatchObject(secret);
          else for (const key of Object.keys(secret)) expect(event.params).not.toHaveProperty(key);
        }
        for (const snapshot of [http, feed.snapshots.at(-1)!]) {
          const ownFish = (snapshot.view.modules!.tradersBarbarians as Record<string, Record<string, unknown>>)['tb-fishing']!;
          expect(ownFish).not.toHaveProperty('hands');
          for (const player of snapshot.view.players) {
            if (player.id !== client.playerId) {
              expect(player.resources).toBeUndefined();
              expect(player.devCards).toBeUndefined();
            }
          }
        }
        const history = client.expectOk<{ events: CommandReceipt['events'] }>(await client.get(`/api/games/${gameId}/events?after=${state.seq}`));
        expect(history.events.every((event) => event.private === undefined)).toBe(true);
        // 歷史與快照相同：每個座位都看得到事件，祕密欄位只給收件人。
        const events = history.events.filter((event) => event.type === type);
        expect(events).toHaveLength(1);
        if (maySee(client)) expect(events[0]!.params).toMatchObject(secret);
        else for (const key of Object.keys(secret)) expect(events[0]!.params).not.toHaveProperty(key);
      }
    } finally {
      rng.mockRestore();
      for (const feed of feeds) feed.socket.close();
    }
  });
});
