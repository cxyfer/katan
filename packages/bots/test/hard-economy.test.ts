import { describe, expect, it } from 'vitest';
import { forceTurn, newGame } from '../../rules/test/helpers.ts';
import { emptyYield } from '../src/board.ts';
import { hardEtaRounds } from '../src/hard/eta.ts';
import { HardTurn } from '../src/hard/turn.ts';
import type { GameState } from '@katan/rules';
import { viewFor } from './harness.ts';

const bank = { lumber: 4, brick: 4, wool: 4, grain: 4, ore: 4 };

function hardTurn(state: GameState): HardTurn {
  const view = viewFor(state, 'p1');
  return new HardTurn(view, { selfId: 'p1', level: 'hard', seed: 1, offerPhases: {} }, view.players[0]!);
}

describe('hard parallel ETA', () => {
  it('waits for the slower of two resources produced together', () => {
    const mine = { ...emptyYield(), lumber: 3, brick: 3 };
    expect(hardEtaRounds(emptyYield(), { lumber: 1, brick: 2 }, mine, bank, 3)).toBe(8);
  });

  it('reserves production for the plan and only trades full bundles of one resource', () => {
    const mine = { ...emptyYield(), lumber: 3 };
    const hand = { ...emptyYield(), lumber: 2, brick: 3 };
    const cost = { lumber: 2, ore: 1 };
    expect(hardEtaRounds(hand, cost, mine, bank, 3)).toBe(16);
    expect(hardEtaRounds(hand, cost, mine, { ...bank, lumber: 2 }, 3)).toBe(8);
    expect(hardEtaRounds(hand, cost, emptyYield(), bank, 3)).toBe(Infinity);
    expect(hardEtaRounds({ ...hand, brick: 4 }, cost, emptyYield(), bank, 3)).toBe(0.25);
  });

  it('scores every hard plan with its new ETA, including the extra time to place roads', () => {
    const { state } = newGame({ players: 3, seed: 7 });
    forceTurn(state, 0, 'action');
    state.board.buildings[0] = { player: 'p1', city: false };
    const { economy } = hardTurn(state);
    expect(economy.plans.map((plan) => plan.kind)).toEqual(expect.arrayContaining(['city', 'devCard', 'settlement']));
    expect(economy.plans.some((plan) => plan.kind === 'settlement' && plan.roads.length > 0)).toBe(true);
    for (const plan of economy.plans) {
      const buildTime = hardEtaRounds(economy.hand, plan.cost, economy.yield, economy.rates, 3);
      expect(plan.eta).toBe(buildTime + (plan.kind === 'settlement' ? plan.roads.length * 0.35 : 0));
      expect(plan.score).toBe(plan.value / (1 + plan.eta));
    }
  });
});
