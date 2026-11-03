/** C&K 尚不開放 bot 座位；共用 freeRoads 的選路器仍須能逐步完成效果。 */
import { describe, expect, it } from 'vitest';
import { getTopology, type GameState } from '@catan/rules';
import { actCk, emptyCkGame, handCards, playCard } from '../../rules/test/ck-helpers.ts';
import { fallbackPolicy } from '../src/fallback.ts';
import { heuristicPolicy } from '../src/heuristic.ts';
import { viewFor } from './harness.ts';

describe('C&K Road Building pending road selection', () => {
  it.each([
    ['fallback', fallbackPolicy],
    ['standard', heuristicPolicy('standard')],
    ['easy', heuristicPolicy('easy')],
  ] as const)('%s follows the new legal sites after restoring the first placement', (_name, policy) => {
    let state = emptyCkGame(4);
    const topo = getTopology(state.board.layout.topologyId);
    const v = topo.vertices.findIndex((vertex) => vertex.edges.length === 2);
    const [firstEdge, blockedEdge] = topo.vertices[v]!.edges as [number, number];
    state.board.buildings[v] = { player: 'p1', city: false };
    state.board.roads[blockedEdge] = { player: 'p2', ship: false };
    handCards(state, 'p1', ['roadBuilding']);
    state = playCard(state, 'p1', 'roadBuilding').state;
    const ctx = { selfId: 'p1', level: 'standard' as const, seed: 1, offerPhases: {} };
    const first = policy.decide(viewFor(state, 'p1'), ctx);
    expect(first).toEqual({ type: 'build.road', edge: firstEdge });
    state = actCk(state, 'p1', first!).state;
    state = JSON.parse(JSON.stringify(state)) as GameState;
    expect(state.pending).toMatchObject({ kind: 'freeRoads', remaining: 1 });
    const view = viewFor(state, 'p1');
    const second = policy.decide(view, ctx);
    expect(second?.type).toBe('build.road');
    if (second?.type !== 'build.road') throw new Error('missing second road');
    expect(view.hints!.legalRoads).toContain(second.edge);
    expect(second.edge).not.toBe(firstEdge);
    state = actCk(state, 'p1', second).state;
    expect(state.pending).toBeNull();
    expect(viewFor(state, 'p1').hints!.canEndTurn).toBe(true);
  });
});
