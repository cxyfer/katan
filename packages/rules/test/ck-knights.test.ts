/**
 * R-CK fixtures: knights (CK25 pp. 9–10; CK-FAQ knights). Every knight
 * action's legality, the activation timing and knights as route blockers.
 */

import { describe, expect, it } from 'vitest';
import { neighborsOfVertex, topologyOf } from '../src/analysis.ts';
import { canPlaceBuilding, canPlaceRoad, routeLength } from '../src/engine.ts';
import { ckState, ckView, knightAt } from '../src/modules/citiesKnights/state.ts';
import type { GameState } from '../src/types.ts';
import {
  actCk,
  addKnight,
  edgeBetween,
  emptyCkGame,
  eventsOf,
  hints,
  moduleFrame,
  pathFrom,
  player,
  rejectCk,
  roadAlong,
  setBuilding,
  setImprovement,
} from './ck-helpers.ts';
import { give } from './helpers.ts';

interface Network {
  state: GameState;
  path: number[];
}

/** p1: a settlement on path[0] and roads along path[0..5]. */
function network(): Network {
  const state = emptyCkGame(4);
  const path = pathFrom(state, 20, 5);
  setBuilding(state, 'p1', path[0]!);
  roadAlong(state, 'p1', path);
  return { state, path };
}

function offPath(state: GameState, vertex: number, path: readonly number[]): number {
  const next = neighborsOfVertex(topologyOf(state), vertex).find((candidate) => !path.includes(candidate));
  if (next === undefined) throw new Error(`no free neighbour of ${vertex}`);
  return next;
}

describe('R-CK recruit (CK25 p. 9)', () => {
  it('R-CK-26 recruits a basic, inactive knight on an empty intersection touching an own road, without the distance rule', () => {
    const { state, path } = network();
    give(state, 'p1', { wool: 3, ore: 3 });
    expect(hints(state, 'p1').recruitSites).toContain(path[1]);
    const recruited = actCk(state, 'p1', { type: 'knight.recruit', vertex: path[1]! });
    expect(ckView(recruited.state).knights).toEqual([{ player: 'p1', vertex: path[1]!, level: 1, active: false }]);
    expect(player(recruited.state, 'p1').resources).toMatchObject({ wool: 2, ore: 2 });
    // Not on an occupied intersection, not away from own roads.
    expect(rejectCk(recruited.state, 'p1', { type: 'knight.recruit', vertex: path[0]! })).toBe('E_ILLEGAL_TARGET');
    expect(rejectCk(recruited.state, 'p1', { type: 'knight.recruit', vertex: path[1]! })).toBe('E_ILLEGAL_TARGET');
    const far = offPath(state, offPath(state, path[3]!, path), path);
    expect(rejectCk(recruited.state, 'p1', { type: 'knight.recruit', vertex: far })).toBe('E_ILLEGAL_TARGET');
    // Two basic knights per player.
    const second = actCk(recruited.state, 'p1', { type: 'knight.recruit', vertex: path[2]! });
    expect(rejectCk(second.state, 'p1', { type: 'knight.recruit', vertex: path[3]! })).toBe('E_NO_PIECES');
    expect(hints(second.state, 'p1').knightSupply).toEqual({ 1: 0, 2: 2, 3: 2 });
  });

  it('R-CK-27 knight actions belong to the action phase of the player on turn', () => {
    const { state, path } = network();
    give(state, 'p1', { wool: 1, ore: 1 });
    state.turn.phase = 'preroll';
    expect(rejectCk(state, 'p1', { type: 'knight.recruit', vertex: path[1]! })).toBe('E_WRONG_PHASE');
    state.turn.phase = 'action';
    expect(rejectCk(state, 'p2', { type: 'knight.recruit', vertex: path[1]! })).toBe('E_NOT_YOUR_TURN');
    player(state, 'p1').resources.wool = 0;
    expect(rejectCk(state, 'p1', { type: 'knight.recruit', vertex: path[1]! })).toBe('E_INSUFFICIENT_RESOURCES');
  });
});

describe('R-CK activate (CK25 p. 9)', () => {
  it('R-CK-28 costs 1 grain; an active knight cannot be activated again; a fresh activation cannot act this turn', () => {
    const { state, path } = network();
    addKnight(state, { player: 'p1', vertex: path[1]!, level: 1, active: false });
    expect(rejectCk(state, 'p1', { type: 'knight.activate', vertex: path[1]! })).toBe('E_INSUFFICIENT_RESOURCES');
    give(state, 'p1', { grain: 2 });
    const activated = actCk(state, 'p1', { type: 'knight.activate', vertex: path[1]! });
    expect(knightAt(activated.state, path[1]!)!.active).toBe(true);
    expect(player(activated.state, 'p1').resources.grain).toBe(1);
    expect(rejectCk(activated.state, 'p1', { type: 'knight.activate', vertex: path[1]! })).toBe('E_KNIGHT_ACTIVE');
    expect(rejectCk(activated.state, 'p1', { type: 'knight.move', from: path[1]!, to: path[2]! })).toBe('E_KNIGHT_JUST_ACTIVATED');
    expect(hints(activated.state, 'p1').knights[0]).toMatchObject({ canAct: false, moves: [] });
    // Next turn of the owner the knight may act.
    activated.state.windowId += 1;
    expect(actCk(activated.state, 'p1', { type: 'knight.move', from: path[1]!, to: path[2]! }).state).toBeTruthy();
  });

  it('R-CK-29 an inactive knight cannot act, and acting then reactivating leaves it unable to act again', () => {
    const { state, path } = network();
    addKnight(state, { player: 'p1', vertex: path[1]!, level: 1, active: false });
    expect(rejectCk(state, 'p1', { type: 'knight.move', from: path[1]!, to: path[2]! })).toBe('E_KNIGHT_INACTIVE');
    ckState(state).knights[0]!.active = true;
    const moved = actCk(state, 'p1', { type: 'knight.move', from: path[1]!, to: path[2]! });
    expect(knightAt(moved.state, path[2]!)!.active).toBe(false);
    give(moved.state, 'p1', { grain: 1 });
    const again = actCk(moved.state, 'p1', { type: 'knight.activate', vertex: path[2]! });
    expect(rejectCk(again.state, 'p1', { type: 'knight.move', from: path[2]!, to: path[3]! })).toBe('E_KNIGHT_JUST_ACTIVATED');
  });
});

describe('R-CK promote (CK25 p. 9)', () => {
  it('R-CK-30 promotes once per turn, keeps the status, and needs politics 3 for a mighty knight', () => {
    const { state, path } = network();
    addKnight(state, { player: 'p1', vertex: path[1]!, level: 1, active: true });
    give(state, 'p1', { wool: 3, ore: 3 });
    const strong = actCk(state, 'p1', { type: 'knight.promote', vertex: path[1]! });
    expect(knightAt(strong.state, path[1]!)).toMatchObject({ level: 2, active: true });
    expect(rejectCk(strong.state, 'p1', { type: 'knight.promote', vertex: path[1]! })).toBe('E_KNIGHT_PROMOTED');
    strong.state.windowId += 1;
    expect(rejectCk(strong.state, 'p1', { type: 'knight.promote', vertex: path[1]! })).toBe('E_IMPROVEMENT_REQUIRED');
    setImprovement(strong.state, 'p1', 'politics', 3);
    const mighty = actCk(strong.state, 'p1', { type: 'knight.promote', vertex: path[1]! });
    expect(knightAt(mighty.state, path[1]!)).toMatchObject({ level: 3, active: true });
    expect(player(mighty.state, 'p1').resources).toMatchObject({ wool: 1, ore: 1 });
  });

  it('R-CK-31 cannot promote when no knight of the next strength is left in the supply', () => {
    const { state, path } = network();
    addKnight(state, { player: 'p1', vertex: path[1]!, level: 1, active: false });
    addKnight(state, { player: 'p1', vertex: path[2]!, level: 2, active: false });
    addKnight(state, { player: 'p1', vertex: path[3]!, level: 2, active: false });
    give(state, 'p1', { wool: 1, ore: 1 });
    expect(rejectCk(state, 'p1', { type: 'knight.promote', vertex: path[1]! })).toBe('E_NO_PIECES');
    expect(hints(state, 'p1').knights.find((knight: { vertex: number }) => knight.vertex === path[1])!.canPromote).toBe(false);
  });
});

describe('R-CK move and displace (CK25 p. 10)', () => {
  it('R-CK-32 moves along own routes past own pieces, never past another player’s piece', () => {
    const { state, path } = network();
    addKnight(state, { player: 'p1', vertex: path[2]!, level: 1, active: true });
    addKnight(state, { player: 'p2', vertex: path[4]!, level: 1, active: false });
    const reach = hints(state, 'p1').knights[0];
    expect(reach.moves.sort()).toEqual([path[1]!, path[3]!].sort());
    expect(reach.displace).toEqual([]);
    expect(rejectCk(state, 'p1', { type: 'knight.move', from: path[2]!, to: path[5]! })).toBe('E_ILLEGAL_TARGET');
    expect(rejectCk(state, 'p1', { type: 'knight.move', from: path[2]!, to: path[0]! })).toBe('E_ILLEGAL_TARGET');
    const moved = actCk(state, 'p1', { type: 'knight.move', from: path[2]!, to: path[1]! });
    expect(eventsOf(moved, 'ck.knightMoved')[0]!.params).toEqual({ playerId: 'p1', from: path[2]!, to: path[1]!, level: 1 });
  });

  it('R-CK-33 displaces only a weaker knight; its owner moves it along their routes', () => {
    const { state, path } = network();
    const w = offPath(state, path[3]!, path);
    const x = offPath(state, w, [...path, path[3]!]);
    setBuilding(state, 'p2', x);
    roadAlong(state, 'p2', [path[3]!, w, x]);
    addKnight(state, { player: 'p1', vertex: path[1]!, level: 2, active: true });
    addKnight(state, { player: 'p2', vertex: path[3]!, level: 1, active: true });
    addKnight(state, { player: 'p3', vertex: path[5]!, level: 2, active: true });
    expect(hints(state, 'p1').knights[0].displace).toEqual([path[3]!]);
    const displaced = actCk(state, 'p1', { type: 'knight.displace', from: path[1]!, to: path[3]! });
    expect(knightAt(displaced.state, path[3]!)).toMatchObject({ player: 'p1', level: 2, active: false });
    expect(moduleFrame(displaced.state)).toMatchObject({ kind: 'citiesKnights.displaced', responders: ['p2'] });
    expect(hints(displaced.state, 'p2').retreat).toEqual([w]);
    expect(rejectCk(displaced.state, 'p1', { type: 'knight.retreat', vertex: w })).toBe('E_NOT_ACTOR');
    expect(rejectCk(displaced.state, 'p2', { type: 'knight.retreat', vertex: path[2]! })).toBe('E_ILLEGAL_TARGET');
    const retreated = actCk(displaced.state, 'p2', { type: 'knight.retreat', vertex: w });
    expect(knightAt(retreated.state, w)).toMatchObject({ player: 'p2', level: 1, active: true });
    expect(retreated.state.pending).toBeNull();

    // Equal strength cannot be displaced.
    const equal = network();
    addKnight(equal.state, { player: 'p1', vertex: equal.path[1]!, level: 2, active: true });
    addKnight(equal.state, { player: 'p2', vertex: equal.path[3]!, level: 2, active: true });
    expect(rejectCk(equal.state, 'p1', { type: 'knight.displace', from: equal.path[1]!, to: equal.path[3]! })).toBe('E_KNIGHT_TOO_WEAK');
  });

  it('R-CK-34 a displaced knight with nowhere to go returns to its owner’s supply', () => {
    const { state, path } = network();
    addKnight(state, { player: 'p1', vertex: path[1]!, level: 3, active: true });
    addKnight(state, { player: 'p2', vertex: path[2]!, level: 2, active: true });
    const displaced = actCk(state, 'p1', { type: 'knight.displace', from: path[1]!, to: path[2]! });
    expect(eventsOf(displaced, 'ck.knightRemoved')[0]!.params).toEqual({ playerId: 'p2', vertex: path[2]!, level: 2 });
    expect(displaced.state.pending).toBeNull();
    expect(ckView(displaced.state).knights.filter((knight) => knight.player === 'p2')).toEqual([]);
  });
});

describe('R-CK chase the robber (CK25 pp. 7, 10)', () => {
  it('R-CK-35 needs the robber in play and an active knight next to its hex; then the robber moves and steals', () => {
    const { state, path } = network();
    const hex = topologyOf(state).vertices[path[2]!]!.hexes[0]!;
    state.board.robber = hex;
    addKnight(state, { player: 'p1', vertex: path[2]!, level: 1, active: true });
    expect(rejectCk(state, 'p1', { type: 'knight.chaseRobber', vertex: path[2]! })).toBe('E_ROBBER_INACTIVE');
    ckState(state).attacks = 1;
    expect(hints(state, 'p1').knights[0].chase).toBe(true);
    const chased = actCk(state, 'p1', { type: 'knight.chaseRobber', vertex: path[2]! });
    expect(knightAt(chased.state, path[2]!)!.active).toBe(false);
    expect(chased.state.pending).toMatchObject({ kind: 'moveRobber', actor: 'p1', cause: 'knight' });
    expect(rejectCk(chased.state, 'p1', { type: 'pending.moveRobber', hex })).not.toBe('ok');
    const elsewhere = (hex + 1) % 19 === 9 ? (hex + 2) % 19 : (hex + 1) % 19;
    const moved = actCk(chased.state, 'p1', { type: 'pending.moveRobber', hex: elsewhere });
    expect(moved.state.board.robber).toBe(elsewhere);

    // A knight not next to the robber cannot chase it.
    const far = network();
    ckState(far.state).attacks = 1;
    far.state.board.robber = 9;
    const touching = topologyOf(far.state).vertices[far.path[2]!]!.hexes.includes(9);
    addKnight(far.state, { player: 'p1', vertex: far.path[2]!, level: 1, active: true });
    if (!touching) expect(rejectCk(far.state, 'p1', { type: 'knight.chaseRobber', vertex: far.path[2]! })).toBe('E_ILLEGAL_TARGET');
  });
});

describe('R-CK knights on the routes (CK25 p. 9)', () => {
  it('R-CK-36 an opponent knight blocks road building through it, settlement sites and the longest route', () => {
    const { state, path } = network();
    expect(routeLength(state, 'p1')).toBe(5);
    // p2's knight on path[3] splits p1's five roads into 3 + 2.
    addKnight(state, { player: 'p2', vertex: path[3]!, level: 1, active: false });
    expect(routeLength(state, 'p1')).toBe(3);
    // p1 may not extend a route through p2's knight.
    const beyond = offPath(state, path[3]!, path);
    expect(canPlaceRoad(state, 'p1', edgeBetween(state, path[3]!, beyond))).toBe(false);
    // Nobody can settle on a knight.
    expect(canPlaceBuilding(state, 'p2', path[3]!)).toBe(false);
    expect(canPlaceBuilding(state, 'p1', path[3]!)).toBe(false);
  });
});
