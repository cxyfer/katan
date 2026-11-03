/**
 * R-CK fixtures: barbarian attacks (CK25 pp. 6, 11; CK-FAQ barbarians).
 */

import { describe, expect, it } from 'vitest';
import { scoreOf } from '../src/analysis.ts';
import { actionHints } from '../src/engine.ts';
import { barbarianStrength } from '../src/modules/citiesKnights/barbarians.ts';
import { ckState, ckView } from '../src/modules/citiesKnights/state.ts';
import type { GameState } from '../src/types.ts';
import {
  SHIP,
  SCIENCE,
  actCk,
  addKnight,
  emptyCkGame,
  eventsOf,
  moduleFrame,
  player,
  rejectCk,
  rollRng,
  setBuilding,
  setImprovement,
  spreadVertices,
} from './ck-helpers.ts';
import { give } from './helpers.ts';

/** A game one ship away from an attack; rolling 1 + 1 produces on hex 1 only. */
function eve(): GameState {
  const state = emptyCkGame(4, 0, 'preroll');
  ckState(state).barbarian = 6;
  return state;
}

function attack(state: GameState) {
  return actCk(state, 'p1', { type: 'turn.roll' }, rollRng(6, 6, SHIP));
}

describe('R-CK barbarian strength (CK25 p. 11)', () => {
  it('R-CK-16 counts every city on the board, a metropolis city once', () => {
    const state = eve();
    const [a, b, c, d] = spreadVertices(state, 4);
    setBuilding(state, 'p1', a!, true);
    setBuilding(state, 'p1', b!, true);
    setBuilding(state, 'p2', c!, true);
    setBuilding(state, 'p3', d!, false);
    ckState(state).metropolises.science = { player: 'p1', vertex: a! };
    // CK25 p. 11 example: cities including metropolis cities; the CK-FAQ
    // formula b = s + m would give 4 here (open fixture, docs/FIDELITY.md).
    expect(barbarianStrength(state)).toBe(3);
  });
});

describe('R-CK defenders win (CK25 p. 11)', () => {
  it('R-CK-17 defence equal to the attack drives the barbarians off; the single best defender gets 1 VP', () => {
    const state = eve();
    const [a, b, k1, k2] = spreadVertices(state, 4);
    setBuilding(state, 'p1', a!, true);
    setBuilding(state, 'p2', b!, true);
    addKnight(state, { player: 'p2', vertex: k1!, level: 2, active: true });
    addKnight(state, { player: 'p3', vertex: k2!, level: 1, active: false });
    const before = scoreOf(state, 'p2', { includeHidden: false });
    const rolled = attack(state);
    expect(eventsOf(rolled, 'ck.barbariansAttack')[0]!.params).toMatchObject({ barbarians: 2, defenders: 2, outcome: 'defenders' });
    expect(eventsOf(rolled, 'ck.defenderOfCatan')[0]!.params).toEqual({ playerId: 'p2' });
    expect(player(rolled.state, 'p2').defenders).toBe(1);
    expect(scoreOf(rolled.state, 'p2', { includeHidden: false })).toBe(before + 1);
    expect(rolled.state.board.buildings[a!]).toEqual({ player: 'p1', city: true });
  });

  it('R-CK-18 tied best defenders each draw from a deck of their choice, in turn order from the roller', () => {
    const state = emptyCkGame(4, 2, 'preroll');
    ckState(state).barbarian = 6;
    const [k1, k2, k3] = spreadVertices(state, 3);
    addKnight(state, { player: 'p2', vertex: k1!, level: 1, active: true });
    addKnight(state, { player: 'p4', vertex: k2!, level: 1, active: true });
    addKnight(state, { player: 'p1', vertex: k3!, level: 1, active: false });
    state.progressDecks.trade = ['merchant', 'guildDues'];
    state.progressDecks.politics = ['wedding'];
    const rolled = actCk(state, 'p3', { type: 'turn.roll' }, rollRng(6, 6, SHIP));
    expect(eventsOf(rolled, 'ck.defenderOfCatan')).toHaveLength(0);
    expect(eventsOf(rolled, 'ck.defendersTied')[0]!.params).toEqual({ players: ['p4', 'p2'] });
    expect(moduleFrame(rolled.state)).toMatchObject({ kind: 'citiesKnights.defenderDraw', responders: ['p4', 'p2'] });
    expect(rejectCk(rolled.state, 'p2', { type: 'barbarians.chooseDeck', track: 'trade' })).toBe('E_NOT_YOUR_TURN');
    const first = actCk(rolled.state, 'p4', { type: 'barbarians.chooseDeck', track: 'politics' });
    expect(player(first.state, 'p4').progressCards).toEqual(['wedding']);
    expect(rejectCk(first.state, 'p2', { type: 'barbarians.chooseDeck', track: 'politics' })).toBe('E_PROGRESS_DECK_EMPTY');
    const second = actCk(first.state, 'p2', { type: 'barbarians.chooseDeck', track: 'trade' });
    expect(player(second.state, 'p2').progressCards).toEqual(['merchant']);
    expect(second.state.pending).toBeNull();
    expect(second.state.turn.phase).toBe('action');
    expect(player(second.state, 'p2').defenders).toBe(0);
  });

  it('R-CK-51 a tied defender pushed over the hand limit off turn discards before production goes on', () => {
    const state = eve();
    const [k1, k2] = spreadVertices(state, 2);
    addKnight(state, { player: 'p1', vertex: k1!, level: 1, active: true });
    addKnight(state, { player: 'p2', vertex: k2!, level: 1, active: true });
    player(state, 'p2').progressCards = ['crane', 'mining', 'medicine', 'smithing'];
    state.progressDecks.trade = ['merchant', 'merchantFleet'];
    const rolled = attack(state);
    const drawn = actCk(actCk(rolled.state, 'p1', { type: 'barbarians.chooseDeck', track: 'trade' }).state, 'p2', { type: 'barbarians.chooseDeck', track: 'trade' });
    expect(moduleFrame(drawn.state)).toMatchObject({ kind: 'citiesKnights.progressDiscard', responders: ['p2'] });
    const discarded = actCk(drawn.state, 'p2', { type: 'progress.discard', cards: ['crane'] });
    expect(discarded.state.pending).toBeNull();
    expect(discarded.state.turn.phase).toBe('action');
  });

  it('R-CK-19 with no knight defending nobody is rewarded (explicit interpretation)', () => {
    const rolled = attack(eve());
    expect(eventsOf(rolled, 'ck.barbariansAttack')[0]!.params).toMatchObject({ barbarians: 0, defenders: 0, outcome: 'defenders' });
    expect(eventsOf(rolled, 'ck.defendersTied')).toHaveLength(0);
    expect(rolled.state.pending).toBeNull();
  });
});

describe('R-CK barbarians win (CK25 p. 11)', () => {
  it('R-CK-20 players with no active knight are the weakest and lose a city; its wall goes too', () => {
    const state = eve();
    const [a, b, c, k1] = spreadVertices(state, 4);
    setBuilding(state, 'p1', a!, true);
    setBuilding(state, 'p2', b!, true);
    setBuilding(state, 'p3', c!, true);
    addKnight(state, { player: 'p2', vertex: k1!, level: 1, active: true });
    ckState(state).walls.push(a!);
    player(state, 'p1').cityWalls = 1;
    const rolled = attack(state);
    expect(eventsOf(rolled, 'ck.barbariansAttack')[0]!.params).toMatchObject({ barbarians: 3, defenders: 1, outcome: 'barbarians' });
    // p1 and p3 (0 each) tie for weakest; each has one city, pillaged at once.
    const pillaged = eventsOf(rolled, 'ck.cityPillaged').map((event) => event.params);
    expect(pillaged).toEqual([
      { playerId: 'p1', vertex: a!, wallLost: true, toppled: false },
      { playerId: 'p3', vertex: c!, wallLost: false, toppled: false },
    ]);
    expect(rolled.state.board.buildings[a!]).toEqual({ player: 'p1', city: false });
    expect(rolled.state.board.buildings[b!]).toEqual({ player: 'p2', city: true });
    expect(ckView(rolled.state).walls).toEqual([]);
    expect(player(rolled.state, 'p1').cityWalls).toBe(0);
  });

  it('R-CK-21 a weakest player with several cities chooses which one is pillaged (CK-FAQ)', () => {
    const state = eve();
    const [a, b, c, k1] = spreadVertices(state, 4);
    setBuilding(state, 'p1', a!, true);
    setBuilding(state, 'p1', b!, true);
    setBuilding(state, 'p2', c!, true);
    addKnight(state, { player: 'p2', vertex: k1!, level: 1, active: true });
    const rolled = attack(state);
    expect(moduleFrame(rolled.state)).toMatchObject({ kind: 'citiesKnights.pillage', responders: ['p1'] });
    expect(rejectCk(rolled.state, 'p1', { type: 'barbarians.pillage', vertex: c! })).toBe('E_ILLEGAL_TARGET');
    expect(rejectCk(rolled.state, 'p2', { type: 'barbarians.pillage', vertex: c! })).toBe('E_NOT_ACTOR');
    const chosen = actCk(rolled.state, 'p1', { type: 'barbarians.pillage', vertex: b! });
    expect(chosen.state.board.buildings[b!]).toEqual({ player: 'p1', city: false });
    expect(chosen.state.board.buildings[a!]).toEqual({ player: 'p1', city: true });
    expect(chosen.state.pending).toBeNull();
    expect(chosen.state.turn.phase).toBe('action');
  });

  it('R-CK-22 a metropolis is never pillaged; the next weakest group loses instead', () => {
    const state = eve();
    const [a, b, c, k1, k2, k3] = spreadVertices(state, 6);
    setBuilding(state, 'p1', a!, true); // only city, a metropolis
    setBuilding(state, 'p2', b!, true);
    setBuilding(state, 'p3', c!, true);
    ckState(state).metropolises.trade = { player: 'p1', vertex: a! };
    addKnight(state, { player: 'p2', vertex: k1!, level: 1, active: false });
    addKnight(state, { player: 'p3', vertex: k2!, level: 1, active: false });
    // p4 has a strong knight but no city.
    addKnight(state, { player: 'p4', vertex: k3!, level: 2, active: true });
    // Strength 3 against 2: p1, p2, p3 contributed 0; only p2 and p3 can lose.
    const rolled = attack(state);
    const pillaged = eventsOf(rolled, 'ck.cityPillaged').map((event) => event.params.playerId);
    expect(pillaged).toEqual(['p2', 'p3']);
    expect(rolled.state.board.buildings[a!]).toEqual({ player: 'p1', city: true });
  });

  it('R-CK-23 the next-lowest group loses when the lowest has no city that can fall', () => {
    const state = eve();
    const [a, b, c, d, k1, k2] = spreadVertices(state, 6);
    setBuilding(state, 'p1', a!, false); // settlement only; p4 has nothing
    setBuilding(state, 'p2', b!, true);
    setBuilding(state, 'p2', c!, true);
    setBuilding(state, 'p3', d!, true);
    addKnight(state, { player: 'p2', vertex: k1!, level: 1, active: true });
    addKnight(state, { player: 'p3', vertex: k2!, level: 1, active: true });
    // 3 against 2. p1 and p4 (0) have no city; p2 and p3 (1 each) lose one:
    // p3's only city falls at once, p2 chooses.
    const rolled = attack(state);
    expect(eventsOf(rolled, 'ck.cityPillaged').map((event) => event.params.playerId)).toEqual(['p3']);
    expect(moduleFrame(rolled.state)).toMatchObject({ kind: 'citiesKnights.pillage', responders: ['p2'] });
    expect(ckView(rolled.state).lastAttack!.losers).toEqual(['p2', 'p3']);
  });

  it('R-CK-24 without a settlement piece in supply the city lies on its side and must be upgraded first', () => {
    const state = eve();
    const spots = spreadVertices(state, 8);
    setBuilding(state, 'p1', spots[0]!, true);
    for (let i = 1; i <= 5; i++) setBuilding(state, 'p1', spots[i]!, false);
    setBuilding(state, 'p2', spots[6]!, true);
    addKnight(state, { player: 'p2', vertex: spots[7]!, level: 1, active: true });
    const rolled = attack(state);
    expect(eventsOf(rolled, 'ck.cityPillaged')[0]!.params).toMatchObject({ playerId: 'p1', toppled: true });
    expect(ckView(rolled.state).toppled).toEqual([spots[0]!]);
    const after = rolled.state;
    give(after, 'p1', { grain: 4, ore: 6 });
    expect(rejectCk(after, 'p1', { type: 'build.city', vertex: spots[1]! })).toBe('E_ILLEGAL_TARGET');
    // The advisory hint lists only the toppled city, as the engine would accept.
    expect(actionHints(after, 'p1').legalCities).toEqual([spots[0]!]);
    const rebuilt = actCk(after, 'p1', { type: 'build.city', vertex: spots[0]! });
    expect(ckView(rebuilt.state).toppled).toEqual([]);
    expect(actCk(rebuilt.state, 'p1', { type: 'build.city', vertex: spots[1]! }).state.board.buildings[spots[1]!]!.city).toBe(true);
  });
});

describe('R-CK after the attack (CK25 pp. 6, 11)', () => {
  it.each([[2, true], [3, false]] as const)('retains improvement-based progress draws after losing the last city (red %s, CK25 pp. 6, 8)', (red, draws) => {
    const state = eve();
    const [city] = spreadVertices(state, 1);
    setBuilding(state, 'p1', city!, true);
    setImprovement(state, 'p1', 'science', 1);
    state.progressDecks.science = ['alchemy'];

    const pillaged = attack(state);
    expect(eventsOf(pillaged, 'ck.cityPillaged')).toHaveLength(1);
    expect(pillaged.state.board.buildings.some((building) => building?.player === 'p1' && building.city)).toBe(false);
    expect(player(pillaged.state, 'p1').improvements.science).toBe(1);

    const next = actCk(pillaged.state, 'p1', { type: 'turn.end' });
    const rolled = actCk(next.state, 'p2', { type: 'turn.roll' }, rollRng(2, red, SCIENCE));
    expect(player(rolled.state, 'p1').progressCards).toEqual(draws ? ['alchemy'] : []);
    expect(eventsOf(rolled, 'ck.progressDrawn').map((event) => event.params.playerId)).toEqual(draws ? ['p1'] : []);
  });

  it('R-CK-25 the ship returns to start, every knight lies down, and the first attack brings the robber in', () => {
    const state = eve();
    const [k1, k2] = spreadVertices(state, 2);
    addKnight(state, { player: 'p2', vertex: k1!, level: 1, active: true });
    addKnight(state, { player: 'p3', vertex: k2!, level: 2, active: true });
    const rolled = attack(state);
    const view = ckView(rolled.state);
    expect(view.barbarian).toBe(0);
    expect(view.attacks).toBe(1);
    expect(view.knights.every((knight) => !knight.active)).toBe(true);
    expect(eventsOf(rolled, 'ck.robberEntered')[0]!.params).toEqual({ hex: rolled.state.board.layout.robber });
    expect(view.lastAttack).toMatchObject({ barbarians: 0, defenders: 3, outcome: 'defenders', defender: 'p3' });

    // The second attack does not touch the robber.
    const next = rolled.state;
    next.board.robber = 3;
    ckState(next).barbarian = 6;
    next.turn.phase = 'preroll';
    const again = actCk(next, 'p1', { type: 'turn.roll' }, rollRng(6, 6, SHIP));
    expect(eventsOf(again, 'ck.robberEntered')).toHaveLength(0);
    expect(again.state.board.robber).toBe(3);
    expect(ckView(again.state).attacks).toBe(2);
  });
});
