/**
 * 未知海域瀏覽器證據的盤面準備：讀 stdin 的持久化 state（JSON），Python 不自己推導拓樸
 * （與 fixtures.mjs 相同的做法）。
 *
 * mode `prepare <playerId>`：替玩家挑一個海岸村落，並鋪好兩條接往迷霧的船路，各留
 * 最後一艘船給瀏覽器透過 UI 建造：
 *   - `choice`：最後一艘船碰到**兩個**空格（放置者選一個翻開）；
 *   - `reveal`：最後一艘船只碰到**一個**空格（直接翻開），且與 choice 的候選不重疊。
 * 前面的船全由規則的 `legalShipEdges` 逐艘選出，所以都是合法接續；因為通往「碰兩個空格的邊」
 * 的路徑一定會經過碰一個空格的邊，前綴的船**直接寫入**（test-only），可能碰到尚未翻開的
 * 空格但沒有觸發翻開；證據針對的是最後一艘、由瀏覽器透過 UI 建造的船。
 *
 * mode `finish <playerId>`：挑一個已知陸地上可蓋村落的空交叉點與一條接到它的陸地邊。
 *
 * Usage: node --experimental-strip-types scripts/seafarers/fog_islands_fixture.mjs prepare|finish <playerId> < state.json
 */

import { readFileSync } from 'node:fs';
import { fogHexesAtEdge } from '../../packages/rules/src/modules/seafarers/fog.ts';
import { legalShipEdges } from '../../packages/rules/src/modules/seafarers/ships.ts';
import { getTopology } from '../../packages/rules/src/index.ts';

const [mode, playerId] = process.argv.slice(2);
const state = JSON.parse(readFileSync(0, 'utf8'));
const topology = getTopology(state.board.layout.topologyId);
const { terrain } = state.board.layout;
const isLand = (hex) => terrain[hex] !== 'sea';
const near = (vertex) => topology.vertices[vertex].edges.flatMap((edge) => topology.edges[edge].vertices).filter((other) => other !== vertex);
const fogSet = () => new Set(state.moduleState.seafarers.fog.hexes);
const centre = (hex) => topology.hexes[hex];
const dist = (edge, hex) => Math.hypot(topology.edges[edge].x - centre(hex).x, topology.edges[edge].y - centre(hex).y);

function emptyVertex(vertex) {
  return !state.board.buildings[vertex] && near(vertex).every((other) => !state.board.buildings[other]);
}

if (mode === 'finish') {
  const vertex = topology.vertices.findIndex((info, index) => !info.interior && emptyVertex(index)
    && info.hexes.some(isLand) && info.hexes.every((hex) => !fogSet().has(hex))
    && topology.vertices[index].edges.some((edge) => topology.edges[edge].hexes.some(isLand)));
  if (vertex < 0) throw new Error('no free land vertex');
  const edge = topology.vertices[vertex].edges.find((candidate) => topology.edges[candidate].hexes.some(isLand));
  process.stdout.write(JSON.stringify({ vertex, edge }));
  process.exit(0);
}

/**
 * 沿規則的合法船位逐艘延伸（先試碰空格少的邊、深度優先、最多 3 艘），直到某個合法邊符合
 * `wanted`；回傳前綴（已寫進 state）與最後一艘。找不到回 null 並還原。
 */
function route(wanted, depth = 3) {
  const legal = legalShipEdges(state, playerId);
  const final = legal.find((edge) => wanted(fogHexesAtEdge(state, edge)));
  if (final !== undefined) return { prefix: [], final };
  if (depth === 0) return null;
  const order = legal.slice().sort((a, b) => fogHexesAtEdge(state, a).length - fogHexesAtEdge(state, b).length);
  for (const edge of order) {
    state.board.roads[edge] = { player: playerId, ship: true };
    const rest = route(wanted, depth - 1);
    if (rest) return { prefix: [edge, ...rest.prefix], final: rest.final };
    state.board.roads[edge] = null;
  }
  return null;
}

const original = JSON.stringify(state.board.roads);
const fog = [...fogSet()];
let best = null;
// 備選的海岸交叉點（碰陸又碰非空格的海、周圍沒有建築）：選兩條路徑最短的那個。
const coast = topology.vertices.map((info, index) => index).filter((index) => {
  const info = topology.vertices[index];
  return !info.interior && emptyVertex(index) && info.hexes.some(isLand)
    && info.hexes.some((hex) => !isLand(hex) && !fogSet().has(hex));
});
// 先用玩家現有的起始村落（vertex = null），不行才補一個海岸村落。
for (const vertex of [null, ...coast]) {
  state.board.roads = JSON.parse(original);
  if (vertex !== null) state.board.buildings[vertex] = { player: playerId, city: false };
  let plan = null;
  const choice = route((hexes) => hexes.length === 2);
  if (choice) {
    const hexes = fogHexesAtEdge(state, choice.final);
    // 第二個選擇（SVG 用）與單格翻開：候選互不重疊，先翻開哪個都不影響另外兩個。
    const avoid = new Set(hexes);
    const choice2 = route((found) => found.length === 2 && found.every((hex) => !avoid.has(hex)));
    if (choice2) {
      const hexes2 = fogHexesAtEdge(state, choice2.final);
      hexes2.forEach((hex) => avoid.add(hex));
      const reveal = route((found) => found.length === 1 && !avoid.has(found[0]));
      if (reveal) {
        plan = {
          choice: { prefix: choice.prefix, edge: choice.final, hexes },
          choice2: { prefix: choice2.prefix, edge: choice2.final, hexes: hexes2 },
          reveal: { prefix: reveal.prefix, edge: reveal.final, hex: fogHexesAtEdge(state, reveal.final)[0] },
        };
      }
    }
  }
  const cost = plan ? plan.choice.prefix.length + plan.choice2.prefix.length + plan.reveal.prefix.length : Infinity;
  if (plan && (!best || cost < best.cost)) best = { vertex, cost, plan, roads: JSON.parse(JSON.stringify(state.board.roads)) };
  if (vertex !== null) state.board.buildings[vertex] = null;
  if (best && vertex === null) break;
}
if (!best) throw new Error('no ship route to the fog');
process.stdout.write(JSON.stringify({ settlement: best.vertex, ...best.plan }));  // settlement 為 null 表示用現有村落
