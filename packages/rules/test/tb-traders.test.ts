/** R-TB-TR: Traders & Barbarians scenario (TB25 pp. 20–24). */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, legalBuildingVertices, legalRoadEdges, type Command } from '../src/engine.ts';
import type { CoinsState } from '../src/modules/tradersBarbarians/coins/index.ts';
import { TRADERS_RANDOM_TERRAIN } from '../src/modules/tradersBarbarians/traders/board.ts';
import type { TradersState } from '../src/modules/tradersBarbarians/traders/index.ts';
import { getProfile } from '../src/profiles.ts';
import { seededRng } from '../src/rng.ts';
import type { GameState } from '../src/types.ts';
import { act, expectRejected, forceTurn, placeBuilding, placeRoad, runSetup, scriptedRng, setHand } from './helpers.ts';
import { simulateGame } from './simulate.ts';
import { tb, tradersBot } from './tb-bots.ts';
import { clearBoard, resourceTotal, SIMULATION_TIMEOUT, tbCreate, tbPlayable } from './tb-helpers.ts';

const PROFILE = 'tb-traders-barbarians-2025';
const tr = (state: GameState) => tb<TradersState>(state, 'tb-traders-barbarians');
const coins = (state: GameState) => tb<CoinsState>(state, 'tb-coins');
const run = (state: GameState, actor: string, command: Record<string, unknown>, rng = seededRng(3)) =>
  act(state, actor, command as unknown as Command, rng);
const reject = (state: GameState, actor: string, command: Record<string, unknown>, code: string) =>
  expectRejected(state, actor, command as unknown as Command, code);

function bare(): GameState {
  const state = tbPlayable(PROFILE, { seed: 10 });
  clearBoard(state);
  for (const player of state.players) setHand(state, player.id, {});
  return state;
}

const site = (state: GameState, id: string) => tr(state).sites.find((candidate) => candidate.id === id)!;

/** A path of vertices from `start` (exclusive) toward `goal` along topology edges, by BFS. */
function path(state: GameState, start: number, goal: number): number[] {
  const topology = topologyOf(state);
  const previous = new Map<number, number>([[start, -1]]);
  const queue = [start];
  while (queue.length) {
    const vertex = queue.shift()!;
    if (vertex === goal) break;
    for (const edge of topology.vertices[vertex]!.edges) {
      const next = topology.edges[edge]!.vertices.find((other) => other !== vertex)!;
      if (!previous.has(next)) {
        previous.set(next, vertex);
        queue.push(next);
      }
    }
  }
  const out: number[] = [];
  for (let vertex = goal; vertex !== start; vertex = previous.get(vertex)!) out.unshift(vertex);
  return out;
}

const edgeBetween = (state: GameState, a: number, b: number) =>
  topologyOf(state).vertices[a]!.edges.find((edge) => topologyOf(state).edges[edge]!.vertices.includes(b))!;

/** Opens p1's end-of-turn wagon move with the wagon at `vertex`. */
function moving(state: GameState, vertex: number): GameState {
  tr(state).wagons.p1!.vertex = vertex;
  return run(state, 'p1', { type: 'turn.end' }).state;
}

describe('R-TB-TR setup (pp. 20–21)', () => {
  it('TR1: three commodity hexes with interior paths and X sides; numbers without 2 and 12; barbarians, stacks and gold', () => {
    const state = tbCreate(PROFILE, { seed: 2 });
    const topology = topologyOf(state);
    expect(state.board.layout.topologyId).toBe('tb-traders-r2');
    const plazas = topology.vertices.filter((vertex) => vertex.interior);
    expect(plazas).toHaveLength(3);
    expect(topology.edges.filter((edge) => edge.interior)).toHaveLength(12);
    for (const plaza of plazas) expect(plaza.edges).toHaveLength(4);
    const slot = tr(state);
    expect(slot.sites.map((entry) => state.board.layout.terrain[entry.hex])).toEqual(['quarry', 'keep', 'glassworks']);
    expect(slot.xEdges).toHaveLength(9);
    for (const edge of slot.xEdges) expect(topology.edges[edge]!.hexes).toHaveLength(1);
    const random = state.board.layout.terrain.filter((terrain) => !['quarry', 'keep', 'glassworks'].includes(terrain)).sort();
    expect(random).toEqual([...TRADERS_RANDOM_TERRAIN].sort());
    const numbers = state.board.layout.numbers.filter((value) => value !== null);
    expect(numbers).toHaveLength(16);
    expect(numbers).not.toContain(2);
    expect(numbers).not.toContain(12);
    expect(slot.barbarians).toHaveLength(3);
    expect(Object.fromEntries(Object.entries(slot.stacks).map(([id, stack]) => [id, stack.slice().sort()]))).toEqual({
      quarry: [...Array(6).fill('marble'), ...Array(6).fill('sand')],
      castle: [...Array(6).fill('sand'), ...Array(6).fill('tools')],
      glassworks: [...Array(6).fill('glass'), ...Array(6).fill('tools')],
    });
    expect(coins(state).gold).toEqual({ p1: 5, p2: 5, p3: 5, p4: 5 });
    expect(coins(state).supply).toBe(80);
    expect(state.board.robber).toBe(-1);
    expect(state.devDeck.slice().sort()).toEqual([...Array(16).fill('barbarianKnight'), ...Array(3).fill('roadBuilding'),
      ...Array(3).fill('swiftJourney'), ...Array(3).fill('victoryPoint')].sort());
    expect(getProfile(PROFILE)).toMatchObject({ victoryTarget: 13, enabled: true });
  });

  it('TR2: the second placement is a city and the wagon starts on it; no settlement on a plaza', () => {
    const created = tbCreate(PROFILE, { seed: 3 });
    const plaza = topologyOf(created).vertices.findIndex((vertex) => vertex.interior);
    expect(legalBuildingVertices(created, 'p1', { setup: true })).not.toContain(plaza);
    const state = runSetup(created, seededRng(3));
    for (const player of state.players) {
      const city = state.board.buildings.findIndex((building) => building?.player === player.id && building.city);
      expect(tr(state).wagons[player.id]!.vertex).toBe(city);
    }
  });
});

describe('R-TB-TR rolls, 7s and roads (p. 21)', () => {
  it('TR3: a 2 or 12 is rerolled', () => {
    const state = bare();
    forceTurn(state, 0, 'preroll');
    const rolled = run(state, 'p1', { type: 'turn.roll' }, scriptedRng([0, 0, 5, 5, 1, 2]));
    expect(rolled.state.turn.dice).toEqual([2, 3]);
  });

  it('TR4: on a 7 a barbarian moves to an empty edge and robs the owner of a road there', () => {
    const state = bare();
    forceTurn(state, 0, 'preroll');
    placeRoad(state, 'p3', 40);
    setHand(state, 'p3', { brick: 1 });
    const rolled = run(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3])).state;
    expect(rolled.pending).toMatchObject({ kind: 'tradersBarbarians.tbBarbarian', responders: ['p1'] });
    const [from, other] = tr(rolled).barbarians;
    reject(rolled, 'p1', { type: 'tb.moveBarbarian', from, to: other }, 'E_ILLEGAL_TARGET');
    const moved = run(rolled, 'p1', { type: 'tb.moveBarbarian', from, to: 40 }, scriptedRng([0]));
    expect(tr(moved.state).barbarians).toContain(40);
    expect(moved.state.players[0]!.resources.brick).toBe(1);
    expect(moved.events.find((event) => event.type === 'tb.barbarianRobbed')!.private).toEqual({ to: ['p1', 'p3'], params: { resource: 'brick' } });
  });

  it('TR5: roads may use interior paths and barbarian edges, never X edges; Longest Road is not awarded', () => {
    const state = bare();
    const topology = topologyOf(state);
    const quarry = site(state, 'quarry');
    const corner = topology.vertices[quarry.plaza]!.edges.map((edge) => topology.edges[edge]!.vertices.find((v) => v !== quarry.plaza)!)[0]!;
    placeBuilding(state, 'p1', corner);
    setHand(state, 'p1', { lumber: 9, brick: 9 });
    const legal = legalRoadEdges(state, 'p1');
    expect(legal.some((edge) => topology.edges[edge]!.interior)).toBe(true);
    for (const edge of tr(state).xEdges) expect(legal).not.toContain(edge);
    const interior = legal.find((edge) => topology.edges[edge]!.interior)!;
    const built = run(state, 'p1', { type: 'build.road', edge: interior }).state;
    expect(built.board.roads[interior]).toMatchObject({ player: 'p1' });
    // Six roads in a row still give no Longest Road.
    const long = bare();
    const placed: number[] = [];
    let vertex = 20;
    for (let index = 0; index < 6; index++) {
      const edge = topologyOf(long).vertices[vertex]!.edges.find((candidate) => !placed.includes(candidate) && !topologyOf(long).edges[candidate]!.interior)!;
      placed.push(edge);
      placeRoad(long, 'p2', edge);
      vertex = topologyOf(long).edges[edge]!.vertices.find((v) => v !== vertex)!;
    }
    placeBuilding(long, 'p2', 20);
    setHand(long, 'p2', { lumber: 1, brick: 1 });
    forceTurn(long, 1, 'action');
    const next = run(long, 'p2', { type: 'build.road', edge: legalRoadEdges(long, 'p2')[0]! }).state;
    expect(next.awards.longestRoad).toBeNull();
  });
});

describe('R-TB-TR development cards (p. 22)', () => {
  it('TR6: the Knight moves a barbarian (robbing a road owner) and counts for Largest Army', () => {
    const state = bare();
    state.players[0]!.devCards = ['barbarianKnight', 'barbarianKnight', 'barbarianKnight'];
    state.players[0]!.newDevCards = ['barbarianKnight'];
    const [from] = tr(state).barbarians;
    let next = run(state, 'p1', { type: 'tb.playKnight', from, to: 10 }).state;
    expect(tr(next).barbarians).toContain(10);
    expect(next.players[0]!.playedKnights).toBe(1);
    reject(next, 'p1', { type: 'tb.playKnight', from: 10, to: 11 }, 'E_CARD_ALREADY_PLAYED');
    for (let turn = 0; turn < 2; turn++) {
      next.turn.devCardPlayed = false;
      next = run(next, 'p1', { type: 'tb.playKnight', from: tr(next).barbarians[0], to: 12 + turn }).state;
    }
    expect(next.awards.largestArmy).toBe('p1');
    expect(scoreOf(next, 'p1', { includeHidden: false })).toBe(2);
    next.turn.devCardPlayed = false;
    next.players[0]!.devCards = [];
    reject(next, 'p1', { type: 'tb.playKnight', from: tr(next).barbarians[0], to: 30 }, 'E_CARD_JUST_BOUGHT');
  });

  it('TR7: upgrades cost per column; the fourth gives 1 VP', () => {
    const state = bare();
    setHand(state, 'p1', { lumber: 6, wool: 4, ore: 4 });
    let next = state;
    for (let index = 0; index < 4; index++) next = run(next, 'p1', { type: 'tb.upgradeWagon' }).state;
    expect(tr(next).wagons.p1!.level).toBe(5);
    expect(next.players[0]!.resources).toMatchObject({ lumber: 0, wool: 0, ore: 0 });
    expect(scoreOf(next, 'p1', { includeHidden: false })).toBe(1);
    reject(next, 'p1', { type: 'tb.upgradeWagon' }, 'E_TB_WAGON_MAXED');
  });
});

describe('R-TB-TR wagon movement (pp. 22–23)', () => {
  it('TR8: steps cost 2 without a road, 1 on own road, 1 + 1 gold on another road, +2 with a barbarian', () => {
    const state = bare();
    const topology = topologyOf(state);
    const start = 22;
    const [a, b, c] = path(state, start, 0).slice(0, 3);
    const steps = [start, a!, b!, c!];
    placeRoad(state, 'p1', edgeBetween(state, steps[0]!, steps[1]!));
    placeRoad(state, 'p2', edgeBetween(state, steps[1]!, steps[2]!));
    tr(state).barbarians = [edgeBetween(state, steps[2]!, steps[3]!), 70, 71].filter((edge) => edge < topology.edges.length);
    const open = moving(state, start);
    expect(open.pending).toMatchObject({ kind: 'tradersBarbarians.tbWagon', data: { mp: 4 } });
    let next = run(open, 'p1', { type: 'tb.wagonStep', to: a }).state;
    expect(next.pending).toMatchObject({ data: { mp: 3 } });
    next = run(next, 'p1', { type: 'tb.wagonStep', to: b }).state;
    expect(next.pending).toMatchObject({ data: { mp: 2 } });
    expect(coins(next).gold).toMatchObject({ p1: 4, p2: 6 });
    // Road-less edge with a barbarian costs 4.
    reject(next, 'p1', { type: 'tb.wagonStep', to: c }, 'E_TB_WAGON_MP');
    setHand(next, 'p1', { grain: 1 });
    next = run(next, 'p1', { type: 'tb.wagonBoost' }).state;
    reject(next, 'p1', { type: 'tb.wagonBoost' }, 'E_TB_WAGON_BOOSTED');
    next = run(next, 'p1', { type: 'tb.wagonStep', to: c }).state;
    expect(tr(next).wagons.p1!.vertex).toBe(c);
    const done = run(next, 'p1', { type: 'tb.wagonStop' }).state;
    expect(done.pending).toBeNull();
    expect(done.turn.seat).toBe(1);
  });

  it('TR9: entering a plaza ends the move, delivers a wanted token for 1 VP and gold, then loads a new one', () => {
    const state = bare();
    const quarry = site(state, 'quarry');
    const topology = topologyOf(state);
    const corner = topology.edges[topology.vertices[quarry.plaza]!.edges[0]!]!.vertices.find((v) => v !== quarry.plaza)!;
    tr(state).wagons.p1!.cargo = 'tools';
    tr(state).wagons.p1!.level = 3;
    const open = moving(state, corner);
    const arrived = run(open, 'p1', { type: 'tb.wagonStep', to: quarry.plaza }, scriptedRng([0]));
    expect(arrived.events.map((event) => event.type)).toEqual(expect.arrayContaining(['tb.commodityDelivered', 'tb.commodityLoaded']));
    const wagon = tr(arrived.state).wagons.p1!;
    expect(wagon.delivered).toBe(1);
    expect(['marble', 'sand']).toContain(wagon.cargo);
    expect(coins(arrived.state).gold.p1).toBe(5 + 3);
    expect(tr(arrived.state).stacks.quarry).toHaveLength(11);
    expect(scoreOf(arrived.state, 'p1', { includeHidden: false })).toBe(1);
    expect(arrived.state.pending).toBeNull();
    // An unwanted token stays on the wagon and nothing is drawn.
    const keep = bare();
    tr(keep).wagons.p1!.cargo = 'glass';
    const kept = run(moving(keep, corner), 'p1', { type: 'tb.wagonStep', to: quarry.plaza }).state;
    expect(tr(kept).wagons.p1).toMatchObject({ cargo: 'glass', delivered: 0 });
  });

  it('TR10: Swift Journey grants a second move action', () => {
    const state = bare();
    state.players[0]!.devCards = ['swiftJourney'];
    const played = run(state, 'p1', { type: 'tb.playSwiftJourney' }).state;
    const open = moving(played, 22);
    expect(open.pending).toMatchObject({ data: { extra: 1 } });
    const again = run(open, 'p1', { type: 'tb.wagonStop' }).state;
    expect(again.pending).toMatchObject({ kind: 'tradersBarbarians.tbWagon', data: { extra: 0, mp: 4 } });
    expect(run(again, 'p1', { type: 'tb.wagonStop' }).state.pending).toBeNull();
  });

  it('TR11: an upgraded wagon may try once per barbarian to drive it off by a die roll', () => {
    const state = bare();
    const topology = topologyOf(state);
    const barbarian = tr(state).barbarians[0]!;
    const vertex = topology.edges[barbarian]!.vertices[0]!;
    const open = moving(state, vertex);
    reject(open, 'p1', { type: 'tb.driveOff', barbarian, to: 5 }, 'E_TB_WAGON_LEVEL');
    const upgraded = bare();
    tr(upgraded).wagons.p1!.level = 2;
    const ready = moving(upgraded, vertex);
    const missed = run(ready, 'p1', { type: 'tb.driveOff', barbarian, to: 5 }, scriptedRng([4]));
    expect(missed.events.find((event) => event.type === 'tb.driveOff')!.params).toMatchObject({ die: 5, success: false });
    reject(missed.state, 'p1', { type: 'tb.driveOff', barbarian, to: 5 }, 'E_ILLEGAL_TARGET');
    const hit = run(ready, 'p1', { type: 'tb.driveOff', barbarian, to: 5 }, scriptedRng([5]));
    expect(tr(hit.state).barbarians).toContain(5);
  });

  it('TR11b: TB25 p.23 — each barbarian is tried once per turn even after it moved to another edge at the same corner', () => {
    // Start: p1's level-2 wagon stands at a corner touching a barbarian and a free edge; command: tb.driveOff twice.
    const state = bare();
    const topology = topologyOf(state);
    const slot = tr(state);
    const barbarian = slot.barbarians[0]!;
    const vertex = topology.edges[barbarian]!.vertices[0]!;
    const neighbour = topology.vertices[vertex]!.edges.find((edge) => edge !== barbarian && !slot.barbarians.includes(edge))!;
    slot.wagons.p1!.level = 2;
    const ready = moving(state, vertex);
    const first = run(ready, 'p1', { type: 'tb.driveOff', barbarian, to: neighbour }, scriptedRng([5]));
    expect(tr(first.state).barbarians[0]).toBe(neighbour);
    // The same barbarian, now on the neighbouring edge, may not be tried again this turn.
    reject(first.state, 'p1', { type: 'tb.driveOff', barbarian: neighbour, to: barbarian }, 'E_ILLEGAL_TARGET');
    // The hint no longer offers the tried barbarian.
    const hints = actionHints(first.state, 'p1').modules?.['tradersBarbarians'] as Record<string, { driveOff: number[] }>;
    expect(hints['tb-traders-barbarians']!.driveOff).not.toContain(neighbour);
  });
});

describe('R-TB-TR simulated games', () => {
  for (const players of [3, 4]) {
    it(`a ${players}-player game finishes and conserves resources, gold and commodities`, () => {
      const state = simulateGame(players * 83, 20000, { players, profileId: PROFILE, mode: 'variable', bot: tradersBot });
      expect(state.result).toMatchObject({ reason: 'victory' });
      expect(scoreOf(state, state.result!.playerId!, { includeHidden: true })).toBeGreaterThanOrEqual(13);
      for (const resource of ['lumber', 'brick', 'wool', 'grain', 'ore'] as const) expect(resourceTotal(state, resource)).toBe(19);
      const gold = coins(state);
      expect(gold.supply + Object.values(gold.gold).reduce((sum, amount) => sum + amount, 0)).toBe(100);
      const slot = tr(state);
      const tokens = Object.values(slot.stacks).reduce((sum, stack) => sum + stack.length, 0) +
        Object.values(slot.wagons).reduce((sum, wagon) => sum + wagon.delivered + (wagon.cargo ? 1 : 0), 0);
      expect(tokens).toBe(36);
      expect(new Set(slot.barbarians).size).toBe(3);
    }, SIMULATION_TIMEOUT);
  }
});
