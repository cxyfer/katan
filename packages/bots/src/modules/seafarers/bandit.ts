/**
 * Seafarers 的強盜與海盜（SF 計畫 §4.2；D-SF2、D-SF7）：`banditCandidates` 提供海盜候選，與 base 的
 * 強盜候選一起評分；`preroll` 在海盜擋住我的航線時打騎士把海盜移走。
 *
 * 海盜候選（hex 或外框 null）的分數＝可偷的對手＋封鎖對手 open-end 船的前線－封鎖我自己的航線：
 * - 可偷的對手：該 hex 的邊上有對手的船、而且對手有牌；與 base 強盜的偷牌加成相同，只看公開的手牌張數。
 * - 封鎖前線：對手每艘 open-end 船的下一步（`shipEdgesOf`）中，鄰接該 hex 的邊，乘上領先係數。
 * - 封鎖我的航線：「我的航線」就是 SF-2a 的島嶼聚落計畫（`islandSettlementPlans`，與 bot 實際在走的計畫
 *   同一份目標排序與船路徑上限）。比較「沒有海盜」與「海盜在這個 hex」兩種盤面下最好的計畫 score
 *   （換成加權點數），所以繞得過去的海盜不扣分，沒有船可造時也不擋住什麼。
 * - 海盜現在擋住我時（差 > 0），移走它本身就有收益：每個不再擋住我的候選都加上這個差（`unblock`），
 *   外框 `null` 只有這個收益加上微小的偏好，所以只在「擋住我、而且沒有更好的目標」時才會勝出。
 * - 基準是現況：base 的強盜候選分數是「把強盜放在那裡的好壞」，並不含「把強盜移離目前的格子」的收益，
 *   所以移海盜（強盜留在原處）要扣掉強盜目前壓在我身上的損失（base 評分套用在強盜所在的格子上），
 *   以及海盜離開 P 之後放開的對手前線。否則強盜與海盜同時擋住我時，海盜會因為多了一項收益而佔便宜。
 *   強盜那一側不含偷牌加分（強盜留在原處偷不到牌），否則旁邊有對手又有牌時基準會多出 1.75–3.5 分。
 *
 * 兩種航線尺度（同一份計畫、不同的手牌假設）：
 * - 放置（`score`，7 點與騎士的目標挑選）：海盜放下後會停在盤面上好幾個回合，擋住的是這條航線「之後」
 *   的價值，不該因為此刻手牌少就縮水，否則手牌少的 bot 會為了偷牌把海盜放到自己的航線上，擲出 7
 *   時也不會移走擋路的海盜。所以用「付得起」的手牌評估，計畫分數只剩 value / (1 + 船數 × ETA_PER_SHIP)。
 * - 打騎士（`relief`、`net`，preroll 的門檻）：騎士是此刻要花的資源，手牌湊不出船時，限制你的不是
 *   海盜，不值得為它動用騎士，所以用真實手牌的 ETA。
 * 騎士打出後，目標格由放置的 `score` 決定。
 *
 * 決定性：不讀事件、不消耗亂數；同分取候選順序在前者（hex 由小到大，null 最後）。
 */

import { canPlay } from '../../base/cards.ts';
import { robberCandidates } from '../../base/robber.ts';
import type { BoardModel } from '../../board.ts';
import { PIP_VALUE, type Hand } from '../../economy.ts';
import { shipEdgesOf } from '../../sea.ts';
import type { BanditTarget, BotModule, Scored, TurnContext } from '../types.ts';
import { moduleHints } from '../view.ts';
import { islandSettlementPlans } from './plan.ts';

/** 每條被封鎖的對手前線邊的價值，以及單一對手最多計幾條。 */
const FRONT_VALUE = 1.5;
const FRONT_CAP = 2;
/** `null` 相對於「毫無作用的 hex」的微小偏好：海盜離場不會在日後擋住自己。 */
const NULL_BONUS = 0.1;
/** preroll 打騎士移海盜的最低收益（加權點數）；未經對局調校，SF-3 的 bench 之後再調。 */
const PREROLL_RELIEF_MIN = 5;

export interface PirateOption {
  readonly target: BanditTarget;
  /** 放置的分數（7 點與騎士的目標挑選）：航線以「付得起」的手牌評估，不隨手牌縮水。 */
  readonly score: number;
  /** 這個選擇替我的航線解除的封鎖，以真實手牌的 ETA 評估（preroll 的門檻）。 */
  readonly relief: number;
  /**
   * 只看海盜這一側的淨值，同樣以真實手牌評估（preroll 的門檻）：偷牌＋新位置的前線－新位置擋住自己的
   * 損失＋解除的封鎖－離開 P 放開的前線；打不打這張騎士，強盜都留在原處，所以不含強盜基準。
   */
  readonly net: number;
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
 *
 * 偷牌加分不算：它只在把強盜移過去時才拿得到，強盜留在原處偷不到牌，所以暫時把所有人的手牌看成 0。
 * 前提：`robberCandidates` 只讀 `view`、`model`、`ctx`、`me`（`Object.create` 只覆寫 `view`，其餘沿用原型）。
 */
function robberScoreHere(turn: TurnContext): number {
  const { view } = turn;
  const here = view.board.robber;
  const players = view.players.map((player) => ({ ...player, handSize: 0 }));
  const away = Object.create(turn, {
    view: { value: { ...view, players, board: { ...view.board, robber: -1 } } },
  }) as TurnContext;
  return robberCandidates(away).find((candidate) => candidate.item === here)?.score ?? 0;
}

/** 海盜移到 `hex`（null 是外框）的盤面；其餘不變。 */
function withPirate(model: BoardModel, hex: number | null): BoardModel {
  return { ...model, view: { ...model.view, board: { ...model.view.board, pirate: hex } } };
}

/** 付得起任何島嶼計畫（最多 4 艘船加一座聚落）的手牌：ETA 只剩 `船數 × ETA_PER_SHIP`。 */
const FULL_HAND: Hand = { lumber: 9, brick: 9, wool: 9, grain: 9, ore: 9 };

/**
 * 「我的航線」的價值：SF-2a 的島嶼聚落計畫（`islandSettlementPlans`，船路徑上限、目標排序與 bot 實際
 * 在走的計畫相同）在 `model` 上最好的一個的 score，以 economy 的匯率（1 VP = 1 / PIP_VALUE 點，
 * 約 14.3 點／VP，是強盜評分用的尺度；開局選位的 `ISLAND_VP_VALUE` 是另一種決策的尺度）換算成
 * 與強盜評分相同的加權點數。船已用完或路徑被擋死時沒有計畫，價值為 0。計畫用 `turn.economy` 當 base：
 * 它只讀手牌、產能、匯率、道路搜尋與剩餘棋子，與海盜的位置無關；`hand` 給定時改用它當手牌（見檔頭的兩種尺度）。
 *
 * 近似：只比較島嶼計畫，沒有和整體最佳計畫（城市、發展卡等）比。若別的計畫本來就更好，擋住島嶼
 * 航線的實際損失比這裡算的小（relief 會偏高，實測 10.6 對約 6.5）；SF-3 校準時可改成
 * `max(P0, 島嶼_無海盜) − max(P0, 島嶼_有海盜)`。
 */
function routeValue(turn: TurnContext, model: BoardModel, hand?: Hand): number {
  const base = hand === undefined ? turn.economy : { ...turn.economy, hand };
  const best = islandSettlementPlans({ model, level: turn.level, base })[0];
  return best ? best.score / PIP_VALUE : 0;
}

/** 一種手牌假設下的航線：海盜現在擋住的價值，以及把海盜放到 `hex` 之後擋住的價值。 */
function routeScale(turn: TurnContext, hand?: Hand): { unblock: number; loss: (hex: number) => number } {
  const { model } = turn;
  // 沒有海盜時最好的計畫：海盜擋不到更好的了。
  const best = routeValue(turn, withPirate(model, null), hand);
  return {
    unblock: Math.max(0, best - routeValue(turn, model, hand)),
    loss: (hex) => Math.max(0, best - routeValue(turn, withPirate(model, hex), hand)),
  };
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

/** 所有海盜選擇（hints 的 `pirateTargets`）與各自的分數；沒有 hints 時為空。匯出只為了測試。 */
export function pirateOptions(turn: TurnContext): PirateOption[] {
  const targets = moduleHints(turn.view.hints, 'seafarers')?.pirateTargets ?? [];
  if (targets.length === 0) return [];
  const { model, view, ctx } = turn;
  const free = withPirate(model, null);
  // 放置用「付得起」的手牌，打騎士用真實手牌（見檔頭）。
  const placing = routeScale(turn, FULL_HAND);
  const paying = routeScale(turn);
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
  const robberHere = robberScoreHere(turn);
  const released = pirateHere === null ? 0 : frontValue(pirateHere);
  const options: PirateOption[] = [];
  for (const target of targets) {
    if (target === null) {
      // 外框只在海盜現在擋住我時才有意義。
      if (placing.unblock > 0) {
        options.push({
          target,
          score: placing.unblock + NULL_BONUS - released + robberHere,
          relief: paying.unblock,
          net: paying.unblock + NULL_BONUS - released,
        });
      }
      continue;
    }
    const stealable = stealableHand(turn, target);
    const raid = stealable > 0 ? 1.5 + 0.25 * Math.min(stealable, 8) : 0;
    const gain = raid + frontValue(target) - released;
    options.push({
      target,
      score: gain - placing.loss(target) + placing.unblock + robberHere,
      relief: paying.unblock - paying.loss(target),
      net: gain - paying.loss(target) + paying.unblock,
    });
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
 * 門檻有兩道：解除的封鎖本身要夠大（`relief`，否則只是換個地方擋路），而且海盜這一側的淨值（`net`）也要夠大，
 * 也就是扣掉離開 P 之後放開的對手前線；否則為了剛好達標的 relief，會放掉更大的封鎖價值。
 * 兩道門檻看真實手牌的 ETA（手牌湊不出船時不浪費騎士）；通過門檻之後，目標格由放置的 `score` 挑
 * （與手牌無關，見檔頭的兩種尺度）。
 */
export const seafarersPreroll: NonNullable<BotModule['preroll']> = (turn) => {
  if (turn.level === 'easy' || !canPlay(turn, 'knight')) return [];
  let chosen: PirateOption | null = null;
  for (const option of pirateOptions(turn)) {
    if (option.relief < PREROLL_RELIEF_MIN || option.net < PREROLL_RELIEF_MIN) continue;
    if (chosen === null || option.score > chosen.score) chosen = option;
  }
  return chosen === null ? [] : [{ item: { type: 'dev.playKnight', hex: chosen.target }, score: chosen.relief }];
};
