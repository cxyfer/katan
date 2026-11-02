import { describe, expect, it } from 'vitest';
import { RESOURCES } from '@catan/rules';
import { fallbackPolicy } from '../src/fallback.ts';
import { botSeed } from '../src/seed.ts';
import { applyDecision, newBotGame, nextDecision, viewFor, type BotSeat } from './harness.ts';

function fallbackSeats(players: number): BotSeat[] {
  return Array.from({ length: players }, (_, index) => ({
    id: `bot${index + 1}`,
    level: 'standard' as const,
    policy: fallbackPolicy,
  }));
}

describe('fallback policy', () => {
  for (const players of [3, 4, 5, 6]) {
    it(`only issues accepted commands and never stalls (${players} players)`, () => {
      for (const seed of [1, 2, 3]) {
        let { state, rng } = newBotGame(players, seed);
        const seats = fallbackSeats(players);
        const kinds = new Set<string>();
        for (let step = 0; step < 800; step++) {
          const decision = nextDecision(state, seats);
          // 全部座位都是 Bot 時，永遠有人該行動。
          expect(decision, `stalled at step ${step}, seed ${seed}`).not.toBeNull();
          const outcome = applyDecision(state, decision!, rng);
          if (!outcome.ok) expect.fail(JSON.stringify(outcome.failure));
          state = outcome.state;
          kinds.add(decision!.command.type);
        }
        expect(state.turn.phase).not.toBe('setup');
        // 不建造的保底策略會累積手牌，因此棄牌與強盜路徑都會被走到。
        expect([...kinds]).toEqual(
          expect.arrayContaining(['setup.placeBuilding', 'setup.placeRoad', 'turn.roll', 'turn.end']),
        );
        const total = state.players.reduce(
          (sum, player) => sum + RESOURCES.reduce((inner, resource) => inner + player.resources[resource], 0),
          0,
        );
        const bank = RESOURCES.reduce((sum, resource) => sum + state.bank[resource], 0);
        const supply = players >= 5 ? 24 * 5 : 19 * 5;
        expect(total + bank).toBe(supply);
      }
    });
  }

  it('leaves seats without a duty alone', () => {
    const { state } = newBotGame(4, 7);
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
