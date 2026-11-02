/**
 * R-CK fixtures: setup, the three dice and their resolution order, the robber
 * before the first attack, commodity production and the progress-card draws
 * and hand limit. Each case cites its source clause (CK25 = CN3087).
 */

import { describe, expect, it } from 'vitest';
import { topologyOf } from '../src/analysis.ts';
import { actionHints } from '../src/engine.ts';
import { ckState, ckView } from '../src/modules/citiesKnights/state.ts';
import { scoreOf } from '../src/analysis.ts';
import { seededRng } from '../src/rng.ts';
import type { GameState } from '../src/types.ts';
import {
  POLITICS,
  SCIENCE,
  SHIP,
  TRADE,
  actCk,
  ckGame,
  cornersOf,
  emptyCkGame,
  eventsOf,
  hexWith,
  hints,
  moduleFrame,
  player,
  rejectCk,
  rollRng,
  setBuilding,
  setImprovement,
} from './ck-helpers.ts';
import { give, runSetup } from './helpers.ts';

/** A corner of `hex` touching no other producing hex with the same number. */
function soleCorner(state: GameState, hex: number): number {
  const topo = topologyOf(state);
  const number = state.board.layout.numbers[hex];
  const vertex = cornersOf(state, hex).find((candidate) =>
    topo.vertices[candidate]!.hexes.every((other) => other === hex || state.board.layout.numbers[other] !== number));
  if (vertex === undefined) throw new Error(`no sole corner on ${hex}`);
  return vertex;
}

describe('R-CK setup (CK25 p. 5)', () => {
  it('R-CK-01 places a settlement and road, then a city and road that takes the starting resources', () => {
    const { state } = ckGame(4);
    const done = runSetup(state, seededRng(7));
    for (const p of done.players) {
      const mine = done.board.buildings.filter((building) => building?.player === p.id);
      expect(mine.filter((building) => building!.city)).toHaveLength(1);
      expect(mine.filter((building) => !building!.city)).toHaveLength(1);
      expect(done.board.roads.filter((road) => road?.player === p.id)).toHaveLength(2);
    }
    // Starting resources come from the city's hexes: one per producing hex.
    const topo = topologyOf(done);
    for (const p of done.players) {
      const city = done.board.buildings.findIndex((building) => building?.player === p.id && building.city);
      const producing = topo.vertices[city]!.hexes.filter((hex) => done.board.layout.terrain[hex] !== 'desert' && done.board.layout.terrain[hex] !== 'sea').length;
      expect(Object.values(p.resources).reduce((a, b) => a + b, 0)).toBe(producing);
      expect(Object.values(p.commodities).reduce((a, b) => a + b, 0)).toBe(0);
    }
    expect(done.devDeck).toEqual([]);
    expect(ckView(done).barbarian).toBe(0);
  });

  it('R-CK-02 has no development cards and no Largest Army (CK25 p. 3)', () => {
    const state = emptyCkGame(4);
    give(state, 'p1', { wool: 1, grain: 1, ore: 1 });
    expect(rejectCk(state, 'p1', { type: 'build.devCard' })).toBe('E_INVALID_COMMAND');
    expect(rejectCk(state, 'p1', { type: 'dev.playKnight', hex: 0 })).toBe('E_INVALID_COMMAND');
  });
});

describe('R-CK dice order (CK25 p. 6)', () => {
  it('R-CK-03 rolls a yellow, a red and an event die; the event resolves before production', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    const forest = hexWith(state, 'forest', 11);
    setBuilding(state, 'p1', soleCorner(state, forest), true);
    const result = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(5, 6, SHIP));
    expect(result.state.turn.dice).toEqual([5, 6]);
    expect(ckView(result.state).lastRoll).toMatchObject({ event: 'ship', red: 6 });
    const order = result.events.map((event) => event.type);
    expect(order.indexOf('ck.eventRolled')).toBeLessThan(order.indexOf('ck.barbariansAdvanced'));
    expect(order.indexOf('ck.barbariansAdvanced')).toBeLessThan(order.indexOf('production.resolved'));
    expect(ckView(result.state).barbarian).toBe(1);
  });

  it('R-CK-04 a city on forest takes 1 lumber + 1 paper, on hills 2 brick; a settlement 1 resource (CK25 p. 7)', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    const forest = hexWith(state, 'forest', 11);
    const hills = hexWith(state, 'hills', 11);
    setBuilding(state, 'p1', soleCorner(state, forest), true);
    setBuilding(state, 'p2', soleCorner(state, hills), true);
    const settlementSite = cornersOf(state, forest).find((vertex) => vertex !== soleCorner(state, forest) && !topologyOf(state).vertices[vertex]!.hexes.includes(hills) &&
      topologyOf(state).vertices[soleCorner(state, forest)]!.edges.every((edge) => !topologyOf(state).edges[edge]!.vertices.includes(vertex)))!;
    setBuilding(state, 'p3', settlementSite, false);
    const { state: after, events } = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(5, 6, SCIENCE));
    expect(player(after, 'p1').resources.lumber).toBe(1);
    expect(player(after, 'p1').commodities.paper).toBe(1);
    expect(player(after, 'p2').resources.brick).toBe(2);
    expect(player(after, 'p2').commodities).toEqual({ paper: 0, cloth: 0, coin: 0 });
    expect(player(after, 'p3').resources.lumber).toBeGreaterThanOrEqual(1);
    expect(player(after, 'p3').commodities.paper).toBe(0);
    expect(after.commodityBank.paper).toBe(11);
    expect(eventsOf({ state: after, events }, 'ck.commoditiesProduced')[0]!.params).toMatchObject({ grants: { p1: { paper: 1 } } });
  });

  it('R-CK-05 the robber hex yields neither resources nor commodities once the robber is in play (CK25 p. 7)', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    const forest = hexWith(state, 'forest', 11);
    setBuilding(state, 'p1', soleCorner(state, forest), true);
    ckState(state).attacks = 1;
    state.board.robber = forest;
    const { state: after } = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(5, 6, SCIENCE));
    expect(player(after, 'p1').resources.lumber).toBe(0);
    expect(player(after, 'p1').commodities.paper).toBe(0);
  });

  it('R-CK-06 a commodity in short supply goes to nobody when several are owed (B25 shortage, CK25 p. 7)', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    const forest = hexWith(state, 'forest', 11);
    const corners = cornersOf(state, forest).filter((vertex) => topologyOf(state).vertices[vertex]!.hexes.every((hex) => hex === forest || state.board.layout.numbers[hex] !== 11));
    setBuilding(state, 'p1', corners[0]!, true);
    const far = corners.find((vertex) => vertex !== corners[0] && !topologyOf(state).vertices[corners[0]!]!.edges.some((edge) => topologyOf(state).edges[edge]!.vertices.includes(vertex)))!;
    setBuilding(state, 'p2', far, true);
    state.commodityBank.paper = 1;
    const { state: after } = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(5, 6, SCIENCE));
    expect(player(after, 'p1').commodities.paper).toBe(0);
    expect(player(after, 'p2').commodities.paper).toBe(0);
    expect(player(after, 'p1').resources.lumber).toBe(1);
    expect(after.commodityBank.paper).toBe(1);
  });
});

describe('R-CK the robber before the first attack (CK25 pp. 6–7)', () => {
  it('R-CK-07 a 7 before the first attack still makes big hands discard, but nobody moves the robber', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    give(state, 'p2', { lumber: 4, brick: 4 });
    state.players[1]!.commodities.cloth = 1;
    state.commodityBank.cloth -= 1;
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, SCIENCE));
    expect(eventsOf(rolled, 'ck.robberIdle')).toHaveLength(1);
    expect(rolled.state.pending).toMatchObject({ kind: 'discard', required: { p2: 4 } });
    // Commodities count toward the hand and may be discarded.
    const discarded = actCk(rolled.state, 'p2', { type: 'pending.discard', resources: ['cloth', 'lumber', 'lumber', 'brick'] });
    expect(discarded.state.pending).toBeNull();
    expect(discarded.state.turn.phase).toBe('action');
    expect(discarded.state.board.robber).toBe(state.board.robber);
    expect(discarded.state.commodityBank.cloth).toBe(12);
    expect(rejectCk(discarded.state, 'p1', { type: 'knight.chaseRobber', vertex: 0 })).not.toBe('ok');
  });

  it('R-CK-08 attack and 7 on one roll: the barbarians attack first, then the robber is in play for the 7', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    ckState(state).barbarian = 6;
    give(state, 'p3', { ore: 9 });
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, SHIP));
    const types = rolled.events.map((event) => event.type);
    expect(types.indexOf('ck.barbariansAttack')).toBeLessThan(types.indexOf('discard.required'));
    expect(types).toContain('ck.robberEntered');
    expect(types).not.toContain('ck.robberIdle');
    expect(ckView(rolled.state).attacks).toBe(1);
    expect(rolled.state.board.robber).toBe(rolled.state.board.layout.robber);
    expect(rolled.state.pending).toMatchObject({ kind: 'discard', required: { p3: 4 } });
    const discarded = actCk(rolled.state, 'p3', { type: 'pending.discard', resources: ['ore', 'ore', 'ore', 'ore'] });
    expect(discarded.state.pending).toMatchObject({ kind: 'moveRobber', actor: 'p1' });
  });
});

describe('R-CK progress cards (CK25 pp. 6, 10)', () => {
  function drawGame(): GameState {
    const state = emptyCkGame(4, 1, 'preroll');
    // Known deck tops.
    state.progressDecks.science = ['alchemy', 'crane', 'invention', 'printing', 'mining'];
    return state;
  }

  it('R-CK-09 a city gate draws for every player whose level covers the red die, in turn order from the roller', () => {
    const state = drawGame();
    setImprovement(state, 'p1', 'science', 1); // draws on red 1–2
    setImprovement(state, 'p2', 'science', 2); // 1–3
    setImprovement(state, 'p3', 'science', 0); // never
    setImprovement(state, 'p4', 'science', 5); // 1–6
    const rolled = actCk(state, 'p2', { type: 'turn.roll' }, rollRng(1, 3, SCIENCE));
    const draws = eventsOf(rolled, 'ck.progressDrawn').map((event) => event.params.playerId);
    expect(draws).toEqual(['p2', 'p4']);
    expect(player(rolled.state, 'p2').progressCards).toEqual(['alchemy']);
    expect(player(rolled.state, 'p4').progressCards).toEqual(['crane']);
    expect(player(rolled.state, 'p1').progressCards).toEqual([]);
  });

  it('R-CK-10 a victory-point card is revealed at once, even off turn, and does not join the hand', () => {
    const state = drawGame();
    state.progressDecks.science = ['printing', 'mining'];
    setImprovement(state, 'p3', 'science', 1);
    const before = scoreOf(state, 'p3', { includeHidden: true });
    const rolled = actCk(state, 'p2', { type: 'turn.roll' }, rollRng(1, 1, SCIENCE));
    expect(player(rolled.state, 'p3').progressCards).toEqual([]);
    expect(ckView(rolled.state).progressVp.p3).toEqual(['printing']);
    expect(scoreOf(rolled.state, 'p3', { includeHidden: false })).toBe(before + 1);
    expect(eventsOf(rolled, 'ck.progressVictoryPoint')[0]!.params).toMatchObject({ playerId: 'p3', card: 'printing' });
  });

  it('R-CK-11 an empty deck stops the draws (CK-FAQ shortage)', () => {
    const state = drawGame();
    state.progressDecks.trade = ['merchant'];
    setImprovement(state, 'p2', 'trade', 5);
    setImprovement(state, 'p3', 'trade', 5);
    const rolled = actCk(state, 'p2', { type: 'turn.roll' }, rollRng(1, 1, TRADE));
    expect(player(rolled.state, 'p2').progressCards).toEqual(['merchant']);
    expect(player(rolled.state, 'p3').progressCards).toEqual([]);
    expect(eventsOf(rolled, 'ck.progressDeckEmpty')[0]!.params).toMatchObject({ playerId: 'p3', track: 'trade' });
  });

  it('R-CK-12 off turn, a fifth card is discarded at once — before production', () => {
    const state = drawGame();
    state.progressDecks.politics = ['espionage', 'wedding'];
    setImprovement(state, 'p3', 'politics', 5);
    player(state, 'p3').progressCards = ['diplomacy', 'intrigue', 'sabotage', 'treason'];
    const forest = hexWith(state, 'forest', 11);
    setBuilding(state, 'p3', soleCorner(state, forest), true);
    const rolled = actCk(state, 'p2', { type: 'turn.roll' }, rollRng(5, 6, POLITICS));
    expect(moduleFrame(rolled.state)).toMatchObject({ kind: 'citiesKnights.progressDiscard', responders: ['p3'], data: { required: { p3: 1 } } });
    // Production has not happened yet.
    expect(player(rolled.state, 'p3').resources.lumber).toBe(0);
    expect(rejectCk(rolled.state, 'p3', { type: 'progress.discard', cards: ['wedding'] })).toBe('E_CARD_NOT_HELD');
    const discarded = actCk(rolled.state, 'p3', { type: 'progress.discard', cards: ['espionage'] });
    expect(player(discarded.state, 'p3').progressCards).toHaveLength(4);
    // Discards go under their deck.
    expect(discarded.state.progressDecks.politics.at(-1)).toBe('espionage');
    expect(player(discarded.state, 'p3').resources.lumber).toBe(1);
    expect(discarded.state.turn.phase).toBe('action');
  });

  it('R-CK-13 on turn, the hand limit is met by the end of the action phase; no voluntary discards', () => {
    const state = drawGame();
    state.progressDecks.science = ['mining'];
    setImprovement(state, 'p2', 'science', 2);
    player(state, 'p2').progressCards = ['alchemy', 'crane', 'invention', 'medicine'];
    const rolled = actCk(state, 'p2', { type: 'turn.roll' }, rollRng(1, 1, SCIENCE));
    expect(rolled.state.pending).toBeNull();
    expect(player(rolled.state, 'p2').progressCards).toHaveLength(5);
    expect(hints(rolled.state, 'p2').progressExcess).toBe(1);
    expect(rejectCk(rolled.state, 'p2', { type: 'turn.end' })).toBe('E_PROGRESS_HAND_LIMIT');
    const discarded = actCk(rolled.state, 'p2', { type: 'progress.discard', cards: ['mining'] });
    expect(rejectCk(discarded.state, 'p2', { type: 'progress.discard', cards: ['alchemy'] })).toBe('E_PROGRESS_WITHIN_LIMIT');
    expect(actCk(discarded.state, 'p2', { type: 'turn.end' }).state.turn.seat).toBe(2);
  });

  it('R-CK-14 progress cards cannot be played in this phase (no play command exists)', () => {
    const state = emptyCkGame(4);
    player(state, 'p1').progressCards = ['crane'];
    expect(rejectCk(state, 'p1', { type: 'progress.play', card: 'crane' })).toBe('E_INVALID_COMMAND');
  });
});

describe('R-CK science aqueduct (CK25 p. 8)', () => {
  it('R-CK-15 science level 3 lets a player who produced nothing take a resource, not on a 7', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    setImprovement(state, 'p2', 'science', 3);
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(5, 6, TRADE));
    expect(moduleFrame(rolled.state)).toMatchObject({ kind: 'citiesKnights.scienceBonus', responders: ['p2'] });
    expect(hints(rolled.state, 'p2').scienceBonus).toBe(true);
    const taken = actCk(rolled.state, 'p2', { type: 'science.take', resource: 'ore' });
    expect(player(taken.state, 'p2').resources.ore).toBe(1);
    expect(taken.state.pending).toBeNull();

    const seven = emptyCkGame(4, 0, 'preroll');
    setImprovement(seven, 'p2', 'science', 3);
    const rolledSeven = actCk(seven, 'p1', { type: 'turn.roll' }, rollRng(3, 4, TRADE));
    expect(rolledSeven.state.pending).toBeNull();
    expect(actionHints(rolledSeven.state, 'p1').canRoll).toBe(false);
  });
});
