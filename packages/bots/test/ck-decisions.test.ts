/**
 * CK-B2 決策測試（C&K 計畫 §4.3、§4.4、§6.1）：固定盤面上驗證每個策略鉤子。
 *
 * - setup 第 2 輪的城市選點分數、蠻族防禦（D-CK1）、改良與主軌道、knight／wall／improve 計畫、F1 卡的時機與
 *   Smithing 的棋子存量（C4）、`progressExcess`、commodity 的銀行交易，以及 easy 與 standard 的差異。
 * - 盤面由 `rules/test/ck-helpers.ts` 以真實指令與狀態建構；每個送出的指令都必須被 `applyCommand` 接受。
 * - §4.9 為 0.4.3 保留的掛點：強盜在首次攻擊前不存在（`robberActive`）、`chaseValue` 的輸入輸出、
 *   策略原始碼沒有寫死勝利分 13。
 * - 審查留下的三項：`hexYield` 讀的是假設盤面（`at.view`）、真實 `build.wall` 之後擲 7 的應棄張數對上
 *   `Economy.handLimit`、dedupe 把 `undefined` 值的欄位與缺欄位視為相同。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  CK_ACTIVATE_COST,
  CK_KNIGHT_COST,
  projectGame,
  seededRng,
  type Command,
  type GameState,
  type GameView,
} from '@catan/rules';
import {
  actCk,
  addKnight,
  emptyCkGame,
  giveCommodities,
  handCards,
  pathFrom,
  rollRng,
  roadAlong,
  setBuilding,
  setImprovement,
  SHIP,
  spreadVertices,
} from '../../rules/test/ck-helpers.ts';
import { forceTurn, give } from '../../rules/test/helpers.ts';
import { boardModel } from '../src/board.ts';
import { economyOf } from '../src/economy.ts';
import { dedupeCandidates, turnContext } from '../src/heuristic.ts';
import { citiesKnightsBotModule } from '../src/modules/citiesKnights/index.ts';
import {
  F1_CARDS,
  cardActions,
  cardValue,
  lowestValueCards,
  smithingPlan,
} from '../src/modules/citiesKnights/cards.ts';
import {
  defenseActions,
  defenseAway,
  defensePlan,
  defenseWindow,
  guardedKnights,
} from '../src/modules/citiesKnights/defense.ts';
import { mainTrack, trackOptions } from '../src/modules/citiesKnights/improve.ts';
import { chaseCandidates, chaseValue, threatOf } from '../src/modules/citiesKnights/knights.ts';
import { IMPROVE_PLAN, KNIGHT_PLAN, WALL_PLAN, citiesKnightsPlanStep, desiredKnights } from '../src/modules/citiesKnights/plans.ts';
import { citySetupScore } from '../src/modules/citiesKnights/setup.ts';
import { commodityTradeActions } from '../src/modules/citiesKnights/trade.ts';
import type { TurnContext } from '../src/modules/types.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotCommand, BotContext, BotLevel } from '../src/types.ts';
import { stripComments } from './families.ts';
import { cloneState, newBotGame } from './harness.ts';

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 1): BotContext => ({
  selfId,
  level,
  seed,
  offerPhases: {},
});

function turnOf(state: GameState, level: BotLevel = 'standard', selfId = 'p1'): TurnContext {
  return turnContext(viewOf(state, selfId), ctxFor(selfId, level), level);
}

function decide(state: GameState, level: BotLevel = 'standard', selfId = 'p1', seed = 1): BotCommand | null {
  return createBotPolicy(level).decide(viewOf(state, selfId), ctxFor(selfId, level, seed));
}

/** 指令必須被引擎接受。 */
function expectAccepted(state: GameState, actor: string, command: BotCommand | null | undefined): void {
  expect(command, `${actor} has a command`).not.toBeNull();
  const outcome = applyCommand(state, actor, command as Command, seededRng(1));
  expect(outcome.ok, `${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
}

function decideAccepted(state: GameState, level: BotLevel = 'standard', selfId = 'p1', seed = 1): BotCommand {
  const command = decide(state, level, selfId, seed);
  expectAccepted(state, selfId, command);
  return command!;
}

function setBarbarian(state: GameState, position: number, attacks = 0): void {
  Object.assign(state.moduleState!.citiesKnights as object, { barbarian: position, attacks });
}

/**
 * 防守盤面：p1 有 `cities` 座城市與一條路，p2 有 1 座城市（另有 `otherKnight` 等級的啟動騎士，0 為沒有），
 * 蠻族在 `position`；p1 手上只有 `hand`。
 */
function defenseGame(options: {
  position: number;
  hand?: Parameters<typeof give>[2];
  knights?: { level: 1 | 2 | 3; active: boolean }[];
  otherKnight?: number;
  cities?: number;
}): { state: GameState; knightVertices: number[]; cities: number[] } {
  const state = emptyCkGame(4, 0, 'action');
  const picks = spreadVertices(state, 8);
  const cities = picks.slice(0, options.cities ?? 2);
  for (const vertex of cities) setBuilding(state, 'p1', vertex, true);
  setBuilding(state, 'p2', picks[4]!, true);
  const path = pathFrom(state, cities[0] ?? picks[0]!, 2);
  roadAlong(state, 'p1', path);
  const knightVertices = picks.slice(5, 8);
  (options.knights ?? []).forEach((knight, index) => addKnight(state, { player: 'p1', vertex: knightVertices[index]!, ...knight }));
  if (options.otherKnight) addKnight(state, { player: 'p2', vertex: picks[3]!, level: options.otherKnight as 1 | 2 | 3, active: true });
  setBarbarian(state, options.position);
  give(state, 'p1', options.hand ?? {});
  return { state, knightVertices, cities };
}

/** p1 的城市在強盜的格子上，p1 有一隻能追強盜的騎士。 */
function robberGame(attacks: number, active = false): { state: GameState; hex: number; vertex: number } {
  const state = emptyCkGame(4, 0, 'action');
  const [a] = spreadVertices(state, 1);
  setBuilding(state, 'p1', a!, true);
  const topo = boardModel(viewOf(state, 'p1'), 'p1').topo;
  const hex = topo.vertices[a!]!.hexes.find((candidate) => state.board.layout.terrain[candidate] !== 'desert' && state.board.layout.numbers[candidate])!;
  state.board.robber = hex;
  const knightAt = topo.vertices[a!]!.edges
    .flatMap((edge) => topo.edges[edge]!.vertices)
    .find((vertex) => vertex !== a && !state.board.buildings[vertex] && topo.vertices[vertex]!.hexes.includes(hex))!;
  addKnight(state, { player: 'p1', vertex: knightAt, level: 1, active });
  setBarbarian(state, 0, attacks);
  return { state, hex, vertex: knightAt };
}


// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

describe('setup 第 2 輪的城市選點', () => {
  /** 兩位玩家都走完第 1 輪，輪到第 2 輪的第一個放置。 */
  function secondRound(): { state: GameState; actor: string } {
    const { state } = newBotGame({ profileId: 'ck-2025', players: 4, seed: 5 });
    const policy = createBotPolicy('standard');
    for (let guard = 0; guard < 80; guard++) {
      const actor = state.players[state.turn.seat]!.id;
      if (state.turn.setup?.round === 2 && state.turn.setup.stage === 'building') return { state, actor };
      const command = policy.decide(viewOf(state, actor), ctxFor(actor));
      expectAccepted(state, actor, command);
      const outcome = applyCommand(state, actor, command as Command, seededRng(guard + 1));
      if (!outcome.ok) throw new Error(outcome.error.code);
      Object.assign(state, outcome.state);
    }
    throw new Error('no second round reached');
  }

  it('picks a legal vertex with the best city score, and touches ore or grain', () => {
    const { state, actor } = secondRound();
    const view = viewOf(state, actor);
    const model = boardModel(view, actor, [citiesKnightsBotModule]);
    const command = decide(state, 'standard', actor) as { type: string; vertex: number };
    expect(command.type).toBe('setup.placeBuilding');
    const legal = view.hints!.legalSettlements;
    expect(legal).toContain(command.vertex);
    const best = Math.max(...legal.map((vertex) => citySetupScore(model, vertex)));
    expect(citySetupScore(model, command.vertex)).toBeCloseTo(best, 9);
    const resources = model.topo.vertices[command.vertex]!.hexes.map((hex) => model.hexResource[hex]);
    expect(resources.some((resource) => resource === 'ore' || resource === 'grain'), `hexes ${resources.join(',')}`).toBe(true);
  });

  it('scores a vertex without ore and grain below the same vertex set with one of them', () => {
    const { state, actor } = secondRound();
    const model = boardModel(viewOf(state, actor), actor, [citiesKnightsBotModule]);
    const legal = viewOf(state, actor).hints!.legalSettlements;
    const touches = (vertex: number, kinds: string[]) =>
      model.topo.vertices[vertex]!.hexes.some((hex) => kinds.includes(model.hexResource[hex] ?? ''));
    const without = legal.filter((vertex) => !touches(vertex, ['ore', 'grain']));
    const withOne = legal.filter((vertex) => touches(vertex, ['ore', 'grain']));
    expect(without.length).toBeGreaterThan(0);
    expect(withOne.length).toBeGreaterThan(0);
    const best = (vertices: number[]) => Math.max(...vertices.map((vertex) => citySetupScore(model, vertex)));
    expect(best(withOne)).toBeGreaterThan(best(without));
  });

  it('leaves the first round to the base setup (a module returns undefined)', () => {
    const { state } = newBotGame({ profileId: 'ck-2025', players: 4, seed: 5 });
    const actor = state.players[state.turn.seat]!.id;
    const turn = turnContext(viewOf(state, actor), ctxFor(actor), 'standard');
    expect(citiesKnightsBotModule.setup!(turn)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 防禦（D-CK1）
// ---------------------------------------------------------------------------

describe('蠻族防禦（D-CK1）', () => {
  it('activates an idle knight first when the barbarians are two ships away and the player is at risk', () => {
    const { state, knightVertices } = defenseGame({ position: 5, hand: { grain: 1, wool: 1, ore: 1 }, knights: [{ level: 1, active: false }] });
    expect(defenseWindow(turnOf(state))).toBe(true);
    const command = decideAccepted(state);
    expect(command).toEqual({ type: 'knight.activate', vertex: knightVertices[0] });
  });

  it('prefers activating over recruiting and promoting (cheapest contribution first)', () => {
    const { state } = defenseGame({
      position: 5,
      hand: { grain: 2, wool: 2, ore: 2 },
      knights: [{ level: 1, active: false }],
    });
    const plan = defensePlan(turnOf(state));
    expect(plan.steps[0]!.command.type).toBe('knight.activate');
  });

  it('recruits when it owns no knight and can pay a recruit plus an activation', () => {
    const { state } = defenseGame({ position: 6, hand: { grain: 1, wool: 1, ore: 1 } });
    const command = decideAccepted(state);
    expect(command.type).toBe('knight.recruit');
  });

  it('does nothing about the barbarians when it cannot pay for any contribution', () => {
    const { state } = defenseGame({ position: 6, hand: { lumber: 1 }, knights: [{ level: 1, active: false }] });
    expect(defenseActions(turnOf(state))).toEqual([]);
  });

  it('does not react while the barbarians are far away', () => {
    const { state } = defenseGame({ position: 2, hand: { grain: 1 }, knights: [{ level: 1, active: false }] });
    expect(defenseWindow(turnOf(state))).toBe(false);
    expect(defenseActions(turnOf(state))).toEqual([]);
  });

  it('does not defend without a pillageable city (only a metropolis, or no city at all)', () => {
    const none = defenseGame({ position: 6, hand: { grain: 1 }, knights: [{ level: 1, active: false }], cities: 0 }).state;
    expect(threatOf(viewOf(none, 'p1'), 'p1').pillageable).toBe(0);
    expect(defenseActions(turnOf(none))).toEqual([]);
    const { state, cities } = defenseGame({ position: 6, hand: { grain: 1 }, knights: [{ level: 1, active: false }], cities: 1 });
    const metropolis = state.moduleState!.citiesKnights as { metropolises: Record<string, unknown> };
    metropolis.metropolises.trade = { player: 'p1', vertex: cities[0]! };
    expect(threatOf(viewOf(state, 'p1'), 'p1').pillageable).toBe(0);
    expect(defenseActions(turnOf(state))).toEqual([]);
  });

  it('stays out of the lowest group by beating the weakest rival, not by out-defending the barbarians', () => {
    // 蠻族強度 3（三座城市）；p2 已有 1 級騎士在防守：p1 只要贏過 p2 就不會被掠奪。
    const { state } = defenseGame({ position: 6, hand: { grain: 2 }, knights: [{ level: 1, active: false }, { level: 1, active: false }], otherKnight: 1 });
    const turn = turnOf(state);
    const threat = threatOf(turn.view, 'p1');
    expect(threat.lowestOther).toBe(1);
    expect(threat.atRisk).toBe(true);
    const plan = defensePlan(turn);
    // 兩次啟動才贏過 p2 的 1 點貢獻（總貢獻 2 > 1）。
    expect(plan.escapes).toBe(true);
    expect(plan.steps.filter((step) => step.command.type === 'knight.activate')).toHaveLength(2);
  });

  it('an active knight that is needed stays put: no chase while it is the one defending', () => {
    // 強盜壓在 p1 的城市上（首次攻擊之後才存在），騎士已啟動、攻擊逼近：追強盜會讓它躺下，所以不追。
    const { state, vertex } = robberGame(1, true);
    setBarbarian(state, 6, 1);
    const turn = turnOf(state);
    expect(guardedKnights(turn).has(vertex)).toBe(true);
    expect(chaseCandidates(turn, guardedKnights(turn))).toEqual([]);
    // 攻擊還遠時同一隻騎士可以追。
    setBarbarian(state, 0, 1);
    const far = turnOf(state);
    expect(guardedKnights(far).size).toBe(0);
    expect(chaseCandidates(far, guardedKnights(far)).length).toBeGreaterThan(0);
  });

  describe('easy', () => {
    it('only reacts from position 6 (one ship away)', () => {
      expect(defenseAway('easy')).toBe(1);
      expect(defenseAway('standard')).toBeGreaterThan(defenseAway('easy'));
      const early = defenseGame({ position: 5, hand: { grain: 1 }, knights: [{ level: 1, active: false }] });
      expect(defenseActions(turnOf(early.state, 'easy'))).toEqual([]);
      const late = defenseGame({ position: 6, hand: { grain: 1 }, knights: [{ level: 1, active: false }] });
      expect(defenseActions(turnOf(late.state, 'easy'))).toHaveLength(1);
      expectAccepted(late.state, 'p1', defenseActions(turnOf(late.state, 'easy'))[0]!.item);
    });
  });
});

// ---------------------------------------------------------------------------
// 改良、主軌道與計畫
// ---------------------------------------------------------------------------

describe('改良與計畫', () => {
  /** p1 有一座城市，手牌 `commodities`。 */
  function cityGame(commodities: Parameters<typeof giveCommodities>[2], level = 0): GameState {
    const state = emptyCkGame(4, 0, 'action');
    const [a] = spreadVertices(state, 1);
    setBuilding(state, 'p1', a!, true);
    giveCommodities(state, 'p1', commodities);
    void level;
    return state;
  }

  it('has no improve plan without a city (improvements need a city)', () => {
    const state = emptyCkGame(4, 0, 'action');
    giveCommodities(state, 'p1', { paper: 3 });
    expect(turnOf(state).economy.plans.filter((plan) => plan.kind.startsWith(IMPROVE_PLAN))).toEqual([]);
  });

  it('plans each track with the commodity cost of the next level, and the step is accepted', () => {
    const state = cityGame({ paper: 1 });
    const turn = turnOf(state);
    const plans = turn.economy.plans.filter((plan) => plan.kind.startsWith(IMPROVE_PLAN));
    expect(plans.length).toBeGreaterThan(0);
    const science = plans.find((plan) => plan.kind === `${IMPROVE_PLAN}.science`);
    expect(science).toMatchObject({ cost: { paper: 1 }, nextCost: { paper: 1 } });
    expectAccepted(state, 'p1', citiesKnightsPlanStep(turn, science!) as BotCommand);
  });

  it('the policy buys the improvement it can afford on its main track', () => {
    const state = cityGame({ paper: 1, cloth: 1, coin: 1 });
    const command = decideAccepted(state);
    expect(command.type).toBe('city.improve');
    expect((command as unknown as { track: string }).track).toBe(mainTrack(boardModel(viewOf(state, 'p1'), 'p1', [citiesKnightsBotModule])));
  });

  it('easy only improves the track it holds the most commodity of; standard also takes a cheap side track', () => {
    const state = cityGame({ paper: 3, cloth: 1 });
    const model = boardModel(viewOf(state, 'p1'), 'p1', [citiesKnightsBotModule]);
    expect(mainTrack(model, 'easy')).toBe('science');
    expect(trackOptions(model, 'easy').filter((option) => option.main).map((option) => option.track)).toEqual(['science']);
    const easyPlans = turnOf(state, 'easy').economy.plans.filter((plan) => plan.kind.startsWith(IMPROVE_PLAN));
    expect(easyPlans.map((plan) => plan.kind)).toEqual([`${IMPROVE_PLAN}.science`]);
    const standardPlans = turnOf(state).economy.plans.filter((plan) => plan.kind.startsWith(IMPROVE_PLAN));
    expect(standardPlans.length).toBeGreaterThan(1);
  });

  it('values the metropolis step above a plain level, and a main-track level above a side-track level', () => {
    const state = cityGame({ paper: 4 });
    setImprovement(state, 'p1', 'science', 3);
    const model = boardModel(viewOf(state, 'p1'), 'p1', [citiesKnightsBotModule]);
    const options = trackOptions(model);
    const science = options.find((option) => option.track === 'science')!;
    const trade = options.find((option) => option.track === 'trade')!;
    expect(science.metropolis).toBe(true);
    expect(science.value).toBeGreaterThan(trade.value);
  });

  it('plans a knight (activation) in the window, with the grain reserved as the next cost', () => {
    const { state } = defenseGame({ position: 5, hand: { grain: 1 }, knights: [{ level: 1, active: false }] });
    const plan = turnOf(state).economy.plans.find((candidate) => candidate.kind === KNIGHT_PLAN);
    expect(plan).toBeDefined();
    expect(plan!.cost).toEqual(CK_ACTIVATE_COST);
    expect(plan!.nextCost).toEqual(CK_ACTIVATE_COST);
  });

  it('wants one knight per two pillageable cities (at least one, at most three); easy wants one', () => {
    expect(desiredKnights(0, false)).toBe(0);
    expect(desiredKnights(1, false)).toBe(1);
    expect(desiredKnights(2, false)).toBe(2);
    expect(desiredKnights(6, false)).toBe(3);
    expect(desiredKnights(6, true)).toBe(1);
    expect(desiredKnights(0, true)).toBe(0);
  });

  it('plans a recruit while it owns no knight, even when the barbarians are far away', () => {
    const { state } = defenseGame({ position: 0, hand: {} });
    const plan = turnOf(state).economy.plans.find((candidate) => candidate.kind === KNIGHT_PLAN);
    expect(plan).toBeDefined();
    expect(plan!.cost).toEqual({ ...CK_KNIGHT_COST, ...CK_ACTIVATE_COST });
    expect(plan!.nextCost).toEqual(CK_KNIGHT_COST);
  });

  it('never recruits with an activation-only budget: the recruit cost is checked again in planStep', () => {
    // 手上只有 grain（付得起啟動、付不起招募），而且沒有躺著的騎士：計畫的下一步不得是招募。
    const { state } = defenseGame({ position: 6, hand: { grain: 2 } });
    const turn = turnOf(state);
    const plan = turn.economy.plans.find((candidate) => candidate.kind === KNIGHT_PLAN)!;
    expect(citiesKnightsPlanStep(turn, plan)).toBeNull();
  });

  it('builds a wall only for a standard bot whose hand regularly reaches the limit', () => {
    const state = cityGame({}, 0);
    give(state, 'p1', { lumber: 2, brick: 2, wool: 2, grain: 1 });
    const standard = turnOf(state).economy.plans.find((plan) => plan.kind === WALL_PLAN);
    expect(standard).toBeDefined();
    expect(turnOf(state, 'easy').economy.plans.some((plan) => plan.kind === WALL_PLAN)).toBe(false);
    const small = cityGame({});
    give(small, 'p1', { lumber: 1 });
    expect(turnOf(small).economy.plans.some((plan) => plan.kind === WALL_PLAN)).toBe(false);
  });

  it('planStep leaves kinds of other modules and base alone (undefined)', () => {
    const state = cityGame({});
    const turn = turnOf(state);
    const plan = { kind: 'seafarers.island', vertex: null, roads: [], cost: {}, nextCost: {}, value: 1, eta: 0, score: 1 } as never;
    expect(citiesKnightsPlanStep(turn, plan)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 進步卡
// ---------------------------------------------------------------------------

describe('Smithing 的棋子存量（C4）', () => {
  const k = (vertex: number, level: number, active = true) => ({ vertex, level, active });

  it('promotes two knights when the supply allows both', () => {
    expect(smithingPlan([k(1, 1), k(2, 1)], { 1: 0, 2: 2, 3: 2 }, 0).sort()).toEqual([1, 2]);
  });

  it('the first promotion takes the last level-2 piece, so only one knight is promoted', () => {
    expect(smithingPlan([k(1, 1), k(2, 1)], { 1: 0, 2: 1, 3: 2 }, 0)).toHaveLength(1);
  });

  it('promotes the higher knight first, which returns a level-2 piece for the second', () => {
    // supply[2] = 0：先把 2 級升 3 級（需要 politics 3）釋出一個 2 級棋子，再升 1 級。
    expect(smithingPlan([k(1, 1), k(2, 2)], { 1: 0, 2: 0, 3: 2 }, 3)).toEqual([2, 1]);
    // 沒有 politics 3，升不了 3 級，兩隻都升不成：2 級棋子是 0。
    expect(smithingPlan([k(1, 1), k(2, 2)], { 1: 0, 2: 0, 3: 2 }, 0)).toEqual([]);
  });

  it('never promotes beyond level 3 or into an empty supply', () => {
    expect(smithingPlan([k(1, 3)], { 1: 0, 2: 0, 3: 0 }, 3)).toEqual([]);
    expect(smithingPlan([k(1, 2)], { 1: 0, 2: 2, 3: 0 }, 3)).toEqual([]);
  });

  it('prefers promoting an active knight (it adds to the defense at once)', () => {
    expect(smithingPlan([k(1, 1, false), k(2, 1, true)], { 1: 0, 2: 1, 3: 0 }, 0)).toEqual([2]);
  });

  it('plays Smithing against the real engine: the two chosen knights are accepted', () => {
    // p1 的兩隻騎士還躺著、p2 有 1 點貢獻：p1 有風險，兩隻都升級（升級的騎士不會自動啟動，但棋子存量夠）。
    const { state } = defenseGame({ position: 6, knights: [{ level: 1, active: false }, { level: 1, active: false }], otherKnight: 1 });
    handCards(state, 'p1', ['smithing']);
    const turn = turnOf(state);
    const candidate = cardActions(turn).find((entry) => (entry.item as { card?: string }).card === 'smithing');
    expect(candidate).toBeDefined();
    expectAccepted(state, 'p1', candidate!.item);
  });
});

describe('F1 進步卡', () => {
  it('lists exactly the twelve non-interactive cards, all with a value in the table', () => {
    expect(F1_CARDS).toHaveLength(12);
    for (const card of F1_CARDS) expect(cardValue(card), card).toBeGreaterThan(1);
    // F2 與 Alchemy 在 CK-C 之前評為低價，而且不在 F1。
    for (const card of ['alchemy', 'invention', 'guildDues', 'espionage', 'intrigue', 'sabotage', 'wedding', 'taxation', 'treason', 'diplomacy', 'commercialHarbor']) {
      expect(F1_CARDS).not.toContain(card);
      expect(cardValue(card), card).toBeLessThan(1.5);
    }
  });

  it('discards the lowest-value cards, independent of their order', () => {
    expect(lowestValueCards(['merchant', 'alchemy', 'crane', 'invention'], 2)).toEqual(['alchemy', 'invention']);
    expect(lowestValueCards(['invention', 'crane', 'alchemy', 'merchant'], 2)).toEqual(['alchemy', 'invention']);
  });

  it('with progress excess, plays a playable card first and only then discards the lowest', () => {
    const { state } = defenseGame({ position: 0 });
    handCards(state, 'p1', ['merchant', 'alchemy', 'invention', 'guildDues', 'sabotage']);
    expect(actionHints(state, 'p1').canEndTurn).toBe(false);
    const first = decideAccepted(state);
    expect(first).toMatchObject({ type: 'progress.play', card: 'merchant' });
    const after = actCk(state, 'p1', first as never).state;
    // 打完仍超過上限（4 張）就棄最低價值的牌：alchemy 在表上最低。
    const second = decide(after, 'standard', 'p1');
    if (actionHints(after, 'p1').canEndTurn === false) {
      expect(second).toMatchObject({ type: 'progress.discard' });
      expect((second as unknown as { cards: string[] }).cards).toEqual(['alchemy']);
    }
    expectAccepted(after, 'p1', second);
  });

  it.each(['standard', 'easy'] as const)('with progress excess (%s) plays a playable card first, for every seed — never the discard', (level) => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { state } = defenseGame({ position: 0 });
      handCards(state, 'p1', ['merchant', 'alchemy', 'invention', 'guildDues', 'sabotage']);
      expect(actionHints(state, 'p1').canEndTurn).toBe(false);
      // 有可打的卡時，候選裡根本沒有棄牌（easy 的 topK 才不會抽到它）。
      const candidates = cardActions(turnOf(state, level));
      expect(candidates.some((candidate) => candidate.item.type === 'progress.discard'), `${level} seed ${seed}`).toBe(false);
      expect(candidates.some((candidate) => (candidate.item as { card?: string }).card === 'merchant')).toBe(true);
      const command = decideAccepted(state, level, 'p1', seed);
      expect(command, `${level} seed ${seed}`).toMatchObject({ type: 'progress.play', card: 'merchant' });
    }
  });

  it.each(['standard', 'easy'] as const)('with progress excess (%s) and nothing playable, it discards the lowest-value card', (level) => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { state } = defenseGame({ position: 0 });
      // F2 與 Alchemy 在 CK-C 之前不打：沒有可打的卡，只能棄。
      handCards(state, 'p1', ['guildDues', 'alchemy', 'invention', 'sabotage', 'wedding']);
      const candidates = cardActions(turnOf(state, level));
      expect(candidates).toHaveLength(1);
      const command = decideAccepted(state, level, 'p1', seed);
      expect(command, `${level} seed ${seed}`).toMatchObject({ type: 'progress.discard', cards: ['alchemy'] });
    }
  });

  it('plays mining and irrigation only with a legal hex and a stocked bank', () => {
    const state = emptyCkGame(4, 0, 'action');
    const [a] = spreadVertices(state, 1);
    setBuilding(state, 'p1', a!, true);
    handCards(state, 'p1', ['mining', 'irrigation']);
    const candidates = cardActions(turnOf(state));
    // 至少有一張因為自己的城市靠近 ore 或 grain 格而可打；打出的指令一律被接受。
    for (const candidate of candidates) expectAccepted(state, 'p1', candidate.item);
    const empty = emptyCkGame(4, 0, 'action');
    setBuilding(empty, 'p1', a!, true);
    handCards(empty, 'p1', ['mining', 'irrigation']);
    empty.bank.ore = 0;
    empty.bank.grain = 0;
    expect(cardActions(turnOf(empty))).toEqual([]);
  });

  it('easy waits until it holds three progress cards', () => {
    const state = emptyCkGame(4, 0, 'action');
    const [a] = spreadVertices(state, 1);
    setBuilding(state, 'p1', a!, true);
    handCards(state, 'p1', ['merchant', 'alchemy']);
    expect(cardActions(turnOf(state, 'easy'))).toEqual([]);
    expect(cardActions(turnOf(state)).length).toBeGreaterThan(0);
    handCards(state, 'p1', ['crane']);
    expect(cardActions(turnOf(state, 'easy')).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 交易
// ---------------------------------------------------------------------------

describe('commodity 的銀行交易', () => {
  function cityGame(): GameState {
    const state = emptyCkGame(4, 0, 'action');
    const [a] = spreadVertices(state, 1);
    setBuilding(state, 'p1', a!, true);
    return state;
  }

  /** 主軌道（沒有持有任何 commodity 時由產能決定）已投資到 3 級；手上只有 1 張它的 commodity，加上 5 張另一種。 */
  function shortOfMain(): { state: GameState; main: string; commodity: string; spare: string } {
    const state = cityGame();
    const model = boardModel(viewOf(state, 'p1'), 'p1', [citiesKnightsBotModule]);
    const main = mainTrack(model);
    const option = trackOptions(model).find((candidate) => candidate.track === main)!;
    const spare = option.commodity === 'cloth' ? 'coin' : 'cloth';
    setImprovement(state, 'p1', main, 3);
    giveCommodities(state, 'p1', { [option.commodity]: 1, [spare]: 5 });
    return { state, main, commodity: option.commodity, spare };
  }

  it('turns a spare commodity into the main track commodity it is short of (4:1)', () => {
    const { state, commodity, spare } = shortOfMain();
    const candidates = commodityTradeActions(turnOf(state));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.item).toEqual({ type: 'trade.bank', give: spare, receive: commodity });
    expectAccepted(state, 'p1', candidates[0]!.item);
  });

  it('trades nothing when the bank has none of the commodity, or nothing is spare', () => {
    const { state, commodity } = shortOfMain();
    (state.commodityBank as Record<string, number>)[commodity] = 0;
    expect(commodityTradeActions(turnOf(state))).toEqual([]);
    const poor = shortOfMain();
    // 多餘的牌比匯率少一張，換不成。
    const rate = turnOf(poor.state).economy.rates[poor.spare as 'cloth']!;
    const player = poor.state.players.find((candidate) => candidate.id === 'p1')!;
    (player.commodities as Record<string, number>)[poor.spare] = rate - 1;
    expect(commodityTradeActions(turnOf(poor.state))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4.9：為 SF+CK（0.4.3）保留的掛點
// ---------------------------------------------------------------------------

describe('0.4.3 的掛點（§4.9）', () => {
  it('the robber does not exist before the first attack: no chase candidate and chaseValue 0', () => {
    const { state, hex } = robberGame(0);
    const turn = turnOf(state);
    expect(chaseValue(turn, hex)).toBe(0);
    expect(chaseCandidates(turn)).toEqual([]);
  });

  it('after the first attack the robber on my city is worth chasing, and the value comes from the blocked pips', () => {
    const { state, hex } = robberGame(1);
    const turn = turnOf(state);
    expect(chaseValue(turn, hex)).toBeGreaterThan(0);
    // 騎士躺著可以行動；追強盜的候選被引擎接受。
    const candidates = chaseCandidates(turn);
    if (candidates.length > 0) expectAccepted(state, 'p1', candidates[0]!.item);
  });

  it('chaseValue is 0 for the pirate and for a robber that is off the board', () => {
    const { state, hex } = robberGame(1);
    const turn = turnOf(state);
    expect(chaseValue(turn, hex, 'pirate')).toBe(0);
    expect(chaseValue(turn, null)).toBe(0);
  });

  it('the strategy source does not hard-code the victory target of 13', () => {
    const files = import.meta.glob('../src/modules/citiesKnights/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(10);
    for (const [file, source] of Object.entries(files)) {
      // 去掉註解與字串之後，不得有獨立的 13（勝利分目標讀 `view.victoryTarget`）。
      const code = stripComments(source).replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '');
      expect(/(^|[^\w.])13([^\w.]|$)/.test(code), `${file} mentions a literal 13`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 審查留下的三項
// ---------------------------------------------------------------------------

describe('B1 審查留下的測試', () => {
  it('hexYield reads the hypothetical board (at.view), not the calling model', () => {
    const state = emptyCkGame(4, 0, 'action');
    const [a] = spreadVertices(state, 1);
    setBuilding(state, 'p1', a!, true);
    const model = boardModel(viewOf(state, 'p1'), 'p1', [citiesKnightsBotModule]);
    // 城市旁第一個產出資源的格子，地形是森林、牧場或山脈（city 產 1 張資源加 1 張 commodity）。
    const hex = model.topo.vertices[a!]!.hexes.find((candidate) => ['forest', 'pasture', 'mountains'].includes(model.view.board.terrain[candidate] as string));
    expect(hex, 'the city touches a commodity hex').toBeDefined();
    const resource = model.hexResource[hex!]!;
    expect(model.hexYield!(model, hex!, a!, true)).toMatchObject({ [resource]: 1 });
    expect(Object.keys(model.hexYield!(model, hex!, a!, true) as object)).toHaveLength(2);
    // 假設盤面把那格換成丘陵（只產資源）：同一個模型、不同的 `at.view`，答案要跟著 `at` 走。
    const terrain = model.view.board.terrain.map((value, index) => (index === hex ? 'hills' : value));
    const hypothetical = { ...model, view: { ...model.view, board: { ...model.view.board, terrain } } };
    expect(model.hexYield!(hypothetical as never, hex!, a!, true)).toBeUndefined();
    // 聚落不產 commodity：回 undefined 交給 base。
    expect(model.hexYield!(model, hex!, a!, false)).toBeUndefined();
  });

  it('a real build.wall raises the discard threshold by two: the engine\'s roll-7 discard matches Economy.handLimit', () => {
    const limitOf = (state: GameState): number =>
      economyOf(boardModel(viewOf(state, 'p1'), 'p1', [citiesKnightsBotModule]), [citiesKnightsBotModule]).handLimit;
    const walled = (): GameState => {
      const state = emptyCkGame(4, 0, 'action');
      const [a] = spreadVertices(state, 1);
      setBuilding(state, 'p1', a!, true);
      give(state, 'p1', { brick: 2 });
      const built = actCk(state, 'p1', { type: 'build.wall', vertex: a! }).state;
      built.players[0]!.resources.brick = 0;
      return built;
    };
    expect(limitOf(emptyCkGame(4, 0, 'action'))).toBe(7);
    const base = walled();
    expect(limitOf(base)).toBe(9);
    // 擲出 7：手牌恰為上限不必棄，多 1 張就要棄一半（無條件捨去）。
    for (const [hand, required] of [[9, null], [10, 5], [11, 5]] as const) {
      const state = cloneState(base);
      give(state, 'p1', { lumber: hand });
      forceTurn(state, 0, 'preroll');
      state.windowId += 1;
      const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, SHIP)).state;
      const pending = rolled.pending as { kind: string; required: Record<string, number> } | null;
      expect(pending?.required?.p1 ?? null, `hand ${hand}`).toBe(required);
      expect(hand > limitOf(state)).toBe(required !== null);
    }
  });

  it('dedupe merges a candidate with an undefined field with the same one lacking the field', () => {
    const candidates = dedupeCandidates([
      { item: { type: 'city.improve', track: 'trade', vertex: undefined } as unknown as BotCommand, score: 1 },
      { item: { type: 'city.improve', track: 'trade' } as BotCommand, score: 2 },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.score).toBe(2);
  });
});
