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
    // Gold is public: proposals cannot promise more than the proposer holds.
    reject(state, 'p1', { type: 'trade.offer', to: 'p2', give: {}, want: { ore: 1 }, giveGoods: { gold: 9 } }, 'E_INSUFFICIENT_RESOURCES');
    reject(state, 'p1', { type: 'trade.offer', to: 'p2', give: {}, want: { ore: 1 }, giveGoods: { fish: 1 } }, 'E_INVALID_SELECTION');
    // Gold alone in both directions is still a gift-free exchange; zero terms are refused.
    reject(state, 'p1', { type: 'trade.offer', to: 'p2', give: {}, want: { ore: 1 } }, 'E_INVALID_SELECTION');
    // Only 7 resource cards: no discard, whatever the gold.
    coins(state).gold.p2 = 20;
    setHand(state, 'p2', { wool: 7 });
    forceTurn(state, 0, 'preroll');
    expect(run(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3])).state.pending).toMatchObject({ kind: 'moveRobber' });
  });

  it('checks the proposer’s goods on creation/revision and preserves a rejected revision', () => {
    const state = bare();
    coins(state).gold.p1 = 2;
    const offered = run(state, 'p1', { type: 'trade.offer', to: 'all', give: {}, giveGoods: { gold: 2 }, want: { ore: 1 } }).state;
    const offer = offered.offers.at(-1)!;
    const original = JSON.parse(JSON.stringify(offered));
    reject(offered, 'p1', { type: 'trade.revise', offerId: offer.id, give: {}, giveGoods: { gold: 3 }, want: { wool: 1 } }, 'E_INSUFFICIENT_RESOURCES');
    expect(offered).toEqual(original);
    const revised = run(offered, 'p1', { type: 'trade.revise', offerId: offer.id, give: { ore: 1 }, want: {}, wantGoods: { gold: 2 } }).state;
    expect(revised.offers.at(-1)).toMatchObject({ give: { ore: 1 }, want: {}, wantGoods: { gold: 2 } });
    expect(revised.offers.at(-1)).not.toHaveProperty('giveGoods');
  });

  it('checks both parties’ goods on consent while leaving interest and decline available', () => {
    const state = bare();
    coins(state).gold.p1 = 2;
    coins(state).gold.p2 = 1;
    const offered = run(state, 'p1', {
      type: 'trade.offer', to: 'p2', give: { wool: 1 }, giveGoods: { gold: 2 }, want: {}, wantGoods: { gold: 2 },
    }).state;
    const offerId = offered.offers.at(-1)!.id;
    reject(offered, 'p2', { type: 'trade.respond', offerId, response: 'consented' }, 'E_INSUFFICIENT_RESOURCES');
    expect(run(offered, 'p2', { type: 'trade.respond', offerId, response: 'interested' }).state.offers.at(-1)!.responses.p2).toBe('interested');
    expect(run(offered, 'p2', { type: 'trade.respond', offerId, response: 'declined' }).state.offers.at(-1)!.responses.p2).toBe('declined');
    coins(offered).gold.p2 = 2;
    coins(offered).gold.p1 = 1;
    reject(offered, 'p2', { type: 'trade.respond', offerId, response: 'consented' }, 'E_INSUFFICIENT_RESOURCES');
  });

  it.each(['p1', 'p2'])('rechecks %s goods at settlement after consent without partially transferring anything', (playerId) => {
    const state = bare();
    coins(state).gold.p1 = 3;
    coins(state).gold.p2 = 3;
    setHand(state, 'p1', { wool: 1 });
    setHand(state, 'p2', { ore: 1 });
    const offered = run(state, 'p1', {
      type: 'trade.offer', to: 'p2', give: { wool: 1 }, giveGoods: { gold: 2 }, want: { ore: 1 }, wantGoods: { gold: 2 },
    }).state;
    const offerId = offered.offers.at(-1)!.id;
    const consented = run(offered, 'p2', { type: 'trade.respond', offerId, response: 'consented' }).state;
    coins(consented).gold[playerId] = 1;
    const original = JSON.parse(JSON.stringify(consented));
    reject(consented, 'p1', { type: 'trade.settle', offerId }, 'E_INSUFFICIENT_RESOURCES');
    expect(consented).toEqual(original);
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

describe('R-TB-RV clause fixtures (pp. 11–12)', () => {
  /** A river vertex with an own road end, away from bridge sites: p1 may settle there. */
  function riverSettlementSpot(state: GameState): { vertex: number; road: number } {
    const topology = topologyOf(state);
    const slot = rivers(state);
    for (const vertex of slot.vertices) {
      for (const road of topology.vertices[vertex]!.edges) {
        if (slot.bridgeSites.includes(road) || slot.edges.includes(road)) continue;
        const far = topology.edges[road]!.vertices.find((candidate) => candidate !== vertex)!;
        if (!slot.vertices.includes(far) && !state.board.buildings[vertex]) return { vertex, road };
      }
    }
    throw new Error('no spot');
  }

  /** A river-tile edge that is not a bridge site, with one of its ends. */
  function riverRoadSpot(state: GameState): { vertex: number; edge: number } {
    const topology = topologyOf(state);
    const slot = rivers(state);
    for (const edge of slot.edges) {
      if (slot.bridgeSites.includes(edge) || topology.edges[edge]!.interior) continue;
      return { vertex: topology.edges[edge]!.vertices[0]!, edge };
    }
    throw new Error('no spot');
  }

  it('RV9: TB25 p.11 — in the action phase a settlement on a river intersection earns 1 gold; a city upgrade earns none', () => {
    // Start: p1 owns a road ending at a river corner and holds settlement resources; command: build.settlement, then build.city.
    const state = bare();
    const { vertex, road } = riverSettlementSpot(state);
    placeRoad(state, 'p1', road);
    setHand(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    const built = run(state, 'p1', { type: 'build.settlement', vertex });
    expect(coins(built.state).gold.p1).toBe(1);
    expect(built.events.find((event) => event.type === 'tb.goldGained')!.params).toMatchObject({ playerId: 'p1', amount: 1, cause: 'riverSettlement' });
    setHand(built.state, 'p1', { grain: 2, ore: 3 });
    const city = run(built.state, 'p1', { type: 'build.city', vertex });
    expect(coins(city.state).gold.p1).toBe(1);
    expect(city.events.map((event) => event.type)).not.toContain('tb.goldGained');
    expect(goldTotal(city.state)).toBe(100);
  });

  it('RV10: TB25 p.11 — a road on a river edge earns 1 gold, also when Road Building places it; other roads earn none', () => {
    const state = bare();
    const topology = topologyOf(state);
    const { vertex, edge } = riverRoadSpot(state);
    placeBuilding(state, 'p1', vertex);
    setHand(state, 'p1', { lumber: 2, brick: 2 });
    const paid = run(state, 'p1', { type: 'build.road', edge });
    expect(coins(paid.state).gold.p1).toBe(1);
    // Road Building: the free road on a river edge also pays.
    const free = bare();
    placeBuilding(free, 'p1', vertex);
    free.pending = { kind: 'freeRoads', actor: 'p1', remaining: 2 };
    const viaCard = run(free, 'p1', { type: 'build.road', edge });
    expect(coins(viaCard.state).gold.p1).toBe(1);
    // A road away from the rivers pays nothing.
    const plain = bare();
    const slot = rivers(plain);
    const dry = topology.edges.findIndex((candidate, index) => !candidate.interior && !slot.edges.includes(index) && !slot.bridgeSites.includes(index) &&
      candidate.vertices.every((end) => !slot.vertices.includes(end)));
    placeBuilding(plain, 'p1', topology.edges[dry]!.vertices[0]!);
    setHand(plain, 'p1', { lumber: 1, brick: 1 });
    expect(coins(run(plain, 'p1', { type: 'build.road', edge: dry }).state).gold.p1).toBe(0);
  });

  it('RV11: TB25 p.12 — a bridge needs an own road or building at one end; an unconnected site is refused', () => {
    // Start: p1 has resources but nothing near any bridge site. Command: tb.buildBridge.
    const state = bare();
    setHand(state, 'p1', { brick: 2, lumber: 1 });
    for (const site of rivers(state).bridgeSites) reject(state, 'p1', { type: 'tb.buildBridge', edge: site }, 'E_ILLEGAL_TARGET');
    expect(coins(state).gold.p1).toBe(0);
  });

  it('RV12: TB25 p.12 — an opponent\'s settlement at the far end does not stop a bridge connected at the near end', () => {
    const state = bare();
    const site = rivers(state).bridgeSites[0]!;
    const [near, far] = topologyOf(state).edges[site]!.vertices;
    placeBuilding(state, 'p1', near);
    placeBuilding(state, 'p2', far);
    setHand(state, 'p1', { brick: 2, lumber: 1 });
    expect(run(state, 'p1', { type: 'tb.buildBridge', edge: site }).state.board.roads[site]).toMatchObject({ player: 'p1', bridge: true });
  });

  it('RV13: TB25 p.12 — Wealthiest ties give nobody the tile; Poor is returned once a player is no longer the poorest', () => {
    const state = bare();
    const gold = coins(state);
    gold.gold = { p1: 3, p2: 3, p3: 0, p4: 1 };
    expect([1, 2, 3, 4].map((seat) => scoreOf(state, `p${seat}`, { includeHidden: false }))).toEqual([0, 0, -2, 0]);
    // p3 gains gold: p4 is now the only poorest; the tie of the top is unchanged.
    gold.gold.p3 = 2;
    expect([1, 2, 3, 4].map((seat) => scoreOf(state, `p${seat}`, { includeHidden: false }))).toEqual([0, 0, 0, -2]);
    // Several poorest players all take a tile.
    gold.gold = { p1: 3, p2: 1, p3: 1, p4: 2 };
    expect([1, 2, 3, 4].map((seat) => scoreOf(state, `p${seat}`, { includeHidden: false }))).toEqual([1, -2, -2, 0]);
  });

  it('RV14: TB25 p.12 — gaining gold can win the game: a bridge that makes the builder the unique richest ends it', () => {
    // Start: p1 has 9 VP and 0 gold (poorest: -2 included in score); the others hold 2 gold each. Command: tb.buildBridge (+3 gold).
    const state = bare();
    const site = rivers(state).bridgeSites[0]!;
    placeBuilding(state, 'p1', topologyOf(state).edges[site]!.vertices[0]!);
    state.players[0]!.bonusPoints = 9;
    coins(state).gold = { p1: 0, p2: 2, p3: 2, p4: 2 };
    coins(state).supply = 94;
    setHand(state, 'p1', { brick: 2, lumber: 1 });
    expect(scoreOf(state, 'p1', { includeHidden: true })).toBe(1 + 9 - 2);
    const built = run(state, 'p1', { type: 'tb.buildBridge', edge: site }).state;
    expect(built.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
  });

  it('RV15: TB25 p.12 — the Poor tile can keep a player from winning until their gold rises (checked when their turn comes)', () => {
    const state = bare();
    state.players[0]!.bonusPoints = 11;
    coins(state).gold = { p1: 0, p2: 2, p3: 2, p4: 2 };
    forceTurn(state, 3, 'action');
    expect(run(state, 'p4', { type: 'turn.end' }).state.result).toBeNull();
    coins(state).gold = { p1: 2, p2: 2, p3: 2, p4: 2 };
    coins(state).gold.p1 = 3;
    forceTurn(state, 3, 'action');
    expect(run(state, 'p4', { type: 'turn.end' }).state.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
  });

  it('RV16: TB25 p.12 — a 2:1 harbour sells two matching resources for 1 gold, a 3:1 harbour three', () => {
    const state = bare();
    const topology = topologyOf(state);
    const special = state.board.layout.harbors.find((harbor) => harbor.type !== 'generic')!;
    placeBuilding(state, 'p1', topology.edges[special.edge]!.vertices[0]!);
    setHand(state, 'p1', { [special.type]: 3 });
    const sold = run(state, 'p1', { type: 'tb.sellResources', resource: special.type });
    expect(sold.state.players[0]!.resources[special.type as 'ore']).toBe(1);
    expect(coins(sold.state).gold.p1).toBe(1);
    expect(sold.events.find((event) => event.type === 'tb.goldSold')!.params).toMatchObject({ rate: 2 });
    const generic = state.board.layout.harbors.find((harbor) => harbor.type === 'generic')!;
    const other = bare();
    placeBuilding(other, 'p1', topology.edges[generic.edge]!.vertices[0]!);
    setHand(other, 'p1', { wool: 3 });
    expect(run(other, 'p1', { type: 'tb.sellResources', resource: 'wool' }).state.players[0]!.resources.wool).toBe(0);
  });

  it('RV17: TB25 p.11 — when the gold supply is empty nothing can be sold, and a bridge pays only what is left', () => {
    const state = bare();
    coins(state).supply = 0;
    coins(state).gold = { p1: 100, p2: 0, p3: 0, p4: 0 };
    setHand(state, 'p1', { wool: 4 });
    reject(state, 'p1', { type: 'tb.sellResources', resource: 'wool' }, 'E_TB_GOLD_SUPPLY_EMPTY');
    const partial = bare();
    const site = rivers(partial).bridgeSites[0]!;
    placeBuilding(partial, 'p1', topologyOf(partial).edges[site]!.vertices[0]!);
    coins(partial).supply = 2;
    coins(partial).gold = { p1: 0, p2: 98, p3: 0, p4: 0 };
    setHand(partial, 'p1', { brick: 2, lumber: 1 });
    const built = run(partial, 'p1', { type: 'tb.buildBridge', edge: site }).state;
    expect(coins(built).gold.p1).toBe(2);
    expect(coins(built).supply).toBe(0);
    expect(goldTotal(built)).toBe(100);
  });

  it('RV18: TB25 p.12 — Monopoly takes resource cards only, never gold', () => {
    const state = bare();
    coins(state).gold = { p1: 0, p2: 5, p3: 0, p4: 0 };
    setHand(state, 'p2', { ore: 2 });
    state.players[0]!.devCards = ['monopoly'];
    const played = run(state, 'p1', { type: 'dev.playMonopoly', resource: 'ore' }).state;
    expect(played.players[0]!.resources.ore).toBe(2);
    expect(coins(played).gold).toEqual({ p1: 0, p2: 5, p3: 0, p4: 0 });
  });

  it('RV19: TB25 p.11 — the robber on the shared 2/12 hex blocks both numbers', () => {
    const state = bare();
    forceTurn(state, 0, 'preroll');
    const twelve = state.board.layout.numbers.indexOf(12);
    placeBuilding(state, 'p1', verticesOfHex(topologyOf(state), twelve)[0]!);
    state.board.robber = twelve;
    for (const dice of [[0, 0], [5, 5]]) {
      const rolled = run(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice)).state;
      expect(rolled.players[0]!.resources[resourceOf(state, twelve)]).toBe(0);
    }
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
