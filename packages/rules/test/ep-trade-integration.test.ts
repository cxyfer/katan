import { describe, expect, it } from 'vitest';
import { epState, landHo, refused, run } from './ep-helpers.ts';
import { setHand } from './helpers.ts';

describe('E&P goods trade integration', () => {
  it('checks the proposer at offer and revision and both parties at consent', () => {
    let state = landHo();
    setHand(state, 'p1', { lumber: 2 });
    setHand(state, 'p2', { ore: 1 });
    epState(state).gold.p1 = 1;
    epState(state).gold.p2 = 1;
    expect(refused(state, 'p1', { type: 'trade.offer', to: 'p2', give: {}, giveGoods: { gold: 2 }, want: { ore: 1 } })).toBe('E_INSUFFICIENT_RESOURCES');
    state = run(state, 'p1', { type: 'trade.offer', to: 'p2', give: {}, giveGoods: { gold: 1 }, want: { ore: 1 } }).state;
    const offerId = state.offers.at(-1)!.id;
    expect(refused(state, 'p1', { type: 'trade.revise', offerId, give: {}, giveGoods: { gold: 2 }, want: { ore: 1 } })).toBe('E_INSUFFICIENT_RESOURCES');
    state = run(state, 'p1', { type: 'trade.revise', offerId, give: { lumber: 1 }, want: {}, wantGoods: { gold: 2 } }).state;
    expect(refused(state, 'p2', { type: 'trade.respond', offerId, response: 'consented' })).toBe('E_INSUFFICIENT_RESOURCES');
    state = run(state, 'p1', { type: 'trade.revise', offerId, give: {}, giveGoods: { gold: 1 }, want: { ore: 1 } }).state;
    epState(state).gold.p1 = 0;
    expect(refused(state, 'p2', { type: 'trade.respond', offerId, response: 'consented' })).toBe('E_INSUFFICIENT_RESOURCES');
  });
});
