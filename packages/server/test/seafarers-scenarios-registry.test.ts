/**
 * Seafarers 其餘八個劇本（S2–S9）：S7c 啟用最後一個（海盜巢穴）後全部都在大廳可選。
 * 這裡驗證大廳（`/api/profiles`）與人數檢查；bot 座位拒絕見 `bots.test.ts`，各劇本的整局見各自的測試檔。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getProfile } from '@katan/rules';
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

describe('seafarers further scenarios (all eight are live; none is registered but disabled)', () => {
  it('lists every scenario as enabled for 3–4 players without bot seats and offers it for selection', async () => {
    const host = await harness.client('ScenarioLister');
    const data = host.expectOk<{
      profiles: { id: string; enabled: boolean; botSeats: boolean; botLevels: string[]; playerCounts: number[] }[];
      selectable: string[];
    }>(await host.get('/api/profiles'));
    for (const [id] of SCENARIOS) {
      expect(data.profiles.find((profile) => profile.id === id), id).toMatchObject({
        enabled: true, botSeats: false, botLevels: [], playerCounts: [3, 4],
      });
      expect(data.selectable).toContain(id);
    }
  });

  it('rejects 5 and 6 players with bad-player-count and accepts 3–4 by scenario', async () => {
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
        const room = host.expectOk<{ profileId: string }>(await host.post('/api/rooms', {
          visibility: 'private', capacity, setupMode, ruleset: { expansions: ['seafarers'], scenario },
        }));
        expect(room.profileId, `${id} ${capacity}`).toBe(id);
      }
    }
  });
});
