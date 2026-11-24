/**
 * The Pirate Islands（海盜巢穴，SF25 pp. 16–17）：預置棋子、堡壘、beachhead 與西島船線（S7a）。
 *
 * - 開局（`initPirateIslands`）：每位玩家一組預置棋子——東島海岸 1 村落 + 1 船；西邊島上 1 個堡壘
 *   （3 枚 pirate lair 疊在 1 個村落上）與 1 個 beachhead marker。3 人局不放白色的位置。組別依顏色
 *   對應，顏色不在這張圖上的玩家依座位順序拿剩下的組別。發展牌：3 人局移除分數牌，4 人局分數牌當騎士。
 * - 堡壘是棋盤上的村落（所以佔用交叉點、算村落配件、擋住別人的船），但在收復前不產出資源、不算分、
 *   不能升級城市（`fortressLocked`）。收復（S7c）把 `lairs` 減到 0 後它就是一般村落。
 * - 西島船線：每位玩家只能有一條連續、不分叉的線，從自己在東島的海岸建築出發，先到自己的 beachhead，最後到自己的
 *   堡壘，且必須走最短路徑。預置的船是船線的第一艘（起點是預置的海岸村落）；船線沒有船時（S7c 輸掉戰鬥後），
 *   第一艘必須接在自己在東島的海岸建築（村落或城市）所在的交叉點，只有自己自由船的交叉點不行（SF25 p. 16
 *   "begin at one of your coastal buildings"）。
 *   每加一艘船線的船，新邊必須接在船線的端點，並讓「端點到下一個目標的距離」減 1；距離是在目前空著的海邊上算的
 *   （別人的建築擋住的交叉點不能經過，海盜的暫時限制不算）。船放在船線端點且距離減 1 就是船線的延伸；
 *   否則，碰到東島陸地格的邊是「大島周圍的其他海路」（`isLineEdge` 為 false），不受限制；不碰東島的邊不是延伸就被拒絕。
 *   到達 beachhead 後目標換成堡壘；到達堡壘後船線完成，不能再延伸。船線上的船不可移動（`shipMoveBlocked`）。
 * - beachhead：船線到達後才可在那裡蓋村落（照常付費）。海盜群島（東島以外的陸地）上只有自己的 beachhead
 *   可以蓋村落，而且要自己的船線（船，不是路）已到達；起始村落只放東島。海盜群島上的路只能從合法取得的建築
 *   （beachhead 村落、收復的堡壘）接出去，未收復的堡壘不能當路的起點（`roadAllowed`）。
 * - 不使用最長道路、最大軍隊與強盜（強盜在盒子裡：`layout.robber = -1`，`robberInactive`）。
 *
 * 狀態只存在 `SeafarersState.pirateIslands`；其他劇本沒有這個欄位，行為與摘要不變（D7）。
 */

import { isLandHex, isBlockedFor, isSeaEdge, topologyOf } from '../../analysis.ts';
import { getProfile } from '../../profiles.ts';
import { cornerVertex, PI_LAIRS_PER_FORTRESS, PI_MAIN_ISLAND, PI_PIECES, routeHexes, sideEdge } from '../../seafarers-pirate-islands-boards.ts';
import type { GameState } from '../../types.ts';
import type { ModuleViewContext } from '../types.ts';
import { seafarersView, type SeafarersState } from './state.ts';

export interface Fortress {
  player: string;
  vertex: number;
  /** 堡壘下剩餘的 pirate lair；0 表示已收復。 */
  lairs: number;
}

export interface Beachhead {
  player: string;
  vertex: number;
}

/** 一位玩家的西島船線：從起點起依序的船（邊），沒有船時 `start` 為 null。 */
export interface ShipLine {
  start: number | null;
  edges: number[];
}

export interface PirateIslandsState {
  fortresses: Fortress[];
  beachheads: Beachhead[];
  lines: Record<string, ShipLine>;
  /** 海盜航道：14 個海格索引，依順時針（S7b 才會讓海盜沿著走）。 */
  route: number[];
}

export const isPirateIslands = (ctx: ModuleViewContext): boolean => ctx.profile.scenario === 'pirate-islands';

export function pirateIslandsView(state: GameState): PirateIslandsState | undefined {
  return seafarersView(state).pirateIslands;
}

/** 開局：預置棋子、堡壘、beachhead 與發展牌堆。不需要隨機數。 */
export function initPirateIslands(state: GameState, slot: SeafarersState): void {
  const topology = topologyOf(state);
  const sets = PI_PIECES.slice(0, state.players.length);
  // 顏色對得上的玩家拿該顏色的組別，其餘依座位順序拿剩下的。
  const taken = new Set<number>();
  const assigned = state.players.map((player) => {
    const index = sets.findIndex((set, i) => !taken.has(i) && set.color === player.color);
    if (index >= 0) taken.add(index);
    return index;
  });
  const free = sets.map((_, i) => i).filter((i) => !taken.has(i));
  const fortresses: Fortress[] = [];
  const beachheads: Beachhead[] = [];
  const presetLines: Record<string, ShipLine> = {};
  state.players.forEach((player, seat) => {
    const set = sets[assigned[seat]! >= 0 ? assigned[seat]! : free.shift()!]!;
    const { settlement, ship, fortress, beachhead } = set.pieces;
    state.board.buildings[cornerVertex(topology, settlement)] = { player: player.id, city: false };
    const settlementVertex = cornerVertex(topology, settlement);
    const shipEdge = sideEdge(topology, ship);
    state.board.roads[shipEdge] = { player: player.id, ship: true };
    presetLines[player.id] = { start: settlementVertex, edges: [shipEdge] };
    const fortressVertex = cornerVertex(topology, fortress);
    state.board.buildings[fortressVertex] = { player: player.id, city: false };
    fortresses.push({ player: player.id, vertex: fortressVertex, lairs: PI_LAIRS_PER_FORTRESS });
    beachheads.push({ player: player.id, vertex: cornerVertex(topology, beachhead) });
  });
  // 發展牌：3 人局移除分數牌；4 人局分數牌當騎士（原地換成騎士，牌序不變）。
  state.devDeck = state.players.length === 3
    ? state.devDeck.filter((card) => card !== 'victoryPoint')
    : state.devDeck.map((card) => (card === 'victoryPoint' ? 'knight' : card));
  slot.pirateIslands = {
    fortresses,
    beachheads,
    // 預置的船是船線的第一艘：從預置的海岸村落出發。
    lines: presetLines,
    route: routeHexes(topology),
  };
}

// ---------------------------------------------------------------------------
// 堡壘：收復前不產出、不算分、不能升級
// ---------------------------------------------------------------------------

export function fortressAt(state: GameState, vertex: number): Fortress | undefined {
  return pirateIslandsView(state)?.fortresses.find((fortress) => fortress.vertex === vertex);
}

/** 尚未收復的堡壘（還有 pirate lair）。 */
export function fortressLocked(state: GameState, vertex: number): boolean {
  return (fortressAt(state, vertex)?.lairs ?? 0) > 0;
}

/** 玩家尚未收復的堡壘數（每個讓村落分少 1 分）。 */
export function lockedFortresses(state: GameState, playerId: string): number {
  return pirateIslandsView(state)?.fortresses.filter((fortress) => fortress.player === playerId && fortress.lairs > 0).length ?? 0;
}

// ---------------------------------------------------------------------------
// 蓋村落：海盜群島只有自己的 beachhead
// ---------------------------------------------------------------------------

/** 交叉點碰到的陸地格的島編號。 */
function landIslands(state: GameState, vertex: number): number[] {
  const hexes = topologyOf(state).vertices[vertex]?.hexes ?? [];
  return hexes.filter((hex) => isLandHex(state, hex)).map((hex) => state.board.layout.islands[hex] ?? 0);
}

/**
 * 起始村落只放東島；之後東島照常，海盜群島上只有自己的 beachhead 可以蓋
 * （船線到達與否由一般的連接規則判定：要有自己的船接到那個交叉點）。
 */
export function buildingAllowed(state: GameState, playerId: string, vertex: number, options: { setup: boolean }): boolean {
  const islands = landIslands(state, vertex);
  if (islands.length === 0) return false;
  if (islands.every((island) => island === PI_MAIN_ISLAND)) return true;
  if (options.setup) return false;
  // 只有自己的 beachhead，而且自己的西島船線（船，不是路）已經到達它。
  const slot = pirateIslandsView(state);
  if (!slot?.beachheads.some((beachhead) => beachhead.player === playerId && beachhead.vertex === vertex)) return false;
  return lineVertices(state, slot.lines[playerId] ?? { start: null, edges: [] }).includes(vertex);
}

/**
 * 海盜群島上的路：只能從玩家已在該島合法取得的建築（到達後蓋的 beachhead 村落、收復的堡壘）或
 * 由此延伸出的路接出去；未收復的堡壘不能當路的起點。東島的路照一般規則。
 */
export function roadAllowed(state: GameState, playerId: string, edge: number): boolean {
  if (!pirateIslandsView(state)) return true;
  const topo = topologyOf(state);
  const info = topo.edges[edge];
  if (!info) return false;
  const onPirateIsland = info.hexes.some((hex) => isLandHex(state, hex) && (state.board.layout.islands[hex] ?? 0) !== PI_MAIN_ISLAND);
  if (!onPirateIsland) return true;
  return info.vertices.some((vertex) => {
    const building = state.board.buildings[vertex];
    if (building?.player === playerId && !fortressLocked(state, vertex)) return true;
    return topo.vertices[vertex]!.edges.some((other) => {
      const road = state.board.roads[other];
      return !!road && !road.ship && road.player === playerId;
    });
  });
}

// ---------------------------------------------------------------------------
// 西島船線與最短路徑
// ---------------------------------------------------------------------------

/** 不碰到東島陸地格的邊：只能放船線的船（碰到的邊可以是「大島周圍的其他海路」，不受限制）。 */
export function isLineEdge(state: GameState, edge: number): boolean {
  const info = topologyOf(state).edges[edge];
  if (!info) return false;
  return !info.hexes.some((hex) => isLandHex(state, hex) && (state.board.layout.islands[hex] ?? 0) === PI_MAIN_ISLAND);
}

export type LineTarget = 'beachhead' | 'fortress' | 'done';

export interface LineContext {
  line: ShipLine;
  /** 船線目前的端點；還沒有船線時為 null。 */
  end: number | null;
  next: LineTarget;
  /** 下一個目標的交叉點；船線完成時為 null。 */
  targetVertex: number | null;
  /**
   * 船線還沒有船時：自己在東島的海岸建築所在的交叉點裡，有沒有到得了目標的（距離 ≥ 1）。
   * 沒有的話才是「完全無路」（`shortestPathFallback`）。有船線時不用（看端點的距離）。
   */
  startable: boolean;
  /** 每個交叉點到目標的距離（只走空著的、不碰東島的海邊；別人的建築擋住的交叉點不能經過）；到不了為 -1。 */
  dist: number[];
}

/** 沿著船線走一遍，依序列出經過的交叉點（含起點）。 */
export function lineVertices(state: GameState, line: ShipLine): number[] {
  if (line.start === null) return [];
  const topo = topologyOf(state);
  const out = [line.start];
  let vertex = line.start;
  for (const edge of line.edges) {
    const [a, b] = topo.edges[edge]!.vertices;
    vertex = a === vertex ? b : a;
    out.push(vertex);
  }
  return out;
}

/** 玩家船線的狀態：端點、下一個目標與目標的距離表。`vacated` 是正要被移走的船的邊（視為空）。 */
export function lineContext(state: GameState, playerId: string, vacated?: number): LineContext | null {
  const slot = pirateIslandsView(state);
  if (!slot) return null;
  const line = slot.lines[playerId] ?? { start: null, edges: [] };
  const vertices = lineVertices(state, line);
  const beachhead = slot.beachheads.find((entry) => entry.player === playerId)?.vertex ?? null;
  const fortress = slot.fortresses.find((entry) => entry.player === playerId)?.vertex ?? null;
  let next: LineTarget = 'beachhead';
  let targetVertex = beachhead;
  if (beachhead === null || vertices.includes(beachhead)) {
    next = 'fortress';
    targetVertex = fortress;
  }
  if (fortress === null || (next === 'fortress' && vertices.includes(fortress))) {
    next = 'done';
    targetVertex = null;
  }
  const topo = topologyOf(state);
  const dist = new Array<number>(topo.vertices.length).fill(-1);
  if (targetVertex !== null) {
    dist[targetVertex] = 0;
    const queue = [targetVertex];
    for (let head = 0; head < queue.length; head++) {
      const vertex = queue[head]!;
      for (const edge of topo.vertices[vertex]!.edges) {
        if ((state.board.roads[edge] && edge !== vacated) || !isSeaEdge(state, edge)) continue;
        const [a, b] = topo.edges[edge]!.vertices;
        const other = a === vertex ? b : a;
        if (dist[other] >= 0 || isBlockedFor(state, other, playerId)) continue;
        dist[other] = dist[vertex]! + 1;
        queue.push(other);
      }
    }
  }
  const end = vertices.length > 0 ? vertices[vertices.length - 1]! : null;
  const startable = end !== null || dist.some((distance, vertex) =>
    distance >= 1 && canStartAt(state, playerId, vertex));
  return { line, end, next, targetVertex, startable, dist };
}

export interface LineShipOptions {
  /** 設置：船必須接在這個交叉點。 */
  setupVertex?: number | null;
  /** 正在移動的船：它現在的邊視為空，也不算接得上。 */
  moving?: number;
  /** 呼叫端已算好的船線狀態（一次列出所有合法邊時共用）。 */
  line?: LineContext | null;
}

export type LineShip =
  | { kind: 'free' }
  /** `relaxed`：完全無路時的放寬（`shortestPathFallback`），沒有走最短路徑。 */
  | { kind: 'line'; from: number; to: number; relaxed: boolean }
  | { kind: 'refused'; reason: 'done' | 'not-at-end' | 'not-shortest' };

/**
 * 船線可以從這個交叉點出發：自己在東島的海岸建築（村落或城市，交叉點碰到東島陸地格）。
 * 沿海岸的自由船不能當起點；堡壘與 beachhead 在海盜群島上，也不能。
 */
function canStartAt(state: GameState, playerId: string, vertex: number): boolean {
  return state.board.buildings[vertex]?.player === playerId && landIslands(state, vertex).includes(PI_MAIN_ISLAND);
}

/**
 * 一艘新船（或被移動到這裡的船）放在 `edge` 時的船線判定：自由的海路、合法的船線延伸，或被拒絕。
 * 只看船線規則；一般的連接、占用與海盜限制由 `canPlaceShip` 先判。沒有這個劇本的狀態時一律自由。
 */
export function lineShip(state: GameState, playerId: string, edge: number, options: LineShipOptions = {}): LineShip {
  if (options.line === null || !pirateIslandsView(state)) return { kind: 'free' };
  // 碰到東島的邊是「大島周圍的其他海路」：不是船線的延伸時自由；不碰東島的邊只能是船線。
  const coastal = !isLineEdge(state, edge);
  const ctx = options.line === undefined ? lineContext(state, playerId, options.moving) : options.line;
  if (!ctx) return { kind: 'free' };
  if (ctx.next === 'done') return coastal ? { kind: 'free' } : { kind: 'refused', reason: 'done' };
  const [a, b] = topologyOf(state).edges[edge]!.vertices;
  const candidates: [number, number][] = [[a, b], [b, a]];
  let attached = false;
  let best: { from: number; to: number } | null = null;
  for (const [from, to] of candidates) {
    if (ctx.end !== null) {
      if (from !== ctx.end) continue;
    } else if (options.setupVertex !== undefined ? from !== options.setupVertex : !canStartAt(state, playerId, from)) {
      continue;
    }
    attached = true;
    const here = ctx.dist[from]!;
    if (here <= 0 || ctx.dist[to] !== here - 1) continue;
    // 兩端都接得上時取較近目標的方向（距離較大的一端當出發點）。
    if (!best || here > ctx.dist[best.from]!) best = { from, to };
  }
  if (best) return { kind: 'line', ...best, relaxed: false };
  if (attached && fallbackApplies(state, ctx)) {
    // 完全無路：往任何合法方向延伸（端點或自己的建築／船接得上的那一端）。
    for (const [from, to] of candidates) {
      if (ctx.end !== null ? from === ctx.end : (options.setupVertex !== undefined ? from === options.setupVertex : canStartAt(state, playerId, from))) {
        return { kind: 'line', from, to, relaxed: true };
      }
    }
  }
  if (coastal) return { kind: 'free' };
  return { kind: 'refused', reason: attached ? 'not-shortest' : 'not-at-end' };
}

/** 完全無路：目標在空著的海邊上到不了（有船線看端點，還沒有船線看有沒有可出發的建築或船）。 */
function fallbackApplies(state: GameState, ctx: LineContext): boolean {
  if (!getProfile(state.profileId)?.shortestPathFallback) return false;
  return ctx.end !== null ? ctx.dist[ctx.end]! < 0 : !ctx.startable;
}

/** 船線規則是否允許這個位置（沒有這個劇本的狀態時一律允許）。 */
export function lineAllows(state: GameState, playerId: string, edge: number, options: LineShipOptions = {}): boolean {
  return lineShip(state, playerId, edge, options).kind !== 'refused';
}

/** 一艘船放到（或移到）`edge` 之前呼叫：若它是船線的延伸就記進船線。 */
export function recordLineShip(state: GameState, playerId: string, edge: number, options: LineShipOptions = {}): void {
  const step = lineShip(state, playerId, edge, { ...options, line: undefined });
  if (step.kind !== 'line') return;
  const line = pirateIslandsView(state)!.lines[playerId]!;
  if (line.start === null) line.start = step.from;
  line.edges.push(edge);
}

/** 船線上的船不可移動（一般的船在大島周圍的海路上，照一般規則）。 */
export function lineShipFixed(state: GameState, playerId: string, edge: number): boolean {
  return pirateIslandsView(state)?.lines[playerId]?.edges.includes(edge) ?? false;
}

// ---------------------------------------------------------------------------
// 投影與提示
// ---------------------------------------------------------------------------

/** 公開狀態：堡壘（含剩餘 lair 數）、beachhead、各玩家船線與航道（全部公開）。 */
export function projectPirateIslands(state: GameState, slot: PirateIslandsState) {
  return {
    fortresses: slot.fortresses.map((fortress) => ({ ...fortress })),
    beachheads: slot.beachheads.map((beachhead) => ({ ...beachhead })),
    lines: Object.fromEntries(Object.entries(slot.lines).map(([id, line]) => {
      const ctx = lineContext(state, id)!;
      return [id, { start: line.start, edges: line.edges.slice(), end: ctx.end, next: ctx.next }];
    })),
    route: slot.route.slice(),
  };
}

/** 提示：自己船線的下一個目標與端點（棋盤用它標出目標）。 */
export function pirateLineHints(state: GameState, playerId: string) {
  const ctx = lineContext(state, playerId);
  if (!ctx) return null;
  return { next: ctx.next, target: ctx.targetVertex, end: ctx.end, edges: ctx.line.edges.slice() };
}
