/**
 * 以「資源（骰子點數）」描述棋盤位置，取代玩家看不到的地圖編號。
 *
 * 規則：
 * - 地塊：產資源的地形寫資源名，其餘寫地形名，後面加上骰子點數，例如「木材（6）」。
 * - 交點：列出相鄰的陸地地塊，例如「木材（6）、磚塊（8）、小麥（5）」。
 * - 路徑：兩側都是陸地時寫「木材（6）與磚塊（8）之間」，只有一側時寫「木材（6）沿岸」。
 * - 同一種位置在整張地圖上出現相同描述（例如同一塊外圈地塊的兩個沿岸交點），
 *   或位置本身沒有相鄰陸地（外海）時，補上最近的其他地塊作為區分：「…，靠近羊毛（4）」。
 *
 * 只使用公開棋盤資料；未探索的地塊（Explorers & Pirates）一律寫成「未探索」，不洩漏內容。
 */

import type { Locale } from '@catan/protocol';
import { getTopology, type BoardTopology, type GameView, type PublicBoardView } from '@catan/rules';
import { t } from '../i18n/index.ts';
import { epView, fogRegions } from './explorersPirates.ts';
import { pipsFor, resourceOfTerrain } from './terrain.ts';

export interface ReferenceContext {
  locale: Locale;
  topology: BoardTopology;
  board: PublicBoardView;
  /** Explorers & Pirates: unexplored hexes and their region (their contents are not known yet). */
  fog?: ReadonlyMap<number, 'parrot' | 'goose'>;
}

export type ReferenceKind = 'vertex' | 'edge' | 'hex';

/** 由公開牌桌建立參照情境；Explorers & Pirates 會帶入未探索地塊。 */
export function viewReferenceContext(locale: Locale, view: Pick<GameView, 'board' | 'modules'>): ReferenceContext {
  const ep = epView(view);
  return { locale, topology: getTopology(view.board.topologyId), board: view.board, fog: ep ? fogRegions(ep) : undefined };
}

/** 「靠近」最多列出的地塊數，避免標籤過長。 */
const MAX_HINT_TILES = 3;
/** 外海位置往外尋找陸地的最大步數（以交點為單位）。 */
const MAX_HINT_DEPTH = 4;
/** 地形名稱後的代碼，例如「森林（F）」的「（F）」。 */
const TERRAIN_CODE = /\s*[（(][^（）()]*[）)]\s*$/;

function isLand(context: ReferenceContext, hex: number): boolean {
  if (context.fog?.has(hex)) return false;
  const terrain = context.board.terrain[hex];
  return terrain !== undefined && terrain !== 'sea';
}

function tileNumbers(board: PublicBoardView, hex: number): number[] {
  const primary = board.numbers[hex];
  const extras = (board.extraNumbers ?? []).filter((entry) => entry.hex === hex).map((entry) => entry.number);
  return [...(typeof primary === 'number' ? [primary] : []), ...extras];
}

/** 不含代碼的地形或資源名稱，例如「木材」「沙漠」「海洋」。 */
export function tileName(context: ReferenceContext, hex: number): string {
  if (context.fog?.has(hex)) return t(context.locale, 'board.tileUnexplored');
  const terrain = context.board.terrain[hex] ?? 'sea';
  const resource = resourceOfTerrain(terrain);
  if (resource) return t(context.locale, `resource.${resource}`);
  return t(context.locale, `terrain.${terrain}`).replace(TERRAIN_CODE, '');
}

/** 單一地塊的參照，例如「木材（6）」；沒有點數的地塊只寫名稱。 */
export function tileRef(context: ReferenceContext, hex: number): string {
  const name = tileName(context, hex);
  const numbers = context.fog?.has(hex) ? [] : tileNumbers(context.board, hex);
  return numbers.length > 0 ? t(context.locale, 'board.tileRef', { tile: name, numbers }) : name;
}

function tileWeight(board: PublicBoardView, hex: number): number {
  return tileNumbers(board, hex).reduce((sum, number) => sum + pipsFor(number), 0);
}

/** 依產出機率由高到低排序，同機率時依地圖順序，讓同一組地塊的描述固定不變。 */
function sortTiles(context: ReferenceContext, hexes: readonly number[]): number[] {
  return [...hexes].sort((a, b) => tileWeight(context.board, b) - tileWeight(context.board, a) || a - b);
}

function tileList(context: ReferenceContext, hexes: readonly number[]): string {
  return t(context.locale, 'board.tileList', { tiles: hexes.map((hex) => tileRef(context, hex)) });
}

interface Anchor {
  /** 位置本身接觸的地塊（含海洋）；提示不會重複列出。 */
  own: readonly number[];
  /** 尋找鄰近地塊的起點交點。 */
  seeds: readonly number[];
}

const hexVerticesCache = new WeakMap<BoardTopology, number[][]>();

function hexVertices(topology: BoardTopology): number[][] {
  let cached = hexVerticesCache.get(topology);
  if (!cached) {
    cached = topology.hexes.map(() => []);
    topology.vertices.forEach((vertex, index) => {
      for (const hex of vertex.hexes) cached![hex]?.push(index);
    });
    hexVerticesCache.set(topology, cached);
  }
  return cached;
}

function anchorOf(context: ReferenceContext, kind: ReferenceKind, index: number): Anchor {
  const { topology } = context;
  if (kind === 'vertex') return { own: topology.vertices[index]?.hexes ?? [], seeds: [index] };
  if (kind === 'edge') {
    const edge = topology.edges[index];
    return { own: edge?.hexes ?? [], seeds: edge?.vertices ?? [] };
  }
  return { own: [index], seeds: hexVertices(topology)[index] ?? [] };
}

/** 由位置向外逐層擴散，回傳最先遇到、且不屬於位置本身的陸地地塊。 */
function nearbyTiles(context: ReferenceContext, anchor: Anchor): number[] {
  const { topology } = context;
  const own = new Set(anchor.own);
  const visited = new Set(anchor.seeds);
  let frontier = [...anchor.seeds];
  for (let depth = 0; depth <= MAX_HINT_DEPTH && frontier.length > 0; depth += 1) {
    const found = new Set<number>();
    for (const vertex of frontier) {
      for (const hex of topology.vertices[vertex]?.hexes ?? []) {
        if (!own.has(hex) && isLand(context, hex)) found.add(hex);
      }
    }
    if (found.size > 0) return sortTiles(context, [...found]).slice(0, MAX_HINT_TILES);
    const next: number[] = [];
    for (const vertex of frontier) {
      for (const edge of topology.vertices[vertex]?.edges ?? []) {
        for (const other of topology.edges[edge]?.vertices ?? []) {
          if (visited.has(other)) continue;
          visited.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return [];
}

function landOf(context: ReferenceContext, hexes: readonly number[]): number[] {
  return sortTiles(context, hexes.filter((hex) => isLand(context, hex)));
}

/** 不含區分提示的描述；回傳 null 表示位置沒有自己的陸地（外海），一律需要提示。 */
function baseReference(context: ReferenceContext, kind: ReferenceKind, index: number): string | null {
  const { locale, topology } = context;
  if (kind === 'hex') return isLand(context, index) ? tileRef(context, index) : null;
  if (kind === 'vertex') {
    const land = landOf(context, topology.vertices[index]?.hexes ?? []);
    return land.length > 0 ? tileList(context, land) : null;
  }
  const land = landOf(context, topology.edges[index]?.hexes ?? []);
  if (land.length >= 2) {
    return t(locale, 'board.edgeBetween', { a: tileRef(context, land[0]!), b: tileRef(context, land[1]!) });
  }
  if (land.length === 1) return t(locale, 'board.edgeCoast', { tile: tileRef(context, land[0]!) });
  return null;
}

function itemCount(topology: BoardTopology, kind: ReferenceKind): number {
  if (kind === 'vertex') return topology.vertices.length;
  if (kind === 'edge') return topology.edges.length;
  return topology.hexes.length;
}

/** 單一位置補完區分提示後的描述（尚未保證全盤唯一）。 */
function hintedReference(context: ReferenceContext, kind: ReferenceKind, index: number, counts: Map<string, number>): string {
  const base = baseReference(context, kind, index);
  const needsHint = base === null || (counts.get(base) ?? 0) > 1;
  const place = base ?? (kind === 'hex' ? tileRef(context, index) : t(context.locale, 'board.openSea'));
  if (!needsHint) return place;
  const nearby = nearbyTiles(context, anchorOf(context, kind, index));
  if (nearby.length === 0) return place;
  return t(context.locale, 'board.nearTiles', { place, tiles: nearby.map((hex) => tileRef(context, hex)) });
}

function coordinate(topology: BoardTopology, kind: ReferenceKind, index: number): { x: number; y: number } {
  const item = kind === 'vertex' ? topology.vertices[index] : kind === 'edge' ? topology.edges[index] : topology.hexes[index];
  return { x: item?.x ?? 0, y: item?.y ?? 0 };
}

/**
 * 整張地圖同一種位置的描述。先以地塊描述，重複者補最近的其他地塊；
 * 補完仍重複（對稱的沿岸位置、遠離陸地的外海、未探索區）時，
 * 在該組內依座標由上到下、由左到右補「同類第 n 個」，確保沒有兩個位置共用名稱。
 */
function referenceTable(context: ReferenceContext, kind: ReferenceKind): string[] {
  const count = itemCount(context.topology, kind);
  const baseCounts = new Map<string, number>();
  for (let index = 0; index < count; index += 1) {
    const base = baseReference(context, kind, index);
    if (base !== null) baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }
  const labels = Array.from({ length: count }, (_, index) => hintedReference(context, kind, index, baseCounts));
  const groups = new Map<string, number[]>();
  labels.forEach((label, index) => groups.set(label, [...(groups.get(label) ?? []), index]));
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ordered = [...members].sort((a, b) => {
      const pa = coordinate(context.topology, kind, a);
      const pb = coordinate(context.topology, kind, b);
      return pa.y - pb.y || pa.x - pb.x || a - b;
    });
    ordered.forEach((index, order) => {
      labels[index] = t(context.locale, 'board.sameKind', { place: labels[index], n: order + 1, total: ordered.length });
    });
  }
  return labels;
}

const tableCache = new WeakMap<PublicBoardView, Map<string, string[]>>();

/** 描述只依公開棋盤與未探索地塊計算，故以棋盤物件快取。 */
function cachedTable(context: ReferenceContext, kind: ReferenceKind): string[] {
  let byKey = tableCache.get(context.board);
  if (!byKey) {
    byKey = new Map();
    tableCache.set(context.board, byKey);
  }
  const fogKey = context.fog ? [...context.fog.keys()].sort((a, b) => a - b).join(',') : '';
  const key = `${context.locale}|${context.topology.id}|${kind}|${fogKey}`;
  let table = byKey.get(key);
  if (!table) {
    table = referenceTable(context, kind);
    byKey.set(key, table);
  }
  return table;
}

/** 棋盤位置的文字參照；同一種位置在整張地圖上的名稱彼此不同。 */
export function boardReference(context: ReferenceContext, kind: ReferenceKind, index: number): string {
  return cachedTable(context, kind)[index] ?? '';
}

export function vertexReference(context: ReferenceContext, index: number): string {
  return boardReference(context, 'vertex', index);
}

export function edgeReference(context: ReferenceContext, index: number): string {
  return boardReference(context, 'edge', index);
}

export function hexReference(context: ReferenceContext, index: number): string {
  return boardReference(context, 'hex', index);
}
