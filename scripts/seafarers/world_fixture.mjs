/**
 * 新世界瀏覽器證據的盤面準備：讀 stdin 的持久化 state（JSON）。
 * - `plan <playerId>`：替指定玩家挑一座「不是 home island」的島，找一個空的交叉點 V（只碰到那座島、
 *   與所有建築都隔一格）與一條通到 V 的陸地邊 E（內部邊，兩側都是陸地）；E 以一條玩家的道路預先放好，
 *   這樣玩家在 V 蓋第一個村落是合法的建造，且觸發非 home island 的 1 分獎勵。
 * Python 不自己推導拓樸（與 tribe_fixture.mjs 相同的做法）。
 *
 * Usage: node --experimental-strip-types scripts/seafarers/world_fixture.mjs plan <playerId> < state.json
 */

import { readFileSync } from 'node:fs';
import { getTopology } from '../../packages/rules/src/index.ts';

const mode = process.argv[2];
const playerId = process.argv[3];
const state = JSON.parse(readFileSync(0, 'utf8'));
const topology = getTopology(state.board.layout.topologyId);
const { terrain, islands } = state.board.layout;
const islandsOf = (vertex) => [...new Set(topology.vertices[vertex].hexes.filter((hex) => terrain[hex] !== 'sea').map((hex) => islands[hex]))];
const isLandEdge = (edge) => topology.edges[edge].hexes.length === 2 && topology.edges[edge].hexes.every((hex) => terrain[hex] !== 'sea');
const neighbours = (vertex) => topology.vertices[vertex].edges.flatMap((edge) => topology.edges[edge].vertices).filter((other) => other !== vertex);

if (mode !== 'plan') throw new Error(`unknown mode ${mode}`);
const home = [...new Set(state.board.buildings.flatMap((building, vertex) => (building && building.player === playerId ? islandsOf(vertex) : [])))];
const spots = [];
topology.vertices.forEach((info, vertex) => {
  const on = islandsOf(vertex);
  if (on.length !== 1 || home.includes(on[0]) || state.board.buildings[vertex]) return;
  if (neighbours(vertex).some((other) => state.board.buildings[other])) return;
  const edge = info.edges.find((candidate) => isLandEdge(candidate) && !state.board.roads[candidate]);
  if (edge !== undefined) spots.push({ vertex, edge, island: on[0] });
});
if (spots.length === 0) throw new Error('no free vertex on a non-home island');
// 優先挑面積大的島（陸地格多），畫面上比較看得到。
const size = (island) => islands.filter((value) => value === island).length;
spots.sort((a, b) => size(b.island) - size(a.island) || a.vertex - b.vertex);
process.stdout.write(JSON.stringify({ player: playerId, home, ...spots[0] }));
