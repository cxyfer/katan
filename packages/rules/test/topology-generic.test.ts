/** Generic topologies built from explicit hex sets (scenario maps). */

import { describe, expect, it } from 'vitest';
import { ARCHIPELAGO_TOPOLOGY, archipelagoLayout } from '../src/sample-boards.ts';
import { getTopology, registerTopologyDefinition } from '../src/topology-registry.ts';
import { buildTopology, buildTopologyFromHexes, hexNeighbors, type HexCoord } from '../src/topology.ts';

function shape(id: string, hexes: readonly HexCoord[], harborSlots = ARCHIPELAGO_TOPOLOGY.harborSlots) {
  const topology = buildTopologyFromHexes({ id, hexes, ...(harborSlots ? { harborSlots } : {}) });
  return { hexes: topology.hexes, vertices: topology.vertices, edges: topology.edges, harborSlots: topology.harborSlots };
}

/** Connected components of the land hexes. */
function islands(topologyId: string, land: (hex: number) => boolean): number[][] {
  const topology = getTopology(topologyId);
  const seen = new Set<number>();
  const out: number[][] = [];
  for (let start = 0; start < topology.hexes.length; start++) {
    if (!land(start) || seen.has(start)) continue;
    const group: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const hex = stack.pop()!;
      group.push(hex);
      for (const next of hexNeighbors(topology, hex)) {
        if (land(next) && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    out.push(group.sort((a, b) => a - b));
  }
  return out;
}

describe('generic topology', () => {
  it('reproduces the generated base board from the same hex set', () => {
    const base = buildTopology(2);
    const explicit = buildTopologyFromHexes({ id: 'hex-r2-explicit', hexes: base.hexes.map(({ q, r }) => ({ q, r })) });
    expect(explicit.vertices).toEqual(base.vertices);
    expect(explicit.edges).toEqual(base.edges);
    expect(explicit.coastalEdges).toEqual(base.coastalEdges);
  });

  it('derives indices from the hex set, not the order it is written in', () => {
    const reversed = ARCHIPELAGO_TOPOLOGY.hexes.slice().reverse();
    const shuffled = ARCHIPELAGO_TOPOLOGY.hexes.filter((_, i) => i % 2).concat(ARCHIPELAGO_TOPOLOGY.hexes.filter((_, i) => !(i % 2)));
    const reference = shape('a', ARCHIPELAGO_TOPOLOGY.hexes);
    expect(shape('a', reversed)).toEqual(reference);
    expect(shape('a', shuffled)).toEqual(reference);
  });

  it('represents a sea frame with several separate islands', () => {
    const topology = getTopology('sample-archipelago');
    expect(topology).toBe(getTopology('sample-archipelago'));
    expect(topology.hexes.length).toBe(61);
    const layout = archipelagoLayout(topology);
    expect(layout.terrain.filter((terrain) => terrain === 'sea').length).toBe(61 - 13);
    expect(layout.terrain.filter((terrain) => terrain === 'gold').length).toBe(2);
    const groups = islands(topology.id, (hex) => layout.terrain[hex] !== 'sea');
    expect(groups.map((group) => group.length).sort((a, b) => b - a)).toEqual([7, 3, 2, 1]);
    // Island ids in the layout agree with the land components.
    for (const group of groups) expect(new Set(group.map((hex) => layout.islands[hex])).size).toBe(1);
    expect(layout.terrain[layout.robber]).toBe('desert');
    expect(layout.terrain[layout.pirate!]).toBe('sea');
  });

  it('puts marked harbour slots on land/sea edges in token order', () => {
    const topology = getTopology('sample-archipelago');
    const layout = archipelagoLayout(topology);
    expect(topology.harborSlots.length).toBe(ARCHIPELAGO_TOPOLOGY.harborSlots!.length);
    for (const [index, edge] of topology.harborSlots.entries()) {
      const info = topology.edges[edge]!;
      const kinds = info.hexes.map((hex) => layout.terrain[hex] === 'sea' ? 'sea' : 'land').sort();
      expect(kinds).toEqual(['land', 'sea']);
      const slot = ARCHIPELAGO_TOPOLOGY.harborSlots![index]!;
      expect(info.hexes.map((hex) => topology.hexes[hex]!)).toContainEqual(expect.objectContaining({ q: slot.q, r: slot.r }));
    }
  });

  it('rejects malformed definitions', () => {
    expect(() => buildTopologyFromHexes({ id: 'x', hexes: [] })).toThrow(/no hexes/);
    expect(() => buildTopologyFromHexes({ id: 'x', hexes: [{ q: 0, r: 0 }, { q: 0, r: 0 }] })).toThrow(/duplicate/);
    expect(() => buildTopologyFromHexes({ id: 'x', hexes: [{ q: 0.5, r: 0 }] })).toThrow(/non-integer/);
    expect(() => buildTopologyFromHexes({ id: 'x', hexes: [{ q: 0, r: 0 }], harborSlots: [{ q: 1, r: 0, side: 0 }] }))
      .toThrow(/bad harbour slot/);
    expect(() => registerTopologyDefinition({ id: 'hex-r2', hexes: [{ q: 0, r: 0 }] })).toThrow(/already registered/);
    expect(() => registerTopologyDefinition({ id: 'sample-archipelago', hexes: [{ q: 0, r: 0 }] })).toThrow(/already registered/);
  });

  it('registers explicit maps under stable ids', () => {
    const definition = { id: 'fixture-two-islands', hexes: [{ q: 0, r: 0 }, { q: 2, r: 0 }], harborSlots: [{ q: 0, r: 0, side: 0 }] };
    registerTopologyDefinition(definition);
    registerTopologyDefinition(definition);
    const topology = getTopology('fixture-two-islands');
    expect(topology.hexes.length).toBe(2);
    expect(topology.vertices.length).toBe(12);
    expect(topology.edges.length).toBe(12);
    expect(topology.harborSlots.length).toBe(1);
  });
});
