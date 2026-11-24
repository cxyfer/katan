/**
 * New World（新世界，SF25 p. 20）的隨機版圖產生器。
 *
 * 外框是 42 格（5-6-7-6-7-6-5），與 4 人 New Shores 相同（`NS4_CELLS`），但港口不是固定位置：
 * 設置階段由玩家輪流放，所以 topology 的 `harborSlots` 為空、layout 一開始沒有港口。
 *
 * 產生步驟（SF25 p. 20 SETUP）：
 *   1. 配件隨機面朝上放進框；
 *   2. 圓片隨機放到陸地；兩枚紅色圓片（6、8）相鄰時，把其中一枚與黑色圓片對調，直到所有紅色圓片分開。
 * 全部抽籤只用傳入的 `Rng`，同一個 rng 序列產生同一張圖。
 *
 * FIDELITY：SF25 寫「與相鄰的黑色圓片對調」，但相鄰的黑色圓片可能不存在或對調後又碰到另一枚紅色，
 * 只限相鄰無法保證可終止。這裡改為「與任一對調後不產生新相鄰紅色圓片的黑色圓片對調」（用 rng 選）。
 * 每次對調至少消除一對相鄰紅色且不新增，所以相鄰對數嚴格遞減；候選必定存在（見 `separateRedDiscs`）。
 */

import type { LayoutContext } from './layout-registry.ts';
import { shuffle, type Rng } from './rng.ts';
import { NS4_CELLS } from './seafarers-boards.ts';
import { NEIGHBOR_DIRS, type BoardTopology, type TopologyDefinition } from './topology.ts';
import type { BoardLayout, HarborType, Terrain } from './types.ts';

export const NEW_WORLD_TOPOLOGY_ID = 'sf-new-world';

/** 配件表（SF25 p. 20）：海洋 19、田野 5、小丘 4、高山 4、草地 5、森林 5，共 42；無沙漠、無金礦。 */
export const NW_HEX_COUNTS: Readonly<Partial<Record<Terrain, number>>> = {
  sea: 19, fields: 5, hills: 4, mountains: 4, pasture: 5, forest: 5,
};

/** 圓片（SF25 p. 20）：2:1、3:3、4:3、5:3、6:2、8:2、9:3、10:3、11:2、12:1，共 23。 */
export const NW_DISC_COUNTS: Readonly<Record<number, number>> = {
  2: 1, 3: 3, 4: 3, 5: 3, 6: 2, 8: 2, 9: 3, 10: 3, 11: 2, 12: 1,
};

/** 港口標記（SF25 p. 20）：5 個 2:1（各一種資源）與 5 個 3:1，共 10。 */
export const NW_PORT_TOKENS: readonly HarborType[] = [
  'lumber', 'brick', 'wool', 'grain', 'ore', 'generic', 'generic', 'generic', 'generic', 'generic',
];

/** VP（島嶼）標記數（SF25 p. 20）；每位玩家每座非 home island 最多一枚，3–4 人不會用完。 */
export const NW_VP_TOKENS = 16;

export const NW_TOPOLOGIES: readonly TopologyDefinition[] = [
  { id: NEW_WORLD_TOPOLOGY_ID, hexes: NS4_CELLS, harborSlots: [] },
];

const expand = <T extends string | number>(counts: Readonly<Partial<Record<T, number>>>): T[] =>
  (Object.entries(counts) as [string, number][]).flatMap(([key, count]) =>
    Array.from({ length: count }, () => (Number.isNaN(Number(key)) ? key : Number(key)) as T));

export const NW_TERRAIN_TILES: readonly Terrain[] = expand(NW_HEX_COUNTS);
export const NW_DISCS: readonly number[] = expand(NW_DISC_COUNTS);

const isRed = (disc: number | null): boolean => disc === 6 || disc === 8;

/** 每個 hex 的相鄰 hex 索引（只含框內格）。 */
export function hexNeighbors(topology: BoardTopology): number[][] {
  const byKey = new Map(topology.hexes.map((hex, index) => [`${hex.q},${hex.r}`, index]));
  return topology.hexes.map((hex) =>
    NEIGHBOR_DIRS.map((dir) => byKey.get(`${hex.q + dir.q},${hex.r + dir.r}`)).filter((index): index is number => index !== undefined));
}

/**
 * 把所有紅色圓片分開。每次挑一個仍與別的紅色相鄰的紅色圓片 R（rng），再從「對調後 R 的新位置不與
 * 任何紅色相鄰」的黑色圓片中用 rng 選一個對調。對調移走 R 的全部相鄰，且黑色圓片不會新增相鄰對，
 * 所以相鄰紅色對數嚴格遞減。候選必定存在：另外三枚紅色圓片至多封鎖 3 × 6 = 18 個黑色位置，
 * 而黑色圓片有 19 枚。回傳對調次數。
 */
export function separateRedDiscs(numbers: (number | null)[], neighbors: readonly number[][], rng: Rng): number {
  let swaps = 0;
  for (;;) {
    const conflicted = numbers.flatMap((disc, hex) => (isRed(disc) && neighbors[hex]!.some((other) => isRed(numbers[other]!)) ? [hex] : []));
    if (conflicted.length === 0) return swaps;
    const red = conflicted[rng.int(conflicted.length)]!;
    const candidates = numbers.flatMap((disc, hex) =>
      disc !== null && !isRed(disc) && neighbors[hex]!.every((other) => other === red || !isRed(numbers[other]!)) ? [hex] : []);
    if (candidates.length === 0) throw new Error('new world: no black disc can take the red disc');
    const black = candidates[rng.int(candidates.length)]!;
    const blackDisc = numbers[black]!;
    numbers[black] = numbers[red]!;
    numbers[red] = blackDisc;
    swaps += 1;
  }
}

export interface NewWorldBoard {
  terrain: Terrain[];
  numbers: (number | null)[];
  islands: number[];
  /** 紅色圓片對調的次數（供測試與紀錄）。 */
  swaps: number;
}

/** 連通的陸地格各是一座島，編號從 1 起，依最小 hex 索引遞增（同一張圖編號固定）。 */
export function islandsOf(terrain: readonly Terrain[], neighbors: readonly number[][]): number[] {
  const islands = terrain.map(() => 0);
  let next = 0;
  terrain.forEach((tile, start) => {
    if (tile === 'sea' || islands[start] !== 0) return;
    next += 1;
    const stack = [start];
    islands[start] = next;
    while (stack.length > 0) {
      const hex = stack.pop()!;
      for (const other of neighbors[hex]!) {
        if (terrain[other] !== 'sea' && islands[other] === 0) {
          islands[other] = next;
          stack.push(other);
        }
      }
    }
  });
  return islands;
}

/** 產生一張新世界版圖（地形、圓片、島編號）；全部抽籤用 `rng`。 */
export function generateNewWorldBoard(topology: BoardTopology, rng: Rng): NewWorldBoard {
  if (topology.hexes.length !== NW_TERRAIN_TILES.length) {
    throw new Error(`topology ${topology.id} has ${topology.hexes.length} hexes, expected ${NW_TERRAIN_TILES.length}`);
  }
  const neighbors = hexNeighbors(topology);
  const terrain = shuffle(NW_TERRAIN_TILES, rng);
  const discs = shuffle(NW_DISCS, rng);
  const numbers: (number | null)[] = terrain.map((tile) => (tile === 'sea' ? null : discs.shift()!));
  const swaps = separateRedDiscs(numbers, neighbors, rng);
  return { terrain, numbers, islands: islandsOf(terrain, neighbors), swaps };
}

/**
 * Layout builder，登記為 `sf-new-world`：3、4 人同一個 42 格外框。強盜與海盜依 SF25 p. 20 的圖
 * 都在框上（強盜 -1「在棋盤旁」、海盜 `null`，與 New Shores 的海盜相同）；沒有港口，由玩家設置時放。
 */
export function newWorldLayout(context: LayoutContext, topologyFor: (id: string) => BoardTopology): BoardLayout {
  const topology = topologyFor(NEW_WORLD_TOPOLOGY_ID);
  const board = generateNewWorldBoard(topology, context.rng);
  return {
    topologyId: topology.id,
    terrain: board.terrain,
    numbers: board.numbers,
    harbors: [],
    islands: board.islands,
    robber: -1,
    pirate: null,
  };
}
