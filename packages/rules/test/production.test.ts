/** R-B02: production, finite supply and bank-shortage behaviour. */

import { describe, expect, it } from 'vitest';
import { productionForHex, productionForRoll, topologyOf } from '../src/analysis.ts';
import { verticesOfHex } from '../src/topology.ts';
import { act, handSize, newGame, placeBuilding, playableGame, setHand } from './helpers.ts';
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
