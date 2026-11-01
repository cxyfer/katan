/**
 * Traders & Barbarians through the public API: ruleset resolution, setup of
 * every enabled scenario, module commands with idempotent receipts and
 * per-viewer privacy of the module projection.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROFILES } from '@catan/rules';
import { runSetupOverApi, startHarness, startedGame, type TestHarness } from './helpers.ts';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface ModuleView {
  revision: number;
  view: {
    profileId: string;
    turn: { playerId: string; phase: string };
    modules?: { tradersBarbarians?: Record<string, Record<string, unknown>> };
  };
}

describe('Traders & Barbarians rooms', () => {
  it('resolves scenarios and variants by their parts and refuses the closed event-card rows', async () => {
    const host = await harness.client('TbHost');
    const fishing = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'variable',
      ruleset: { expansions: ['tradersBarbarians'], scenario: 'tb-fishing', variants: [] },
    }));
    expect(fishing.profileId).toBe('tb-fishing-2025');
    const harbors = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 3, setupMode: 'fixed',
      ruleset: { expansions: ['tradersBarbarians'], scenario: null, variants: ['harbors', 'friendly-robber'] },
    }));
    expect(harbors.profileId).toBe('tb-friendly-robber-harbors-2025');
    const closed = await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'fixed',
      ruleset: { expansions: ['tradersBarbarians'], scenario: null, variants: ['event-cards'] },
    });
    host.expectError(closed, 'E_UNSUPPORTED_COMBINATION');
    // Scenarios use the variable setup only.
    host.expectError(await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'fixed', profileId: 'tb-rivers-2025',
    }), 'E_UNSUPPORTED_COMBINATION');
  });

  const scenarios = PROFILES.filter((profile) => profile.enabled && profile.scenario?.startsWith('tb-'));
  for (const profile of scenarios) {
    it(`${profile.id}: plays setup over the API and projects the scenario state`, async () => {
      const { clients, gameId } = await startedGame(harness, 3, { profileId: profile.id, setupMode: 'variable' });
      await runSetupOverApi(clients, gameId);
      const host = clients[0]!;
      const snapshot = host.expectOk<ModuleView>(await host.get(`/api/games/${gameId}`));
      expect(snapshot.view.profileId).toBe(profile.id);
      expect(snapshot.view.turn.phase).toBe('preroll');
      expect(snapshot.view.modules?.tradersBarbarians?.[profile.scenario!]).toBeTruthy();
    });
  }

  it('keeps fish token values private and replays a module command receipt', async () => {
    const { clients, gameId } = await startedGame(harness, 3, { profileId: 'tb-rivers-2025', setupMode: 'variable' });
    let { revision } = await runSetupOverApi(clients, gameId);
    const host = clients[0]!;
    let snapshot = host.expectOk<ModuleView>(await host.get(`/api/games/${gameId}`));
    const actor = clients.find((client) => client.playerId === snapshot.view.turn.playerId)!;
    const roll = actor.expectOk<{ outcome: string; revision: number }>(await actor.post(`/api/games/${gameId}/commands`, {
      commandId: 'tb-roll', expectedRevision: revision, command: { type: 'turn.roll' },
    }));
    revision = roll.revision;
    snapshot = actor.expectOk<ModuleView>(await actor.get(`/api/games/${gameId}`));
    // A module command (selling for gold) is idempotent by command id.
    const body = { commandId: 'tb-sell', expectedRevision: revision, command: { type: 'tb.sellResources', resource: 'ore' } };
    const first = actor.expectOk<{ outcome: string; revision: number }>(await actor.post(`/api/games/${gameId}/commands`, body));
    const second = actor.expectOk<{ outcome: string; revision: number }>(await actor.post(`/api/games/${gameId}/commands`, body));
    expect(second).toEqual(first);

    const fishing = await startedGame(harness, 3, { profileId: 'tb-fishing-2025', setupMode: 'variable' });
    await runSetupOverApi(fishing.clients, fishing.gameId);
    const views = await Promise.all(fishing.clients.map(async (client) =>
      client.expectOk<ModuleView>(await client.get(`/api/games/${fishing.gameId}`)).view.modules!.tradersBarbarians!['tb-fishing']!));
    for (const [index, view] of views.entries()) {
      const own = (view.mine as number[] | undefined) ?? [];
      expect(own.length).toBe((view.tokenCounts as Record<string, number>)[fishing.clients[index]!.playerId!]);
      expect(JSON.stringify(view)).not.toContain('"hands"');
    }
  });
});
