import { describe, expect, it } from 'vitest';
import { fallbackPolicy } from '../src/fallback.ts';
import { botSeed } from '../src/seed.ts';
import {
  ALL_FALLBACK_SEEDS,
  ALL_FALLBACK_STEPS,
  createDecisionHasher,
  GAME_TIMEOUT,
  GENERIC_MATRIX,
  goldenId,
  goldenIdsFor,
  goldenMismatches,
  newBotGame,
  runBotGame,
  viewFor,
  type BotSeat,
} from './harness.ts';

function fallbackSeats(players: number): BotSeat[] {
  return Array.from({ length: players }, (_, index) => ({
    id: `bot${index + 1}`,
    level: 'standard' as const,
    policy: fallbackPolicy,
  }));
}

describe('fallback policy', () => {
  // 全部座位只走保底的有界局：只要求 0 拒絕且每一步都有動作，不要求終局
  // （保底從不建造，所以不會得分，看門狗必須關閉）。
  for (const entry of GENERIC_MATRIX) {
    const { profile, players } = entry;
    const golden = new Set(goldenIdsFor(entry));
    it(`only issues accepted commands and never stalls (${profile.id}, ${players} players)`, () => {
      let compared = 0;
      for (const seed of ALL_FALLBACK_SEEDS) {
        const kinds = new Set<string>();
        const hasher = createDecisionHasher();
        const run = runBotGame({
          seats: fallbackSeats(players),
          seed,
          profileId: profile.id,
          maxSteps: ALL_FALLBACK_STEPS,
          watchdogRolls: null,
          onDecision: (state, decision) => {
            kinds.add(decision.command.type);
            hasher.onDecision(state, decision);
          },
        });
        const label = `${profile.id} ${players}p seed ${seed}`;
        if (run.failure) expect.fail(`${label}: ${JSON.stringify(run.failure)}`);
        // 全部座位都是 Bot 時，永遠有人該行動。
        expect(run.stuck, `${label}: stalled at step ${run.steps}`).toBeNull();
        expect(run.steps, label).toBe(ALL_FALLBACK_STEPS);
        expect(run.state.turn.phase, label).not.toBe('setup');
        // 不建造的保底策略會累積手牌，因此棄牌與強盜路徑都會被走到。
        expect([...kinds], label).toEqual(
          expect.arrayContaining(['setup.placeBuilding', 'setup.placeRoad', 'turn.roll', 'turn.end']),
        );
        expect(run.conservation, label).toEqual([]);
        // base 與 v0.4.0 的全保底有界局逐步相同（golden 只錄種子 1）。
        const id = goldenId.allFallback(players, seed);
        if (golden.has(id)) {
          expect(goldenMismatches(id, run, hasher.digest()), `${label}: differs from the v0.4.0 golden`).toEqual([]);
          compared += 1;
        }
      }
      // 有 golden 記錄的 profile 必須真的比對到（種子 1）。
      expect(compared, `${profile.id} ${players}p: golden comparisons`).toBe(golden.size === 0 ? 0 : 1);
    }, GAME_TIMEOUT);
  }

  it('leaves seats without a duty alone', () => {
    const { state } = newBotGame({ profileId: 'base-2025', players: 4, seed: 7 });
    // 開局時輪到第一位放置，其他座位沒有強制義務。
    const [first, ...others] = state.players.map((player) => player.id);
    const ctx = (selfId: string) => ({ selfId, level: 'standard' as const, seed: botSeed(selfId), offerPhases: {} });
    expect(fallbackPolicy.decide(viewFor(state, first!), ctx(first!))?.type).toBe('setup.placeBuilding');
    for (const id of others) {
      expect(fallbackPolicy.decide(viewFor(state, id), ctx(id))).toBeNull();
    }
  });
});

describe('botSeed', () => {
  it('is stable and spreads nearby inputs', () => {
    expect(botSeed('game', 'bot1', 3)).toBe(botSeed('game', 'bot1', 3));
    expect(botSeed('game', 'bot1', 3)).not.toBe(botSeed('game', 'bot1', 4));
    expect(botSeed('game', 'bot1', 3)).toBeGreaterThanOrEqual(0);
    expect(botSeed('game', 'bot1', 3)).toBeLessThan(2 ** 32);
  });
});
