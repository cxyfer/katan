/**
 * The Pirate Islands（S7a、S7b）的隨機合法動作模擬：量測西島船線有沒有「完全無路可走」的情況
 * （spec §6.6、OQ-3）。此時還沒有巡弋海盜與進攻，所以模擬只跑到每位玩家的船線到達堡壘（或回合上限）。
 *
 * 玩家只做隨機的合法動作：蓋船（偏向船線，其餘是任一合法的船）、村落、城市、路；手牌每次動作前補滿，
 * 讓模擬測的是路徑而不是經濟。S7b 起海盜真的沿航道走：每次擲骰（含 7）都由引擎移動與攻擊，
 * 玩家對攻擊後的 frame（選牌、7 的偷牌）作隨機的合法回答，海盜造成的暫時阻擋因此出現在真實的位置。
 */

import { isLandHex, topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, type Command } from '../src/engine.ts';
import { legalShipEdges } from '../src/modules/seafarers/ships.ts';
import { lineBacktrackMovable, lineContext, lineShip, lineVertices, pirateIslandsView, roadAllowed, routeExists } from '../src/modules/seafarers/pirateIslands.ts';
import { seededRng, type Rng } from '../src/rng.ts';
import type { GameState, Resource } from '../src/types.ts';
import { seafarersGame } from './seafarers-helpers.ts';

export const PI_PROFILE = 'sf-pirate-islands-2025';

type AnyCommand = Command | { type: string; [field: string]: unknown };

export interface PirateSimOptions {
  players: 3 | 4;
  seed: number;
  /** 回合上限（每位玩家各算一回合）。 */
  maxTurns?: number;
  /** 每次動作選船線延伸（而不是其他合法動作）的機率。 */
  lineBias?: number;
  /** 除錯：船線無路可走時呼叫。 */
  onUnreachable?: (state: GameState, playerId: string) => void;
}

export interface PirateSimResult {
  state: GameState;
  turns: number;
  /** 到達堡壘（船線完成）的玩家數。 */
  linesDone: number;
  /** 船線有船、下一個目標在空著的海邊上到不了的次數（每個玩家每個回合各算一次）。 */
  unreachable: number;
  /** 船線還沒有船、所有可接出的交叉點都到不了目標的次數。 */
  noStart: number;
  /** 這條規則（不得圍死任何玩家的目標）隱藏掉的合法船位次數（每次動作前，一般規則合法、被它擋下的邊數）。 */
  wallRefusals: number;
  /** `actionHints` 的次數與總耗時（毫秒）。 */
  hintCalls: number;
  hintMs: number;
  /** 被圍死時把末端的船退回（`ship.move`）的次數（`stuckLineBacktrack`）。 */
  backtracks: number;
  /** 曾經被圍死（端點到目標完全不通）的玩家數。 */
  walledPlayers: number;
  /** 被圍死過、最後仍完成船線的玩家數（靠退回脫困）。 */
  escaped: number;
  /** 結束時船線沒完成、配件沒用完、端點仍到不了目標的玩家（可能還在退回的路上）。 */
  stillWalled: number;
  /** stillWalled 之中，連船線上的任何頂點與東島的海岸建築都到不了目標的玩家（任何退回都沒有路：被完整的牆隔開）。 */
  hopeless: number;
  /** 最後仍無法到達目標的玩家：沒有完成、配件沒用完、沒有任何合法延伸、也不能退回（永久卡死）。 */
  stuckPlayers: number;
  /** 不一致：端點到得了目標，卻連不看「不得圍死」規則也沒有任何合法的船線延伸（距離與 `lineShip` 的可走頂點不同套，必須是 0）。 */
  inconsistent: number;
  /** 規則死結：端點到得了目標，船線延伸只被「不得圍死別人目標」擋下（兩條船線搶同一條窄路，誰先走都會圍死對方）。 */
  ruleDeadlocks: number;
  /** 船線端點落在別人的建築上，或船線繞回自己的頂點（必須是 0）：船線端點落在別人的建築上，或船線繞回自己的頂點（必須是 0）。 */
  badEnds: number;
  /** 海盜群島上不合法取得的路（必須是 0：模擬只用合法動作）。 */
  illegalRoads: number;
  /** 因為配件用完（15 艘）而沒完成的玩家數。 */
  outOfShips: number;
  /** 擲骰次數、海盜攻擊次數（相鄰才攻擊）、7 的偷牌次數（S7b 的真實巡弋）。 */
  rolls: number;
  attacks: number;
  steals: number;
  /** 回合開始（擲骰與 frame 之後）時，擲骰者的船線沒有完成，且「沒有海盜時有合法延伸、有海盜時沒有」的次數；以及可比較的回合數。 */
  pirateBlockedTurns: number;
  lineTurns: number;
  /** 被「完成」之外的原因擋住：端點有路但目前沒有任何合法的船線延伸（海盜等暫時限制以外）。 */
  noExtension: number;
}

function attempt(state: GameState, actor: string, command: AnyCommand, rng: Rng): GameState | null {
  const outcome = applyCommand(state, actor, command as Command, rng);
  return outcome.ok ? outcome.state : null;
}

const RICH: Record<Resource, number> = { lumber: 6, brick: 6, wool: 6, grain: 6, ore: 6 };

function enrich(state: GameState, playerId: string): void {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  player.resources = { ...RICH };
}

function pick<T>(items: readonly T[], rng: Rng): T | undefined {
  return items.length === 0 ? undefined : items[rng.int(items.length)];
}

interface Hints {
  legalShips: number[];
  setupShips: number[];
  movableShips: { edge: number; targets: number[] }[];
}

function sfHints(state: GameState, id: string): Hints {
  return actionHints(state, id).modules!.seafarers as Hints;
}

function setupStep(state: GameState, rng: Rng): GameState {
  const setup = state.turn.setup!;
  const actor = state.players[setup.order[setup.index]!]!.id;
  const hints = actionHints(state, actor);
  if (setup.stage === 'building') {
    return attempt(state, actor, { type: 'setup.placeBuilding', vertex: pick(hints.legalSettlements, rng)! }, rng)!;
  }
  // 設置的船：不隨機重開船線（玩家會保留預置的船線；重新開始另有專門的測試）。
  const vertex = setup.lastVertex;
  const ships = sfHints(state, actor).setupShips.filter((edge) => vertex === null || !(lineShip(state, actor, edge, { setupVertex: vertex }) as { restart?: boolean }).restart);
  const roads = hints.legalRoads;
  const both = [...ships.map((edge) => ({ type: 'setup.placeShip', edge })), ...roads.map((edge) => ({ type: 'setup.placeRoad', edge }))];
  return attempt(state, actor, pick(both, rng)!, rng)!;
}

/** 目前船線的延伸候選：一般合法、且是船線的延伸（接在端點、距離減 1，或完全無路時的放寬）。 */
function lineCandidates(state: GameState, actor: string, ignoreWalls = false, allowRestart = false): number[] {
  const ctx = lineContext(state, actor)!;
  if (ctx.next === 'done') return [];
  const steps = legalShipEdges(state, actor, ignoreWalls ? { walls: null } : {}).map((edge) => ({ edge, step: lineShip(state, actor, edge) }))
    .filter((entry) => entry.step.kind === 'line');
  // 模擬的玩家只延伸現有的船線（重新開始另有專門的測試；海盜暫時擋住時玩家也不會因此重開）；卡死檢查才把重新開始算進可走的步。
  const extensions = steps.filter((entry) => !(entry.step as { restart?: boolean }).restart);
  return (extensions.length > 0 || !allowRestart ? extensions : steps).map((entry) => entry.edge);
}

/** 被圍死時退回末端船的指令：優先接成新的船線延伸（嚴格規則），否則放到自由的海岸邊。 */
function backtrackMove(state: GameState, actor: string, rng: Rng): AnyCommand | null {
  const line = pirateIslandsView(state)!.lines[actor]!;
  const last = line.edges[line.edges.length - 1];
  if (last === undefined || !lineBacktrackMovable(state, actor, last)) return null;
  const entry = sfHints(state, actor).movableShips.find((candidate) => candidate.edge === last);
  if (!entry || entry.targets.length === 0) return null;
  const extensions = entry.targets.filter((edge) => lineShip(state, actor, edge, { moving: last }).kind === 'line');
  return { type: 'ship.move', from: last, to: pick(extensions.length > 0 ? extensions : entry.targets, rng)! };
}

/** 永久卡死：船線沒完成、配件沒用完、沒有合法的船線延伸（不看海盜），也不能退回。 */
function permanentlyStuck(state: GameState, playerId: string): boolean {
  const ctx = lineContext(state, playerId)!;
  if (ctx.next === 'done') return false;
  if (state.board.roads.filter((road) => road?.ship && road.player === playerId).length >= 15) return false;
  const last = ctx.line.edges[ctx.line.edges.length - 1];
  const saved = state.board.pirate;
  state.board.pirate = null;
  enrich(state, playerId);
  // 有合法的船線延伸，或末端船真的可以退回（被圍死、遠端沒有接自己的船，而且有合法的移動目的地）。
  const stuck = lineCandidates(state, playerId, false, true).length === 0
    && !(last !== undefined && lineBacktrackMovable(state, playerId, last) && legalShipEdges(state, playerId, { moving: last }).length > 0);
  state.board.pirate = saved;
  return stuck;
}

export function simulatePirateIslands(options: PirateSimOptions): PirateSimResult {
  const { players, seed, maxTurns = 80, lineBias = 0.85 } = options;
  const rng = seededRng(seed * 104729 + players);
  let { state } = seafarersGame(players, seed, PI_PROFILE);
  const slot = pirateIslandsView(state)!;
  let unreachable = 0;
  let rolls = 0;
  let attacks = 0;
  let steals = 0;
  let pirateBlockedTurns = 0;
  let lineTurns = 0;
  let noStart = 0;
  let noExtension = 0;
  let backtracks = 0;
  let wallRefusals = 0;
  let hintCalls = 0;
  let hintMs = 0;
  let inconsistent = 0;
  let ruleDeadlocks = 0;
  const walled = new Set<string>();
  let illegalRoads = 0;
  let badEnds = 0;
  const stuckSet = new Set<string>();
  const topo = topologyOf(state);
  const observe = (current: GameState): void => {
    for (const player of current.players) {
      const ctx = lineContext(current, player.id)!;
      if (ctx.end !== null) {
        const vertices = lineVertices(current, ctx.line);
        const owner = current.board.buildings[ctx.end]?.player;
        if ((owner !== undefined && owner !== player.id) || new Set(vertices).size !== vertices.length) badEnds++;
      }
      if (ctx.next === 'done') continue;
      if (ctx.end !== null) {
        if (ctx.dist[ctx.end]! < 0) {
          unreachable++;
          walled.add(player.id);
          options.onUnreachable?.(current, player.id);
        }
        continue;
      }
      // 還沒有船線（S7a 只有在預置的船被移除時才會發生）：東島海岸上的任一交叉點到得了目標嗎？
      const reachable = ctx.dist.some((distance, vertex) => distance >= 1 && topo.vertices[vertex]!.edges.some((edge) =>
        topo.edges[edge]!.hexes.some((hex) => isLandHex(current, hex) && current.board.layout.islands[hex] === 1)));
      if (!reachable) noStart++;
    }
  };

  const beachheads = new Set(slot.beachheads.map((entry) => entry.vertex));
  let step = 0;
  while (state.turn.phase === 'setup' && step++ < 200) {
    state = setupStep(state, rng);
    observe(state);
  }
  let turns = 0;
  while (turns < maxTurns && !state.result) {
    const actor = state.players[state.turn.seat]!;
    if (state.players.every((player) => lineContext(state, player.id)!.next === 'done')) break;
    turns++;
    enrich(state, actor.id);
    const seqBefore = state.seq;
    const rolled = attempt(state, actor.id, { type: 'turn.roll' }, rng);
    if (!rolled) throw new Error('cannot roll');
    state = rolled;
    rolls++;
    // 擲骰後的 frame：棄牌、贏海盜的選牌（S7b 沒有戰船，所以不會出現，仍照規則回答）、7 的偷牌（隨機偷或不偷）。
    for (let guard = 0; state.pending && guard < 20; guard++) {
      const pending = state.pending;
      if (pending.kind === 'discard') {
        const id = Object.keys(pending.required).find((candidate) => !pending.submitted[candidate])!;
        const player = state.players.find((candidate) => candidate.id === id)!;
        const pool: Resource[] = [];
        for (const resource of Object.keys(player.resources) as Resource[]) for (let i = 0; i < player.resources[resource]; i++) pool.push(resource);
        state = attempt(state, id, { type: 'pending.discard', resources: pool.slice(0, pending.required[id]) }, rng)!;
      } else if (pending.kind === 'seafarers.sevenSteal') {
        const victims = (actionHints(state, actor.id).modules!.seafarers as unknown as { sevenSteal: string[] }).sevenSteal;
        const victim = rng.int(3) === 0 ? null : pick(victims, rng) ?? null;
        state = attempt(state, actor.id, { type: 'seven.steal', victim }, rng)!;
        if (victim !== null) steals++;
      } else if (pending.kind === 'seafarers.pirateGift') {
        const frame = pending as unknown as { responders: string[] };
        const choices = (actionHints(state, frame.responders[0]!).modules!.seafarers as unknown as { pirateGift: Resource[] }).pirateGift;
        state = attempt(state, frame.responders[0]!, { type: 'pirate.gift', resource: pick(choices, rng)! }, rng)!;
      } else throw new Error(`unexpected pending ${pending.kind}`);
    }
    attacks += state.log.filter((event) => event.seq > seqBefore && event.type === 'pirate.attacked').length;
    // 海盜的暫時阻擋：這回合船線的延伸只被海盜擋住（拿掉海盜才有合法延伸）。
    if (lineContext(state, actor.id)!.next !== 'done') {
      const saved = state.board.pirate;
      enrich(state, actor.id);
      const withPirate = lineCandidates(state, actor.id).length;
      state.board.pirate = null;
      const without = lineCandidates(state, actor.id).length;
      state.board.pirate = saved;
      if (without > 0) lineTurns++;
      if (without > 0 && withPirate === 0) pirateBlockedTurns++;
    }
    const actions = 1 + rng.int(4);
    for (let action = 0; action < actions; action++) {
      enrich(state, actor.id);
      const hintStart = Date.now();
      const hints = actionHints(state, actor.id);
      hintMs += Date.now() - hintStart;
      hintCalls++;
      wallRefusals += legalShipEdges(state, actor.id, { walls: null }).length - legalShipEdges(state, actor.id).length;
      const candidates = lineCandidates(state, actor.id);
      // 偏向船線延伸；其餘隨機：任一合法的船、村落、城市、路。
      const tries: AnyCommand[] = [];
      // 被圍死：先退回末端的船（每回合一次的移船），優先接成新的船線延伸。
      const backtrack = backtrackMove(state, actor.id, rng);
      if (backtrack) tries.push(backtrack);
      if (candidates.length > 0 && rng.int(1000) / 1000 < lineBias) tries.push({ type: 'build.ship', edge: pick(candidates, rng)! });
      const others: AnyCommand[] = [
        // 隨機的其他船：不含「重新開始船線」的第一步（玩家不會隨機重開船線）。
        ...sfHints(state, actor.id).legalShips.filter((edge) => !(lineShip(state, actor.id, edge) as { restart?: boolean }).restart).map((edge) => ({ type: 'build.ship', edge })),
        // 村落只蓋在 beachhead（避免模擬靠分數結束）；再加上隨機的路。
        ...hints.legalSettlements.filter((vertex) => beachheads.has(vertex)).map((vertex) => ({ type: 'build.settlement', vertex })),
        ...hints.legalRoads.map((edge) => ({ type: 'build.road', edge })),
      ];
      const other = pick(others, rng);
      if (other) tries.push(other);
      let done = false;
      for (const command of tries) {
        const next = attempt(state, actor.id, command, rng);
        if (next) {
          if (command === backtrack) backtracks++;
          state = next;
          done = true;
          break;
        }
      }
      if (!done) break;
      observe(state);
    }
    for (const player of state.players) {
      if (permanentlyStuck(state, player.id)) { noExtension++; stuckSet.add(player.id); }
      const ctx = lineContext(state, player.id)!;
      const ships = state.board.roads.filter((road) => road?.ship && road.player === player.id).length;
      if (ctx.next !== 'done' && ctx.end !== null && ctx.dist[ctx.end]! >= 0 && ships < 15) {
        const saved = state.board.pirate;
        state.board.pirate = null;
        enrich(state, player.id);
        if (lineCandidates(state, player.id, true, true).length === 0) inconsistent++;
        else if (lineCandidates(state, player.id, false, true).length === 0) ruleDeadlocks++;
        state.board.pirate = saved;
      }
    }
    if (state.result) break;
    const ended = applyCommand(state, actor.id, { type: 'turn.end' }, rng);
    if (!ended.ok) throw new Error(`cannot end turn: ${ended.error.code} ${JSON.stringify(state.pending)}`);
    state = ended.state;
  }
  let linesDone = 0;
  let outOfShips = 0;
  let escaped = 0;
  let stillWalled = 0;
  let hopeless = 0;
  for (const player of state.players) {
    const ctx = lineContext(state, player.id)!;
    if (ctx.next === 'done') {
      linesDone++;
      if (walled.has(player.id)) escaped++;
    }
    else if (state.board.roads.filter((road) => road?.ship && road.player === player.id).length >= 15) outOfShips++;
    else if (ctx.end !== null && ctx.dist[ctx.end]! < 0) {
      stillWalled++;
      // 與規則同一個定義：任何出發處（船線頂點，沒有船時是海岸建築）通得到目標；退回之後的可能也算。
      const reachable = routeExists(state, player.id);
      if (!reachable) hopeless++;
    }
  }
  // 全部的路都要是合法取得的（海盜群島上的路只能從合法的建築接出去）。
  state.board.roads.forEach((road, edge) => {
    if (road && !road.ship && !roadAllowed(state, road.player, edge)) illegalRoads++;
  });
  return { state, turns, linesDone, unreachable, noStart, outOfShips, noExtension, backtracks, illegalRoads, badEnds, wallRefusals, hintCalls, hintMs, inconsistent, ruleDeadlocks, rolls, attacks, steals, pirateBlockedTurns, lineTurns, walledPlayers: walled.size, escaped, stillWalled, hopeless, stuckPlayers: [...state.players].filter((player) => permanentlyStuck(state, player.id)).length };
}
