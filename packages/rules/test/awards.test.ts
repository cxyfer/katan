/** R-B06: Longest Road and Largest Army awards. */

import { describe, expect, it } from 'vitest';
import { recomputeAwards, scoreOf, topologyOf } from '../src/analysis.ts';
import type { BoardTopology } from '../src/topology.ts';
import {
  centreHex,
  hexLoopEdges,
  newGame,
  placeBuilding,
  placePath,
  placeStar,
  playableGame,
} from './helpers.ts';
import type { GameState } from '../src/types.ts';

/** Removes every piece so a fixture starts from an empty board. */
function resetBoard(state: GameState): void {
  state.board.buildings = state.board.buildings.map(() => null);
  state.board.roads = state.board.roads.map(() => null);
  state.awards = { longestRoad: null, largestArmy: null };
  for (const player of state.players) player.longestRoadLength = 0;
}

function vertexBetween(topo: BoardTopology, first: number, second: number): number {
  const shared = topo.edges[first]!.vertices.find((vertex) =>
    topo.edges[second]!.vertices.includes(vertex),
  );
  if (shared === undefined) throw new Error('edges are not adjacent');
  return shared;
}

function roadLength(state: GameState, playerId: string): number {
  recomputeAwards(state);
  return state.players.find((player) => player.id === playerId)!.longestRoadLength;
}

describe('R-B06 awards', () => {
  it('requires five connected roads for Longest Road', () => {
    const { state } = playableGame({ players: 4 });
    resetBoard(state);
    placePath(state, 'p1', 4);
    recomputeAwards(state);
    expect(state.players[0]!.longestRoadLength).toBe(4);
    expect(state.awards.longestRoad).toBeNull();

    const occupied = new Set(
      state.board.roads.map((road, edge) => (road ? edge : -1)).filter((edge) => edge >= 0),
    );
    placePath(state, 'p1', 1, { avoid: occupied, startVertex: topologyOf(state).edges[[...occupied][0]!]!.vertices[0]! });
    const length = roadLength(state, 'p1');
    expect(length).toBeGreaterThanOrEqual(5);
    expect(state.awards.longestRoad).toBe('p1');
  });

  it('sums a branch only along its longest trail', () => {
    const { state } = playableGame({ players: 4 });
    resetBoard(state);
    const edges = placeStar(state, 'p1', 3, 3);
    expect(edges.length).toBe(9);
    expect(roadLength(state, 'p1')).toBe(6);
    expect(state.awards.longestRoad).toBe('p1');
  });

  it('counts a closed loop once, without reusing a road', () => {
    const { state } = playableGame({ players: 4 });
    resetBoard(state);
    const loop = hexLoopEdges(state, centreHex(state));
    expect(loop.length).toBe(6);
    for (const edge of loop) state.board.roads[edge] = { player: 'p1', ship: false };
    expect(roadLength(state, 'p1')).toBe(6);
  });

  it('interrupts a route at an opponent building', () => {
    const { state } = playableGame({ players: 4 });
    resetBoard(state);
    const path = placePath(state, 'p1', 6);
    expect(roadLength(state, 'p1')).toBe(6);

    const topo = topologyOf(state);
    placeBuilding(state, 'p2', vertexBetween(topo, path[2]!, path[3]!), false);
    expect(roadLength(state, 'p1')).toBe(3);
  });

  it('does not interrupt a route at the owner own building', () => {
    const { state } = playableGame({ players: 4 });
    resetBoard(state);
    const path = placePath(state, 'p1', 6);
    const topo = topologyOf(state);
    placeBuilding(state, 'p1', vertexBetween(topo, path[2]!, path[3]!), false);
    expect(roadLength(state, 'p1')).toBe(6);
  });

  it('keeps the award with the incumbent on a tie', () => {
    const { state } = playableGame({ players: 4 });
    resetBoard(state);
    placePath(state, 'p1', 5);
    recomputeAwards(state);
    expect(state.awards.longestRoad).toBe('p1');

    const occupied = new Set(
      state.board.roads.map((road, edge) => (road ? edge : -1)).filter((edge) => edge >= 0),
    );
    placePath(state, 'p2', 5, { avoid: occupied });
    recomputeAwards(state);
    expect(state.players[0]!.longestRoadLength).toBe(5);
    expect(state.players[1]!.longestRoadLength).toBe(5);
    expect(state.awards.longestRoad).toBe('p1');
  });

  it('reassigns the award when the incumbent drops below five', () => {
    const { state } = playableGame({ players: 4 });
    resetBoard(state);
    const path = placePath(state, 'p1', 5);
    recomputeAwards(state);
    expect(state.awards.longestRoad).toBe('p1');

    const occupied = new Set(
      state.board.roads.map((road, edge) => (road ? edge : -1)).filter((edge) => edge >= 0),
    );
    placePath(state, 'p2', 5, { avoid: occupied });
    const topo = topologyOf(state);
    placeBuilding(state, 'p2', vertexBetween(topo, path[1]!, path[2]!), false);
    recomputeAwards(state);
    expect(state.players[0]!.longestRoadLength).toBeLessThan(5);
    expect(state.awards.longestRoad).toBe('p2');
  });

  it('starts Largest Army at three knights and transfers only on exceeding', () => {
    const { state } = playableGame({ players: 4 });
    state.players[0]!.playedKnights = 2;
    recomputeAwards(state);
    expect(state.awards.largestArmy).toBeNull();
    state.players[0]!.playedKnights = 3;
    recomputeAwards(state);
    expect(state.awards.largestArmy).toBe('p1');

    state.players[1]!.playedKnights = 3;
    recomputeAwards(state);
    expect(state.awards.largestArmy).toBe('p1');
    state.players[1]!.playedKnights = 4;
    recomputeAwards(state);
    expect(state.awards.largestArmy).toBe('p2');
  });

  it('adds two points for each held award to the public score', () => {
    const { state } = playableGame({ players: 4 });
    resetBoard(state);
    const before = scoreOf(state, 'p1', { includeHidden: false });
    placePath(state, 'p1', 5);
    state.players[0]!.playedKnights = 3;
    recomputeAwards(state);
    expect(scoreOf(state, 'p1', { includeHidden: false })).toBe(before + 4);
  });

  it('keeps award state empty in a fresh game', () => {
    const { state } = newGame({ players: 4 });
    expect(state.awards).toEqual({ longestRoad: null, largestArmy: null });
    expect(state.players.every((player) => player.longestRoadLength === 0)).toBe(true);
  });
});
