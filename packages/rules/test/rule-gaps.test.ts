/** 規則缺口回歸：道路穿越對手建築、道路建設與豐收之年卡死、舊卡被當成剛買。 */

import { describe, expect, it } from 'vitest';
import { actionHints, legalRoadEdges } from '../src/engine.ts';
import { projectGame } from '../src/project.ts';
import { getTopology } from '../src/topology-registry.ts';
import type { GameState } from '../src/types.ts';
import {
  act,
  expectRejected,
  handSize,
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

/** 清空盤面；回傳一個只有兩條邊的外圍路口 v、邊 e1/e2 及 e1 的另一端 w。 */
function corner(state: GameState) {
  state.board.buildings = state.board.buildings.map(() => null);
  state.board.roads = state.board.roads.map(() => null);
  const topo = getTopology(state.board.layout.topologyId);
  const v = topo.vertices.findIndex((vertex) => vertex.edges.length === 2);
  const [e1, e2] = topo.vertices[v]!.edges as [number, number];
  const w = topo.edges[e1]!.vertices.find((vertex) => vertex !== v)!;
  return { topo, v, e1, e2, w };
}

const placedBy = (events: GameState['log'], type: string) =>
  events.find((event) => event.type === type)?.params.placed;

describe('Road Building grant at play time (B25, CN3081 p.9: "build 2 roads at no cost")', () => {
  it('grants two roads when one legal edge exists and the first opens another', () => {
    // 起始：p1 只有外圍路口 v 的聚落；v 的另一條邊 e2 被 p2 的道路占用，
    // 打出時唯一合法邊是 e1，放下後 w 端才出現新的合法邊。
    const { state } = playableGame({ players: 4 });
    const { v, e1, e2 } = corner(state);
    placeBuilding(state, 'p1', v);
    placeRoad(state, 'p2', e2);
    state.players[0]!.devCards = ['roadBuilding'];
    setHand(state, 'p1', {});
    expect(legalRoadEdges(state, 'p1')).toEqual([e1]);

    const played = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    expect(played.pending).toEqual({ kind: 'freeRoads', actor: 'p1', remaining: 2, granted: 2 });
    const first = act(played, 'p1', { type: 'build.road', edge: e1 });
    expect(first.state.pending).toEqual({ kind: 'freeRoads', actor: 'p1', remaining: 1, granted: 2 });
    const second = legalRoadEdges(first.state, 'p1')[0]!;
    const done = act(first.state, 'p1', { type: 'build.road', edge: second });
    expect(done.state.pending).toBeNull();
    expect(placedBy(done.events, 'dev.roadBuildingFinished')).toBe(2);
    expect(handSize(done.state, 'p1')).toBe(0);
  });

  it('keeps the old single-road grant for a game stored under an earlier version', () => {
    const { state } = playableGame({ players: 4 });
    const { v, e2 } = corner(state);
    placeBuilding(state, 'p1', v);
    placeRoad(state, 'p2', e2);
    state.engineVersion = 'base-2025.3';
    state.players[0]!.devCards = ['roadBuilding'];
    const played = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    expect(played.pending).toEqual({ kind: 'freeRoads', actor: 'p1', remaining: 1, granted: 1 });
  });

  it('grants nothing, and still consumes the card, when no legal edge exists', () => {
    // 起始：v 的兩條邊都被 p2 的道路占用，p1 沒有任何合法邊。
    const { state } = playableGame({ players: 4 });
    const { v, e1, e2 } = corner(state);
    placeBuilding(state, 'p1', v);
    placeRoad(state, 'p2', e1);
    placeRoad(state, 'p2', e2);
    state.players[0]!.devCards = ['roadBuilding'];
    expect(legalRoadEdges(state, 'p1')).toEqual([]);

    const played = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    expect(played.pending).toBeNull();
    expect(played.players[0]!.devCards).not.toContain('roadBuilding');
    expect(played.turn.devCardPlayed).toBe(true);
    expect(actionHints(played, 'p1').canEndTurn).toBe(true);
  });

  it('ends early with placed 1 when the first road leaves no legal edge', () => {
    // 起始：e1 是唯一合法邊；e2 被 p2 道路占用，w 端有 p2 聚落，放下 e1 後無處可延伸。
    const { state } = playableGame({ players: 4 });
    const { v, e1, e2, w } = corner(state);
    placeBuilding(state, 'p1', v);
    placeRoad(state, 'p2', e2);
    placeBuilding(state, 'p2', w);
    state.players[0]!.devCards = ['roadBuilding'];
    expect(legalRoadEdges(state, 'p1')).toEqual([e1]);

    const played = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    expect(played.pending).toEqual({ kind: 'freeRoads', actor: 'p1', remaining: 2, granted: 2 });
    const { state: after, events } = act(played, 'p1', { type: 'build.road', edge: e1 });
    expect(after.pending).toBeNull();
    expect(placedBy(events, 'dev.roadBuildingFinished')).toBe(1);
    expect(actionHints(after, 'p1').canEndTurn).toBe(true);
  });

  it('with one road piece left grants one road even if it opens more edges', () => {
    // 起始：p1 已有 14 條道路，打出時有多條合法邊，只剩 1 個棋子。
    const { state } = playableGame({ players: 4 });
    let placed = state.board.roads.filter((road) => road?.player === 'p1').length;
    for (let edge = 0; edge < state.board.roads.length && placed < 14; edge++) {
      if (state.board.roads[edge] || legalRoadEdges(state, 'p1').includes(edge)) continue;
      placeRoad(state, 'p1', edge);
      placed += 1;
    }
    expect(placed).toBe(14);
    state.players[0]!.devCards = ['roadBuilding'];
    const played = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    expect(played.pending).toEqual({ kind: 'freeRoads', actor: 'p1', remaining: 1, granted: 1 });
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

describe('legacy snapshots with unfinished development-card effects', () => {
  function roadSnapshot(roads: number, remaining: number): GameState {
    const { state } = playableGame({ players: 4 });
    state.engineVersion = 'base-2025.2';
    let placed = state.board.roads.filter((road) => road?.player === 'p1').length;
    for (let edge = 0; edge < state.board.roads.length && placed < roads; edge++) {
      if (state.board.roads[edge] || legalRoadEdges(state, 'p1').includes(edge)) continue;
      placeRoad(state, 'p1', edge);
      placed += 1;
    }
    expect(placed).toBe(roads);
    expect(legalRoadEdges(state, 'p1').length).toBeGreaterThan(0);
    state.pending = { kind: 'freeRoads', actor: 'p1', remaining };
    return JSON.parse(JSON.stringify(state)) as GameState;
  }

  it('caps an old free-road effect to its last piece in views and execution', () => {
    const state = roadSnapshot(14, 2);
    const before = JSON.stringify(state);
    expect(projectGame(state, 'p1').pending).toEqual({ kind: 'freeRoads', actor: 'p1', remaining: 1 });
    const edge = actionHints(state, 'p1').legalRoads[0]!;
    const built = act(state, 'p1', { type: 'build.road', edge });
    expect(built.state.pending).toBeNull();
    expect(built.events.find((event) => event.type === 'dev.roadBuildingFinished')?.params.placed).toBe(1);
    expect(actionHints(built.state, 'p1').canEndTurn).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('clears an old free-road effect already stranded with no pieces', () => {
    const state = roadSnapshot(15, 1);
    const before = JSON.stringify(state);
    expect(projectGame(state, 'p1').pending).toBeNull();
    expect(actionHints(state, 'p1').pendingKind).toBeNull();
    expect(actionHints(state, 'p1').canEndTurn).toBe(true);
    const ended = act(state, 'p1', { type: 'turn.end' });
    expect(ended.state.pending).toBeNull();
    expect(ended.events.find((event) => event.type === 'dev.roadBuildingFinished')?.params.placed).toBe(1);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('keeps the already-placed count when an old grant is capped', () => {
    const state = roadSnapshot(14, 1);
    const built = act(state, 'p1', { type: 'build.road', edge: actionHints(state, 'p1').legalRoads[0]! });
    expect(built.state.pending).toBeNull();
    expect(built.events.find((event) => event.type === 'dev.roadBuildingFinished')?.params.placed).toBe(2);
  });

  for (const cards of [0, 1]) {
    it(`recovers an old Year of Plenty effect with ${cards} bank cards`, () => {
      const { state } = playableGame({ players: 4 });
      state.engineVersion = 'base-2025.2';
      state.bank = { lumber: cards, brick: 0, wool: 0, grain: 0, ore: 0 };
      state.pending = { kind: 'yearOfPlenty', actor: 'p1', remaining: 2 };
      const restored = JSON.parse(JSON.stringify(state)) as GameState;
      const before = JSON.stringify(restored);
      const view = projectGame(restored, 'p1');
      if (cards > 0) {
        expect(view.pending).toEqual({ kind: 'yearOfPlenty', actor: 'p1', remaining: 1 });
        const picked = act(restored, 'p1', { type: 'pending.takeResource', resource: 'lumber' }).state;
        expect(picked.pending).toBeNull();
        expect(picked.bank.lumber).toBe(0);
        expect(actionHints(picked, 'p1').canEndTurn).toBe(true);
      } else {
        expect(view.pending).toBeNull();
        expect(actionHints(restored, 'p1').canEndTurn).toBe(true);
        expect(act(restored, 'p1', { type: 'turn.end' }).state.pending).toBeNull();
      }
      expect(JSON.stringify(restored)).toBe(before);
    });
  }

  it('keeps a valid two-pick effect mandatory', () => {
    const { state } = playableGame({ players: 4 });
    state.engineVersion = 'base-2025.2';
    state.pending = { kind: 'yearOfPlenty', actor: 'p1', remaining: 2 };
    expect(projectGame(state, 'p1').pending).toEqual(state.pending);
    expect(actionHints(state, 'p1').canEndTurn).toBe(false);
    expectRejected(state, 'p1', { type: 'turn.end' }, 'E_PENDING_EFFECT');
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
