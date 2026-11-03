/**
 * R-COMB fixtures: Seafarers + Cities & Knights on Heading for New Shores.
 * Each test cites its clause: COMB-n (catan.com/seafarers, "Combination with
 * the Cities & Knights Expansion", accessed 2026-11-02), CK12-n (CK25 p. 12)
 * or an interpretation SFCK-n recorded in docs/FIDELITY.md.
 *
 * Geometry on the printed 4-player map (SF25 p. 5), around the sea hex
 * (2,-2) north-east of the main island:
 *   v28  main-island coast (mountains (1,-1), 4), land edges to v29 and v31
 *   v11  between three sea hexes; sea edges to v28, v10 and v6
 *   v10  coast of the gold field (3,-3), 4
 *   v15  small island: gold (3,-3) 4 and hills (3,-2) 5
 *   v6   small island in the north: pasture (1,-3) 11
 */

import { describe, expect, it } from 'vitest';
import { isLandHex, scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, partnerSeat, routeLength } from '../src/engine.ts';
import { getProfile } from '../src/profiles.ts';
import { projectEvent, projectGame } from '../src/project.ts';
import { edgesOfHex, verticesOfHex } from '../src/topology.ts';
import { recruitSites } from '../src/modules/citiesKnights/knights.ts';
import { merchantHexes } from '../src/modules/citiesKnights/merchant.ts';
import { openRoads } from '../src/modules/citiesKnights/cards-politics.ts';
import { ckState, ckView, knightAt } from '../src/modules/citiesKnights/state.ts';
import { seafarersState } from '../src/modules/seafarers/state.ts';
import type { GameState } from '../src/types.ts';
import {
  actCk,
  addKnight,
  edgeBetween,
  eventsOf,
  giveCommodities,
  handCards,
  moduleFrame,
  playCard,
  player,
  rejectCard,
  rejectCk,
  rollRng,
  setImprovement,
  SCIENCE,
  SHIP,
  TRADE,
} from './ck-helpers.ts';
import { forceTurn, give, scriptedRng, setHand } from './helpers.ts';
import { corner, hex, settle, ship, side } from './seafarers-helpers.ts';
import { afterFirstAttack, emptySfckGame, sfckGame } from './sfck-helpers.ts';

const V28 = 28;
const V11 = 11;
const V10 = 10;
const V15 = 15;
const V6 = 6;
const V29 = 29;

function sfck(state: GameState, playerId: string): any {
  return actionHints(state, playerId).modules!.seafarersCitiesKnights;
}

function ckHints(state: GameState, playerId: string): any {
  return actionHints(state, playerId).modules!.citiesKnights;
}

/** p1: settlement on v28 with ships v28–v11 and v11–v10. */
function shipLine(): GameState {
  const state = emptySfckGame(4);
  settle(state, 'p1', V28);
  ship(state, 'p1', edgeBetween(state, V28, V11));
  ship(state, 'p1', edgeBetween(state, V11, V10));
  return state;
}

describe('R-COMB profiles and setup (COMB-7, CK12-2, CK25 p. 3, SF25 pp. 2–5)', () => {
  it('SFCK-P1 both combined profiles run the combination layer first and aim for 16', () => {
    for (const id of ['sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025']) {
      const profile = getProfile(id)!;
      expect(profile.ruleModules).toEqual(['seafarersCitiesKnights', 'seafarers', 'citiesKnights']);
      expect(profile.victoryTarget).toBe(16);
      expect(profile.devDeck).toEqual([]);
      expect(profile.pieces).toMatchObject({ roads: 15, ships: 15, settlements: 5, cities: 4 });
    }
  });

  it('SFCK-P2 the progress decks replace the development cards; supplies per player count', () => {
    for (const players of [3, 4, 5, 6] as const) {
      const { state } = sfckGame(players);
      expect(state.devDeck).toEqual([]);
      expect(Object.values(state.progressDecks).map((deck) => deck.length)).toEqual([18, 18, 18]);
      const commodity = players <= 4 ? 12 : 18;
      expect(state.commodityBank).toEqual({ paper: commodity, cloth: commodity, coin: commodity });
    }
  });

  it('SFCK-7 both bandits wait off the board until the first attack (COMB-10, CK12-2)', () => {
    for (const players of [3, 4, 5, 6] as const) {
      const { state } = sfckGame(players);
      expect(state.board.robber).toBe(-1);
      expect(state.board.pirate).toBeNull();
    }
  });

  it('SFCK-P3 the second setup building is a city on the main island and takes one card per terrain (CK25 p. 5)', () => {
    const { state } = sfckGame(4);
    let next = state;
    const order = next.turn.setup!.order;
    const sites: number[] = [];
    for (let step = 0; step < order.length; step++) {
      const actor = next.players[order[step]!]!.id;
      const current = next;
      const site = topologyOf(current).vertices.findIndex((_, vertex) => applyCommand(current, actor, { type: 'setup.placeBuilding', vertex }, scriptedRng([0])).ok);
      sites.push(site);
      next = actCk(next, actor, { type: 'setup.placeBuilding', vertex: site }).state;
      const edge = topologyOf(next).vertices[sites[step]!]!.edges.find((candidate) => applyCommand(next, actor, { type: 'setup.placeRoad', edge: candidate }, scriptedRng([0])).ok)!;
      next = actCk(next, actor, { type: 'setup.placeRoad', edge }).state;
    }
    expect(next.turn.phase).toBe('preroll');
    expect(next.board.buildings[sites[7]!]).toEqual({ player: 'p1', city: true });
    expect(next.board.buildings[sites[0]!]).toEqual({ player: 'p1', city: false });
    // Starting buildings stay on the main island, as in New Shores.
    const fresh = sfckGame(4).state;
    expect(rejectCk(fresh, 'p1', { type: 'setup.placeBuilding', vertex: V15 })).toBe('E_ILLEGAL_TARGET');
  });
});

describe('R-COMB gold fields (COMB-8, CK12-4, SFCK-5)', () => {
  function goldBoard(): GameState {
    const state = emptySfckGame(4, 0, 'preroll');
    settle(state, 'p1', V15, true); // city at gold (3,-3) 4
    settle(state, 'p2', corner(state, 1, -1, 1), true); // city at mountains (1,-1) 4
    return state;
  }

  it('COMB-8 a city at a gold field receives resources only, never commodities', () => {
    const rolled = actCk(goldBoard(), 'p1', { type: 'turn.roll' }, rollRng(1, 3, TRADE));
    expect(player(rolled.state, 'p1').commodities).toEqual({ paper: 0, cloth: 0, coin: 0 });
    expect(player(rolled.state, 'p2').commodities.coin).toBe(1);
    expect(player(rolled.state, 'p2').resources.ore).toBe(1);
    expect(moduleFrame(rolled.state)).toMatchObject({ kind: 'seafarers.gold', responders: ['p1'], data: { picks: { p1: 2 } } });
    const chosen = actCk(rolled.state, 'p1', { type: 'gold.choose', resources: ['ore', 'grain'] });
    expect(player(chosen.state, 'p1').resources).toMatchObject({ ore: 1, grain: 1 });
    expect(player(chosen.state, 'p1').commodities).toEqual({ paper: 0, cloth: 0, coin: 0 });
  });

  it('SFCK-5 gold counts as production for the aqueduct; the gold choice comes before the bonus', () => {
    const state = goldBoard();
    setImprovement(state, 'p1', 'science', 3);
    setImprovement(state, 'p3', 'science', 3);
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(1, 3, SCIENCE));
    expect(moduleFrame(rolled.state)!.kind).toBe('seafarers.gold');
    expect(rolled.state.pendingQueue).toHaveLength(1);
    expect(rolled.state.pendingQueue![0]).toMatchObject({ kind: 'citiesKnights.scienceBonus', responders: ['p3'] });
    const chosen = actCk(rolled.state, 'p1', { type: 'gold.choose', resources: ['wool', 'wool'] });
    expect(moduleFrame(chosen.state)).toMatchObject({ kind: 'citiesKnights.scienceBonus', responders: ['p3'] });
  });

  it('SFCK-5 a gold field under the robber gives no gold and so the aqueduct applies', () => {
    const state = afterFirstAttack(goldBoard());
    state.board.robber = hex(state, 3, -3);
    setImprovement(state, 'p1', 'science', 3);
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(1, 3, SCIENCE));
    expect(moduleFrame(rolled.state)).toMatchObject({ kind: 'citiesKnights.scienceBonus', responders: ['p1'] });
  });
});

describe('R-COMB the merchant (COMB-9, CK12-4)', () => {
  it('COMB-9 the merchant may not stand on a gold field', () => {
    const state = emptySfckGame(4);
    settle(state, 'p1', V15);
    const gold = hex(state, 3, -3);
    const hills = hex(state, 3, -2);
    expect(merchantHexes(state, 'p1')).toEqual([hills]);
    handCards(state, 'p1', ['merchant', 'merchant']);
    expect(rejectCard(state, 'p1', 'merchant', { hex: gold })).toBe('E_ILLEGAL_TARGET');
    const placed = playCard(state, 'p1', 'merchant', { hex: hills });
    expect(ckView(placed.state).merchant).toEqual({ player: 'p1', hex: hills });
  });
});

describe('R-COMB bandits before and after the first attack (COMB-10, CK12-2, SFCK-7)', () => {
  it('COMB-10 a 7 before the first attack moves neither bandit; discards still apply', () => {
    const state = emptySfckGame(4, 0, 'preroll');
    setHand(state, 'p2', { wool: 8 });
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, TRADE));
    expect(rolled.state.pending).toMatchObject({ kind: 'discard' });
    const discarded = actCk(rolled.state, 'p2', { type: 'pending.discard', resources: ['wool', 'wool', 'wool', 'wool'] } as never);
    expect(discarded.state.pending).toBeNull();
    expect(discarded.state.board.robber).toBe(-1);
    expect(discarded.state.board.pirate).toBeNull();
  });

  it('COMB-10 the pirate may not be moved before the first attack, by any means', () => {
    const state = emptySfckGame(4);
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
    expect(rejectCk(state, 'p1', { type: 'pending.moveRobber', hex: hex(state, 2, -2) })).toBe('E_PIRATE_INACTIVE');
    expect(rejectCk(state, 'p1', { type: 'pending.moveRobber', hex: null })).toBe('E_PIRATE_INACTIVE');
    const line = shipLine();
    addKnight(line, { player: 'p1', vertex: V11, level: 1, active: true });
    line.board.pirate = hex(line, 2, -2);
    expect(rejectCk(line, 'p1', { type: 'knight.chasePirate', vertex: V11 })).toBe('E_PIRATE_INACTIVE');
    expect(sfck(line, 'p1')).toMatchObject({ pirateActive: false, pirateChase: [] });
  });

  it('SFCK-7 the printed robber hex produces until the first attack places the robber', () => {
    const state = emptySfckGame(3, 0, 'preroll');
    const robberHex = state.board.layout.robber;
    const number = state.board.layout.numbers[robberHex]!;
    const cell = topologyOf(state).hexes[robberHex]!;
    const site = corner(state, cell.q, cell.r, 0);
    settle(state, 'p2', site);
    const before = player(state, 'p2').resources;
    const yellow = Math.min(6, number - 1);
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(yellow, number - yellow, TRADE));
    const gained = Object.entries(player(rolled.state, 'p2').resources).reduce((sum, [kind, count]) => sum + count - before[kind as keyof typeof before], 0);
    expect(gained).toBeGreaterThanOrEqual(1);
  });

  it('SFCK-7 the first attack puts the robber on the scenario’s robber hex; the pirate stays on the frame', () => {
    for (const players of [3, 4] as const) {
      const state = emptySfckGame(players, 0, 'preroll');
      ckState(state).barbarian = 6;
      const attacked = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(6, 6, SHIP));
      expect(ckView(attacked.state).attacks).toBe(1);
      expect(attacked.state.board.robber).toBe(state.board.layout.robber);
      expect(attacked.state.board.pirate).toBeNull();
      expect(sfck(attacked.state, 'p1').pirateActive).toBe(true);
    }
  });

  it('COMB-10 after the first attack a 7 moves the robber or the pirate', () => {
    const state = afterFirstAttack(emptySfckGame(4, 0, 'preroll'));
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, TRADE));
    expect(rolled.state.pending).toMatchObject({ kind: 'moveRobber', cause: 'seven', pirate: false });
    expect(sfck(rolled.state, 'p1').bandit).toBe('either');
    const pirate = actCk(rolled.state, 'p1', { type: 'pending.moveRobber', hex: hex(state, 2, -2) });
    expect(pirate.state.board.pirate).toBe(hex(state, 2, -2));
    const robber = actCk(rolled.state, 'p1', { type: 'pending.moveRobber', hex: hex(state, 1, -1) });
    expect(robber.state.board.robber).toBe(hex(state, 1, -1));
  });
});

describe('R-COMB chasing the robber or the pirate (CK25 pp. 9–10, COMB-6, CK12-7/8, SFCK-4/8)', () => {
  it('SFCK-4 a knight chasing the robber moves the robber only', () => {
    const state = afterFirstAttack(shipLine());
    addKnight(state, { player: 'p1', vertex: V29, level: 1, active: true });
    state.board.robber = hex(state, 1, -1);
    const chased = actCk(state, 'p1', { type: 'knight.chaseRobber', vertex: V29 });
    expect(sfck(chased.state, 'p1').bandit).toBe('robber');
    expect(rejectCk(chased.state, 'p1', { type: 'pending.moveRobber', hex: hex(state, 2, -2) })).toBe('E_ILLEGAL_TARGET');
    expect(rejectCk(chased.state, 'p1', { type: 'pending.moveRobber', hex: null })).toBe('E_ILLEGAL_TARGET');
    const moved = actCk(chased.state, 'p1', { type: 'pending.moveRobber', hex: hex(state, 3, -2) });
    expect(moved.state.board.robber).toBe(hex(state, 3, -2));
  });

  it('COMB-6 an active knight next to the pirate’s sea hex chases the pirate, which then robs as usual', () => {
    const state = afterFirstAttack(shipLine());
    state.board.pirate = hex(state, 2, -2);
    addKnight(state, { player: 'p1', vertex: V11, level: 1, active: true });
    // p2 has a ship on the sea hex (2,0) and one card.
    ship(state, 'p2', edgeBetween(state, 48, 47));
    setHand(state, 'p2', { brick: 1 });
    expect(sfck(state, 'p1').pirateChase).toEqual([V11]);
    const chased = actCk(state, 'p1', { type: 'knight.chasePirate', vertex: V11 });
    expect(knightAt(chased.state, V11)!.active).toBe(false);
    expect(eventsOf(chased, 'sfck.knightChasedPirate')[0]!.params).toEqual({ playerId: 'p1', vertex: V11, hex: hex(state, 2, -2) });
    expect(chased.state.pending).toMatchObject({ kind: 'moveRobber', actor: 'p1', cause: 'knight', pirate: true });
    expect(sfck(chased.state, 'p1').bandit).toBe('pirate');
    expect(rejectCk(chased.state, 'p1', { type: 'pending.moveRobber', hex: hex(state, 1, -1) })).toBe('E_ILLEGAL_TARGET');
    const moved = actCk(chased.state, 'p1', { type: 'pending.moveRobber', hex: hex(state, 2, 0) });
    expect(moved.state.board.pirate).toBe(hex(state, 2, 0));
    expect(moved.state.board.robber).toBe(state.board.robber);
    expect(moved.state.pending).toMatchObject({ kind: 'steal', candidates: ['p2'], pirate: true });
    const stole = actCk(moved.state, 'p1', { type: 'pending.steal', victim: 'p2' });
    expect(player(stole.state, 'p1').resources.brick).toBe(1);
  });

  it('SFCK-8 a knight on a coastal intersection of the pirate’s hex may chase it (COMB-6 wording)', () => {
    const state = afterFirstAttack(shipLine());
    const topo = topologyOf(state);
    // V29 is on the main island's coast, reached by a road from the
    // settlement at V28; one of its hexes is sea, the others land.
    state.board.roads[edgeBetween(state, V28, V29)] = { player: 'p1', ship: false };
    const terrain = state.board.layout.terrain;
    expect(topo.vertices[V29]!.hexes.some((h) => terrain[h] !== 'sea')).toBe(true);
    const seaHex = topo.vertices[V29]!.hexes.find((h) => terrain[h] === 'sea')!;
    state.board.pirate = seaHex;
    addKnight(state, { player: 'p1', vertex: V29, level: 1, active: true });
    expect(sfck(state, 'p1').pirateChase).toContain(V29);
    const chased = actCk(state, 'p1', { type: 'knight.chasePirate', vertex: V29 });
    expect(chased.state.pending).toMatchObject({ kind: 'moveRobber', pirate: true });
  });

  it('COMB-6 the chase may send the pirate to the frame', () => {
    const state = afterFirstAttack(shipLine());
    state.board.pirate = hex(state, 2, -2);
    addKnight(state, { player: 'p1', vertex: V11, level: 1, active: true });
    const chased = actCk(state, 'p1', { type: 'knight.chasePirate', vertex: V11 });
    const moved = actCk(chased.state, 'p1', { type: 'pending.moveRobber', hex: null });
    expect(moved.state.board.pirate).toBeNull();
    expect(moved.state.pending).toBeNull();
  });

  it('COMB-6 needs an active knight that can act, next to the pirate', () => {
    const state = afterFirstAttack(shipLine());
    state.board.pirate = hex(state, 2, 0);
    addKnight(state, { player: 'p1', vertex: V11, level: 1, active: true });
    expect(rejectCk(state, 'p1', { type: 'knight.chasePirate', vertex: V11 })).toBe('E_ILLEGAL_TARGET');
    state.board.pirate = hex(state, 2, -2);
    knightAt(state, V11)!.active = false;
    expect(rejectCk(state, 'p1', { type: 'knight.chasePirate', vertex: V11 })).not.toBe('E_PIRATE_INACTIVE');
    expect(sfck(state, 'p1').pirateChase).toEqual([]);
    knightAt(state, V11)!.active = true;
    knightAt(state, V11)!.activatedIn = state.windowId;
    expect(sfck(state, 'p1').pirateChase).toEqual([]);
    state.turn.phase = 'preroll';
    knightAt(state, V11)!.activatedIn = undefined;
    expect(rejectCk(state, 'p1', { type: 'knight.chasePirate', vertex: V11 })).toBe('E_WRONG_PHASE');
  });

  it('CK-FAQ 63, CK12-8 Taxation moves the robber only, never to the sea', () => {
    const state = afterFirstAttack(emptySfckGame(4));
    handCards(state, 'p1', ['taxation']);
    expect(rejectCard(state, 'p1', 'taxation', { hex: hex(state, 2, -2) })).toBe('E_ILLEGAL_TARGET');
  });
});

describe('R-COMB knights on shipping routes (COMB-2/3, CK12-5, SFCK-1/2)', () => {
  it('COMB-2 a knight crosses the sea along own ships and may end between three sea hexes (COMB-3)', () => {
    const state = shipLine();
    road(state, 'p1', edgeBetween(state, V28, V29));
    addKnight(state, { player: 'p1', vertex: V29, level: 1, active: true });
    const reach = ckHints(state, 'p1').knights[0];
    expect(reach.moves).toEqual(expect.arrayContaining([V11, V10]));
    const moved = actCk(state, 'p1', { type: 'knight.move', from: V29, to: V11 });
    expect(knightAt(moved.state, V11)).toMatchObject({ player: 'p1', active: false });
  });

  it('SFCK-1 roads and ships join only at an own building, or where the knight starts', () => {
    const state = shipLine();
    road(state, 'p1', edgeBetween(state, V28, V29));
    state.board.buildings[V28] = null;
    settle(state, 'p1', corner(state, 1, -1, 3) === V29 ? corner(state, 1, -1, 2) : V29);
    addKnight(state, { player: 'p1', vertex: V29, level: 1, active: true });
    expect(ckHints(state, 'p1').knights[0].moves).not.toContain(V11);
    const start = shipLine();
    start.board.buildings[V28] = null;
    settle(start, 'p1', V29);
    road(start, 'p1', edgeBetween(start, V28, V29));
    addKnight(start, { player: 'p1', vertex: V28, level: 1, active: true });
    expect(ckHints(start, 'p1').knights[0].moves).toEqual(expect.arrayContaining([V11, V10]));
  });

  it('SFCK-2 recruiting stays on land: a coast touching an own ship is fine, a sea intersection is not', () => {
    const state = shipLine();
    give(state, 'p1', { wool: 2, ore: 2 });
    expect(recruitSites(state, 'p1')).toContain(V10);
    expect(recruitSites(state, 'p1')).not.toContain(V11);
    expect(rejectCk(state, 'p1', { type: 'knight.recruit', vertex: V11 })).toBe('E_ILLEGAL_TARGET');
    const recruited = actCk(state, 'p1', { type: 'knight.recruit', vertex: V10 });
    expect(knightAt(recruited.state, V10)).toMatchObject({ player: 'p1', level: 1 });
  });

  it('CK12-5 a displaced knight retreats along its owner’s ships, also onto the sea', () => {
    const state = emptySfckGame(4);
    settle(state, 'p2', V28);
    road(state, 'p2', edgeBetween(state, V28, V29));
    ship(state, 'p2', edgeBetween(state, V28, V11));
    addKnight(state, { player: 'p2', vertex: V29, level: 1, active: true });
    const v31 = corner(state, 1, -1, 5);
    settle(state, 'p1', corner(state, 1, -1, 2));
    road(state, 'p1', edgeBetween(state, corner(state, 1, -1, 2), V29));
    handCards(state, 'p1', ['intrigue']);
    const played = playCard(state, 'p1', 'intrigue', { vertex: V29 });
    expect(moduleFrame(played.state)).toMatchObject({ kind: 'citiesKnights.displaced', responders: ['p2'] });
    expect(ckHints(played.state, 'p2').retreat).toContain(V11);
    expect(ckHints(played.state, 'p2').retreat).not.toContain(v31);
    const retreated = actCk(played.state, 'p2', { type: 'knight.retreat', vertex: V11 });
    expect(knightAt(retreated.state, V11)).toMatchObject({ player: 'p2' });
  });

  it('COMB-0 Intrigue reaches a knight that touches one of the player’s ships', () => {
    const state = shipLine();
    addKnight(state, { player: 'p2', vertex: V6, level: 3, active: true });
    ship(state, 'p1', edgeBetween(state, V11, V6));
    handCards(state, 'p1', ['intrigue']);
    const played = playCard(state, 'p1', 'intrigue', { vertex: V6 });
    expect(eventsOf(played, 'ck.knightIntrigued')[0]!.params).toMatchObject({ victim: 'p2', vertex: V6 });
  });
});

describe('R-COMB knights and ships (COMB-4/5, CK12-6, SF-FAQ 18, SFCK-3)', () => {
  it('COMB-5 an opponent knight between two ships splits the Longest Trade Route and pins both ships', () => {
    const state = shipLine();
    expect(routeLength(state, 'p1')).toBe(2);
    addKnight(state, { player: 'p2', vertex: V11, level: 1, active: false });
    expect(routeLength(state, 'p1')).toBe(1);
    expect(rejectCk(state, 'p1', { type: 'ship.move', from: edgeBetween(state, V11, V10), to: edgeBetween(state, V10, V15) })).toBe('E_SHIP_PINNED_BY_KNIGHT');
  });

  it('COMB-5 a ship may not be built past an opponent knight', () => {
    const state = emptySfckGame(4);
    settle(state, 'p1', V28);
    ship(state, 'p1', edgeBetween(state, V28, V11));
    addKnight(state, { player: 'p2', vertex: V11, level: 1, active: true });
    give(state, 'p1', { lumber: 1, wool: 1 });
    expect(rejectCk(state, 'p1', { type: 'build.ship', edge: edgeBetween(state, V11, V10) })).toBe('E_ILLEGAL_TARGET');
    expect(rejectCk(state, 'p1', { type: 'ship.move', from: edgeBetween(state, V28, V11), to: side(state, 2, -2, 4) })).toBe('E_SHIP_PINNED_BY_KNIGHT');
  });

  it('COMB-4 an own knight at the last ship closes the route; without it the ship moves', () => {
    const open = shipLine();
    const moved = actCk(open, 'p1', { type: 'ship.move', from: edgeBetween(open, V11, V10), to: edgeBetween(open, V11, V6) });
    expect(moved.state.board.roads[edgeBetween(open, V11, V6)]).toEqual({ player: 'p1', ship: true });
    const closed = shipLine();
    addKnight(closed, { player: 'p1', vertex: V10, level: 1, active: true });
    expect(rejectCk(closed, 'p1', { type: 'ship.move', from: edgeBetween(closed, V11, V10), to: edgeBetween(closed, V11, V6) })).toBe('E_SHIP_PINNED_BY_KNIGHT');
    // A route closed by two own buildings keeps the Seafarers error.
    const between = shipLine();
    settle(between, 'p1', V10);
    expect(rejectCk(between, 'p1', { type: 'ship.move', from: edgeBetween(between, V11, V10), to: edgeBetween(between, V11, V6) })).toBe('E_SHIP_NOT_MOVABLE');
    // A knight carried on a sea intersection holds the ship it stands on.
    const carried = shipLine();
    carried.board.roads[edgeBetween(carried, V11, V10)] = null;
    addKnight(carried, { player: 'p1', vertex: V11, level: 1, active: true });
    expect(rejectCk(carried, 'p1', { type: 'ship.move', from: edgeBetween(carried, V28, V11), to: side(carried, 2, -2, 4) })).toBe('E_SHIP_PINNED_BY_KNIGHT');
    // A knight behind the open end does not: the move cannot cut it off.
    const behind = shipLine();
    addKnight(behind, { player: 'p1', vertex: V11, level: 1, active: true });
    expect(applyCommand(behind, 'p1', { type: 'ship.move', from: edgeBetween(behind, V11, V10), to: edgeBetween(behind, V11, V6) } as never, scriptedRng([0])).ok).toBe(true);
  });

  it('CK-FAQ 64–66, CK12-9 Diplomacy removes an open ship; the owner re-places an own ship, built this turn', () => {
    const state = shipLine();
    state.board.pirate = hex(state, 2, -2); // the pirate does not protect it (CK-FAQ 65)
    const tip = edgeBetween(state, V11, V10);
    expect(openRoads(state)).toEqual([tip]);
    handCards(state, 'p2', ['diplomacy']);
    handCards(state, 'p1', ['diplomacy']);
    forceTurn(state, 1, 'action');
    const removed = playCard(state, 'p2', 'diplomacy', { edge: tip });
    expect(removed.state.board.roads[tip]).toBeNull();
    expect(eventsOf(removed, 'ck.roadRemoved')[0]!.params).toEqual({ playerId: 'p2', owner: 'p1', edge: tip, ship: true });

    forceTurn(state, 0, 'action');
    const own = playCard(state, 'p1', 'diplomacy', { edge: tip });
    expect(moduleFrame(own.state)).toMatchObject({ kind: 'citiesKnights.diplomacyRoad', data: { ship: true } });
    // An inland edge a road could take is not a legal replacement for a ship.
    const inland = edgeBetween(state, V29, corner(state, 1, -1, 2));
    own.state.board.roads[edgeBetween(state, V28, V29)] = { player: 'p1', ship: false };
    expect(rejectCk(own.state, 'p1', { type: 'progress.diplomacyRoad', edge: inland })).toBe('E_ILLEGAL_TARGET');
    own.state.board.roads[edgeBetween(state, V28, V29)] = null;
    const target = edgeBetween(state, V11, V6);
    const rebuilt = actCk(own.state, 'p1', { type: 'progress.diplomacyRoad', edge: target });
    expect(rebuilt.state.board.roads[target]).toEqual({ player: 'p1', ship: true });
    expect(eventsOf(rebuilt, 'ck.diplomacyRoadBuilt')[0]!.params).toEqual({ playerId: 'p1', edge: target, ship: true });
    // The re-placed ship counts as built this turn (SFCK-6, CK25 p. 12 "only
    // then build a new ship"; SF25 p. 2): even with the pirate gone it may
    // not move until the next turn.
    rebuilt.state.board.pirate = null;
    expect((projectGame(rebuilt.state, 'p1').modules!.seafarers as { shipsBuiltThisTurn: number[] }).shipsBuiltThisTurn).toEqual([target]);
    expect(rejectCk(rebuilt.state, 'p1', { type: 'ship.move', from: target, to: edgeBetween(state, V11, V10) })).toBe('E_SHIP_BUILT_THIS_TURN');
    expect((actionHints(rebuilt.state, 'p1').modules!.seafarers as { movableShips: { edge: number }[] }).movableShips.map((entry) => entry.edge)).not.toContain(target);
    // In the player's next action window it moves again.
    rebuilt.state.windowId += 1;
    expect(applyCommand(rebuilt.state, 'p1', { type: 'ship.move', from: target, to: edgeBetween(state, V11, V10) } as never, scriptedRng([0])).ok).toBe(true);
  });

  it('COMB-0 Road Building places ships as well as roads (CK25 p. 14, SF25 p. 3)', () => {
    const state = shipLine();
    handCards(state, 'p1', ['roadBuilding']);
    const played = playCard(state, 'p1', 'roadBuilding');
    expect(played.state.pending).toMatchObject({ kind: 'freeRoads', remaining: 2 });
    const first = actCk(played.state, 'p1', { type: 'build.ship', edge: edgeBetween(state, V10, V15) } as never);
    const second = actCk(first.state, 'p1', { type: 'build.road', edge: edgeBetween(state, V28, V29) });
    expect(second.state.board.roads[edgeBetween(state, V10, V15)]).toEqual({ player: 'p1', ship: true });
    expect(second.state.pending).toBeNull();
  });
});

describe('R-COMB barbarians and score (COMB-1, COMB-7, CK12-3)', () => {
  it('COMB-1 the barbarians count every city on every island; knights at sea defend', () => {
    const state = shipLine();
    state.turn.phase = 'preroll';
    settle(state, 'p1', V15, true);
    settle(state, 'p2', corner(state, 0, 0, 0), true);
    addKnight(state, { player: 'p1', vertex: V11, level: 2, active: true });
    ckState(state).barbarian = 6;
    const attacked = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(6, 6, SHIP));
    expect(ckView(attacked.state).lastAttack).toMatchObject({ barbarians: 2, defenders: 2, outcome: 'defenders', defender: 'p1' });
  });

  it('COMB-7 the score adds island bonus, metropolis, defender, merchant and Longest Trade Route', () => {
    const state = shipLine();
    settle(state, 'p1', V15, true);
    seafarersState(state).islands = { p1: [3] };
    player(state, 'p1').bonusPoints = 2; // island (3,-3)/(3,-2)
    ckState(state).metropolises.science = { player: 'p1', vertex: V15 };
    ckState(state).progressVp.p1 = ['printing'];
    ckState(state).merchant = { player: 'p1', hex: hex(state, 3, -2) };
    state.awards.longestRoad = 'p1';
    // settlement 1 + city 2 + metropolis 2 + island 2 + printing 1 + merchant 1 + route 2
    expect(scoreOf(state, 'p1', { includeHidden: true })).toBe(11);
    const view = projectGame(state, 'p2');
    expect(view.players.find((entry) => entry.id === 'p1')!.publicScore).toBe(11);
  });

  it('COMB-7 a VP progress card drawn on the roll wins at 16, not at 13 (CK25 pp. 6, 14, 16)', () => {
    const setup = () => {
      const state = emptySfckGame(4, 0, 'preroll');
      state.progressDecks.science = ['printing', 'mining'];
      settle(state, 'p1', V28);
      setImprovement(state, 'p1', 'science', 1);
      return state;
    };
    // At 15 (settlement 1 + 14 defender points) Printing makes 16: p1 wins at once.
    const winning = setup();
    player(winning, 'p1').defenders = 14;
    expect(scoreOf(winning, 'p1', { includeHidden: true })).toBe(15);
    const won = actCk(winning, 'p1', { type: 'turn.roll' }, rollRng(1, 1, SCIENCE));
    expect(scoreOf(won.state, 'p1', { includeHidden: true })).toBe(16);
    expect(won.state.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
    expect(won.state.pending).toBeNull();
    // At 12, the C&K target of 13 is not enough in the combined profile.
    const short = setup();
    player(short, 'p1').defenders = 11;
    const drawn = actCk(short, 'p1', { type: 'turn.roll' }, rollRng(1, 1, SCIENCE));
    expect(scoreOf(drawn.state, 'p1', { includeHidden: true })).toBe(13);
    expect(drawn.state.result).toBeNull();
  });
});

describe('R-COMB overlapping hooks (allowBuilding, bankRate, discardLimit)', () => {
  it('allowBuilding: a settlement on a small island outside setup is fine, unless a knight stands there', () => {
    const state = shipLine();
    give(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    addKnight(state, { player: 'p2', vertex: V10, level: 1, active: true });
    expect(rejectCk(state, 'p1', { type: 'build.settlement', vertex: V10 })).toBe('E_ILLEGAL_TARGET');
    ckState(state).knights = [];
    const built = actCk(state, 'p1', { type: 'build.settlement', vertex: V10 });
    expect(player(built.state, 'p1').bonusPoints).toBe(2);
  });

  it('bankRate: the merchant’s 2:1 applies next to the gold field’s neighbour hex', () => {
    const state = emptySfckGame(4);
    settle(state, 'p1', V15);
    ckState(state).merchant = { player: 'p1', hex: hex(state, 3, -2) };
    give(state, 'p1', { brick: 2 });
    const traded = actCk(state, 'p1', { type: 'trade.bank', give: 'brick', receive: 'ore' } as never);
    expect(player(traded.state, 'p1').resources).toMatchObject({ brick: 0, ore: 1 });
  });

  it('discardLimit: city walls raise the hand limit on a 7, before and after the first attack', () => {
    const state = emptySfckGame(4, 0, 'preroll');
    settle(state, 'p2', corner(state, 0, 0, 0), true);
    ckState(state).walls = [corner(state, 0, 0, 0)];
    setHand(state, 'p2', { wool: 9 });
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, TRADE));
    expect(rolled.state.pending).toBeNull();
  });
});

describe('R-COMB paired 5–6 turns (SF56-25 pp. 2–3, CK56-25 pp. 3–4)', () => {
  function paired(): { state: GameState; p2: string } {
    const { state } = sfckGame(6, 5);
    state.turn.setup = null;
    state.turn.phase = 'action';
    state.turn.seat = 0;
    state.windowId += 1;
    const p2 = state.players[partnerSeat(state, 0)]!.id;
    settle(state, 'p1', corner(state, 2, 2, 3));
    ship(state, 'p1', side(state, 2, 2, 2));
    settle(state, p2, corner(state, 2, 3, 3));
    ship(state, p2, side(state, 2, 3, 3));
    return { state, p2 };
  }

  it('Player 2 moves a ship, plays progress cards, trades with the supply only, and has no Alchemy', () => {
    const { state, p2 } = paired();
    const next = actCk(state, 'p1', { type: 'turn.end' }).state;
    expect(next.turn).toMatchObject({ pairedActor: 2 });
    const moved = actCk(next, p2, { type: 'ship.move', from: side(next, 2, 3, 3), to: side(next, 2, 3, 2) } as never).state;
    expect(moved.board.roads[side(next, 2, 3, 2)]).toEqual({ player: p2, ship: true });
    handCards(moved, p2, ['resourceMonopoly', 'alchemy']);
    give(moved, 'p1', { wool: 2 });
    const played = playCard(moved, p2, 'resourceMonopoly', { kind: 'wool' });
    expect(player(played.state, p2).resources.wool).toBe(2); // up to 2 from each player (CK25 p. 14)
    expect(rejectCard(played.state, p2, 'alchemy', { dice: [3, 4] })).toBe('E_WRONG_PHASE');
    expect(rejectCk(played.state, p2, { type: 'trade.offer', to: 'all', give: { wool: 1 }, want: { ore: 1 } } as never)).toBe('E_PAIRED_NO_DOMESTIC_TRADE');
    give(played.state, p2, { wool: 3 });
    expect(applyCommand(played.state, p2, { type: 'trade.bank', give: 'wool', receive: 'ore' } as never, scriptedRng([0])).ok).toBe(true);
  });

  it('Player 2 may chase the pirate with a knight after the first attack', () => {
    const { state, p2 } = paired();
    afterFirstAttack(state);
    const next = actCk(state, 'p1', { type: 'turn.end' }).state;
    const sea = topologyOf(next).vertices[corner(next, 2, 3, 3)]!.hexes.find((cell) => next.board.layout.terrain[cell] === 'sea')!;
    next.board.pirate = sea;
    addKnight(next, { player: p2, vertex: corner(next, 2, 3, 3), level: 1, active: true });
    expect(sfck(next, p2).pirateChase).toEqual([corner(next, 2, 3, 3)]);
    const chased = actCk(next, p2, { type: 'knight.chasePirate', vertex: corner(next, 2, 3, 3) });
    expect(chased.state.pending).toMatchObject({ kind: 'moveRobber', actor: p2, pirate: true });
  });
});

describe.each(['pirate', 'robber'] as const)('R-COMB %s theft (SF25 p. 2, CK25 p. 7, CK-FAQ 34)', (bandit) => {
  function theftState(players: 4 | 6 = 4): { state: GameState; target: number } {
    const state = afterFirstAttack(emptySfckGame(players));
    const topo = topologyOf(state);
    const target = bandit === 'pirate'
      ? topo.hexes.findIndex((_, hex) => !isLandHex(state, hex) && verticesOfHex(topo, hex).some((vertex) => topo.vertices[vertex]!.hexes.some((cell) => isLandHex(state, cell))))
      : topo.hexes.findIndex((_, hex) => isLandHex(state, hex) && hex !== state.board.robber);
    const edges = edgesOfHex(topo, target);
    if (bandit === 'pirate') {
      // 只有 p2 有可偷的牌；排除自己、空手船主，以及只有沿岸建築的玩家。
      ship(state, 'p1', edges[0]!);
      ship(state, 'p2', edges[1]!);
      ship(state, 'p2', edges[2]!);
      ship(state, 'p3', edges[3]!);
      const coast = verticesOfHex(topo, target).find((vertex) => topo.vertices[vertex]!.hexes.some((hex) => isLandHex(state, hex)))!;
      settle(state, 'p4', coast);
    } else {
      settle(state, 'p2', verticesOfHex(topo, target)[0]!);
    }
    giveCommodities(state, 'p1', { coin: 1 });
    giveCommodities(state, 'p4', { paper: 1 });
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
    return { state, target };
  }

  it.each(['paper', 'cloth', 'coin'] as const)('steals from a %s-only hand and preserves the result across snapshots', (commodity) => {
    for (const players of [4, 6] as const) {
      const { state, target } = theftState(players);
      giveCommodities(state, 'p2', { [commodity]: 1 });
      const moved = actCk(state, 'p1', { type: 'pending.moveRobber', hex: target }, scriptedRng([]));
      expect(moved.state.pending).toMatchObject({ kind: 'steal', candidates: ['p2'], pirate: bandit === 'pirate' });
      const before = JSON.stringify(moved.state);
      const stolen = actCk(moved.state, 'p1', { type: 'pending.steal', victim: 'p2' }, scriptedRng([0]));
      expect(JSON.stringify(moved.state)).toBe(before);
      expect(player(stolen.state, 'p1').commodities[commodity]).toBe(player(state, 'p1').commodities[commodity] + 1);
      expect(player(stolen.state, 'p2').commodities[commodity]).toBe(0);
      expect(stolen.state.commodityBank).toEqual(state.commodityBank);
      expect(stolen.state.pending).toBeNull();
      const theft = eventsOf(stolen, 'robber.stole')[0]!;
      expect(projectEvent(theft, 'p1').params).toMatchObject({ resource: commodity });
      expect(projectEvent(theft, 'p2').params).toMatchObject({ resource: commodity });
      expect(projectEvent(theft, 'p3').params).not.toHaveProperty('resource');
      expect(projectGame(stolen.state, 'p3').players.find((entry) => entry.id === 'p2')!.commodities).toBeUndefined();

      // 以服務保存 state 的 JSON 格式還原；續局與重送偷牌皆不得再使用 RNG。
      const restored = JSON.parse(JSON.stringify(stolen.state)) as GameState;
      expect(restored).toEqual(stolen.state);
      expect(rejectCk(restored, 'p1', { type: 'pending.steal', victim: 'p2' }, scriptedRng([]))).toBe('E_PENDING_EFFECT');
      const continued = actCk(restored, 'p1', { type: 'turn.end' }, scriptedRng([]));
      expect(continued.state.players.map((entry) => entry.commodities)).toEqual(stolen.state.players.map((entry) => entry.commodities));
      expect(eventsOf(continued, 'robber.stole')).toEqual([]);
    }
  });

  it.each([0, 1, 2, 3])('draws index %i from the full resource/commodity hand, weighted by card count', (index) => {
    const { state, target } = theftState();
    give(state, 'p2', { brick: 1 });
    giveCommodities(state, 'p2', { paper: 2, coin: 1 });
    const moved = actCk(state, 'p1', { type: 'pending.moveRobber', hex: target }, scriptedRng([]));
    const restored = JSON.parse(JSON.stringify(moved.state)) as GameState;
    let draws = 0;
    const stolen = actCk(restored, 'p1', { type: 'pending.steal', victim: 'p2' }, {
      int(max) {
        expect(max).toBe(4);
        draws += 1;
        return index;
      },
    });
    expect(draws).toBe(1);
    expect(projectEvent(eventsOf(stolen, 'robber.stole')[0]!, 'p1').params).toMatchObject({ resource: ['brick', 'paper', 'paper', 'coin'][index] });
  });
});

describe('R-COMB privacy (SPEC §5.7)', () => {
  it('VIS-COMB1 the pirate’s theft reaches the thief and the victim only; progress hands stay hidden', () => {
    const state = afterFirstAttack(shipLine());
    state.board.pirate = hex(state, 2, -2);
    addKnight(state, { player: 'p1', vertex: V11, level: 1, active: true });
    ship(state, 'p2', edgeBetween(state, 48, 47));
    setHand(state, 'p2', { brick: 1 });
    handCards(state, 'p2', ['spy']);
    const chased = actCk(state, 'p1', { type: 'knight.chasePirate', vertex: V11 });
    const moved = actCk(chased.state, 'p1', { type: 'pending.moveRobber', hex: hex(state, 2, 0) });
    const stole = actCk(moved.state, 'p1', { type: 'pending.steal', victim: 'p2' });
    const seen = (viewer: string) => JSON.stringify({ game: projectGame(stole.state, viewer), events: stole.events.map((event) => projectEvent(event, viewer)) });
    const theft = (viewer: string) => projectEvent(stole.events.find((event) => event.type === 'robber.stole')!, viewer).params;
    expect(theft('p3')).toEqual({ playerId: 'p1', victim: 'p2', pirate: true });
    expect(theft('p1')).toMatchObject({ resource: 'brick' });
    expect(theft('p2')).toMatchObject({ resource: 'brick' });
    expect(seen('p3')).not.toContain('"spy"');
    expect(seen('p2')).toContain('"spy"');
    expect((projectGame(stole.state, 'p3').modules as any).seafarersCitiesKnights).toEqual({ pirateActive: true });
  });

  it('VIS-COMB2 gold choices are public, the commodity bank stays a count', () => {
    const state = emptySfckGame(4, 0, 'preroll');
    settle(state, 'p1', V15, true);
    giveCommodities(state, 'p2', { coin: 1 });
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(1, 3, TRADE));
    const view = projectGame(rolled.state, 'p3');
    expect(JSON.stringify(view)).not.toContain('progressDecks');
    expect(view.players.find((entry) => entry.id === 'p2')!.commodities).toBeUndefined();
  });
});

function road(state: GameState, playerId: string, edge: number): void {
  state.board.roads[edge] = { player: playerId, ship: false };
}
