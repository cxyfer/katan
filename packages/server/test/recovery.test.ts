/** R-SAVE / R-REC: save barriers, suspension, restart recovery and terminality. */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { legalRoadEdges, requireProfile, type GameState, type GameView } from '@catan/rules';
import type { ResumableGameView } from '@catan/protocol';
import { startService } from '../src/main.ts';
import {
  createClient,
  runSetupOverApi,
  startHarness,
  startedGame,
  type TestClient,
  type TestHarness,
} from './helpers.ts';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface Receipt {
  outcome: 'accepted' | 'rejected';
  revision: number;
  error?: { messageId: string };
}

interface Snapshot {
  gameId: string;
  revision: number;
  view: GameView;
}

function id(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('R-SAVE individual save barrier', () => {
  it('acknowledges the committed revision and is idempotent by request id', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const host = clients[0]!;
    const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));

    const first = host.expectOk<{ requestId: string; revision: number; outcome: string; savedAt: string }>(
      await host.post(`/api/games/${gameId}/save`, { requestId: 'save-1' }),
    );
    expect(first.outcome).toBe('saved');
    expect(first.revision).toBe(snapshot.revision);
    expect(first.savedAt).toBeTruthy();

    const replay = host.expectOk<{ revision: number; savedAt: string }>(
      await host.post(`/api/games/${gameId}/save`, { requestId: 'save-1' }),
    );
    expect(replay.revision).toBe(first.revision);
    expect(replay.savedAt).toBe(first.savedAt);
  });

  it('refuses a save from a player without a seat', async () => {
    const { gameId } = await startedGame(harness, 3);
    const outsider = await harness.client('SaveOutsider');
    outsider.expectError(
      await outsider.post(`/api/games/${gameId}/save`, { requestId: 'nope' }),
      'E_NOT_SEATED',
    );
  });

  it('does not pause the table when one player saves', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    clients[1]!.expectOk(await clients[1]!.post(`/api/games/${gameId}/save`, { requestId: 'leave-1' }));
    const room = clients[0]!.expectOk<{ status: string }>(await clients[0]!.get(`/api/rooms/${roomId}`));
    expect(room.status).toBe('playing');
    const snapshot = clients[0]!.expectOk<Snapshot>(await clients[0]!.get(`/api/games/${gameId}`));
    expect(snapshot.view.turn.phase).toBe('preroll');
  });
});

describe('R-SAVE all-seat suspension', () => {
  it('requires every seated player to consent before freezing the game', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];

    const proposal = host.expectOk<{ proposalId: string }>(
      await host.post(`/api/games/${gameId}/suspend`, {}),
    );
    let room = host.expectOk<{ status: string }>(await host.get(`/api/rooms/${roomId}`));
    expect(room.status).toBe('playing');

    const partial = second.expectOk<{ suspended: boolean }>(
      await second.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true }),
    );
    expect(partial.suspended).toBe(false);

    const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    const actor = clients.find((client) => client.playerId === snapshot.view.turn.playerId)!;
    const beforeSuspend = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: id('pre-suspend'),
        expectedRevision: snapshot.revision,
        command: { type: 'turn.roll' },
      }),
    );
    expect(beforeSuspend.outcome).toBe('accepted');

    const complete = third.expectOk<{ suspended: boolean }>(
      await third.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true }),
    );
    expect(complete.suspended).toBe(true);
    room = host.expectOk<{ status: string }>(await host.get(`/api/rooms/${roomId}`));
    expect(room.status).toBe('suspended');
  });

  it('rejects strategic commands while suspended and resumes only with all seats ready', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [host, second, third] = clients as [TestClient, TestClient, TestClient];
    const proposal = host.expectOk<{ proposalId: string }>(await host.post(`/api/games/${gameId}/suspend`, {}));
    await second.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });
    await third.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: true });
    const { games } = host.expectOk<{ games: ResumableGameView[] }>(await host.get('/api/games'));
    expect(games.find((game) => game.gameId === gameId)!.allSeatsNeeded).toBe(true);

    const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    const actor = clients.find((client) => client.playerId === snapshot.view.turn.playerId)!;
    actor.expectError(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: id('suspended'),
        expectedRevision: snapshot.revision,
        command: { type: 'turn.roll' },
      }),
      'E_GAME_SUSPENDED',
    );

    const first = host.expectOk<{ resumed: boolean; waitingFor: string[] }>(
      await host.post(`/api/games/${gameId}/resume`, { ready: true }),
    );
    expect(first.resumed).toBe(false);
    expect(first.waitingFor.length).toBeGreaterThan(0);

    await second.post(`/api/games/${gameId}/resume`, { ready: true });
    const final = third.expectOk<{ resumed: boolean }>(
      await third.post(`/api/games/${gameId}/resume`, { ready: true }),
    );
    // Seats are connected over HTTP in this test, so readiness alone resumes.
    expect(final.resumed).toBe(true);
  });

  it('cancels a suspend proposal when a seat rejects it', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    const [host, second] = clients as [TestClient, TestClient];
    const proposal = host.expectOk<{ proposalId: string }>(await host.post(`/api/games/${gameId}/suspend`, {}));
    const result = second.expectOk<{ suspended: boolean }>(
      await second.post(`/api/games/${gameId}/suspend`, { proposalId: proposal.proposalId, approve: false }),
    );
    expect(result.suspended).toBe(false);
    const room = host.expectOk<{ status: string }>(await host.get(`/api/rooms/${roomId}`));
    expect(room.status).toBe('playing');
  });
});

describe('R-REC restart recovery', () => {
  for (const kind of ['freeRoads', 'yearOfPlenty'] as const) {
    for (const available of [0, 1]) {
      it(`recovers a persisted legacy ${kind} effect with ${available} choices left`, async () => {
        const { clients, gameId } = await startedGame(harness, 3);
        await runSetupOverApi(clients, gameId);
        const row = (await harness.service.repo.findGame(gameId))!;
        const state = JSON.parse(row.state_json) as GameState;
        const actorId = state.players[state.turn.seat]!.id;
        const actor = clients.find((client) => client.playerId === actorId)!;
        state.engineVersion = 'base-2025.2';
        state.turn.phase = 'action';
        if (kind === 'freeRoads') {
          const target = requireProfile(state.profileId).pieces.roads - available;
          let count = state.board.roads.filter((road) => road?.player === actorId).length;
          for (let edge = 0; edge < state.board.roads.length && count < target; edge++) {
            if (state.board.roads[edge] || legalRoadEdges(state, actorId).includes(edge)) continue;
            state.board.roads[edge] = { player: actorId, ship: false };
            count += 1;
          }
          expect(count).toBe(target);
          expect(legalRoadEdges(state, actorId).length).toBeGreaterThan(0);
          state.pending = { kind, actor: actorId, remaining: available === 0 ? 1 : 2 };
        } else {
          state.bank = { lumber: available, brick: 0, wool: 0, grain: 0, ore: 0 };
          state.pending = { kind, actor: actorId, remaining: 2 };
        }
        await harness.service.repo.saveGame(gameId, state, row.revision, 'playing', null);
        await harness.service.repo.db.run('UPDATE games SET engine_version = ? WHERE id = ?', [
          'base-2025.2', gameId,
        ]);
        const saved = (await harness.service.repo.findGame(gameId))!;
        const snapshot = actor.expectOk<Snapshot>(await actor.get(`/api/games/${gameId}`));
        expect(snapshot.revision).toBe(row.revision);
        expect(snapshot.view.pending).toEqual(available > 0 ? { kind, actor: actorId, remaining: 1 } : null);
        expect((await harness.service.repo.findGame(gameId))!.state_json).toBe(saved.state_json);
        const command = available === 0
          ? { type: 'turn.end' }
          : kind === 'freeRoads'
            ? { type: 'build.road', edge: snapshot.view.hints!.legalRoads[0]! }
            : { type: 'pending.takeResource', resource: 'lumber' };
        const request = {
          commandId: id('legacy-pending'),
          expectedRevision: snapshot.revision,
          command,
        };
        const receipt = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, request));
        expect(receipt.outcome).toBe('accepted');
        expect(receipt.revision).toBe(row.revision + 1);
        const replay = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, request));
        expect(replay).toEqual(receipt);
        const restored = (await harness.service.repo.findGame(gameId))!;
        expect(restored.revision).toBe(receipt.revision);
        expect((JSON.parse(restored.state_json) as GameState).pending).toBeNull();
      });
    }
  }

  it('restores the same revision, seat and receipts after a service restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'catan-restart-'));
    const sqlitePath = join(dir, 'restart.sqlite');
    const first = await startService({ port: 0, host: '127.0.0.1', sqlitePath }, () => undefined);
    const base1 = `http://127.0.0.1:${first.port}`;

    try {
      const clients: TestClient[] = [];
      for (let i = 0; i < 3; i++) {
        const client = createClient(base1);
        const session = client.expectOk<{ player: { id: string } }>(
          await client.post('/api/session', { nickname: `R${i}`, locale: 'en' }),
        );
        client.playerId = session.player.id;
        clients.push(client);
      }
      const host = clients[0]!;
      const room = host.expectOk<{ id: string; code: string }>(
        await host.post('/api/rooms', {
          visibility: 'private',
          capacity: 3,
          profileId: 'base-2025',
          setupMode: 'fixed',
        }),
      );
      for (let i = 1; i < 3; i++) {
        clients[i]!.expectOk(await clients[i]!.post('/api/rooms/join', { code: room.code }));
        clients[i]!.expectOk(await clients[i]!.post(`/api/rooms/${room.id}/ready`, { ready: true }));
      }
      host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
      const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));

      const { revision } = await runSetupOverApi(clients, gameId);
      const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
      const actor = clients.find((client) => client.playerId === snapshot.view.turn.playerId)!;
      const rollId = id('restart-roll');
      const receipt = actor.expectOk<Receipt>(
        await actor.post(`/api/games/${gameId}/commands`, {
          commandId: rollId,
          expectedRevision: revision,
          command: { type: 'turn.roll' },
        }),
      );
      expect(receipt.outcome).toBe('accepted');
      const before = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));

      await first.close();

      const second = await startService({ port: 0, host: '127.0.0.1', sqlitePath }, () => undefined);
      try {
        const base2 = `http://127.0.0.1:${second.port}`;
        const resumed = createClient(base2);
        resumed.cookie = host.cookie;
        const after = resumed.expectOk<Snapshot>(await resumed.get(`/api/games/${gameId}`));
        expect(after.revision).toBe(before.revision);
        expect(after.view.seq).toBe(before.view.seq);
        expect(after.view.turn.playerId).toBe(before.view.turn.playerId);

        // The receipt survives, so a blind retry cannot draw the dice twice.
        const replay = actor.cookie
          ? await (async () => {
              const retryClient = createClient(base2);
              retryClient.cookie = actor.cookie;
              return retryClient.expectOk<Receipt>(
                await retryClient.post(`/api/games/${gameId}/commands`, {
                  commandId: rollId,
                  expectedRevision: revision,
                  command: { type: 'turn.roll' },
                }),
              );
            })()
          : null;
        expect(replay?.revision).toBe(receipt.revision);

        // The game is still listed for its original seat owner.
        const games = resumed.expectOk<{ games: { gameId: string }[] }>(await resumed.get('/api/games'));
        expect(games.games.map((game) => game.gameId)).toContain(gameId);
      } finally {
        await second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists a terminal result and rejects later strategic commands', async () => {
    const { clients, gameId, roomId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const host = clients[0]!;

    // Deterministic fixture: the next seat already holds the winning score and
    // the current actor simply ends the turn, so the victory boundary is the
    // start of that seat's own turn (R-B07).
    const row = await harness.service.repo.findGame(gameId);
    const state = JSON.parse(row!.state_json) as GameState;
    const currentSeat = state.turn.seat;
    const winnerSeat = (currentSeat + 1) % state.players.length;
    state.players[winnerSeat]!.bonusPoints = 10;
    state.turn.phase = 'action';
    await harness.service.repo.saveGame(gameId, state, row!.revision, 'playing', null);

    const current = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    const actor = clients.find((client) => client.playerId === current.view.turn.playerId)!;
    const receipt = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: id('endgame-end'),
        expectedRevision: current.revision,
        command: { type: 'turn.end' },
      }),
    );
    expect(receipt.outcome).toBe('accepted');

    const final = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
    expect(final.view.result).not.toBeNull();
    const room = host.expectOk<{ status: string }>(await host.get(`/api/rooms/${roomId}`));
    expect(room.status).toBe('completed');

    actor.expectError(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: id('after-terminal'),
        expectedRevision: final.revision,
        command: { type: 'turn.roll' },
      }),
      'E_GAME_OVER',
    );
  });
});
