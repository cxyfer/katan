/**
 * Seafarers 其餘八個劇本（S0）：只登記、不啟用。
 * 這些 profile 是 disabled，房間建不起來，所以 bot 座位拒絕以 `botsSupported`
 * （`rooms.ts` 的 `requireBotsAllowed` 所用的判定）驗證，大廳以 `/api/profiles` 驗證。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getProfile } from '@katan/rules';
import { botsSupported, profileBotLevels } from '../src/bot-seats.ts';
import { startHarness, type TestHarness } from './helpers.ts';

const SCENARIOS = [
  ['sf-four-islands-2025', 'four-islands'],
  ['sf-fog-islands-2025', 'fog-islands'],
  ['sf-through-the-desert-2025', 'through-the-desert'],
  ['sf-forgotten-tribe-2025', 'forgotten-tribe'],
  ['sf-cloth-for-catan-2025', 'cloth-for-catan'],
  ['sf-pirate-islands-2025', 'pirate-islands'],
  ['sf-wonders-of-catan-2025', 'wonders-of-catan'],
  ['sf-new-world-2025', 'new-world'],
] as const;

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

const reason = (response: { body: { ok: boolean; error?: { params?: Record<string, unknown> } } }) =>
  response.body.ok ? 'ok' : response.body.error?.params?.reason;

describe('seafarers further scenarios (S0 registry only)', () => {
  it('lists the profiles as disabled and never offers them for selection', async () => {
    const host = await harness.client('ScenarioLister');
    const data = host.expectOk<{
      profiles: { id: string; enabled: boolean; botSeats: boolean; botLevels: string[]; playerCounts: number[] }[];
      selectable: string[];
    }>(await host.get('/api/profiles'));
    for (const [id] of SCENARIOS) {
      expect(data.profiles.find((profile) => profile.id === id), id).toMatchObject({
        enabled: false, botSeats: false, botLevels: [], playerCounts: [3, 4],
      });
      expect(data.selectable).not.toContain(id);
    }
  });

  it('rejects 5 and 6 players with bad-player-count and 3–4 with disabled', async () => {
    const host = await harness.client('ScenarioCapacity');
    for (const [id, scenario] of SCENARIOS) {
      const setupMode = getProfile(id)!.setupModes[0]!;
      for (const capacity of [5, 6]) {
        const response = await host.post('/api/rooms', {
          visibility: 'private', capacity, setupMode, ruleset: { expansions: ['seafarers'], scenario },
        });
        host.expectError(response, 'E_UNSUPPORTED_COMBINATION');
        expect(reason(response), `${id} ${capacity}`).toBe('bad-player-count');
      }
      for (const capacity of [3, 4]) {
        const response = await host.post('/api/rooms', {
          visibility: 'private', capacity, setupMode, profileId: id, ruleset: { expansions: ['seafarers'], scenario },
        });
        host.expectError(response, 'E_UNSUPPORTED_COMBINATION');
        expect(reason(response), `${id} ${capacity}`).toBe('disabled');
      }
    }
  });

  it('is not on the bot support list, so a bot seat would be refused with reason profile', () => {
    for (const [id] of SCENARIOS) {
      const profile = getProfile(id)!;
      expect(botsSupported(profile), id).toBe(false);
      expect(profileBotLevels(profile), id).toEqual([]);
    }
  });
});
