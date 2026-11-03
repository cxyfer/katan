/**
 * R-CK fixtures: city walls, city improvements, metropolises, commodity
 * trade and theft, victory, the paired 5–6 player turn and privacy
 * (CK25 pp. 3, 7–8, 10; CK56-25 p. 3; CK-FAQ city improvements).
 */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints } from '../src/engine.ts';
import { ckState, ckView } from '../src/modules/citiesKnights/state.ts';
import { projectEvent, projectGame } from '../src/project.ts';
import type { GameState } from '../src/types.ts';
import {
  SCIENCE,
  actCk,
  emptyCkGame,
  eventsOf,
  giveCommodities,
  hints,
  player,
  rejectCk,
  rollRng,
  setBuilding,
  setImprovement,
  spreadVertices,
} from './ck-helpers.ts';
import { forceTurn, give, scriptedRng } from './helpers.ts';

describe('R-CK city walls (CK25 p. 8)', () => {
  it('R-CK-37 a wall costs 2 brick, goes under an own city without one, and at most 3 are built', () => {
    const state = emptyCkGame(4);
    const [a, b, c, d, e] = spreadVertices(state, 5);
    for (const vertex of [a, b, c, d]) setBuilding(state, 'p1', vertex!, true);
    setBuilding(state, 'p1', e!, false);
    give(state, 'p1', { brick: 10 });
    expect(rejectCk(state, 'p1', { type: 'build.wall', vertex: e! })).toBe('E_ILLEGAL_TARGET');
    let current = actCk(state, 'p1', { type: 'build.wall', vertex: a! }).state;
    expect(player(current, 'p1').resources.brick).toBe(8);
    expect(rejectCk(current, 'p1', { type: 'build.wall', vertex: a! })).toBe('E_ILLEGAL_TARGET');
    current = actCk(current, 'p1', { type: 'build.wall', vertex: b! }).state;
    current = actCk(current, 'p1', { type: 'build.wall', vertex: c! }).state;
    expect(player(current, 'p1').cityWalls).toBe(3);
    expect(rejectCk(current, 'p1', { type: 'build.wall', vertex: d! })).toBe('E_NO_PIECES');
    expect(hints(current, 'p1').wallSites).toEqual([]);
  });

  it('R-CK-38 each wall raises the 7 discard limit by 2 (CK25 p. 8)', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    const [a, b] = spreadVertices(state, 2);
    setBuilding(state, 'p2', a!, true);
    setBuilding(state, 'p2', b!, true);
    ckState(state).walls.push(a!, b!);
    player(state, 'p2').cityWalls = 2;
    give(state, 'p2', { ore: 9 });
    giveCommodities(state, 'p2', { coin: 2 }); // 11 cards: limit 7 + 4
    give(state, 'p3', { ore: 8 });
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, SCIENCE));
    expect(rolled.state.pending).toMatchObject({ kind: 'discard', required: { p3: 4 } });
    expect(Object.keys((rolled.state.pending as { required: object }).required)).toEqual(['p3']);
  });
});

describe('R-CK city improvements (CK25 pp. 3, 8)', () => {
  it('R-CK-39 level n costs n of the track’s commodity, needs a city, and stops at level 5', () => {
    const state = emptyCkGame(4);
    giveCommodities(state, 'p1', { paper: 12 });
    expect(rejectCk(state, 'p1', { type: 'city.improve', track: 'science' })).toBe('E_IMPROVEMENT_NEEDS_CITY');
    const [a, b] = spreadVertices(state, 2);
    setBuilding(state, 'p1', a!, true);
    setBuilding(state, 'p1', b!, true);
    let current = state;
    for (let level = 1; level <= 3; level++) {
      const result = actCk(current, 'p1', { type: 'city.improve', track: 'science' });
      expect(eventsOf(result, 'ck.cityImproved')[0]!.params).toMatchObject({ track: 'science', level, cost: level, commodity: 'paper' });
      current = result.state;
    }
    expect(player(current, 'p1').commodities.paper).toBe(6);
    expect(current.commodityBank.paper).toBe(6);
    expect(rejectCk(current, 'p1', { type: 'city.improve', track: 'trade' })).toBe('E_INSUFFICIENT_RESOURCES');
    current = actCk(current, 'p1', { type: 'city.improve', track: 'science', vertex: a! }).state;
    setImprovement(current, 'p1', 'science', 5);
    expect(rejectCk(current, 'p1', { type: 'city.improve', track: 'science' })).toBe('E_IMPROVEMENT_MAX');
  });

  it('R-CK-40 trade level 3 trades two identical commodities for any card; otherwise commodities go 4:1 or 3:1 at a generic port', () => {
    const state = emptyCkGame(4);
    const [a] = spreadVertices(state, 1);
    setBuilding(state, 'p1', a!, true);
    giveCommodities(state, 'p1', { cloth: 6 });
    expect(actionHints(state, 'p1').bankRates.lumber).toBe(4);
    expect(hints(state, 'p1').commodityRates.cloth).toBe(4);
    const four = actCk(state, 'p1', { type: 'trade.bank', give: 'cloth', receive: 'ore' });
    expect(player(four.state, 'p1').commodities.cloth).toBe(2);
    setImprovement(four.state, 'p1', 'trade', 3);
    const two = actCk(four.state, 'p1', { type: 'trade.bank', give: 'cloth', receive: 'paper' });
    expect(player(two.state, 'p1').commodities).toEqual({ paper: 1, cloth: 0, coin: 0 });
    // Resources may buy commodities at the resource rate.
    give(two.state, 'p1', { wool: 4 });
    const bought = actCk(two.state, 'p1', { type: 'trade.bank', give: 'wool', receive: 'coin' });
    expect(player(bought.state, 'p1').commodities.coin).toBe(1);

    const port = emptyCkGame(4);
    const generic = port.board.layout.harbors.find((harbor) => harbor.type === 'generic')!;
    setBuilding(port, 'p1', topologyOf(port).edges[generic.edge]!.vertices[0]!);
    giveCommodities(port, 'p1', { coin: 3 });
    expect(hints(port, 'p1').commodityRates.coin).toBe(3);
    expect(player(actCk(port, 'p1', { type: 'trade.bank', give: 'coin', receive: 'brick' }).state, 'p1').resources.brick).toBe(1);
  });
});

describe('R-CK metropolises (CK25 p. 8; CK-FAQ)', () => {
  function race(): { state: GameState; cities: number[] } {
    const state = emptyCkGame(4);
    const cities = spreadVertices(state, 4);
    setBuilding(state, 'p1', cities[0]!, true);
    setBuilding(state, 'p1', cities[1]!, true);
    setBuilding(state, 'p2', cities[2]!, true);
    setBuilding(state, 'p2', cities[3]!, true);
    setImprovement(state, 'p1', 'politics', 3);
    setImprovement(state, 'p2', 'politics', 3);
    giveCommodities(state, 'p1', { coin: 9 });
    giveCommodities(state, 'p2', { coin: 9 });
    return { state, cities };
  }

  it('R-CK-41 the first player to level 4 takes the metropolis on a city of their choice: 2 VP', () => {
    const { state, cities } = race();
    expect(rejectCk(state, 'p1', { type: 'city.improve', track: 'politics' })).toBe('E_INVALID_SELECTION');
    expect(rejectCk(state, 'p1', { type: 'city.improve', track: 'politics', vertex: cities[2]! })).toBe('E_ILLEGAL_TARGET');
    const before = scoreOf(state, 'p1', { includeHidden: false });
    const result = actCk(state, 'p1', { type: 'city.improve', track: 'politics', vertex: cities[1]! });
    expect(ckView(result.state).metropolises.politics).toEqual({ player: 'p1', vertex: cities[1]! });
    expect(eventsOf(result, 'ck.metropolisAwarded')[0]!.params).toEqual({ playerId: 'p1', track: 'politics', vertex: cities[1]!, permanent: false });
    expect(scoreOf(result.state, 'p1', { includeHidden: false })).toBe(before + 2);
  });

  it('R-CK-42 a later level 4 does not take it; the first to level 5 does, for good', () => {
    const { state, cities } = race();
    let current = actCk(state, 'p1', { type: 'city.improve', track: 'politics', vertex: cities[0]! }).state;
    forceTurn(current, 1, 'action');
    const second = actCk(current, 'p2', { type: 'city.improve', track: 'politics' });
    expect(eventsOf(second, 'ck.metropolisAwarded')).toHaveLength(0);
    expect(ckView(second.state).metropolises.politics!.player).toBe('p1');
    const fifth = actCk(second.state, 'p2', { type: 'city.improve', track: 'politics', vertex: cities[3]! });
    expect(eventsOf(fifth, 'ck.metropolisAwarded')[0]!.params).toEqual({
      playerId: 'p2', track: 'politics', vertex: cities[3]!, permanent: true, from: 'p1', fromVertex: cities[0]!,
    });
    current = fifth.state;
    forceTurn(current, 0, 'action');
    giveCommodities(current, 'p1', { coin: 5 });
    const late = actCk(current, 'p1', { type: 'city.improve', track: 'politics' });
    expect(ckView(late.state).metropolises.politics!.player).toBe('p2');
  });

  it('R-CK-43 a level that would earn a metropolis needs a free city; a level that would not, does not', () => {
    const state = emptyCkGame(4);
    const [a, b] = spreadVertices(state, 2);
    setBuilding(state, 'p1', a!, true);
    setBuilding(state, 'p2', b!, true);
    ckState(state).metropolises.science = { player: 'p1', vertex: a! };
    setImprovement(state, 'p1', 'science', 4);
    setImprovement(state, 'p1', 'trade', 3);
    giveCommodities(state, 'p1', { cloth: 4 });
    expect(rejectCk(state, 'p1', { type: 'city.improve', track: 'trade' })).toBe('E_METROPOLIS_NO_CITY');
    expect(hints(state, 'p1').improvements.find((option: { track: string }) => option.track === 'trade')).toMatchObject({ blocked: 'no-site', metropolis: true });
    // p2 reaching level 4 in science while p1 holds it earns nothing, so no site is needed.
    forceTurn(state, 1, 'action');
    ckState(state).metropolises.trade = { player: 'p2', vertex: b! };
    setImprovement(state, 'p2', 'science', 3);
    giveCommodities(state, 'p2', { paper: 4 });
    const result = actCk(state, 'p2', { type: 'city.improve', track: 'science' });
    expect(player(result.state, 'p2').improvements.science).toBe(4);
  });

  it('R-CK-44 a metropolis counts once toward the barbarians and makes its city immune (see ck-barbarians)', () => {
    const { state, cities } = race();
    const result = actCk(state, 'p1', { type: 'city.improve', track: 'politics', vertex: cities[0]! });
    expect(projectGame(result.state, 'p3').modules!.citiesKnights).toMatchObject({ barbarianStrength: 4 });
  });
});

describe('R-CK commodities in hands (CK25 p. 7)', () => {
  it('R-CK-45 the robber can steal a commodity', () => {
    const state = emptyCkGame(4);
    giveCommodities(state, 'p2', { coin: 1 });
    state.pending = { kind: 'steal', actor: 'p1', candidates: ['p2'] } as never;
    const stolen = actCk(state, 'p1', { type: 'pending.steal', victim: 'p2' }, scriptedRng([0, 0, 0]));
    expect(player(stolen.state, 'p1').commodities.coin).toBe(1);
    expect(player(stolen.state, 'p2').commodities.coin).toBe(0);
  });

  it('R-CK-46 commodities may be offered in domestic trades', () => {
    const state = emptyCkGame(4);
    giveCommodities(state, 'p1', { paper: 1 });
    give(state, 'p2', { ore: 1 });
    const offered = actCk(state, 'p1', { type: 'trade.offer', to: 'p2', give: { paper: 1 }, want: { ore: 1 } });
    const offerId = offered.state.offers.at(-1)!.id;
    const agreed = actCk(offered.state, 'p2', { type: 'trade.respond', offerId, response: 'consented' });
    const settled = actCk(agreed.state, 'p1', { type: 'trade.settle', offerId });
    expect(player(settled.state, 'p2').commodities.paper).toBe(1);
    expect(player(settled.state, 'p1').resources.ore).toBe(1);
  });
});

describe('R-CK victory (CK25 p. 3)', () => {
  it('R-CK-47 13 victory points on one’s own turn win; metropolises, defender points and VP cards count', () => {
    const state = emptyCkGame(4);
    const spots = spreadVertices(state, 4);
    for (const vertex of spots) setBuilding(state, 'p1', vertex, true); // 8
    player(state, 'p1').defenders = 3; // 11
    setImprovement(state, 'p1', 'trade', 3);
    giveCommodities(state, 'p1', { cloth: 4 });
    const won = actCk(state, 'p1', { type: 'city.improve', track: 'trade', vertex: spots[0]! });
    expect(won.state.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
    expect(scoreOf(won.state, 'p1', { includeHidden: true })).toBe(13);
  });
});

describe('R-CK 5–6 players (CK56-25 pp. 2–3)', () => {
  it('R-CK-48 Player 2 has an action phase with C&K builds, may trade with the supply but not with players', () => {
    const state = emptyCkGame(6);
    const [a, k] = spreadVertices(state, 2);
    forceTurn(state, 0, 'action');
    const p2 = state.players[3]!.id;
    const ended = actCk(state, 'p1', { type: 'turn.end' });
    expect(ended.state.turn).toMatchObject({ seat: 3, pairedActor: 2, phase: 'action' });
    const current = ended.state;
    setBuilding(current, p2, a!, true);
    current.board.roads[topologyOf(current).vertices[k!]!.edges[0]!] = { player: p2, ship: false };
    give(current, p2, { brick: 2, wool: 5, ore: 1 });
    expect(actCk(current, p2, { type: 'build.wall', vertex: a! }).state.players[3]!.cityWalls).toBe(1);
    expect(eventsOf(actCk(current, p2, { type: 'knight.recruit', vertex: k! }), 'ck.knightRecruited')).toHaveLength(1);
    expect(actCk(current, p2, { type: 'trade.bank', give: 'wool', receive: 'grain' }).state.players[3]!.resources.grain).toBe(1);
    expect(rejectCk(current, p2, { type: 'trade.offer', to: 'p1', give: { wool: 1 }, want: { ore: 1 } })).toBe('E_PAIRED_NO_DOMESTIC_TRADE');
    expect(actionHints(current, p2).canRoll).toBe(false);
  });

  it('R-CK-49 the paired supply holds 18 of each commodity (CK56-25 p. 2)', () => {
    const state = emptyCkGame(5);
    expect(state.commodityBank).toEqual({ paper: 18, cloth: 18, coin: 18 });
    expect(emptyCkGame(4).commodityBank).toEqual({ paper: 12, cloth: 12, coin: 12 });
  });
});

describe('R-CK privacy (SPEC §8.3)', () => {
  it('R-CK-50 progress hands and deck order reach only their owner; counts are public', () => {
    const state = emptyCkGame(4, 1, 'preroll');
    for (const track of ['science', 'trade', 'politics'] as const) state.progressDecks[track] = [];
    state.progressDecks.science = ['irrigation', 'engineering'];
    setImprovement(state, 'p3', 'science', 5);
    player(state, 'p1').progressCards = ['espionage'];
    state.progressDecks.politics = [];
    const rolled = actCk(state, 'p2', { type: 'turn.roll' }, rollRng(1, 1, SCIENCE));
    const drawn = eventsOf(rolled, 'ck.progressDrawn')[0]!;
    expect(projectEvent(drawn, 'p3').params).toMatchObject({ card: 'irrigation' });
    expect(projectEvent(drawn, 'p1').params).not.toHaveProperty('card');
    const forP1 = JSON.stringify(projectGame(rolled.state, 'p1', { events: rolled.events }));
    expect(forP1).not.toContain('irrigation');
    expect(forP1).not.toContain('engineering');
    expect(forP1).toContain('espionage');
    const forP3 = projectGame(rolled.state, 'p3', { events: rolled.events });
    expect(JSON.stringify(forP3)).not.toContain('espionage');
    expect(JSON.stringify(forP3)).not.toContain('engineering');
    expect(forP3.players.find((p) => p.id === 'p3')!.progressCards).toEqual(['irrigation']);
    expect(forP3.modules!.citiesKnights).toMatchObject({ progressCounts: { p1: 1, p2: 0, p3: 1, p4: 0 }, decks: { science: 1, trade: 0, politics: 0 } });
  });
});
