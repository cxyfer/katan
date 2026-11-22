import { describe, expect, it } from 'vitest';
import { COSTS, type GameState } from '@katan/rules';
import { forceTurn, newGame } from '../../rules/test/helpers.ts';
import { emptyYield, isLandEdge, playerYield } from '../src/board.ts';
import { hardSettlementValue, settlementPortTargets } from '../src/hard/economy.ts';
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

describe('hard expansion and Largest Army', () => {
  it('discounts the same spot more when a rival road reaches it', () => {
    const { state } = newGame({ players: 3, seed: 7 });
    forceTurn(state, 0, 'action');
    state.board.buildings[0] = { player: 'p1', city: false };
    const { economy, model } = hardTurn(state);
    const open = economy.plans.find((plan) => plan.kind === 'settlement')!;
    const vertex = open.vertex!;
    const rivalEdge = model.topo.vertices[vertex]!.edges.find((edge) => !open.roads.includes(edge) && isLandEdge(model, edge));
    expect(rivalEdge).toBeDefined();
    const raw = hardSettlementValue(economy, vertex, playerYield(model, 'p1', true), settlementPortTargets(economy));
    expect(open.value / raw).toBeCloseTo(0.95 ** open.roads.length);

    state.board.roads[rivalEdge!] = { player: 'p2', ship: false };
    const contested = hardTurn(state).economy.plans.find((plan) => plan.kind === 'settlement' && plan.vertex === vertex)!;
    expect(contested.roads).toEqual(open.roads);
    expect(contested.eta).toBe(open.eta);
    expect(contested.value / raw).toBeCloseTo(0.85 ** contested.roads.length);
  });

  it('values the same knight pool more at one knight short than at two', () => {
    const { state } = newGame({ players: 3, seed: 7 });
    forceTurn(state, 0, 'action');
    state.board.buildings[0] = { player: 'p1', city: false };
    state.awards.largestArmy = 'p2';
    for (const player of state.players) player.playedKnights = 3;
    const near = hardTurn(state);
    state.players[1]!.playedKnights = 4;
    state.players[2]!.playedKnights = 2;
    const far = hardTurn(state);
    expect(near.belief.dev.unseen).toEqual(far.belief.dev.unseen);
    expect(near.economy.plans.find((plan) => plan.kind === 'devCard')!.value).toBeGreaterThan(
      far.economy.plans.find((plan) => plan.kind === 'devCard')!.value,
    );
  });
});
