import { describe, expect, it } from 'vitest';
import { topologyOf } from '../src/analysis.ts';
import { registerRulesModule } from '../src/modules/registry.ts';
import { fogAtEnds } from '../src/modules/explorersPirates/geometry.ts';
import { epState } from '../src/modules/explorersPirates/state.ts';
import { registerFixtureProfile, requireProfile } from '../src/profiles.ts';
import { epHints, epPlayable } from './ep-sim.ts';
import { exploringPair, run, shipOf } from './ep-helpers.ts';
import { scriptedRng } from './helpers.ts';

const observed: (number | null)[] = [];
registerRulesModule({ id: 'ep-observer', afterBoardChange(state) { observed.push(epState(state).pirate?.hex ?? null); } });
const profile = requireProfile('ep-pirate-lairs-2025');
registerFixtureProfile('fixture-ep-hooks', [3, 4], { ...profile, id: 'fixture-ep-hooks', ruleModules: ['explorersPirates', 'ep-observer'] });

describe('E&P board-change hooks', () => {
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
    expect(observed).toEqual([null]);
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
    expect(observed).toEqual([null]);
    expect(fogAtEnds(state, to)).toHaveLength(1);
    observed.length = 0;
    const explored = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: to }, scriptedRng([0, 0, 0])).state;
    expect(observed).toEqual([null]);
    expect(epState(explored).fog.length).toBeLessThan(epState(state).fog.length);
    expect(epState(moved).ships.find((entry) => entry.id === ship.id)?.edge).toBe(plain!.edge);
  });

  it('observes successful chase and placement once each, before continuation', () => {
    let state = epPlayable('pirate-lairs', 3);
    state.profileId = 'fixture-ep-hooks';
    const ship = shipOf(state, 'p1');
    const hex = topologyOf(state).edges[ship.edge]!.hexes.find((cell) => state.board.layout.terrain[cell] === 'sea')!;
    epState(state).pirate = { hex, owner: 'p2' };
    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
    observed.length = 0;
    const missed = run(state, 'p1', { type: 'ep.chase', ship: ship.id }, scriptedRng([4]));
    expect(observed).toEqual([]);
    expect(epState(missed.state).pirate?.hex).toBe(hex);
    state = run(state, 'p1', { type: 'ep.chase', ship: ship.id }, scriptedRng([5])).state;
    expect(observed).toEqual([null]);
    const target = epHints(state, 'p1').pirateTargets[0]!;
    state = run(state, 'p1', { type: 'ep.placePirate', hex: target }).state;
    expect(observed).toEqual([null, target]);
    expect(epState(state).pirate?.hex).toBe(target);
  });
});
