/** R-B01: initial placement fixtures (B25 setup). */

import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/engine.ts';
import { buildBaseLayout } from '../src/layout.ts';
import { buildTopology } from '../src/topology.ts';
import { neighborsOfVertex } from '../src/analysis.ts';
import { expectRejected, newGame, runSetup, runSetupRecorded, act } from './helpers.ts';
import { seededRng } from '../src/rng.ts';

describe('R-B01 initial placement', () => {
  it('uses forward then reverse order for four players', () => {
    const { state } = newGame({ players: 4 });
    expect(state.turn.setup!.order).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
    const { placements } = runSetupRecorded(state);
    const buildingSeats = placements
      .filter((record) => record.vertex !== undefined)
      .map((record) => record.seat);
    expect(buildingSeats).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
  });

  it('uses forward then reverse order for three players', () => {
    const { state } = newGame({ players: 3 });
    expect(state.turn.setup!.order).toEqual([0, 1, 2, 2, 1, 0]);
    const finished = runSetup(state);
    for (const player of finished.players) {
      expect(finished.board.buildings.filter((b) => b?.player === player.id).length).toBe(2);
      expect(finished.board.roads.filter((r) => r?.player === player.id).length).toBe(2);
    }
  });

  it('starts play with the player who placed first', () => {
    const { state } = newGame({ players: 4 });
    const finished = runSetup(state);
    expect(finished.turn.phase).toBe('preroll');
    expect(finished.turn.seat).toBe(0);
    expect(finished.turn.setup).toBeNull();
  });

  it('enforces the distance rule including coastal vertices', () => {
    const { state } = newGame({ players: 4 });
    const topo = buildTopology(2);
    const first = act(state, 'p1', { type: 'setup.placeBuilding', vertex: 0 }, seededRng(3)).state;
    const afterRoad = act(first, 'p1', {
      type: 'setup.placeRoad',
      edge: topo.vertices[0]!.edges[0]!,
    }, seededRng(3)).state;

    // Every neighbour of the occupied intersection violates the distance rule,
    // whether it is an inland or a coastal intersection.
    for (const neighbour of neighborsOfVertex(topo, 0)) {
      expectRejected(afterRoad, 'p2', { type: 'setup.placeBuilding', vertex: neighbour }, 'E_ILLEGAL_TARGET');
    }
    // The occupied intersection itself is illegal too.
    expectRejected(afterRoad, 'p2', { type: 'setup.placeBuilding', vertex: 0 }, 'E_ILLEGAL_TARGET');
    // A coastal neighbour of the occupied intersection is covered by the loop
    // above only if vertex 0 has one; assert the fixture actually exercises it.
    const coastalNeighbour = neighborsOfVertex(topo, 0).some(
      (vertex) => topo.vertices[vertex]!.hexes.length < 3,
    );
    expect(coastalNeighbour).toBe(true);
  });

  it('rejects a road that does not touch the settlement just placed', () => {
    const { state } = newGame({ players: 4 });
    const topo = buildTopology(2);
    const placed = act(state, 'p1', { type: 'setup.placeBuilding', vertex: 0 }, seededRng(3)).state;
    const far = topo.edges.findIndex(
      (edge) => !edge.vertices.includes(0),
    );
    expectRejected(placed, 'p1', { type: 'setup.placeRoad', edge: far }, 'E_ILLEGAL_TARGET');
  });

  it('grants starting resources only from the second settlement, exactly once', () => {
    const { state } = newGame({ players: 4, mode: 'fixed' });
    const { state: finished, placements } = runSetupRecorded(state);
    const topo = buildTopology(2);
    const layout = buildBaseLayout({ mode: 'fixed', rng: seededRng(1) });

    for (const player of finished.players) {
      const own = placements.filter(
        (record) => record.playerId === player.id && record.vertex !== undefined,
      );
      expect(own.length).toBe(2);
      const expected: Record<string, number> = {};
      for (const hex of topo.vertices[own[1]!.vertex!]!.hexes) {
        const terrain = layout.terrain[hex]!;
        const resource = {
          forest: 'lumber',
          hills: 'brick',
          pasture: 'wool',
          fields: 'grain',
          mountains: 'ore',
        }[terrain as 'forest'];
        if (!resource) continue;
        expected[resource] = (expected[resource] ?? 0) + 1;
      }
      for (const [resource, amount] of Object.entries(expected)) {
        expect(player.resources[resource as 'lumber']).toBe(amount);
      }
      const total = Object.values(player.resources).reduce((a, b) => a + b, 0);
      expect(total).toBe(Object.values(expected).reduce((a, b) => a + b, 0));
    }
  });

  it('never places two buildings on one intersection or edge', () => {
    for (const players of [3, 4]) {
      for (const mode of ['fixed', 'variable'] as const) {
        const { state } = newGame({ players, mode, seed: 4242 });
        const finished = runSetup(state, seededRng(11));
        const vertices = finished.board.buildings
          .map((building, vertex) => (building ? vertex : -1))
          .filter((vertex) => vertex >= 0);
        expect(new Set(vertices).size).toBe(vertices.length);
        const edges = finished.board.roads
          .map((road, edge) => (road ? edge : -1))
          .filter((edge) => edge >= 0);
        expect(new Set(edges).size).toBe(edges.length);
        expect(vertices.length).toBe(players * 2);
        expect(edges.length).toBe(players * 2);
      }
    }
  });

  it('rejects a city upgrade on an empty intersection and returns the settlement piece', () => {
    const { state } = newGame({ players: 4 });
    const finished = runSetup(state);
    const ownVertex = finished.board.buildings.findIndex((b) => b?.player === 'p1');
    const empty = finished.board.buildings.findIndex((b) => b === null);

    // Upgrading an empty intersection is illegal.
    const prepared = JSON.parse(JSON.stringify(finished)) as typeof finished;
    prepared.turn.seat = 0;
    prepared.turn.phase = 'action';
    prepared.players[0]!.resources = { lumber: 0, brick: 0, wool: 0, grain: 2, ore: 3 };
    expectRejected(prepared, 'p1', { type: 'build.city', vertex: empty }, 'E_ILLEGAL_TARGET');

    // Upgrading an own settlement consumes the city and frees the settlement.
    const upgraded = act(prepared, 'p1', { type: 'build.city', vertex: ownVertex }, seededRng(1)).state;
    expect(upgraded.board.buildings[ownVertex]!.city).toBe(true);
    const settlements = upgraded.board.buildings.filter((b) => b?.player === 'p1' && !b.city).length;
    expect(settlements).toBe(1);
  });

  it('rejects setup commands from the wrong seat and after setup ends', () => {
    const { state } = newGame({ players: 4 });
    const outcome = applyCommand(state, 'p2', { type: 'setup.placeBuilding', vertex: 0 }, seededRng(1));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('E_NOT_YOUR_TURN');

    const finished = runSetup(state);
    const after = applyCommand(finished, 'p1', { type: 'setup.placeBuilding', vertex: 40 }, seededRng(1));
    expect(after.ok).toBe(false);
  });
});
