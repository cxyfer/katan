/** R-B02: building and development-card costs return to the bank (finite supply is conserved). */

import { describe, expect, it } from 'vitest';
import { legalBuildingVertices, legalRoadEdges } from '../src/engine.ts';
import { getProfile } from '../src/profiles.ts';
import { RESOURCES, type GameState, type Resource } from '../src/types.ts';
import { act, give, handOf, placePath, playableGame, scriptedRng } from './helpers.ts';

function totalSupply(state: GameState, resource: Resource): number {
  return state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
}

function expectConserved(state: GameState): void {
  const perResource = getProfile(state.profileId)!.bankPerResource;
  for (const resource of RESOURCES) expect(totalSupply(state, resource)).toBe(perResource);
}

describe('R-B02 spending returns cards to the bank', () => {
  it('returns road costs to the bank', () => {
    const { state } = playableGame({ players: 4 });
    give(state, 'p1', { lumber: 1, brick: 1 });
    const bankBefore = { ...state.bank };
    const edge = legalRoadEdges(state, 'p1')[0]!;
    const built = act(state, 'p1', { type: 'build.road', edge }, scriptedRng([0])).state;
    expect(built.bank.lumber).toBe(bankBefore.lumber + 1);
    expect(built.bank.brick).toBe(bankBefore.brick + 1);
    expectConserved(built);
  });

  it('returns settlement costs to the bank', () => {
    const { state } = playableGame({ players: 4 });
    const own = state.board.buildings.findIndex((building) => building?.player === 'p1');
    placePath(state, 'p1', 3, { startVertex: own });
    const vertex = legalBuildingVertices(state, 'p1')[0];
    expect(vertex).toBeDefined();
    give(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    const bankBefore = { ...state.bank };
    const built = act(state, 'p1', { type: 'build.settlement', vertex: vertex! }, scriptedRng([0])).state;
    expect(built.bank.lumber).toBe(bankBefore.lumber + 1);
    expect(built.bank.brick).toBe(bankBefore.brick + 1);
    expect(built.bank.wool).toBe(bankBefore.wool + 1);
    expect(built.bank.grain).toBe(bankBefore.grain + 1);
    expectConserved(built);
  });

  it('returns city costs to the bank', () => {
    const { state } = playableGame({ players: 4 });
    const vertex = state.board.buildings.findIndex((building) => building?.player === 'p1' && !building.city);
    give(state, 'p1', { grain: 2, ore: 3 });
    const bankBefore = { ...state.bank };
    const built = act(state, 'p1', { type: 'build.city', vertex }, scriptedRng([0])).state;
    expect(built.bank.grain).toBe(bankBefore.grain + 2);
    expect(built.bank.ore).toBe(bankBefore.ore + 3);
    expectConserved(built);
  });

  it('returns development card costs to the bank', () => {
    const { state } = playableGame({ players: 4 });
    give(state, 'p1', { wool: 1, grain: 1, ore: 1 });
    const bankBefore = { ...state.bank };
    const bought = act(state, 'p1', { type: 'build.devCard' }, scriptedRng([0])).state;
    expect(handOf(bought, 'p1').ore).toBe(handOf(state, 'p1').ore - 1);
    expect(bought.bank.wool).toBe(bankBefore.wool + 1);
    expect(bought.bank.grain).toBe(bankBefore.grain + 1);
    expect(bought.bank.ore).toBe(bankBefore.ore + 1);
    expectConserved(bought);
  });

  it('starts from a conserved supply after setup', () => {
    const { state } = playableGame({ players: 4 });
    expectConserved(state);
  });
});
