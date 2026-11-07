import { describe, expect, it } from 'vitest';
import { buildGeometry, BASE_BOARD_COUNTS, distance } from '../src/board/geometry.ts';
import { ambiguousClusters, ambiguousWith, describeEdge, describeVertex } from '../src/board/targets.ts';
import { fixedBoard, TOPOLOGY_ID } from '../src/test/fixtures.ts';
import { getTopology } from '@catan/rules';
import type { Point } from '../src/board/geometry.ts';

const geometry = buildGeometry(TOPOLOGY_ID, 100);
const topology = getTopology(TOPOLOGY_ID);

describe('base board geometry', () => {
  it('matches the fixed base board: 19 hexes, 54 vertices, 72 edges', () => {
    expect(geometry.hexes).toHaveLength(BASE_BOARD_COUNTS.hexes);
    expect(geometry.vertices).toHaveLength(BASE_BOARD_COUNTS.vertices);
    expect(geometry.edges).toHaveLength(BASE_BOARD_COUNTS.edges);
    expect(geometry.topologyId).toBe(TOPOLOGY_ID);
  });

  it('keeps topology identity identical to the engine indices', () => {
    // Every edge must connect two vertices that the engine also considers
    // adjacent, otherwise a click would mean a different target on the server.
    for (const edge of geometry.edges) {
      expect(topology.edges[edge.index]!.vertices).toEqual([edge.a, edge.b]);
    }
  });

  it('projects every point inside the declared viewBox', () => {
    const [minX, minY, width, height] = geometry.viewBox.split(' ').map(Number) as number[];
    for (const vertex of geometry.vertices) {
      expect(vertex.x).toBeGreaterThanOrEqual(minX!);
      expect(vertex.x).toBeLessThanOrEqual(minX! + width!);
      expect(vertex.y).toBeGreaterThanOrEqual(minY!);
      expect(vertex.y).toBeLessThanOrEqual(minY! + height!);
    }
  });

  it('renders the fixed layout terrain, numbers and robber hex', () => {
    const board = fixedBoard();
    expect(board.terrain).toHaveLength(19);
    expect(board.numbers).toHaveLength(19);
    expect(board.terrain.filter((terrain) => terrain === 'desert')).toHaveLength(1);
    expect(board.robber).toBe(board.terrain.indexOf('desert'));
    expect(board.numbers[board.robber]).toBeNull();
    expect(board.harbors.length).toBeGreaterThan(0);
    for (const harbor of board.harbors) {
      expect(topology.edges[harbor.edge]!.hexes).toHaveLength(1);
    }
  });
});

describe('target descriptions', () => {
  const context = {
    locale: 'en' as const,
    topology,
    board: fixedBoard(),
    nameOf: (id: string) => (id === 'p1' ? 'Alex' : id),
  };

  it('names a vertex by its neighbouring tiles’ resources and dice numbers', () => {
    const option = describeVertex(context, 0);
    expect(option.label).toBe('Wool (6), Ore (10), Wool (2)');
    expect(option.detail).toBe('Empty');
  });

  it('names an edge by the tiles on either side', () => {
    const option = describeEdge(context, 0);
    expect(option.label).toBe('Between Wool (6) and Ore (10)');
    expect(option.detail).toBe('Empty');
  });

  it('reports an occupied vertex with its owner and piece type', () => {
    const board = fixedBoard();
    board.buildings[3] = { player: 'p1', city: true };
    const option = describeVertex({ ...context, board }, 3);
    expect(option.detail).toContain('Alex');
    expect(option.detail).toContain('City');
  });
});

describe('ambiguity detection', () => {
  const points = new Map<number, Point>([
    [0, { x: 0, y: 0 }],
    [1, { x: 5, y: 0 }],
    [2, { x: 400, y: 0 }],
  ]);

  it('groups candidates closer than the threshold', () => {
    expect(ambiguousClusters([0, 1, 2], points, 20)).toEqual([[0, 1], [2]]);
  });

  it('returns the cluster for a clicked target only when it is ambiguous', () => {
    expect(ambiguousWith(0, [0, 1, 2], points, 20)).toEqual([0, 1]);
    expect(ambiguousWith(2, [0, 1, 2], points, 20)).toBeNull();
    expect(ambiguousWith(9, [0, 1, 2], points, 20)).toBeNull();
  });

  it('treats adjacent board vertices as unambiguous at normal zoom', () => {
    const map = new Map<number, Point>();
    for (const vertex of geometry.vertices) map.set(vertex.index, { x: vertex.x, y: vertex.y });
    const nearest = geometry.vertices
      .map((vertex) => ({ vertex, d: distance(vertex, geometry.vertices[0]!) }))
      .filter((entry) => entry.d > 0)
      .sort((a, b) => a.d - b.d)[0]!;
    expect(ambiguousWith(0, [0, nearest.vertex.index], map, 30)).toBeNull();
    expect(ambiguousWith(0, [0, nearest.vertex.index], map, 400)).toEqual([
      0,
      nearest.vertex.index,
    ]);
  });
});
