/** 規則缺口回歸：道路穿越對手建築、道路建設與豐收之年卡死、舊卡被當成剛買。 */

import { describe, expect, it } from 'vitest';
import { actionHints, legalRoadEdges } from '../src/engine.ts';
import { getTopology } from '../src/topology-registry.ts';
import type { GameState } from '../src/types.ts';
import { act, expectRejected, placeBuilding, placeRoad, playableGame, setHand } from './helpers.ts';

/** 清空盤面，回傳一個有三條邊的內部路口 B 與它的三個鄰點。 */
function junction(state: GameState) {
  state.board.buildings = state.board.buildings.map(() => null);
  state.board.roads = state.board.roads.map(() => null);
  const topo = getTopology(state.board.layout.topologyId);
  const b = topo.vertices.findIndex((vertex) => vertex.edges.length === 3);
  const [eA, eC, eX] = topo.vertices[b]!.edges as [number, number, number];
  const other = (edge: number) => topo.edges[edge]!.vertices.find((vertex) => vertex !== b)!;
  return { topo, b, eA, eC, eX, a: other(eA), c: other(eC) };
}

describe('road connectivity at an opponent building', () => {
  it('does not let a road pass through an opponent settlement', () => {
    const { state } = playableGame({ players: 4 });
    const { b, eA, eC, eX, a } = junction(state);
    placeBuilding(state, 'p1', a);
    placeRoad(state, 'p1', eA);
    placeBuilding(state, 'p2', b);
    setHand(state, 'p1', { lumber: 2, brick: 2 });

    const legal = legalRoadEdges(state, 'p1');
    expect(legal).not.toContain(eC);
    expect(legal).not.toContain(eX);
    expect(actionHints(state, 'p1').legalRoads).not.toContain(eC);
    expectRejected(state, 'p1', { type: 'build.road', edge: eC }, 'E_ILLEGAL_TARGET');
  });

  it('lets a road continue from its own side of a cut', () => {
    const { state } = playableGame({ players: 4 });
    const { b, eA, eC, a, c, topo } = junction(state);
    // p1 的道路 A–B 在 A 端被對手聚落切斷；B 端仍屬於 p1 的道路網。
    placeBuilding(state, 'p2', a);
    placeRoad(state, 'p1', eA);
    const home = topo.vertices.findIndex(
      (vertex, index) => index !== a && index !== b && index !== c && vertex.edges.length > 0,
    );
    placeBuilding(state, 'p1', home);
    setHand(state, 'p1', { lumber: 1, brick: 1 });

    expect(legalRoadEdges(state, 'p1')).toContain(eC);
    const built = act(state, 'p1', { type: 'build.road', edge: eC }).state;
    expect(built.board.roads[eC]).toEqual({ player: 'p1', ship: false });
  });

  it('applies the same cut to free roads from Road Building', () => {
    const { state } = playableGame({ players: 4 });
    const { b, eA, eC, a } = junction(state);
    placeBuilding(state, 'p1', a);
    placeRoad(state, 'p1', eA);
    placeBuilding(state, 'p2', b);
    state.players[0]!.devCards = ['roadBuilding'];
    const played = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    if (played.pending) expectRejected(played, 'p1', { type: 'build.road', edge: eC }, 'E_ILLEGAL_TARGET');
    expect(actionHints(played, 'p1').legalRoads).not.toContain(eC);
  });
});
