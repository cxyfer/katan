/** R-TB-MT: Merchant Trains (TB25 pp. 13–14). */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import type { Command } from '../src/engine.ts';
import { BASE_TERRAIN_MULTISET } from '../src/layout.ts';
import { trainHeads, wagonLocations, type TrainsState } from '../src/modules/tradersBarbarians/trains/index.ts';
import { getProfile } from '../src/profiles.ts';
import { projectGame } from '../src/project.ts';
import { seededRng } from '../src/rng.ts';
import type { GameState } from '../src/types.ts';
import { act, expectRejected, forceTurn, placeBuilding, placeRoad, setHand } from './helpers.ts';
import { simulateGame } from './simulate.ts';
import { tb, trainsBot } from './tb-bots.ts';
import { clearBoard, resourceTotal, tbCreate, tbPlayable } from './tb-helpers.ts';

const PROFILE = 'tb-merchant-trains-2025';
const trains = (state: GameState) => tb<TrainsState>(state, 'tb-merchant-trains');
const run = (state: GameState, actor: string, command: Record<string, unknown>, rng = seededRng(3)) =>
  act(state, actor, command as unknown as Command, rng);
const reject = (state: GameState, actor: string, command: Record<string, unknown>, code: string) =>
  expectRejected(state, actor, command as unknown as Command, code);

function bare(): GameState {
  const state = tbPlayable(PROFILE, { seed: 6 });
  clearBoard(state);
  for (const player of state.players) setHand(state, player.id, {});
  return state;
}

/** p1 builds a settlement (collecting a wagon) and ends the turn: the vote opens. */
function voting(state: GameState): GameState {
  const topology = topologyOf(state);
  const vertex = topology.vertices.findIndex((_, index) => index > 20 && !state.board.buildings[index] &&
    topology.vertices[index]!.edges.every((edge) => topology.edges[edge]!.vertices.every((v) => !state.board.buildings[v])));
  placeRoad(state, 'p1', topology.vertices[vertex]!.edges[0]!);
  setHand(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
  const built = run(state, 'p1', { type: 'build.settlement', vertex });
  expect(built.events.map((event) => event.type)).toContain('tb.wagonCollected');
  return run(built.state, 'p1', { type: 'turn.end' }).state;
}

describe('R-TB-MT setup and collection (p. 13)', () => {
  it('MT1: the watering hole sits in the centre with three outward starts; 22 wagons; robber beside the board', () => {
    const state = tbCreate(PROFILE, { seed: 2 });
    const topology = topologyOf(state);
    const slot = trains(state);
    expect(topology.hexes[slot.oasis]).toMatchObject({ q: 0, r: 0 });
    expect(state.board.layout.terrain[slot.oasis]).toBe('oasis');
    expect(state.board.layout.numbers[slot.oasis]).toBeNull();
    expect(state.board.layout.terrain.filter((terrain) => terrain !== 'oasis').sort())
      .toEqual(BASE_TERRAIN_MULTISET.filter((terrain) => terrain !== 'desert').slice().sort());
    expect(state.board.robber).toBe(-1);
    expect(slot.supply).toBe(22);
    expect(slot.starts).toHaveLength(3);
    for (const start of slot.starts) {
      expect(topology.vertices[start.vertex]!.hexes).toContain(slot.oasis);
      expect(topology.edges[start.edge]!.hexes).not.toContain(slot.oasis);
      expect(topology.edges[start.edge]!.vertices).toContain(start.vertex);
    }
    // Upper-left, upper-right and bottom corners (y grows downward).
    const ys = slot.starts.map((start) => topology.vertices[start.vertex]!.y).sort((a, b) => a - b);
    expect(ys[0]).toBeLessThan(0);
    expect(ys[2]).toBeGreaterThan(0);
    expect(getProfile(PROFILE)).toMatchObject({ victoryTarget: 12, enabled: true });
  });

  it('MT2: building in the action phase collects one wagon per turn; roads and setup do not', () => {
    const setup = tbCreate(PROFILE, { seed: 2 });
    const vertex = topologyOf(setup).vertices.findIndex((_, index) => act(setup, 'p1', { type: 'setup.placeBuilding', vertex: index }).state);
    expect(act(setup, 'p1', { type: 'setup.placeBuilding', vertex }).events.map((event) => event.type)).not.toContain('tb.wagonCollected');
    const state = bare();
    placeBuilding(state, 'p1', 10);
    setHand(state, 'p1', { grain: 4, ore: 6, lumber: 1, brick: 1 });
    const road = run(state, 'p1', { type: 'build.road', edge: topologyOf(state).vertices[10]!.edges[0]! });
    expect(road.events.map((event) => event.type)).not.toContain('tb.wagonCollected');
    const city = run(road.state, 'p1', { type: 'build.city', vertex: 10 });
    expect(city.events.map((event) => event.type)).toContain('tb.wagonCollected');
    expect(trains(city.state).collectedWindow).toBe(city.state.windowId);
  });
});

describe('R-TB-MT voting round (p. 13)', () => {
  it('MT3: players bid wool/grain in table order; a majority holder places; bids return to the supply', () => {
    const state = bare();
    setHand(state, 'p3', { grain: 3 });
    setHand(state, 'p2', { wool: 1 });
    const open = voting(state);
    expect(open.pending).toMatchObject({ kind: 'tradersBarbarians.wagonBid', responders: ['p1', 'p2', 'p3', 'p4'] });
    reject(open, 'p2', { type: 'tb.bidWagon', wool: 0, grain: 0 }, 'E_NOT_ACTOR');
    reject(open, 'p1', { type: 'turn.end' }, 'E_PENDING_EFFECT');
    let next = run(open, 'p1', { type: 'tb.bidWagon', wool: 0, grain: 0 }).state;
    next = run(next, 'p2', { type: 'tb.bidWagon', wool: 1, grain: 0 }).state;
    reject(next, 'p3', { type: 'tb.bidWagon', wool: 0, grain: 4 }, 'E_INSUFFICIENT_RESOURCES');
    next = run(next, 'p3', { type: 'tb.bidWagon', wool: 0, grain: 3 }).state;
    expect(next.players[2]!.resources.grain).toBe(0);
    // Bids are public while the vote runs.
    expect(projectGame(next, 'p4').pending).toMatchObject({ data: { bids: { p3: { wool: 0, grain: 3 } } } });
    next = run(next, 'p4', { type: 'tb.bidWagon', wool: 0, grain: 0 }).state;
    expect(next.pending).toMatchObject({ kind: 'tradersBarbarians.wagonPlace', responders: ['p3'] });
    const location = [...wagonLocations(next).keys()][0]!;
    reject(next, 'p1', { type: 'tb.placeWagon', edge: location }, 'E_NOT_ACTOR');
    const bank = { wool: next.bank.wool, grain: next.bank.grain };
    const placed = run(next, 'p3', { type: 'tb.placeWagon', edge: location }).state;
    expect(trains(placed).wagons).toEqual([{ edge: location, train: wagonLocations(next).get(location)! }]);
    expect(placed.bank).toMatchObject({ wool: bank.wool + 1, grain: bank.grain + 3 });
    expect(trains(placed).supply).toBe(21);
    // The turn then passes on.
    expect(placed.turn.seat).toBe(1);
    expect(placed.pending).toBeNull();
  });

  it('MT4: without a majority, the most-voted location wins; a tie goes to the top bidder, then the active player', () => {
    const run4 = (bids: [number, number, number, number], picks: Record<string, number>) => {
      const state = bare();
      bids.forEach((grain, seat) => setHand(state, `p${seat + 1}`, { grain }));
      let next = voting(state);
      for (const [seat, grain] of bids.entries()) next = run(next, `p${seat + 1}`, { type: 'tb.bidWagon', wool: 0, grain }).state;
      for (const [id, edge] of Object.entries(picks)) next = run(next, id, { type: 'tb.assignWagon', edge }).state;
      return next;
    };
    const probe = voting(bare());
    const [a, b] = [...wagonLocations(probe).keys()];
    // 2 + 1 votes on a beat 2 on b.
    const most = run4([0, 2, 1, 2], { p2: a!, p3: a!, p4: b! });
    expect(trains(most).wagons.map((wagon) => wagon.edge)).toEqual([a]);
    expect(most.pending).toBeNull();
    // 2 vs 2 with a unique top bidder (p4 bid 3 on its own location b... tie at 3 vs 3 → top bidder p4).
    const tie = run4([0, 2, 1, 3], { p2: a!, p3: a!, p4: b! });
    expect(tie.pending).toMatchObject({ kind: 'tradersBarbarians.wagonPlace', responders: ['p4'] });
    // Equal top bidders and a tied tally: the active player places.
    const active = run4([0, 2, 0, 2], { p2: a!, p4: b! });
    expect(active.pending).toMatchObject({ kind: 'tradersBarbarians.wagonPlace', responders: ['p1'] });
  });

  it('MT5: with no bids at all, the active player places even without bidding', () => {
    let next = voting(bare());
    for (const id of ['p1', 'p2', 'p3', 'p4']) next = run(next, id, { type: 'tb.bidWagon', wool: 0, grain: 0 }).state;
    expect(next.pending).toMatchObject({ kind: 'tradersBarbarians.wagonPlace', responders: ['p1'] });
  });
});

describe('R-TB-MT trains (p. 14)', () => {
  it('MT6: trains start at the watering hole and extend only at their front (merging and ending: MT8–MT10)', () => {
    const state = bare();
    const slot = trains(state);
    const topology = topologyOf(state);
    expect([...wagonLocations(state).keys()].sort((x, y) => x - y)).toEqual(slot.starts.map((start) => start.edge).sort((x, y) => x - y));
    slot.wagons.push({ edge: slot.starts[0]!.edge, train: 0 });
    const head = topology.edges[slot.starts[0]!.edge]!.vertices.find((vertex) => vertex !== slot.starts[0]!.vertex)!;
    const fronts = [...wagonLocations(state)].filter(([, train]) => train === 0).map(([edge]) => edge);
    expect(fronts.length).toBeGreaterThan(0);
    for (const edge of fronts) expect(topology.edges[edge]!.vertices).toContain(head);
  });

  it('MT7: buildings between two wagons gain 1 VP; a wagon on a road adds 1 to its length', () => {
    const state = bare();
    const slot = trains(state);
    const topology = topologyOf(state);
    const [first, second] = [slot.starts[0]!.edge, 0];
    const head = topology.edges[first]!.vertices.find((vertex) => vertex !== slot.starts[0]!.vertex)!;
    const along = topology.vertices[head]!.edges.find((edge) => edge !== first)!;
    void second;
    placeBuilding(state, 'p2', head);
    expect(scoreOf(state, 'p2', { includeHidden: false })).toBe(1);
    slot.wagons.push({ edge: first, train: 0 }, { edge: along, train: 0 });
    expect(scoreOf(state, 'p2', { includeHidden: false })).toBe(2);
    // Three roads, two under wagons: length 5 takes Longest Road.
    const far = topology.edges[along]!.vertices.find((vertex) => vertex !== head)!;
    const third = topology.vertices[far]!.edges.find((edge) => edge !== along)!;
    clearBoard(state);
    for (const edge of [first, along, third]) placeRoad(state, 'p3', edge);
    placeBuilding(state, 'p3', topology.vertices.findIndex((_, index) => index > 40 && !state.board.buildings[index]));
    setHand(state, 'p3', { lumber: 1, brick: 1 });
    forceTurn(state, 2, 'action');
    const extra = topology.vertices[topology.edges[third]!.vertices.find((vertex) => vertex !== far)!]!.edges.find((edge) => !state.board.roads[edge])!;
    const built = run(state, 'p3', { type: 'build.road', edge: extra }).state;
    expect(built.players[2]!.longestRoadLength).toBe(6);
    expect(built.awards.longestRoad).toBe('p3');
  });
});

/** Shortest edge path between two intersections that avoids the given edges. */
function pathBetween(state: GameState, from: number, to: number, blocked: Set<number>): number[] {
  const topology = topologyOf(state);
  const via = new Map<number, { vertex: number; edge: number }>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const vertex = queue.shift()!;
    if (vertex === to) break;
    for (const edge of topology.vertices[vertex]!.edges) {
      if (blocked.has(edge)) continue;
      const [a, b] = topology.edges[edge]!.vertices;
      const next = a === vertex ? b : a;
      if (seen.has(next)) continue;
      seen.add(next);
      via.set(next, { vertex, edge });
      queue.push(next);
    }
  }
  const path: number[] = [];
  for (let cursor = to; cursor !== from; cursor = via.get(cursor)!.vertex) path.unshift(via.get(cursor)!.edge);
  return path;
}

/** Edges on the watering hole's own border. */
function oasisEdgesOf(state: GameState): Set<number> {
  const oasis = trains(state).oasis;
  return new Set(topologyOf(state).edges.flatMap((edge, index) => (edge.hexes.includes(oasis) ? [index] : [])));
}

/**
 * Trains 0 and 1 laid out so that their fronts meet at one intersection: each
 * grows from its start along half of the shortest outer path between their
 * first wagons. Returns the meeting intersection.
 */
function meetingTrains(state: GameState): number {
  const slot = trains(state);
  const topology = topologyOf(state);
  const [s0, s1] = [slot.starts[0]!, slot.starts[1]!];
  const out0 = topology.edges[s0.edge]!.vertices.find((vertex) => vertex !== s0.vertex)!;
  const out1 = topology.edges[s1.edge]!.vertices.find((vertex) => vertex !== s1.vertex)!;
  const oasisEdges = oasisEdgesOf(state);
  const blocked = new Set([...oasisEdges, s0.edge, s1.edge, slot.starts[2]!.edge]);
  const path = pathBetween(state, out0, out1, blocked);
  expect(path.length % 2).toBe(0);
  const half = path.length / 2;
  slot.wagons.push({ edge: s0.edge, train: 0 }, { edge: s1.edge, train: 1 });
  for (const edge of path.slice(0, half)) slot.wagons.push({ edge, train: 0 });
  for (const edge of path.slice(half).reverse()) slot.wagons.push({ edge, train: 1 });
  return heads(state).get(0)!;
}
const heads = (state: GameState) => trainHeads(state);

describe('R-TB-MT merging and ending (p. 14, fig. 1 and 2)', () => {
  it('MT8: TB25 p.14 fig. 2 — two fronts meeting at an intersection merge and the train continues along the free edge', () => {
    // Start: trains 0 and 1 each reach the same intersection; actor: the vote winner; command: tb.placeWagon.
    const state = bare();
    const slot = trains(state);
    const topology = topologyOf(state);
    const meeting = meetingTrains(state);
    expect(heads(state).get(1)).toBe(meeting);
    expect(slot.wagons.filter((wagon) => topology.edges[wagon.edge]!.vertices.includes(meeting))).toHaveLength(2);
    // The merged train may still be extended: exactly the remaining free edge, owned by the lower train.
    const free = topology.vertices[meeting]!.edges.filter((edge) => !slot.wagons.some((wagon) => wagon.edge === edge));
    expect(free).toHaveLength(1);
    expect(wagonLocations(state).get(free[0]!)).toBe(0);
    // Placing it through the vote leaves a three-wagon intersection with nothing left to extend there.
    const open = voting(state);
    let next = open;
    for (const id of ['p1', 'p2', 'p3', 'p4']) next = run(next, id, { type: 'tb.bidWagon', wool: 0, grain: 0 }).state;
    const placed = run(next, 'p1', { type: 'tb.placeWagon', edge: free[0]! }).state;
    expect(trains(placed).wagons.at(-1)).toEqual({ edge: free[0], train: 0 });
    const fronts = trainHeads(placed);
    expect(fronts.get(0)).not.toBe(meeting);
    expect(fronts.get(1)).toBe(meeting);
    expect([...wagonLocations(placed)].every(([edge]) => !topology.vertices[meeting]!.edges.includes(edge))).toBe(true);
    // The two fronts that met are each between two wagons: a building there is worth +1 VP.
    placeBuilding(placed, 'p2', meeting);
    expect(scoreOf(placed, 'p2', { includeHidden: false })).toBe(2);
  });

  it('MT9: TB25 p.14 fig. 1 — a front that runs into another train\'s body ends; the other train keeps its front', () => {
    // Start: train 1 passes through an intersection; train 0 arrives at it on the third edge.
    const state = bare();
    const slot = trains(state);
    const topology = topologyOf(state);
    const meeting = meetingTrains(state);
    // Train 1 runs on through the meeting intersection instead of ending there: re-lay train 1 one wagon longer.
    const free = topology.vertices[meeting]!.edges.find((edge) => !slot.wagons.some((wagon) => wagon.edge === edge))!;
    slot.wagons.push({ edge: free, train: 1 });
    const beyond = trainHeads(state).get(1)!;
    expect(beyond).not.toBe(meeting);
    // Train 1 is open at its new front; train 0 touches the body of train 1 and may not be extended.
    const locations = wagonLocations(state);
    expect([...locations.values()]).not.toContain(0);
    expect([...locations.values()]).toContain(1);
    for (const edge of topology.vertices[meeting]!.edges) expect(locations.has(edge)).toBe(false);
  });

  it('MT10: TB25 p.14 fig. 1 — a front meeting another train\'s tail ends even when an edge is free; the other train stays open', () => {
    // Start: train 0 is walked around the watering hole onto the intersection where train 1 starts.
    const state = bare();
    const slot = trains(state);
    const topology = topologyOf(state);
    const [s0, s1] = [slot.starts[0]!, slot.starts[1]!];
    // Walk train 0 from its start's outer end up to the oasis corner shared with train 1's start.
    const out0 = topology.edges[s0.edge]!.vertices.find((vertex) => vertex !== s0.vertex)!;
    const toCorner = pathBetween(state, out0, s1.vertex, new Set([s0.edge, s1.edge, slot.starts[2]!.edge]));
    expect(toCorner.length).toBeGreaterThan(0);
    slot.wagons.push({ edge: s0.edge, train: 0 }, { edge: s1.edge, train: 1 });
    for (const edge of toCorner) slot.wagons.push({ edge, train: 0 });
    expect(trainHeads(state).get(0)).toBe(s1.vertex);
    const free = topology.vertices[s1.vertex]!.edges.filter((edge) => !slot.wagons.some((wagon) => wagon.edge === edge) && edge !== s1.edge);
    expect(free.length).toBeGreaterThan(0);
    // Train 0 touches train 1's start wagon (its tail): it ended, although an edge is free.
    const locations = wagonLocations(state);
    for (const edge of free) expect(locations.has(edge)).toBe(false);
    // Train 1 is unaffected: it is still open at its own front.
    expect([...locations.values()]).toContain(1);
  });
});

describe('R-TB-MT simulated games', () => {
  for (const players of [3, 4]) {
    it(`a ${players}-player game finishes and conserves resources and wagons`, () => {
      const state = simulateGame(players * 53, 12000, { players, profileId: PROFILE, mode: 'variable', bot: trainsBot });
      expect(state.result).toMatchObject({ reason: 'victory' });
      expect(scoreOf(state, state.result!.playerId!, { includeHidden: true })).toBeGreaterThanOrEqual(12);
      for (const resource of ['lumber', 'brick', 'wool', 'grain', 'ore'] as const) expect(resourceTotal(state, resource)).toBe(19);
      const slot = trains(state);
      expect(slot.wagons.length + slot.supply).toBe(22);
      expect(new Set(slot.wagons.map((wagon) => wagon.edge)).size).toBe(slot.wagons.length);
    });
  }
});
