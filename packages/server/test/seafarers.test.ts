/**
 * Heading for New Shores through the service: rooms resolve the enabled
 * profiles, games start on the printed maps, and module commands (setup ship,
 * build ship) go through the same durable, idempotent receipts as base ones.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTopology } from '@catan/rules';
import { startHarness, startedGame, type TestClient, type TestHarness } from './helpers.ts';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface SeaView {
  revision: number;
  view: {
    engineVersion: string;
    victoryTarget: number;
    turn: { playerId: string; phase: string; setup: { stage: string } | null };
    board: { topologyId: string; terrain: string[]; pirate: number | null; roads: ({ player: string; ship: boolean } | null)[] };
    hints?: { legalRoads: number[]; legalSettlements: number[]; modules?: { seafarers?: { setupShips: number[] } } };
    modules?: { seafarers?: { islandBonus: Record<string, number[]> } };
  };
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  revision: number;
  error?: { messageId: string };
}

async function snapshot(client: TestClient, gameId: string): Promise<SeaView> {
  return client.expectOk<SeaView>(await client.get(`/api/games/${gameId}`));
}

describe('Heading for New Shores over the API', () => {
  it('resolves the ruleset by parts and starts the 3-player map', async () => {
    const host = await harness.client('SeaHost');
    const room = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 3, setupMode: 'fixed',
      ruleset: { expansions: ['seafarers'], scenario: 'new-shores', variants: [] },
    }));
    expect(room.profileId).toBe('sf-new-shores-2025');
    const paired = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 6, setupMode: 'variable',
      ruleset: { expansions: ['seafarers'], scenario: 'new-shores' },
    }));
    expect(paired.profileId).toBe('sf-new-shores-paired-2025');
  });

  it('places a starting ship with an idempotent module command', async () => {
    const { clients, gameId } = await startedGame(harness, 3, { profileId: 'sf-new-shores-2025' });
    const host = clients[0]!;
    let state = await snapshot(host, gameId);
    expect(state.view.board.topologyId).toBe('sf-new-shores-3');
    expect(state.view.engineVersion).toBe('sf-2025.1');
    expect(state.view.victoryTarget).toBe(14);
    expect(state.view.board.pirate).toBeNull();
    expect(state.view.modules?.seafarers?.islandBonus).toBeDefined();

    // First settlement on the coast: a legal vertex that touches a sea hex.
    const actor = clients.find((client) => client.playerId === state.view.turn.playerId)!;
    const mine = await snapshot(actor, gameId);
    const topology = getTopology(mine.view.board.topologyId);
    const coastal = mine.view.hints!.legalSettlements.find((vertex) =>
      topology.vertices[vertex]!.hexes.some((hex) => mine.view.board.terrain[hex] === 'sea'));
    expect(coastal).toBeDefined();
    const building = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, {
      commandId: 'sea-building', expectedRevision: mine.revision,
      command: { type: 'setup.placeBuilding', vertex: coastal },
    }));
    expect(building.outcome).toBe('accepted');
    const revision = building.revision;
    const ships = (await snapshot(actor, gameId)).view.hints!.modules!.seafarers!.setupShips;
    const body = {
      commandId: 'sea-setup-ship', expectedRevision: revision,
      command: { type: 'setup.placeShip', edge: ships[0] },
    };
    const first = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(first.outcome).toBe('accepted');
    const again = actor.expectOk<Receipt>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(again.revision).toBe(first.revision);
    state = await snapshot(host, gameId);
    expect(state.view.board.roads[ships[0]!]).toEqual({ player: actor.playerId, ship: true });
    expect(state.view.board.roads.filter(Boolean)).toHaveLength(1);
  });
});
