/**
 * R-CK progress cards, trade deck, and the merchant (CK25 pp. 7, 10, 14–15;
 * CK-FAQ 58–62, 76–78, 109, 115). Each card: timing, targets, effect,
 * required responses, information access, deck return and refusal boundary.
 */

import { describe, expect, it } from 'vitest';
import { scoreOf } from '../src/analysis.ts';
import { actionHints } from '../src/engine.ts';
import { projectEvent, projectGame } from '../src/project.ts';
import { ckView } from '../src/modules/citiesKnights/state.ts';
import type { GameState } from '../src/types.ts';
import {
  actCk,
  bottomOf,
  cornersOf,
  emptyCkGame,
  eventsOf,
  giveCommodities,
  handCards,
  hexWith,
  hints,
  moduleFrame,
  player,
  playCard,
  rejectCard,
  rejectCk,
  setBuilding,
  spreadVertices,
  totalHand,
} from './ck-helpers.ts';
import { give } from './helpers.ts';

/** p2 and p3 ahead of p1 on points (2 and 1 settlements against none). */
function rankedGame(): GameState {
  const state = emptyCkGame(4);
  const [a, b, c] = spreadVertices(state, 3);
  setBuilding(state, 'p2', a!, false);
  setBuilding(state, 'p2', b!, false);
  setBuilding(state, 'p3', c!, false);
  return state;
}

describe('R-CK Commercial Harbor (CK25 p. 14; CK-FAQ 76–78)', () => {
  it('PC-CH1 offers one resource to each other player, once each, at any time this turn; the receiver chooses the commodity', () => {
    const state = emptyCkGame(4);
    give(state, 'p1', { ore: 2, wool: 1 });
    giveCommodities(state, 'p2', { paper: 1, coin: 1 });
    giveCommodities(state, 'p3', { cloth: 2 });
    handCards(state, 'p1', ['commercialHarbor']);
    const played = playCard(state, 'p1', 'commercialHarbor');
    expect(bottomOf(played.state, 'trade')).toBe('commercialHarbor');
    expect(hints(played.state, 'p1').harborTargets).toEqual(['p2', 'p3', 'p4']);
    // p2 holds two commodity kinds: a prompt for p2 only.
    const offered = actCk(played.state, 'p1', { type: 'progress.harborOffer', to: 'p2', resource: 'ore' });
    const frame = moduleFrame(offered.state)!;
    expect(frame).toMatchObject({ kind: 'citiesKnights.harborExchange', responders: ['p2'] });
    // Only the two players see the offered resource.
    expect(projectGame(offered.state, 'p2').pending).toMatchObject({ data: { from: 'p1', resource: 'ore' } });
    expect((projectGame(offered.state, 'p3').pending as any).data.resource).toBeUndefined();
    expect(rejectCk(offered.state, 'p1', { type: 'progress.harborAnswer', commodity: 'coin' })).toBe('E_NOT_ACTOR');
    expect(rejectCk(offered.state, 'p2', { type: 'progress.harborAnswer', commodity: 'cloth' })).toBe('E_INVALID_SELECTION');
    const answered = actCk(offered.state, 'p2', { type: 'progress.harborAnswer', commodity: 'coin' });
    expect(player(answered.state, 'p1')).toMatchObject({ resources: { ore: 1 }, commodities: { coin: 1 } });
    expect(player(answered.state, 'p2')).toMatchObject({ resources: { ore: 1 }, commodities: { coin: 0, paper: 1 } });
    const exchanged = eventsOf(answered, 'ck.harborExchanged')[0]!;
    expect(projectEvent(exchanged, 'p4').params).toEqual({ playerId: 'p1', to: 'p2' });
    expect(projectEvent(exchanged, 'p2').params).toMatchObject({ resource: 'ore', commodity: 'coin' });
    // One offer per player.
    expect(rejectCk(answered.state, 'p1', { type: 'progress.harborOffer', to: 'p2', resource: 'ore' })).toBe('E_ILLEGAL_TARGET');
    // A receiver with one commodity kind gives it without a prompt (P3-2).
    const forced = actCk(answered.state, 'p1', { type: 'progress.harborOffer', to: 'p3', resource: 'wool' });
    expect(forced.state.pending).toBeNull();
    expect(player(forced.state, 'p1').commodities.cloth).toBe(1);
    // A receiver without commodities: the resource is taken back.
    const back = actCk(forced.state, 'p1', { type: 'progress.harborOffer', to: 'p4', resource: 'ore' });
    expect(player(back.state, 'p1').resources.ore).toBe(1);
    expect(eventsOf(back, 'ck.harborReturned')).toHaveLength(1);
    expect(hints(back.state, 'p1').harborTargets).toEqual([]);
  });

  it('PC-CH2 offers end with the turn and need a resource; two cards allow two offers per player', () => {
    const state = emptyCkGame(4);
    give(state, 'p1', { ore: 1 });
    handCards(state, 'p1', ['commercialHarbor', 'commercialHarbor']);
    const once = playCard(state, 'p1', 'commercialHarbor');
    const twice = playCard(once.state, 'p1', 'commercialHarbor');
    expect(ckView(twice.state).harbor!.offers.p2).toBe(2);
    expect(rejectCk(twice.state, 'p1', { type: 'progress.harborOffer', to: 'p2', resource: 'lumber' })).toBe('E_INSUFFICIENT_RESOURCES');
    const ended = actCk(twice.state, 'p1', { type: 'turn.end' });
    expect(projectGame(ended.state, 'p1').modules!.citiesKnights).toMatchObject({ harbor: null });
    expect(rejectCk(ended.state, 'p1', { type: 'progress.harborOffer', to: 'p2', resource: 'ore' })).toBe('E_NOT_YOUR_TURN');
  });
});

describe('R-CK Guild Dues (CK25 p. 14)', () => {
  it('PC-GD1 targets only richer players; the player sees that hand alone and takes any 2 cards', () => {
    const state = rankedGame();
    give(state, 'p2', { ore: 2, grain: 1 });
    giveCommodities(state, 'p2', { coin: 1 });
    handCards(state, 'p1', ['guildDues']);
    expect(hints(state, 'p1').progress[0].targets.players).toEqual(['p2', 'p3']);
    expect(rejectCard(state, 'p1', 'guildDues', { target: 'p4' })).toBe('E_ILLEGAL_TARGET');
    const played = playCard(state, 'p1', 'guildDues', { target: 'p2' });
    expect(moduleFrame(played.state)).toMatchObject({ kind: 'citiesKnights.guildDues', responders: ['p1'] });
    expect((projectGame(played.state, 'p1').pending as any).data.hand).toEqual({ grain: 1, ore: 2, coin: 1 });
    expect((projectGame(played.state, 'p3').pending as any).data.hand).toBeUndefined();
    expect(rejectCk(played.state, 'p1', { type: 'progress.takeCards', cards: ['ore'] })).toBe('E_INVALID_DISCARD_COUNT');
    expect(rejectCk(played.state, 'p1', { type: 'progress.takeCards', cards: ['wool', 'ore'] })).toBe('E_INVALID_SELECTION');
    const taken = actCk(played.state, 'p1', { type: 'progress.takeCards', cards: ['coin', 'ore'] });
    expect(player(taken.state, 'p1')).toMatchObject({ resources: { ore: 1 }, commodities: { coin: 1 } });
    expect(totalHand(taken.state, 'p2')).toBe(2);
    const event = eventsOf(taken, 'ck.guildDuesTaken')[0]!;
    expect(projectEvent(event, 'p3').params).toEqual({ playerId: 'p1', victim: 'p2', count: 2 });
    expect(bottomOf(taken.state, 'trade')).toBe('guildDues');
  });

  it('PC-GD2 a hand of two or fewer cards is taken without a prompt; nobody richer means no target', () => {
    const state = rankedGame();
    give(state, 'p3', { brick: 1 });
    handCards(state, 'p1', ['guildDues']);
    const played = playCard(state, 'p1', 'guildDues', { target: 'p3' });
    expect(played.state.pending).toBeNull();
    expect(player(played.state, 'p1').resources.brick).toBe(1);
    const flat = emptyCkGame(4);
    handCards(flat, 'p1', ['guildDues']);
    expect(hints(flat, 'p1').progress[0]).toMatchObject({ playable: false, reason: 'no-target' });
  });
});

describe('R-CK Merchant (CK25 pp. 7, 14; CK-FAQ 58–62)', () => {
  it('PC-MC1 placed next to an own building: 1 VP and a 2:1 rate for that resource, from this turn', () => {
    const state = emptyCkGame(4);
    const pasture = hexWith(state, 'pasture');
    const corner = cornersOf(state, pasture)[0]!;
    setBuilding(state, 'p1', corner, false);
    give(state, 'p1', { wool: 2 });
    handCards(state, 'p1', ['merchant']);
    expect(rejectCard(state, 'p1', 'merchant', { hex: farHex(state, corner) })).toBe('E_ILLEGAL_TARGET');
    const before = scoreOf(state, 'p1', { includeHidden: false });
    const played = playCard(state, 'p1', 'merchant', { hex: pasture });
    expect(ckView(played.state).merchant).toEqual({ player: 'p1', hex: pasture });
    expect(scoreOf(played.state, 'p1', { includeHidden: false })).toBe(before + 1);
    expect(actionHints(played.state, 'p1').bankRates.wool).toBe(2);
    expect(actionHints(played.state, 'p2').bankRates.wool).toBe(4);
    // The rate buys commodities too (FAQ 61).
    const traded = actCk(played.state, 'p1', { type: 'trade.bank', give: 'wool', receive: 'cloth' });
    expect(player(traded.state, 'p1').commodities.cloth).toBe(1);
    expect(bottomOf(played.state, 'trade')).toBe('merchant');
  });

  it('PC-MC2 another Merchant takes control and the VP; the current hex is a legal target; the robber does not stop the rate', () => {
    const state = emptyCkGame(4);
    const hills = hexWith(state, 'hills');
    const [a, , c] = cornersOf(state, hills);
    setBuilding(state, 'p1', a!, false);
    setBuilding(state, 'p2', c!, false);
    handCards(state, 'p1', ['merchant']);
    handCards(state, 'p2', ['merchant']);
    const first = playCard(state, 'p1', 'merchant', { hex: hills });
    first.state.turn.seat = 1;
    first.state.windowId += 1;
    first.state.board.robber = hills;
    const second = playCard(first.state, 'p2', 'merchant', { hex: hills });
    expect(ckView(second.state).merchant).toEqual({ player: 'p2', hex: hills });
    expect(eventsOf(second, 'ck.merchantPlaced')[0]!.params).toMatchObject({ from: 'p1', fromHex: hills });
    expect(actionHints(second.state, 'p2').bankRates.brick).toBe(2);
    expect(actionHints(second.state, 'p1').bankRates.brick).toBe(4);
    expect(projectGame(second.state, 'p3').modules!.citiesKnights).toMatchObject({ merchant: { player: 'p2', hex: hills } });
  });

  it('PC-MC3 on the desert it gives the VP only; a Merchant VP can win the game', () => {
    const state = emptyCkGame(4);
    const desert = hexWith(state, 'desert');
    setBuilding(state, 'p1', cornersOf(state, desert)[0]!, false);
    player(state, 'p1').defenders = 11;
    handCards(state, 'p1', ['merchant']);
    const played = playCard(state, 'p1', 'merchant', { hex: desert });
    expect(played.state.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
  });
});

/** A land hex not touching `vertex`. */
function farHex(state: GameState, vertex: number): number {
  for (let hex = 0; hex < state.board.layout.terrain.length; hex++) {
    if (state.board.layout.terrain[hex] === 'sea') continue;
    if (!cornersOf(state, hex).includes(vertex)) return hex;
  }
  throw new Error('no far hex');
}

describe('R-CK Merchant Fleet (CK25 p. 15; CK-FAQ 109)', () => {
  it('PC-MF1 one named resource or commodity trades 2:1 for the rest of the turn only', () => {
    const state = emptyCkGame(4);
    giveCommodities(state, 'p1', { cloth: 4 });
    handCards(state, 'p1', ['merchantFleet']);
    expect(rejectCard(state, 'p1', 'merchantFleet', { kind: 'gold' })).toBe('E_INVALID_SELECTION');
    const played = playCard(state, 'p1', 'merchantFleet', { kind: 'cloth' });
    expect(hints(played.state, 'p1').commodityRates.cloth).toBe(2);
    const once = actCk(played.state, 'p1', { type: 'trade.bank', give: 'cloth', receive: 'ore' });
    const twice = actCk(once.state, 'p1', { type: 'trade.bank', give: 'cloth', receive: 'paper' });
    expect(player(twice.state, 'p1')).toMatchObject({ resources: { ore: 1 }, commodities: { cloth: 0, paper: 1 } });
    const ended = actCk(played.state, 'p1', { type: 'turn.end' });
    ended.state.turn.seat = 0;
    ended.state.turn.phase = 'action';
    ended.state.windowId += 1;
    expect(hints(ended.state, 'p1').commodityRates.cloth).toBe(4);
  });
});

describe('R-CK Resource and Trade Monopoly (CK25 pp. 10, 15; CK-FAQ 115)', () => {
  it('PC-RM1 takes 2 of the named resource from each player, 1 from a player holding only 1', () => {
    const state = emptyCkGame(4);
    give(state, 'p2', { grain: 5 });
    give(state, 'p3', { grain: 1 });
    handCards(state, 'p1', ['resourceMonopoly']);
    expect(rejectCard(state, 'p1', 'resourceMonopoly', { kind: 'cloth' })).toBe('E_INVALID_SELECTION');
    const played = playCard(state, 'p1', 'resourceMonopoly', { kind: 'grain' });
    expect(player(played.state, 'p1').resources.grain).toBe(3);
    expect(player(played.state, 'p2').resources.grain).toBe(3);
    expect(eventsOf(played, 'ck.monopolyTaken')[0]!.params).toMatchObject({ taken: { p2: 2, p3: 1 } });
  });

  it('PC-RM2 nobody holding the resource: still played, no refund (CK25 p. 10 example)', () => {
    const state = emptyCkGame(4);
    handCards(state, 'p1', ['resourceMonopoly']);
    const played = playCard(state, 'p1', 'resourceMonopoly', { kind: 'wool' });
    expect(player(played.state, 'p1').progressCards).toEqual([]);
    expect(bottomOf(played.state, 'trade')).toBe('resourceMonopoly');
  });

  it('PC-TM1 takes 1 of the named commodity from each player who has it', () => {
    const state = emptyCkGame(4);
    giveCommodities(state, 'p2', { coin: 3 });
    giveCommodities(state, 'p4', { coin: 1 });
    handCards(state, 'p1', ['tradeMonopoly']);
    expect(rejectCard(state, 'p1', 'tradeMonopoly', { kind: 'ore' })).toBe('E_INVALID_SELECTION');
    const played = playCard(state, 'p1', 'tradeMonopoly', { kind: 'coin' });
    expect(player(played.state, 'p1').commodities.coin).toBe(2);
    expect(player(played.state, 'p2').commodities.coin).toBe(2);
  });
});
