/**
 * 全部座位只走保底的有界局（T&B 計畫 §4.1 保底的驗收、§6.1 最後一列；S2），4 人。依 §6.6 的拆檔規則與 4 人分開
 * （`tb-fallback.3p.test.ts`），內容相同。
 *
 * 8 個 profile 各跑 1 個種子、800 步：gating 關著也能跑，因為 `fallbackPolicy` 依 profile 直接取註冊的模組（不看
 * `botsCanPlay`）。只要求 0 拒絕、每一步都有動作、守恆，不要求終局。
 */

import { describe, expect, it } from 'vitest';
import { fallbackPolicy } from '../src/fallback.ts';
import { ALL_FALLBACK_STEPS, GAME_TIMEOUT, runBotGame, type BotSeat } from './harness.ts';
import { tradersBarbariansKit } from './modules/tradersBarbarians.ts';

const BA = 'tb-barbarian-attack-2025';
const TRADERS = 'tb-traders-barbarians-2025';
const players = 4;

// ---------------------------------------------------------------------------
// 全部座位只走保底的有界局（§4.1 保底的驗收；§6.1 最後一列）
// ---------------------------------------------------------------------------

const BOUNDED_PROFILES = [
  'tb-friendly-robber-2025',
  'tb-harbors-2025',
  'tb-friendly-robber-harbors-2025',
  'tb-fishing-2025',
  'tb-rivers-2025',
  'tb-merchant-trains-2025',
  'tb-barbarian-attack-2025',
  'tb-traders-barbarians-2025',
] as const;

function fallbackSeats(players: number): BotSeat[] {
  return Array.from({ length: players }, (_, index) => ({ id: `bot${index + 1}`, level: 'standard' as const, policy: fallbackPolicy }));
}

describe('all-fallback bounded games (4 players)', () => {
  for (const profileId of BOUNDED_PROFILES) {
    it(`only issues accepted commands and never stalls (${profileId}, ${players} players)`, () => {
      const kinds = new Set<string>();
      const run = runBotGame({
        seats: fallbackSeats(players),
        seed: 1,
        profileId,
        maxSteps: ALL_FALLBACK_STEPS,
        watchdogRolls: null,
        kits: [tradersBarbariansKit],
        onDecision: (_state, decision) => kinds.add(decision.command.type),
      });
      const label = `${profileId} ${players}p`;
      if (run.failure) expect.fail(`${label}: ${JSON.stringify(run.failure)}`);
      expect(run.stuck, `${label}: stalled at step ${run.steps}`).toBeNull();
      expect(run.steps, label).toBe(ALL_FALLBACK_STEPS);
      expect(run.state.turn.phase, label).not.toBe('setup');
      expect(run.conservation, label).toEqual([]);
      expect([...kinds], label).toEqual(
        expect.arrayContaining(['setup.placeBuilding', 'setup.placeRoad', 'turn.roll', 'turn.end', 'pending.discard']),
      );
      // 每回合結束都有車隊移動；擲出 7 時移動蠻族。
      if (profileId === TRADERS) expect([...kinds], label).toEqual(expect.arrayContaining(['tb.wagonStop', 'tb.moveBarbarian']));
      if (profileId === BA) expect([...kinds], label).toContain('tb.baSteal');
      if (profileId.includes('friendly-robber')) expect([...kinds], label).toContain('pending.moveRobber');
    }, GAME_TIMEOUT);
  }
});
