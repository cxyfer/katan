/**
 * C&K 的 commodity 經濟（C&K 計畫 §4.5、§4.6；0.4.2 平台掛點）：CardKind 的手牌與成本、組合後的 kinds、
 * rates、weights、costs、城市產出、ETA、銀行交易，以及規則 9（報價只含估得了價的東西）。
 *
 * 盤面一律用 rules 的 C&K 固定盤面與真實指令；產出的對照以 `applyCommand` 擲骰的實際結果為準。
 */

import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  COMMODITIES,
  RESOURCES,
  seededRng,
  type CardKind,
  type Command,
  type GameState,
  type GameView,
  type Offer,
} from '@catan/rules';
import { actCk, emptyCkGame, giveCommodities, player, rollRng, setImprovement, TRADE } from '../../rules/test/ck-helpers.ts';
import { give, newGame } from '../../rules/test/helpers.ts';
import {
  boardModel,
  cityUpgradeYield,
  emptyYield,
  pipsOf,
  playerYield,
  vertexYield,
  type BoardModel,
} from '../src/board.ts';
import {
  addCosts,
  canAfford,
  deficitOf,
  economyOf,
  etaRounds,
  handOf,
  handSize,
  pay,
  productionValue,
  scaleCost,
  weightedPips,
  type Economy,
  type KindTable,
} from '../src/economy.ts';
import { turnContext } from '../src/heuristic.ts';
import { citiesKnightsBotModule } from '../src/modules/citiesKnights/index.ts';
import { COMMODITY_WEIGHT } from '../src/modules/citiesKnights/economy.ts';
import { createBotPolicy } from '../src/policy.ts';
import { bankHas, plannedBankOf, plannedCommodityBank } from '../src/bank.ts';
import { handUtility, bankTradeToward, offerGain, offerTermsKnown } from '../src/trade.ts';
import type { BotModule } from '../src/modules/types.ts';
import type { BotContext, BotLevel } from '../src/types.ts';
import { viewOf } from './ck-fixtures.ts';

const MODULES: readonly BotModule[] = [citiesKnightsBotModule];

const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 1): BotContext => ({ selfId, level, seed, offerPhases: {} });

/** p1 的行動階段：2 ore、3 paper、1 coin。 */
function handGame(): GameState {
  const state = emptyCkGame(4, 0, 'action');
  give(state, 'p1', { ore: 2 });
  giveCommodities(state, 'p1', { paper: 3, coin: 1 });
  return state;
}

function economyFor(state: GameState, playerId = 'p1', modules: readonly BotModule[] = MODULES): Economy {
  return economyOf(boardModel(viewOf(state, playerId), playerId, modules), modules);
}

// ---------------------------------------------------------------------------
// 手牌與成本（E-1、E-3）
// ---------------------------------------------------------------------------

describe('hands and costs over card kinds', () => {
  it('reads commodities into the hand, only when held', () => {
    const model = boardModel(viewOf(handGame(), 'p1'), 'p1', MODULES);
    const hand = handOf(model);
    expect(hand).toMatchObject({ ore: 2, paper: 3, coin: 1 });
    expect(Object.keys(hand).sort()).toEqual([...RESOURCES, 'paper', 'coin'].sort());
    expect(hand).not.toHaveProperty('cloth');
    expect(handSize(hand)).toBe(6);
    // 別人的手牌是隱藏的：只有張數，沒有組成。
    expect(handOf(model, 'p2')).toEqual(emptyYield());
  });

  it('keeps the base object shape: no commodity keys without commodities', () => {
    const view = viewOf(newGame({ players: 4, profileId: 'base-2025', seed: 1 }).state, 'p1');
    expect(Object.keys(handOf(boardModel(view, 'p1'))).sort()).toEqual([...RESOURCES].sort());
    const state = emptyCkGame(4, 0, 'action');
    expect(Object.keys(handOf(boardModel(viewOf(state, 'p1'), 'p1', MODULES))).sort()).toEqual([...RESOURCES].sort());
  });

  it('canAfford, deficitOf and pay count every card kind', () => {
    const hand = handOf(boardModel(viewOf(handGame(), 'p1'), 'p1', MODULES));
    expect(canAfford(hand, { paper: 3 })).toBe(true);
    expect(canAfford(hand, { paper: 4 })).toBe(false);
    expect(canAfford(hand, { cloth: 1 })).toBe(false);
    expect(canAfford(hand, { ore: 2, paper: 3, coin: 1 })).toBe(true);
    // 缺口只在真的缺時才寫入 commodity。
    const missing = deficitOf(hand, { paper: 5, cloth: 1, ore: 3, coin: 1 });
    expect(missing).toMatchObject({ ore: 1, paper: 2, cloth: 1 });
    expect(missing).not.toHaveProperty('coin');
    expect(Object.keys(deficitOf(hand, { ore: 1 })).sort()).toEqual([...RESOURCES].sort());
    const paid = pay(hand, { paper: 2, ore: 1 });
    expect(paid).toMatchObject({ ore: 1, paper: 1, coin: 1 });
    expect(paid).not.toHaveProperty('cloth');
    // 不改動原本的手牌。
    expect(hand).toMatchObject({ ore: 2, paper: 3 });
    expect(pay(hand, { coin: 1 })).toMatchObject({ coin: 0 });
  });

  it('adds and scales costs across resources and commodities', () => {
    expect(addCosts({ ore: 1, paper: 2 }, { paper: 1, coin: 3 })).toEqual({ ore: 1, paper: 3, coin: 3 });
    expect(scaleCost({ brick: 1, cloth: 2 }, 3)).toEqual({ brick: 3, cloth: 6 });
    expect(scaleCost({ paper: 2 }, 0)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 組合後的經濟
// ---------------------------------------------------------------------------

describe('composed economy', () => {
  it('base only: kinds are the resources and the economy has no commodity keys', () => {
    const state = emptyCkGame(4, 0, 'action');
    const view = viewOf(state, 'p1');
    const economy = economyOf(boardModel(view, 'p1', []), []);
    expect(economy.kinds).toBe(RESOURCES);
    expect(Object.keys(economy.weights).sort()).toEqual([...RESOURCES].sort());
    expect(Object.keys(economy.rates).sort()).toEqual([...RESOURCES].sort());
    // 沒有模組卡種時匯率就是 hints 的 bankRates 本身。
    expect(economy.rates).toBe(view.hints!.bankRates);
  });

  it('adds the commodities with their own rates, weights and costs', () => {
    const economy = economyFor(handGame());
    expect(economy.kinds).toEqual([...RESOURCES, ...COMMODITIES]);
    expect(economy.rates).toMatchObject({ lumber: 4, paper: 4, cloth: 4, coin: 4 });
    for (const commodity of COMMODITIES) {
      expect(economy.weights[commodity]).toBeGreaterThanOrEqual(COMMODITY_WEIGHT.min);
      expect(economy.weights[commodity]).toBeLessThanOrEqual(COMMODITY_WEIGHT.max);
    }
    expect(Object.keys(economy.costs).sort()).toEqual(
      ['activate', 'city', 'devCard', 'improve.politics', 'improve.science', 'improve.trade', 'knight', 'medicine', 'promote', 'road', 'settlement', 'wall'].sort(),
    );
    expect(economy.costs).toMatchObject({
      wall: { brick: 2 },
      knight: { wool: 1, ore: 1 },
      promote: { wool: 1, ore: 1 },
      activate: { grain: 1 },
      medicine: { grain: 1, ore: 2 },
      'improve.science': { paper: 1 },
      'improve.trade': { cloth: 1 },
      'improve.politics': { coin: 1 },
    });
    // base 的四個鍵不被模組蓋掉。
    expect(economy.costs.city).toEqual({ ore: 3, grain: 2 });
  });

  it('prices the next improvement level, and drops a maxed track', () => {
    const state = emptyCkGame(4, 0, 'action');
    setImprovement(state, 'p1', 'science', 2);
    setImprovement(state, 'p1', 'trade', 5);
    const economy = economyFor(state);
    expect(economy.costs['improve.science']).toEqual({ paper: 3 });
    expect(economy.costs).not.toHaveProperty('improve.trade');
    expect(economy.costs['improve.politics']).toEqual({ coin: 1 });
    // 滿級軌道的 commodity 只剩流動性。
    expect(economy.weights.cloth).toBe(COMMODITY_WEIGHT.maxed);
  });

  it('weighs a commodity higher when the next improvement is within reach', () => {
    const state = emptyCkGame(4, 0, 'action');
    const none = economyFor(state).weights;
    giveCommodities(state, 'p1', { paper: 1 });
    const affordable = economyFor(state).weights;
    expect(none.paper).toBe(COMMODITY_WEIGHT.base + COMMODITY_WEIGHT.near);
    expect(affordable.paper).toBe(COMMODITY_WEIGHT.base + COMMODITY_WEIGHT.affordable);
    expect(affordable.cloth).toBe(none.cloth);
    // 差很多張時只有基準值。
    const far = emptyCkGame(4, 0, 'action');
    setImprovement(far, 'p1', 'science', 4);
    expect(economyFor(far).weights.paper).toBe(COMMODITY_WEIGHT.base);
  });

  it('reads the commodity rates from the hints: 3:1 port, trade level 3 at 2:1', () => {
    const state = emptyCkGame(4, 0, 'action');
    setImprovement(state, 'p1', 'trade', 3);
    expect(economyFor(state).rates).toMatchObject({ paper: 2, cloth: 2, coin: 2 });
    expect(economyFor(state, 'p2').rates).toMatchObject({ paper: 4, cloth: 4, coin: 4 });
    // 沒有 hints（例如別人的視角、不在行動階段仍有 commodityRates）：缺漏的卡種不能與銀行交易。
    const view = JSON.parse(JSON.stringify(viewOf(state, 'p1'))) as GameView;
    view.hints!.modules = {};
    const bare = economyOf(boardModel(view, 'p1', MODULES), MODULES);
    for (const commodity of COMMODITIES) expect(bare.rates).not.toHaveProperty(commodity);
    expect(bare.rates.lumber).toBe(4);
  });

  it('composes several modules: dedupes kinds, first answer wins, ignores resources and bad numbers', () => {
    const state = emptyCkGame(4, 0, 'action');
    const a: BotModule = {
      id: 'a',
      economy: {
        cardKinds: () => ['paper', 'lumber'],
        rates: () => ({ paper: 3, lumber: 1, coin: 2, cloth: Number.NaN }),
        weights: () => ({ paper: 1.1, lumber: 9 }),
      },
    };
    const b: BotModule = {
      id: 'b',
      economy: {
        cardKinds: () => ['paper', 'coin'],
        rates: () => ({ paper: 2, coin: 0, cloth: -1 }),
        weights: () => ({ paper: 0.6, coin: 0.7 }),
      },
    };
    const economy = economyOf(boardModel(viewOf(state, 'p1'), 'p1', [a, b]), [a, b]);
    expect(economy.kinds).toEqual([...RESOURCES, 'paper', 'coin']);
    // 先回答的模組優先；模組回傳的資源鍵一律忽略；非有限或非正的匯率視為沒有；每個模組只回答自己宣告的
    // 卡種（a 沒有宣告 coin，它給的 coin 匯率不算）。
    expect(economy.rates).toMatchObject({ lumber: 4, paper: 3 });
    expect(economy.rates).not.toHaveProperty('coin');
    expect(economy.rates).not.toHaveProperty('cloth');
    expect(economy.weights).toMatchObject({ paper: 1.1, coin: 0.7 });
    expect(economy.weights.lumber).toBeLessThan(2);
    expect(economy.weights).not.toHaveProperty('cloth');
  });
});

// ---------------------------------------------------------------------------
// 產出：hexYield 與引擎一致
// ---------------------------------------------------------------------------

describe('city yield (hexYield)', () => {
  /** 一個陸地格與它的一個路口；挑點數的格子，避開強盜與同點數的鄰格。 */
  function site(state: GameState, terrain: string): { hex: number; vertex: number; number: number } {
    const view = viewOf(state, 'p1');
    const model = boardModel(view, 'p1', MODULES);
    const hex = model.view.board.terrain.findIndex(
      (candidate, index) => candidate === terrain && model.view.board.numbers[index] !== null && index !== model.view.board.robber,
    );
    expect(hex, terrain).toBeGreaterThanOrEqual(0);
    return { hex, vertex: model.hexVertices[hex]![0]!, number: model.view.board.numbers[hex]! };
  }

  /** 引擎擲出 `number` 後 p1 的資源與 commodity 變化。 */
  function produced(state: GameState, vertex: number, city: boolean, number: number): Partial<Record<CardKind, number>> {
    const board = { ...state, board: { ...state.board, buildings: state.board.buildings.slice() } };
    board.board.buildings[vertex] = { player: 'p1', city };
    const preroll = JSON.parse(JSON.stringify(board)) as GameState;
    preroll.turn.phase = 'preroll';
    const yellow = Math.min(6, number - 1);
    const outcome = applyCommand(preroll, 'p1', { type: 'turn.roll' }, rollRng(yellow, number - yellow, TRADE));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return {};
    const out: Partial<Record<CardKind, number>> = {};
    for (const kind of RESOURCES) if (outcome.state.players[0]!.resources[kind] > 0) out[kind] = outcome.state.players[0]!.resources[kind];
    for (const kind of COMMODITIES) if (outcome.state.players[0]!.commodities[kind] > 0) out[kind] = outcome.state.players[0]!.commodities[kind];
    return out;
  }

  it.each([
    ['forest', 'lumber', 'paper'],
    ['pasture', 'wool', 'cloth'],
    ['mountains', 'ore', 'coin'],
  ] as const)('a city on %s takes one %s and one %s; a settlement takes one resource', (terrain, resource, commodity) => {
    const state = emptyCkGame(4, 0, 'preroll');
    const { hex, vertex, number } = site(state, terrain);
    const model = boardModel(viewOf(state, 'p1'), 'p1', MODULES);
    expect(model.hexYield?.(hex, vertex, true)).toEqual({ [resource]: 1, [commodity]: 1 });
    expect(model.hexYield?.(hex, vertex, false)).toBeUndefined();
    // 對照引擎：每個鄰接且點數相同的格子都算進去。
    const sameNumber = model.topo.vertices[vertex]!.hexes.filter((candidate) => model.view.board.numbers[candidate] === number);
    const expectCity: Partial<Record<CardKind, number>> = {};
    const expectSettlement: Partial<Record<CardKind, number>> = {};
    for (const candidate of sameNumber) {
      const kinds = model.hexYield?.(candidate, vertex, true) ?? { [model.hexResource[candidate]!]: 2 };
      for (const [kind, amount] of Object.entries(kinds)) expectCity[kind as CardKind] = (expectCity[kind as CardKind] ?? 0) + amount!;
      const resourceOf = model.hexResource[candidate]!;
      expectSettlement[resourceOf] = (expectSettlement[resourceOf] ?? 0) + 1;
    }
    expect(produced(state, vertex, true, number)).toEqual(expectCity);
    expect(produced(state, vertex, false, number)).toEqual(expectSettlement);
  });

  it.each(['hills', 'fields'] as const)('a city on %s takes two resources and no commodity', (terrain) => {
    const state = emptyCkGame(4, 0, 'preroll');
    const { hex, vertex, number } = site(state, terrain);
    const model = boardModel(viewOf(state, 'p1'), 'p1', MODULES);
    expect(model.hexYield?.(hex, vertex, true)).toBeUndefined();
    const got = produced(state, vertex, true, number);
    for (const commodity of COMMODITIES) expect(got).not.toHaveProperty(commodity);
    expect(got[model.hexResource[hex]!]).toBeGreaterThanOrEqual(2);
  });

  it('vertexYield and playerYield price the engine\'s production in pips', () => {
    const state = emptyCkGame(4, 0, 'action');
    const model0 = boardModel(viewOf(state, 'p1'), 'p1', MODULES);
    const vertex = model0.hexVertices.findIndex((_corners, hex) => model0.hexResource[hex] === 'lumber' && model0.view.board.numbers[hex] !== null);
    const forestVertex = model0.hexVertices[vertex]![0]!;
    state.board.buildings[forestVertex] = { player: 'p1', city: true };
    const model = boardModel(viewOf(state, 'p1'), 'p1', MODULES);
    const city = vertexYield(model, forestVertex, null, true);
    const settlement = vertexYield(model, forestVertex);
    let expectedPaper = 0;
    for (const hex of model.topo.vertices[forestVertex]!.hexes) {
      if (model.hexResource[hex] === 'lumber') expectedPaper += pipsOf(model.view.board.numbers[hex]);
    }
    expect(city.paper).toBe(expectedPaper);
    expect(settlement.paper).toBeUndefined();
    // 自己的產能把城市算成「1 資源 + 1 commodity」，不是兩張資源。
    const mine = playerYield(model, 'p1', true);
    expect(mine.paper).toBe(expectedPaper);
    expect(mine.lumber).toBe(settlement.lumber);
    // 強盜所在的格子不產（資源與 commodity 都一樣）。
    const robberHex = model.topo.vertices[forestVertex]!.hexes.find((hex) => model.hexResource[hex] === 'lumber')!;
    const blocked = vertexYield(model, forestVertex, robberHex, true);
    expect(blocked.paper ?? 0).toBeLessThan(expectedPaper || 1);
  });

  it('upgrading values the commodity gained, not a second resource', () => {
    const state = emptyCkGame(4, 0, 'action');
    const model0 = boardModel(viewOf(state, 'p1'), 'p1', MODULES);
    const base0 = boardModel(viewOf(state, 'p1'), 'p1');
    const hex = model0.hexVertices.findIndex((_corners, candidate) => model0.hexResource[candidate] === 'wool' && model0.view.board.numbers[candidate] !== null);
    const vertex = model0.hexVertices[hex]![0]!;
    const weights: KindTable = { ...economyFor(state).weights, cloth: 1.2, wool: 0.9 };
    const gain = cityUpgradeYield(model0, vertex);
    // 牧場上的城市比聚落多的是 cloth，wool 不變。
    expect(gain.cloth).toBeGreaterThan(0);
    expect(gain.wool ?? 0).toBe(0);
    expect(productionValue(model0, vertex, weights)).toBeCloseTo(weightedPips(gain, weights), 10);
    // 沒有模組時城市就是聚落的兩倍，升級多得的是同樣一份資源（base 不變）。
    expect(cityUpgradeYield(base0, vertex)).toEqual(vertexYield(base0, vertex));
    expect(productionValue(base0, vertex, weights)).toBe(weightedPips(vertexYield(base0, vertex), weights));
  });
});

// ---------------------------------------------------------------------------
// ETA、效用與銀行交易
// ---------------------------------------------------------------------------

describe('eta, utility and bank trades with commodities', () => {
  const rates: KindTable = { lumber: 4, brick: 4, wool: 4, grain: 4, ore: 4, paper: 4, cloth: 4, coin: 4 };
  const kinds = [...RESOURCES, ...COMMODITIES];

  it('estimates a commodity cost the way it estimates the same resource cost', () => {
    const empty = emptyYield();
    const viaPaper = etaRounds(empty, { paper: 2 }, { ...empty, paper: 5 }, rates, 4, kinds);
    const viaLumber = etaRounds(empty, { lumber: 2 }, { ...empty, lumber: 5 }, rates, 4, kinds);
    expect(viaPaper).toBeGreaterThan(0);
    expect(viaPaper).toBe(viaLumber);
    // 產能越高越快；沒有任何產能時以最低速度估。
    expect(etaRounds(empty, { paper: 2 }, { ...empty, paper: 10 }, rates, 4, kinds)).toBeLessThan(viaPaper);
    expect(etaRounds(empty, { paper: 2 }, empty, rates, 4, kinds)).toBeGreaterThan(viaPaper);
  });

  it('trades surplus cards at the bank rate: a commodity surplus pays for a resource gap', () => {
    const hand = { ...emptyYield(), ore: 8 };
    expect(etaRounds(hand, { paper: 2 }, emptyYield(), rates, 4, kinds)).toBe(0.25);
    expect(etaRounds({ ...emptyYield(), paper: 8 }, { ore: 2 }, emptyYield(), rates, 4, kinds)).toBe(0.25);
    // 沒有匯率的卡種不能換匯。
    const { paper: _paper, ...noPaper } = rates;
    expect(etaRounds({ ...emptyYield(), paper: 8 }, { ore: 2 }, emptyYield(), noPaper, 4, kinds)).toBeGreaterThan(1);
  });

  it('ignores kinds outside the list (a base economy cannot price a commodity)', () => {
    expect(etaRounds(emptyYield(), { paper: 2 }, emptyYield(), rates, 4)).toBe(0);
  });

  it('counts commodities in hand utility: the held commodity needed by the target is worth keeping', () => {
    const economy = economyFor(handGame());
    const target = { paper: 3 };
    const hand = economy.hand;
    const without = { ...hand, paper: 0 };
    expect(handUtility(economy, hand, target)).toBeGreaterThan(handUtility(economy, without, target) + 8);
    // 目標以外的 commodity 靠權重與流動性計價，不是 0。
    expect(handUtility(economy, hand, {})).toBeGreaterThan(handUtility(economy, { ...hand, paper: 0, coin: 0 }, {}));
    // 只有資源的經濟不替 commodity 估值。
    const baseOnly = economyFor(handGame(), 'p1', []);
    expect(handUtility(baseOnly, hand, {})).toBe(handUtility(baseOnly, { ...hand, coin: 0 }, {}));
  });

  it('buys a commodity from the bank with surplus resources, and pays with a surplus commodity', () => {
    const state = emptyCkGame(4, 0, 'action');
    give(state, 'p1', { lumber: 5 });
    const view = viewOf(state, 'p1');
    const economy = economyFor(state);
    const buy = bankTradeToward(view, economy, { coin: 1 }, {});
    expect(buy).toEqual({ type: 'trade.bank', give: 'lumber', receive: 'coin' });
    expect(applyCommand(state, 'p1', buy as Command, seededRng(1)).ok).toBe(true);

    const rich = emptyCkGame(4, 0, 'action');
    giveCommodities(rich, 'p1', { paper: 4 });
    const pay = bankTradeToward(viewOf(rich, 'p1'), economyFor(rich), { ore: 1 }, {});
    expect(pay).toEqual({ type: 'trade.bank', give: 'paper', receive: 'ore' });
    expect(applyCommand(rich, 'p1', pay as Command, seededRng(1)).ok).toBe(true);
  });

  it('holds back what the plan reserves, needs a rate, and needs the bank to have the card', () => {
    const state = emptyCkGame(4, 0, 'action');
    give(state, 'p1', { lumber: 5 });
    // 5 張 lumber、保留 2 張：只剩 3 張，不夠 4:1。
    expect(bankTradeToward(viewOf(state, 'p1'), economyFor(state), { coin: 1 }, { lumber: 2 })).toBeNull();
    // 銀行沒有 coin：不送一個必定被拒絕的交易。
    const dry = emptyCkGame(4, 0, 'action');
    give(dry, 'p1', { lumber: 5 });
    dry.commodityBank.coin = 0;
    expect(bankHas(viewOf(dry, 'p1'), 'coin')).toBe(false);
    expect(bankTradeToward(viewOf(dry, 'p1'), economyFor(dry), { coin: 1 }, {})).toBeNull();
    // 沒有匯率的 commodity 不能付出。
    const view = JSON.parse(JSON.stringify(viewOf(state, 'p1'))) as GameView;
    view.hints!.modules = {};
    const noRates = economyOf(boardModel(view, 'p1', MODULES), MODULES);
    const stuck = emptyCkGame(4, 0, 'action');
    giveCommodities(stuck, 'p1', { paper: 4 });
    const economy = { ...noRates, hand: handOf(boardModel(viewOf(stuck, 'p1'), 'p1', MODULES)) };
    expect(bankTradeToward(viewOf(stuck, 'p1'), economy, { ore: 1 }, {})).toBeNull();
  });

  it('plans the commodity bank like the resource bank: only "at least" is known above the cap', () => {
    const state = emptyCkGame(4, 0, 'action');
    const view = viewOf(state, 'p1');
    expect(plannedCommodityBank(view)).toEqual({ paper: 12, cloth: 12, coin: 12 });
    expect(plannedBankOf(view, RESOURCES)).not.toHaveProperty('paper');
    expect(plannedBankOf(view, [...RESOURCES, 'paper'])).toMatchObject({ lumber: 19, paper: 12 });
    // 低於上限是確切張數；沒有這個模組的視角沒有 commodity 存量。
    state.commodityBank.cloth = 1;
    expect(plannedCommodityBank(viewOf(state, 'p1')).cloth).toBe(1);
    const base = viewOf(newGame({ players: 4, profileId: 'base-2025', seed: 1 }).state, 'p1');
    expect(plannedCommodityBank(base)).toEqual({ paper: 0, cloth: 0, coin: 0 });
    expect(bankHas(base, 'paper')).toBe(false);
    expect(bankHas(base, 'lumber')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 規則 9：報價只含估得了價的東西
// ---------------------------------------------------------------------------

describe('rule 9: offers with commodities', () => {
  const offer = (give: Offer['give'], want: Offer['want'], extra: Partial<Offer> = {}): Offer =>
    ({ id: 'o1', from: 'p1', to: 'all', give, want, status: 'open', windowId: 1, responses: {}, ...extra }) as Offer;

  it('accepts only the kinds the economy can price', () => {
    expect(offerTermsKnown(offer({ wool: 1 }, { coin: 3 }))).toBe(false);
    expect(offerTermsKnown(offer({ coin: 1 }, { wool: 1 }))).toBe(false);
    expect(offerTermsKnown(offer({ wool: 1 }, { coin: 3 }), [...RESOURCES, ...COMMODITIES])).toBe(true);
    expect(offerTermsKnown(offer({ wool: 1 }, { coin: 3 }), [...RESOURCES, 'paper'])).toBe(false);
    // 數量為 0 的卡種不算；goods 一律拒絕。
    expect(offerTermsKnown(offer({ wool: 1, coin: 0 }, { ore: 1 }))).toBe(true);
    expect(offerTermsKnown(offer({ wool: 1 }, { ore: 1 }, { giveGoods: { trade: 1 } as never }), [...RESOURCES, ...COMMODITIES])).toBe(false);
  });

  it('prices an offer in commodities: paying what the bot does not hold is refused', () => {
    const economy = economyFor(handGame());
    expect(offerGain(economy, offer({ wool: 1 }, { coin: 3 }))).toBe(-Infinity);
    expect(Number.isFinite(offerGain(economy, offer({ wool: 1 }, { coin: 1 })))).toBe(true);
  });

  /** p1 是行動者，提出「give 換 want」；p2 是 Bot。 */
  function offered(p2: { resources?: Parameters<typeof give>[2]; commodities?: Parameters<typeof giveCommodities>[2] }, terms: Offer['give'], want: Offer['want']): GameState {
    const state = emptyCkGame(4, 0, 'action');
    give(state, 'p1', terms as Parameters<typeof give>[2]);
    const city = state.board.buildings.findIndex((building) => building === null);
    state.board.buildings[city] = { player: 'p2', city: false };
    if (p2.resources) give(state, 'p2', p2.resources);
    if (p2.commodities) giveCommodities(state, 'p2', p2.commodities);
    return actCk(state, 'p1', { type: 'trade.offer', to: 'all', give: terms, want } as Command).state;
  }

  it.each(['standard', 'easy'] as const)('%s: with 1 coin the bot declines "1 wool for 3 coin"', (level) => {
    const state = offered({ commodities: { coin: 1 } }, { wool: 1 }, { coin: 3 });
    const command = createBotPolicy(level).decide(viewOf(state, 'p2'), ctxFor('p2', level));
    expect(command).toMatchObject({ type: 'trade.respond', response: 'declined' });
  });

  it.each(['standard', 'easy'] as const)('%s: with 3 coin and a worthwhile deal the bot consents, and the trade settles', (level) => {
    // p2 的城市計畫缺 1 張 grain：用 3 coin 換 grain 划算。
    const state = offered({ resources: { ore: 3, grain: 1 }, commodities: { coin: 3 } }, { grain: 1 }, { coin: 3 });
    const policy = createBotPolicy(level);
    const response = policy.decide(viewOf(state, 'p2'), ctxFor('p2', level));
    expect(response).toMatchObject({ type: 'trade.respond', response: 'consented' });
    const answered = actCk(state, 'p2', response as Command).state;
    const offerId = (answered.offers[0] as Offer).id;
    const settled = actCk(answered, 'p1', { type: 'trade.settle', offerId, counterparty: 'p2' } as Command).state;
    expect(player(settled, 'p2').commodities.coin).toBe(0);
    expect(player(settled, 'p2').resources.grain).toBe(2);
    expect(player(settled, 'p1').commodities.coin).toBe(3);
  });

  /** 行動者 p1（Bot）的城市計畫：有聚落，ore 3、grain 1；p2 向它直接報價。 */
  function counterOffer(p1: { resources: Parameters<typeof give>[2]; commodities?: Parameters<typeof giveCommodities>[2] }, p2: { resources: Parameters<typeof give>[2]; commodities?: Parameters<typeof giveCommodities>[2] }, terms: Offer['give'], want: Offer['want']): GameState {
    const state = emptyCkGame(4, 0, 'action');
    const city = state.board.buildings.findIndex((building) => building === null);
    state.board.buildings[city] = { player: 'p1', city: false };
    give(state, 'p1', p1.resources);
    if (p1.commodities) giveCommodities(state, 'p1', p1.commodities);
    give(state, 'p2', p2.resources);
    if (p2.commodities) giveCommodities(state, 'p2', p2.commodities);
    return actCk(state, 'p2', { type: 'trade.offer', to: 'p1', give: terms, want } as Command).state;
  }

  it('a Bot actor settles a worthwhile direct offer paid in commodities', () => {
    // p1 的城市只缺 grain；p2 給 grain、要 2 coin。
    const state = counterOffer({ resources: { ore: 3, grain: 1 }, commodities: { coin: 3 } }, { resources: { grain: 1 } }, { grain: 1 }, { coin: 2 });
    const command = createBotPolicy('standard').decide(viewOf(state, 'p1'), ctxFor('p1'));
    expect(command).toMatchObject({ type: 'trade.settle' });
    const settled = actCk(state, 'p1', command as Command).state;
    expect(player(settled, 'p1').resources.grain).toBe(2);
    expect(player(settled, 'p1').commodities.coin).toBe(1);
  });

  it('a Bot actor declines a direct offer that would break its plan', () => {
    // p1 的城市已經湊齊：p2 給 2 coin 換走 1 grain 不划算。
    const state = counterOffer({ resources: { ore: 3, grain: 2 } }, { resources: {}, commodities: { coin: 2 } }, { coin: 2 }, { grain: 1 });
    const command = createBotPolicy('standard').decide(viewOf(state, 'p1'), ctxFor('p1'));
    expect(command).toMatchObject({ type: 'trade.respond', response: 'declined' });
  });

  it('counts the proposer\'s cards by card kind: a commodity in the offer needs a card behind it', () => {
    // p2 給 grain 1 與 paper 1（共 2 張）、要 1 coin：對 p1 的城市計畫有利。
    const state = counterOffer(
      { resources: { ore: 3, grain: 1 }, commodities: { coin: 3 } },
      { resources: { grain: 1 }, commodities: { paper: 1 } },
      { grain: 1, paper: 1 },
      { coin: 1 },
    );
    const policy = createBotPolicy('standard');
    expect(policy.decide(viewOf(state, 'p1'), ctxFor('p1'))).toMatchObject({ type: 'trade.settle' });
    // 公開的手牌張數只有 1：資源只算 grain 的話 1 ≤ 1 會誤判付得起，依卡種算要 2 張。
    const hacked = JSON.parse(JSON.stringify(viewOf(state, 'p1'))) as GameView;
    hacked.players.find((candidate) => candidate.id === 'p2')!.handSize = 1;
    expect(policy.decide(hacked, ctxFor('p1'))).toMatchObject({ type: 'trade.respond', response: 'declined' });
  });
});

describe('the Bot module stays out of games it does not play', () => {
  it('a base game has no commodity hooks on the board model', () => {
    const view = viewOf(newGame({ players: 4, profileId: 'base-2025', seed: 1 }).state, 'p1');
    const model: BoardModel = boardModel(view, 'p1', []);
    expect(model.hexYield).toBeUndefined();
    expect(model.blocker).toBeUndefined();
    expect(model.siteBlocked).toBeUndefined();
    const turn = turnContext(view, ctxFor('p1'), 'standard');
    expect(turn.modules).toEqual([]);
    expect(turn.economy.kinds).toBe(RESOURCES);
  });
});
