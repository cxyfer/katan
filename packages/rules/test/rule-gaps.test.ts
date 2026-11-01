/** 規則缺口回歸：道路穿越對手建築、道路建設與豐收之年卡死、舊卡被當成剛買。 */

import { describe, expect, it } from 'vitest';
import { actionHints, legalRoadEdges } from '../src/engine.ts';
import { getTopology } from '../src/topology-registry.ts';
import type { GameState } from '../src/types.ts';
import {
  act,
  expectRejected,
  placeBuilding,
  placeRoad,
  playableGame,
  setHand,
} from './helpers.ts';

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

describe('Road Building with few road pieces left', () => {
  it('grants only the roads the player still has pieces for', () => {
    const { state } = playableGame({ players: 4 });
    const own = state.board.roads.filter((road) => road?.player === 'p1').length;
    // 用掉道路棋子直到只剩一個（放在不影響合法邊的位置之外也無妨，只計數量）。
    let placed = own;
    for (let edge = 0; edge < state.board.roads.length && placed < 14; edge++) {
      if (state.board.roads[edge]) continue;
      if (legalRoadEdges(state, 'p1').length <= 1) break;
      if (legalRoadEdges(state, 'p1').includes(edge)) continue;
      placeRoad(state, 'p1', edge);
      placed += 1;
    }
    expect(placed).toBe(14);
    expect(legalRoadEdges(state, 'p1').length).toBeGreaterThan(0);
    state.players[0]!.devCards = ['roadBuilding'];

    const played = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    expect(played.pending).toEqual({ kind: 'freeRoads', actor: 'p1', remaining: 1, granted: 1 });
    const edge = legalRoadEdges(played, 'p1')[0]!;
    const { state: after, events } = act(played, 'p1', { type: 'build.road', edge });
    expect(after.pending).toBeNull();
    expect(events.find((event) => event.type === 'dev.roadBuildingFinished')?.params.placed).toBe(1);
  });
});

describe('Year of Plenty with a short bank', () => {
  it('grants only what the bank holds and never stalls', () => {
    const { state } = playableGame({ players: 4 });
    state.bank = { lumber: 1, brick: 0, wool: 0, grain: 0, ore: 0 };
    state.players[0]!.devCards = ['yearOfPlenty'];
    const played = act(state, 'p1', { type: 'dev.playYearOfPlenty' }).state;
    expect(played.pending).toEqual({ kind: 'yearOfPlenty', actor: 'p1', remaining: 1 });
    const taken = act(played, 'p1', { type: 'pending.takeResource', resource: 'lumber' }).state;
    expect(taken.pending).toBeNull();
    expect(taken.turn.phase).toBe('action');
  });

  it('refuses the card while the bank is empty and keeps it', () => {
    const { state } = playableGame({ players: 4 });
    state.bank = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    state.players[0]!.devCards = ['yearOfPlenty'];
    expectRejected(state, 'p1', { type: 'dev.playYearOfPlenty' }, 'E_BANK_EMPTY');
  });
});

describe('playing a card held from an earlier turn', () => {
  for (const card of ['roadBuilding', 'yearOfPlenty', 'monopoly', 'knight'] as const) {
    it(`allows an older ${card} after buying another this turn`, () => {
      const { state } = playableGame({ players: 4 });
      state.players[0]!.devCards = [card];
      state.players[0]!.newDevCards = [card];
      const hex = state.board.robber === 0 ? 1 : 0;
      const command =
        card === 'roadBuilding'
          ? { type: 'dev.playRoadBuilding' as const }
          : card === 'yearOfPlenty'
            ? { type: 'dev.playYearOfPlenty' as const }
            : card === 'monopoly'
              ? { type: 'dev.playMonopoly' as const, resource: 'ore' as const }
              : { type: 'dev.playKnight' as const, hex };
      const played = act(state, 'p1', command).state;
      expect(played.players[0]!.devCards).toEqual([]);
      expect(played.players[0]!.newDevCards).toEqual([card]);
    });

    it(`still refuses a ${card} bought this turn when no older one is held`, () => {
      const { state } = playableGame({ players: 4 });
      state.players[0]!.devCards = [];
      state.players[0]!.newDevCards = [card];
      const command =
        card === 'roadBuilding'
          ? { type: 'dev.playRoadBuilding' as const }
          : card === 'yearOfPlenty'
            ? { type: 'dev.playYearOfPlenty' as const }
            : card === 'monopoly'
              ? { type: 'dev.playMonopoly' as const, resource: 'ore' as const }
              : { type: 'dev.playKnight' as const, hex: state.board.robber === 0 ? 1 : 0 };
      expectRejected(state, 'p1', command, 'E_CARD_JUST_BOUGHT');
    });
  }
});
