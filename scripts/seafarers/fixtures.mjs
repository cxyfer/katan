/**
 * Board indices for the Seafarers capture harness, computed from the rules
 * package so Python never re-derives topology: the 4-player New Shores ring
 * around the sea hex (2,0) east of the main island (see
 * packages/rules/test/seafarers-ships.test.ts for the same geometry).
 *
 * Usage: node --experimental-strip-types scripts/seafarers/fixtures.mjs
 */

import { getTopology, hexCenter, NEIGHBOR_DIRS } from '../../packages/rules/src/index.ts';

const topology = getTopology('sf-new-shores-4');
const near = (a, b) => Math.abs(a - b) < 1e-4;

function corner(q, r, k) {
  const centre = hexCenter({ q, r });
  const angle = ((30 + 60 * k) * Math.PI) / 180;
  const x = centre.x + Math.cos(angle);
  const y = centre.y + Math.sin(angle);
  return topology.vertices.findIndex((vertex) => near(vertex.x, x) && near(vertex.y, y));
}

function side(q, r, s) {
  const dir = NEIGHBOR_DIRS[s];
  const a = hexCenter({ q, r });
  const b = hexCenter({ q: q + dir.q, r: r + dir.r });
  return topology.edges.findIndex((edge) => near(edge.x, (a.x + b.x) / 2) && near(edge.y, (a.y + b.y) / 2));
}

const hex = (q, r) => topology.hexes.findIndex((cell) => cell.q === q && cell.r === r);

process.stdout.write(JSON.stringify({
  topologyId: topology.id,
  // Main-island coast east of (1,0); the gold field (3,0) lies two ship paths away.
  coast: corner(1, 0, 5),
  shipNW: side(2, 0, 2),
  shipNE: side(2, 0, 1),
  branch: side(2, -1, 0),
  goldVertex: corner(2, 0, 5),
  goldHex: hex(3, 0),
  seaHex: hex(2, 0),
  pirateSea: hex(2, -1),
}));
