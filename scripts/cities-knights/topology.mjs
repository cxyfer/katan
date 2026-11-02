/**
 * Edge endpoints of a board topology for the Cities & Knights capture
 * harness, read from the rules package so Python never re-derives topology.
 *
 * Usage: node --experimental-strip-types scripts/cities-knights/topology.mjs <topologyId>
 */

import { getTopology } from '../../packages/rules/src/index.ts';

const topology = getTopology(process.argv[2]);
process.stdout.write(JSON.stringify({ edges: topology.edges.map((edge) => edge.vertices) }));
