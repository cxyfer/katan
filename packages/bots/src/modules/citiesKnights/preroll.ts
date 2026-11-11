/**
 * C&K 的擲骰前候選：Alchemy（C&K 計畫 §4.1、§5 CK-C）。擲骰本身交給保底義務（`turn.roll`）。
 *
 * Alchemy 讓自己指定兩顆生產骰（黃、紅；事件骰仍然隨機），所以決策是窮舉 36 種骰面：
 * - 生產：自己在這個點數的產量（依卡種權重）減去對手的產量（依威脅權重）。強盜壓住的格子不計。
 * - 7：自己手牌超過棄牌上限要棄一半；對手超過自己的上限同樣要棄一半（只用公開的手牌張數與城牆數）；
 *   強盜已啟動時，擲出 7 的人移動強盜並偷 1 張。
 * - 紅骰：事件骰擲到城門（機率 1/6 每軌道）時，紅骰 ≤ 該軌道等級 + 1 的玩家抽 1 張進步卡（`drawThreshold`）。
 *   紅骰小，抽牌的人多：等級比對手高的軌道，選能讓自己抽、對手不抽的紅骰。
 *
 * 不打的條件：最佳骰面比一次普通擲骰（36 種骰面的平均）好不到 `ALCHEMY_MIN` 張牌的當量就留著
 * （手上進步卡已滿 4 張、快要被迫棄牌時放寬）；easy 與 paired 的 Player 2 不打（D-CK3；Player 2 不擲骰）。
 *
 * 只讀公開資訊與自己的手牌（B-FAIR）；決定性：同分取黃骰較小、再取紅骰較小者。
 */

import { CARD_KINDS, CK_TRACKS, ckDrawThreshold, type CardKind } from '@catan/rules';
import type { BotModule, TurnContext } from '../types.ts';
import { progressHeld, rivalWeight } from './cards-interactive.ts';
import { handSize } from '../../economy.ts';
import { ckCommands, ckHints, ckView } from './view.ts';

/** 最佳骰面至少要比平均骰面好這麼多（卡牌當量）才打。 */
export const ALCHEMY_MIN = 2;
/** 進步卡手牌已滿（再抽就要棄）時，留著不打也沒有意義：門檻放寬到這個值。 */
export const ALCHEMY_MIN_FULL = 1.2;
/** 一張進步卡的卡牌當量（約 2 張資源）。 */
const DRAW_VALUE = 2;
/** 擲出 7 且強盜已啟動：移動強盜加偷牌的當量。 */
const SEVEN_ROBBER_VALUE = 1;

/** `player` 在擲出 `total` 點時的產量（卡牌張數）；`weighted` 時依自己的卡種權重估值（只用在自己）。 */
export function productionAt(turn: TurnContext, playerId: string, total: number, weighted: boolean): number {
  const { view, model, economy } = turn;
  const blocked = ckView(view)?.robberActive === true ? view.board.robber : -1;
  let sum = 0;
  view.board.numbers.forEach((number, hex) => {
    if (number !== total || hex === blocked || !model.hexLand[hex]) return;
    for (const vertex of model.hexVertices[hex] ?? []) {
      const building = view.board.buildings[vertex];
      if (!building || building.player !== playerId) continue;
      const amounts = model.hexYield?.(model, hex, vertex, building.city);
      if (amounts !== undefined) {
        for (const kind of CARD_KINDS) {
          const amount = amounts[kind as CardKind];
          if (amount) sum += amount * (weighted ? (economy.weights[kind] ?? 0) : 1);
        }
        continue;
      }
      const resource = model.hexResource[hex];
      if (resource) sum += (building.city ? 2 : 1) * (weighted ? economy.weights[resource] : 1);
    }
  });
  return sum;
}

/** 擲出 7 的價值（卡牌當量）：對手超過上限的棄牌、自己的棄牌，以及移動強盜的好處。 */
export function sevenValue(turn: TurnContext): number {
  const { view, economy } = turn;
  let value = 0;
  const mine = handSize(economy.hand);
  if (mine > economy.handLimit) value -= Math.floor(mine / 2);
  let anyHand = false;
  for (const player of view.players) {
    if (player.id === turn.ctx.selfId) continue;
    if (player.handSize > 0) anyHand = true;
    // 對手的上限：7 加上城牆（每座 +2，公開）；其他模組的調整不知道，視為沒有。
    const limit = 7 + 2 * (player.cityWalls ?? 0);
    if (player.handSize > limit) value += rivalWeight(turn, player) * Math.floor(player.handSize / 2);
  }
  if (ckView(view)?.robberActive === true && anyHand) value += SEVEN_ROBBER_VALUE;
  return value;
}

/**
 * 紅骰 `red` 的進步卡抽牌價值：每個軌道 1/6 的機會擲到城門，自己抽到加分、對手抽到依威脅權重扣分。
 * 只用在 Alchemy 的估值（手牌張數含正要打出的 Alchemy）。牌堆張數少於符合資格的人數時，只有依回合順序
 * 排在前面的人抽得到。
 */
export function drawValue(turn: TurnContext, red: number): number {
  const { view } = turn;
  const decks = ckView(view)?.decks;
  // 手牌已滿，多抽到的牌會被棄掉：價值打折。Alchemy 打出後會先離開手牌（擲骰在它之後），
  // 所以用「打出 Alchemy 之後」的張數估計：手上 4 張含 Alchemy 時，還剩一個空位可以抽。
  const handAfterAlchemy = Math.max(0, progressHeld(turn) - 1);
  const mineFactor = handAfterAlchemy >= 4 ? 0.5 : 1;
  // 抽牌依回合順序（從擲骰者起算，rules 的 `turnOrder`）；牌堆抽空就停（只算得到牌的玩家）。
  const count = view.players.length;
  const order = view.players
    .slice()
    .sort((a, b) => ((a.seat - view.turn.seat + count) % count) - ((b.seat - view.turn.seat + count) % count));
  let value = 0;
  for (const track of CK_TRACKS) {
    let remaining = decks?.[track] ?? count;
    let perTrack = 0;
    for (const player of order) {
      if (red > ckDrawThreshold(player.improvements?.[track] ?? 0)) continue;
      if (remaining <= 0) break;
      remaining -= 1;
      perTrack += player.id === turn.ctx.selfId ? DRAW_VALUE * mineFactor : -DRAW_VALUE * 0.5 * rivalWeight(turn, player);
    }
    value += perTrack / 6;
  }
  return value;
}

export interface AlchemyChoice {
  readonly yellow: number;
  readonly red: number;
  /** 這個骰面的價值（卡牌當量）。 */
  readonly value: number;
  /** 36 種骰面的平均價值（一次普通擲骰的期望值）。 */
  readonly average: number;
  /** 最佳比平均好多少。 */
  readonly gain: number;
}

/** 窮舉 36 種骰面，回傳價值最高的一個；同值取黃骰較小、再取紅骰較小者。 */
export function alchemyChoice(turn: TurnContext): AlchemyChoice | null {
  const rivals = turn.view.players.filter((player) => player.id !== turn.ctx.selfId);
  const seven = sevenValue(turn);
  const draws = [0, 1, 2, 3, 4, 5, 6].map((red) => (red === 0 ? 0 : drawValue(turn, red)));
  // 同一個點數的生產價值只算一次。
  const byTotal = new Map<number, number>();
  for (let total = 2; total <= 12; total++) {
    if (total === 7) {
      byTotal.set(total, seven);
      continue;
    }
    let value = productionAt(turn, turn.ctx.selfId, total, true);
    for (const rival of rivals) value -= rivalWeight(turn, rival) * 0.5 * productionAt(turn, rival.id, total, false);
    byTotal.set(total, value);
  }
  let best: { yellow: number; red: number; value: number } | null = null;
  let sum = 0;
  for (let yellow = 1; yellow <= 6; yellow++) {
    for (let red = 1; red <= 6; red++) {
      const value = byTotal.get(yellow + red)! + draws[red]!;
      sum += value;
      if (!best || value > best.value + 1e-9) best = { yellow, red, value };
    }
  }
  if (!best) return null;
  const average = sum / 36;
  return { ...best, average, gain: best.value - average };
}

export const citiesKnightsPreroll: NonNullable<BotModule['preroll']> = (turn) => {
  if (turn.level === 'easy' || turn.pairedSecond) return [];
  const hints = ckHints(turn.view.hints);
  const alchemy = hints?.progress?.find((hint) => hint.card === 'alchemy');
  if (!alchemy?.playable) return [];
  const choice = alchemyChoice(turn);
  if (!choice) return [];
  const needed = progressHeld(turn) >= 4 ? ALCHEMY_MIN_FULL : ALCHEMY_MIN;
  if (choice.gain < needed) return [];
  return [{ item: ckCommands.playProgress('alchemy', { dice: [choice.yellow, choice.red] }), score: 2 + choice.gain }];
};
