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
  /** `vertex` 一端的空海邊：不是計畫要拿的禮物，不碰海盜、未被使用；優先不是任何禮物的邊。 */
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
  const byKind = (kind) => gifts.filter((entry) => entry.kind === kind);
  const choose = () => {
    for (const port of byKind('port')) for (const devcard of byKind('devcard')) {
      const vps = byKind('vp');
      for (const vp1 of vps) for (const vp2 of vps) {
        if (vp1 === vp2) continue;
        const reserved = new Set([port.edge, devcard.edge, vp1.edge, vp2.edge]);
        const used = new Set();
        const out = {};
        let ok = true;
        for (const [key, gift, anchored] of [['port', port, false], ['devcard', devcard, false], ['vp1', vp1, false], ['vp2', vp2, true]]) {
          const found = attach(gift.edge, reserved, used, anchored);
          if (!found) { ok = false; break; }
          used.add(found.near);
          if (found.anchor !== undefined) used.add(found.anchor);
          out[key] = { gift: gift.edge, kind: gift.kind, harbor: gift.harbor, ...found };
        }
        if (ok) return out;
      }
    }
    throw new Error('no gift combination with free neighbours');
  };
  const near = (vertex) => topology.vertices[vertex].edges.flatMap((edge) => topology.edges[edge].vertices).filter((other) => other !== vertex);
  const coast = topology.vertices.findIndex((info, vertex) => info.edges.length === 3 && islandsOf(vertex).includes(1) && islandsOf(vertex).length === 1
    && info.edges.filter(isSea).length === 2 && !state.board.buildings[vertex] && near(vertex).every((other) => !state.board.buildings[other]));
  if (coast < 0) throw new Error('no free coast vertex on the large island');
  const { port, devcard, vp1, vp2 } = choose();
  const coastEdges = topology.vertices[coast].edges.filter(isSea);
  process.stdout.write(JSON.stringify({ player: playerId, coast, coastEdges, port, devcard, vp1, vp2 }));
}
