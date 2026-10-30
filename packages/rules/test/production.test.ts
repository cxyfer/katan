/** R-B02: production, finite supply and bank-shortage behaviour. */

import { describe, expect, it } from 'vitest';
import { productionForHex, productionForRoll, topologyOf } from '../src/analysis.ts';
import { getProfile } from '../src/profiles.ts';
import { verticesOfHex } from '../src/topology.ts';
import { RESOURCES, type GameState, type Resource } from '../src/types.ts';
import { act, handOf, handSize, newGame, placeBuilding, playableGame, setHand } from './helpers.ts';
import { scriptedRng } from './helpers.ts';

describe('R-B02 production', () => {
  it('produces one resource for a settlement and two for a city', () => {
    const { state } = playableGame({ players: 4 });
    const topo = topologyOf(state);
    const hex = state.board.layout.numbers.findIndex((value) => value === 6);
    const vertices = verticesOfHex(topo, hex);
    placeBuilding(state, 'p1', vertices[0]!, false);
    placeBuilding(state, 'p2', vertices[3]!, true);
    state.board.robber = state.board.layout.robber === hex ? -1 : state.board.layout.robber;

    const result = productionForHex(state, hex, 6)!;
    expect(result.resource).toBeDefined();
    expect(result.entitlements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: 'p1', amount: 1 }),
        expect.objectContaining({ playerId: 'p2', amount: 2 }),
      ]),
    );
    expect(result.starved).toBe(false);
  });

  it('pays nothing from a robber-blocked hex', () => {
    const { state } = playableGame({ players: 4 });
    const topo = topologyOf(state);
    const hex = state.board.layout.numbers.findIndex((value) => value === 6);
    placeBuilding(state, 'p1', verticesOfHex(topo, hex)[0]!, false);
    state.board.robber = hex;
    const result = productionForHex(state, hex, 6)!;
    expect(result.granted).toEqual([]);
    expect(result.starved).toBe(false);
  });

  it('ignores a hex whose number does not match the roll', () => {
    const { state } = playableGame({ players: 4 });
    const hex = state.board.layout.numbers.findIndex((value) => value === 6);
    expect(productionForHex(state, hex, 8)).toBeNull();
  });

  it('starves every entitled player when the bank cannot cover several of them', () => {
    const { state } = playableGame({ players: 4 });
    const topo = topologyOf(state);
    const hex = state.board.layout.numbers.findIndex((value) => value === 6);
    const resource = productionForHex(state, hex, 6)?.resource;
    if (!resource) throw new Error('fixture hex has no resource');
    const vertices = verticesOfHex(topo, hex);
    state.board.buildings = state.board.buildings.map(() => null);
    placeBuilding(state, 'p1', vertices[0]!, false);
    placeBuilding(state, 'p2', vertices[3]!, false);
    state.bank[resource] = 1;

    const result = productionForHex(state, hex, 6)!;
    expect(result.entitlements.length).toBe(2);
    expect(result.granted).toEqual([]);
    expect(result.starved).toBe(true);
  });

  it('lets a single entitled player take the remaining cards', () => {
    const { state } = playableGame({ players: 4 });
    const topo = topologyOf(state);
    const hex = state.board.layout.numbers.findIndex((value) => value === 6);
    const resource = productionForHex(state, hex, 6)?.resource;
    if (!resource) throw new Error('fixture hex has no resource');
    state.board.buildings = state.board.buildings.map(() => null);
    placeBuilding(state, 'p1', verticesOfHex(topo, hex)[0]!, true);
    state.bank[resource] = 1;

    const result = productionForHex(state, hex, 6)!;
    expect(result.granted).toEqual([expect.objectContaining({ playerId: 'p1', amount: 1 })]);
    expect(result.starved).toBe(false);
  });

  it('applies the two dice independently for every ordered pair', () => {
    const seen = new Set<string>();
    for (let first = 1; first <= 6; first++) {
      for (let second = 1; second <= 6; second++) {
        const { state } = newGame({ players: 3 });
        state.turn.phase = 'preroll';
        const rolled = act(
          state,
          'p1',
          { type: 'turn.roll' },
          scriptedRng([first - 1, second - 1]),
        ).state;
        expect(rolled.turn.dice).toEqual([first, second]);
        seen.add(`${first},${second}`);
      }
    }
    expect(seen.size).toBe(36);
  });

  it('resolves a full roll into hands and decrements the bank', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    const total = 8;
    const hexes = state.board.layout.numbers
      .map((value, hex) => ({ value, hex }))
      .filter(({ value }) => value === total)
      .map(({ hex }) => hex);
    const expected = new Map<string, number>();
    for (const hex of hexes) {
      for (const vertex of verticesOfHex(topologyOf(state), hex)) {
        const building = state.board.buildings[vertex];
        if (!building) continue;
        expected.set(building.player, (expected.get(building.player) ?? 0) + (building.city ? 2 : 1));
      }
    }
    const before = new Map(state.players.map((player) => [player.id, handSize(state, player.id)]));
    const bankBefore = { ...state.bank };

    const first = Math.min(6, total - 1);
    const second = total - first;
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng([first - 1, second - 1])).state;
    expect(rolled.turn.dice![0] + rolled.turn.dice![1]).toBe(total);

    for (const player of rolled.players) {
      const gained = handSize(rolled, player.id) - (before.get(player.id) ?? 0);
      expect(gained).toBeGreaterThanOrEqual(0);
    }
    const spent = Object.entries(bankBefore).reduce(
      (sum, [resource, amount]) => sum + (amount - rolled.bank[resource as 'lumber']),
      0,
    );
    const gainedTotal = rolled.players.reduce(
      (sum, player) => sum + (handSize(rolled, player.id) - (before.get(player.id) ?? 0)),
      0,
    );
    expect(spent).toBe(gainedTotal);
  });

  it('never produces from the desert', () => {
    const { state } = playableGame({ players: 4 });
    const desert = state.board.layout.terrain.indexOf('desert');
    for (let total = 2; total <= 12; total++) {
      expect(productionForHex(state, desert, total)).toBeNull();
    }
  });

  it('reports every producing hex for a roll', () => {
    const { state } = playableGame({ players: 4 });
    const results = productionForRoll(state, 8);
    const expected = state.board.layout.numbers.filter((value) => value === 8).length;
    expect(results.length).toBe(expected);
  });

  it('does not double-pay a player who owns several buildings on one hex', () => {
    const { state } = playableGame({ players: 4 });
    const topo = topologyOf(state);
    const hex = state.board.layout.numbers.findIndex((value) => value === 6);
    const resource = productionForHex(state, hex, 6)?.resource!;
    state.board.buildings = state.board.buildings.map(() => null);
    const vertices = verticesOfHex(topo, hex);
    placeBuilding(state, 'p1', vertices[0]!, false);
    placeBuilding(state, 'p1', vertices[3]!, false);
    setHand(state, 'p1', {});
    const result = productionForHex(state, hex, 6)!;
    const granted = result.granted
      .filter((share) => share.playerId === 'p1')
      .reduce((sum, share) => sum + share.amount, 0);
    expect(granted).toBe(2);
    expect(state.bank[resource]).toBeGreaterThan(0);
  });
});

function totalSupply(state: GameState, resource: Resource): number {
  return state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
}

function expectConserved(state: GameState): void {
  const perResource = getProfile(state.profileId)!.bankPerResource;
  for (const resource of RESOURCES) {
    expect(state.bank[resource]).toBeGreaterThanOrEqual(0);
    expect(totalSupply(state, resource)).toBe(perResource);
  }
}

/** 把手牌全退回銀行，再把銀行該資源移到 `holder` 手上只留 `left` 張，維持總量守恆。 */
function shortBank(state: GameState, resource: Resource, left: number, holder = 'p4'): void {
  for (const player of state.players) {
    for (const r of RESOURCES) {
      state.bank[r] += player.resources[r];
      player.resources[r] = 0;
    }
  }
  const player = state.players.find((candidate) => candidate.id === holder)!;
  player.resources[resource] = state.bank[resource] - left;
  state.bank[resource] = left;
}

/**
 * 固定測試佈局：兩塊互不相鄰的山地（礦石）與一塊麥田共用點數 6，其他地形不產出 6，
 * 清空所有建築並把強盜移到沙漠。
 */
function twinOreLayout(state: GameState): { ore: [number, number]; grain: number } {
  const topo = topologyOf(state);
  const layout = state.board.layout;
  const desert = layout.terrain.indexOf('desert');
  const picked: number[] = [];
  const used = new Set<number>();
  for (let hex = 0; hex < layout.terrain.length && picked.length < 3; hex++) {
    if (hex === desert) continue;
    const vertices = verticesOfHex(topo, hex);
    if (vertices.some((vertex) => used.has(vertex))) continue;
    picked.push(hex);
    for (const vertex of vertices) used.add(vertex);
  }
  if (picked.length < 3) throw new Error('fixture needs three disjoint hexes');
  const [a, b, c] = picked as [number, number, number];
  layout.numbers = layout.numbers.map((value) => (value === 6 ? 8 : value));
  layout.terrain[a] = 'mountains';
  layout.terrain[b] = 'mountains';
  layout.terrain[c] = 'fields';
  layout.numbers[a] = 6;
  layout.numbers[b] = 6;
  layout.numbers[c] = 6;
  state.board.robber = desert;
  state.board.buildings = state.board.buildings.map(() => null);
  return { ore: [a, b], grain: c };
}

function rollSix(state: GameState) {
  return act(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 2]));
}

describe('R-B02 bank shortage is judged per resource across hexes', () => {
  it('starves everyone when two same-resource hexes together exceed the bank', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    const { ore: [a, b] } = twinOreLayout(state);
    const topo = topologyOf(state);
    placeBuilding(state, 'p1', verticesOfHex(topo, a)[0]!, true);
    placeBuilding(state, 'p2', verticesOfHex(topo, b)[0]!, true);
    // 每塊單獨需求 2 ≤ 3，但合計 4 > 3。
    shortBank(state, 'ore', 3);

    const { state: rolled, events } = rollSix(state);
    expect(rolled.bank.ore).toBe(3);
    expect(handOf(rolled, 'p1').ore).toBe(0);
    expect(handOf(rolled, 'p2').ore).toBe(0);
    const starved = events.filter((event) => event.type === 'production.starved');
    expect(starved.map((event) => event.params.hex).sort()).toEqual([a, b].sort());
    expect(starved.every((event) => event.params.resource === 'ore')).toBe(true);
    expect(rolled.stats!.players['p1']!.starvedResources.ore).toBe(2);
    expect(rolled.stats!.players['p2']!.starvedResources.ore).toBe(2);
    expect(rolled.stats!.players['p1']!.produced.ore).toBe(0);
    expectConserved(rolled);

    const results = productionForRoll(state, 6).filter((result) => result.resource === 'ore');
    expect(results.every((result) => result.starved && result.granted.length === 0)).toBe(true);
  });

  it('pays everyone when the bank covers the combined demand', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    const { ore: [a, b] } = twinOreLayout(state);
    const topo = topologyOf(state);
    placeBuilding(state, 'p1', verticesOfHex(topo, a)[0]!, true);
    placeBuilding(state, 'p2', verticesOfHex(topo, b)[0]!, true);
    shortBank(state, 'ore', 4);

    const { state: rolled, events } = rollSix(state);
    expect(handOf(rolled, 'p1').ore).toBe(2);
    expect(handOf(rolled, 'p2').ore).toBe(2);
    expect(rolled.bank.ore).toBe(0);
    expect(events.some((event) => event.type === 'production.starved')).toBe(false);
    expectConserved(rolled);
  });

  it('gives a sole entitled player exactly what remains across several hexes', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    const { ore: [a, b] } = twinOreLayout(state);
    const topo = topologyOf(state);
    placeBuilding(state, 'p1', verticesOfHex(topo, a)[0]!, true);
    placeBuilding(state, 'p1', verticesOfHex(topo, b)[0]!, true);
    shortBank(state, 'ore', 3);

    const { state: rolled, events } = rollSix(state);
    expect(handOf(rolled, 'p1').ore).toBe(3);
    expect(rolled.bank.ore).toBe(0);
    expect(events.some((event) => event.type === 'production.starved')).toBe(false);
    expect(rolled.stats!.players['p1']!.produced.ore).toBe(3);
    expect(rolled.stats!.players['p1']!.starvedResources.ore).toBe(1);
    expectConserved(rolled);
  });

  it('excludes a robber-blocked hex from the demand and still reports it as blocked', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    const { ore: [a, b] } = twinOreLayout(state);
    const topo = topologyOf(state);
    placeBuilding(state, 'p3', verticesOfHex(topo, a)[0]!, true);
    placeBuilding(state, 'p1', verticesOfHex(topo, b)[0]!, true);
    placeBuilding(state, 'p2', verticesOfHex(topo, b)[3]!, true);
    state.board.robber = a;
    shortBank(state, 'ore', 3);

    const { state: rolled, events } = rollSix(state);
    const starved = events.filter((event) => event.type === 'production.starved');
    expect(starved.map((event) => event.params.hex)).toEqual([b]);
    expect(rolled.bank.ore).toBe(3);
    const stats = rolled.stats!.players;
    expect(stats['p3']!.blockedResources.ore).toBe(2);
    expect(stats['p3']!.blockedRolls).toBe(1);
    expect(stats['p3']!.starvedResources.ore).toBe(0);
    expect(stats['p1']!.starvedResources.ore).toBe(2);
    expect(stats['p2']!.starvedResources.ore).toBe(2);
    expectConserved(rolled);
  });

  it('gives a sole entitled player with several buildings on one hex what remains', () => {
    const { state } = playableGame({ players: 4 });
    const { ore: [a] } = twinOreLayout(state);
    const vertices = verticesOfHex(topologyOf(state), a);
    placeBuilding(state, 'p1', vertices[0]!, false);
    placeBuilding(state, 'p1', vertices[3]!, true);
    shortBank(state, 'ore', 2);

    const result = productionForHex(state, a, 6)!;
    const granted = result.granted.reduce((sum, share) => sum + share.amount, 0);
    expect(granted).toBe(2);
    expect(result.starved).toBe(false);
  });

  it('leaves other resources on the same roll unaffected', () => {
    const { state } = playableGame({ players: 4, phase: 'preroll' });
    const { ore: [a, b], grain } = twinOreLayout(state);
    const topo = topologyOf(state);
    placeBuilding(state, 'p1', verticesOfHex(topo, a)[0]!, true);
    placeBuilding(state, 'p2', verticesOfHex(topo, b)[0]!, true);
    placeBuilding(state, 'p3', verticesOfHex(topo, grain)[0]!, true);
    shortBank(state, 'ore', 3);

    const { state: rolled, events } = rollSix(state);
    expect(rolled.bank.ore).toBe(3);
    expect(handOf(rolled, 'p3').grain).toBe(2);
    const starved = events.filter((event) => event.type === 'production.starved');
    expect(starved.every((event) => event.params.resource === 'ore')).toBe(true);
    expectConserved(rolled);
  });

  it('conserves bank + hands for every resource after any roll and bank level', () => {
    for (let left = 0; left <= 6; left++) {
      for (const owners of [['p1', 'p2'], ['p1', 'p1'], ['p2', 'p3']] as const) {
        const { state } = playableGame({ players: 4, phase: 'preroll' });
        const { ore: [a, b], grain } = twinOreLayout(state);
        const topo = topologyOf(state);
        placeBuilding(state, owners[0], verticesOfHex(topo, a)[0]!, true);
        placeBuilding(state, owners[0], verticesOfHex(topo, a)[3]!, false);
        placeBuilding(state, owners[1], verticesOfHex(topo, b)[0]!, true);
        placeBuilding(state, 'p3', verticesOfHex(topo, grain)[0]!, false);
        shortBank(state, 'ore', left);
        expectConserved(state);
        const rolled = rollSix(state).state;
        expectConserved(rolled);
      }
    }
  });
});
