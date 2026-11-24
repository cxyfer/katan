/**
 * 布匹產地瀏覽器證據的盤面準備：讀 stdin 的持久化 state（JSON）。
 * - `check`：確認所有已建村落都在兩座大島（島 1、6），沒有碰到小島，並回傳各玩家的村落數；
 * - `plan <playerId> <otherId>`：替指定玩家挑兩個大島海岸的空交叉點，各有一條空海邊直接碰到部落頂點
 *   （兩個不同的部落），並替另一位玩家挑一個海盜可去的海格與該格的一條空海邊（放它的船）。
 *   所有位置避開既有建築與其鄰點。Python 不自己推導拓樸（與 tribe_fixture.mjs 相同的做法）。
 *
 * Usage: node --experimental-strip-types scripts/seafarers/cloth_fixture.mjs check|plan [playerId] [otherId] < state.json
 */

import { readFileSync } from 'node:fs';
import { getTopology } from '../../packages/rules/src/index.ts';

const mode = process.argv[2];
const playerId = process.argv[3];
const otherId = process.argv[4];
const state = JSON.parse(readFileSync(0, 'utf8'));
const topology = getTopology(state.board.layout.topologyId);
const { terrain, islands } = state.board.layout;
const cloth = state.moduleState.seafarers.cloth;
const tribeAt = new Map(cloth.tribes.map((tribe, index) => [tribe.vertex, index]));
const islandsOf = (vertex) => [...new Set(topology.vertices[vertex].hexes.filter((hex) => terrain[hex] !== 'sea').map((hex) => islands[hex]))];
const isSea = (edge) => topology.edges[edge].hexes.length === 1 || topology.edges[edge].hexes.some((hex) => terrain[hex] === 'sea');
const neighbours = (vertex) => topology.vertices[vertex].edges.flatMap((edge) => topology.edges[edge].vertices).filter((other) => other !== vertex);
const freeVertex = (vertex, taken) => !state.board.buildings[vertex] && !taken.has(vertex) && neighbours(vertex).every((other) => !state.board.buildings[other] && !taken.has(other));

if (mode === 'check') {
  const settled = state.board.buildings.flatMap((building, vertex) => (building ? [{ vertex, player: building.player, islands: islandsOf(vertex) }] : []));
  const perPlayer = {};
  for (const entry of settled) perPlayer[entry.player] = (perPlayer[entry.player] ?? 0) + 1;
  process.stdout.write(JSON.stringify({ largeOnly: settled.every((entry) => entry.islands.every((island) => island === 1 || island === 6)), perPlayer, settled }));
} else {
  const taken = new Set();
  const routes = [];
  for (const [vertex, info] of topology.vertices.entries()) {
    if (routes.length === 2) break;
    if (tribeAt.has(vertex) || !freeVertex(vertex, taken) || islandsOf(vertex).length === 0) continue;
    if (!islandsOf(vertex).every((island) => island === 1 || island === 6)) continue;
    for (const edge of info.edges) {
      const other = topology.edges[edge].vertices.find((candidate) => candidate !== vertex);
      if (!isSea(edge) || state.board.roads[edge] || !tribeAt.has(other)) continue;
      const tribe = tribeAt.get(other);
      if (routes.some((route) => route.tribe === tribe)) continue;
      routes.push({ start: vertex, edge, tribe, number: cloth.tribes[tribe].number });
      taken.add(vertex);
      for (const near of neighbours(vertex)) taken.add(near);
      break;
    }
  }
  if (routes.length < 2) throw new Error('no two free coast vertices with a one-ship route to a tribe');
  // 海盜的目標：離部落路徑夠遠的海格，旁邊放另一位玩家的船。
  const used = new Set(routes.map((route) => route.edge));
  const hexOk = (hex) => terrain[hex] === 'sea' && hex !== state.board.pirate;
  const scenes = [];
  topology.hexes.forEach((_, hex) => {
    if (scenes.length === 2 || !hexOk(hex)) return;
    const edge = topology.edges.findIndex((info, index) => info.hexes.includes(hex) && info.hexes.length === 2 && isSea(index) && !state.board.roads[index] && !used.has(index)
      && info.vertices.every((vertex) => !tribeAt.has(vertex) && !state.board.buildings[vertex]));
    if (edge < 0) return;
    // 第二個場景的海格不與第一個共用邊，避免第一個海盜的位置影響第二個的船。
    if (scenes.length === 1 && topology.edges[edge].hexes.some((h) => h === scenes[0].hex)) return;
    scenes.push({ hex, edge });
    used.add(edge);
  });
  const pirate = scenes[0] ?? null;
  const pirate2 = scenes[1] ?? null;
  if (!pirate || !pirate2) throw new Error('no two sea hexes for the pirate scenes');
  process.stdout.write(JSON.stringify({ player: playerId, other: otherId, routes, pirate, pirate2 }));
}
