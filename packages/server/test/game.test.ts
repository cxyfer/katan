/** Game commands, receipts, revisions and per-player projections over HTTP. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  runSetupOverApi,
  startHarness,
  startedGame,
  type GameViewLike,
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
  commandId: string;
  outcome: 'accepted' | 'rejected';
  revision: number;
  error?: { messageId: string; params?: Record<string, unknown> };
  events: { seq: number; type: string; params: Record<string, unknown> }[];
}

interface Snapshot {
  gameId: string;
  revision: number;
  view: Omit<GameViewLike, 'players'> & {
    profileId: string;
    victoryTarget: number;
    awards: { longestRoad: string | null; largestArmy: string | null };
    offers: unknown[];
    hints?: { canRoll: boolean; canEndTurn: boolean; legalSettlements: number[]; legalRoads: number[] };
    result: unknown;
    bank: Record<string, number>;
    players: {
      id: string;
      resources?: Record<string, number>;
      devCards?: string[];
      newDevCards?: string[];
      devCardCount: number;
      handSize: number;
    }[];
  };
}

function commandId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('game commands', () => {
  it('locks the ruleset at start and exposes it to every seat', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    for (const client of clients) {
      const snapshot = client.expectOk<Snapshot>(await client.get(`/api/games/${gameId}`));
      expect(snapshot.view.profileId).toBe('base-2025');
      expect(snapshot.view.victoryTarget).toBe(10);
      expect(snapshot.view.turn.phase).toBe('setup');
    }
  });

  it('completes initial placement through commands and grants starting resources once', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    const { revision, view } = await runSetupOverApi(clients, gameId);
    expect(view.turn.phase).toBe('preroll');
    expect(revision).toBeGreaterThan(1);

    const snapshot = clients[0]!.expectOk<Snapshot>(await clients[0]!.get(`/api/games/${gameId}`));
    const buildings = snapshot.view.board.buildings.filter(Boolean).length;
    const roads = snapshot.view.board.roads.filter(Boolean).length;
    expect(buildings).toBe(6);
    expect(roads).toBe(6);
    const total = snapshot.view.players.reduce(
      (sum, player) => sum + Object.values(player.resources ?? {}).reduce((a, b) => a + b, 0),
      0,
    );
    // Second-settlement grants only: at most 3 resources per player here.
    expect(total).toBeLessThanOrEqual(9);
  });

  it('rejects a command from a player who does not own the current window', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const snapshot = clients[0]!.expectOk<Snapshot>(await clients[0]!.get(`/api/games/${gameId}`));
    const actorId = snapshot.view.turn.playerId;
    const other = clients.find((client) => client.playerId !== actorId)!;
    const receipt = other.expectOk<Receipt>(
      await other.post(`/api/games/${gameId}/commands`, {
        commandId: commandId('wrong-actor'),
        expectedRevision: snapshot.revision,
        command: { type: 'turn.roll' },
      }),
    );
    expect(receipt.outcome).toBe('rejected');
    expect(receipt.error?.messageId).toBe('error.E_NOT_YOUR_TURN');
    expect(receipt.revision).toBe(snapshot.revision);
  });

  it('returns the original receipt when the same command id is repeated', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    const { revision } = await runSetupOverApi(clients, gameId);
    const snapshot = clients[0]!.expectOk<Snapshot>(await clients[0]!.get(`/api/games/${gameId}`));
    const actorId = snapshot.view.turn.playerId;
    const actor = clients.find((client) => client.playerId === actorId)!;
    const id = commandId('roll');

    const first = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: id,
        expectedRevision: revision,
        command: { type: 'turn.roll' },
      }),
    );
    expect(first.outcome).toBe('accepted');

    const replay = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: id,
        expectedRevision: revision,
        command: { type: 'turn.roll' },
      }),
    );
    expect(replay.revision).toBe(first.revision);
    expect(replay.events.map((event) => event.seq)).toEqual(first.events.map((event) => event.seq));

    // Reusing the id with different content is refused.
    actor.expectError(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: id,
        expectedRevision: first.revision,
        command: { type: 'turn.end' },
      }),
      'E_COMMAND_ID_REUSED',
    );
  });

  it('rejects a stale revision and does not mutate state', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    const { revision } = await runSetupOverApi(clients, gameId);
    const snapshot = clients[0]!.expectOk<Snapshot>(await clients[0]!.get(`/api/games/${gameId}`));
    const actorId = snapshot.view.turn.playerId;
    const actor = clients.find((client) => client.playerId === actorId)!;

    const receipt = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: commandId('stale'),
        expectedRevision: revision - 1,
        command: { type: 'turn.roll' },
      }),
    );
    expect(receipt.outcome).toBe('rejected');
    expect(receipt.error?.messageId).toBe('error.E_STALE_REVISION');
    const after = clients[0]!.expectOk<Snapshot>(await clients[0]!.get(`/api/games/${gameId}`));
    expect(after.revision).toBe(revision);
    expect(after.view.turn.phase).toBe('preroll');
  });

  it('advances the revision and publishes ordered events', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    const { revision } = await runSetupOverApi(clients, gameId);
    const snapshot = clients[0]!.expectOk<Snapshot>(await clients[0]!.get(`/api/games/${gameId}`));
    const actor = clients.find((client) => client.playerId === snapshot.view.turn.playerId)!;
    const receipt = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: commandId('roll2'),
        expectedRevision: revision,
        command: { type: 'turn.roll' },
      }),
    );
    expect(receipt.revision).toBe(revision + 1);
    expect(receipt.events.length).toBeGreaterThan(0);
    const seqs = receipt.events.map((event) => event.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(receipt.events.some((event) => event.type === 'turn.rolled')).toBe(true);
  });

  it('never sends another seat private resources or cards', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const [first, second, third] = clients as [typeof clients[0], typeof clients[0], typeof clients[0]];

    const firstView = first.expectOk<Snapshot>(await first.get(`/api/games/${gameId}`));
    const secondView = second.expectOk<Snapshot>(await second.get(`/api/games/${gameId}`));
    const thirdView = third.expectOk<Snapshot>(await third.get(`/api/games/${gameId}`));

    const selfId = first.playerId!;
    const mine = firstView.view.players.find((player) => player.id === selfId)!;
    const others = firstView.view.players.filter((player) => player.id !== selfId);
    expect(mine.resources).toBeDefined();
    expect(mine.devCards).toBeDefined();
    for (const other of others) {
      expect(other.resources).toBeUndefined();
      expect(other.devCards).toBeUndefined();
      expect(other.newDevCards).toBeUndefined();
      expect('ownScore' in other).toBe(false);
    }
    // The viewer's own private cards are present but nobody else's.
    const privateOwners = firstView.view.players.filter((player) => player.devCards !== undefined);
    expect(privateOwners.map((player) => player.id)).toEqual([selfId]);
    // Other seats still see the public hand size and card count.
    expect(others[0]!.handSize).toBeGreaterThanOrEqual(0);
    expect(others[0]!.devCardCount).toBe(0);
    void secondView;
    void thirdView;
  });

  it('refuses game access to a player without a seat', async () => {
    const { gameId } = await startedGame(harness, 3);
    const outsider = await harness.client('Outsider');
    outsider.expectError(await outsider.get(`/api/games/${gameId}`), 'E_NOT_SEATED');
  });

  it('lists the game as resumable for its members only', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    const games = clients[0]!.expectOk<{ games: { gameId: string; profileId: string }[] }>(
      await clients[0]!.get('/api/games'),
    );
    expect(games.games.map((game) => game.gameId)).toContain(gameId);
    const outsider = await harness.client('Outsider2');
    const outsiderGames = outsider.expectOk<{ games: unknown[] }>(await outsider.get('/api/games'));
    expect(outsiderGames.games).toHaveLength(0);
  });

  it('exposes per-viewer legal targets only to the acting seat', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    const view = clients[0]!.expectOk<Snapshot>(await clients[0]!.get(`/api/games/${gameId}`));
    const actorId = view.view.turn.playerId;
    const actor = clients.find((client) => client.playerId === actorId)!;
    const other = clients.find((client) => client.playerId !== actorId)!;
    const actorHints = actor.expectOk<Snapshot>(await actor.get(`/api/games/${gameId}`)).view.hints!;
    const otherHints = other.expectOk<Snapshot>(await other.get(`/api/games/${gameId}`)).view.hints!;
    expect(actorHints.legalSettlements.length).toBeGreaterThan(0);
    expect(otherHints.legalSettlements).toHaveLength(0);
  });

  it('records a command receipt that survives a rejected retry', async () => {
    const { clients, gameId } = await startedGame(harness, 3);
    await runSetupOverApi(clients, gameId);
    const snapshot = clients[0]!.expectOk<Snapshot>(await clients[0]!.get(`/api/games/${gameId}`));
    const actor = clients.find((client) => client.playerId === snapshot.view.turn.playerId)!;
    const id = commandId('illegal');
    const receipt = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: id,
        expectedRevision: snapshot.revision,
        command: { type: 'build.settlement', vertex: 0 },
      }),
    );
    expect(receipt.outcome).toBe('rejected');
    const replay = actor.expectOk<Receipt>(
      await actor.post(`/api/games/${gameId}/commands`, {
        commandId: id,
        expectedRevision: snapshot.revision,
        command: { type: 'build.settlement', vertex: 0 },
      }),
    );
    expect(replay.outcome).toBe('rejected');
    expect(replay.error?.messageId).toBe(receipt.error?.messageId);
  });
});
