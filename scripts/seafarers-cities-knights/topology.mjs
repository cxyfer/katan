/**
 * Topology of a board for the Seafarers + Cities & Knights capture harness:
 * edge endpoints, edge hexes and intersection hexes, read from the rules
 * package so Python never re-derives topology.
 *
 * Usage: node --experimental-strip-types scripts/seafarers-cities-knights/topology.mjs <topologyId>
 */

import { getTopology } from '../../packages/rules/src/index.ts';

const topology = getTopology(process.argv[2]);
process.stdout.write(JSON.stringify({
  edges: topology.edges.map((edge) => ({ vertices: edge.vertices, hexes: edge.hexes })),
  vertices: topology.vertices.map((vertex) => ({ hexes: vertex.hexes, edges: vertex.edges })),
}));
