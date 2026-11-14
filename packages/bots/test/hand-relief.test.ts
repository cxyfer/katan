/**
 * `handRelief` 不來回換牌（#173）：手牌超過上限、計畫空了或已經湊齊時，銀行交易不會把剛換進來的牌換回去。
 *
 * - 以真實的 rules 狀態逐步套用 `handRelief` 給的指令（每一步重算投影與經濟），直到手牌回到上限內。
 * - 固定盤面：C&K 手上已經買得起一級改良（改良計畫的 commodity 權重因此加成）、base 沒有可買的東西。
 * - 性質：一批確定性的手牌（含 commodity）逐一消化，沒有任何一步 give 上一步剛 receive 的牌。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  CARD_KINDS,
  COMMODITIES,
  projectGame,
  RESOURCES,
  seededRng,
  type CardKind,
  type GameState,
} from '@catan/rules';
import { emptyCkGame, giveCommodities, setBuilding, spreadVertices } from '../../rules/test/ck-helpers.ts';
import { forceTurn, give, newGame } from '../../rules/test/helpers.ts';
import { handSize } from '../src/economy.ts';
import { handRelief, turnContext } from '../src/heuristic.ts';
import type { BotContext } from '../src/types.ts';
import { recordHistory, viewFor } from './harness.ts';

const ctx: BotContext = { selfId: 'p1', level: 'standard', seed: 1, offerPhases: {} };

type Trade = { give: CardKind; receive: CardKind };

/** `history` 為 false 時投影不帶事件（測試用的最小投影）；為 true 時帶完整歷史，和伺服器一樣。 */
function turnOf(state: GameState, history = false) {
  const view = history ? viewFor(state, 'p1') : projectGame(state, 'p1', { hints: actionHints(state, 'p1') });
  return turnContext(view, ctx, 'standard');
}

/**
 * 反覆套用 `handRelief` 給的指令（買發展卡、鋪路也照做），直到它回 null（上限內，或沒有牌換得出去）；
 * 回傳其中的銀行交易與起訖的手牌張數。
 */
function relief(start: GameState, history = false, maxSteps = 24): { trades: Trade[]; before: number; after: number; limit: number } {
  let state = start;
  const trades: Trade[] = [];
  const before = handSize(turnOf(state, history).economy.hand);
  for (let step = 0; step < maxSteps; step++) {
    const command = handRelief(turnOf(state, history));
    if (!command) break;
    if (command.type === 'trade.bank') {
      const { give: giveKind, receive } = command as unknown as Trade;
      trades.push({ give: giveKind, receive });
    }
    const outcome = applyCommand(state, 'p1', command, seededRng(1));
    expect(outcome.ok, `${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
    if (!outcome.ok) break;
    recordHistory(state, outcome.state, outcome.events);
    state = outcome.state;
  }
  const turn = turnOf(state, history);
  return { trades, before, after: handSize(turn.economy.hand), limit: turn.economy.handLimit };
}

/** 反向的交易：某一步 give 的是上一步剛 receive 的牌。 */
function reversals(trades: readonly Trade[]): number {
  let count = 0;
  for (let index = 1; index < trades.length; index++) {
    if (trades[index]!.give === trades[index - 1]!.receive) count += 1;
  }
  return count;
}

/** C&K：p1 有一座城市，手牌 `resources` 加 `commodities`。 */
function ckHand(resources: Parameters<typeof give>[2], commodities: Parameters<typeof giveCommodities>[2] = {}): GameState {
  const state = emptyCkGame(4, 0, 'action');
  const [city] = spreadVertices(state, 1);
  setBuilding(state, 'p1', city!, true);
  give(state, 'p1', resources);
  giveCommodities(state, 'p1', commodities);
  return state;
}

/** base：p1 沒有建築，手牌 `resources`。 */
function baseHand(resources: Parameters<typeof give>[2]): GameState {
  const { state } = newGame({ players: 4, seed: 7 });
  forceTurn(state, 0, 'action');
  give(state, 'p1', resources);
  return state;
}

/** 確定性的偽隨機手牌：每種牌 0–`max` 張，總數超過 `min`。 */
function hands(count: number, kinds: readonly CardKind[], max: number, min: number): Partial<Record<CardKind, number>>[] {
  const rng = seededRng(20_260_114);
  const out: Partial<Record<CardKind, number>>[] = [];
  while (out.length < count) {
    const hand: Partial<Record<CardKind, number>> = {};
    let total = 0;
    for (const kind of kinds) {
      const amount = rng.int(max + 1);
      if (amount > 0) hand[kind] = amount;
      total += amount;
    }
    if (total > min) out.push(hand);
  }
  return out;
}

const split = (hand: Partial<Record<CardKind, number>>) => ({
  resources: Object.fromEntries(RESOURCES.filter((kind) => hand[kind]).map((kind) => [kind, hand[kind]])) as Parameters<typeof give>[2],
  commodities: Object.fromEntries(COMMODITIES.filter((kind) => hand[kind]).map((kind) => [kind, hand[kind]])) as Parameters<typeof giveCommodities>[2],
});

describe('handRelief does not trade back and forth (#173)', () => {
  it('C&K: an affordable improvement does not make the commodity it needs the card to take in and give out', () => {
    // paper 2 + cloth 2 + coin 2：任何一級 1 級改良都買得起，commodity 權重因此全部加成；再加上大量 lumber。
    const state = ckHand({ lumber: 9 }, { paper: 2, cloth: 2, coin: 2 });
    const { trades, before, after } = relief(state);
    expect(trades.length).toBeGreaterThan(0);
    expect(reversals(trades)).toBe(0);
    expect(after).toBeLessThan(before);
  });

  it.each([false, true])('every trade gives a card the previous trade did not just take in (C&K, resources and commodities, history %s)', (history) => {
    let trades = 0;
    let reversed = 0;
    for (const hand of hands(300, CARD_KINDS, 5, 8)) {
      const { resources, commodities } = split(hand);
      const result = relief(ckHand(resources, commodities), history);
      trades += result.trades.length;
      reversed += reversals(result.trades);
      expect(result.after, JSON.stringify(hand)).toBeLessThanOrEqual(result.before);
    }
    expect(trades).toBeGreaterThan(300);
    expect(reversed).toBe(0);
  });

  it.each([false, true])('every trade gives a card the previous trade did not just take in (base, nothing to build, history %s)', (history) => {
    let trades = 0;
    let reversed = 0;
    for (const hand of hands(300, RESOURCES, 7, 8)) {
      const result = relief(baseHand(split(hand).resources), history);
      trades += result.trades.length;
      reversed += reversals(result.trades);
    }
    expect(trades).toBeGreaterThan(50);
    expect(reversed).toBe(0);
  });

  describe('same-turn history', () => {
    /** p1 在這個回合已經用 `give` 換了 `receive`（事件附在投影上），之後的事件在 `turn.started` 之後。 */
    function withTrade(state: GameState, trade: Trade & { player?: string }, beforeTurnStart = false) {
      const view = viewFor(state, 'p1');
      const started = { seq: view.seq + 1, type: 'turn.started', params: { playerId: 'p1', windowId: 1, pairedActor: 1 } };
      const bank = { seq: view.seq + 2, type: 'trade.bank', params: { playerId: trade.player ?? 'p1', give: trade.give, receive: trade.receive, rate: 4 } };
      const events = beforeTurnStart ? [...view.events, bank, { ...started, seq: view.seq + 3 }] : [...view.events, started, bank];
      return turnContext({ ...view, events, seq: view.seq + 3 }, ctx, 'standard');
    }

    it('never gives a card taken in from the bank earlier in the same turn', () => {
      const state = ckHand({ lumber: 9 });
      const plain = handRelief(turnOf(state, true)) as unknown as Trade;
      expect(plain).toMatchObject({ type: 'trade.bank', give: 'lumber' });
      const after = handRelief(withTrade(state, { give: 'wool', receive: 'lumber' })) as unknown as Trade | null;
      // lumber 是這個回合剛換進來的：不換出去；沒有別的牌換得出去就不交易。
      expect(after === null || after.give !== 'lumber').toBe(true);
    });

    it('never takes in a card given to the bank earlier in the same turn', () => {
      const state = ckHand({ lumber: 9 });
      const plain = handRelief(turnOf(state, true)) as unknown as Trade;
      const after = handRelief(withTrade(state, { give: plain.receive, receive: 'wool' })) as unknown as Trade | null;
      expect(after === null || after.receive !== plain.receive).toBe(true);
    });

    it('trades from before the turn started, and other players\' trades, do not count', () => {
      const state = ckHand({ lumber: 9 });
      const plain = handRelief(turnOf(state, true));
      expect(handRelief(withTrade(state, { give: 'wool', receive: 'lumber' }, true))).toEqual(plain);
      expect(handRelief(withTrade(state, { give: 'wool', receive: 'lumber', player: 'p2' }))).toEqual(plain);
    });
  });

  it('still receives the card the plan lacks first', () => {
    // 缺的牌照舊優先（見 ck-economy.test.ts 的 relief 案例）：手上只有 lumber，第一筆交易換出 lumber。
    const state = ckHand({ lumber: 8 });
    expect(handRelief(turnOf(state))).toMatchObject({ type: 'trade.bank', give: 'lumber' });
  });
});
