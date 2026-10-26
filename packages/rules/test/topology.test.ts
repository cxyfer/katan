import { describe, expect, it } from 'vitest';
import { buildTopology, hexNeighbors, verticesOfHex } from '../src/topology.ts';
import { spiralOrder, buildBaseLayout, BASE_NUMBER_TOKENS, BASE_TERRAIN_MULTISET } from '../src/layout.ts';
import { seededRng } from '../src/rng.ts';

describe('board topology', () => {
  const topo = buildTopology(2);

  it('matches the physical base board counts', () => {
    expect(topo.hexes.length).toBe(19);
    expect(topo.vertices.length).toBe(54);
    expect(topo.edges.length).toBe(72);
    expect(topo.coastalEdges.length).toBe(30);
    expect(topo.harborSlots.length).toBe(9);
  });

  it('classifies intersections by how many hexes meet there', () => {
    const byHexes = topo.vertices.reduce<Record<number, number>>((acc, vertex) => {
      acc[vertex.hexes.length] = (acc[vertex.hexes.length] ?? 0) + 1;
      return acc;
    }, {});
    // 24 inland intersections, 12 two-hex, 18 single-hex coastline tips.
    expect(byHexes).toEqual({ 1: 18, 2: 12, 3: 24 });

    const byEdges = topo.vertices.reduce<Record<number, number>>((acc, vertex) => {
      acc[vertex.edges.length] = (acc[vertex.edges.length] ?? 0) + 1;
      return acc;
    }, {});
    expect(byEdges).toEqual({ 2: 18, 3: 36 });

    // Boundary cycle: 30 coastal edges join the 30 non-inland vertices.
    const boundaryVertices = topo.vertices.filter((vertex) => vertex.hexes.length < 3).length;
    expect(boundaryVertices).toBe(topo.coastalEdges.length);
    expect(2 * topo.edges.length).toBe(
      topo.vertices.reduce((sum, vertex) => sum + vertex.edges.length, 0),
    );
  });

  it('shares every edge between one or two hexes and two vertices', () => {
    for (const edge of topo.edges) {
      expect([1, 2]).toContain(edge.hexes.length);
      expect(edge.vertices.length).toBe(2);
      for (const vertex of edge.vertices) {
        expect(topo.vertices[vertex]!.edges).toContain(topo.edges.indexOf(edge));
      }
    }
  });

  it('is deterministic across rebuilds', () => {
    const again = buildTopology(2);
    expect(again.vertices.map((v) => [v.x, v.y])).toEqual(topo.vertices.map((v) => [v.x, v.y]));
    expect(again.edges.map((e) => e.vertices)).toEqual(topo.edges.map((e) => e.vertices));
  });

  it('reports hex adjacency consistently', () => {
    const centre = topo.hexes.findIndex((hex) => hex.q === 0 && hex.r === 0);
    const neighbours = hexNeighbors(topo, centre);
    expect(neighbours.length).toBe(6);
    for (const neighbour of neighbours) {
      expect(hexNeighbors(topo, neighbour)).toContain(centre);
    }
    const corner = topo.hexes.findIndex((hex) => hex.q === -2 && hex.r === 0);
    expect(hexNeighbors(topo, corner).length).toBe(3);
  });

  it('assigns six vertices to every hex', () => {
    for (let hex = 0; hex < topo.hexes.length; hex++) {
      expect(verticesOfHex(topo, hex).length).toBe(6);
    }
  });
});

describe('base layout', () => {
  it('transcribes the fixed board with the official inventory', () => {
    const layout = buildBaseLayout({ mode: 'fixed', rng: seededRng(1) });
    const terrainCounts = layout.terrain.reduce<Record<string, number>>((acc, terrain) => {
      acc[terrain] = (acc[terrain] ?? 0) + 1;
      return acc;
    }, {});
    expect(terrainCounts).toEqual({
      forest: 4,
      pasture: 4,
      fields: 4,
      hills: 3,
      mountains: 3,
      desert: 1,
    });
    const numbers = layout.numbers.filter((value): value is number => value !== null).sort((a, b) => a - b);
    expect(numbers).toEqual([...BASE_NUMBER_TOKENS].sort((a, b) => a - b));
    expect(layout.terrain[layout.robber]).toBe('desert');
    expect(layout.harbors.length).toBe(9);
    expect(layout.harbors.filter((harbor) => harbor.type === 'generic').length).toBe(4);
    for (const resource of ['lumber', 'brick', 'wool', 'grain', 'ore']) {
      expect(layout.harbors.filter((harbor) => harbor.type === resource).length).toBe(1);
    }
  });

  it('places variable terrain/number tokens from the shuffled multisets', () => {
    const layout = buildBaseLayout({ mode: 'variable', rng: seededRng(99) });
    expect([...layout.terrain].sort()).toEqual([...BASE_TERRAIN_MULTISET].sort());
    const numbers = layout.numbers.filter((value): value is number => value !== null).sort((a, b) => a - b);
    expect(numbers).toEqual([...BASE_NUMBER_TOKENS].sort((a, b) => a - b));
    // Every non-desert hex receives exactly one token.
    layout.terrain.forEach((terrain, hex) => {
      if (terrain === 'desert') expect(layout.numbers[hex]).toBeNull();
      else expect(layout.numbers[hex]).not.toBeNull();
    });
  });

  it('spirals outward-in starting at a corner', () => {
    const topo = buildTopology(2);
    const order = spiralOrder(topo);
    expect(order.length).toBe(19);
    expect(new Set(order).size).toBe(19);
    const rings = order.map((hex) => {
      const coord = topo.hexes[hex]!;
      return Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(coord.q + coord.r));
    });
    // Outer ring first, centre last.
    expect(rings[0]).toBe(2);
    expect(rings[rings.length - 1]).toBe(0);
  });
});
