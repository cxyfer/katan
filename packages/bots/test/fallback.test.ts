import { describe, expect, it } from 'vitest';
import { fallbackPolicy } from '../src/fallback.ts';
import { botSeed } from '../src/seed.ts';
import { GAME_TIMEOUT, GENERIC_MATRIX, newBotGame, runBotGame, viewFor, type BotSeat } from './harness.ts';

const BOUNDED_STEPS = 800;

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
  for (const { profile, players } of GENERIC_MATRIX) {
    it(`only issues accepted commands and never stalls (${profile.id}, ${players} players)`, () => {
      for (const seed of [1, 2, 3]) {
        const kinds = new Set<string>();
        const run = runBotGame({
          seats: fallbackSeats(players),
          seed,
          profileId: profile.id,
          maxSteps: BOUNDED_STEPS,
          watchdogRolls: null,
          onDecision: (_state, decision) => kinds.add(decision.command.type),
        });
        const label = `${profile.id} ${players}p seed ${seed}`;
        if (run.failure) expect.fail(`${label}: ${JSON.stringify(run.failure)}`);
        // 全部座位都是 Bot 時，永遠有人該行動。
        expect(run.stuck, `${label}: stalled at step ${run.steps}`).toBeNull();
        expect(run.steps, label).toBe(BOUNDED_STEPS);
        expect(run.state.turn.phase, label).not.toBe('setup');
        // 不建造的保底策略會累積手牌，因此棄牌與強盜路徑都會被走到。
        expect([...kinds], label).toEqual(
          expect.arrayContaining(['setup.placeBuilding', 'setup.placeRoad', 'turn.roll', 'turn.end']),
        );
        expect(run.conservation, label).toEqual([]);
      }
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
