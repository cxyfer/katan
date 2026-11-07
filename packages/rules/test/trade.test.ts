/** R-B04: domestic exchange, bank/harbor rates and offer lifecycle. */

import { describe, expect, it } from 'vitest';
import { harborRates, topologyOf } from '../src/analysis.ts';
import { suspendNegotiation } from '../src/engine.ts';
import {
  act,
  expectRejected,
  handOf,
  playableGame,
  placeBuilding,
  setHand,
  scriptedRng,
} from './helpers.ts';

describe('R-B04 trading', () => {
  it('trades 4:1 with the bank without a harbor', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { lumber: 4 });
    const traded = act(
      state,
      'p1',
      { type: 'trade.bank', give: 'lumber', receive: 'ore' },
      scriptedRng([0]),
    ).state;
    expect(handOf(traded, 'p1').lumber).toBe(0);
    expect(handOf(traded, 'p1').ore).toBe(1);
    expect(traded.bank.lumber).toBe(state.bank.lumber + 4);
    expect(traded.bank.ore).toBe(state.bank.ore - 1);
  });

  it('uses the 3:1 generic harbor rate and the 2:1 resource harbor rate', () => {
    const { state } = playableGame({ players: 4 });
    const topo = topologyOf(state);
    const generic = state.board.layout.harbors.find((harbor) => harbor.type === 'generic')!;
    const specific = state.board.layout.harbors.find((harbor) => harbor.type === 'ore')!;
    state.board.buildings = state.board.buildings.map(() => null);
    placeBuilding(state, 'p1', topo.edges[generic.edge]!.vertices[0]!, false);

    expect(harborRates(state, 'p1').lumber).toBe(3);
    setHand(state, 'p1', { lumber: 3, ore: 0 });
    const traded = act(
      state,
      'p1',
      { type: 'trade.bank', give: 'lumber', receive: 'ore' },
      scriptedRng([0]),
    ).state;
    expect(handOf(traded, 'p1').ore).toBe(1);

    // A second harbor of a specific resource lowers only that resource.
    placeBuilding(traded, 'p1', topo.edges[specific.edge]!.vertices[0]!, false);
    const rates = harborRates(traded, 'p1');
    expect(rates.ore).toBe(2);
    expect(rates.lumber).toBe(3);
    setHand(traded, 'p1', { ore: 2, wool: 0 });
    const second = act(
      traded,
      'p1',
      { type: 'trade.bank', give: 'ore', receive: 'wool' },
      scriptedRng([0]),
    ).state;
    expect(handOf(second, 'p1').wool).toBe(1);
  });

  it('rejects bank trades without enough cards and same-resource trades', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { lumber: 3 });
    expectRejected(
      state,
      'p1',
      { type: 'trade.bank', give: 'lumber', receive: 'ore' },
      'E_INSUFFICIENT_RESOURCES',
    );
    expectRejected(
      state,
      'p1',
      { type: 'trade.bank', give: 'lumber', receive: 'lumber' },
      'E_INVALID_SELECTION',
    );
  });

  it('rejects a bank trade when the bank has none of the wanted resource', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { lumber: 4 });
    state.bank.ore = 0;
    expectRejected(
      state,
      'p1',
      { type: 'trade.bank', give: 'lumber', receive: 'ore' },
      'E_BANK_EMPTY',
    );
  });

  it('refuses offers from anyone but the action-window actor', () => {
    const { state } = playableGame({ players: 4 });
    expectRejected(
      state,
      'p2',
      { type: 'trade.offer', to: 'p3', give: { lumber: 1 }, want: { ore: 1 } },
      'E_NOT_YOUR_TURN',
    );
  });

  it('rejects empty-sided offers and self offers', () => {
    const { state } = playableGame({ players: 4 });
    expectRejected(
      state,
      'p1',
      { type: 'trade.offer', to: 'all', give: {}, want: { ore: 1 } },
      'E_INVALID_SELECTION',
    );
    expectRejected(
      state,
      'p1',
      { type: 'trade.offer', to: 'all', give: { lumber: 1 }, want: {} },
      'E_INVALID_SELECTION',
    );
    expectRejected(
      state,
      'p1',
      { type: 'trade.offer', to: 'p1', give: { lumber: 1 }, want: { ore: 1 } },
      'E_INVALID_SELECTION',
    );
  });

  it('settles only with a consenting counterparty and transfers once', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { lumber: 2, ore: 0 });
    setHand(state, 'p2', { ore: 1, lumber: 0 });

    let current = act(
      state,
      'p1',
      { type: 'trade.offer', to: 'all', give: { lumber: 1 }, want: { ore: 1 } },
      scriptedRng([0]),
    ).state;
    const offerId = current.offers[0]!.id;

    expectRejected(
      current,
      'p1',
      { type: 'trade.settle', offerId, counterparty: 'p2' },
      'E_NOT_CONSENTED',
    );
    // A third party may not respond to a targeted offer.
    current = act(
      current,
      'p1',
      { type: 'trade.withdraw', offerId },
      scriptedRng([0]),
    ).state;
    current = act(
      current,
      'p1',
      { type: 'trade.offer', to: 'p2', give: { lumber: 1 }, want: { ore: 1 } },
      scriptedRng([0]),
    ).state;
    const targeted = current.offers[1]!.id;
    expectRejected(
      current,
      'p3',
      { type: 'trade.respond', offerId: targeted, response: 'consented' },
      'E_NOT_RECIPIENT',
    );

    current = act(
      current,
      'p2',
      { type: 'trade.respond', offerId: targeted, response: 'consented' },
      scriptedRng([0]),
    ).state;
    current = act(current, 'p1', { type: 'trade.settle', offerId: targeted }, scriptedRng([0])).state;
    expect(handOf(current, 'p1').lumber).toBe(1);
    expect(handOf(current, 'p1').ore).toBe(1);
    expect(handOf(current, 'p2').ore).toBe(0);
    expect(handOf(current, 'p2').lumber).toBe(1);
    expect(current.offers.find((offer) => offer.id === targeted)!.status).toBe('completed');

    // A completed exchange cannot settle twice.
    expectRejected(current, 'p1', { type: 'trade.settle', offerId: targeted }, 'E_OFFER_CLOSED');
  });

  it('rejects settlement when either side no longer holds the cards', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { lumber: 1 });
    setHand(state, 'p2', { ore: 1 });
    let current = act(
      state,
      'p1',
      { type: 'trade.offer', to: 'p2', give: { lumber: 1 }, want: { ore: 1 } },
      scriptedRng([0]),
    ).state;
    const offerId = current.offers[0]!.id;
    current = act(
      current,
      'p2',
      { type: 'trade.respond', offerId, response: 'consented' },
      scriptedRng([0]),
    ).state;
    // The counterparty spends the promised card on a bank trade.
    current.turn.seat = 0;
    current.turn.phase = 'action';
    current.players[1]!.resources.ore = 0;
    expectRejected(
      current,
      'p1',
      { type: 'trade.settle', offerId },
      'E_INSUFFICIENT_RESOURCES',
    );
  });

  it('invalidates consent when the terms are revised', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { lumber: 2 });
    setHand(state, 'p2', { ore: 2 });
    let current = act(
      state,
      'p1',
      { type: 'trade.offer', to: 'p2', give: { lumber: 1 }, want: { ore: 1 } },
      scriptedRng([0]),
    ).state;
    const offerId = current.offers[0]!.id;
    current = act(
      current,
      'p2',
      { type: 'trade.respond', offerId, response: 'consented' },
      scriptedRng([0]),
    ).state;
    current = act(
      current,
      'p1',
      { type: 'trade.revise', offerId, give: { lumber: 2 }, want: { ore: 1 } },
      scriptedRng([0]),
    ).state;
    const offer = current.offers.find((candidate) => candidate.id === offerId)!;
    expect(offer.revision).toBe(2);
    expect(offer.responses).toEqual({});
    expectRejected(current, 'p1', { type: 'trade.settle', offerId }, 'E_NOT_CONSENTED');
  });

  it('expires open and agreed offers when the table suspends, keeping everything else', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { lumber: 2 });
    setHand(state, 'p2', { ore: 1 });
    let current = act(
      state,
      'p1',
      { type: 'trade.offer', to: 'p2', give: { lumber: 1 }, want: { ore: 1 } },
      scriptedRng([0]),
    ).state;
    current = act(current, 'p2', { type: 'trade.respond', offerId: current.offers[0]!.id, response: 'consented' }, scriptedRng([0])).state;
    current = act(
      current,
      'p1',
      { type: 'trade.offer', to: 'all', give: { lumber: 1 }, want: { ore: 1 } },
      scriptedRng([0]),
    ).state;
    const snapshot = JSON.parse(JSON.stringify(current)) as typeof current;

    const frozen = suspendNegotiation(current);
    expect(frozen).not.toBe(current);
    expect(current).toEqual(snapshot);
    expect(frozen.offers.map((offer) => offer.status)).toEqual(['expired', 'expired']);
    expect(frozen.log.slice(-2).map((event) => [event.type, event.params.reason])).toEqual([
      ['trade.expired', 'suspended'],
      ['trade.expired', 'suspended'],
    ]);
    // 暫停不是規則：回合、待決效果與手牌都不變。
    expect(frozen.turn).toEqual(current.turn);
    expect(frozen.pending).toEqual(current.pending);
    expect(handOf(frozen, 'p1')).toEqual(handOf(current, 'p1'));
    // 已經沒有可取消的報價：回傳同一個物件，不產生新的修訂版本。
    expect(suspendNegotiation(frozen)).toBe(frozen);
  });

  it('expires open offers when the action window ends', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { lumber: 1 });
    setHand(state, 'p2', { ore: 1 });
    let current = act(
      state,
      'p1',
      { type: 'trade.offer', to: 'p2', give: { lumber: 1 }, want: { ore: 1 } },
      scriptedRng([0]),
    ).state;
    const offerId = current.offers[0]!.id;
    current = act(
      current,
      'p2',
      { type: 'trade.respond', offerId, response: 'consented' },
      scriptedRng([0]),
    ).state;
    current = act(current, 'p1', { type: 'turn.end' }, scriptedRng([0])).state;
    expect(current.offers.find((offer) => offer.id === offerId)!.status).toBe('expired');
    current.turn.seat = 0;
    current.turn.phase = 'action';
    expectRejected(current, 'p1', { type: 'trade.settle', offerId }, 'E_OFFER_CLOSED');
  });

  it('lets the originator withdraw an open offer', () => {
    const { state } = playableGame({ players: 4 });
    let current = act(
      state,
      'p1',
      { type: 'trade.offer', to: 'all', give: { lumber: 1 }, want: { ore: 1 } },
      scriptedRng([0]),
    ).state;
    const offerId = current.offers[0]!.id;
    expectRejected(current, 'p2', { type: 'trade.withdraw', offerId }, 'E_NOT_ACTOR');
    current = act(current, 'p1', { type: 'trade.withdraw', offerId }, scriptedRng([0])).state;
    expect(current.offers[0]!.status).toBe('withdrawn');
  });

  it('requires a counterparty when settling an offer to the whole table', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { lumber: 1 });
    setHand(state, 'p2', { ore: 1 });
    let current = act(
      state,
      'p1',
      { type: 'trade.offer', to: 'all', give: { lumber: 1 }, want: { ore: 1 } },
      scriptedRng([0]),
    ).state;
    const offerId = current.offers[0]!.id;
    expectRejected(current, 'p1', { type: 'trade.settle', offerId }, 'E_INVALID_SELECTION');
    current = act(
      current,
      'p2',
      { type: 'trade.respond', offerId, response: 'consented' },
      scriptedRng([0]),
    ).state;
    current = act(
      current,
      'p1',
      { type: 'trade.settle', offerId, counterparty: 'p2' },
      scriptedRng([0]),
    ).state;
    expect(handOf(current, 'p1').ore).toBe(1);
  });

  it('lets a recipient settle a counteroffer addressed to them', () => {
    const { state } = playableGame({ players: 4 });
    setHand(state, 'p1', { lumber: 1 });
    setHand(state, 'p2', { ore: 1 });
    // p2 counters p1's offer with a new offer addressed to p1.
    let current = act(
      state,
      'p1',
      { type: 'trade.offer', to: 'p2', give: { lumber: 1 }, want: { ore: 2 } },
      scriptedRng([0]),
    ).state;
    current = act(
      current,
      'p2',
      { type: 'trade.offer', to: 'p1', give: { ore: 1 }, want: { lumber: 1 } },
      scriptedRng([0]),
    ).state;
    const counter = current.offers[1]!.id;
    current = act(current, 'p1', { type: 'trade.settle', offerId: counter }, scriptedRng([0])).state;
    expect(handOf(current, 'p1').ore).toBe(1);
    expect(handOf(current, 'p2').lumber).toBe(1);
  });
});
