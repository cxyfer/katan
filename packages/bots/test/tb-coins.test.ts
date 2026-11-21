/**
 * T&B Coins 的策略測試（T&B 計畫 §4.2 coins 列與「gold 交易與規則 9」、§6.1、§9 R3／R11；S3）。
 *
 * coins 出現在 'tb-rivers-2025'、'tb-barbarian-attack-2025'、'tb-traders-barbarians-2025'。這三個 profile 的 Q1 矩陣與
 * Rivers 的 Q2（買賣次數）由各自的 part 切片（S6–S8）驗收；這裡只測 coins 自己的決策：
 *
 * - 固定盤面（rules 的測試工具建好盤面，指令都要被 `applyCommand` 接受）：
 *   - `tb.buyResource`：買完就能做主要計畫的下一步時才買（standard 與 easy，DoD 1）；缺口超過可買次數、計畫已付得起、
 *     gold 不夠、不在行動階段時不買；Traders 保留 1 gold 過路費；Rivers 的 standard 不因買資源掉進 Poor（easy 照買）。
 *   - `tb.sellResources`（只有 standard）：Rivers 賣一次就脫離 Poor；手牌超過上限而銀行換不到牌時賣超出計畫的牌。
 *   - gold 估值（R11）：1 gold = 0.5 資源當量；只有收進的 gold 在本回合買不了或 gold 太多時折價，付出的固定以銀行價格計，
 *     也不動用 Traders 的過路費保留；easy 回 null。報價經引擎建立，用得上的一張牌
 *     換 1 gold 同意、換 2 gold（剛好打平，低於門檻）拒絕；easy 一律拒絕含 goods 的報價（R3）。
 * - 短局：Rivers 3 人種子 1，standard 與 easy 都買過資源；策略不主動提出含 goods 的報價；同種子重跑雜湊相同。
 * - B-FAIR：Rivers 與 Traders 的對局狀態，只擾動對手手牌與發展卡牌庫（gold 是公開的），決策不變。
 * - fuzz：同一批狀態再加上 coins kit 的 gold 擾動，每個座位的 standard、easy 與保底的指令都被接受，或不欠動作。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  COSTS,
  GOLD_SUPPLY,
  projectGame,
  RESOURCES,
  seededRng,
  type Command,
  type GameState,
  type GameView,
  type Resource,
} from '@katan/rules';
import { setHand } from '../../rules/test/helpers.ts';
import { tbPlayable } from '../../rules/test/tb-helpers.ts';
import { deficitOf } from '../src/economy.ts';
import { botOwesAction, fallbackPolicy } from '../src/fallback.ts';
import { turnContext } from '../src/heuristic.ts';
import {
  buyCandidates,
  coinsBot,
  GOLD_HOARD,
  goldValue,
  IDLE_GOLD_FACTOR,
  sellCandidates,
  wealthDelta,
} from '../src/modules/tradersBarbarians/coins.ts';
import { tradersBarbariansBotModule } from '../src/modules/tradersBarbarians/index.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import { goodsGain, USEFUL_CARD_UTILITY } from '../src/trade.ts';
import type { BotCommand, BotContext, BotLevel } from '../src/types.ts';
import { cloneState, GAME_TIMEOUT, hideDifferently, perturbState, viewFor } from './harness.ts';
import { tradersBarbariansKit } from './modules/tradersBarbarians.ts';
import { partStateOf } from './modules/tb/part.ts';
import { commandCount, expectTbGameHealthy, runTbGame, tbMatrix } from './tb-game.ts';

const RIVERS = 'tb-rivers-2025';
const BA = 'tb-barbarian-attack-2025';
const TRADERS = 'tb-traders-barbarians-2025';
const KITS = [tradersBarbariansKit];
const LEVELS: readonly BotLevel[] = ['standard', 'easy'];

interface CoinsSlot {
  gold: Record<string, number>;
  supply: number;
  purchases: Record<string, { windowId: number; count: number }>;
}

function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 1): BotContext => ({ selfId, level, seed, offerPhases: {} });

const decide = (state: GameState, playerId: string, level: BotLevel): BotCommand | null =>
  createBotPolicy(level).decide(viewOf(state, playerId), ctxFor(playerId, level));

/** 指令被引擎接受；回傳套用後的狀態。 */
function accept(state: GameState, actor: string, command: BotCommand | null | undefined): GameState {
  expect(command, `${actor} has a command`).toBeTruthy();
  const outcome = applyCommand(state, actor, command as Command, seededRng(5));
  if (!outcome.ok) expect.fail(`${JSON.stringify(command)} → ${outcome.error.code} ${JSON.stringify(outcome.error.params)}`);
  return outcome.state;
}

function coinsSlot(state: GameState): CoinsSlot {
  return partStateOf<CoinsSlot>(state, 'tb-coins')!;
}

/** 設定 gold，差額由 supply 補上（總量不變）。 */
function setGold(state: GameState, gold: Record<string, number>): void {
  const slot = coinsSlot(state);
  for (const [id, amount] of Object.entries(gold)) {
    slot.supply += (slot.gold[id] ?? 0) - amount;
    slot.gold[id] = amount;
  }
}

/** 本視窗已經買了幾次。 */
function setPurchases(state: GameState, playerId: string, count: number): void {
  coinsSlot(state).purchases[playerId] = { windowId: state.windowId, count };
}

/** 行動階段、所有人空手、沒有 gold 的盤面；p1 拿 `hand`，`gold` 列出的人拿對應的 gold。 */
function board(profileId: string, hand: Partial<Record<Resource, number>>, gold: Record<string, number>, seed = 3): GameState {
  const state = tbPlayable(profileId, { players: 3, seed });
  for (const player of state.players) setHand(state, player.id, {});
  setHand(state, 'p1', hand);
  setGold(state, Object.fromEntries(state.players.map((player) => [player.id, 0])));
  setGold(state, gold);
  return state;
}

const turnOf = (state: GameState, playerId: string, level: BotLevel = 'standard') =>
  turnContext(viewOf(state, playerId), ctxFor(playerId, level), level);

/** 城市少一張 ore：p1 已有聚落可以升級（BA 開局第 2 輪放城市，第 1 座仍是聚落）。 */
const CITY_SHORT_ORE = { ore: COSTS.city.ore! - 1, grain: COSTS.city.grain! };

describe('tb.buyResource: only to finish this turn’s build', () => {
  for (const level of LEVELS) {
    it(`${level} buys the missing card for the primary plan, then builds it`, () => {
      const state = board(BA, CITY_SHORT_ORE, { p1: 4 });
      const plan = turnOf(state, 'p1', level).economy.plans[0]!;
      expect(plan.kind).toBe('city');
      const buy = decide(state, 'p1', level);
      expect(buy).toEqual({ type: 'tb.buyResource', resource: 'ore' });
      const bought = accept(state, 'p1', buy);
      expect(coinsSlot(bought).gold.p1).toBe(2);
      const build = decide(bought, 'p1', level);
      expect(build).toEqual({ type: 'build.city', vertex: plan.vertex });
      accept(bought, 'p1', build);
    });
  }

  it('buys two cards when two purchases and enough gold cover the gap, but not one more than it may buy', () => {
    const short = { ore: 1, grain: 2 };
    const state = board(BA, short, { p1: 4 });
    expect(decide(state, 'p1', 'standard')).toEqual({ type: 'tb.buyResource', resource: 'ore' });
    const once = accept(state, 'p1', decide(state, 'p1', 'standard'));
    expect(decide(once, 'p1', 'standard')).toEqual({ type: 'tb.buyResource', resource: 'ore' });
    const twice = accept(once, 'p1', decide(once, 'p1', 'standard'));
    expect(decide(twice, 'p1', 'standard')?.type).toBe('build.city');

    // 只剩一次購買、或 gold 只夠一次：缺兩張、也沒有可換的牌，就不買。
    const limited = board(BA, short, { p1: 4 });
    setPurchases(limited, 'p1', 1);
    expect(buyCandidates(turnOf(limited, 'p1'))).toEqual([]);
    const poor = board(BA, short, { p1: 3 });
    expect(buyCandidates(turnOf(poor, 'p1'))).toEqual([]);
    for (const level of LEVELS) {
      expect(decide(limited, 'p1', level)?.type, level).not.toBe('tb.buyResource');
      expect(decide(poor, 'p1', level)?.type, level).not.toBe('tb.buyResource');
    }
  });

  it('combines a purchase with a bank trade when together they finish the build', () => {
    // 缺兩張 ore，只剩一次購買；4 張 wool 是多餘的牌，可以 4:1 換到第二張。
    const state = board(BA, { ore: 1, grain: 2, wool: 4 }, { p1: 4 });
    setPurchases(state, 'p1', 1);
    const turn = turnOf(state, 'p1');
    expect(turn.economy.plans[0]!.kind).toBe('city');
    expect(buyCandidates(turn)).toEqual([{ item: { type: 'tb.buyResource', resource: 'ore' }, score: expect.any(Number) }]);
    const bought = accept(state, 'p1', decide(state, 'p1', 'standard'));
    const traded = accept(bought, 'p1', decide(bought, 'p1', 'standard'));
    expect(decide(traded, 'p1', 'standard')?.type).toBe('build.city');
  });

  it('does not buy when the plan is already affordable, outside the action phase, or without gold', () => {
    const ready = board(BA, { ore: 3, grain: 2 }, { p1: 6 });
    expect(buyCandidates(turnOf(ready, 'p1'))).toEqual([]);
    expect(decide(ready, 'p1', 'standard')?.type).toBe('build.city');

    const preroll = board(BA, CITY_SHORT_ORE, { p1: 4 });
    preroll.turn.phase = 'preroll';
    expect(buyCandidates(turnOf(preroll, 'p1'))).toEqual([]);

    const broke = board(BA, CITY_SHORT_ORE, { p1: 1 });
    expect(buyCandidates(turnOf(broke, 'p1'))).toEqual([]);

    // 非行動者不買。
    const other = board(BA, CITY_SHORT_ORE, { p2: 4 });
    setHand(other, 'p2', CITY_SHORT_ORE);
    expect(buyCandidates(turnOf(other, 'p2'))).toEqual([]);
  });

  it('keeps 1 gold for tolls in Traders & Barbarians', () => {
    for (const level of LEVELS) {
      expect(decide(board(TRADERS, CITY_SHORT_ORE, { p1: 2 }), 'p1', level)?.type, level).not.toBe('tb.buyResource');
      expect(decide(board(TRADERS, CITY_SHORT_ORE, { p1: 3 }), 'p1', level), level).toEqual({
        type: 'tb.buyResource',
        resource: 'ore',
      });
    }
  });

  it('standard does not buy itself into Poor in Rivers; easy does not weigh the wealth tiles', () => {
    // p1 是唯一最多（+1），買完變 0 gold（Poor −2）。
    const state = board(RIVERS, CITY_SHORT_ORE, { p1: 2, p2: 1, p3: 1 });
    expect(wealthDelta(viewOf(state, 'p1'), 'p1', -2)).toBe(-3);
    expect(decide(state, 'p1', 'standard')?.type).not.toBe('tb.buyResource');
    expect(decide(state, 'p1', 'easy')).toEqual({ type: 'tb.buyResource', resource: 'ore' });
    // 已經和別人並列 Poor：買了也不會更糟。
    const tied = board(RIVERS, CITY_SHORT_ORE, { p1: 2, p2: 2, p3: 2 });
    expect(wealthDelta(viewOf(tied, 'p1'), 'p1', -2)).toBe(0);
    expect(decide(tied, 'p1', 'standard')).toEqual({ type: 'tb.buyResource', resource: 'ore' });
    // 不是 Rivers 時沒有財富板塊。
    expect(wealthDelta(viewOf(board(BA, {}, { p1: 2 }), 'p1'), 'p1', -2)).toBe(0);
  });
});

describe('tb.sellResources: standard only, to leave Poor in Rivers or when over the hand limit', () => {
  it('sells once to leave Poor (−2 VP) in Rivers; easy never sells', () => {
    const state = board(RIVERS, { ore: 4, grain: 1 }, { p1: 0, p2: 0, p3: 0 });
    const view = viewOf(state, 'p1');
    expect((view.modules?.tradersBarbarians as { 'tb-rivers'?: { poor?: string[] } })['tb-rivers']?.poor).toContain('p1');
    expect(wealthDelta(view, 'p1', 1)).toBe(3);
    const sell = decide(state, 'p1', 'standard');
    expect(sell).toEqual({ type: 'tb.sellResources', resource: 'ore' });
    const sold = accept(state, 'p1', sell);
    expect(coinsSlot(sold).gold.p1).toBe(1);
    // 脫離 Poor 之後不再賣。
    expect(sellCandidates(turnOf(sold, 'p1'))).toEqual([]);
    expect(decide(state, 'p1', 'easy')?.type).not.toBe('tb.sellResources');
    expect(sellCandidates(turnOf(state, 'p1', 'easy'))).toEqual([]);
  });

  it('sells only when one sale is enough to leave Poor', () => {
    // p1 與 p3 並列最少（0）：p1 賣一次變 1，只剩 p3 是 Poor。
    const state = board(RIVERS, { ore: 4 }, { p1: 0, p2: 1, p3: 0 });
    expect(wealthDelta(viewOf(state, 'p1'), 'p1', 1)).toBe(2);
    expect(decide(state, 'p1', 'standard')).toEqual({ type: 'tb.sellResources', resource: 'ore' });
    // 所有人都比 p1 多 2 gold 以上：賣一次仍是 Poor。
    const deep = board(RIVERS, { ore: 4 }, { p1: 0, p2: 3, p3: 3 });
    expect(wealthDelta(viewOf(deep, 'p1'), 'p1', 1)).toBe(0);
    expect(sellCandidates(turnOf(deep, 'p1'))).toEqual([]);
  });

  it('sells surplus cards over the hand limit only when the bank cannot relieve the hand', () => {
    const state = board(BA, { ore: 9 }, {});
    // 銀行沒有 ore 以外的牌：發展卡、道路與銀行交易都不可行。
    for (const resource of RESOURCES) if (resource !== 'ore') state.bank[resource] = 0;
    const sell = decide(state, 'p1', 'standard');
    expect(sell).toEqual({ type: 'tb.sellResources', resource: 'ore' });
    accept(state, 'p1', sell);
    expect(decide(state, 'p1', 'easy')?.type).not.toBe('tb.sellResources');

    // 銀行有牌時交給 base 的 handRelief（4:1 換一張牌比賣成 1 gold 划算）。
    const bank = board(BA, { ore: 9 }, {});
    expect(sellCandidates(turnOf(bank, 'p1'))).toEqual([]);
    expect(decide(bank, 'p1', 'standard')?.type).toBe('trade.bank');
  });
});

describe('gold value and rule 9 (R3, R11)', () => {
  it('prices 1 gold at 0.5 resource equivalents; only received gold is discounted when it cannot be spent soon; easy refuses', () => {
    const state = board(BA, {}, { p1: 4, p2: 4, p3: 4 });
    const turn = turnOf(state, 'p1');
    for (const side of ['receive', 'pay'] as const) {
      expect(goldValue(turn, 2, side), side).toBe(1);
      expect(goldValue(turn, 1, side), side).toBe(0.5);
      expect(goldValue(turn, 0, side), side).toBe(0);
    }
    const hook = tradersBarbariansBotModule.trade!;
    expect(hook.goodValue!(turn, 'gold', 4, 'receive')).toBe(2);
    expect(hook.goodValue!(turn, 'gold', 4, 'pay')).toBe(2);
    expect(hook.goodValue!(turn, 'silk', 4, 'receive')).toBeUndefined();
    expect(hook.goods!(viewOf(state, 'p1'), 'p2')).toEqual({ gold: 4 });
    expect(coinsBot.trade!.goods!(viewOf(tbPlayable('tb-friendly-robber-2025'), 'p1'), 'p1')).toEqual({});

    // 本回合的購買次數用完（自己的行動視窗）：收進的 gold 暫時用不掉，折價；付出的 gold 仍以銀行價格計。
    setPurchases(state, 'p1', 2);
    expect(goldValue(turnOf(state, 'p1'), 2, 'receive')).toBeCloseTo(IDLE_GOLD_FACTOR);
    expect(goldValue(turnOf(state, 'p1'), 2, 'pay')).toBe(1);
    // 非行動者下一回合才能買，不折價；持有至少 GOLD_HOARD 時收進的折價、付出的不折價。
    expect(goldValue(turnOf(state, 'p2'), 2, 'receive')).toBe(1);
    setGold(state, { p2: GOLD_HOARD });
    expect(goldValue(turnOf(state, 'p2'), 2, 'receive')).toBeCloseTo(IDLE_GOLD_FACTOR);
    expect(goldValue(turnOf(state, 'p2'), 2, 'pay')).toBe(1);
    // 付不出持有以外的 gold。
    expect(goldValue(turnOf(state, 'p2'), GOLD_HOARD + 1, 'pay')).toBeNull();

    for (const side of ['receive', 'pay'] as const) {
      expect(goldValue(turnOf(state, 'p2', 'easy'), 2, side), side).toBeNull();
      expect(hook.goodValue!(turnOf(state, 'p2', 'easy'), 'gold', 2, side), side).toBeNull();
    }
  });

  it('refuses to pay gold in Rivers when paying would cost a wealth tile, but still takes gold', () => {
    // p2 與 p1 並列最多（不是唯一，沒有 +1）；p2 付 1 gold 就變成 Poor（並列最少）。
    const state = board(RIVERS, {}, { p1: 2, p2: 2, p3: 1 });
    expect(wealthDelta(viewOf(state, 'p2'), 'p2', -1)).toBe(-2);
    expect(goldValue(turnOf(state, 'p2'), 1, 'pay')).toBeNull();
    // 收進 gold 不會失去財富板塊。
    expect(goldValue(turnOf(state, 'p2'), 1, 'receive')).toBe(0.5);
    // p1 唯一最多：付 1 gold 變成並列，失去 Wealthiest。
    const rich = board(RIVERS, {}, { p1: 3, p2: 2, p3: 1 });
    expect(goldValue(turnOf(rich, 'p1'), 1, 'pay')).toBeNull();
    // 付了也不會失分時照常估值。
    const safe = board(RIVERS, {}, { p1: 4, p2: 4, p3: 1 });
    expect(goldValue(turnOf(safe, 'p1'), 1, 'pay')).toBe(0.5);
  });

  /**
   * #193 審查的重現：p2 的城市只差 1 ore，p1 開價「給 1 ore、要 `gold` 個 gold」。付出的 gold 不折價，所以持有 8 gold
   * （折價門檻 `GOLD_HOARD`）時也不會用 4 gold 換一張牌（對手可以拿 4 gold 向銀行換 2 張）；2 gold 換一張照樣同意。
   */
  function oreForGold(profileId: string, held: number, gold: number): GameState {
    const state = board(profileId, {}, { p1: 4, p2: held, p3: 4 });
    setHand(state, 'p2', CITY_SHORT_ORE);
    expect(turnOf(state, 'p2').economy.plans[0]!.kind).toBe('city');
    setHand(state, 'p1', { ore: 1 });
    return accept(state, 'p1', {
      type: 'trade.offer',
      to: 'p2',
      give: { ore: 1 },
      want: {},
      wantGoods: { gold },
    } as unknown as Command);
  }

  it('does not pay above the bank price even while hoarding or after its purchases are used up', () => {
    expect(GOLD_HOARD).toBe(8);
    expect(decide(oreForGold(BA, 8, 4), 'p2', 'standard')).toMatchObject({ type: 'trade.respond', response: 'declined' });
    const fair = oreForGold(BA, 8, 2);
    const consent = decide(fair, 'p2', 'standard');
    expect(consent).toMatchObject({ type: 'trade.respond', response: 'consented' });
    accept(fair, 'p2', consent);
  });

  it('keeps the Traders toll reserve when paying gold in a trade', () => {
    // 只有 2 gold：付 2 gold 會動用過路費保留，拒絕；3 gold 時照樣同意。
    expect(goldValue(turnOf(board(TRADERS, {}, { p2: 2 }), 'p2'), 2, 'pay')).toBeNull();
    expect(decide(oreForGold(TRADERS, 2, 2), 'p2', 'standard')).toMatchObject({ type: 'trade.respond', response: 'declined' });
    const enough = oreForGold(TRADERS, 3, 2);
    const consent = decide(enough, 'p2', 'standard');
    expect(consent).toMatchObject({ type: 'trade.respond', response: 'consented' });
    accept(enough, 'p2', consent);
  });

  /** p1 對 p2 開價：給 p2 一張它用得上、但湊不齊計畫的牌，向 p2 要 `gold` 個 gold。 */
  function goldForCard(gold: number): { state: GameState; card: Resource } {
    const state = board(BA, {}, { p1: 4, p2: 4, p3: 4 });
    const plan = turnOf(state, 'p2').economy.plans[0]!;
    const missing = deficitOf({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 }, plan.cost);
    const card = RESOURCES.find((resource) => missing[resource] > 0)!;
    expect(RESOURCES.reduce((sum, resource) => sum + missing[resource], 0), 'one card does not finish the plan').toBeGreaterThan(1);
    setHand(state, 'p1', { [card]: 1 });
    const offered = accept(state, 'p1', {
      type: 'trade.offer',
      to: 'p2',
      give: { [card]: 1 },
      want: {},
      wantGoods: { gold },
    } as unknown as Command);
    return { state: offered, card };
  }

  it('consents to pay 1 gold for a card it needs and declines 2 gold (break-even, under the margin)', () => {
    const one = goldForCard(1);
    const offer = one.state.offers.at(-1)!;
    // 2 gold 正好抵一張用得上的牌（USEFUL_CARD_UTILITY）。
    expect(goodsGain(turnOf(one.state, 'p2'), { ...offer, wantGoods: { gold: 2 } })).toBeCloseTo(-USEFUL_CARD_UTILITY);
    const consent = decide(one.state, 'p2', 'standard');
    expect(consent).toEqual({ type: 'trade.respond', offerId: offer.id, response: 'consented' });
    const agreed = accept(one.state, 'p2', consent);
    const settled = accept(agreed, 'p1', { type: 'trade.settle', offerId: offer.id });
    expect(coinsSlot(settled).gold).toMatchObject({ p1: 5, p2: 3 });
    expect(settled.players[1]!.resources[one.card]).toBe(1);

    const two = goldForCard(2);
    expect(decide(two.state, 'p2', 'standard')).toMatchObject({ type: 'trade.respond', response: 'declined' });
  });

  it('easy declines every offer with goods, even a cheap one', () => {
    const { state } = goldForCard(1);
    expect(decide(state, 'p2', 'easy')).toMatchObject({ type: 'trade.respond', response: 'declined' });
  });
});

describe('coins in play', () => {
  it(
    'Rivers 3p seed 1: standard and easy both buy resources; no bot proposes gold; reruns hash the same',
    () => {
      const spec = tbMatrix(RIVERS, 3)[0]!;
      let goodsOffers = 0;
      const record = runTbGame(spec, {
        onDecision: (_state, decision) => {
          const command = decision.command as { type: string; giveGoods?: unknown; wantGoods?: unknown };
          if (command.type === 'trade.offer' && (command.giveGoods || command.wantGoods)) goodsOffers += 1;
        },
      });
      expectTbGameHealthy(record, { requireWinner: false });
      expect(commandCount(record, 'tb.buyResource', 'standard')).toBeGreaterThan(0);
      expect(commandCount(record, 'tb.buyResource', 'easy')).toBeGreaterThan(0);
      expect(commandCount(record, 'tb.sellResources', 'easy')).toBe(0);
      expect(record.mechanics['tradersBarbarians.tb-coins.buy.standard']).toBe(commandCount(record, 'tb.buyResource', 'standard'));
      expect(goodsOffers).toBe(0);
      expect(runTbGame(spec).hash).toBe(record.hash);
    },
    GAME_TIMEOUT,
  );
});

/** Rivers 與 Traders 的對局狀態（每 `every` 步取一次）。 */
function snapshots(profileId: string, seed: number, every: number): GameState[] {
  const out: GameState[] = [];
  let step = 0;
  runTbGame(
    { ...tbMatrix(profileId, 3)[0]!, seed, label: `${profileId} snapshots` },
    {
      maxSteps: 600,
      watchdogRolls: null,
      onDecision: (state) => {
        if (step++ % every === 0 && !state.result) out.push(cloneState(state));
      },
    },
  );
  return out;
}

describe('B-FAIR and fuzz', () => {
  const states = [...snapshots(RIVERS, 2, 5), ...snapshots(TRADERS, 2, 9)];

  for (const level of LEVELS) {
    it(
      `decides identically when only opponents' hands and the development deck differ (${level})`,
      () => {
        const policy = createBotPolicy(level);
        let compared = 0;
        for (const state of states) {
          for (const player of state.players) {
            const { variant, changed } = hideDifferently(state, player.id, KITS);
            if (!changed) continue;
            const original = viewFor(state, player.id);
            const altered = viewFor(variant, player.id);
            expect(JSON.stringify(altered), `seq ${state.seq} ${player.id}: projection changed`).toBe(JSON.stringify(original));
            const ctx = ctxFor(player.id, level, botSeed('fair', player.id, state.seq));
            expect(policy.decide(altered, ctx), `seq ${state.seq} ${player.id}`).toEqual(policy.decide(original, ctx));
            compared += 1;
          }
        }
        expect(compared).toBeGreaterThanOrEqual(100);
      },
      GAME_TIMEOUT,
    );
  }

  it(
    'answers perturbed gold states with accepted commands, or owes nothing',
    () => {
      const rng = seededRng(73);
      const failures: string[] = [];
      let checked = 0;
      let coinCommands = 0;
      for (const [index, state] of states.entries()) {
        const variant = perturbState(state, rng, KITS);
        const slot = coinsSlot(variant);
        expect(slot.supply + Object.values(slot.gold).reduce((sum, amount) => sum + amount, 0)).toBe(GOLD_SUPPLY);
        for (const player of variant.players) {
          for (const [name, policy, level] of [
            ['standard', createBotPolicy('standard'), 'standard'],
            ['easy', createBotPolicy('easy'), 'easy'],
            ['fallback', fallbackPolicy, 'standard'],
          ] as const) {
            const view = viewFor(variant, player.id);
            const command = policy.decide(view, ctxFor(player.id, level, botSeed('fuzz', player.id, index)));
            checked += 1;
            if (!command) {
              if (botOwesAction(view, player.id)) failures.push(`${index} ${player.id} (${name}) idle while owing`);
              continue;
            }
            if (command.type.startsWith('tb.buy') || command.type.startsWith('tb.sell')) coinCommands += 1;
            const outcome = applyCommand(variant, player.id, command as Command, seededRng(1));
            if (!outcome.ok) failures.push(`${index} ${player.id} (${name}) ${JSON.stringify(command)} → ${outcome.error.code}`);
          }
        }
      }
      expect(failures).toEqual([]);
      expect(checked).toBeGreaterThanOrEqual(200);
      expect(coinCommands).toBeGreaterThan(0);
    },
    GAME_TIMEOUT,
  );
});
