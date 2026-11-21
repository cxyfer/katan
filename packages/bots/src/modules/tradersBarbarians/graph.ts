/**
 * 車隊與騎士的路徑工具（T&B 計畫 §3.2；S7 Traders、S6 BA 使用）。純函式，只讀拓樸與 view，不消耗亂數。
 *
 * 決定性（R2）：同分一律依編號決勝。Dijkstra 每次取出成本最低、編號最小的路口；成本相同的兩條路徑保留前一站編號
 * 較小的那條。邊的 BFS 依距離分層，同一層內依編號遞增。
 */

import type { BoardTopology, GameView } from '@katan/rules';

/** 走一條邊的成本；null 表示不能走。`from`、`to` 是邊的兩端。 */
export type StepCost = (edge: number, from: number, to: number) => number | null;

export interface VertexPaths {
  readonly source: number;
  /** 到每個路口的最低成本；走不到的是 Infinity。 */
  readonly cost: readonly number[];
  /** 最短路徑上的前一個路口；起點與走不到的路口是 -1。 */
  readonly prev: readonly number[];
  /** 從前一個路口走來的那條邊；起點與走不到的路口是 -1。 */
  readonly via: readonly number[];
}

/** 從 `source` 出發到每個路口的最短路徑（Dijkstra，成本必須非負）。`source` 不在盤面上時全部走不到。 */
export function vertexPaths(topo: BoardTopology, source: number, stepCost: StepCost): VertexPaths {
  const count = topo.vertices.length;
  const cost: number[] = Array<number>(count).fill(Infinity);
  const prev: number[] = Array<number>(count).fill(-1);
  const via: number[] = Array<number>(count).fill(-1);
  const done: boolean[] = Array<boolean>(count).fill(false);
  if (!Number.isInteger(source) || source < 0 || source >= count) return { source, cost, prev, via };
  cost[source] = 0;
  for (;;) {
    // 路口只有幾十個，線性掃描最簡單，也讓「同分取最小編號」一目了然。
    let current = -1;
    for (let vertex = 0; vertex < count; vertex++) {
      if (!done[vertex] && cost[vertex]! < Infinity && (current < 0 || cost[vertex]! < cost[current]!)) current = vertex;
    }
    if (current < 0) break;
    done[current] = true;
    for (const edge of topo.vertices[current]!.edges) {
      const [a, b] = topo.edges[edge]!.vertices;
      const next = a === current ? b : a;
      if (done[next]) continue;
      const step = stepCost(edge, current, next);
      if (step === null || !Number.isFinite(step) || step < 0) continue;
      const total = cost[current]! + step;
      if (total < cost[next]! || (total === cost[next]! && current < prev[next]!)) {
        cost[next] = total;
        prev[next] = current;
        via[next] = edge;
      }
    }
  }
  return { source, cost, prev, via };
}

/** 從起點到 `target` 的路口序列（含兩端）；走不到時回 null。 */
export function pathTo(paths: VertexPaths, target: number): number[] | null {
  if (!(paths.cost[target]! < Infinity)) return null;
  const out = [target];
  for (let at = target; at !== paths.source; at = paths.prev[at]!) out.push(paths.prev[at]!);
  return out.reverse();
}

/** 從起點到 `target` 依序經過的邊；走不到時回 null，起點本身是空陣列。 */
export function edgesTo(paths: VertexPaths, target: number): number[] | null {
  const path = pathTo(paths, target);
  return path ? path.slice(1).map((vertex) => paths.via[vertex]!) : null;
}

/**
 * 從邊 `from` 沿相連的邊走 `range` 步以內能到的邊與步數（不含 `from`；棋子不擋路），與 rules 的騎士射程相同
 * （`TB/barbarians/index.ts` 的 `reachable`）。依距離分層，同一層內依編號遞增。
 */
export function edgeDistances(topo: BoardTopology, from: number, range: number): Map<number, number> {
  const out = new Map<number, number>();
  if (!topo.edges[from]) return out;
  const seen = new Set<number>([from]);
  let frontier = [from];
  for (let step = 1; step <= range && frontier.length > 0; step++) {
    const next = new Set<number>();
    for (const edge of frontier) {
      for (const vertex of topo.edges[edge]!.vertices) {
        for (const other of topo.vertices[vertex]!.edges) if (!seen.has(other)) next.add(other);
      }
    }
    frontier = [...next].sort((a, b) => a - b);
    for (const edge of frontier) {
      seen.add(edge);
      out.set(edge, step);
    }
  }
  return out;
}

/**
 * Traders 的車隊走一條邊的成本，與 rules 的 `stepCost`（`TB/traders/index.ts`）相同：有道路 1 MP、沒有 2 MP，
 * 邊上有蠻族再加 2；經過對手的道路要付 1 gold 給道路的主人（`toll`）。
 */
export function wagonStepCost(
  view: Pick<GameView, 'board'>,
  selfId: string,
  edge: number,
  barbarians: ReadonlySet<number>,
): { readonly mp: number; readonly toll: string | null } {
  const road = view.board.roads[edge];
  const mp = (road ? 1 : 2) + (barbarians.has(edge) ? 2 : 0);
  return { mp, toll: road && road.player !== selfId ? road.player : null };
}
