/**
 * Traders & Barbarians through the public API: ruleset resolution, setup of
 * every enabled scenario, module commands with idempotent receipts and
 * per-viewer privacy of the module projection.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROFILES } from '@katan/rules';
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

  // 依 `@katan/bots` 的 `botsCanPlay`（BotModule 與 `supports`）判定：S9 起 8 個可玩的 T&B profile 都開放 Bot 席位
  // （easy、standard）；4 個 event-card profile 沒有開放，也不能讓 Bot 入座。
  const tbProfiles = PROFILES.filter((profile) => profile.enabled && profile.id.startsWith('tb-'));
  const eventCardProfiles = PROFILES.filter((profile) => profile.id.startsWith('tb-event-cards'));

  it('lists every enabled T&B profile with bot seats and keeps the event-card rows without them', async () => {
    expect(tbProfiles).toHaveLength(8);
    expect(eventCardProfiles).toHaveLength(4);
    const host = await harness.client('TbBotList');
    const { profiles } = host.expectOk<{ profiles: { id: string; botSeats: boolean; botLevels: string[] }[] }>(await host.get('/api/profiles'));
    for (const profile of tbProfiles) {
      expect(profiles.find((entry) => entry.id === profile.id), profile.id).toMatchObject({ botSeats: true, botLevels: ['easy', 'standard'] });
    }
    for (const profile of eventCardProfiles) {
      expect(profile.enabled, profile.id).toBe(false);
      expect(profiles.find((entry) => entry.id === profile.id), profile.id).toMatchObject({ botSeats: false, botLevels: [] });
    }
  });

  for (const profile of tbProfiles) {
    it(`${profile.id}: seats bots and lets a bot room switch to the profile`, async () => {
      const host = await harness.client(`TbBots${tbProfiles.indexOf(profile)}`);
      const body = {
        visibility: 'private', capacity: 3, profileId: profile.id,
        setupMode: profile.setupModes.includes('variable') ? 'variable' : 'fixed',
      };
      const room = host.expectOk<{ id: string }>(await host.post('/api/rooms', body));
      const seated = host.expectOk<{ members: { bot?: boolean }[] }>(await host.post(`/api/rooms/${room.id}/bots`, {}));
      expect(seated.members.filter((member) => member.bot)).toHaveLength(1);
      // A base room that already seats a bot can be switched to this profile.
      const base = host.expectOk<{ id: string }>(await host.post('/api/rooms', {
        visibility: 'private', capacity: 3, profileId: 'base-2025', setupMode: 'variable',
      }));
      host.expectOk(await host.post(`/api/rooms/${base.id}/bots`, {}));
      host.expectOk(await host.post(`/api/rooms/${base.id}/settings`, { profileId: profile.id, setupMode: body.setupMode }));
      const switched = host.expectOk<{ profileId: string; members: { bot?: boolean }[] }>(await host.get(`/api/rooms/${base.id}`));
      expect(switched.profileId).toBe(profile.id);
      expect(switched.members.filter((member) => member.bot)).toHaveLength(1);
    });
  }

  it('cannot seat bots in the closed event-card rows: neither a room nor a bot room switch reaches them', async () => {
    const host = await harness.client('TbEventBots');
    const base = host.expectOk<{ id: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 3, profileId: 'base-2025', setupMode: 'variable',
    }));
    host.expectOk(await host.post(`/api/rooms/${base.id}/bots`, {}));
    for (const profile of eventCardProfiles) {
      const created = await host.post('/api/rooms', { visibility: 'private', capacity: 3, profileId: profile.id, setupMode: 'fixed' });
      expect(created.body.ok, profile.id).toBe(false);
      const switched = await host.post(`/api/rooms/${base.id}/settings`, { profileId: profile.id, setupMode: 'fixed' });
      expect(switched.body.ok, profile.id).toBe(false);
    }
  });

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
