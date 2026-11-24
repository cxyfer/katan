/**
 * 卡坦奇觀瀏覽器證據的盤面準備：讀 stdin 的持久化 state（JSON）。
 * - `check`：確認所有已建村落都在大島（島 1），沒有在 Great Wall／Great Bridge／X 標記的交叉點，並回傳各玩家的村落數；
 * - `plan`：挑一個 Great Wall 標記的交叉點，周圍沒有任何建築，讓 test-only 夾具能直接放一座村落；
 *   另回傳 Great Bridge 標記的頂點（給別的玩家當作已被拿走的奇觀）。Python 不自己推導拓樸。
 *
 * Usage: node --experimental-strip-types scripts/seafarers/wonders_fixture.mjs check|plan < state.json
 */

import { readFileSync } from 'node:fs';
import { getTopology } from '../../packages/rules/src/index.ts';

const mode = process.argv[2];
const state = JSON.parse(readFileSync(0, 'utf8'));
const topology = getTopology(state.board.layout.topologyId);
const { terrain, islands } = state.board.layout;
const { markers } = state.moduleState.seafarers.wonders;
const forbidden = new Set([...markers.greatWall, ...markers.greatBridge, ...markers.x]);
const islandsOf = (vertex) => [...new Set(topology.vertices[vertex].hexes.filter((hex) => terrain[hex] !== 'sea').map((hex) => islands[hex]))];
const neighbours = (vertex) => topology.vertices[vertex].edges.flatMap((edge) => topology.edges[edge].vertices).filter((other) => other !== vertex);

if (mode === 'check') {
  const settled = state.board.buildings.flatMap((building, vertex) => (building ? [{ vertex, player: building.player, islands: islandsOf(vertex) }] : []));
  const perPlayer = {};
  for (const entry of settled) perPlayer[entry.player] = (perPlayer[entry.player] ?? 0) + 1;
  process.stdout.write(JSON.stringify({
    largeOnly: settled.every((entry) => entry.islands.includes(1)),
    offMarkers: settled.every((entry) => !forbidden.has(entry.vertex)),
    perPlayer,
    settled,
  }));
} else {
  const free = (vertex) => !state.board.buildings[vertex] && neighbours(vertex).every((other) => !state.board.buildings[other]);
  const wall = markers.greatWall.find(free);
  if (wall === undefined) throw new Error('no free Great Wall vertex');
  process.stdout.write(JSON.stringify({ wall, bridge: markers.greatBridge[0], markers }));
}
