/**
 * Seafarers 的強盜與海盜（SF 計畫 §4.2；D-SF2、D-SF7）：`banditCandidates` 提供海盜候選，與 base 的
 * 強盜候選一起評分；`preroll` 在海盜擋住我的航線時打騎士把海盜移走。
 *
 * 海盜候選（hex 或外框 null）的分數＝可偷的對手＋封鎖對手 open-end 船的前線－封鎖我自己的航線：
 * - 可偷的對手：該 hex 的邊上有對手的船、而且對手有牌；與 base 強盜的偷牌加成相同，只看公開的手牌張數。
 * - 封鎖前線：對手每艘 open-end 船的下一步（`shipEdgesOf`）中，鄰接該 hex 的邊，乘上領先係數。
 * - 封鎖我的航線：「我的航線」是海盜不在時、朝價值最高的小島空點（`islandSites`）的船路徑。以搜尋比較
 *   「海盜在這個 hex」與「沒有海盜」的最佳航線價值差，所以繞得過去的海盜不扣分。
 * - 海盜現在擋住我時（差 > 0），移走它本身就有收益：每個不再擋住我的候選都加上這個差（`relief`），
 *   外框 `null` 只有這個收益加上微小的偏好，所以只在「擋住我、而且沒有更好的目標」時才會勝出。
 * - 基準是現況：base 的強盜候選分數是「把強盜放在那裡的好壞」，並不含「把強盜移離目前的格子」的收益，
 *   所以移海盜（強盜留在原處）要扣掉強盜目前壓在我身上的損失（base 評分套用在強盜所在的格子上），
 *   以及海盜離開 P 之後放開的對手前線。否則強盜與海盜同時擋住我時，海盜會因為多了一項收益而佔便宜。
 *
 * 這裡的「航線」是自己用海域模型算的，沒有讀 SF-2a 的計畫（兩個切片並行開發）；兩者若日後漂移，
 * 以 SF-3 的 bench 為準再調。決定性：不讀事件、不消耗亂數；同分取候選順序在前者（hex 由小到大，null 最後）。
 */

import { canPlay } from '../../base/cards.ts';
import { robberCandidates } from '../../base/robber.ts';
import type { BoardModel } from '../../board.ts';
import { searchShips, shipEdgesOf, shipsLeft } from '../../sea.ts';
import type { BanditTarget, BotModule, Scored, TurnContext } from '../types.ts';
import { moduleHints } from '../view.ts';
import { claimedIslands, islandSites, shipDiscount, type IslandSite } from './setup.ts';

/** 航線最多幾艘新船（SF 計畫 §4.2 的島嶼聚落計畫上限）。 */
const ROUTE_REACH = 4;
/** 每條被封鎖的對手前線邊的價值，以及單一對手最多計幾條。 */
const FRONT_VALUE = 1.5;
const FRONT_CAP = 2;
/** `null` 相對於「毫無作用的 hex」的微小偏好：海盜離場不會在日後擋住自己。 */
const NULL_BONUS = 0.1;
/** preroll 打騎士移海盜的最低收益（加權點數）；未經對局調校，SF-3 的 bench 之後再調。 */
const PREROLL_RELIEF_MIN = 5;

interface PirateOption {
  readonly target: BanditTarget;
  readonly score: number;
  /** 這個選擇替我的航線解除的封鎖（海盜現在擋住的價值，扣掉新位置仍擋住的部分）。 */
  readonly relief: number;
}

/** 與 base 強盜相同的領先係數：領先者、接近勝利者的船更值得封鎖。 */
function leadFactor(turn: TurnContext, ownerScore: number): number {
  return (
    1 + 0.35 * Math.max(0, ownerScore - turn.me.publicScore) + (ownerScore >= turn.view.victoryTarget - 3 ? 0.8 : 0)
  );
}

/**
 * base 強盜評分套用在強盜目前所在的格子上的分數（base 的候選會跳過這一格）：負值代表強盜壓著自己的建築，
 * 移走它有收益；正值代表它正壓著對手。以同一個公式計算，只是把強盜暫時看成不在任何格子上。
 */
function robberScoreHere(turn: TurnContext): number {
  const { view } = turn;
  const here = view.board.robber;
  const away = Object.create(turn, { view: { value: { ...view, board: { ...view.board, robber: -1 } } } }) as TurnContext;
  return robberCandidates(away).find((candidate) => candidate.item === here)?.score ?? 0;
}

/** 海盜移到 `hex`（null 是外框）的盤面；其餘不變。 */
function withPirate(model: BoardModel, hex: number | null): BoardModel {
  return { ...model, view: { ...model.view, board: { ...model.view.board, pirate: hex } } };
}

/** 在 `model` 上，ROUTE_REACH 艘（受船存量限制）以內到達小島空點的最佳價值（含距離折扣）。 */
function routeValue(model: BoardModel, sites: readonly IslandSite[], depth: number): number {
  if (depth <= 0) return 0;
  const { distance } = searchShips(model, model.selfId, depth);
  let best = 0;
  for (const site of sites) {
    const ships = distance[site.vertex]!;
    if (ships <= depth) best = Math.max(best, site.value * shipDiscount(ships));
  }
  return best;
}

/** 對手 open-end 船的前線：下一步能放船、而且接在沒有自己棋子的船端（規則的 open end）上的邊。 */
function frontier(model: BoardModel, playerId: string): ReadonlySet<number> {
  const { buildings, roads } = model.view.board;
  const ends = new Set<number>();
  roads.forEach((road, edge) => {
    if (!road || !road.ship || road.player !== playerId) return;
    for (const vertex of model.topo.edges[edge]!.vertices) {
      if (buildings[vertex]?.player === playerId) continue;
      const linked = model.topo.vertices[vertex]!.edges.some((other) => {
        const piece = roads[other];
        return other !== edge && !!piece && piece.ship && piece.player === playerId;
      });
      if (!linked) ends.add(vertex);
    }
  });
  const out = new Set<number>();
  if (ends.size === 0) return out;
  for (const edge of shipEdgesOf(model, playerId)) {
    if (model.topo.edges[edge]!.vertices.some((vertex) => ends.has(vertex))) out.add(edge);
  }
  return out;
}

/** 海盜移到 `hex` 時能偷的對手中，最多的手牌張數（沒有則 0）。 */
function stealableHand(turn: TurnContext, hex: number): number {
  const { model, view, ctx } = turn;
  let most = 0;
  view.board.roads.forEach((road, edge) => {
    if (!road || !road.ship || road.player === ctx.selfId || !model.topo.edges[edge]!.hexes.includes(hex)) return;
    const owner = view.players.find((player) => player.id === road.player);
    if (owner && owner.handSize > most) most = owner.handSize;
  });
  return most;
}

/** 所有海盜選擇（hints 的 `pirateTargets`）與各自的分數；沒有 hints 時為空。 */
function pirateOptions(turn: TurnContext): PirateOption[] {
  const targets = moduleHints(turn.view.hints, 'seafarers')?.pirateTargets ?? [];
  if (targets.length === 0) return [];
  const { model, view, ctx } = turn;
  const sites = islandSites(model, claimedIslands(view, ctx.selfId));
  const depth = Math.min(ROUTE_REACH, shipsLeft(model));
  const free = withPirate(model, null);
  const best = routeValue(free, sites, depth);
  // 海盜現在擋住我的價值；沒有海盜（或繞得過去）時為 0。
  const unblock = best - routeValue(model, sites, depth);
  // 對手的前線以「沒有海盜」的盤面計算，才看得到海盜現在已經擋住的邊。
  const fronts = view.players
    .filter((player) => player.id !== ctx.selfId)
    .map((player) => ({ lead: leadFactor(turn, player.publicScore), edges: frontier(free, player.id) }))
    .filter((front) => front.edges.size > 0);
  const frontValue = (hex: number): number => {
    let value = 0;
    for (const front of fronts) {
      let touching = 0;
      for (const edge of front.edges) if (model.topo.edges[edge]!.hexes.includes(hex)) touching += 1;
      value += FRONT_VALUE * Math.min(touching, FRONT_CAP) * front.lead;
    }
    return value;
  };
  // 現況的基準（見檔頭）：強盜留在原處，海盜離開 P 放開 P 封鎖的對手前線。
  const pirateHere = view.board.pirate;
  const baseline = robberScoreHere(turn) - (pirateHere === null ? 0 : frontValue(pirateHere));
  const options: PirateOption[] = [];
  for (const target of targets) {
    if (target === null) {
      if (unblock > 0) options.push({ target, score: unblock + NULL_BONUS + baseline, relief: unblock });
      continue;
    }
    const stealable = stealableHand(turn, target);
    const raid = stealable > 0 ? 1.5 + 0.25 * Math.min(stealable, 8) : 0;
    const loss = best - routeValue(withPirate(model, target), sites, depth);
    options.push({ target, score: raid + frontValue(target) - loss + unblock + baseline, relief: unblock - loss });
  }
  return options;
}

/** easy 只移強盜：回 []，交給 base。 */
export const seafarersBanditCandidates: NonNullable<BotModule['banditCandidates']> = (turn) => {
  if (turn.level === 'easy') return [];
  return pirateOptions(turn).map<Scored<BanditTarget>>(({ target, score }) => ({ item: target, score }));
};

/**
 * 海盜擋住我的航線，而且有一個移法能解除它時，打騎士把海盜移走（base 的騎士條件不成立時才會被挑）。
 * 目標只在海盜的選擇裡挑（強盜解決不了這個問題），取分數最高者，同分取前面的。easy 同 base。
 * 強盜壓著自己的建築時由 base 的騎士條件先決定（被擋 ≥3 點），而且它的目標評分已含上述基準，所以這裡不另外比較。
 */
export const seafarersPreroll: NonNullable<BotModule['preroll']> = (turn) => {
  if (turn.level === 'easy' || !canPlay(turn, 'knight')) return [];
  let chosen: PirateOption | null = null;
  for (const option of pirateOptions(turn)) {
    if (option.relief >= PREROLL_RELIEF_MIN && (chosen === null || option.score > chosen.score)) chosen = option;
  }
  return chosen === null ? [] : [{ item: { type: 'dev.playKnight', hex: chosen.target }, score: chosen.relief }];
};
