/**
 * Seafarers 保底混座與保底義務測試（SF 計畫 §6.1）。
 *
 * - 保底混座：`[standard, fallback, easy, fallback, …]`，種子 1–3，800 步。
 *   純保底局永遠不造船，因此以混座驗證 0 拒絕、不卡死。
 * - 涵蓋 profile：'sf-new-shores-2025'（3、4 人）、'sf-new-shores-paired-2025'（5、6 人）。
 */

import { describe, expect, it } from 'vitest';
import { fallbackPolicy } from '../src/fallback.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import type { BotLevel, BotPolicy } from '../src/types.ts';
import {
  GAME_TIMEOUT,
  newBotGame,
  runBotGame,
  viewFor,
  type BotSeat,
} from './harness.ts';
import { seafarersKit } from './modules/seafarers.ts';

const SF_FALLBACK_STEPS = 800;
const SF_FALLBACK_SEEDS = [1, 2, 3] as const;

interface SFProfileCase {
  readonly profileId: 'sf-new-shores-2025' | 'sf-new-shores-paired-2025';
  readonly players: number;
}

const SF_CASES: readonly SFProfileCase[] = [
  { profileId: 'sf-new-shores-2025', players: 3 },
  { profileId: 'sf-new-shores-2025', players: 4 },
  { profileId: 'sf-new-shores-paired-2025', players: 5 },
  { profileId: 'sf-new-shores-paired-2025', players: 6 },
];

/** 座位模式：[standard, fallback, easy, fallback, …] */
function mixedFallbackSeats(players: number): BotSeat[] {
  const pattern: (BotLevel | 'fallback')[] = ['standard', 'fallback', 'easy', 'fallback'];
  return Array.from({ length: players }, (_, index) => {
    const role = pattern[index % pattern.length]!;
    const level: BotLevel = role === 'fallback' ? 'standard' : role;
    const policy: BotPolicy = role === 'fallback' ? fallbackPolicy : createBotPolicy(level);
    return {
      id: `bot${index + 1}`,
      level,
      policy,
    };
  });
}

describe('Seafarers fallback mixed seating', () => {
  for (const { profileId, players } of SF_CASES) {
    it(
      `only issues accepted commands and never stalls (${profileId}, ${players} players)`,
      () => {
        for (const seed of SF_FALLBACK_SEEDS) {
          const run = runBotGame({
            seats: mixedFallbackSeats(players),
            seed,
            profileId,
            maxSteps: SF_FALLBACK_STEPS,
            watchdogRolls: null,
            kits: [seafarersKit],
          });

          const label = `${profileId} ${players}p seed ${seed}`;
          expect(run.failure, `${label}: rejected command: ${JSON.stringify(run.failure)}`).toBeNull();
          expect(run.stuck, `${label}: stalled at step ${run.steps}`).toBeNull();
          expect(run.stalled, `${label}: game stalled`).toBe(false);
          if (!run.state.result) {
            expect(run.steps, `${label}: did not reach step limit`).toBe(SF_FALLBACK_STEPS);
          }
          expect(run.conservation, `${label}: conservation failed`).toEqual([]);
        }
      },
      GAME_TIMEOUT,
    );
  }

  it('leaves seats without a duty alone in Seafarers setup', () => {
    const { state } = newBotGame({ profileId: 'sf-new-shores-2025', players: 4, seed: 7 });
    const [first, ...others] = state.players.map((player) => player.id);
    const ctx = (selfId: string) => ({ selfId, level: 'standard' as const, seed: botSeed(selfId), offerPhases: {} });

    // 第一位放置聚落
    expect(fallbackPolicy.decide(viewFor(state, first!), ctx(first!))?.type).toBe('setup.placeBuilding');
    for (const id of others) {
      expect(fallbackPolicy.decide(viewFor(state, id), ctx(id))).toBeNull();
    }
  });
});
