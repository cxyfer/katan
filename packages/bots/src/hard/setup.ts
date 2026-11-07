/**
 * hard 的開局放置（規格 §4 第 1 點）。
 *
 * - 評分是從自我對局學到的線性模型（`OPENING_WEIGHTS`）。
 * - 第一座聚落：對前幾名候選點，模擬蛇形順序中對手在兩座之間的選點（對手以 standard 的
 *   開局公式選點），再挑自己最好的第二座，以兩座的組合評分。
 * - 第二座聚落：直接以組合評分，加上之後對手的選點。
 * - 兩者都計入「搶走對手的好點」（模型的 `others` 項）。
 * - 開局道路：模擬之後的對手選點，朝還會留下來的好空點鋪。
 */

import { RESOURCES, type Command, type Resource } from '@catan/rules';
import { emptyYield, isFreeSpot, type BoardModel, type Yield } from '../board.ts';
import { resourceWeights } from '../economy.ts';
import type { HardTurn } from './turn.ts';

/**
 * logistic 迴歸係數（勝率的 log-odds，每單位原始特徵）。資料：4 人局 standard 對局 3000 局，
 * 開局時 70% 的機率從 standard 評分的前 8 名中隨機挑選，記錄每位玩家兩座聚落的特徵與最後
 * 是否獲勝（12000 筆）。5 折交叉驗證：對數概似 −0.539（只用常數項為 −0.562）。
 *
 * 另外試過：較早的一份資料（1800 局）、只用 3 人局的資料、只取 hard 座位的資料；bench
 * （每種設定 500 局）上都沒有比這份好。與 standard 的開局評分相比，4 人局勝率高 5 個百分點。
 */
const OPENING_WEIGHTS = {
  /** 兩座聚落的總點數，加上各資源的額外係數。 */
  total: 0.1041,
  resource: { lumber: 0.0129, brick: -0.0092, wool: 0.0397, grain: -0.0092, ore: 0.0281 } as Record<Resource, number>,
  /** 每多一種資源。 */
  distinct: 0.4596,
  /** min(木, 磚) 與 min(礦, 麥) 的點數：擴張與城市兩條路線。 */
  lumberBrick: 0.1137,
  oreGrain: 0.1062,
  /** 同一個點數重複出現的格數。 */
  duplicateNumber: 0.0123,
  genericHarbor: 0.181,
  /** 2:1 港口對應的資源點數（至少 3 點才算）；對不上的 2:1 港口是負的。 */
  matchedHarbor: 0.072,
  otherHarbor: -0.2468,
  /** 走 2–3 步可達的空點：最好、第二好的點數，以及 8 點以上的空點數。 */
  expansionBest: -0.002,
  expansionSecond: 0.028,
  expansionRich: 0.0468,
  /** 對手平均產能（點數）每多一點。 */
  others: -0.0907,
  /** 加權點數（standard 的稀有度權重 `resourceWeights`）。 */
  weighted: -0.0388,
  /** 自己的點數佔盤面該資源總點數的比例。 */
  share: { lumber: 0.7305, brick: 0.7999, wool: 0.2684, grain: 1.9694, ore: 0.7394 } as Record<Resource, number>,
};

/** 盤面上各資源的總點數。 */
function boardTotals(model: BoardModel): Yield {
  const out = emptyYield();
  model.hexResource.forEach((resource, hex) => {
    if (resource) out[resource] += model.hexPips[hex]!;
  });
  return out;
}

/** 第一座聚落要做前瞻的候選數（依單點評分取前幾名）。 */
const FIRST_CANDIDATES = 10;

function pipsAt(model: BoardModel, vertex: number): number {
  let pips = 0;
  for (const hex of model.topo.vertices[vertex]!.hexes) if (model.hexResource[hex]) pips += model.hexPips[hex]!;
  return pips;
}

function yieldAt(model: BoardModel, vertex: number): Yield {
  const out = emptyYield();
  for (const hex of model.topo.vertices[vertex]!.hexes) {
    const resource = model.hexResource[hex];
    if (resource) out[resource] += model.hexPips[hex]!;
  }
  return out;
}

/** 目前棋盤加上 `taken` 之後，`vertex` 是否還能蓋聚落（距離規則）。 */
function open(model: BoardModel, vertex: number, taken: ReadonlySet<number>): boolean {
  if (taken.has(vertex) || !isFreeSpot(model, vertex)) return false;
  return model.neighbors[vertex]!.every((neighbor) => !taken.has(neighbor));
}

/** 從自己的聚落走 2–3 步可達的空點點數，由大到小（對手建築擋路）。 */
function expansionSpots(model: BoardModel, own: readonly number[], taken: ReadonlySet<number>, selfId: string): number[] {
  const { buildings } = model.view.board;
  const ownSet = new Set(own);
  const blocked = (vertex: number): boolean =>
    (!!buildings[vertex] && buildings[vertex]!.player !== selfId) || (taken.has(vertex) && !ownSet.has(vertex));
  const distance = new Map<number, number>();
  const queue: number[] = [];
  for (const vertex of own) {
    distance.set(vertex, 0);
    queue.push(vertex);
  }
  for (let head = 0; head < queue.length; head++) {
    const vertex = queue[head]!;
    const depth = distance.get(vertex)!;
    if (depth >= 3) continue;
    for (const next of model.neighbors[vertex]!) {
      if (distance.has(next) || blocked(next)) continue;
      distance.set(next, depth + 1);
      queue.push(next);
    }
  }
  const all = new Set([...taken, ...own]);
  const out: number[] = [];
  for (const [vertex, depth] of distance) {
    if (depth >= 2 && open(model, vertex, all)) out.push(pipsAt(model, vertex));
  }
  return out.sort((a, b) => b - a);
}

/** 擴張項的上限（`expansionBest` 是負的，只算兩個正項；8 點以上的空點以 10 個計）。 */
const EXPANSION_BOUND = OPENING_WEIGHTS.expansionSecond * 15 + OPENING_WEIGHTS.expansionRich * 10;

/** 第二座候選先以不含擴張項的分數排序，只對前幾名算完整分數。 */
const SECOND_CANDIDATES = 6;

/** 一組開局聚落（自己的全部聚落）的模型分數；`taken` 是模擬中別人選走的點。 */
export function openingValue(
  model: BoardModel,
  selfId: string,
  vertices: readonly number[],
  taken: ReadonlySet<number> = new Set(),
  expansion = true,
): number {
  const w = OPENING_WEIGHTS;
  const total = emptyYield();
  const numbers = new Map<number, number>();
  let hexes = 0;
  for (const vertex of vertices) {
    for (const hex of model.topo.vertices[vertex]!.hexes) {
      const resource = model.hexResource[hex];
      const number = model.view.board.numbers[hex];
      if (!resource || number === null || number === undefined) continue;
      total[resource] += model.hexPips[hex]!;
      numbers.set(number, (numbers.get(number) ?? 0) + 1);
      hexes += 1;
    }
  }
  let value = 0;
  for (const resource of RESOURCES) {
    value += (w.total + w.resource[resource]) * total[resource];
    if (total[resource] > 0) value += w.distinct;
  }
  const weights = resourceWeights(model);
  const board = boardTotals(model);
  for (const resource of RESOURCES) {
    value += w.weighted * weights[resource] * total[resource];
    if (board[resource] > 0) value += (w.share[resource] * total[resource]) / board[resource];
  }
  value += w.lumberBrick * Math.min(total.lumber, total.brick);
  value += w.oreGrain * Math.min(total.ore, total.grain);
  value += w.duplicateNumber * (hexes - numbers.size);
  let generic = false;
  let other = false;
  let matched = 0;
  for (const vertex of vertices) {
    const harbor = model.harborAt[vertex];
    if (!harbor) continue;
    if (harbor === 'generic') generic = true;
    else if (total[harbor as Resource] >= 3) matched += total[harbor as Resource];
    else other = true;
  }
  if (generic) value += w.genericHarbor;
  if (other) value += w.otherHarbor;
  value += w.matchedHarbor * matched;
  if (!expansion) return value;
  const spots = expansionSpots(model, vertices, taken, selfId);
  value += w.expansionBest * (spots[0] ?? 0) + w.expansionSecond * (spots[1] ?? 0);
  value += w.expansionRich * spots.filter((pips) => pips >= 8).length;
  return value;
}

/**
 * 對手的選點估計：與 standard 的 `setupSpotScore`（`base/setup.ts`）相同的公式。電腦對手照這個公式
 * 選點；人類玩家的選擇也大致相同方向（點數、缺的資源、港口、第二座要能鋪路）。
 */
function rivalValue(
  model: BoardModel,
  weights: Record<Resource, number>,
  vertex: number,
  owned: Yield,
  round: 1 | 2,
): number {
  const spot = yieldAt(model, vertex);
  let value = 0;
  for (const resource of RESOURCES) {
    value += spot[resource] * weights[resource];
    if (spot[resource] > 0 && owned[resource] === 0) value += 2;
  }
  const harbor = model.harborAt[vertex];
  if (harbor === 'generic') value += 1;
  else if (harbor) value += owned[harbor as Resource] + spot[harbor as Resource] >= 5 ? 2.5 : 0.5;
  if (round === 2) {
    const combined = { ...owned };
    for (const resource of RESOURCES) combined[resource] += spot[resource];
    if (combined.lumber === 0) value -= 3;
    if (combined.brick === 0) value -= 3;
    if (combined.grain === 0) value -= 1.5;
    if (combined.wool === 0) value -= 1;
    if (combined.ore === 0) value -= 1;
    for (const hex of model.topo.vertices[vertex]!.hexes) if (model.hexResource[hex]) value += 0.3;
  }
  return value;
}

/** 擺放順序（座位的蛇形順序）與自己目前的位置；與投影不符時回傳 null。 */
function setupOrder(turn: HardTurn): { order: { id: string; round: 1 | 2 }[]; index: number } | null {
  const setup = turn.view.turn.setup;
  if (!setup) return null;
  const seats = turn.view.players.slice().sort((a, b) => a.seat - b.seat);
  const order = [
    ...seats.map((player) => ({ id: player.id, round: 1 as const })),
    ...seats
      .slice()
      .reverse()
      .map((player) => ({ id: player.id, round: 2 as const })),
  ];
  const index = order.length - setup.remaining;
  if (order[index]?.id !== turn.ctx.selfId) return null;
  return { order, index };
}

function buildingsOf(turn: HardTurn, playerId: string): number[] {
  const out: number[] = [];
  turn.view.board.buildings.forEach((building, vertex) => {
    if (building?.player === playerId) out.push(vertex);
  });
  return out;
}

/**
 * 對手依序貪婪選點（`rivals` 是選點順序），回傳被選走的點與對手總共拿到的點數。
 * `taken` 會被改寫。
 */
function simulateRivals(
  turn: HardTurn,
  rivals: readonly { id: string; round: 1 | 2 }[],
  taken: Set<number>,
): number {
  const { model } = turn;
  const weights = resourceWeights(model);
  const owned = new Map<string, Yield>();
  let pips = 0;
  for (const { id, round } of rivals) {
    let mine = owned.get(id);
    if (!mine) {
      mine = emptyYield();
      for (const vertex of buildingsOf(turn, id)) {
        const spot = yieldAt(model, vertex);
        for (const resource of RESOURCES) mine[resource] += spot[resource];
      }
      owned.set(id, mine);
    }
    let best = -1;
    let bestValue = -Infinity;
    for (let vertex = 0; vertex < model.topo.vertices.length; vertex++) {
      if (!open(model, vertex, taken)) continue;
      const value = rivalValue(model, weights, vertex, mine, round);
      if (value > bestValue) {
        bestValue = value;
        best = vertex;
      }
    }
    if (best < 0) break;
    taken.add(best);
    pips += pipsAt(model, best);
    const spot = yieldAt(model, best);
    for (const resource of RESOURCES) mine[resource] += spot[resource];
  }
  return pips;
}

/** 對手拿到的點數換算成模型分數（`others` 是對手的平均產能）。 */
function denial(turn: HardTurn, rivalPips: number): number {
  return OPENING_WEIGHTS.others * (rivalPips / Math.max(1, turn.opponents.length));
}

function settlementChoice(turn: HardTurn): number | null {
  const { view, model, ctx } = turn;
  const legal = view.hints?.legalSettlements ?? [];
  if (legal.length === 0) return null;
  const mine = buildingsOf(turn, ctx.selfId);
  const position = setupOrder(turn);
  const rivalsAfter = position ? position.order.slice(position.index + 1) : [];
  const ranked = legal
    .map((vertex) => ({ vertex, value: openingValue(model, ctx.selfId, [...mine, vertex]) }))
    .sort((a, b) => b.value - a.value || a.vertex - b.vertex)
    .slice(0, FIRST_CANDIDATES);
  if (!position) return ranked[0]!.vertex;
  const myNext = position.order.findIndex((entry, at) => at > position.index && entry.id === ctx.selfId);
  let best = ranked[0]!.vertex;
  let bestValue = -Infinity;
  for (const { vertex, value: single } of ranked) {
    const taken = new Set<number>([vertex]);
    let value: number;
    if (myNext < 0) {
      // 第二座：之後的對手選點只影響「搶點」。
      value = single + denial(turn, simulateRivals(turn, rivalsAfter, taken));
    } else {
      const between = position.order.slice(position.index + 1, myNext);
      const rivalPips = simulateRivals(turn, between, taken);
      const options: { spot: number; value: number }[] = [];
      for (let spot = 0; spot < model.topo.vertices.length; spot++) {
        if (!open(model, spot, taken)) continue;
        options.push({ spot, value: openingValue(model, ctx.selfId, [vertex, spot], taken, false) });
      }
      options.sort((a, b) => b.value - a.value || a.spot - b.spot);
      let second = -Infinity;
      for (const option of options.slice(0, SECOND_CANDIDATES)) {
        // 擴張項有上限：剩下的候選不可能超過目前最佳時就停。
        if (option.value + EXPANSION_BOUND < second) break;
        second = Math.max(second, openingValue(model, ctx.selfId, [vertex, option.spot], taken));
      }
      value = (second === -Infinity ? single : second) + denial(turn, rivalPips);
    }
    if (value > bestValue) {
      bestValue = value;
      best = vertex;
    }
  }
  return best;
}

export function hardSetupDecision(turn: HardTurn): Command | null {
  const { view } = turn;
  const stage = view.turn.setup?.stage;
  if (stage === 'building') {
    const vertex = settlementChoice(turn);
    return vertex === null ? null : { type: 'setup.placeBuilding', vertex };
  }
  if (stage === 'road') {
    const legal = view.hints?.legalRoads ?? [];
    const edge = roadChoice(turn, legal);
    return edge === null ? null : { type: 'setup.placeRoad', edge };
  }
  return null;
}

/**
 * 開局道路：先模擬之後所有對手的選點，再看道路遠端 1–2 步內還剩下的最好空點
 * （standard 不考慮會被搶走的點）。
 */
function roadChoice(turn: HardTurn, legal: readonly number[]): number | null {
  if (legal.length === 0) return null;
  const { model, ctx, view } = turn;
  const position = setupOrder(turn);
  const taken = new Set<number>();
  if (position) simulateRivals(turn, position.order.slice(position.index + 1).filter((entry) => entry.id !== ctx.selfId), taken);
  const own = buildingsOf(turn, ctx.selfId);
  let best = legal[0]!;
  let bestValue = -Infinity;
  for (const edge of legal) {
    const [a, b] = model.topo.edges[edge]!.vertices;
    const far = view.board.buildings[a]?.player === ctx.selfId ? b : a;
    let value = 0;
    const visit = (vertex: number, factor: number): void => {
      if (!open(model, vertex, taken)) return;
      value = Math.max(value, factor * (openingValue(model, ctx.selfId, [...own, vertex], taken, false) - openingValue(model, ctx.selfId, own, taken, false)));
    };
    visit(far, 1);
    for (const next of model.neighbors[far]!) if (next !== a && next !== b) visit(next, 0.75);
    if (value > bestValue) {
      bestValue = value;
      best = edge;
    }
  }
  return best;
}
