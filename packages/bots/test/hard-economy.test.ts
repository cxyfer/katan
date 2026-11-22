import { describe, expect, it } from 'vitest';
import { COSTS, type GameState } from '@katan/rules';
import { forceTurn, newGame } from '../../rules/test/helpers.ts';
import { emptyYield } from '../src/board.ts';
import { hardSettlementValue } from '../src/hard/economy.ts';
import { hardEtaRounds } from '../src/hard/eta.ts';
import { portTradeValue, ratesWithPort } from '../src/hard/ports.ts';
import { openingValue } from '../src/hard/setup.ts';
import { HardTurn } from '../src/hard/turn.ts';
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

describe('hard port value', () => {
  it('only values rates that speed up the target, without counting an owned rate twice', () => {
    const income = { ...emptyYield(), lumber: 3 };
    const lumberPort = ratesWithPort(bank, 'lumber');
    expect(portTradeValue(income, bank, lumberPort, 3, [{ ore: 1 }])).toBeCloseTo((16 - 8) / 17);
    expect(portTradeValue(income, bank, ratesWithPort(bank, 'ore'), 3, [{ ore: 1 }])).toBe(0);
    expect(portTradeValue(income, bank, lumberPort, 3, [{ lumber: 1 }])).toBe(0);
    expect(portTradeValue(income, lumberPort, ratesWithPort(lumberPort, 'lumber'), 3, [{ ore: 1 }])).toBe(0);
  });

  it('settlement scoring rewards a useful port but not a duplicate', () => {
    const { state } = newGame({ players: 3, seed: 7 });
    const { economy } = hardTurn(state);
    const vertex = 0;
    const targets = [COSTS.city];
    const mine = { ...emptyYield(), lumber: 20 };
    const model = { ...economy.model, hexResource: economy.model.hexResource.map(() => 'lumber' as const) };
    const withPort = { ...economy, model: { ...model, harborAt: ['lumber' as const] } };
    const withoutPort = { ...economy, model: { ...model, harborAt: [null] } };
    const normal = hardSettlementValue(withoutPort, vertex, mine, targets);
    expect(hardSettlementValue(withPort, vertex, mine, targets)).toBeGreaterThan(normal);
    expect(hardSettlementValue({ ...withPort, rates: { ...bank, lumber: 2 } }, vertex, mine, targets)).toBe(normal);
  });

  it('does not add an opening bonus for a specific port with no matching production', () => {
    const { state } = newGame({ players: 3, seed: 7 });
    const { model } = hardTurn(state);
    const withPort = { ...model, harborAt: ['ore' as const], hexResource: model.hexResource.map(() => 'lumber' as const) };
    expect(openingValue(withPort, 'p1', [0], undefined, false)).toBe(
      openingValue({ ...withPort, harborAt: [null] }, 'p1', [0], undefined, false),
    );
  });
});
