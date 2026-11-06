/**
 * Seafarers 的開局放置（SF 計畫 §4.2）：登島加權，與 setup 的「路或船」。
 *
 * - setup building：base 的 `setupSpotScore` 加上 `islandSetupBonus`（≤3 艘船可達、尚未領取 +2 VP
 *   的小島）；easy 同 standard，由 `turn.pick` 的 topK 3 挑選。
 * - setup road：standard 比較最佳道路方向與最佳船方向（朝小島的第一步），取分數高者，同分取路；
 *   easy 只放路：回 undefined 讓 base 選路，`legalRoads` 為空時 base 回 null，改走保底（放 `setupShips[0]`）。
 * - 合法性一律取自 hints（`legalSettlements`、`legalRoads`、`setupShips`）；這裡的海域模型只用來估值。
 * - 決定性：不讀事件，不額外消耗亂數（挑選只經 `turn.pick`）。
 *
 * 評分單位與 `setupSpotScore` 相同（加權點數）。常數是未經對局調校的起點，SF-3 的 bench 之後再調。
 */

import { MAIN_ISLAND, type GameView } from '@catan/rules';
import { roadDirectionScore } from '../../base/roads.ts';
import { setupSpotScore } from '../../base/setup.ts';
import { isFreeSpot, playerYield, type BoardModel, type RoadSearch } from '../../board.ts';
import { resourceWeights, settlementSpotValue } from '../../economy.ts';
import { islandOfVertex, searchShips } from '../../sea.ts';
import type { BotCommand, BotModule, Scored, TurnContext } from '../types.ts';
import { moduleHints, moduleView } from '../view.ts';

/** 小島第一座聚落的 +2 VP 折成加權點數；一座聚落 1 VP 約 3 點，所以約 6 點。 */
export const ISLAND_VP_VALUE = 6;
/** 金礦每一點的價值：任一資源都行，高於一般資源權重（0.8–1.3）。 */
const GOLD_PIP_WEIGHT = 1.2;
/** 每多一艘船的折扣，與 `roadDirectionScore` 對第二步的 0.75 一致。 */
const SHIP_DISCOUNT = 0.75;
/** 開局時，聚落最遠能以幾艘船登島。 */
export const SETUP_REACH = 3;
/** 登島加權相對於聚落評分的比重：只傾向靠海的好點，不壓過產能。 */
const BONUS_WEIGHT = 0.5;

/** 離島上的一個空點與它的價值（加權點數）。 */
export interface IslandSite {
  readonly vertex: number;
  readonly island: number;
  readonly value: number;
}

/** 需要 `ships` 艘船才到得了的折扣；0 與 1 艘都不打折。 */
export function shipDiscount(ships: number): number {
  return SHIP_DISCOUNT ** Math.max(0, ships - 1);
}

/** 自己已領取 +2 VP 的小島 id。 */
export function claimedIslands(view: GameView, selfId: string): readonly number[] {
  return moduleView(view, 'seafarers')?.islandBonus?.[selfId] ?? [];
}

/** 與 `claimed` 無關的部分（空點、所在島、不含 +2 VP 的價值）；同一次決策內只算一次。 */
const siteCache = new WeakMap<BoardModel, readonly IslandSite[]>();

function baseSites(model: BoardModel): readonly IslandSite[] {
  const cached = siteCache.get(model);
  if (cached) return cached;
  const weights = resourceWeights(model);
  const mine = playerYield(model, model.selfId, true);
  const sites: IslandSite[] = [];
  for (let vertex = 0; vertex < model.topo.vertices.length; vertex++) {
    if (!isFreeSpot(model, vertex)) continue;
    // New Shores 3–6 人盤面沒有同時鄰接兩座島的路口，取最小的島 id 與規則的島嶼判定沒有差異。
    const island = islandOfVertex(model, vertex);
    if (island === null || island === MAIN_ISLAND) continue;
    let value = settlementSpotValue(model, vertex, weights, mine);
    for (const hex of model.topo.vertices[vertex]!.hexes) {
      if (model.hexGold[hex]) value += GOLD_PIP_WEIGHT * model.hexPips[hex]!;
    }
    sites.push({ vertex, island, value });
  }
  siteCache.set(model, sites);
  return sites;
}

/**
 * 小島（非主島）上目前可以蓋聚落的空點，由小到大。價值＝聚落的點數與缺少資源加成、金礦點數、
 * 以及尚未領取的 +2 VP（只在 New Shores 的島嶼規則下，與 rules 的 `claimIslands` 一致）。
 */
export function islandSites(model: BoardModel, claimed: readonly number[]): readonly IslandSite[] {
  const bonus = model.profile.scenario === 'new-shores';
  return baseSites(model).map((site) =>
    bonus && !claimed.includes(site.island) ? { ...site, value: site.value + ISLAND_VP_VALUE } : site,
  );
}

/** 不屬於任何座位的 id：把自己的棋子「移出」船搜尋的起點，但邊仍然被占用。 */
const DETACHED = '';

/**
 * 只從 `starts` 出發的船搜尋：自己的建築與船都不當起點（建築移除，船改成不屬於任何人，邊仍被占用），
 * 用來估算「如果從這裡出發」能到哪些路口。對手的建築仍會擋路。
 */
export function reachFrom(model: BoardModel, starts: readonly number[], maxDepth: number): RoadSearch {
  const self = model.selfId;
  const { board } = model.view;
  const buildings = board.buildings.map((building, vertex) =>
    starts.includes(vertex) ? { player: self, city: false } : building && building.player !== self ? building : null,
  );
  const roads = board.roads.map((road) => (road && road.player === self ? { ...road, player: DETACHED } : road));
  return searchShips({ ...model, view: { ...model.view, board: { ...board, buildings, roads } } }, self, maxDepth);
}

/**
 * 登島加權（純函式，SF+CK 的組合 setup 會重用）：`vertex` 若是開局聚落，能以 ≤3 艘船登上的
 * 小島中，價值（點數、金礦、未領取的 +2 VP）乘上距離折扣後最高者，再乘上比重。
 * 沒有可登的小島（或不是 Seafarers 盤面）時為 0。
 */
export function islandSetupBonus(turn: TurnContext, vertex: number): number {
  const { model, view, ctx } = turn;
  const sites = islandSites(model, claimedIslands(view, ctx.selfId));
  if (sites.length === 0) return 0;
  const { distance } = reachFrom(model, [vertex], SETUP_REACH);
  let best = 0;
  for (const site of sites) {
    const ships = distance[site.vertex]!;
    if (ships <= SETUP_REACH) best = Math.max(best, site.value * shipDiscount(ships));
  }
  return best * BONUS_WEIGHT;
}

/** setup 船的方向分數：這艘船之後最多再接 `SETUP_REACH - 1` 艘，能登上的最佳小島，折扣同路的第二步。 */
export function setupShipScore(turn: TurnContext, edge: number): number {
  const { model, view, ctx } = turn;
  const [a, b] = model.topo.edges[edge]!.vertices;
  // 船靠在剛放的聚落上；另一端才是出海的方向。
  const far = view.board.buildings[a]?.player === ctx.selfId ? b : a;
  const sites = islandSites(model, claimedIslands(view, ctx.selfId));
  const { distance } = reachFrom(model, [far], SETUP_REACH - 1);
  let best = 0;
  for (const site of sites) {
    const ships = 1 + distance[site.vertex]!;
    if (ships <= SETUP_REACH) best = Math.max(best, site.value * shipDiscount(ships));
  }
  return best;
}

export const seafarersSetup: NonNullable<BotModule['setup']> = (turn) => {
  const stage = turn.view.turn.setup?.stage;
  if (stage === 'building') {
    const legal = turn.view.hints?.legalSettlements ?? [];
    const vertex = turn.pick(legal.map((item) => ({ item, score: setupSpotScore(turn, item) + islandSetupBonus(turn, item) })));
    return vertex === null ? null : { type: 'setup.placeBuilding', vertex };
  }
  if (stage === 'road') {
    // easy 只放路：交給 base（同樣的路向評分與 topK 3）；沒有合法的路時 base 回 null，改走保底放船。
    if (turn.level === 'easy') return undefined;
    const roads = turn.view.hints?.legalRoads ?? [];
    const ships = moduleHints(turn.view.hints, 'seafarers')?.setupShips ?? [];
    // 路在前、船在後：同分時取路。
    const candidates: Scored<BotCommand>[] = [
      ...roads.map((edge) => ({ item: { type: 'setup.placeRoad', edge } as BotCommand, score: roadDirectionScore(turn, edge) })),
      ...ships.map((edge) => ({ item: { type: 'setup.placeShip', edge } as BotCommand, score: setupShipScore(turn, edge) })),
    ];
    return turn.pick(candidates);
  }
  return undefined;
};
