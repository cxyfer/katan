import { describe, expect, it } from 'vitest';
import { topologyOf, totalResources } from '../src/analysis.ts';
import { registerRulesModule } from '../src/modules/registry.ts';
import { fogAtEnds, isSeaRoute } from '../src/modules/explorersPirates/geometry.ts';
import { epState } from '../src/modules/explorersPirates/state.ts';
import { registerFixtureProfile, requireProfile } from '../src/profiles.ts';
import { epHints, epPlayable } from './ep-sim.ts';
import { exploringPair, run, shipOf } from './ep-helpers.ts';
import { scriptedRng, setHand } from './helpers.ts';

interface Observation {
  pirateHex: number | null;
  pendingKind: string | null;
  victimHandSize: number;
}

const observed: Observation[] = [];
registerRulesModule({
  id: 'ep-observer',
  afterBoardChange(state) {
    observed.push({
      pirateHex: epState(state).pirate?.hex ?? null,
      pendingKind: state.pending?.kind ?? null,
      victimHandSize: totalResources(state.players.find((player) => player.id === 'p2')!),
    });
  },
});
const profile = requireProfile('ep-pirate-lairs-2025');
registerFixtureProfile('fixture-ep-hooks', [3, 4], { ...profile, id: 'fixture-ep-hooks', ruleModules: ['explorersPirates', 'ep-observer'] });

describe('E&P board-change hooks', () => {
  it.each([false, true])('notifies once after building a ship (replacement: %s)', (replacement) => {
    const state = epPlayable('pirate-lairs', 3);
    state.profileId = 'fixture-ep-hooks';
    const slot = epState(state);
    const ship = shipOf(state, 'p1');
    if (replacement) {
      const free = topologyOf(state).edges.map((_, edge) => edge).filter((edge) =>
        isSeaRoute(state, edge) && fogAtEnds(state, edge).length === 0 && !slot.ships.some((entry) => entry.edge === edge));
      expect(free.length).toBeGreaterThanOrEqual(2);
      slot.ships.push(
        { ...ship, id: 'spare-1', edge: free[0]!, cargo: [] },
        { ...ship, id: 'spare-2', edge: free[1]!, cargo: [] },
      );
    }
    setHand(state, 'p1', { lumber: 1, wool: 1 });
    const edge = epHints(state, 'p1').shipEdges[0]!;
    expect(edge).toBeDefined();
    observed.length = 0;
    const result = run(state, 'p1', {
      type: 'ep.buildShip', edge, ...(replacement ? { replace: ship.id } : {}),
    });
    expect(observed).toHaveLength(1);
    expect(epState(result.state).ships.some((entry) => entry.player === 'p1' && entry.edge === edge)).toBe(true);
    expect(epState(result.state).ships.filter((entry) => entry.player === 'p1')).toHaveLength(replacement ? 3 : 2);
  });

  it('notifies once when a captured lair receives its number', () => {
    const state = epPlayable('pirate-lairs', 3);
    state.profileId = 'fixture-ep-hooks';
    const slot = epState(state);
    const hex = slot.fog.shift()!.hex;
    state.board.layout.terrain[hex] = 'gold';
    slot.sites.push({ hex, kind: 'lair', crews: ['p1', 'p2', 'p3'], captured: false });
    slot.captures.push(hex);
    observed.length = 0;
    const result = run(state, 'p1', { type: 'turn.end' }, scriptedRng([5, 0, 0, 0]));
    expect(observed.map((entry) => entry.pirateHex)).toEqual([null]);
    expect(result.state.board.layout.numbers[hex]).not.toBeNull();
  });

  it('observes one notification per ship move, including exploration', () => {
    let state = epPlayable('pirate-lairs', 3);
    state.profileId = 'fixture-ep-hooks';
    const ship = shipOf(state, 'p1');
    const { from, to } = exploringPair(state);
    ship.edge = from;
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    const plain = epHints(state, 'p1').ships.find((entry) => entry.id === ship.id)!.steps.find((step) => !step.explores && !step.full);
    expect(plain).toBeDefined();
    observed.length = 0;
    const moved = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: plain!.edge }).state;
    expect(observed.map((entry) => entry.pirateHex)).toEqual([null]);
    expect(fogAtEnds(state, to)).toHaveLength(1);
    observed.length = 0;
    const explored = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: to }, scriptedRng([0, 0, 0])).state;
    expect(observed.map((entry) => entry.pirateHex)).toEqual([null]);
    expect(epState(explored).fog.length).toBeLessThan(epState(state).fog.length);
    expect(epState(moved).ships.find((entry) => entry.id === ship.id)?.edge).toBe(plain!.edge);
  });

  it('observes successful chase and placement once each, before continuation', () => {
    let state = epPlayable('pirate-lairs', 3);
    state.profileId = 'fixture-ep-hooks';
    const ship = shipOf(state, 'p1');
    const hex = topologyOf(state).edges[ship.edge]!.hexes.find((cell) => state.board.layout.terrain[cell] === 'sea')!;
    epState(state).pirate = { hex, owner: 'p2' };
    setHand(state, 'p2', { ore: 1 });
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    observed.length = 0;
    const missed = run(state, 'p1', { type: 'ep.chase', ship: ship.id }, scriptedRng([4]));
    expect(observed).toEqual([]);
    expect(epState(missed.state).pirate?.hex).toBe(hex);
    state = run(state, 'p1', { type: 'ep.chase', ship: ship.id }, scriptedRng([5])).state;
    expect(observed).toEqual([{ pirateHex: null, pendingKind: null, victimHandSize: 1 }]);
    expect(state.pending?.kind).toBe('explorersPirates.pirate');
    const target = epHints(state, 'p1').pirateTargets[0]!;
    // Only p2 has a ship here, so placement must steal before completing the frame.
    const edge = topologyOf(state).edges.findIndex((entry) => entry.hexes.includes(target));
    epState(state).ships = [
      shipOf(state, 'p1'),
      { id: 'victim', player: 'p2', edge, cargo: [] },
    ];
    state = run(state, 'p1', { type: 'ep.placePirate', hex: target }).state;
    expect(observed).toEqual([
      { pirateHex: null, pendingKind: null, victimHandSize: 1 },
      { pirateHex: target, pendingKind: 'explorersPirates.pirate', victimHandSize: 1 },
    ]);
    expect(totalResources(state.players.find((player) => player.id === 'p2')!)).toBe(0);
    expect(state.pending).toBeNull();
    expect(epState(state).pirate?.hex).toBe(target);
  });
});
