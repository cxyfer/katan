/**
 * Seafarers 其餘八個劇本（S0）：只登記、不啟用。
 * 這些 profile 是 disabled，房間建不起來；bot 座位拒絕見 `bots.test.ts`，
 * 這裡驗證大廳（`/api/profiles`）與人數檢查。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getProfile } from '@katan/rules';
import { startHarness, type TestHarness } from './helpers.ts';

const SCENARIOS = [
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

describe('seafarers further scenarios (S0 registry only; four islands, fog islands, through the desert and the forgotten tribe are live since S2–S5)', () => {
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
});
