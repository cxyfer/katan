/** R-TB-RV: Rivers of Catan (TB25 pp. 11–12). */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { legalRoadEdges, type Command } from '../src/engine.ts';
import { BASE_NUMBER_TOKENS } from '../src/layout.ts';
import { RIVERS_RANDOM_TERRAIN } from '../src/modules/tradersBarbarians/rivers/board.ts';
import { goldTotal, type RiversState } from '../src/modules/tradersBarbarians/rivers/index.ts';
import type { CoinsState } from '../src/modules/tradersBarbarians/coins/index.ts';
import { getProfile } from '../src/profiles.ts';
import { projectGame } from '../src/project.ts';
import { seededRng } from '../src/rng.ts';
import { verticesOfHex } from '../src/topology.ts';
import type { GameState } from '../src/types.ts';
import { act, expectRejected, forceTurn, placeBuilding, placeRoad, scriptedRng, setHand } from './helpers.ts';
import { simulateGame } from './simulate.ts';
import { riversBot, tb } from './tb-bots.ts';
import { clearBoard, resourceTotal, SIMULATION_TIMEOUT, tbCreate, tbPlayable } from './tb-helpers.ts';

const PROFILE = 'tb-rivers-2025';
const rivers = (state: GameState) => tb<RiversState>(state, 'tb-rivers');
const coins = (state: GameState) => tb<CoinsState>(state, 'tb-coins');
const run = (state: GameState, actor: string, command: Record<string, unknown>, rng = seededRng(3)) =>
  act(state, actor, command as unknown as Command, rng);
const reject = (state: GameState, actor: string, command: Record<string, unknown>, code: string) =>
  expectRejected(state, actor, command as unknown as Command, code);

function bare(): GameState {
  const state = tbPlayable(PROFILE, { seed: 4 });
  clearBoard(state);
  for (const player of state.players) setHand(state, player.id, {});
  const slot = coins(state);
  for (const id of Object.keys(slot.gold)) slot.gold[id] = 0;
  slot.supply = 100;
  return state;
}

/** An edge with one end at `vertex`. */
const edgeAt = (state: GameState, vertex: number, exclude: number[] = []) =>
  topologyOf(state).vertices[vertex]!.edges.find((edge) => !exclude.includes(edge))!;

describe('R-TB-RV Rivers of Catan setup (p. 11)', () => {
  it('RV1: two fixed rivers, 12 random hexes, the 2 on the 12 hex, robber on a swamp, 7 bridge sites', () => {
    for (const seed of [1, 2, 3]) {
      const state = tbCreate(PROFILE, { seed });
      const topology = topologyOf(state);
      const at = (q: number, r: number) => state.board.layout.terrain[topology.hexes.findIndex((hex) => hex.q === q && hex.r === r)];
      expect([at(-1, -1), at(-1, 0), at(-1, 1), at(-1, 2)]).toEqual(['mountains', 'hills', 'pasture', 'swamp']);
      expect([at(1, -1), at(1, 0), at(1, 1)]).toEqual(['mountains', 'hills', 'swamp']);
      const slot = rivers(state);
      const others = state.board.layout.terrain.filter((_, hex) => !slot.hexes.includes(hex)).sort();
      expect(others).toEqual([...RIVERS_RANDOM_TERRAIN].sort());
      const numbers = state.board.layout.numbers.filter((value) => value !== null).sort((a, b) => a! - b!);
      expect(numbers).toEqual(BASE_NUMBER_TOKENS.slice(1));
      for (const [hex, terrain] of state.board.layout.terrain.entries()) if (terrain === 'swamp') expect(state.board.layout.numbers[hex]).toBeNull();
      const twelve = state.board.layout.numbers.indexOf(12);
      expect(state.board.layout.extraNumbers).toEqual([{ hex: twelve, number: 2 }]);
      expect(state.board.layout.terrain[state.board.robber]).toBe('swamp');
      expect(new Set(slot.bridgeSites).size).toBe(7);
      for (const edge of slot.bridgeSites) expect(topology.edges[edge]!.hexes.some((hex) => slot.hexes.includes(hex))).toBe(true);
      // Each river ends at the coast.
      expect(slot.paths.map((path) => topology.edges[path.sites.at(-1)!]!.hexes.length)).toEqual([1, 1]);
      expect(coins(state).supply).toBe(100);
    }
    expect(getProfile(PROFILE)).toMatchObject({ victoryTarget: 10, setupModes: ['variable'], enabled: true });
  });

  it('RV2: the shared hex produces on both 2 and 12', () => {
    const state = bare();
    forceTurn(state, 0, 'preroll');
    const twelve = state.board.layout.numbers.indexOf(12);
    state.board.robber = rivers(state).hexes.find((hex) => state.board.layout.terrain[hex] === 'swamp')!;
    placeBuilding(state, 'p1', verticesOfHex(topologyOf(state), twelve)[0]!);
    for (const dice of [[0, 0], [5, 5]]) {
      const rolled = run(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice)).state;
      expect(rolled.players[0]!.resources[resourceOf(state, twelve)]).toBe(1);
    }
  });

  it('RV3: setup settlements and roads on river tiles earn 1 gold; no road on a bridge site', () => {
    let state = tbCreate(PROFILE, { seed: 8 });
    const slot = rivers(state);
    const riverVertex = slot.vertices.find((vertex) => run(state, 'p1', { type: 'setup.placeBuilding', vertex }).state)!;
    state = run(state, 'p1', { type: 'setup.placeBuilding', vertex: riverVertex }).state;
    expect(coins(state).gold.p1).toBe(1);
    const legal = legalRoadEdges(state, 'p1', { setup: true, lastVertex: riverVertex });
    for (const edge of legal) expect(slot.bridgeSites).not.toContain(edge);
    const site = topologyOf(state).vertices[riverVertex]!.edges.find((edge) => slot.bridgeSites.includes(edge));
    if (site !== undefined) reject(state, 'p1', { type: 'setup.placeRoad', edge: site }, 'E_ILLEGAL_TARGET');
    const riverEdge = legal.find((edge) => slot.edges.includes(edge))!;
    state = run(state, 'p1', { type: 'setup.placeRoad', edge: riverEdge }).state;
    expect(coins(state).gold.p1).toBe(2);
    expect(goldTotal(state)).toBe(100);
  });
});

function resourceOf(state: GameState, hex: number) {
  return ({ forest: 'lumber', hills: 'brick', pasture: 'wool', fields: 'grain', mountains: 'ore' } as const)[
    state.board.layout.terrain[hex] as 'forest'];
}

describe('R-TB-RV bridges (p. 12)', () => {
  it('RV4: a connected bridge costs 2 brick + 1 lumber, earns 3 gold, counts for routes and not for road supply', () => {
    const state = bare();
    const topology = topologyOf(state);
    const site = rivers(state).bridgeSites[0]!;
    const [a, b] = topology.edges[site]!.vertices;
    setHand(state, 'p1', { brick: 2, lumber: 1 });
    reject(state, 'p1', { type: 'tb.buildBridge', edge: site }, 'E_ILLEGAL_TARGET');
    placeBuilding(state, 'p1', a);
    const built = run(state, 'p1', { type: 'tb.buildBridge', edge: site });
    expect(built.state.board.roads[site]).toEqual({ player: 'p1', ship: false, bridge: true });
    expect(coins(built.state).gold.p1).toBe(3);
    expect(built.state.players[0]!.resources).toMatchObject({ brick: 0, lumber: 0 });
    expect(projectGame(built.state, 'p2').board.roads[site]).toEqual({ player: 'p1', ship: false, bridge: true });
    // A road continues from the far end of the bridge.
    const next = edgeAt(built.state, b, [site]);
    setHand(built.state, 'p1', { brick: 1, lumber: 1 });
    expect(legalRoadEdges(built.state, 'p1')).toContain(next);
    // Not past an opponent's building at the far end.
    const blocked = bare();
    placeRoad(blocked, 'p1', edgeAt(blocked, a, [site]));
    placeBuilding(blocked, 'p2', a);
    setHand(blocked, 'p1', { brick: 2, lumber: 1 });
    reject(blocked, 'p1', { type: 'tb.buildBridge', edge: site }, 'E_ILLEGAL_TARGET');
  });

  it('RV5: at most 3 bridges each; Road Building cannot place one', () => {
    const state = bare();
    const sites = rivers(state).bridgeSites;
    const topology = topologyOf(state);
    for (const site of sites.slice(0, 3)) {
      placeBuilding(state, 'p1', topology.edges[site]!.vertices[0]!);
      state.board.roads[site] = { player: 'p1', ship: false, bridge: true };
    }
    const fourth = sites[3]!;
    placeBuilding(state, 'p1', topology.edges[fourth]!.vertices[0]!);
    setHand(state, 'p1', { brick: 2, lumber: 1 });
    reject(state, 'p1', { type: 'tb.buildBridge', edge: fourth }, 'E_NO_PIECES');
    state.pending = { kind: 'freeRoads', actor: 'p1', remaining: 2 };
    reject(state, 'p1', { type: 'build.road', edge: fourth }, 'E_ILLEGAL_TARGET');
  });
});

describe('R-TB-RV coins and wealth (p. 12)', () => {
  it('RV6: 2 gold buy a resource twice per turn; resources sell for 1 gold at the harbour rate', () => {
    const state = bare();
    coins(state).gold.p1 = 6;
    coins(state).supply = 94;
    let next = run(state, 'p1', { type: 'tb.buyResource', resource: 'ore' }).state;
    next = run(next, 'p1', { type: 'tb.buyResource', resource: 'ore' }).state;
    expect(next.players[0]!.resources.ore).toBe(2);
    reject(next, 'p1', { type: 'tb.buyResource', resource: 'ore' }, 'E_TB_PURCHASE_LIMIT');
    expect(coins(next).gold.p1).toBe(2);
    setHand(next, 'p1', { wool: 4 });
    reject(next, 'p2', { type: 'tb.sellResources', resource: 'wool' }, 'E_NOT_YOUR_TURN');
    const sold = run(next, 'p1', { type: 'tb.sellResources', resource: 'wool' }).state;
    expect(sold.players[0]!.resources.wool).toBe(0);
    expect(coins(sold).gold.p1).toBe(3);
    expect(goldTotal(sold)).toBe(100);
    // A new turn resets the purchase limit.
    sold.windowId += 1;
    expect(run(sold, 'p1', { type: 'tb.buyResource', resource: 'grain' }).state.players[0]!.resources.grain).toBe(1);
  });

  it('RV7: gold trades between players; it is not a resource for 7s or theft', () => {
    const state = bare();
    coins(state).gold.p1 = 4;
    coins(state).gold.p2 = 0;
    coins(state).supply = 96;
    setHand(state, 'p2', { ore: 1 });
    const offered = run(state, 'p1', { type: 'trade.offer', to: 'p2', give: {}, want: { ore: 1 }, giveGoods: { gold: 3 } }).state;
    const offer = offered.offers.at(-1)!;
    expect(offer.giveGoods).toEqual({ gold: 3 });
    const consented = run(offered, 'p2', { type: 'trade.respond', offerId: offer.id, response: 'consented' }).state;
    const settled = run(consented, 'p1', { type: 'trade.settle', offerId: offer.id }).state;
    expect(coins(settled).gold).toMatchObject({ p1: 1, p2: 3 });
    expect(settled.players[0]!.resources.ore).toBe(1);
    // Like resources, gold is checked when the exchange settles.
    const big = run(state, 'p1', { type: 'trade.offer', to: 'p2', give: {}, want: { ore: 1 }, giveGoods: { gold: 9 } }).state;
    const bigOffer = big.offers.at(-1)!.id;
    const agreed = run(big, 'p2', { type: 'trade.respond', offerId: bigOffer, response: 'consented' }).state;
    reject(agreed, 'p1', { type: 'trade.settle', offerId: bigOffer }, 'E_INSUFFICIENT_RESOURCES');
    reject(state, 'p1', { type: 'trade.offer', to: 'p2', give: {}, want: { ore: 1 }, giveGoods: { fish: 1 } }, 'E_INVALID_SELECTION');
    // Gold alone in both directions is still a gift-free exchange; zero terms are refused.
    reject(state, 'p1', { type: 'trade.offer', to: 'p2', give: {}, want: { ore: 1 } }, 'E_INVALID_SELECTION');
    // Only 7 resource cards: no discard, whatever the gold.
    coins(state).gold.p2 = 20;
    setHand(state, 'p2', { wool: 7 });
    forceTurn(state, 0, 'preroll');
    expect(run(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3])).state.pending).toMatchObject({ kind: 'moveRobber' });
  });

  it('RV8: Wealthiest goes to the unique richest (+1), Poor to every poorest (-2), immediately', () => {
    const state = bare();
    const slot = coins(state);
    expect(scoreOf(state, 'p1', { includeHidden: false })).toBe(-2); // all tie at 0: everyone is poorest
    slot.gold = { p1: 5, p2: 5, p3: 1, p4: 2 };
    expect([1, 2, 3, 4].map((seat) => scoreOf(state, `p${seat}`, { includeHidden: false }))).toEqual([0, 0, -2, 0]);
    slot.gold.p1 = 6;
    expect(scoreOf(state, 'p1', { includeHidden: false })).toBe(1);
    const view = projectGame(state, 'p3').modules!.tradersBarbarians as Record<string, Record<string, unknown>>;
    expect(view['tb-rivers']).toMatchObject({ wealthiest: 'p1', poor: ['p3'] });
    expect(view['tb-coins']!.gold).toEqual({ p1: 6, p2: 5, p3: 1, p4: 2 });
  });
});

describe('R-TB-RV simulated games', () => {
  for (const players of [3, 4]) {
    it(`a ${players}-player game finishes and conserves resources and gold`, () => {
      const state = simulateGame(players * 37, 9000, { players, profileId: PROFILE, mode: 'variable', bot: riversBot });
      expect(state.result).toMatchObject({ reason: 'victory' });
      expect(scoreOf(state, state.result!.playerId!, { includeHidden: true })).toBeGreaterThanOrEqual(10);
      for (const resource of ['lumber', 'brick', 'wool', 'grain', 'ore'] as const) expect(resourceTotal(state, resource)).toBe(19);
      expect(goldTotal(state)).toBe(100);
      for (const player of state.players) expect(state.board.roads.filter((road) => road?.player === player.id && road.bridge).length).toBeLessThanOrEqual(3);
    }, SIMULATION_TIMEOUT);
  }
});
