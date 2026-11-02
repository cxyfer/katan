/**
 * Explorers & Pirates through the service: rooms resolve one profile per
 * mission, games start on the mission maps with fog, bots are refused, and
 * module commands go through the same durable, idempotent receipts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, startedGame, type TestHarness } from './helpers.ts';

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
    const created = await host.post('/api/rooms', {
      visibility: 'private', capacity: 3, profileId: 'ep-fish-2025', setupMode: 'variable', bots: 1,
    });
    expect(created.status).toBeGreaterThanOrEqual(400);
    const room = host.expectOk<{ id: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 3, profileId: 'ep-land-ho-2025', setupMode: 'fixed', bots: 0,
    }));
    host.expectError(await host.post(`/api/rooms/${room.id}/bots`, {}), 'E_INVALID_BOT');
  });

  it('starts a variable-setup mission and accepts an idempotent harbour placement', async () => {
    const { clients, gameId } = await startedGame(harness, 3, { profileId: 'ep-fish-2025', setupMode: 'variable' });
    const first = clients[0]!.expectOk<EpSnapshot>(await clients[0]!.get(`/api/games/${gameId}`));
    expect(first.view.engineVersion).toBe('ep-2025.1');
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
});
