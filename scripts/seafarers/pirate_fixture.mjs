/**
 * 海盜巢穴瀏覽器證據的盤面準備：讀 stdin 的持久化 state（JSON），印出 `{ state, info }`。
 * 所有準備都用規則引擎自己的指令與提示（`applyCommand`、`actionHints`），Python 不自己推導拓樸或船線：
 * - `check`：起始村落都在東島（島 1）、各玩家的村落數與預置的堡壘／beachhead／船線；
 * - `line <player> <count|done>`：用引擎的 `build.ship` 把該玩家的船線再延伸 count 艘（或到堡壘），回傳新的狀態與新建的邊；
 * - `wall <player>`：用別人的船把該玩家船線的端點圍死（端點旁的空邊全被占住），回傳 `last`（末端船）與可退回的落點；
 * - `ring <player>`：在海盜前方六個航道格旁各放一座該玩家的村落（讓任何骰值都會攻擊他），回傳放的頂點。
 *
 * Usage: node --experimental-strip-types scripts/seafarers/pirate_fixture.mjs <mode> [args] < state.json
 */

import { readFileSync } from 'node:fs';
import { actionHints, applyCommand, getTopology, projectGame, seededRng } from '../../packages/rules/src/index.ts';

const [mode, playerId, arg] = process.argv.slice(2);
let state = JSON.parse(readFileSync(0, 'utf8'));
const topology = getTopology('sf-pirate-islands');
const rng = seededRng(7);
const slotOf = (s) => s.moduleState.seafarers.pirateIslands;
const view = (s, id) => projectGame(s, id, {}).modules.seafarers.pirateIslands;
const lineOf = (s, id) => view(s, id).lines[id];

/** 引擎的合法船位中，真的延伸了船線的第一個（準備時讓該玩家在自己的行動階段、海盜不擋路）。 */
function extend(s, id) {
  s.turn.seat = s.players.findIndex((p) => p.id === id);
  s.turn.phase = 'action';
  s.turn.setup = null;
  s.turn.devCardPlayed = false;
  s.pending = null;
  const player = s.players.find((p) => p.id === id);
  player.resources = { lumber: 9, brick: 9, wool: 9, grain: 9, ore: 9 };
  const end = lineOf(s, id).end;
  const before = lineOf(s, id).edges.length;
  const { legalShips } = actionHints(s, id).modules.seafarers;
  for (const edge of legalShips) {
    if (end !== null && !topology.edges[edge].vertices.includes(end)) continue;
    const out = applyCommand(s, id, { type: 'build.ship', edge }, rng);
    if (out.ok && lineOf(out.state, id).edges.length === before + 1) return { state: out.state, edge };
  }
  throw new Error('line cannot be extended');
}

const out = { info: {} };
if (mode === 'check') {
  const main = (vertex) => topology.vertices[vertex].hexes.some((hex) => state.board.layout.terrain[hex] !== 'sea' && state.board.layout.islands[hex] === 1);
  const settled = state.board.buildings.flatMap((b, vertex) => (b ? [{ vertex, player: b.player }] : []));
  const fortressVertices = new Set(slotOf(state).fortresses.map((f) => f.vertex));
  const perPlayer = {};
  for (const entry of settled) if (!fortressVertices.has(entry.vertex)) perPlayer[entry.player] = (perPlayer[entry.player] ?? 0) + 1;
  out.info = {
    largeOnly: settled.filter((e) => !fortressVertices.has(e.vertex)).every((e) => main(e.vertex)),
    perPlayer,
    fortresses: slotOf(state).fortresses.length,
    lairs: slotOf(state).fortresses.map((f) => f.lairs),
    lines: Object.fromEntries(Object.entries(slotOf(state).lines).map(([id, line]) => [id, line.edges.length])),
  };
} else if (mode === 'line') {
  const added = [];
  for (let n = 0; arg === 'done' ? lineOf(state, playerId).next !== 'done' : n < Number(arg); n++) {
    const step = extend(state, playerId);
    state = step.state;
    added.push(step.edge);
  }
  out.info = { added, line: lineOf(state, playerId) };
} else if (mode === 'wall') {
  const line = lineOf(state, playerId);
  const others = state.players.map((p) => p.id).filter((id) => id !== playerId);
  const wallers = others.slice(1).concat(others[0]);
  let used = 0;
  for (const edge of topology.vertices[line.end].edges) {
    if (state.board.roads[edge] || !topology.edges[edge].hexes.some((hex) => state.board.layout.terrain[hex] === 'sea')) continue;
    state.board.roads[edge] = { player: wallers[used % wallers.length], ship: true };
    used += 1;
  }
  state.turn.devCardPlayed = false;
  state.moduleState.seafarers.built = [];
  state.moduleState.seafarers.moved = false;
  const hints = actionHints(state, playerId).modules.seafarers;
  if (!hints.pirateLine.stuck || !hints.pirateLine.backtrack) throw new Error(`not boxed in: ${JSON.stringify(hints.pirateLine)}`);
  const last = line.edges[line.edges.length - 1];
  out.info = { walls: used, last, targets: hints.movableShips.find((m) => m.edge === last).targets, stuck: hints.pirateLine.stuck };
} else if (mode === 'ring') {
  const slot = slotOf(state);
  const at = slot.route.indexOf(state.board.pirate);
  const placed = [];
  for (let step = 1; step <= 6; step++) {
    const hex = slot.route[(at + step) % slot.route.length];
    // 航道格的海岸頂點（同時碰到一格陸地），而且旁邊沒有其他建築：村落站在岸上，不浮在海中。
    const land = (h) => state.board.layout.terrain[h] !== 'sea';
    const vertex = topology.vertices.findIndex((v, index) => v.hexes.includes(hex) && v.hexes.some(land) && !state.board.buildings[index]
      && v.edges.every((edge) => topology.edges[edge].vertices.every((other) => other === index || !state.board.buildings[other])));
    if (vertex < 0) throw new Error(`no coastal vertex at route hex ${hex}`);
    state.board.buildings[vertex] = { player: playerId, city: placed.length === 0 };
    placed.push(vertex);
  }
  out.info = { placed, pirate: state.board.pirate };
} else {
  throw new Error(`unknown mode ${mode}`);
}
out.state = state;
process.stdout.write(JSON.stringify(out));
