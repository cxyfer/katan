/**
 * Rivers of Catan 的固定盤面、投影 → `boardModel` 的路徑、B-FAIR 與 fuzz（T&B 計畫 §4.2 rivers 列、§6.1；S8）。
 *
 * 固定盤面以 rules 的測試工具建好（`tbPlayable` 之後清空盤面，直接放建築、道路、手牌與 gold），每個決策都要被 `applyCommand` 接受：
 * - 真實的 'tb-rivers-2025' 狀態：投影的 `extraNumbers`（12 那一格的 2）進到 `boardModel.hexPips`；蓋好的橋在投影裡是
 *   `bridge: true`，算路線、算道路網，不佔道路存量（與 S1 的合成 view 一致）。
 * - 主要計畫的下一步是橋：付得起就蓋；差一張 brick 時先銀行交易或用 gold 買（standard 與 easy）；橋位沒接上時不處理。
 * - 其他橋位：過剩的 brick 與 lumber 蓋橋（standard 與 easy）；會動用主要計畫的牌時，只有靠 gold 立即獲勝這種等級的價值才蓋。
 * - 財富板塊：權重隨離勝利的距離上升；蓋橋讓自己成為唯一最多、立即達標時，standard 選它，引擎判定獲勝。
 * - 河邊的聚落：base 的分數加上 1 gold 的價值，蓋了得 1 gold。
 * B-FAIR：擾動對手手牌與發展卡牌庫（harness 的 `hideDifferently`；Rivers 與 gold 都是公開的），投影相同、決策相同。
 * fuzz：coins kit 的 gold 擾動加上 harness 的手牌擾動；每個座位的 standard、easy 與保底的答案都被接受，或是 null 且不欠動作。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  BRIDGE_COST,
  BRIDGE_GOLD,
  COSTS,
  projectGame,
  requireProfile,
  RIVER_BUILD_GOLD,
  seededRng,
  topologyOf,
  type Command,
  type GameState,
  type GameView,
} from '@catan/rules';
import { placeBuilding, placeRoad, setHand } from '../../rules/test/helpers.ts';
import { tbPlayable } from '../../rules/test/tb-helpers.ts';
import { boardModel, piecesOnBoard, pipsOf, roadStockLeft, routeLength, searchRoads } from '../src/board.ts';
import { addCosts, scaleCost, type Plan } from '../src/economy.ts';
import { botOwesAction, fallbackPolicy } from '../src/fallback.ts';
import { primaryBankTrade, turnContext } from '../src/heuristic.ts';
import { purchaseToward, WIN_VALUE, wealthValue, wealthWeight, WEALTH_WEIGHT_FLOOR } from '../src/modules/tradersBarbarians/coins.ts';
import {
  bridgeRouteEdge,
  bridgeSites,
  bridgesLeft,
  bridgeTargets,
  PLAN_BRIDGE_SCORE,
  riversCandidates,
} from '../src/modules/tradersBarbarians/rivers.ts';
import type { TurnContext } from '../src/modules/types.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import { botModulesOf } from '../src/support.ts';
import { bankTradeToward } from '../src/trade.ts';
import type { BotCommand, BotContext, BotLevel } from '../src/types.ts';
import { cloneState, GAME_TIMEOUT, hideDifferently, perturbState, viewFor } from './harness.ts';
import { tradersBarbariansKit } from './modules/tradersBarbarians.ts';
import { partStateOf } from './modules/tb/part.ts';
import { runTbGame, tbMatrix } from './tb-game.ts';

const PROFILE = 'tb-rivers-2025';
const KITS = [tradersBarbariansKit];
const LEVELS: readonly BotLevel[] = ['standard', 'easy'];
const MODULES = botModulesOf(requireProfile(PROFILE));

interface CoinsSlot {
  gold: Record<string, number>;
  supply: number;
}
interface RiversSlot {
  bridgeSites: number[];
  edges: number[];
  vertices: number[];
}

const viewOf = (state: GameState, id: string): GameView => projectGame(state, id, { hints: actionHints(state, id) });
const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 3): BotContext => ({ selfId, level, seed, offerPhases: {} });
const decide = (state: GameState, id: string, level: BotLevel): BotCommand | null =>
  createBotPolicy(level).decide(viewOf(state, id), ctxFor(id, level));
const turnOf = (state: GameState, id: string, level: BotLevel = 'standard') => turnContext(viewOf(state, id), ctxFor(id, level), level);
const coinsOf = (state: GameState): CoinsSlot => partStateOf<CoinsSlot>(state, 'tb-coins')!;
const riversOf = (state: GameState): RiversSlot => partStateOf<RiversSlot>(state, 'tb-rivers')!;

function accept(state: GameState, actor: string, command: BotCommand | null | undefined): GameState {
  expect(command, `${actor} has a command`).toBeTruthy();
  const outcome = applyCommand(state, actor, command as Command, seededRng(5));
  if (!outcome.ok) expect.fail(`${JSON.stringify(command)} → ${outcome.error.code} ${JSON.stringify(outcome.error.params)}`);
  return outcome.state;
}

/** 設定 gold，差額由 supply 補上（總量不變）。 */
function setGold(state: GameState, gold: Record<string, number>): void {
  const slot = coinsOf(state);
  for (const [id, amount] of Object.entries(gold)) {
    slot.supply += (slot.gold[id] ?? 0) - amount;
    slot.gold[id] = amount;
  }
}

/** p1 的行動階段、空盤面、所有人空手、沒有 gold。 */
function bare(players = 3): GameState {
  const state = tbPlayable(PROFILE, { players, seed: 4 });
  state.board.buildings = state.board.buildings.map(() => null);
  state.board.roads = state.board.roads.map(() => null);
  for (const player of state.players) setHand(state, player.id, {});
  setGold(state, Object.fromEntries(state.players.map((player) => [player.id, 0])));
  return state;
}

/** 第一個橋位，以及它的兩端。 */
function siteOf(state: GameState, index = 0): { site: number; near: number; far: number } {
  const site = riversOf(state).bridgeSites[index]!;
  const [near, far] = topologyOf(state).edges[site]!.vertices;
  return { site, near, far };
}

/** 換掉經濟的計畫（其他欄位不變），用來固定「主要計畫的下一步是橋」。 */
function withPlans(turn: TurnContext, plans: Plan[]): TurnContext {
  return Object.create(turn, { economy: { value: { ...turn.economy, plans } } }) as TurnContext;
}

/** 經過 `site` 的聚落計畫：先蓋橋，再一條路到 `vertex`。 */
function bridgePlan(state: GameState, site: number, far: number): Plan {
  const topology = topologyOf(state);
  const onward = topology.vertices[far]!.edges.find((edge) => edge !== site && !riversOf(state).bridgeSites.includes(edge))!;
  const [a, b] = topology.edges[onward]!.vertices;
  const vertex = a === far ? b : a;
  const cost = addCosts(COSTS.settlement, scaleCost(COSTS.road, 2));
  return { kind: 'settlement', vertex, roads: [site, onward], ships: [], cost, nextCost: COSTS.road, value: 1.4, eta: 1, score: 0.7 };
}

describe('projection → boardModel on a real tb-rivers-2025 state (S1 G6, G7)', () => {
  it('counts the 2 on the 12 hex through extraNumbers and treats a bridge as route, not road stock', () => {
    const state = tbPlayable(PROFILE, { players: 3, seed: 3 });
    const view = viewOf(state, 'p1');
    const { numbers, extraNumbers } = state.board.layout;
    const twelve = numbers.indexOf(12);
    expect(extraNumbers).toEqual([{ hex: twelve, number: 2 }]);
    expect(twelve).toBeGreaterThanOrEqual(0);
    expect(view.board.extraNumbers).toEqual([{ hex: twelve, number: 2 }]);
    const model = boardModel(view, 'p1', MODULES);
    model.hexPips.forEach((pips, hex) => {
      expect(pips, `hex ${hex}`).toBe(pipsOf(numbers[hex]) + (hex === twelve ? pipsOf(2) : 0));
    });

    // 橋：投影裡是 `bridge: true`；道路網與路線都算它，道路存量不算。
    const board = bare();
    const { site, near, far } = siteOf(board);
    placeBuilding(board, 'p1', near);
    setHand(board, 'p1', { ...BRIDGE_COST, ore: 2, grain: 2 });
    const stock = roadStockLeft(viewOf(board, 'p1'), 'p1');
    expect(bridgeTargets(viewOf(board, 'p1'))).toEqual([site]);
    const built = accept(board, 'p1', { type: 'tb.buildBridge', edge: site } as BotCommand);
    const after = viewOf(built, 'p1');
    expect(after.board.roads[site]).toEqual({ player: 'p1', ship: false, bridge: true });
    const afterModel = boardModel(after, 'p1', MODULES);
    expect(piecesOnBoard(afterModel, 'p1').roads).toBe(0);
    expect(roadStockLeft(after, 'p1')).toBe(stock);
    expect(routeLength(afterModel, 'p1')).toBe(1);
    expect(searchRoads(afterModel, 'p1', 3).distance[far]).toBe(0);
    expect(coinsOf(built).gold.p1).toBe(BRIDGE_GOLD);
    expect(bridgeSites(after)).toEqual(riversOf(built).bridgeSites);
  });
});

/** 投影附上這個回合的 `turn.started` 與 p1 一筆換出 brick 的銀行交易（同回合的守門，#180）。 */
function brickGivenThisTurn(view: GameView): GameView {
  const events = [
    ...view.events,
    { seq: view.seq + 1, type: 'turn.started', params: { playerId: 'p1', windowId: 1, pairedActor: 1 } },
    { seq: view.seq + 2, type: 'trade.bank', params: { playerId: 'p1', give: 'brick', receive: 'grain', rate: 4 } },
  ];
  return { ...view, events, seq: view.seq + 2 };
}

describe('tb.buildBridge on the primary plan’s route', () => {
  for (const level of LEVELS) {
    it(`${level} builds the bridge when the plan’s next road is a bridge site`, () => {
      const state = bare();
      const { site, near, far } = siteOf(state);
      placeBuilding(state, 'p1', near);
      setHand(state, 'p1', BRIDGE_COST);
      const turn = withPlans(turnOf(state, 'p1', level), [bridgePlan(state, site, far)]);
      const [first] = riversCandidates(turn);
      expect(first?.item).toEqual({ type: 'tb.buildBridge', edge: site });
      // 計畫的一步加上 3 gold；easy 不估排名，低於立即得分的建造。standard 另加排名（三人都是 Poor，+3 gold 成為唯一最多）。
      expect(first!.score).toBeGreaterThan(PLAN_BRIDGE_SCORE);
      if (level === 'easy') expect(first!.score).toBeLessThan(1);
      accept(state, 'p1', first!.item);
    });

    it(`${level} trades or buys the missing brick for the bridge (the skeleton would only cover a road)`, () => {
      const trade = bare();
      const { site, near, far } = siteOf(trade);
      placeBuilding(trade, 'p1', near);
      setHand(trade, 'p1', { brick: 1, lumber: 1, wool: 5 });
      const plan = bridgePlan(trade, site, far);
      const traded = riversCandidates(withPlans(turnOf(trade, 'p1', level), [plan]));
      expect(traded.map((candidate) => candidate.item)).toEqual([{ type: 'trade.bank', give: 'wool', receive: 'brick' }]);
      accept(trade, 'p1', traded[0]!.item);

      // 並列 Poor（每人 2 gold）時用 gold 買，standard 不會因此失分。
      const buy = bare();
      placeBuilding(buy, 'p1', near);
      setHand(buy, 'p1', { brick: 1, lumber: 1 });
      setGold(buy, { p1: 2, p2: 2, p3: 2 });
      const bought = riversCandidates(withPlans(turnOf(buy, 'p1', level), [plan]));
      expect(bought.map((candidate) => candidate.item)).toEqual([{ type: 'tb.buyResource', resource: 'brick' }]);
      const next = accept(buy, 'p1', bought[0]!.item);
      expect(riversCandidates(withPlans(turnOf(next, 'p1', level), [plan]))[0]?.item).toEqual({ type: 'tb.buildBridge', edge: site });
    });
  }

  it('does not trade toward a road on the bridge site when the guard blocks the bridge (#180, #196 review)', () => {
    const state = bare();
    const { site, near, far } = siteOf(state);
    placeBuilding(state, 'p1', near);
    setHand(state, 'p1', { brick: 1, wool: 5 });
    // 這個回合已經換出 brick：橋缺的第二張 brick 不能換回來。
    const view = viewOf(state, 'p1');
    const plan = bridgePlan(state, site, far);
    const turn = withPlans(turnContext(brickGivenThisTurn(view), ctxFor('p1'), 'standard'), [plan]);
    expect(riversCandidates(turn)).toEqual([]);
    // 照道路的成本（brick 已有）只缺 lumber，換得到；但橋位不能蓋路，橋又還缺 brick，這筆交易是白換的。
    expect(view.hints!.legalRoads).not.toContain(site);
    expect(bankTradeToward(turn.view, turn.economy, plan.nextCost, plan.cost, 'p1')).toEqual({ type: 'trade.bank', give: 'wool', receive: 'lumber' });
    expect(primaryBankTrade(turn, plan)).toBeNull();
  });

  for (const level of LEVELS) {
    it(`${level} buys the kind the bank cannot give back this turn first (#180, #196 review)`, () => {
      // 缺 brick 1、lumber 2，gold 只夠買一張，有 8 張過剩的 wool；這個回合已經換出 brick。照「缺最多的優先」會先買 lumber，
      // 剩下的 brick 被守門擋住，整個步驟就沒有候選；先買 brick，兩張 lumber 再用 wool 換得到。
      const state = bare();
      const { near } = siteOf(state);
      placeBuilding(state, 'p1', near);
      setHand(state, 'p1', { brick: 1, wool: 8 });
      setGold(state, { p1: 2, p2: 2, p3: 2 });
      const turn = turnContext(brickGivenThisTurn(viewOf(state, 'p1')), ctxFor('p1', level), level);
      const step = { brick: 2, lumber: 2 };
      expect(purchaseToward(turn, step, step)?.item).toEqual({ type: 'tb.buyResource', resource: 'brick' });
      // 沒有同回合的交易時照舊：先買缺最多的 lumber。
      const plain = turnContext(viewOf(state, 'p1'), ctxFor('p1', level), level);
      expect(purchaseToward(plain, step, step)?.item).toEqual({ type: 'tb.buyResource', resource: 'lumber' });
    });
  }

  it('leaves an unconnected bridge site to the skeleton', () => {
    const state = bare();
    const { site, far } = siteOf(state);
    setHand(state, 'p1', BRIDGE_COST);
    expect(bridgeTargets(viewOf(state, 'p1'))).toEqual([]);
    expect(riversCandidates(withPlans(turnOf(state, 'p1'), [bridgePlan(state, site, far)]))).toEqual([]);
  });
});

describe('tb.buildBridge with spare cards', () => {
  for (const level of LEVELS) {
    it(`${level} turns spare brick and lumber into a bridge while saving for a city`, () => {
      const state = bare();
      const { site, near } = siteOf(state);
      placeBuilding(state, 'p1', near);
      setHand(state, 'p1', { ...BRIDGE_COST, ore: 2, grain: 2 });
      expect(turnOf(state, 'p1', level).economy.plans[0]?.kind).toBe('city');
      const command = decide(state, 'p1', level);
      expect(command).toEqual({ type: 'tb.buildBridge', edge: site });
      const built = accept(state, 'p1', command);
      expect(coinsOf(built).gold.p1).toBe(BRIDGE_GOLD);
    });
  }

  it('keeps the primary plan’s cards unless the gold wins the game now', () => {
    // p1 有 9 VP（1 座聚落 + 8 加分）、0 gold，是 Poor（−2）：目前 7 分。手上的牌是聚落計畫要用的。
    const state = bare();
    const { site, near } = siteOf(state);
    placeBuilding(state, 'p1', near);
    state.players[0]!.bonusPoints = 8;
    setHand(state, 'p1', { brick: 2, lumber: 2, wool: 1, grain: 1 });
    setGold(state, { p2: 1, p3: 1 });
    const view = viewOf(state, 'p1');
    // 蓋橋 +3 gold：唯一最多（+1）、不再是 Poor（+2），9 + 1 = 10 分，立即達標。
    expect(wealthValue(view, 'p1', BRIDGE_GOLD)).toBe(WIN_VALUE);
    const command = decide(state, 'p1', 'standard');
    expect(command).toEqual({ type: 'tb.buildBridge', edge: site });
    expect(accept(state, 'p1', command).result).toMatchObject({ playerId: 'p1', reason: 'victory' });

    // 離勝利還遠：排名權重是下限，會動用聚落計畫的牌，不蓋。
    const early = bare();
    placeBuilding(early, 'p1', near);
    setHand(early, 'p1', { brick: 2, lumber: 2, wool: 1, grain: 1 });
    setGold(early, { p2: 1, p3: 1 });
    expect(wealthWeight(viewOf(early, 'p1'), 'p1')).toBe(WEALTH_WEIGHT_FLOOR);
    expect(riversCandidates(turnOf(early, 'p1')).filter((candidate) => candidate.item.type === 'tb.buildBridge')).toEqual([]);
  });
});

describe('road plans after the last bridge (#195 review)', () => {
  /**
   * p1 的 3 座橋都蓋好了，聚落在第 4 個橋位的一端（另一端不在自己的道路網上）：base 的道路搜尋（沒有 `routeEdge`）會經過
   * 那個空橋位到達另一端。依橋位順序找第一個這樣的盤面（決定性）。
   */
  function exhausted(): { state: GameState; site: number; far: number } {
    const sites = riversOf(bare()).bridgeSites;
    for (const site of sites) {
      for (const end of [0, 1] as const) {
        const state = bare();
        const [home, far] = end === 0 ? topologyOf(state).edges[site]!.vertices : [...topologyOf(state).edges[site]!.vertices].reverse();
        placeBuilding(state, 'p1', home!);
        const others = sites.filter((other) => other !== site).slice(0, 3);
        for (const other of others) state.board.roads[other] = { player: 'p1', ship: false, bridge: true };
        setHand(state, 'p1', { brick: 2, lumber: 2, wool: 1, grain: 1 });
        const plain = searchRoads(boardModel(viewOf(state, 'p1'), 'p1'), 'p1', 3);
        if (plain.distance[far!] === 1 && plain.viaEdge[far!] === site) return { state, site, far: far! };
      }
    }
    throw new Error('no bridge-site route');
  }

  it('keeps plans off an empty bridge site once all bridges are built, and keeps building', () => {
    const { state, site, far } = exhausted();
    const view = viewOf(state, 'p1');
    expect(bridgesLeft(view, 'p1')).toBe(0);
    expect(bridgeTargets(view)).toEqual([]);
    const model = boardModel(view, 'p1', MODULES);
    expect(bridgeRouteEdge(model, site)).toBe(false);
    // 有 Rivers 的 `routeEdge` 時，搜尋不再經過那個橋位。
    expect(searchRoads(model, 'p1', 3).viaEdge[far]).not.toBe(site);
    // 其他邊不表態；別人的橋數不影響自己的路線。
    const land = topologyOf(state).vertices[topologyOf(state).edges[site]!.vertices[0]!]!.edges.find((edge) => edge !== site)!;
    expect(bridgeRouteEdge(model, land)).toBeUndefined();
    expect(bridgeRouteEdge(boardModel(viewOf(state, 'p2'), 'p2', MODULES), site)).toBeUndefined();

    const sites = new Set(bridgeSites(view));
    for (const level of LEVELS) {
      const turn = turnOf(state, 'p1', level);
      for (const plan of turn.economy.plans) {
        expect(plan.roads.filter((edge) => sites.has(edge)), `${level} ${plan.kind} ${plan.vertex}`).toEqual([]);
      }
      // 這一回合照樣鋪路推進計畫，不會拿著聚落的牌直接結束回合。
      let current = state;
      const sent: string[] = [];
      for (let step = 0; step < 8 && !current.result; step++) {
        const command = createBotPolicy(level).decide(viewOf(current, 'p1'), ctxFor('p1', level, 3 + step));
        if (!command) break;
        sent.push(command.type);
        current = accept(current, 'p1', command);
        if (command.type === 'turn.end') break;
      }
      expect(sent[0], `${level}: ${sent.join(', ')}`).not.toBe('turn.end');
      expect(sent.some((type) => type.startsWith('build.')), `${level}: ${sent.join(', ')}`).toBe(true);
    }
  });

  it('saves the last bridge for plan routes unless it is worth an immediate build', () => {
    const state = bare();
    const { site, near } = siteOf(state);
    placeBuilding(state, 'p1', near);
    setHand(state, 'p1', { ...BRIDGE_COST, ore: 2, grain: 2 });
    const others = riversOf(state).bridgeSites.filter((other) => other !== site).slice(0, 2);
    for (const other of others) state.board.roads[other] = { player: 'p1', ship: false, bridge: true };
    const turn = turnOf(state, 'p1');
    expect(bridgesLeft(turn.view, 'p1')).toBe(1);
    const onRoute = turn.economy.plans.some((plan) => plan.roads.includes(site));
    const bridges = riversCandidates(turn).filter((candidate) => candidate.item.type === 'tb.buildBridge');
    // 這個橋位不在任何計畫路線上：只靠 gold 的最後一座橋不蓋（兩座橋以上時照樣蓋，見上面的 spare 測試）。
    expect(onRoute).toBe(false);
    expect(bridges).toEqual([]);
  });
});

describe('wealth tiles (standard only)', () => {
  it('weighs the tiles by the distance to victory and ignores them on easy', () => {
    const state = bare();
    placeBuilding(state, 'p1', siteOf(state).near);
    setGold(state, { p2: 1, p3: 1 });
    // p1 是 Poor：+1 gold 與 p2、p3 並列，三人都是 Poor，沒有變化；+2 gold 脫離 Poor 並成為唯一最多（+3）。
    const view = viewOf(state, 'p1');
    expect(wealthValue(view, 'p1', 1)).toBe(0);
    expect(wealthValue(view, 'p1', 2)).toBeCloseTo(3 * WEALTH_WEIGHT_FLOOR);
    for (const [bonus, weight] of [
      [6, WEALTH_WEIGHT_FLOOR],
      [8, 0.5],
      [9, 0.75],
    ] as const) {
      state.players[0]!.bonusPoints = bonus;
      expect(wealthWeight(viewOf(state, 'p1'), 'p1'), `bonus ${bonus}`).toBeCloseTo(weight);
    }
    // 非 Rivers 沒有財富板塊。
    const ba = tbPlayable('tb-barbarian-attack-2025', { players: 3, seed: 4 });
    expect(wealthValue(viewOf(ba, 'p1'), 'p1', 5)).toBe(0);
  });
});

describe('river settlements', () => {
  /** 河邊的路口 `vertex`，p1 的聚落在兩條路之外（`u`），兩條路都不是橋位。 */
  function riverSpot(state: GameState): { vertex: number; roads: [number, number]; home: number } {
    const topology = topologyOf(state);
    const slot = riversOf(state);
    const sites = new Set(slot.bridgeSites);
    const river = new Set(slot.vertices);
    for (const vertex of slot.vertices) {
      for (const first of topology.vertices[vertex]!.edges) {
        if (sites.has(first)) continue;
        const [a, b] = topology.edges[first]!.vertices;
        const middle = a === vertex ? b : a;
        for (const second of topology.vertices[middle]!.edges) {
          if (second === first || sites.has(second)) continue;
          const [c, d] = topology.edges[second]!.vertices;
          const home = c === middle ? d : c;
          if (home !== vertex && !river.has(home)) return { vertex, roads: [first, second], home };
        }
      }
    }
    throw new Error('no river spot');
  }

  for (const level of LEVELS) {
    it(`${level} values the gold of a river settlement and earns it`, () => {
      const state = bare();
      const { vertex, roads, home } = riverSpot(state);
      placeBuilding(state, 'p1', home);
      for (const edge of roads) placeRoad(state, 'p1', edge);
      setHand(state, 'p1', COSTS.settlement);
      expect(viewOf(state, 'p1').hints?.legalSettlements).toEqual([vertex]);
      const candidates = riversCandidates(turnOf(state, 'p1', level));
      expect(candidates.map((candidate) => candidate.item)).toEqual([{ type: 'build.settlement', vertex }]);
      const command = decide(state, 'p1', level);
      expect(command).toEqual({ type: 'build.settlement', vertex });
      expect(coinsOf(accept(state, 'p1', command)).gold.p1).toBe(RIVER_BUILD_GOLD);
    });
  }
});

/** Rivers 的對局狀態（每 `every` 步取一次）。 */
function snapshots(players: number, seed: number, every: number): GameState[] {
  const out: GameState[] = [];
  let step = 0;
  runTbGame(
    { ...tbMatrix(PROFILE, players)[0]!, seed, label: `${PROFILE} ${players}p snapshots` },
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
  const states = [...snapshots(4, 3, 4), ...snapshots(3, 4, 6)];

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
        expect(compared).toBeGreaterThanOrEqual(150);
      },
      GAME_TIMEOUT,
    );
  }

  it(
    'answers perturbed gold and hands with accepted commands, or owes nothing',
    () => {
      const rng = seededRng(91);
      const failures: string[] = [];
      let checked = 0;
      for (const [index, state] of states.entries()) {
        const variant = perturbState(state, rng, KITS);
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
            const outcome = applyCommand(variant, player.id, command as Command, seededRng(1));
            if (!outcome.ok) failures.push(`${index} ${player.id} (${name}) ${JSON.stringify(command)} → ${outcome.error.code}`);
          }
        }
      }
      expect(failures).toEqual([]);
      expect(checked).toBeGreaterThanOrEqual(300);
    },
    GAME_TIMEOUT,
  );
});
