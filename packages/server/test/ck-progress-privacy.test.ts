/** Progress-card privacy through HTTP receipts, projections and actual WS delivery. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { GameState } from '@catan/rules';
import type { CommandReceipt, GameSnapshot, ServerMessage } from '@catan/protocol';
import { runSetupOverApi, startHarness, type TestClient, type TestHarness } from './helpers.ts';

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
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'subscribe', payload: { roomId } }));
  await vi.waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
  return { socket, snapshots };
}

describe('progress-card service privacy', () => {
  it.each(['espionage', 'wedding', 'commercialHarbor'] as const)('%s keeps private results between the two participants', async (card) => {
    const clients = await Promise.all([1, 2, 3].map((index) => harness.client(`Privacy ${index}`)));
    const host = clients[0]!;
    const room = host.expectOk<{ id: string; code: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 3, profileId: 'ck-2025', setupMode: 'fixed',
    }));
    for (const client of clients.slice(1)) client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
    for (const client of clients) client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
    await runSetupOverApi(clients, gameId);
    const row = (await harness.service.repo.findGame(gameId))!;
    const state = JSON.parse(row.state_json) as GameState;
    state.turn.phase = 'action';
    const actor = clients.find((client) => client.playerId === state.players[state.turn.seat]!.id)!;
    const other = clients.find((client) => client !== actor)!;
    const bystander = clients.find((client) => client !== actor && client !== other)!;
    for (const player of state.players) player.progressCards = [];
    const self = state.players.find((player) => player.id === actor.playerId)!;
    const victim = state.players.find((player) => player.id === other.playerId)!;
    self.progressCards = [card];
    victim.progressCards = card === 'espionage' ? ['merchantFleet'] : [];
    self.resources.wool = 1;
    victim.resources.grain = 2;
    victim.resources.ore = 1;
    victim.commodities.cloth = 2;
    victim.commodities.paper = 1;
    // Wedding's other participant is strictly ahead; the bystander owes no cards.
    state.board.buildings.fill(null);
    state.board.buildings[0] = { player: victim.id, city: true };
    await harness.service.repo.saveGame(gameId, state, row.revision, 'playing', null);
    const feeds = await Promise.all(clients.map((client) => subscribe(client, room.id)));
    let revision = row.revision;
    let sequence = 0;
    const send = async (client: TestClient, command: Record<string, unknown>) => {
      const body = { commandId: `privacy-${card}-${++sequence}`, expectedRevision: revision, command };
      const first = client.expectOk<CommandReceipt>(await client.post(`/api/games/${gameId}/commands`, body));
      expect(first.outcome).toBe('accepted');
      const replay = client.expectOk<CommandReceipt>(await client.post(`/api/games/${gameId}/commands`, body));
      expect(replay).toEqual(first);
      expect(first.events.every((event) => event.private === undefined)).toBe(true);
      revision = first.revision;
      await vi.waitFor(() => {
        for (const feed of feeds) expect(feed.snapshots.at(-1)?.revision).toBe(revision);
      });
      return first;
    };
    try {
      await send(actor, { type: 'progress.play', card, ...(card === 'espionage' ? { target: other.playerId } : {}) });
      if (card === 'espionage') {
        const outsider = bystander.expectOk<GameSnapshot>(await bystander.get(`/api/games/${gameId}`));
        expect(JSON.stringify(outsider)).not.toContain('merchantFleet');
        expect(JSON.stringify(feeds[clients.indexOf(bystander)]!.snapshots.at(-1))).not.toContain('merchantFleet');
        const own = actor.expectOk<GameSnapshot>(await actor.get(`/api/games/${gameId}`));
        expect(JSON.stringify(own.view.pending)).toContain('merchantFleet');
      }
      if (card === 'commercialHarbor') {
        await send(actor, { type: 'progress.harborOffer', to: other.playerId, resource: 'wool' });
        const outsider = bystander.expectOk<GameSnapshot>(await bystander.get(`/api/games/${gameId}`));
        expect(outsider.view.pending).not.toHaveProperty('data.resource');
        const offered = feeds[clients.indexOf(bystander)]!.snapshots.at(-1)!;
        expect(offered.view.events.find((event) => event.type === 'ck.harborOffered')!.params).not.toHaveProperty('resource');
      }
      const receipt = await send(card === 'espionage' ? actor : other,
        card === 'espionage' ? { type: 'progress.takeProgress', card: 'merchantFleet' }
          : card === 'wedding' ? { type: 'progress.weddingGive', cards: ['grain', 'cloth'] }
            : { type: 'progress.harborAnswer', commodity: 'cloth' });
      const eventType = card === 'espionage' ? 'ck.espionageTaken' : card === 'wedding' ? 'ck.weddingGift' : 'ck.harborExchanged';
      const privateParams = card === 'espionage' ? { card: 'merchantFleet' }
        : card === 'wedding' ? { cards: ['grain', 'cloth'] } : { resource: 'wool', commodity: 'cloth' };
      expect(receipt.events.find((event) => event.type === eventType)!.params).toMatchObject(privateParams);
      for (const client of clients) {
        const http = client.expectOk<GameSnapshot>(await client.get(`/api/games/${gameId}`));
        const ws = feeds[clients.indexOf(client)]!.snapshots.at(-1)!;
        for (const snapshot of [http, ws]) {
          expect(snapshot.view.events.every((event) => event.private === undefined)).toBe(true);
          for (const player of snapshot.view.players) {
            if (player.id !== client.playerId) expect(player.progressCards).toBeUndefined();
          }
          const event = snapshot.view.events.find((candidate) => candidate.type === eventType)!;
          if (client === bystander) {
            for (const field of Object.keys(privateParams)) expect(event.params).not.toHaveProperty(field);
          } else {
            expect(event.params).toMatchObject(privateParams);
          }
        }
      }
    } finally {
      for (const feed of feeds) feed.socket.close();
    }
  });
});
