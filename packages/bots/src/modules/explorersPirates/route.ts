/**
 * E&P 的船航線規劃（計畫 §4.5-1）。純函式、不消耗亂數、迭代順序固定（edge 遞增）。
 *
 * E&P 的船是「邊」上的移動：每步 1 MP，轉移完全比照 rules 的 `stepsFrom`／`canStopFrom`：
 * - 路過海盜（不是自己的）要付 1 金過路費，每艘船每回合一次；
 * - 進入滿格邊（已有 2 艘其他船）要在這步之前剩 ≥ 2 MP，且那一步不能探索；
 * - 探索步會結束移動，所以只能是路徑的最後一步；
 * - 移動必須結束在非滿格邊（或能以 settler 就地定居）。
 * BFS 狀態是（邊、剩餘 MP、是否已付過路費）；金幣只在付費時扣 1，所以由 `paid` 推得。
 */

import { fogAtEnds, foundVertices, isSeaRoute, shipsOnEdge, type EpGeometry } from './geometry.ts';

/** 規劃用的世界：幾何加上「這艘船」的視角。 */
export interface RouteWorld {
  /** 與 `edge` 相鄰（共用一個端點）的海路，edge 遞增。 */
  readonly neighbors: (edge: number) => readonly number[];
  /** `edge` 上除了移動者之外的船數。 */
  readonly occupants: (edge: number) => number;
  /** 走到 `edge` 會探索。 */
  readonly explores: (edge: number) => boolean;
  /** 海盜（不是移動者的）貼著 `edge`，進出都要付過路費。 */
  readonly pirateAt: (edge: number) => boolean;
  /** 船停在 `edge` 時，船上 settler 可就地定居。 */
  readonly canFound: (edge: number) => boolean;
}

export interface RouteStep {
  readonly edge: number;
  readonly tribute: boolean;
  readonly full: boolean;
  readonly explores: boolean;
}

/** 以公開 view 建立某艘船的規劃世界；船不在盤面上時回 undefined。 */
export function routeWorld(g: EpGeometry, shipId: string): RouteWorld | undefined {
  const ship = g.ep.ships.find((entry) => entry.id === shipId);
  if (!ship) return undefined;
  const pirate = g.ep.pirate && g.ep.pirate.owner !== ship.player ? g.ep.pirate.hex : null;
  const settlers = ship.cargo.includes('settler') && (g.ep.players[ship.player]?.supply.settlements ?? 0) > 0;
  const neighbors = new Map<number, number[]>();
  return {
    neighbors(edge) {
      let out = neighbors.get(edge);
      if (!out) {
        const set = new Set<number>();
        for (const vertex of g.topo.edges[edge]?.vertices ?? []) {
          for (const other of g.topo.vertices[vertex]!.edges) if (other !== edge && isSeaRoute(g, other)) set.add(other);
        }
        out = [...set].sort((a, b) => a - b);
        neighbors.set(edge, out);
      }
      return out;
    },
    occupants: (edge) => shipsOnEdge(g, edge, ship.id),
    explores: (edge) => fogAtEnds(g, edge).length > 0,
    pirateAt: (edge) => pirate !== null && (g.topo.edges[edge]?.hexes.includes(pirate) ?? false),
    canFound: (edge) => settlers && foundVertices(g, edge, ship.player).length > 0,
  };
}

/** 從 `from` 走一步的候選（各 1 MP）；只看一步，往後的可達性由 `canStop` 檢查。 */
export function stepsFrom(w: RouteWorld, from: number, left: number, paid: boolean, gold: number): RouteStep[] {
  if (left <= 0) return [];
  const out: RouteStep[] = [];
  for (const edge of w.neighbors(from)) {
    const tribute = !paid && (w.pirateAt(from) || w.pirateAt(edge));
    if (tribute && gold < 1) continue;
    const explores = w.explores(edge);
    const full = w.occupants(edge) >= 2;
    if (full && (left <= 1 || explores)) continue;
    out.push({ edge, tribute, full, explores });
  }
  return out;
}

/** 船停在（可能滿格的）`edge`、剩 `left` MP 時，是否還能合法結束移動。 */
export function canStop(
  w: RouteWorld,
  edge: number,
  left: number,
  paid: boolean,
  gold: number,
  memo: Map<string, boolean> = new Map(),
): boolean {
  const key = `${edge}:${left}:${paid}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  const result =
    w.canFound(edge) ||
    stepsFrom(w, edge, left, paid, gold).some(
      (step) => !step.full || canStop(w, step.edge, left - 1, paid || step.tribute, gold, memo),
    );
  memo.set(key, result);
  return result;
}

/**
 * 這一步是否安全：非滿格步一律安全；滿格步只有在之後（剩 `left - 1` MP）仍能抵達非滿格邊或就地定居時才安全。
 * `left` 是這一步之前的 MP。
 */
export function isSafeStep(w: RouteWorld, step: RouteStep, left: number, paid: boolean, gold: number): boolean {
  return !step.full || canStop(w, step.edge, left - 1, paid || step.tribute, gold);
}

/** `from` 以 `left` MP 可走的安全步（與 rules 的 `stepTargets` 同義），edge 遞增。 */
export function safeSteps(w: RouteWorld, from: number, left: number, paid: boolean, gold: number): RouteStep[] {
  const memo = new Map<string, boolean>();
  return stepsFrom(w, from, left, paid, gold).filter(
    (step) => !step.full || canStop(w, step.edge, left - 1, paid || step.tribute, gold, memo),
  );
}

export interface RoutePath {
  /** 依序經過的邊（不含起點），最後一條是非滿格邊。 */
  readonly edges: readonly number[];
  /** 耗用的 MP（= edges.length）。 */
  readonly mp: number;
  /** 路上付了過路費。 */
  readonly tribute: boolean;
}

/**
 * 到所有可停靠邊的最短路徑（BFS 層層展開，同層依 edge 遞增，所以結果決定性）。
 * 只有非滿格邊可以當終點；探索步只能是最後一步（不再往外展開）。起點本身不在結果內。
 */
export function reachableEdges(w: RouteWorld, from: number, left: number, paid: boolean, gold: number): Map<number, RoutePath> {
  const best = new Map<number, RoutePath>();
  const seen = new Set<string>([`${from}:${left}:${paid}`]);
  let layer: { edge: number; path: number[]; paid: boolean; tribute: boolean }[] = [{ edge: from, path: [], paid, tribute: false }];
  for (let mp = left; mp > 0 && layer.length > 0; mp--) {
    const next: typeof layer = [];
    for (const node of layer) {
      for (const step of stepsFrom(w, node.edge, mp, node.paid, gold)) {
        const paidNow = node.paid || step.tribute;
        const key = `${step.edge}:${mp - 1}:${paidNow}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const path = [...node.path, step.edge];
        const tribute = node.tribute || step.tribute;
        if (!step.full && !best.has(step.edge) && step.edge !== from) best.set(step.edge, { edges: path, mp: path.length, tribute });
        if (!step.explores) next.push({ edge: step.edge, path, paid: paidNow, tribute });
      }
    }
    layer = next;
  }
  return best;
}

/** `from` 到 `target` 的最短安全路徑；目標是滿格邊、MP 不足或被擋住時回 null。 */
export function planRoute(w: RouteWorld, from: number, target: number, left: number, paid: boolean, gold: number): RoutePath | null {
  return reachableEdges(w, from, left, paid, gold).get(target) ?? null;
}
