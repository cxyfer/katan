/**
 * 穿越荒漠瀏覽器證據的盤面準備：讀 stdin 的持久化 state（JSON）。
 * - `check`：確認所有已建村落只碰到主島（島編號 1），回報各自碰到的島；
 * - `plan <playerId>`：替指定玩家挑兩個外地的空交叉點，各配一條接到它的己方道路邊：
 *   第一個是沙漠與島 2 之間的交叉點（碰到 {1,2}，獎勵歸島 2），第二個在小島（3–5 之一）。
 * Python 不自己推導拓樸（與 fixtures.mjs、four_islands_fixture.mjs 相同的做法）。
 *
 * Usage: node --experimental-strip-types scripts/seafarers/desert_fixture.mjs check|plan [playerId] < state.json
 */

import { readFileSync } from 'node:fs';
import { getTopology } from '../../packages/rules/src/index.ts';

const mode = process.argv[2];
const playerId = process.argv[3];
const state = JSON.parse(readFileSync(0, 'utf8'));
const topology = getTopology(state.board.layout.topologyId);
const { terrain, islands } = state.board.layout;
const islandsOf = (vertex) => [...new Set(topology.vertices[vertex].hexes.filter((hex) => terrain[hex] !== 'sea').map((hex) => islands[hex]))].sort((a, b) => a - b);
const near = (vertex) => topology.vertices[vertex].edges.flatMap((edge) => topology.edges[edge].vertices).filter((other) => other !== vertex);
const free = (vertex) => !state.board.buildings[vertex] && near(vertex).every((other) => !state.board.buildings[other]);
const roadEdge = (vertex) => topology.vertices[vertex].edges.find((edge) => topology.edges[edge].hexes.every((hex) => terrain[hex] !== 'sea'))
  ?? topology.vertices[vertex].edges.find((edge) => topology.edges[edge].hexes.some((hex) => terrain[hex] !== 'sea'));

if (mode === 'check') {
  const settled = state.board.buildings.flatMap((building, vertex) => (building ? [{ vertex, player: building.player, islands: islandsOf(vertex) }] : []));
  const mainOnly = settled.every((entry) => entry.islands.length === 1 && entry.islands[0] === 1);
  process.stdout.write(JSON.stringify({ mainOnly, settled }));
} else {
  const strip = topology.vertices.findIndex((_info, vertex) => islandsOf(vertex).join() === '1,2' && free(vertex)
    && topology.vertices[vertex].hexes.some((hex) => terrain[hex] === 'desert'));
  const small = topology.vertices.findIndex((_info, vertex) => {
    const list = islandsOf(vertex);
    return list.length === 1 && list[0] >= 3 && free(vertex) && !topology.vertices[vertex].interior;
  });
  if (strip < 0 || small < 0) throw new Error(`no targets: strip ${strip}, small ${small}`);
  const targets = [strip, small].map((vertex) => ({ vertex, edge: roadEdge(vertex), touches: islandsOf(vertex), island: islandsOf(vertex).at(-1) }));
  process.stdout.write(JSON.stringify({ player: playerId, targets }));
}
