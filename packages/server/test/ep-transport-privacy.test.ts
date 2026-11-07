import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { GameState } from '@catan/rules';
import type { CommandReceipt, GameSnapshot, ServerMessage } from '@catan/protocol';
import { startHarness, startedGame, type TestClient, type TestHarness } from './helpers.ts';

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

describe('E&P transport privacy', () => {
  it('projects pirate theft privately in receipts, snapshots, websocket and event history', async () => {
    const { clients, roomId, gameId } = await startedGame(harness, 3, { profileId: 'ep-pirate-lairs-2025' });
    const row = (await harness.service.repo.findGame(gameId))!;
    const state = JSON.parse(row.state_json) as GameState;
    const actor = clients.find((client) => client.playerId === state.players[state.turn.seat]!.id)!;
    const victim = clients.find((client) => client !== actor)!;
    const outsider = clients.find((client) => client !== actor && client !== victim)!;
    state.turn.phase = 'action';
    state.turn.setup = null;
    for (const player of state.players) for (const resource of Object.keys(player.resources) as (keyof typeof player.resources)[]) player.resources[resource] = 0;
    state.players.find((player) => player.id === victim.playerId)!.resources.ore = 1;
    state.pending = { kind: 'explorersPirates.pirate', module: 'explorersPirates', responders: [actor.playerId!], data: { stage: 'rob', cause: 'seven', candidates: [victim.playerId!] } };
    await harness.service.repo.saveGame(gameId, state, row.revision, 'playing', null);
    const feeds = await Promise.all(clients.map((client) => subscribe(client, roomId)));
    try {
      const body = { commandId: 'ep-private-theft', expectedRevision: row.revision, command: { type: 'ep.robPlayer', victim: victim.playerId } };
      const receipt = actor.expectOk<CommandReceipt>(await actor.post(`/api/games/${gameId}/commands`, body));
      expect(receipt.outcome).toBe('accepted');
      expect(receipt.events.find((event) => event.type === 'ep.pirateStole')?.params.resource).toBe('ore');
      expect(receipt.events.every((event) => event.private === undefined)).toBe(true);
      expect(actor.expectOk<CommandReceipt>(await actor.post(`/api/games/${gameId}/commands`, body))).toEqual(receipt);
      await vi.waitFor(() => { for (const feed of feeds) expect(feed.snapshots.at(-1)?.revision).toBe(receipt.revision); });
      for (const client of clients) {
        const http = client.expectOk<GameSnapshot>(await client.get(`/api/games/${gameId}`));
        const ws = feeds[clients.indexOf(client)]!.snapshots.at(-1)!;
        for (const snapshot of [http, ws]) {
          const event = snapshot.view.events.find((entry) => entry.type === 'ep.pirateStole')!;
          if (client === outsider) expect(event.params).not.toHaveProperty('resource');
          else expect(event.params.resource).toBe('ore');
          expect(snapshot.view.modules?.explorersPirates).not.toHaveProperty('pools');
          expect(snapshot.view.modules?.explorersPirates).not.toHaveProperty('lairTokens');
        }
        const history = client.expectOk<{ events: CommandReceipt['events'] }>(await client.get(`/api/games/${gameId}/events?after=0`));
        // 歷史與快照相同：旁觀者看得到事件，但沒有牌面。
        expect(history.events.every((entry) => entry.private === undefined)).toBe(true);
        const event = history.events.find((entry) => entry.type === 'ep.pirateStole');
        expect(event).toBeDefined();
        if (client === outsider) expect(event!.params).not.toHaveProperty('resource');
        else expect(event!.params.resource).toBe('ore');
      }
    } finally { for (const feed of feeds) feed.socket.close(); }
  });
});
