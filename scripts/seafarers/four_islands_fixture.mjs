/**
 * 四島群島瀏覽器證據的盤面準備：讀 stdin 的持久化 state（JSON），替指定玩家挑兩座
 * **非 home 島**上各一個可蓋村落的空交叉點，與一條接到它的己方道路邊。
 * Python 不自己推導拓樸（與 fixtures.mjs 相同的做法）。
 *
 * Usage: node --experimental-strip-types scripts/seafarers/four_islands_fixture.mjs <playerId> < state.json
 */

import { readFileSync } from 'node:fs';
import { getTopology } from '../../packages/rules/src/index.ts';

const playerId = process.argv[2];
const state = JSON.parse(readFileSync(0, 'utf8'));
const topology = getTopology(state.board.layout.topologyId);
const { terrain, islands } = state.board.layout;
const home = state.moduleState.seafarers.home[playerId];
const islandOf = (vertex) => [...new Set(topology.vertices[vertex].hexes.filter((hex) => terrain[hex] !== 'sea').map((hex) => islands[hex]))];
const near = (vertex) => topology.vertices[vertex].edges.flatMap((edge) => topology.edges[edge].vertices).filter((other) => other !== vertex);

const targets = [];
for (const island of [...new Set(islands.filter((id) => id > 0))].sort((a, b) => a - b)) {
  if (home.includes(island) || targets.length === 2) continue;
  const vertex = topology.vertices.findIndex((info, index) => !info.interior && !state.board.buildings[index]
    && islandOf(index).length === 1 && islandOf(index)[0] === island && near(index).every((other) => !state.board.buildings[other]));
  if (vertex < 0) continue;
  const edge = topology.vertices[vertex].edges.find((candidate) => topology.edges[candidate].hexes.some((hex) => terrain[hex] !== 'sea'));
  targets.push({ vertex, edge, island });
}
if (targets.length < 2) throw new Error(`need two non-home islands, home ${JSON.stringify(home)}`);
process.stdout.write(JSON.stringify({ home, targets }));
