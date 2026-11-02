/**
 * R-CK progress cards, science deck (CK25 pp. 6, 10, 13–14; CK-FAQ 67–72,
 * 79–81, 95, 105–108, 111–113). Each card: timing, targets, effect, deck
 * return and the boundary where it is refused.
 */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { ckState, ckView } from '../src/modules/citiesKnights/state.ts';
import type { GameState } from '../src/types.ts';
import {
  SCIENCE,
  actCk,
  addKnight,
  bottomOf,
  cornersOf,
  edgeBetween,
  emptyCkGame,
  eventsOf,
  giveCommodities,
  handCards,
  hexWith,
  hints,
  moduleFrame,
  pathFrom,
  player,
  playCard,
  rejectCard,
  rejectCk,
  roadAlong,
  scripted,
  setBuilding,
  setImprovement,
  spreadVertices,
} from './ck-helpers.ts';
import { give } from './helpers.ts';

/** A corner of `hex` that touches no other hex of the same terrain. */
function cornerOnly(state: GameState, hex: number): number {
  const topo = topologyOf(state);
  const terrain = state.board.layout.terrain[hex];
  const vertex = cornersOf(state, hex).find((candidate) =>
    topo.vertices[candidate]!.hexes.every((other) => other === hex || state.board.layout.terrain[other] !== terrain));
  if (vertex === undefined) throw new Error('no lone corner');
  return vertex;
}

describe('R-CK Alchemy (CK25 pp. 6, 13; CK-FAQ 67–72)', () => {
  it('PC-AL1 sets both production dice before the roll; the event die is still rolled and resolved first', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    handCards(state, 'p1', ['alchemy']);
    const forest = hexWith(state, 'forest', 11);
    const vertex = cornerOnly(state, forest);
    setBuilding(state, 'p1', vertex, false);
    setImprovement(state, 'p2', 'science', 1);
    const played = playCard(state, 'p1', 'alchemy', { dice: [5, 6] });
    expect(bottomOf(played.state, 'science')).toBe('alchemy');
    expect(player(played.state, 'p1').progressCards).toEqual([]);
    expect(eventsOf(played, 'ck.alchemySet')[0]!.params).toMatchObject({ dice: [5, 6], total: 11 });
    // Only the event die is drawn: the science gate with the chosen red 6 is above level 1's range.
    const rolled = actCk(played.state, 'p1', { type: 'turn.roll' }, scripted([SCIENCE]));
    const roll = eventsOf(rolled, 'turn.rolled')[0]!.params;
    expect(roll.dice).toEqual([5, 6]);
    expect(roll.total).toBe(11);
    expect(roll.extra).toMatchObject({ event: 'science', red: 6, alchemy: true });
    expect(player(rolled.state, 'p1').resources.lumber).toBe(1);
    expect(player(rolled.state, 'p2').progressCards).toHaveLength(0);
    expect(ckView(rolled.state).alchemy).toBeNull();
  });

  it('PC-AL2 the chosen red die drives the progress draws and a chosen 7 is a 7 (FAQ 67, 68)', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    handCards(state, 'p1', ['alchemy']);
    setImprovement(state, 'p2', 'science', 1);
    const played = playCard(state, 'p1', 'alchemy', { dice: [6, 1] });
    const rolled = actCk(played.state, 'p1', { type: 'turn.roll' }, scripted([SCIENCE]));
    expect(eventsOf(rolled, 'turn.rolled')[0]!.params.total).toBe(7);
    expect(player(rolled.state, 'p2').progressCards).toHaveLength(1);
  });

  it('PC-AL3 only before the roll, once per roll, with valid dice; other cards wait for the action phase (CK25 p. 10, FAQ 95, 99)', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    handCards(state, 'p1', ['alchemy', 'alchemy', 'mining']);
    expect(rejectCard(state, 'p1', 'mining')).toBe('E_WRONG_PHASE');
    expect(rejectCard(state, 'p1', 'alchemy', { dice: [0, 3] })).toBe('E_INVALID_SELECTION');
    expect(rejectCard(state, 'p1', 'alchemy', { dice: [3] })).toBe('E_INVALID_SELECTION');
    expect(rejectCard(state, 'p2', 'alchemy', { dice: [3, 3] })).toBe('E_NOT_YOUR_TURN');
    const played = playCard(state, 'p1', 'alchemy', { dice: [3, 3] });
    expect(hints(played.state, 'p1').progress.find((hint: any) => hint.card === 'alchemy')).toMatchObject({ playable: false, reason: 'alchemy-set' });
    expect(rejectCard(played.state, 'p1', 'alchemy', { dice: [2, 2] })).toBe('E_ALCHEMY_SET');
    const rolled = actCk(played.state, 'p1', { type: 'turn.roll' }, scripted([0]));
    expect(rejectCard(rolled.state, 'p1', 'alchemy', { dice: [2, 2] })).toBe('E_WRONG_PHASE');
    expect(hints(rolled.state, 'p1').progress.find((hint: any) => hint.card === 'alchemy')).toMatchObject({ playable: false, reason: 'after-roll' });
  });

  it('PC-AL4 paired player 2 has no Roll Dice phase, so no Alchemy (CK56-25 p. 4)', () => {
    const state = emptyCkGame(6, 0, 'action');
    state.turn.pairedActor = 2;
    handCards(state, 'p1', ['alchemy']);
    expect(rejectCard(state, 'p1', 'alchemy', { dice: [3, 4] })).toBe('E_WRONG_PHASE');
  });
});

describe('R-CK Crane (CK25 p. 13; CK-FAQ 79–81)', () => {
  it('PC-CR1 buys one improvement for one commodity less; level 1 is free', () => {
    const state = emptyCkGame(4);
    setBuilding(state, 'p1', spreadVertices(state, 1)[0]!, true);
    handCards(state, 'p1', ['crane', 'crane']);
    const free = playCard(state, 'p1', 'crane', { track: 'science' });
    expect(player(free.state, 'p1').improvements.science).toBe(1);
    expect(eventsOf(free, 'ck.cityImproved')[0]!.params).toMatchObject({ level: 1, cost: 0, crane: true });
    expect(bottomOf(free.state, 'science')).toBe('crane');
    giveCommodities(free.state, 'p1', { paper: 1 });
    const second = playCard(free.state, 'p1', 'crane', { track: 'science' });
    expect(player(second.state, 'p1').improvements.science).toBe(2);
    expect(player(second.state, 'p1').commodities.paper).toBe(0);
  });

  it('PC-CR2 is refused when even the reduced cost cannot be paid or no city exists; only one level per card', () => {
    const state = emptyCkGame(4);
    handCards(state, 'p1', ['crane']);
    expect(hints(state, 'p1').progress[0]).toMatchObject({ playable: false, reason: 'no-target' });
    setBuilding(state, 'p1', spreadVertices(state, 1)[0]!, true);
    setImprovement(state, 'p1', 'trade', 2);
    expect(rejectCard(state, 'p1', 'crane', { track: 'trade' })).toBe('E_INSUFFICIENT_RESOURCES');
    giveCommodities(state, 'p1', { cloth: 5 });
    const played = playCard(state, 'p1', 'crane', { track: 'trade' });
    expect(player(played.state, 'p1').improvements.trade).toBe(3);
    expect(player(played.state, 'p1').commodities.cloth).toBe(3);
  });

  it('PC-CR3 a Crane purchase may raise a metropolis on a chosen city', () => {
    const state = emptyCkGame(4);
    const [a, b] = spreadVertices(state, 2);
    setBuilding(state, 'p1', a!, true);
    setBuilding(state, 'p1', b!, true);
    setImprovement(state, 'p1', 'politics', 3);
    giveCommodities(state, 'p1', { coin: 3 });
    handCards(state, 'p1', ['crane']);
    expect(rejectCard(state, 'p1', 'crane', { track: 'politics' })).toBe('E_INVALID_SELECTION');
    const played = playCard(state, 'p1', 'crane', { track: 'politics', vertex: b });
    expect(ckView(played.state).metropolises.politics).toEqual({ player: 'p1', vertex: b });
    expect(player(played.state, 'p1').commodities.coin).toBe(0);
  });
});

describe('R-CK Engineering (CK25 p. 13)', () => {
  it('PC-EN1 builds one wall for free under an own city without one', () => {
    const state = emptyCkGame(4);
    const [city, settlement] = spreadVertices(state, 2);
    setBuilding(state, 'p1', city!, true);
    setBuilding(state, 'p1', settlement!, false);
    handCards(state, 'p1', ['engineering']);
    expect(rejectCard(state, 'p1', 'engineering', { vertex: settlement })).toBe('E_ILLEGAL_TARGET');
    const played = playCard(state, 'p1', 'engineering', { vertex: city });
    expect(ckView(played.state).walls).toEqual([city]);
    expect(player(played.state, 'p1').cityWalls).toBe(1);
    expect(eventsOf(played, 'ck.wallBuilt')[0]!.params).toMatchObject({ free: true });
    expect(player(played.state, 'p1').resources.brick).toBe(0);
    expect(bottomOf(played.state, 'science')).toBe('engineering');
  });

  it('PC-EN2 has no target without a free city or with three walls', () => {
    const state = emptyCkGame(4);
    const cities = spreadVertices(state, 4);
    handCards(state, 'p1', ['engineering']);
    expect(hints(state, 'p1').progress[0]).toMatchObject({ playable: false, reason: 'no-target' });
    for (const vertex of cities) setBuilding(state, 'p1', vertex, true);
    ckState(state).walls.push(cities[0]!, cities[1]!, cities[2]!);
    expect(rejectCard(state, 'p1', 'engineering', { vertex: cities[3] })).toBe('E_ILLEGAL_TARGET');
  });
});

describe('R-CK Invention (CK25 p. 13; CK-FAQ 105–107)', () => {
  it('PC-IN1 swaps two discs anywhere; the robber stays on its hex', () => {
    const state = emptyCkGame(4);
    const numbers = state.board.layout.numbers;
    const a = numbers.indexOf(3);
    const b = numbers.indexOf(5);
    state.board.robber = a;
    handCards(state, 'p1', ['invention']);
    const played = playCard(state, 'p1', 'invention', { hexes: [a, b] });
    expect(played.state.board.layout.numbers[a]).toBe(5);
    expect(played.state.board.layout.numbers[b]).toBe(3);
    expect(played.state.board.robber).toBe(a);
    expect(eventsOf(played, 'ck.numbersSwapped')[0]!.params).toMatchObject({ hexes: [a, b], numbers: [3, 5] });
  });

  it('PC-IN2 refuses 2, 6, 8, 12, the desert and the same hex twice', () => {
    const state = emptyCkGame(4);
    const numbers = state.board.layout.numbers;
    const three = numbers.indexOf(3);
    handCards(state, 'p1', ['invention']);
    for (const fixed of [2, 6, 8, 12]) {
      expect(rejectCard(state, 'p1', 'invention', { hexes: [three, numbers.indexOf(fixed)] })).toBe('E_ILLEGAL_TARGET');
    }
    expect(rejectCard(state, 'p1', 'invention', { hexes: [three, hexWith(state, 'desert')] })).toBe('E_ILLEGAL_TARGET');
    expect(rejectCard(state, 'p1', 'invention', { hexes: [three, three] })).toBe('E_ILLEGAL_TARGET');
  });
});

describe('R-CK Irrigation and Mining (CK25 pp. 13–14)', () => {
  it('PC-IR1 two grain per fields hex next to an own building, counted once per hex, robber or not', () => {
    const state = emptyCkGame(4);
    const field = hexWith(state, 'fields');
    const corners = cornersOf(state, field);
    setBuilding(state, 'p1', corners[0]!, true);
    setBuilding(state, 'p1', corners[3]!, false);
    state.board.robber = field;
    handCards(state, 'p1', ['irrigation']);
    const fields = new Set(topologyOf(state).vertices[corners[0]!]!.hexes.concat(topologyOf(state).vertices[corners[3]!]!.hexes).filter((hex) => state.board.layout.terrain[hex] === 'fields'));
    const played = playCard(state, 'p1', 'irrigation');
    expect(player(played.state, 'p1').resources.grain).toBe(2 * fields.size);
    expect(eventsOf(played, 'ck.harvest')[0]!.params).toMatchObject({ card: 'irrigation', resource: 'grain', hexes: fields.size });
  });

  it('PC-MI1 two ore per mountains hex; a short supply pays what is left; no building still counts as played', () => {
    const state = emptyCkGame(4);
    const mountain = hexWith(state, 'mountains');
    setBuilding(state, 'p1', cornerOnly(state, mountain), false);
    handCards(state, 'p1', ['mining', 'mining']);
    state.bank.ore = 1;
    const played = playCard(state, 'p1', 'mining');
    expect(player(played.state, 'p1').resources.ore).toBe(1);
    expect(played.state.bank.ore).toBe(0);
    // Without benefit the card is still played (CK25 p. 10).
    state.board.buildings = state.board.buildings.map(() => null);
    const empty = playCard(state, 'p1', 'mining');
    expect(eventsOf(empty, 'ck.harvest')[0]!.params).toMatchObject({ amount: 0 });
    expect(player(empty.state, 'p1').progressCards).toEqual(['mining']);
  });
});

describe('R-CK Medicine (CK25 p. 13; CK-FAQ 108)', () => {
  it('PC-ME1 upgrades a settlement for 1 grain and 2 ore', () => {
    const state = emptyCkGame(4);
    const [vertex] = spreadVertices(state, 1);
    setBuilding(state, 'p1', vertex!, false);
    handCards(state, 'p1', ['medicine']);
    expect(rejectCard(state, 'p1', 'medicine', { vertex })).toBe('E_INSUFFICIENT_RESOURCES');
    give(state, 'p1', { grain: 1, ore: 2 });
    const before = scoreOf(state, 'p1', { includeHidden: true });
    const played = playCard(state, 'p1', 'medicine', { vertex });
    expect(played.state.board.buildings[vertex!]).toEqual({ player: 'p1', city: true });
    expect(player(played.state, 'p1').resources).toMatchObject({ grain: 0, ore: 0 });
    expect(scoreOf(played.state, 'p1', { includeHidden: true })).toBe(before + 1);
  });

  it('PC-ME2 follows the city rules: a toppled city first, the city supply, own settlements only', () => {
    const state = emptyCkGame(4);
    const [a, b, c] = spreadVertices(state, 3);
    setBuilding(state, 'p1', a!, false);
    setBuilding(state, 'p1', b!, false);
    setBuilding(state, 'p2', c!, false);
    ckState(state).toppled.push(b!);
    give(state, 'p1', { grain: 2, ore: 4 });
    handCards(state, 'p1', ['medicine']);
    expect(rejectCard(state, 'p1', 'medicine', { vertex: a })).toBe('E_ILLEGAL_TARGET');
    expect(rejectCard(state, 'p1', 'medicine', { vertex: c })).toBe('E_ILLEGAL_TARGET');
    const played = playCard(state, 'p1', 'medicine', { vertex: b });
    expect(ckView(played.state).toppled).toEqual([]);
  });
});

describe('R-CK Road Building (CK25 p. 14)', () => {
  it('PC-RB1 opens the free-road effect for two roads', () => {
    const state = emptyCkGame(4);
    const path = pathFrom(state, spreadVertices(state, 1)[0]!, 3);
    setBuilding(state, 'p1', path[0]!, false);
    handCards(state, 'p1', ['roadBuilding']);
    const played = playCard(state, 'p1', 'roadBuilding');
    expect(played.state.pending).toMatchObject({ kind: 'freeRoads', actor: 'p1', remaining: 2 });
    const first = actCk(played.state, 'p1', { type: 'build.road', edge: edgeBetween(state, path[0]!, path[1]!) });
    const second = actCk(first.state, 'p1', { type: 'build.road', edge: edgeBetween(state, path[1]!, path[2]!) });
    expect(second.state.pending).toBeNull();
    expect(player(second.state, 'p1').resources.lumber).toBe(0);
    expect(bottomOf(second.state, 'science')).toBe('roadBuilding');
  });

  it('PC-RB2 without a legal road the card is played with no effect', () => {
    const state = emptyCkGame(4);
    handCards(state, 'p1', ['roadBuilding']);
    const played = playCard(state, 'p1', 'roadBuilding');
    expect(played.state.pending).toBeNull();
    expect(eventsOf(played, 'ck.freeRoads')[0]!.params).toMatchObject({ roads: 0 });
  });
});

describe('R-CK Smithing (CK25 pp. 9, 14; CK-FAQ 111–113)', () => {
  function knightsGame() {
    const state = emptyCkGame(4);
    const path = pathFrom(state, spreadVertices(state, 1)[0]!, 3);
    setBuilding(state, 'p1', path[0]!, false);
    roadAlong(state, 'p1', path);
    addKnight(state, { player: 'p1', vertex: path[1]!, level: 1, active: true });
    addKnight(state, { player: 'p1', vertex: path[2]!, level: 2, active: false });
    handCards(state, 'p1', ['smithing', 'smithing']);
    return { state, path };
  }

  it('PC-SM1 promotes up to two knights for free, status unchanged', () => {
    const { state, path } = knightsGame();
    setImprovement(state, 'p1', 'politics', 3);
    const played = playCard(state, 'p1', 'smithing', { vertices: [path[1], path[2]] });
    const knights = ckView(played.state).knights;
    expect(knights.find((knight) => knight.vertex === path[1])).toMatchObject({ level: 2, active: true });
    expect(knights.find((knight) => knight.vertex === path[2])).toMatchObject({ level: 3, active: false });
    expect(eventsOf(played, 'ck.knightPromoted')).toHaveLength(2);
    // A knight is promoted once per turn: a second Smithing on it is refused.
    expect(rejectCard(played.state, 'p1', 'smithing', { vertices: [path[1]] })).toBe('E_ILLEGAL_TARGET');
  });

  it('PC-SM2 needs politics level 3 for a mighty knight, a free piece, and different knights', () => {
    const { state, path } = knightsGame();
    expect(rejectCard(state, 'p1', 'smithing', { vertices: [path[2]] })).toBe('E_ILLEGAL_TARGET');
    expect(rejectCard(state, 'p1', 'smithing', { vertices: [path[1], path[1]] })).toBe('E_INVALID_SELECTION');
    expect(rejectCard(state, 'p1', 'smithing', { vertices: [] })).toBe('E_INVALID_SELECTION');
    const one = playCard(state, 'p1', 'smithing', { vertices: [path[1]] });
    expect(ckView(one.state).knights.find((knight) => knight.vertex === path[1])!.level).toBe(2);
    expect(player(one.state, 'p1').progressCards).toEqual(['smithing']);
    // Both strong pieces are now on the board: the other basic knight could not be promoted.
    addKnight(one.state, { player: 'p1', vertex: path[3]!, level: 1, active: false });
    expect(hints(one.state, 'p1').progress[0]).toMatchObject({ playable: false, reason: 'no-target' });
    expect(rejectCk(one.state, 'p1', { type: 'progress.play', card: 'smithing', vertices: [path[3]] })).toBe('E_ILLEGAL_TARGET');
  });
});
