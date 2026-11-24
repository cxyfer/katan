/**
 * 世外部落瀏覽器證據的盤面準備：讀 stdin 的持久化 state（JSON）。
 * - `check`：確認所有已建村落都碰到大島（島編號 1）；
 * - `plan <playerId>`：替指定玩家挑一個大島海岸的空交叉點（海岸村落）與三組禮物的接應船：
 *   港口（建造）、發展牌（建造）、VP 標記 #1（建造）、VP 標記 #2（移動：一艘可移動的船加一艘錨定的船）。
 *   所有接應船都放在非禮物的海邊，且不碰海盜所在的格。
 * Python 不自己推導拓樸（與 desert_fixture.mjs 相同的做法）。
 *
 * Usage: node --experimental-strip-types scripts/seafarers/tribe_fixture.mjs check|plan [playerId] < state.json
 */

import { readFileSync } from 'node:fs';
import { getTopology } from '../../packages/rules/src/index.ts';

const mode = process.argv[2];
const playerId = process.argv[3];
const state = JSON.parse(readFileSync(0, 'utf8'));
const topology = getTopology(state.board.layout.topologyId);
const { terrain, islands } = state.board.layout;
const gifts = state.moduleState.seafarers.tribe.gifts;
const giftEdges = new Set(gifts.map((gift) => gift.edge));
const islandsOf = (vertex) => [...new Set(topology.vertices[vertex].hexes.filter((hex) => terrain[hex] !== 'sea').map((hex) => islands[hex]))];
const isSea = (edge) => topology.edges[edge].hexes.length === 1 || topology.edges[edge].hexes.some((hex) => terrain[hex] === 'sea');
const touchesPirate = (edge) => state.board.pirate !== null && topology.edges[edge].hexes.includes(state.board.pirate);

if (mode === 'check') {
  const settled = state.board.buildings.flatMap((building, vertex) => (building ? [{ vertex, player: building.player, islands: islandsOf(vertex) }] : []));
  process.stdout.write(JSON.stringify({ largeOnly: settled.every((entry) => entry.islands.includes(1)), settled }));
} else {
  /** `vertex` 一端的空海邊：不是已預定的禮物，不碰海盜、未被使用；優先不是任何禮物的邊。 */
  const neighbour = (gift, vertex, reserved, used) => {
    const free = (edge) => edge !== gift && isSea(edge) && !touchesPirate(edge) && !used.has(edge) && !reserved.has(edge) && !state.board.roads[edge];
    const edges = topology.vertices[vertex].edges;
    return edges.find((edge) => free(edge) && !giftEdges.has(edge)) ?? edges.find(free);
  };
  /** 為一個禮物找接應邊：建造用一艘船；移動用「可移動的船 + 錨定的船」。 */
  const attach = (gift, reserved, used, anchored) => {
    const [u, v] = topology.edges[gift].vertices;
    for (const [shared, other] of [[v, u], [u, v]]) {
      const near = neighbour(gift, shared, reserved, used);
      if (near === undefined) continue;
      if (!anchored) return { near };
      const anchor = neighbour(gift, other, reserved, new Set([...used, near]));
      if (anchor !== undefined) return { near, anchor };
    }
    return null;
  };
  const specs = [['portA', 'port', false], ['portB', 'port', false], ['portC', 'port', false], ['devcard', 'devcard', false], ['vp1', 'vp', false], ['vp2', 'vp', true]];
  /** 回溯：依序挑禮物與接應船；接應船不得壓在任何已選禮物上。 */
  const choose = (index, chosen, used) => {
    if (index === specs.length) {
      const planned = new Set(Object.values(chosen).map((entry) => entry.gift));
      const ships = Object.values(chosen).flatMap((entry) => [entry.near, entry.anchor].filter((edge) => edge !== undefined));
      return ships.some((edge) => planned.has(edge)) ? null : chosen;
    }
    const [key, kind, anchored] = specs[index];
    for (const gift of gifts.filter((entry) => entry.kind === kind && !Object.values(chosen).some((c) => c.gift === entry.edge))) {
      const reserved = new Set([...Object.values(chosen).map((c) => c.gift), gift.edge]);
      const found = attach(gift.edge, reserved, used, anchored);
      if (!found) continue;
      const next = new Set([...used, found.near, ...(found.anchor !== undefined ? [found.anchor] : [])]);
      const out = choose(index + 1, { ...chosen, [key]: { gift: gift.edge, kind, harbor: gift.harbor, ...found } }, next);
      if (out) return out;
    }
    return null;
  };
  const plan = choose(0, {}, new Set());
  if (!plan) throw new Error('no gift combination with free neighbours');
  const near = (vertex) => topology.vertices[vertex].edges.flatMap((edge) => topology.edges[edge].vertices).filter((other) => other !== vertex);
  // 三個海岸村落（大島）：彼此不相鄰，海岸邊的端點互不相同，所以三個港口各有一個合法位置。
  const coasts = [];
  const taken = new Set();
  topology.vertices.forEach((info, vertex) => {
    if (coasts.length >= 3 || info.edges.length !== 3 || islandsOf(vertex).length !== 1 || islandsOf(vertex)[0] !== 1) return;
    const coastEdges = info.edges.filter(isSea);
    if (coastEdges.length !== 2 || state.board.buildings[vertex] || !near(vertex).every((other) => !state.board.buildings[other])) return;
    const points = new Set(coastEdges.flatMap((edge) => topology.edges[edge].vertices));
    if ([...points].some((point) => taken.has(point))) return;
    // 與已有建築的海岸邊也不共用端點（設置村落旁的港口不會擋到這三個）。
    if (state.board.buildings.some((building, other) => building && coastEdges.some((edge) => topology.edges[edge].vertices.includes(other)))) return;
    [...points].forEach((point) => taken.add(point));
    near(vertex).forEach((point) => taken.add(point));
    coasts.push({ vertex, edges: coastEdges });
  });
  if (coasts.length < 3) throw new Error('no three free coast vertices on the large island');
  const { portA, portB, portC, devcard, vp1, vp2 } = plan;
  process.stdout.write(JSON.stringify({ player: playerId, coasts, portA, portB, portC, devcard, vp1, vp2 }));
}
