/**
 * E&P 的幾何輔助（E1）：由公開 view 推導霧格、海路、起始島與定居點。只用在規劃與估值，
 * 合法性仍以 hints 為準（P2）；判定式比照 rules 的 `geometry.ts`／`movement.ts`，不讀隱藏資訊。
 * 霧格在 `view.board.terrain` 裡是 `sea`，必須以 `V.fog` 排除。
 */

import { getTopology, type BoardTopology, type GameView } from '@katan/rules';
import type { EpView } from './view.ts';

export interface EpGeometry {
  readonly topo: BoardTopology;
  readonly view: GameView;
  readonly ep: EpView;
  /** 尚未探索的格子。 */
  readonly fog: ReadonlySet<number>;
}

/** 缺 view 或拓樸時回 undefined（不 throw）。 */
export function epGeometry(view: GameView, ep: EpView | undefined): EpGeometry | undefined {
  if (!ep || !view.board) return undefined;
  try {
    return { topo: getTopology(view.board.topologyId), view, ep, fog: new Set(ep.fog.map((entry) => entry.hex)) };
  } catch {
    return undefined;
  }
}

/** 已探索的海格（含魚場與 Council）。 */
export function isWater(g: EpGeometry, hex: number): boolean {
  return g.view.board.terrain[hex] === 'sea' && !g.fog.has(hex);
}

/** 已探索的陸地格（香料田、金礦也算）。 */
export function isExploredLand(g: EpGeometry, hex: number): boolean {
  const terrain = g.view.board.terrain[hex];
  return terrain !== undefined && terrain !== 'sea' && !g.fog.has(hex);
}

/** 海路：邊的任一側是已探索海格，或外框邊的唯一一側已探索。 */
export function isSeaRoute(g: EpGeometry, edge: number): boolean {
  const info = g.topo.edges[edge];
  if (!info) return false;
  if (info.hexes.some((hex) => isWater(g, hex))) return true;
  return info.hexes.length === 1 && !g.fog.has(info.hexes[0]!);
}

/** 邊兩端接觸的霧格（船到那裡會探索）。 */
export function fogAtEnds(g: EpGeometry, edge: number): number[] {
  const out = new Set<number>();
  for (const vertex of g.topo.edges[edge]?.vertices ?? []) {
    for (const hex of g.topo.vertices[vertex]!.hexes) if (g.fog.has(hex)) out.add(hex);
  }
  return [...out].sort((a, b) => a - b);
}

export function vertexTouchesFog(g: EpGeometry, vertex: number): boolean {
  return g.topo.vertices[vertex]!.hexes.some((hex) => g.fog.has(hex));
}

/** 邊上的船數；`except` 是移動中的船（它已離開原位，不算）。 */
export function shipsOnEdge(g: EpGeometry, edge: number, except?: string): number {
  return g.ep.ships.filter((ship) => ship.edge === edge && ship.id !== except).length;
}

/** 起始島的格子。 */
export function startIsland(g: EpGeometry): readonly number[] {
  return g.ep.startIsland;
}

/** 該格不能蓋建築的地點（未攻下的巢穴，或沒有自己 crew 的香料田）。 */
export function closedSite(g: EpGeometry, hex: number, playerId: string): boolean {
  const site = g.ep.sites.find((entry) => entry.hex === hex);
  if (!site) return false;
  if (site.kind === 'lair') return !site.captured;
  if (site.kind === 'spice') return !site.crews.includes(playerId);
  return false;
}

/** 船（所在邊 `edge`）的 settler 可以定居的路口；比照 rules 的 `foundTargets`，不含 settler 與供應檢查。 */
export function foundVertices(g: EpGeometry, edge: number, playerId: string): number[] {
  const buildings = g.view.board.buildings;
  return (g.topo.edges[edge]?.vertices ?? []).filter((vertex) => {
    if (buildings[vertex]) return false;
    const info = g.topo.vertices[vertex]!;
    if (!info.hexes.some((hex) => isExploredLand(g, hex)) || vertexTouchesFog(g, vertex)) return false;
    if (info.hexes.some((hex) => closedSite(g, hex, playerId))) return false;
    return info.edges.every((other) => g.topo.edges[other]!.vertices.every((end) => end === vertex || !buildings[end]));
  });
}
