/** R-TB-BD: the printed TB25 frame shared by the scenario maps. */

import { describe, expect, it } from 'vitest';
import { getTopology } from '../src/topology-registry.ts';
import '../src/modules/index.ts';

describe('R-TB-BD scenario frame', () => {
  it('BD1: keeps hex-r2 corner and edge indices and puts nine harbours on distinct coastal edges', () => {
    const frame = getTopology('tb-r2');
    const base = getTopology('hex-r2');
    expect(frame.hexes).toEqual(base.hexes);
    expect(frame.vertices).toEqual(base.vertices);
    expect(frame.edges).toEqual(base.edges);
    expect(frame.harborSlots).toHaveLength(9);
    expect(new Set(frame.harborSlots).size).toBe(9);
    for (const edge of frame.harborSlots) expect(frame.edges[edge]!.hexes).toHaveLength(1);
    // No two harbours share an intersection.
    const corners = frame.harborSlots.flatMap((edge) => frame.edges[edge]!.vertices);
    expect(new Set(corners).size).toBe(18);
  });

  it('BD2: interior paths append plaza vertices and path edges after the regular indices and never join the coast', () => {
    const traders = getTopology('tb-traders-r2');
    const frame = getTopology('tb-r2');
    expect(traders.vertices.slice(0, frame.vertices.length).map(({ hexes, x, y }) => ({ hexes, x, y })))
      .toEqual(frame.vertices.map(({ hexes, x, y }) => ({ hexes, x, y })));
    expect(traders.edges.slice(0, frame.edges.length)).toEqual(frame.edges);
    expect(traders.vertices.length).toBe(frame.vertices.length + 3);
    expect(traders.edges.length).toBe(frame.edges.length + 12);
    expect(traders.coastalEdges).toEqual(frame.coastalEdges);
    for (const edge of traders.edges.slice(frame.edges.length)) {
      expect(edge.interior).toBe(true);
      expect(traders.vertices[edge.vertices[1]]!.interior).toBe(true);
    }
  });
});
