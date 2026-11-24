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
 *   到達 beachhead 後目標換成堡壘；到達堡壘後船線完成，不能再延伸。船線上的船不可移動（`shipMoveBlocked`），
 *   只有一個例外：端點到目標完全不通（被圍死）時，末端的船可以用 `ship.move` 退回（`lineBacktrack`，偏離 SF25）。
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
  // 蓋在這裡會擋住別人的通行；不能因此把任何一位玩家的目標圍死。
  const open = (): boolean => !wallsAnyone(state, { vertex, owner: playerId });
  if (islands.every((island) => island === PI_MAIN_ISLAND)) return open();
  if (options.setup) return false;
  // 只有自己的 beachhead，而且自己的西島船線（船，不是路）已經到達它。
  const slot = pirateIslandsView(state);
  if (!slot?.beachheads.some((beachhead) => beachhead.player === playerId && beachhead.vertex === vertex)) return false;
  return lineVertices(state, slot.lines[playerId] ?? { start: null, edges: [] }).includes(vertex) && open();
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
  // 海岸的路占用海邊，不能因此把任何一位玩家的目標圍死。
  if (isSeaEdge(state, edge) && wallsAnyone(state, { edge })) return false;
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

/** 船線目前的目標：先 beachhead，到達後堡壘，到達堡壘後完成。 */
function lineTarget(slot: PirateIslandsState, playerId: string, vertices: readonly number[]): { next: LineTarget; targetVertex: number | null } {
  const beachhead = slot.beachheads.find((entry) => entry.player === playerId)?.vertex ?? null;
  const fortress = slot.fortresses.find((entry) => entry.player === playerId)?.vertex ?? null;
  const reached = beachhead === null ? 0 : vertices.indexOf(beachhead);
  if (beachhead !== null && reached < 0) return { next: 'beachhead', targetVertex: beachhead };
  // 堡壘必須在 beachhead 之後到達（先經過堡壘再停在 beachhead 不算完成）。
  if (fortress === null || vertices.indexOf(fortress, Math.max(reached, 0)) >= 0) return { next: 'done', targetVertex: null };
  return { next: 'fortress', targetVertex: fortress };
}

/** 在到達 beachhead 之前，堡壘的頂點不能當經過點。 */
function fortressToAvoid(slot: PirateIslandsState, playerId: string, next: LineTarget): number | null {
  return next === 'beachhead' ? slot.fortresses.find((entry) => entry.player === playerId)?.vertex ?? null : null;
}

/** 去掉末端一艘船的船線；一艘都不剩時回到「沒有船線」（只能從海岸建築重新起頭）。 */
function truncated(line: ShipLine): ShipLine {
  const edges = line.edges.slice(0, -1);
  return { start: edges.length > 0 ? line.start : null, edges };
}

/** 玩家船線的狀態：端點、下一個目標與目標的距離表。`vacated` 是正要被移走的船的邊（視為空）。 */
export function lineContext(state: GameState, playerId: string, vacated?: number, override?: ShipLine): LineContext | null {
  const slot = pirateIslandsView(state);
  if (!slot) return null;
  const full = override ?? slot.lines[playerId] ?? { start: null, edges: [] };
  // 正要被移走的是船線末端的船（退回）：船線視為已經少了它。
  const line = vacated !== undefined && full.edges[full.edges.length - 1] === vacated ? truncated(full) : full;
  const vertices = lineVertices(state, line);
  const { next, targetVertex } = lineTarget(slot, playerId, vertices);
  const topo = topologyOf(state);
  const dist = new Array<number>(topo.vertices.length).fill(-1);
  // 距離與 `lineShip` 用同一套可走的頂點：自己船線上除了端點以外的頂點不能再踏上（不成環）。
  const lineEnd = vertices.length > 0 ? vertices[vertices.length - 1]! : null;
  const ownLine = new Set(vertices);
  if (lineEnd !== null) ownLine.delete(lineEnd);
  const avoid = fortressToAvoid(slot, playerId, next);
  if (avoid !== null) ownLine.add(avoid);
  if (targetVertex !== null) {
    dist[targetVertex] = 0;
    const queue = [targetVertex];
    for (let head = 0; head < queue.length; head++) {
      const vertex = queue[head]!;
      for (const edge of topo.vertices[vertex]!.edges) {
        if ((state.board.roads[edge] && edge !== vacated) || !isSeaEdge(state, edge)) continue;
        const [a, b] = topo.edges[edge]!.vertices;
        const other = a === vertex ? b : a;
        if (dist[other] >= 0 || ownLine.has(other) || isBlockedFor(state, other, playerId)) continue;
        dist[other] = dist[vertex]! + 1;
        queue.push(other);
      }
    }
  }
  const end = vertices.length > 0 ? vertices[vertices.length - 1]! : null;
  return { line, end, next, targetVertex, dist };
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
  /** `restart`：船線只有一艘船（預置的）時，從另一個自己的東島海岸建築重新開始；原來的那艘船變成自由船。 */
  | { kind: 'line'; from: number; to: number; restart?: true }
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
  // 新的端點不能是自己船線上已有的頂點（不成環）。
  const onLine = new Set(lineVertices(state, ctx.line));
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
    if (here <= 0 || ctx.dist[to] !== here - 1 || onLine.has(to)) continue;
    // 兩端都接得上時取較近目標的方向（距離較大的一端當出發點）。
    if (!best || here > ctx.dist[best.from]!) best = { from, to };
  }
  if (best) return { kind: 'line', ...best };
  // 船線還沒有延伸超過一艘船：可以從自己任一個東島海岸建築以最短路徑的第一步重新開始（SF25：從任一海岸建築出發）。
  if (options.moving === undefined && ctx.line.edges.length === 1) {
    const fresh = lineContext(state, playerId, undefined, { start: null, edges: [] });
    if (fresh && fresh.next !== 'done') {
      for (const [from, to] of candidates) {
        if (options.setupVertex !== undefined ? from !== options.setupVertex : !canStartAt(state, playerId, from)) continue;
        const here = fresh.dist[from]!;
        if (here > 0 && fresh.dist[to] === here - 1) return { kind: 'line', from, to, restart: true };
      }
    }
  }
  if (coastal) return { kind: 'free' };
  return { kind: 'refused', reason: attached ? 'not-shortest' : 'not-at-end' };
}

/**
 * 退回（`stuckLineBacktrack`，偏離 SF25，使用者決定 2026-11-24）：船線端點到目前目標在空著的海邊上完全不通
 * 時，船線**末端**的那一艘船可以移動（用一般的 `ship.move`），玩家退一格再改走別條路；移走後仍不通就可以
 * 再退下一艘。其他情況船線上的船不可移動。移走之後回到嚴格的最短路徑規則。
 */
export function lineBacktrack(state: GameState, playerId: string, edge: number): boolean {
  if (!getProfile(state.profileId)?.stuckLineBacktrack) return false;
  const line = pirateIslandsView(state)?.lines[playerId];
  if (!line || line.edges[line.edges.length - 1] !== edge) return false;
  const ctx = lineContext(state, playerId);
  return !!ctx && ctx.next !== 'done' && ctx.end !== null && ctx.dist[ctx.end]! < 0;
}

/** 船線規則是否允許這個位置（沒有這個劇本的狀態時一律允許）。 */
export function lineAllows(state: GameState, playerId: string, edge: number, options: LineShipOptions = {}): boolean {
  return lineShip(state, playerId, edge, options).kind !== 'refused';
}

/** 一艘船放到（或移到）`edge` 之前呼叫：若它是船線的延伸就記進船線；移走的是末端的船時先把船線截短。 */
export function recordLineShip(state: GameState, playerId: string, edge: number, options: LineShipOptions = {}): void {
  const slot = pirateIslandsView(state);
  if (!slot) return;
  const step = lineShip(state, playerId, edge, { ...options, line: undefined });
  const line = slot.lines[playerId]!;
  if (options.moving !== undefined && line.edges[line.edges.length - 1] === options.moving) {
    line.edges.pop();
    if (line.edges.length === 0) line.start = null;
  }
  if (step.kind !== 'line') return;
  if (step.restart) {
    // 新的船線從這個建築開始；原來的船（預置的）變成自由船。
    line.start = step.from;
    line.edges = [edge];
    return;
  }
  if (line.start === null) line.start = step.from;
  line.edges.push(edge);
}

/**
 * 退回的末端船真的可以移動：被圍死，而且它的遠端（船線端點）沒有接著自己的其他船——遠端接著自己的建築可以
 * （移走後建築還在），接著自己的自由海岸船就照一般規則不行（否則會留下與建築斷開的孤立船）。
 */
export function lineBacktrackMovable(state: GameState, playerId: string, edge: number): boolean {
  if (!lineBacktrack(state, playerId, edge)) return false;
  const end = lineContext(state, playerId)!.end!;
  return !topologyOf(state).vertices[end]!.edges.some((other) => {
    const road = state.board.roads[other];
    return other !== edge && !!road && road.ship && road.player === playerId;
  });
}

/** 船線上的船不可移動，除非是被圍死時可以退回的末端船（一般的船在大島周圍的海路上，照一般規則）。 */
export function lineShipFixed(state: GameState, playerId: string, edge: number): boolean {
  return (pirateIslandsView(state)?.lines[playerId]?.edges.includes(edge) ?? false) && !lineBacktrack(state, playerId, edge);
}

// ---------------------------------------------------------------------------
// 禁止圍死別人的目標（使用者決定 2026-11-24，偏離 SF25，延伸「不可蓄意拉長來擋別人」）
// ---------------------------------------------------------------------------

/** 一次放置會改變的盤面：占用一條邊（船或路）、騰出一條邊（移船）、或在交叉點蓋建築（擋住別人的通行）。 */
export interface WallChange {
  edge?: number;
  vacated?: number;
  vertex?: number;
  owner?: string;
  /** 放的船是放置者船線的延伸時，船線新的端點（放置者的目標與出發處據此重算）。 */
  extend?: number;
  /** 船線延伸的出發頂點，以及它是不是從另一個建築重新開始的新船線。 */
  from?: number;
  restart?: boolean;
}

interface WallPlayer {
  id: string;
  target: number;
  sources: number[];
  /** 放置之前，從目標沿空著的海邊走得到的頂點。 */
  visited: boolean[];
  /** 從目標到某個出發處的一條空海路上的邊與頂點：放置沒有碰到這條路，就一定還走得通（不必再搜尋）。 */
  pathEdges: Set<number>;
  pathVertices: Set<number>;
  /** 目標是 beachhead 時，不能經過的堡壘頂點。 */
  avoid: number | null;
}

/** 放置之前每位「可能被圍死」的玩家（船線沒完成、目前通得到目標）的狀態；一次算好，供一次列出許多邊時共用。 */
export interface WallContext {
  players: WallPlayer[];
}

/**
 * 玩家的「出發處」：船線有船時是船線上的每個頂點（含起點的海岸建築；退回之後可以從任何一個重新出發），
 * 沒有船時是自己在東島的海岸建築。
 */
function wallSources(state: GameState, playerId: string, line: ShipLine): number[] {
  if (line.edges.length > 0) return lineVertices(state, line);
  return state.board.buildings.flatMap((building, vertex) => (building?.player === playerId && canStartAt(state, playerId, vertex) ? [vertex] : []));
}

/** 從目標沿空著的海邊走到的頂點（別人的建築擋住的交叉點不能經過）；`change` 是假設的放置。 */
function wallVisit(state: GameState, playerId: string, target: number, change: WallChange, parentEdge?: number[], avoid: number | null = null): boolean[] {
  const topo = topologyOf(state);
  const visited = new Array<boolean>(topo.vertices.length).fill(false);
  const blocked = (vertex: number) => isBlockedFor(state, vertex, playerId)
    || (change.vertex === vertex && change.owner !== undefined && change.owner !== playerId);
  visited[target] = true;
  const queue = [target];
  for (let head = 0; head < queue.length; head++) {
    const vertex = queue[head]!;
    for (const edge of topo.vertices[vertex]!.edges) {
      if (edge === change.edge || !isSeaEdge(state, edge) || (state.board.roads[edge] && edge !== change.vacated)) continue;
      const [a, b] = topo.edges[edge]!.vertices;
      const other = a === vertex ? b : a;
      if (visited[other] || other === avoid || blocked(other)) continue;
      visited[other] = true;
      if (parentEdge) parentEdge[other] = edge;
      queue.push(other);
    }
  }
  return visited;
}

/** 盤面指紋（邊、建築、各玩家船線）：同一個狀態物件在盤面沒變時共用算好的 `WallContext`（提示會對很多邊與交叉點問同樣的問題）。 */
const wallCache = new WeakMap<GameState, { key: string; context: WallContext | null }>();

function boardKey(state: GameState, slot: PirateIslandsState): string {
  return `${state.board.roads.map((road) => (road ? `${road.player}${road.ship ? 's' : 'r'}` : '-')).join(',')}|${state.board.buildings.map((building) => (building ? `${building.player}${building.city ? 'c' : 's'}` : '-')).join(',')}|${JSON.stringify(slot.lines)}`;
}

export function wallContext(state: GameState): WallContext | null {
  const slot = pirateIslandsView(state);
  if (!slot) return null;
  const key = boardKey(state, slot);
  const cached = wallCache.get(state);
  if (cached && cached.key === key) return cached.context;
  const context = computeWallContext(state, slot);
  wallCache.set(state, { key, context });
  return context;
}

function computeWallContext(state: GameState, slot: PirateIslandsState): WallContext {
  const players: WallPlayer[] = [];
  for (const [id, line] of Object.entries(slot.lines)) {
    const { next, targetVertex } = lineTarget(slot, id, lineVertices(state, line));
    if (next === 'done' || targetVertex === null) continue;
    const sources = wallSources(state, id, line);
    const parentEdge: number[] = [];
    const visited = wallVisit(state, id, targetVertex, {}, parentEdge, fortressToAvoid(slot, id, next));
    // 放置之前就已經不通的玩家不受保護（不因為舊狀態禁止所有動作）。
    const reached = sources.find((vertex) => visited[vertex]);
    if (reached === undefined) continue;
    const topo = topologyOf(state);
    const pathEdges = new Set<number>();
    const pathVertices = new Set<number>([reached]);
    for (let vertex = reached; vertex !== targetVertex;) {
      const edge = parentEdge[vertex]!;
      pathEdges.add(edge);
      const [a, b] = topo.edges[edge]!.vertices;
      vertex = a === vertex ? b : a;
      pathVertices.add(vertex);
    }
    players.push({ id, target: targetVertex, sources, visited, pathEdges, pathVertices, avoid: fortressToAvoid(slot, id, next) });
  }
  return { players };
}

/** 這位玩家現在從任何出發處（船線頂點，沒有船時是海岸建築）通得到目標嗎（與「不得圍死」同一個定義）。完成船線的玩家回 true。 */
export function routeExists(state: GameState, playerId: string): boolean {
  const slot = pirateIslandsView(state);
  const line = slot?.lines[playerId];
  if (!slot || !line) return true;
  const { next, targetVertex } = lineTarget(slot, playerId, lineVertices(state, line));
  if (next === 'done' || targetVertex === null) return true;
  const visited = wallVisit(state, playerId, targetVertex, {}, undefined, fortressToAvoid(slot, playerId, next));
  return wallSources(state, playerId, line).some((vertex) => visited[vertex]);
}

/** 這個放置會不會讓任何一位玩家（含自己）從通變成完全不通。沒有這個劇本的狀態時一律不會。 */
export function wallsAnyone(state: GameState, change: WallChange, context?: WallContext | null): boolean {
  const ctx = context === undefined ? wallContext(state) : context;
  if (!ctx) return false;
  const slot = pirateIslandsView(state)!;
  // 放置者自己的船線延伸或退回末端船：用移動之後的船線（目標可能從堡壘變回 beachhead，船線清空時出發處是所有海岸建築）重算。
  const ownerLine = change.owner === undefined ? undefined : slot.lines[change.owner];
  const movesLast = !!ownerLine && change.vacated !== undefined && ownerLine.edges[ownerLine.edges.length - 1] === change.vacated;
  const ownerHandled = change.owner !== undefined && !!ownerLine && (change.extend !== undefined || movesLast);
  if (ownerHandled) {
    const owner = change.owner!;
    const base = movesLast ? truncated(ownerLine!) : ownerLine!;
    let vertices: number[];
    if (change.restart && change.from !== undefined) vertices = [change.from];
    else vertices = lineVertices(state, base);
    if (change.extend !== undefined) {
      if (vertices.length === 0 && change.from !== undefined) vertices.push(change.from);
      vertices = [...vertices, change.extend];
    }
    const { next, targetVertex } = lineTarget(slot, owner, vertices);
    if (next !== 'done' && targetVertex !== null) {
      const sources = change.extend !== undefined ? vertices : wallSources(state, owner, base);
      const avoid = fortressToAvoid(slot, owner, next);
      const before = wallVisit(state, owner, targetVertex, change.vacated === undefined ? {} : { vacated: change.vacated }, undefined, avoid);
      if (sources.some((vertex) => before[vertex])) {
        const after = wallVisit(state, owner, targetVertex, change, undefined, avoid);
        if (!sources.some((vertex) => after[vertex])) return true;
      }
    }
  }
  for (const player of ctx.players) {
    if (ownerHandled && player.id === change.owner) continue;
    // 放置沒有碰到這位玩家的那條空海路，路還在，不必搜尋。
    if (change.edge !== undefined) {
      if (!player.pathEdges.has(change.edge)) continue;
    } else if (change.vertex !== undefined) {
      if (!player.pathVertices.has(change.vertex) || change.owner === player.id) continue;
    }
    const visited = wallVisit(state, player.id, player.target, change, undefined, player.avoid);
    if (!player.sources.some((vertex) => visited[vertex])) return true;
  }
  return false;
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

/** 提示：自己船線的下一個目標、端點，以及是否被圍住（`stuck`；此刻能不能移末端船由 `backtrack` 決定，在 `seafarersHints` 與 `movableShips` 一致地算）。 */
export function pirateLineHints(state: GameState, playerId: string) {
  const ctx = lineContext(state, playerId);
  if (!ctx) return null;
  const last = ctx.line.edges[ctx.line.edges.length - 1];
  return { next: ctx.next, target: ctx.targetVertex, end: ctx.end, edges: ctx.line.edges.slice(), stuck: last !== undefined && lineBacktrack(state, playerId, last) };
}
