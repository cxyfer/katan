/**
 * 官方 CATAN 5–6 人版圖（`official` 佈局模式）。
 *
 * 形狀為左右對稱的 3-4-5-6-5-4-3（30 塊、80 個交點、109 條邊、38 條海岸邊），
 * 每列都置中。`hex-r56` 的列起點會逐列漂移而成為歪斜的形狀，且索引已被
 * 回歸測試釘住，所以這裡另立拓撲 id，不動既有對局。
 *
 * 設定方式：地形隨機洗牌；數字 token 依 A→BB 的固定順序沿螺旋路徑擺放
 * （從左下角開始，逆時針由外向內，沙漠不放 token）；港口位置與種類是框上
 * 印好的，固定不洗牌。
 */

import type { Rng } from './rng.ts';
import { shuffle } from './rng.ts';
import { PAIRED_TERRAIN_MULTISET } from './layout.ts';
import type { BoardTopology, HarborSlotSpec, HexCoord, TopologyDefinition } from './topology.ts';
import type { BoardLayout, HarborType } from './types.ts';

export const OFFICIAL_56_TOPOLOGY_ID = 'hex-r56-official';

const ROW_LENGTHS = [3, 4, 5, 6, 5, 4, 3] as const;
/** 各列（r = -3…3）最左邊一塊的 q。 */
const ROW_STARTS = [0, -1, -2, -3, -3, -3, -3] as const;

const HEXES: readonly HexCoord[] = ROW_LENGTHS.flatMap((length, row) =>
  Array.from({ length }, (_, offset) => ({ q: ROW_STARTS[row]! + offset, r: row - 3 })));

/**
 * 框上的 11 個港口，依順時針由上方開始；`side` 是該格朝向鄰格的方向
 * （0 = 東、1 = 東北、2 = 西北、3 = 西、4 = 西南、5 = 東南）。
 */
const HARBORS: readonly (HarborSlotSpec & { type: HarborType })[] = [
  { q: 1, r: -3, side: 2, type: 'lumber' },
  { q: 2, r: -3, side: 1, type: 'generic' },
  { q: 2, r: -2, side: 0, type: 'grain' },
  { q: 1, r: 1, side: 0, type: 'ore' },
  { q: -1, r: 3, side: 5, type: 'generic' },
  { q: -2, r: 3, side: 4, type: 'wool' },
  { q: -3, r: 2, side: 4, type: 'generic' },
  { q: -3, r: 0, side: 4, type: 'generic' },
  { q: -3, r: 0, side: 3, type: 'generic' },
  { q: -2, r: -1, side: 2, type: 'brick' },
  { q: 0, r: -3, side: 3, type: 'wool' },
];

export const OFFICIAL_56_TOPOLOGY: TopologyDefinition = {
  id: OFFICIAL_56_TOPOLOGY_ID,
  hexes: HEXES,
  harborSlots: HARBORS.map(({ q, r, side }) => ({ q, r, side })),
};

export const OFFICIAL_56_HARBOR_TYPES: readonly HarborType[] = HARBORS.map((harbor) => harbor.type);

/**
 * 螺旋路徑：30 格全走一遍。外圈 A…O（16 格）、中圈 P…Y（11 格）、內圈 Z、AA、BB（3 格）。
 * 路徑上的沙漠沒有字母，直接跳過；沙漠落在哪一格由地形洗牌決定。
 */
export const OFFICIAL_56_SPIRAL: readonly HexCoord[] = [
  // 外圈：底邊向右、右緣向上、頂邊向左、左緣向下
  { q: -3, r: 3 }, { q: -2, r: 3 }, { q: -1, r: 3 }, // A B C
  { q: 0, r: 2 }, { q: 1, r: 1 }, { q: 2, r: 0 }, // D E 右端
  { q: 2, r: -1 }, { q: 2, r: -2 }, { q: 2, r: -3 }, // F G H
  { q: 1, r: -3 }, { q: 0, r: -3 }, { q: -1, r: -2 }, // I J K
  { q: -2, r: -1 }, { q: -3, r: 0 }, { q: -3, r: 1 }, { q: -3, r: 2 }, // L M N O
  // 中圈
  { q: -2, r: 2 }, { q: -1, r: 2 }, { q: 0, r: 1 }, { q: 1, r: 0 }, // P Q R S
  { q: 1, r: -1 }, // 中圈頂端
  { q: 1, r: -2 }, { q: 0, r: -2 }, { q: -1, r: -1 }, // T U V
  { q: -2, r: 0 }, { q: -2, r: 1 }, { q: -1, r: 1 }, // W X Y
  // 內圈
  { q: 0, r: 0 }, { q: 0, r: -1 }, { q: -1, r: 0 }, // Z AA BB
];

/** A→BB 的 28 個數字 token。 */
export const OFFICIAL_56_NUMBERS: readonly number[] = [
  2, 5, 4, 6, 3, 9, 8, 11, 11, 10, 6, 3, 8, 4,
  8, 10, 11, 12, 10, 5, 4, 9, 5, 9, 12, 3, 2, 6,
];

export function officialPairedLayout(topology: BoardTopology, rng: Rng): BoardLayout {
  if (topology.id !== OFFICIAL_56_TOPOLOGY_ID) {
    throw new Error(`official layout requires ${OFFICIAL_56_TOPOLOGY_ID}, got ${topology.id}`);
  }
  const terrain = shuffle(PAIRED_TERRAIN_MULTISET, rng);
  const numbers: (number | null)[] = topology.hexes.map(() => null);
  let cursor = 0;
  for (const coord of OFFICIAL_56_SPIRAL) {
    const hex = topology.hexes.findIndex((candidate) => candidate.q === coord.q && candidate.r === coord.r);
    if (hex < 0) throw new Error(`official spiral leaves the board at ${coord.q},${coord.r}`);
    if (terrain[hex] === 'desert') continue;
    numbers[hex] = OFFICIAL_56_NUMBERS[cursor++] ?? null;
  }
  return {
    topologyId: topology.id,
    terrain,
    numbers,
    harbors: topology.harborSlots.map((edge, index) => ({ edge, type: OFFICIAL_56_HARBOR_TYPES[index]! })),
    islands: topology.hexes.map(() => 0),
    robber: terrain.indexOf('desert'),
    pirate: null,
  };
}
