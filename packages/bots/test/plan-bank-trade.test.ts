/**
 * 計畫的銀行交易（`bankTradeToward`）不來回換（#180）：同一回合內不換出這個回合從銀行換進來的牌，也不換回換出去過的
 * 牌，與 `handRelief`（#173）相同。換進來的牌可能來自 relief、C&K 模組的換匯或前一筆計畫交易，守門只看事件歷史。
 *
 * - 固定手牌（base）：投影附上「這個回合換過的牌」事件，比對有無 `selfId` 的結果。
 * - 真實 C&K 回合：模組先為改良換進 cloth，原本下一步的計畫交易會把 cloth 換掉；逐步套用策略的指令直到回合結束。
 * - 性質：一批確定性的 C&K 手牌各走一個回合，沒有任何銀行交易換出同回合換進來的牌。
 */

import { describe, expect, it } from 'vitest';
import { applyCommand, COMMODITIES, RESOURCES, seededRng, type CardKind, type GameState, type GameView } from '@catan/rules';
import { emptyCkGame, giveCommodities, setBuilding, setImprovement, spreadVertices } from '../../rules/test/ck-helpers.ts';
import { forceTurn, give, newGame } from '../../rules/test/helpers.ts';
import { createBotPolicy } from '../src/index.ts';
import { handRelief, turnContext } from '../src/heuristic.ts';
import { bankTradeToward } from '../src/trade.ts';
import type { BotContext } from '../src/types.ts';
import { recordHistory, viewFor } from './harness.ts';

const ctx: BotContext = { selfId: 'p1', level: 'standard', seed: 1, offerPhases: {} };

type Trade = { give: CardKind; receive: CardKind };

/** base：p1 沒有建築（匯率都是 4:1），手牌 `resources`。 */
function baseHand(resources: Parameters<typeof give>[2]): GameState {
  const { state } = newGame({ players: 4, seed: 7 });
  forceTurn(state, 0, 'action');
  give(state, 'p1', resources);
  return state;
}

/** p1 的投影，附上這個回合的 `turn.started` 與一筆銀行交易；`beforeTurnStart` 時交易在 `turn.started` 之前。 */
function withTrade(state: GameState, trade: Trade & { player?: string }, beforeTurnStart = false): GameView {
  const view = viewFor(state, 'p1');
  const started = { seq: view.seq + 1, type: 'turn.started', params: { playerId: 'p1', windowId: 1, pairedActor: 1 } };
  const bank = { seq: view.seq + 2, type: 'trade.bank', params: { playerId: trade.player ?? 'p1', give: trade.give, receive: trade.receive, rate: 4 } };
  const events = beforeTurnStart ? [...view.events, bank, { ...started, seq: view.seq + 3 }] : [...view.events, started, bank];
  return { ...view, events, seq: view.seq + 3 };
}

function planTrade(view: GameView, nextCost: Parameters<typeof bankTradeToward>[2], selfId?: string) {
  const economy = turnContext(view, ctx, 'standard').economy;
  return bankTradeToward(view, economy, nextCost, nextCost, selfId) as unknown as (Trade & { type: string }) | null;
}

describe('bankTradeToward does not undo a same-turn bank trade (#180)', () => {
  // lumber 6、brick 5、缺 ore：照「換完後剩最多」會拿 lumber 去換。
  const hand = { lumber: 6, brick: 5 };

  it('does not give a card taken in from the bank earlier this turn, and takes another surplus card instead', () => {
    const state = baseHand(hand);
    const view = withTrade(state, { give: 'wool', receive: 'lumber' });
    expect(planTrade(view, { ore: 1 })).toMatchObject({ give: 'lumber', receive: 'ore' });
    expect(planTrade(view, { ore: 1 }, 'p1')).toMatchObject({ give: 'brick', receive: 'ore' });
  });

  it('does not trade when the only surplus card is one taken in this turn', () => {
    const state = baseHand({ lumber: 6 });
    const view = withTrade(state, { give: 'wool', receive: 'lumber' });
    expect(planTrade(view, { ore: 1 })).toMatchObject({ give: 'lumber', receive: 'ore' });
    expect(planTrade(view, { ore: 1 }, 'p1')).toBeNull();
  });

  it('does not take back a card given to the bank earlier this turn', () => {
    const state = baseHand(hand);
    const view = withTrade(state, { give: 'ore', receive: 'grain' });
    expect(planTrade(view, { ore: 1 })).toMatchObject({ receive: 'ore' });
    expect(planTrade(view, { ore: 1 }, 'p1')).toBeNull();
    // 其他缺牌照常補。
    expect(planTrade(view, { wool: 1 }, 'p1')).toMatchObject({ give: 'lumber', receive: 'wool' });
  });

  it('trades from before the turn started, other players\' trades and a call without selfId do not count', () => {
    const state = baseHand(hand);
    const plain = planTrade(viewFor(state, 'p1'), { ore: 1 }, 'p1');
    expect(plain).toMatchObject({ give: 'lumber' });
    expect(planTrade(withTrade(state, { give: 'wool', receive: 'lumber' }, true), { ore: 1 }, 'p1')).toEqual(plain);
    expect(planTrade(withTrade(state, { give: 'wool', receive: 'lumber', player: 'p2' }), { ore: 1 }, 'p1')).toEqual(plain);
  });

  it('does not take back a card a real relief trade gave away', () => {
    // 手牌超過上限、沒有可蓋的東西：relief 換出 brick（比 lumber 多）。
    const state = baseHand({ brick: 9, lumber: 5 });
    const relief = handRelief(turnContext(viewFor(state, 'p1'), ctx, 'standard'));
    expect(relief).toMatchObject({ type: 'trade.bank', give: 'brick' });
    const outcome = applyCommand(state, 'p1', relief!, seededRng(1));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    recordHistory(state, outcome.state, outcome.events);
    const view = viewFor(outcome.state, 'p1');
    // 計畫要的 brick 比手上多一張：沒有守門時拿 lumber 換回 brick。
    expect(planTrade(view, { brick: 6 })).toMatchObject({ give: 'lumber', receive: 'brick' });
    expect(planTrade(view, { brick: 6 }, 'p1')).toBeNull();
  });
});

/** 從 `start` 起讓 p1 的策略逐步決策並套用，直到回合結束；回傳其中的銀行交易。 */
function playTurn(start: GameState, maxSteps = 30): { trades: Trade[]; state: GameState } {
  const policy = createBotPolicy('standard');
  let state = start;
  const trades: Trade[] = [];
  for (let step = 0; step < maxSteps; step++) {
    const command = policy.decide(viewFor(state, 'p1'), ctx);
    if (!command || command.type === 'turn.end') break;
    if (command.type === 'trade.bank') trades.push(command as unknown as Trade);
    const outcome = applyCommand(state, 'p1', command, seededRng(1));
    expect(outcome.ok, `${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
    if (!outcome.ok) break;
    recordHistory(state, outcome.state, outcome.events);
    state = outcome.state;
  }
  return { trades, state };
}

/** 同一回合內換出前面換進來的牌、或換回前面換出去的牌的次數。 */
function churn(trades: readonly Trade[]): { gaveReceived: number; tookBack: number } {
  let gaveReceived = 0;
  let tookBack = 0;
  trades.forEach((trade, index) => {
    const earlier = trades.slice(0, index);
    if (earlier.some((before) => before.receive === trade.give)) gaveReceived += 1;
    if (earlier.some((before) => before.give === trade.receive)) tookBack += 1;
  });
  return { gaveReceived, tookBack };
}

/** C&K：p1 有一座城市和一座聚落，主軌道為 `track`，手牌 `resources` 加 `commodities`。 */
function ckHand(
  track: 'science' | 'trade' | 'politics',
  level: number,
  resources: Parameters<typeof give>[2],
  commodities: Parameters<typeof giveCommodities>[2],
): GameState {
  const state = emptyCkGame(4, 0, 'action');
  const [city, settlement] = spreadVertices(state, 2);
  setBuilding(state, 'p1', city!, true);
  setBuilding(state, 'p1', settlement!, false);
  if (level > 0) setImprovement(state, 'p1', track, level);
  give(state, 'p1', resources);
  giveCommodities(state, 'p1', commodities);
  return state;
}

describe('a C&K turn does not sell the commodity the module just bought (#180)', () => {
  it('keeps the cloth taken in for the trade improvement instead of trading it for grain', () => {
    // 貿易 3 級（commodity 2:1）、主軌道 trade：模組先用 paper 換 cloth。計畫（城市）缺 grain，沒有守門時下一步的計畫交易
    // 會拿 cloth 去換 grain，等於 paper → cloth → grain。
    const state = ckHand('trade', 3, { brick: 2, wool: 2, grain: 1, ore: 3 }, { paper: 2, cloth: 2, coin: 1 });
    const { trades, state: end } = playTurn(state);
    expect(trades[0]).toMatchObject({ give: 'paper', receive: 'cloth' });

    // 模組換匯之後的局面：沒有 selfId（舊行為）時計畫交易會換出 cloth。
    const first = applyCommand(state, 'p1', { type: 'trade.bank', give: 'paper', receive: 'cloth' }, seededRng(1));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    recordHistory(state, first.state, first.events);
    const view = viewFor(first.state, 'p1');
    const economy = turnContext(view, ctx, 'standard').economy;
    const primary = economy.plans[0]!;
    expect(bankTradeToward(view, economy, primary.nextCost, primary.cost)).toMatchObject({ give: 'cloth', receive: 'grain' });
    expect(bankTradeToward(view, economy, primary.nextCost, primary.cost, 'p1')).toBeNull();

    expect(churn(trades)).toEqual({ gaveReceived: 0, tookBack: 0 });
    expect(turnContext(viewFor(end, 'p1'), ctx, 'standard').economy.hand.cloth).toBe(3);
  });

  it('over a batch of deterministic C&K hands no bank trade gives a card taken in earlier in the same turn', () => {
    const rng = seededRng(20_261_120);
    const tracks = ['science', 'trade', 'politics'] as const;
    let trades = 0;
    let gaveReceived = 0;
    for (let index = 0; index < 150; index++) {
      const resources = Object.fromEntries(RESOURCES.map((kind) => [kind, rng.int(4)])) as Parameters<typeof give>[2];
      const commodities = Object.fromEntries(COMMODITIES.map((kind) => [kind, rng.int(8)])) as Parameters<typeof giveCommodities>[2];
      const result = playTurn(ckHand(tracks[rng.int(3)]!, rng.int(4), resources, commodities));
      trades += result.trades.length;
      gaveReceived += churn(result.trades).gaveReceived;
    }
    expect(trades).toBeGreaterThan(150);
    expect(gaveReceived).toBe(0);
  });
});
