/**
 * Seafarers 劇本的 variable setup（隨機版圖）產生器：四島群島（SF25 p. 7）、未知海域（p. 9）、
 * 穿越荒漠（p. 11）。S10a 切片，spec 2026-11-22-seafarers-scenarios.md §6.1–6.3、§10。
 *
 * 這些函式是純函式：輸入是該劇本 fixed 版圖的逐格轉錄（`LandHex[]`、`PortSpec[]`），輸出同形的陸地與港口，
 * 之後交給 `fixedLayout` 組成 layout。配件多重集（各地形數量、圓片數量、港口種類）直接取自 fixed 轉錄，
 * 所以與 SF25 配件表逐項相同（fixed 轉錄本身已由配件表檢查和核對）。框、海洋格、島區形狀都不變。
 * 全部抽籤只用傳入的 `Rng`，同一個 rng 序列產生同一張圖；fixed 模式完全不經過這裡。
 *
 * 約束與終止：
 *   - 四島群島：低點數圓片（2、3、11、12）先放到非森林、非草地的格子，其餘圓片再隨機分配。
 *     非森林／草地格數大於低點數圓片數（3 人 12 ≥ 6、4 人 13 ≥ 7），一次構造完成，無重抽。
 *   - 未知海域：已知陸地與圓片在兩座島區內隨機，紅色圓片可相鄰（SF25 p. 9），無約束，無重抽。
 *   - 穿越荒漠：紅色圓片不相鄰、不在金礦上。以「有界重抽」：每次嘗試重新抽外地位置、地形與紅色圓片位置，
 *     最多 `DESERT_MAX_ATTEMPTS` 次；仍失敗就退回 fixed 版圖的排列（SF25 印刷的圖本身符合約束，測試驗證），
 *     所以必定終止。實測 1,000 種子的最大嘗試次數記在測試中。
 */

import type { Rng } from './rng.ts';
import { shuffle } from './rng.ts';
import { L, type LandHex, type PortSpec } from './seafarers-boards.ts';
import { NEIGHBOR_DIRS, type HexCoord } from './topology.ts';
import type { Terrain } from './types.ts';

const key = (cell: HexCoord): string => `${cell.q},${cell.r}`;

const isRedDisc = (disc: number | null): boolean => disc === 6 || disc === 8;

const neighborKeys = (cell: HexCoord): string[] => NEIGHBOR_DIRS.map((dir) => key({ q: cell.q + dir.q, r: cell.r + dir.r }));

/** 港口位置不變，只洗牌種類（SF25 p. 7、p. 9：shuffle the port tokens / randomize which port）。 */
export function shufflePortTypes(ports: readonly PortSpec[], rng: Rng): PortSpec[] {
  const types = shuffle(ports.map((port) => port.type), rng);
  return ports.map((port, index) => ({ ...port, type: types[index]! }));
}

export interface VariableBoard {
  land: LandHex[];
  ports: PortSpec[];
}

/**
 * 在固定的陸地格上重新分配地形與圓片：地形洗牌；`isLow`（若給）指出「不得拿低點數圓片」的地形。
 * 低點數圓片先放進允許的格子，其餘圓片洗牌後放進剩下的格子。
 */
function redeal(land: readonly LandHex[], rng: Rng, forbidLow: ReadonlySet<Terrain>): LandHex[] {
  const terrains = shuffle(land.map((hex) => hex.terrain), rng);
  const discs = land.map((hex) => hex.number).filter((disc): disc is number => disc !== null);
  const low = shuffle(discs.filter((disc) => disc === 2 || disc === 3 || disc === 11 || disc === 12), rng);
  const rest = discs.filter((disc) => !(disc === 2 || disc === 3 || disc === 11 || disc === 12));
  const allowed = shuffle(land.map((_, index) => index).filter((index) => !forbidLow.has(terrains[index]!)), rng);
  if (low.length > allowed.length) throw new Error('variable setup: not enough cells for the low-value number discs');
  const numbers: (number | null)[] = land.map(() => null);
  low.forEach((disc, i) => { numbers[allowed[i]!] = disc; });
  const open = shuffle(land.map((_, index) => index).filter((index) => numbers[index] === null), rng);
  const pool = shuffle(rest, rng);
  open.forEach((cell, i) => { numbers[cell] = pool[i]!; });
  return land.map((hex, index) => L(hex.q, hex.r, terrains[index]!, numbers[index]!, hex.island));
}

/** 四島群島（SF25 p. 7）：陸地與圓片在四個島區內隨機；森林與草地不得放 2、3、11、12；港口種類洗牌。 */
export function variableFourIslandsBoard(land: readonly LandHex[], ports: readonly PortSpec[], rng: Rng): VariableBoard {
  return {
    land: redeal(land, rng, new Set<Terrain>(['forest', 'pasture'])),
    ports: shufflePortTypes(ports, rng),
  };
}

/** 未知海域（SF25 p. 9）：已知陸地與圓片在兩座島區內隨機（紅色圓片可相鄰）；港口位置不變、種類洗牌。 */
export function variableFogKnownBoard(land: readonly LandHex[], ports: readonly PortSpec[], rng: Rng): VariableBoard {
  return {
    land: redeal(land, rng, new Set<Terrain>()),
    ports: shufflePortTypes(ports, rng),
  };
}

// ---------------------------------------------------------------------------
// 穿越荒漠（SF25 p. 11）
// ---------------------------------------------------------------------------

/** 有界重抽上限；每次嘗試的成功機率很高（見測試的最大嘗試次數），超過就退回 fixed 排列。 */
export const DESERT_MAX_ATTEMPTS = 1000;

export interface DesertVariableBoard extends VariableBoard {
  /** 實際嘗試次數（1 起）；退回 fixed 排列時為 `DESERT_MAX_ATTEMPTS + 1`。 */
  attempts: number;
  fellBack: boolean;
}

/** 以 `cells` 為候選，依序挑出彼此不相鄰、也不與 `blocked` 相鄰的紅色位置；不足 `count` 個回傳 null。 */
function pickReds(cells: readonly HexCoord[], count: number, taken: Set<string>, rng: Rng): HexCoord[] | null {
  const picked: HexCoord[] = [];
  for (const cell of shuffle(cells, rng)) {
    if (picked.length === count) break;
    if (neighborKeys(cell).some((other) => taken.has(other))) continue;
    picked.push(cell);
    taken.add(key(cell));
  }
  return picked.length === count ? picked : null;
}

/**
 * 外地的島編號：外地陸地格依相鄰連成一座島，編號從 2 起、依 `order`（topology 的格序）遞增；
 * 主島（含沙漠）一律是 1。外地與主島相鄰時仍算不同的島，與 fixed 圖的綠框小陸地緊鄰沙漠的畫法一致
 * （SF25 p. 10–11：被沙漠隔出的陸地帶是 unexplored region；設置時只能放在所有周圍陸地都是主島的交叉點）。
 */
function numberUnexploredIslands(cells: readonly HexCoord[], order: readonly HexCoord[]): Map<string, number> {
  const unexplored = new Set(cells.map(key));
  const islandOf = new Map<string, number>();
  let next = 1;
  for (const cell of order) {
    if (!unexplored.has(key(cell)) || islandOf.has(key(cell))) continue;
    next += 1;
    const stack = [key(cell)];
    islandOf.set(key(cell), next);
    while (stack.length > 0) {
      const current = stack.pop()!;
      const [q, r] = current.split(',').map(Number) as [number, number];
      for (const other of neighborKeys({ q, r })) {
        if (unexplored.has(other) && !islandOf.has(other)) {
          islandOf.set(other, next);
          stack.push(other);
        }
      }
    }
  }
  return islandOf;
}

/**
 * 穿越荒漠（SF25 p. 11）：
 *   - 3 塊沙漠位置固定（保留 fixed 的沙漠與強盜位置）；
 *   - 主島的陸地、圓片、港口隨機放進主島區（fixed 主島的非沙漠格；港口位置不變、種類洗牌）；
 *   - 外地陸地與圓片隨機放進框內其餘位置（不含沙漠、主島區，也不含港口正對的格子，以免港口面向陸地）；
 *   - 紅色圓片（6、8）不相鄰，也不在金礦上（金礦只會出現在外地）。
 * `frame` 是該人數外框的全部格子（`topology.hexes`）。
 */
export function variableDesertBoard(
  frame: readonly HexCoord[],
  land: readonly LandHex[],
  ports: readonly PortSpec[],
  rng: Rng,
): DesertVariableBoard {
  const deserts = land.filter((hex) => hex.terrain === 'desert');
  const mainLand = land.filter((hex) => hex.island === 1 && hex.terrain !== 'desert');
  const unexploredLand = land.filter((hex) => hex.island !== 1);
  const occupied = new Set(land.filter((hex) => hex.island === 1).map(key));
  const portFacing = new Set(ports.map((port) => {
    const dir = NEIGHBOR_DIRS[port.side]!;
    return key({ q: port.q + dir.q, r: port.r + dir.r });
  }));
  const candidates = frame.filter((cell) => !occupied.has(key(cell)) && !portFacing.has(key(cell)));
  if (candidates.length < unexploredLand.length) throw new Error('variable setup: not enough room for the unexplored regions');

  const mainTerrains = mainLand.map((hex) => hex.terrain);
  const unexploredTerrains = unexploredLand.map((hex) => hex.terrain);
  const mainDiscs = mainLand.map((hex) => hex.number!);
  const unexploredDiscs = unexploredLand.map((hex) => hex.number!);
  const mainReds = mainDiscs.filter(isRedDisc);
  const unexploredReds = unexploredDiscs.filter(isRedDisc);
  const mainBlack = mainDiscs.filter((disc) => !isRedDisc(disc));
  const unexploredBlack = unexploredDiscs.filter((disc) => !isRedDisc(disc));

  for (let attempt = 1; attempt <= DESERT_MAX_ATTEMPTS; attempt++) {
    const unexploredCells = shuffle(candidates, rng).slice(0, unexploredLand.length);
    const mainTerrain = shuffle(mainTerrains, rng);
    const unexploredTerrain = shuffle(unexploredTerrains, rng);
    const terrainAt = new Map<string, Terrain>();
    mainLand.forEach((hex, index) => terrainAt.set(key(hex), mainTerrain[index]!));
    unexploredCells.forEach((cell, index) => terrainAt.set(key(cell), unexploredTerrain[index]!));

    // 紅色圓片：先主島、再外地（外地不放金礦），彼此與跨區都不相鄰。
    const taken = new Set<string>();
    const mainRedCells = pickReds(mainLand, mainReds.length, taken, rng);
    if (!mainRedCells) continue;
    const unexploredRedCells = pickReds(unexploredCells.filter((cell) => terrainAt.get(key(cell)) !== 'gold'), unexploredReds.length, taken, rng);
    if (!unexploredRedCells) continue;

    const numberAt = new Map<string, number>();
    mainRedCells.forEach((cell, index) => numberAt.set(key(cell), mainReds[index]!));
    unexploredRedCells.forEach((cell, index) => numberAt.set(key(cell), unexploredReds[index]!));
    const fill = (cells: readonly HexCoord[], black: readonly number[]): void => {
      const open = cells.filter((cell) => !numberAt.has(key(cell)));
      const pool = shuffle(black, rng);
      open.forEach((cell, index) => numberAt.set(key(cell), pool[index]!));
    };
    fill(mainLand, mainBlack);
    fill(unexploredCells, unexploredBlack);

    const islands = numberUnexploredIslands(unexploredCells, frame);
    return {
      land: [
        ...deserts,
        ...mainLand.map((hex) => L(hex.q, hex.r, terrainAt.get(key(hex))!, numberAt.get(key(hex))!, 1)),
        ...unexploredCells.map((cell) => L(cell.q, cell.r, terrainAt.get(key(cell))!, numberAt.get(key(cell))!, islands.get(key(cell))!)),
      ],
      ports: shufflePortTypes(ports, rng),
      attempts: attempt,
      fellBack: false,
    };
  }
  return { land: land.slice(), ports: ports.slice(), attempts: DESERT_MAX_ATTEMPTS + 1, fellBack: true };
}
