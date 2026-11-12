/**
 * SF+CK 組合層的策略（SF+CK 計畫 §4.4、§4.5、§6.3 的 FX-C、FX-S、FX-K、FX-G、FX-B3；D2、D5）。
 *
 * 每個固定盤面都用 rules 的真實指令與投影建立；standard 與 easy（兩個種子）送出的指令一律交給 `applyCommand`
 * 驗證，必要時加上保底。盤面座標見 `packages/rules/test/sfck-clauses.test.ts`（4 人地圖）：
 *   v28 主島海岸（山脈 (1,-1) 4）；v29 主島海岸，與 v28 有陸路；v11 三個海格之間（海格 7、8、2）；
 *   v10 金礦 (3,-3) 4 的海岸；v13 同一座金礦的另一個海岸；v15 小島：金礦 4 與丘陵 5。
 *
 * - FX-C1–C8：追擊海盜的 K1–K6（C1、C8 追擊，其餘各擋一項；C7 只有 K6 不成立、C8 走 K2 的第二分支）；
 *   追擊之後 standard 與保底的 `moveRobber` 都落在海格或 `null`。
 * - FX-S1–S2：第 2 輪城市的評分合成（`citySetupScore + islandSetupBonus`、ore 或 grain 的硬篩選，不重複計入產能）、
 *   第 1 輪與 SF 單獨相同；road 階段交給 SF，整個 setup 都被接受。
 * - FX-K1–K2：騎士位置的罰分（小島空點、船的 open end）與 D2 的 `recruitSite` 排序。
 * - FX-G1–G2：金礦 frame 與金礦城市的估值。
 * - FX-B3：首攻後擲出 7，海盜比強盜好時 standard 移海盜、easy 移強盜。
 */

import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  getProfile,
  seededRng,
  topologyOf,
  type Command,
  type GameState,
} from '@catan/rules';
import {
  actCk,
  addKnight,
  edgeBetween,
  moduleFrame,
  rollRng,
  setBuilding,
  setImprovement,
  SCIENCE,
  TRADE,
} from '../../rules/test/ck-helpers.ts';
import { give, setHand } from '../../rules/test/helpers.ts';
import { hex, settle, ship } from '../../rules/test/seafarers-helpers.ts';
import { afterFirstAttack, emptySfckGame, sfckGame } from '../../rules/test/sfck-helpers.ts';
import { setupSpotScore } from '../src/base/setup.ts';
import { playerYield, vertexYield } from '../src/board.ts';
import { goldPipsAt, productionValue, settlementSpotValue, weightedPips, wildcardWeight } from '../src/economy.ts';
import { fallbackDecision, fallbackPolicy } from '../src/fallback.ts';
import { rescoreCandidates, turnContext } from '../src/heuristic.ts';
import { BOT_MODULES, botModulesOf } from '../src/index.ts';
import { guardedKnights, recruitSite } from '../src/modules/citiesKnights/defense.ts';
import { knightsOf, threatOf } from '../src/modules/citiesKnights/knights.ts';
import { citiesKnightsSetup, citySetupScore, touchesOreOrGrain } from '../src/modules/citiesKnights/setup.ts';
import { ISLAND_SETTLEMENT } from '../src/modules/seafarers/plan.ts';
import { islandSetupBonus, seafarersSetup } from '../src/modules/seafarers/setup.ts';
import { CHASE_MIN_AWAY, chaseScore, sfckChaseActions } from '../src/modules/seafarersCitiesKnights/chase.ts';
import { seafarersCitiesKnightsBotModule } from '../src/modules/seafarersCitiesKnights/index.ts';
import { OPEN_END_PENALTY, sfckRescore } from '../src/modules/seafarersCitiesKnights/rescore.ts';
import { sfckSetup } from '../src/modules/seafarersCitiesKnights/setup.ts';
import { SEAFARERS_CITIES_KNIGHTS } from '../src/modules/seafarersCitiesKnights/view.ts';
import type { BotModule, Scored, TurnContext } from '../src/modules/types.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotCommand, BotContext, BotLevel, BotPolicy } from '../src/types.ts';
import { viewOf } from './ck-fixtures.ts';

const PROFILE_ID = 'sf-ck-new-shores-2025';
const MODULES = botModulesOf(getProfile(PROFILE_ID)!);
/** 沒有組合層：沒有任何模組提供 `rescore`，`setup` 由 SF 回答。 */
const WITHOUT_SFCK = MODULES.filter((module) => module.id !== SEAFARERS_CITIES_KNIGHTS);

const V28 = 28;
const V11 = 11;
const V10 = 10;
const V13 = 13;
const V15 = 15;
const V29 = 29;

const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 1): BotContext => ({
  selfId,
  level,
  seed,
  offerPhases: {},
});

const POLICIES: readonly (readonly [string, BotPolicy, BotLevel, number])[] = [
  ['fallback', fallbackPolicy, 'standard', 1],
  ['standard', createBotPolicy('standard'), 'standard', 1],
  ['easy#1', createBotPolicy('easy'), 'easy', 1],
  ['easy#2', createBotPolicy('easy'), 'easy', 2],
];

function turnOf(state: GameState, level: BotLevel = 'standard', modules: readonly BotModule[] = MODULES, actor = 'p1'): TurnContext {
  return turnContext(viewOf(state, actor), ctxFor(actor, level), level, modules);
}

function expectAccepted(state: GameState, actor: string, command: BotCommand | null | undefined): GameState {
  expect(command, `${actor} has a command`).not.toBeNull();
  expect(command, `${actor} has a command`).not.toBeUndefined();
  const outcome = applyCommand(state, actor, command as Command, seededRng(1));
  expect(outcome.ok, `${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
  return outcome.ok ? outcome.state : state;
}

/** 每種策略（保底、standard、easy 兩個種子）在這個盤面都送出被引擎接受的指令；回傳各自的指令。 */
function expectEveryPolicyAnswers(state: GameState, actor: string): Map<string, BotCommand> {
  const answers = new Map<string, BotCommand>();
  for (const [name, policy, level, seed] of POLICIES) {
    const command = policy.decide(viewOf(state, actor), ctxFor(actor, level, seed));
    expect(command, `${name} must not stall`).not.toBeNull();
    expectAccepted(state, actor, command);
    answers.set(name, command!);
  }
  return answers;
}

const isChase = (command: BotCommand | null): boolean => command?.type === 'knight.chasePirate';

/** 全部的策略都不追擊海盜（各自的指令仍被接受）。 */
function expectNoChase(state: GameState, actor = 'p1'): void {
  for (const [name, command] of expectEveryPolicyAnswers(state, actor)) expect(isChase(command), `${name} chased the pirate`).toBe(false);
}

// ---------------------------------------------------------------------------
// 模組接線
// ---------------------------------------------------------------------------

describe('SF+CK strategy hooks', () => {
  it('attaches setup, actions and rescore next to robberTargets, and stays closed until SFCK-G', () => {
    expect(Object.keys(seafarersCitiesKnightsBotModule).sort()).toEqual(
      ['actions', 'id', 'pacing', 'rescore', 'robberTargets', 'setup', 'supports'],
    );
    // 組合層沒有 duty、answerFrame、economy 與 preroll：frame 與經濟屬於 base、SF、C&K。
    for (const hook of ['duty', 'answerFrame', 'economy', 'preroll', 'planStep', 'banditCandidates', 'freeRouteCandidates'] as const) {
      expect(seafarersCitiesKnightsBotModule[hook], hook).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// FX-K：騎士位置（rescore 與 D2 的招募點）
// ---------------------------------------------------------------------------

/**
 * p1：V28 的聚落（`city` 時為城市）、船 V28–V11 與 V11–V10、路 V28–V29。`p2AtV13` 時 p2 在 V13 蓋聚落：V10 因距離規則
 * 不能蓋，島嶼計畫改走 V15（一艘船）；否則 V10 是現成的島嶼聚落點（船已經停在那裡）。
 */
function routeWorld(options: { city?: boolean; p2AtV13?: boolean } = {}): GameState {
  const state = emptySfckGame(4);
  settle(state, 'p1', V28, options.city ?? false);
  ship(state, 'p1', edgeBetween(state, V28, V11));
  ship(state, 'p1', edgeBetween(state, V11, V10));
  state.board.roads[edgeBetween(state, V28, V29)] = { player: 'p1', ship: false };
  if (options.p2AtV13) settle(state, 'p2', V13);
  return state;
}

/** 蠻族還差 2 艘船、p1 有城市而且沒有騎士：防守要招募並啟動一隻（手牌夠）。 */
function recruitWorld(p2AtV13: boolean): GameState {
  const state = routeWorld({ city: true, p2AtV13 });
  setBuilding(state, 'p2', 80, true);
  (state.moduleState!.citiesKnights as { barbarian: number }).barbarian = 5;
  give(state, 'p1', { ore: 1, wool: 1, grain: 1 });
  return state;
}

/** 原本的 `recruitSite`（D2 之前）：沒有任何 `rescore` 提供者時，新版必須逐位元相同。 */
function referenceRecruitSite(turn: TurnContext): number | null {
  const hints = turn.view.hints?.modules?.citiesKnights as { recruitSites: number[]; knightSupply?: Record<number, number> } | undefined;
  if (!hints || hints.recruitSites.length === 0 || (hints.knightSupply?.[1] ?? 0) <= 0) return null;
  const wanted = new Set<number>(turn.view.hints?.legalSettlements ?? []);
  for (const plan of turn.economy.plans) if (plan.vertex !== null) wanted.add(plan.vertex);
  const free = hints.recruitSites.filter((vertex) => !wanted.has(vertex));
  return (free.length > 0 ? free : hints.recruitSites)[0] ?? null;
}

describe('FX-K rescore: the knight position penalty', () => {
  const moves = (to: number): BotCommand[] => [
    { type: 'knight.move', from: 5, to },
    { type: 'knight.displace', from: 5, to },
    { type: 'knight.recruit', vertex: to },
  ];

  it('K1 an own island-plan site costs the plan value, for standard and easy', () => {
    const state = routeWorld({ p2AtV13: true });
    for (const level of ['standard', 'easy'] as const) {
      const turn = turnOf(state, level);
      const plan = turn.economy.plans.find((candidate) => candidate.kind === ISLAND_SETTLEMENT && candidate.vertex === V15);
      expect(plan, `${level} plans an island settlement at v15`).toBeDefined();
      for (const command of moves(V15)) expect(sfckRescore(turn, command), `${level} ${command.type}`).toBe(-plan!.value);
    }
  });

  it('K2 the open end of an own movable leaf ship costs 0.3 VP for standard only', () => {
    const state = routeWorld({ p2AtV13: true });
    const hints = viewOf(state, 'p1').hints!.modules!.seafarers as { movableShips: { edge: number }[] };
    expect(hints.movableShips.map((entry) => entry.edge)).toEqual([edgeBetween(state, V11, V10)]);
    const standard = turnOf(state, 'standard');
    const easy = turnOf(state, 'easy');
    // v10 沒有計畫，只是那艘船的 open end。
    expect(standard.economy.plans.some((plan) => plan.vertex === V10)).toBe(false);
    expect(OPEN_END_PENALTY).toBe(0.3);
    for (const command of moves(V10)) {
      expect(sfckRescore(standard, command), command.type).toBe(-OPEN_END_PENALTY);
      expect(sfckRescore(easy, command), command.type).toBe(0);
    }
    // 不是 open end：被兩艘船共用的 v11、自己的建築 v28、陸路上的 v29。
    for (const vertex of [V11, V28, V29]) for (const command of moves(vertex)) expect(sfckRescore(standard, command), `v${vertex} ${command.type}`).toBe(0);
  });

  it('K2 the penalty goes away when the ship cannot move: already moved this turn, or pinned', () => {
    const moved = routeWorld({ p2AtV13: true });
    // 投影只讀「本視窗」的旗標：`window` 要等於目前的 windowId，否則視為舊視窗、`moved` 讀作 false。
    const slot = moved.moduleState!.seafarers as { window: number; moved: boolean };
    slot.window = moved.windowId;
    slot.moved = true;
    expect((viewOf(moved, 'p1').hints!.modules!.seafarers as { movableShips: unknown[] }).movableShips).toEqual([]);
    expect(sfckRescore(turnOf(moved), { type: 'knight.recruit', vertex: V10 })).toBe(0);
    const pinned = routeWorld({ p2AtV13: true });
    addKnight(pinned, { player: 'p1', vertex: V10, level: 1, active: true });
    expect(sfckRescore(turnOf(pinned), { type: 'knight.move', from: V10, to: V10 })).toBe(0);
  });

  it('is zero for other commands and for malformed targets, and always finite', () => {
    const state = routeWorld({ p2AtV13: true });
    for (const level of ['standard', 'easy'] as const) {
      const turn = turnOf(state, level);
      const others: BotCommand[] = [
        { type: 'build.road', edge: 3 },
        { type: 'knight.activate', vertex: V10 },
        { type: 'knight.chasePirate', vertex: V11 },
        { type: 'ship.move', from: 11, to: 12 },
        { type: 'turn.end' },
      ];
      for (const command of others) expect(sfckRescore(turn, command), command.type).toBe(0);
      for (const to of [undefined, null, NaN, Infinity, -1, 1.5, 99999, '10'] as unknown[]) {
        for (const command of [{ type: 'knight.move', from: 1, to }, { type: 'knight.displace', from: 1, to }, { type: 'knight.recruit', vertex: to }] as BotCommand[]) {
          expect(sfckRescore(turn, command), `${level} ${command.type} ${String(to)}`).toBe(0);
        }
      }
      // 每個路口 × 三種指令：有限、不是正數。
      for (let vertex = 0; vertex < topologyOf(state).vertices.length; vertex++) {
        for (const command of moves(vertex)) {
          const delta = sfckRescore(turn, command);
          expect(Number.isFinite(delta), `${level} v${vertex} ${command.type}`).toBe(true);
          expect(delta).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it('only reorders candidates: standard avoids the open end, both levels avoid the plan site, easy does not mind the open end', () => {
    const state = routeWorld({ p2AtV13: true });
    const candidate = (to: number, score: number): Scored<BotCommand> => ({ item: { type: 'knight.move', from: V29, to }, score });
    const scores = (turn: TurnContext, candidates: readonly Scored<BotCommand>[]): number[] =>
      rescoreCandidates(turn, candidates).map((entry) => entry.score);
    const pickTarget = (turn: TurnContext, candidates: readonly Scored<BotCommand>[]): number =>
      (turn.pick(rescoreCandidates(turn, candidates)) as unknown as { to: number }).to;
    // 開放端比較高分（1.0 對 0.9）：standard 罰 0.3 之後改走 v29；easy 不罰，分數不變（easy 的 topK 會隨機挑，所以比分數）。
    const open = [candidate(V10, 1.0), candidate(V29, 0.9)];
    expect(pickTarget(turnOf(state, 'standard'), open)).toBe(V29);
    expect(scores(turnOf(state, 'standard'), open)[0]).toBeCloseTo(0.7, 12);
    expect(scores(turnOf(state, 'easy'), open)).toEqual([1.0, 0.9]);
    // 小島計畫的建地：兩個難度都把它排在後面。
    const plan = [candidate(V15, 1.2), candidate(V29, 0.4)];
    expect(pickTarget(turnOf(state, 'standard'), plan)).toBe(V29);
    for (const level of ['standard', 'easy'] as const) {
      const [site, other] = scores(turnOf(state, level), plan);
      expect(site, level).toBeLessThan(0);
      expect(other, level).toBe(0.4);
    }
    // 罰分只調分數：候選的數量與順序不變，只剩一個候選時它仍在。
    const turn = turnOf(state, 'standard');
    const lonely = rescoreCandidates(turn, [candidate(V15, 1.2)]);
    expect(lonely).toHaveLength(1);
    expect(lonely[0]!.score).toBeLessThan(0);
  });
});

describe('FX-K recruiting (D2: recruitSite orders the free sites by rescore)', () => {
  it('K1 a plan site is never a recruit site, with or without rescore', () => {
    // 沒有 p2：v10 是現成的島嶼聚落點（也是 legalSettlements），所以空點只剩 v29。
    const state = recruitWorld(false);
    const view = viewOf(state, 'p1');
    expect((view.hints!.modules!.citiesKnights as { recruitSites: number[] }).recruitSites).toEqual([V10, V29]);
    expect(view.hints!.legalSettlements).toEqual([V10]);
    for (const [name, command] of expectEveryPolicyAnswers(state, 'p1')) {
      if (name === 'fallback') continue;
      expect(command, name).toEqual({ type: 'knight.recruit', vertex: V29 });
    }
    // 沒有 rescore 提供者的組合也選 v29：`recruitSite` 本來就排除計畫點。
    for (const level of ['standard', 'easy'] as const) {
      expect(createBotPolicy(level, { modules: WITHOUT_SFCK }).decide(view, ctxFor('p1', level)), level).toEqual({ type: 'knight.recruit', vertex: V29 });
    }
  });

  it('K2 standard recruits away from the open end of its own ship, easy and a stack without rescore keep the old order', () => {
    // p2 在 v13：v10 不再是計畫點，只剩「自己船的 open end」，而且排在 v29 前面。
    const state = recruitWorld(true);
    const view = viewOf(state, 'p1');
    expect((view.hints!.modules!.citiesKnights as { recruitSites: number[] }).recruitSites).toEqual([V10, V29]);
    expect(view.hints!.legalSettlements).toEqual([]);
    const answers = expectEveryPolicyAnswers(state, 'p1');
    expect(answers.get('standard')).toEqual({ type: 'knight.recruit', vertex: V29 });
    expect(answers.get('easy#1')).toEqual({ type: 'knight.recruit', vertex: V10 });
    expect(answers.get('easy#2')).toEqual({ type: 'knight.recruit', vertex: V10 });
    // 沒有組合層（沒有 rescore）時 standard 也是原本的順序。
    expect(createBotPolicy('standard', { modules: WITHOUT_SFCK }).decide(view, ctxFor('p1'))).toEqual({ type: 'knight.recruit', vertex: V10 });
    // 站上去之後，那艘船就被壓住（rules 的 E_SHIP_PINNED_BY_KNIGHT），這正是要避開的。
    const pinned = expectAccepted(state, 'p1', { type: 'knight.recruit', vertex: V10 } as BotCommand);
    const tip = edgeBetween(state, V11, V10);
    const refused = applyCommand(pinned, 'p1', { type: 'ship.move', from: tip, to: edgeBetween(state, V11, 6) } as unknown as Command, seededRng(1));
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.code).toBe('E_SHIP_PINNED_BY_KNIGHT');
  });

  it('without a rescore provider recruitSite is the original function, bit for bit', () => {
    const worlds = [recruitWorld(false), recruitWorld(true), routeWorld({ city: true })];
    for (const state of worlds) {
      for (const level of ['standard', 'easy'] as const) {
        for (const modules of [WITHOUT_SFCK, [BOT_MODULES.get('citiesKnights')!], []]) {
          const turn = turnOf(state, level, modules);
          expect(turn.modules.some((module) => module.rescore)).toBe(false);
          expect(recruitSite(turn), `${level} ${modules.map((module) => module.id).join('+') || 'base'}`).toBe(referenceRecruitSite(turn));
        }
      }
    }
  });

  it('orders the free sites by the summed rescore delta: highest first, ties keep the old order, non-finite counts as 0', () => {
    const state = recruitWorld(true);
    const ck = BOT_MODULES.get('citiesKnights')!;
    const fake = (rescore: (command: BotCommand) => number): BotModule => ({ id: 'fake', rescore: (_turn, command) => rescore(command) });
    const vertexOf = (command: BotCommand): number => (command as { vertex: number }).vertex;
    const site = (...modules: BotModule[]): number | null => recruitSite(turnOf(state, 'standard', [ck, ...modules]));
    // 兩個空點 v10、v29（現有順序 v10 在前）。
    expect(site()).toBe(V10);
    expect(site(fake(() => 0))).toBe(V10);
    expect(site(fake((command) => (vertexOf(command) === V10 ? -1 : 0)))).toBe(V29);
    expect(site(fake((command) => (vertexOf(command) === V29 ? 1 : 0)))).toBe(V29);
    expect(site(fake(() => 2))).toBe(V10);
    // 差值相加：兩個模組各罰 v10 一點，勝過另一個模組給 v10 的 1.5。
    expect(site(fake((command) => (vertexOf(command) === V10 ? -1 : 0)), fake((command) => (vertexOf(command) === V10 ? -1 : 0)))).toBe(V29);
    expect(site(fake((command) => (vertexOf(command) === V10 ? -1 : 0)), fake((command) => (vertexOf(command) === V10 ? 1.5 : 0)))).toBe(V10);
    // 非有限值視為 0，不會把 v10 排到最後，也不會把它排到最前。
    for (const bad of [NaN, Infinity, -Infinity]) expect(site(fake((command) => (vertexOf(command) === V29 ? bad : 0))), String(bad)).toBe(V10);
    // 模組只被問 `knight.recruit { vertex }`，而且每個空點恰好一次。
    const asked: BotCommand[] = [];
    site(fake((command) => (asked.push(command), 0)));
    expect(asked).toEqual([{ type: 'knight.recruit', vertex: V10 }, { type: 'knight.recruit', vertex: V29 }]);
  });
});

// ---------------------------------------------------------------------------
// FX-C：追擊海盜
// ---------------------------------------------------------------------------

/**
 * C1：首攻之後，p1 在 V28 有聚落、船 V28–V11 與 V11–V10，一隻 1 級啟動騎士在 V11；海盜在海格 (2,-2)（hex 8），
 * 兩艘船都貼著它。p2 在 V13 蓋聚落（所以通往 V15 的島嶼計畫只剩 hex 8 旁的那條邊），在海格 (2,0) 旁有一艘船與一張牌。
 * p1 的手牌剛好夠一艘船加一座聚落。
 */
function chaseWorld(): GameState {
  const state = afterFirstAttack(emptySfckGame(4));
  settle(state, 'p1', V28);
  ship(state, 'p1', edgeBetween(state, V28, V11));
  ship(state, 'p1', edgeBetween(state, V11, V10));
  settle(state, 'p2', V13);
  state.board.pirate = hex(state, 2, -2);
  addKnight(state, { player: 'p1', vertex: V11, level: 1, active: true });
  ship(state, 'p2', edgeBetween(state, 48, 47));
  setHand(state, 'p2', { brick: 1 });
  setHand(state, 'p1', { lumber: 2, brick: 1, wool: 2, grain: 1 });
  return state;
}

const setBarbarian = (state: GameState, position: number): void => {
  (state.moduleState!.citiesKnights as { barbarian: number }).barbarian = position;
};

const chaseOf = (state: GameState, level: BotLevel = 'standard'): Scored<BotCommand>[] => sfckChaseActions(turnOf(state, level));

describe('FX-C chasing the pirate (K1–K6)', () => {
  it('C1 everything holds: standard chases with its only knight; easy and the duty do not', () => {
    const state = chaseWorld();
    const view = viewOf(state, 'p1');
    expect((view.hints!.modules!.seafarersCitiesKnights as { pirateChase: number[] }).pirateChase).toEqual([V11]);
    const turn = turnOf(state);
    const found = sfckChaseActions(turn);
    expect(found).toHaveLength(1);
    expect(found[0]!.item).toEqual({ type: 'knight.chasePirate', vertex: V11 });
    expect(found[0]!.score).toBeGreaterThan(0);
    expect(found[0]!.score).toBeCloseTo(chaseScore(turn, 1), 12);

    const answers = expectEveryPolicyAnswers(state, 'p1');
    expect(answers.get('standard')).toEqual({ type: 'knight.chasePirate', vertex: V11 });
    expect(answers.get('fallback')).toEqual({ type: 'turn.end' });
    for (const name of ['easy#1', 'easy#2']) expect(isChase(answers.get(name)!), name).toBe(false);
  });

  it('C1 after the chase, standard and the duty move the pirate within the sea hexes and the frame', () => {
    const state = chaseWorld();
    const chased = actCk(state, 'p1', { type: 'knight.chasePirate', vertex: V11 }).state;
    expect(chased.pending).toMatchObject({ kind: 'moveRobber', actor: 'p1', cause: 'knight', pirate: true });
    const view = viewOf(chased, 'p1');
    const isSeaOrFrame = (target: number | null): boolean => target === null || view.board.terrain[target] === 'sea';
    const answers = expectEveryPolicyAnswers(chased, 'p1');
    for (const [name, command] of answers) {
      expect(command.type, name).toBe('pending.moveRobber');
      expect(isSeaOrFrame((command as { hex: number | null }).hex), `${name} → ${JSON.stringify(command)}`).toBe(true);
    }
    // 保底取集合的第一項：第一個非現位的海格。standard 看得到 p2 的牌，移到那艘船旁。
    expect(answers.get('fallback')).toEqual({ type: 'pending.moveRobber', hex: view.board.terrain.findIndex((terrain, index) => terrain === 'sea' && index !== view.board.pirate) });
    expect(fallbackDecision(view, 'p1', MODULES)).toEqual(answers.get('fallback'));
    const moved = expectAccepted(chased, 'p1', answers.get('standard')!);
    expect(moved.pending).toMatchObject({ kind: 'steal', candidates: ['p2'], pirate: true });
  });

  it('C2 the barbarians are too close (K3): two ships away is no chase, three is', () => {
    expect(CHASE_MIN_AWAY).toBe(3);
    const away = (steps: number): GameState => {
      const state = chaseWorld();
      setBarbarian(state, 7 - steps);
      return state;
    };
    for (const steps of [3, 4, 5]) expect(chaseOf(away(steps)), `away ${steps}`).toHaveLength(1);
    for (const steps of [2, 1]) {
      const state = away(steps);
      // 分數本來是正的：只有 K3 擋下。
      expect(chaseScore(turnOf(state), 1)).toBeGreaterThan(0);
      expect(chaseOf(state), `away ${steps}`).toEqual([]);
      expectNoChase(state);
    }
  });

  it('C3 the defense would not hold without the chaser (K4): a city and no other knight', () => {
    const state = chaseWorld();
    settle(state, 'p1', V28, true);
    expect(chaseScore(turnOf(state), 1)).toBeGreaterThan(0);
    expect(chaseOf(state)).toEqual([]);
    expectNoChase(state);
    // 另一隻 2 級的啟動騎士守住：躺下 1 級之後防守仍然足夠，追擊。
    const covered = chaseWorld();
    settle(covered, 'p1', V28, true);
    covered.board.roads[edgeBetween(covered, V28, V29)] = { player: 'p1', ship: false };
    addKnight(covered, { player: 'p1', vertex: V29, level: 2, active: true });
    expect(chaseOf(covered).map((entry) => entry.item)).toEqual([{ type: 'knight.chasePirate', vertex: V11 }]);
    expectEveryPolicyAnswers(covered, 'p1');
  });

  it('C3 a guarded knight stays: the barbarians are four ships away and p1 has a city (K4)', () => {
    const state = chaseWorld();
    settle(state, 'p1', V28, true);
    state.board.roads[edgeBetween(state, V28, V29)] = { player: 'p1', ship: false };
    addKnight(state, { player: 'p1', vertex: V29, level: 2, active: true });
    expect(chaseOf(state)).toHaveLength(1);
    setBarbarian(state, 3);
    expect(chaseScore(turnOf(state), 1)).toBeGreaterThan(0);
    expect(chaseOf(state)).toEqual([]);
    expectNoChase(state);
  });

  it('C4 the pirate does not touch an own ship or the next ship of the plan (K2)', () => {
    const state = chaseWorld();
    // 騎士站在遠處海格 40 旁、海盜在 hex 40；p2 有 8 張牌，移到 p2 的船旁有東西可偷（K6 的分數仍是正的）。
    const far = 40;
    state.board.pirate = far;
    (state.moduleState!.citiesKnights as { knights: { vertex: number }[] }).knights = [];
    addKnight(state, { player: 'p1', vertex: topologyOf(state).vertices.findIndex((vertex) => vertex.hexes.includes(far)), level: 1, active: true });
    setHand(state, 'p2', { brick: 2, wool: 2, lumber: 2, grain: 2 });
    const view = viewOf(state, 'p1');
    expect((view.hints!.modules!.seafarersCitiesKnights as { pirateChase: number[] }).pirateChase).toHaveLength(1);
    expect(chaseScore(turnOf(state), 1)).toBeGreaterThan(0);
    expect(chaseOf(state)).toEqual([]);
    expectNoChase(state);
  });

  it('C5 before the first barbarian attack there is no pirate to chase (K1)', () => {
    const state = chaseWorld();
    // 首攻之前：海盜在外框、`pirateChase` 為空；把它擺到 hex 8 也一樣（hint 只看首攻）。
    (state.moduleState!.citiesKnights as { attacks: number }).attacks = 0;
    state.board.robber = -1;
    const view = viewOf(state, 'p1');
    expect((view.hints!.modules!.seafarersCitiesKnights as { pirateChase: number[] }).pirateChase).toEqual([]);
    expect(chaseOf(state)).toEqual([]);
    expectNoChase(state);
    const fresh = emptySfckGame(4);
    expect(fresh.board.pirate).toBeNull();
    expect(chaseOf(fresh)).toEqual([]);
    expectNoChase(fresh);
  });

  it('C6 easy never chases, whatever the seed', () => {
    const state = chaseWorld();
    for (const seed of [1, 2, 3, 4, 5]) {
      const turn = turnContext(viewOf(state, 'p1'), ctxFor('p1', 'easy', seed), 'easy', MODULES);
      expect(sfckChaseActions(turn), `seed ${seed}`).toEqual([]);
      const command = createBotPolicy('easy').decide(viewOf(state, 'p1'), ctxFor('p1', 'easy', seed));
      expect(isChase(command), `seed ${seed}`).toBe(false);
      expectAccepted(state, 'p1', command);
    }
  });

  /** K1–K5 各自直接檢查（不看 `sfckChaseActions` 的結果）；`vertex` 是追擊的騎士，自己的船鄰接海盜 hex（K2 第一分支）。 */
  function expectK1ToK5(state: GameState, vertex: number): void {
    const turn = turnOf(state);
    const { view } = turn;
    const pirate = view.board.pirate!;
    const topo = topologyOf(state);
    expect((view.hints!.modules!.seafarersCitiesKnights as { pirateChase: number[] }).pirateChase, 'K1').toContain(vertex);
    expect(view.board.roads.some((road, edge) => !!road && road.ship && road.player === 'p1' && topo.edges[edge]!.hexes.includes(pirate)), 'K2').toBe(true);
    const threat = threatOf(view, 'p1');
    expect(threat.away, 'K3').toBeGreaterThanOrEqual(CHASE_MIN_AWAY);
    const level = knightsOf(view, 'p1').find((knight) => knight.vertex === vertex)!.level;
    expect(guardedKnights(turn).has(vertex), 'K4 guarded').toBe(false);
    expect(threatOf(view, 'p1', threat.mine - level).atRisk, 'K4 at risk').toBe(false);
    expect(knightsOf(view, 'p1').every((knight) => knight.level >= level || knight.vertex === vertex), 'K5').toBe(true);
  }

  it('C7 K1–K5 hold and only K6 fails: a level 3 knight lies down for nothing, so there is no candidate', () => {
    const world = (p2HasCards: boolean): GameState => {
      const state = chaseWorld();
      (state.moduleState!.citiesKnights as { knights: unknown[] }).knights = [];
      addKnight(state, { player: 'p1', vertex: V11, level: 3, active: true });
      if (!p2HasCards) setHand(state, 'p2', {});
      return state;
    };
    // 兩個盤面只差 p2 的牌：有牌時 K6 成立、追擊（price = 0.6）；沒牌時只有 K6 不成立。
    const wet = world(true);
    expectK1ToK5(wet, V11);
    expect(chaseScore(turnOf(wet), 3)).toBeGreaterThan(0);
    expect(chaseOf(wet).map((entry) => entry.item)).toEqual([{ type: 'knight.chasePirate', vertex: V11 }]);
    const dry = world(false);
    expectK1ToK5(dry, V11);
    expect(chaseScore(turnOf(dry), 3)).toBeLessThan(0);
    expect(chaseOf(dry)).toEqual([]);
    expectNoChase(dry);
  });

  it('C7 K1–K5 hold and only K6 fails: a pirate that is not worth moving, even for a level 1 knight', () => {
    // 海盜在 hex 2：貼著 p1 的第二艘船（K2 第一分支），但移走它沒有收益（淨值為負）。
    const state = chaseWorld();
    state.board.pirate = 2;
    expectK1ToK5(state, V11);
    expect(chaseScore(turnOf(state), 1)).toBeLessThan(0);
    expect(chaseOf(state)).toEqual([]);
    expectNoChase(state);
  });

  it('C8 the pirate touches no own ship but blocks the next ship of the plan: standard chases (K2, second branch)', () => {
    // 只留第一艘船（V28–V11，鄰接 hex 7、8）；海盜在 hex 2，不鄰接任何一艘自己的船。
    const state = chaseWorld();
    state.board.roads[edgeBetween(state, V11, V10)] = null;
    state.board.pirate = 2;
    const topo = topologyOf(state);
    expect(state.board.roads.some((road, edge) => !!road && road.ship && road.player === 'p1' && topo.edges[edge]!.hexes.includes(2))).toBe(false);
    // 拿掉海盜之後，最好的島嶼計畫的下一條船（邊 12）鄰接 hex 2：海盜擋住了它。
    const free = chaseWorld();
    free.board.roads[edgeBetween(free, V11, V10)] = null;
    free.board.pirate = null;
    const next = turnOf(free).economy.plans.find((plan) => plan.kind === ISLAND_SETTLEMENT)!.ships![0]!;
    expect(topo.edges[next]!.hexes).toContain(2);
    // 其餘條件（K1、K3、K4）成立，分數為正。
    const turn = turnOf(state);
    expect((turn.view.hints!.modules!.seafarersCitiesKnights as { pirateChase: number[] }).pirateChase).toEqual([V11]);
    expect(chaseScore(turn, 1)).toBeGreaterThan(0);
    expect(chaseOf(state).map((entry) => entry.item)).toEqual([{ type: 'knight.chasePirate', vertex: V11 }]);
    const answers = expectEveryPolicyAnswers(state, 'p1');
    expect(answers.get('standard')).toEqual({ type: 'knight.chasePirate', vertex: V11 });
    for (const name of ['easy#1', 'easy#2']) expect(isChase(answers.get(name)!), name).toBe(false);
  });

  it('K5 picks the lowest level knight, the smaller vertex on a tie', () => {
    const knights = (levelAtV10: 1 | 2, levelAtV11: 1 | 2): GameState => {
      const state = chaseWorld();
      (state.moduleState!.citiesKnights as { knights: unknown[] }).knights = [];
      addKnight(state, { player: 'p1', vertex: V10, level: levelAtV10, active: true });
      addKnight(state, { player: 'p1', vertex: V11, level: levelAtV11, active: true });
      return state;
    };
    const vertexOf = (state: GameState): number[] => chaseOf(state).map((entry) => (entry.item as { vertex: number }).vertex);
    expect(vertexOf(knights(2, 1))).toEqual([V11]);
    expect(vertexOf(knights(1, 2))).toEqual([V10]);
    expect(vertexOf(knights(1, 1))).toEqual([V10]);
    expect(vertexOf(knights(2, 2))).toEqual([V10]);
    // 更高等級的騎士躺下比較貴：分數隨等級下降，但仍然只送出一個候選。
    const low = chaseOf(knights(1, 1))[0]!.score;
    const high = chaseOf(knights(2, 2))[0]!.score;
    expect(high).toBeLessThan(low);
  });

  it('K6 has no constant bonus: a chase must earn its score (it is the gain minus the price of the knight)', () => {
    const state = chaseWorld();
    const turn = turnOf(state);
    const gain = chaseScore(turn, 0) + 0.3; // 拿掉 REACTIVATE_PRICE
    // 淨值最高的海盜選項（偷牌加前線加解除封鎖）乘上 PIP_VALUE，不含任何常數項。
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThan(1);
    // 沒有任何值得追的地方（p2 沒有牌、海盜擋不到任何東西）時分數為負，不會因為常數項而追擊。
    const dull = chaseWorld();
    setHand(dull, 'p2', {});
    dull.board.pirate = hex(dull, 2, 0);
    expect(chaseScore(turnOf(dull), 1)).toBeLessThan(0);
  });

  it('the chase candidate is deterministic and does not read randomness', () => {
    const state = chaseWorld();
    const once = chaseOf(state);
    expect(chaseOf(state)).toEqual(once);
    const policy = createBotPolicy('standard');
    const view = viewOf(state, 'p1');
    expect(policy.decide(view, ctxFor('p1', 'standard', 1))).toEqual(policy.decide(view, ctxFor('p1', 'standard', 99)));
  });
});

// ---------------------------------------------------------------------------
// FX-S：setup 的合成（D5）
// ---------------------------------------------------------------------------

/** 讓第 1 輪的四個聚落放在 `picks`（路依 standard 策略放），回到第 2 輪第一個 building 的狀態。 */
function roundTwo(picks: readonly number[]): GameState {
  let { state } = sfckGame(4);
  const policy = createBotPolicy('standard');
  let next = 0;
  for (let step = 0; step < 40; step++) {
    const setup = state.turn.setup;
    expect(state.turn.phase).toBe('setup');
    if (setup!.stage === 'building' && setup!.round === 2) return state;
    const actor = state.players[setup!.order[setup!.index]!]!.id;
    const command =
      setup!.stage === 'building'
        ? ({ type: 'setup.placeBuilding', vertex: picks[next++] } as BotCommand)
        : policy.decide(viewOf(state, actor), ctxFor(actor));
    state = expectAccepted(state, actor, command);
  }
  throw new Error('round 2 never started');
}

const setupActor = (state: GameState): string => state.players[state.turn.setup!.order[state.turn.setup!.index]!]!.id;

/** 第 2 輪的候選分數：`citySetupScore + islandSetupBonus`，只在 ore 或 grain 的硬篩選之後的集合裡。 */
function citySetupRanking(state: GameState): { pool: number[]; ranked: { vertex: number; score: number }[]; turn: TurnContext } {
  const actor = setupActor(state);
  const turn = turnOf(state, 'standard', MODULES, actor);
  const legal = turn.view.hints!.legalSettlements;
  const fitting = legal.filter((vertex) => touchesOreOrGrain(turn.model, vertex));
  const pool = fitting.length > 0 ? fitting : legal;
  const mine = playerYield(turn.model, actor, true);
  const ranked = pool
    .map((vertex) => ({ vertex, score: citySetupScore(turn.model, vertex, mine) + islandSetupBonus(turn, vertex) }))
    .sort((a, b) => b.score - a.score || a.vertex - b.vertex);
  return { pool, ranked, turn };
}

describe('FX-S setup building (D5)', () => {
  // 種子 3816 的隨機第 1 輪：p4 在第 2 輪，SF 單獨（setupSpotScore + 島嶼加權）選 v44，城市評分
  // （citySetupScore + 島嶼加權）選 v92。v44 的點數略高（12.81 對 12.21），v92 的 commodity 較多（8 對 5）。
  const S1_PICKS = [76, 67, 58, 61] as const;
  // 種子 14 的隨機第 1 輪：SF 選 v44、城市評分選 v55；兩者都沒有登島加權，所以與 C&K 單獨時的選擇相同。
  const PLAIN_PICKS = [38, 85, 42, 103] as const;
  // 種子 3：不加硬篩選時 `citySetupScore + islandSetupBonus` 最高的 v78 沒有相鄰 ore 或 grain。
  const FILTER_PICKS = [42, 57, 62, 85] as const;
  // 兩個「三者相加會選出別的點」的盤面（種子 328、45）：相加的第一名與城市評分的第一名不同，前三名的集合也不同。
  const SUM_PICKS = [
    [29, 85, 73, 41],
    [89, 64, 78, 55],
  ] as const;

  /** 在 `vertex` 蓋的建築相鄰的 commodity（paper、cloth、coin）點數。 */
  const commodityPips = (turn: TurnContext, vertex: number): number =>
    (['paper', 'cloth', 'coin'] as const).reduce((sum, key) => sum + ((vertexYield(turn.model, vertex, null, true) as Record<string, number>)[key] ?? 0), 0);

  it('S1 round 2: the city score decides, not the settlement score of SF alone', () => {
    const state = roundTwo(S1_PICKS);
    expect(state.turn.setup).toMatchObject({ stage: 'building', round: 2 });
    const actor = setupActor(state);
    const { ranked, turn } = citySetupRanking(state);
    const sf = (seafarersSetup(turn) as { vertex: number }).vertex;
    const best = ranked[0]!.vertex;
    expect(sf).toBe(44);
    expect(best).toBe(92);
    // A（SF 的選擇）的點數略高，B 的 commodity 較多、城市評分較高。
    const base = (vertex: number): number => setupSpotScore(turn, vertex) + islandSetupBonus(turn, vertex);
    const city = (vertex: number): number => ranked.find((entry) => entry.vertex === vertex)!.score;
    expect(base(sf)).toBeGreaterThan(base(best));
    expect(commodityPips(turn, best)).toBeGreaterThan(commodityPips(turn, sf));
    expect(city(best)).toBeGreaterThan(city(sf));
    expect(touchesOreOrGrain(turn.model, sf)).toBe(true);
    expect(touchesOreOrGrain(turn.model, best)).toBe(true);
    // 組合層選 B；沒有組合層時（SF 先回答）選的是 A。
    expect(sfckSetup(turn)).toEqual({ type: 'setup.placeBuilding', vertex: best });
    expect(createBotPolicy('standard').decide(viewOf(state, actor), ctxFor(actor))).toEqual({ type: 'setup.placeBuilding', vertex: best });
    expect(createBotPolicy('standard', { modules: WITHOUT_SFCK }).decide(viewOf(state, actor), ctxFor(actor))).toEqual({ type: 'setup.placeBuilding', vertex: sf });
  });

  it('S1 round 2 without an island bonus equals Cities & Knights alone', () => {
    const state = roundTwo(PLAIN_PICKS);
    const actor = setupActor(state);
    const { ranked, turn } = citySetupRanking(state);
    const sf = (seafarersSetup(turn) as { vertex: number }).vertex;
    const best = ranked[0]!.vertex;
    expect(sf).toBe(44);
    expect(best).toBe(55);
    expect(islandSetupBonus(turn, sf)).toBe(0);
    expect(islandSetupBonus(turn, best)).toBe(0);
    expect(sfckSetup(turn)).toEqual({ type: 'setup.placeBuilding', vertex: best });
    expect(citiesKnightsSetup(turn)).toEqual({ type: 'setup.placeBuilding', vertex: best });
    expect(createBotPolicy('standard').decide(viewOf(state, actor), ctxFor(actor))).toEqual({ type: 'setup.placeBuilding', vertex: best });
  });

  it('S1 easy picks among the best three of the same ranking, standard and the duty are accepted', () => {
    for (const picks of [S1_PICKS, FILTER_PICKS]) {
      const state = roundTwo(picks);
      const actor = setupActor(state);
      const { pool, ranked } = citySetupRanking(state);
      const topThree = new Set(ranked.slice(0, 3).map((entry) => entry.vertex));
      const seen = new Set<number>();
      for (let seed = 1; seed <= 12; seed++) {
        const command = createBotPolicy('easy').decide(viewOf(state, actor), ctxFor(actor, 'easy', seed)) as { type: string; vertex: number };
        expect(command.type).toBe('setup.placeBuilding');
        expect(topThree.has(command.vertex), `seed ${seed} → ${command.vertex}`).toBe(true);
        expect(pool).toContain(command.vertex);
        seen.add(command.vertex);
        expectAccepted(state, actor, command);
      }
      expect(seen.size, 'easy varies within the top three').toBeGreaterThan(1);
      expectEveryPolicyAnswers(state, actor);
      expect(fallbackDecision(viewOf(state, actor), actor, MODULES)).toEqual({ type: 'setup.placeBuilding', vertex: viewOf(state, actor).hints!.legalSettlements[0] });
    }
  });

  it('S1 the ore-or-grain filter is a hard filter: a better score without them is not taken', () => {
    const state = roundTwo(FILTER_PICKS);
    const actor = setupActor(state);
    const turn = turnOf(state, 'standard', MODULES, actor);
    const legal = turn.view.hints!.legalSettlements;
    const mine = playerYield(turn.model, actor, true);
    const unfiltered = legal
      .map((vertex) => ({ vertex, score: citySetupScore(turn.model, vertex, mine) + islandSetupBonus(turn, vertex) }))
      .sort((a, b) => b.score - a.score || a.vertex - b.vertex)[0]!.vertex;
    expect(touchesOreOrGrain(turn.model, unfiltered), 'the unfiltered best has neither ore nor grain').toBe(false);
    const pick = (sfckSetup(turn) as { vertex: number }).vertex;
    expect(pick).not.toBe(unfiltered);
    expect(touchesOreOrGrain(turn.model, pick)).toBe(true);
    expect(pick).toBe(67);
    // 一個都沒有時才用全部合法點：把 ore 與 grain 都拿掉（地形換成沙漠），`pick` 仍然是合法點。
    // `Turn` 是 class：用 `Object.create` 覆寫 `model`，保留 `pick` 等方法。
    const bare = Object.create(turn, {
      model: { value: { ...turn.model, hexResource: turn.model.hexResource.map((resource) => (resource === 'ore' || resource === 'grain' ? null : resource)) } },
    }) as TurnContext;
    expect(legal.some((vertex) => touchesOreOrGrain(bare.model, vertex))).toBe(false);
    expect(legal).toContain((sfckSetup(bare) as { vertex: number }).vertex);
  });

  it.each(SUM_PICKS.map((picks) => [picks.join(',') as string, picks] as const))(
    'S1 never adds the settlement score to the city score (%s): the choice is the argmax of city + island only',
    (_label, picks) => {
      const state = roundTwo(picks);
      const actor = setupActor(state);
      const { ranked, turn } = citySetupRanking(state);
      const mine = playerYield(turn.model, actor, true);
      const summedRanking = ranked
        .map(({ vertex }) => ({ vertex, score: setupSpotScore(turn, vertex) + citySetupScore(turn.model, vertex, mine) + islandSetupBonus(turn, vertex) }))
        .sort((a, b) => b.score - a.score || a.vertex - b.vertex);
      const correct = ranked[0]!.vertex;
      const summed = summedRanking[0]!.vertex;
      // 盤面本身要有鑑別力（無條件）：兩個公式的第一名不同，前三名的集合也不同。
      expect(summed).not.toBe(correct);
      const correctTop = ranked.slice(0, 3).map((entry) => entry.vertex);
      const summedTop = summedRanking.slice(0, 3).map((entry) => entry.vertex);
      expect([...correctTop].sort((a, b) => a - b)).not.toEqual([...summedTop].sort((a, b) => a - b));
      // standard 選正確公式的第一名；easy 的每個種子都在正確公式的前三名內，並且會選到相加的前三名沒有的點。
      expect(sfckSetup(turn)).toEqual({ type: 'setup.placeBuilding', vertex: correct });
      expect(createBotPolicy('standard').decide(viewOf(state, actor), ctxFor(actor))).toEqual({ type: 'setup.placeBuilding', vertex: correct });
      const seen = new Set<number>();
      for (let seed = 1; seed <= 12; seed++) {
        const command = createBotPolicy('easy').decide(viewOf(state, actor), ctxFor(actor, 'easy', seed)) as { type: string; vertex: number };
        expect(correctTop, `seed ${seed}`).toContain(command.vertex);
        seen.add(command.vertex);
      }
      expect([...seen].some((vertex) => !summedTop.includes(vertex)), 'easy reaches a vertex that the summed top three does not contain').toBe(true);
    },
  );

  it('S2 round 1 is SF alone: setupSpotScore plus the island bonus, for standard and easy', () => {
    for (const players of [3, 4] as const) {
      let { state } = sfckGame(players);
      expect(getProfile(state.profileId)!.ruleModules).toEqual(['seafarersCitiesKnights', 'seafarers', 'citiesKnights']);
      const sfOnly = WITHOUT_SFCK; // 沒有組合層：SF 先回答，與 SF 單獨相同
      let islandPicks = 0;
      for (let step = 0; step < players; step++) {
        const actor = setupActor(state);
        const setup = state.turn.setup!;
        expect(setup).toMatchObject({ stage: 'building', round: 1 });
        const view = viewOf(state, actor);
        const turn = turnOf(state, 'standard', MODULES, actor);
        const legal = view.hints!.legalSettlements;
        const best = legal
          .map((vertex) => ({ vertex, score: setupSpotScore(turn, vertex) + islandSetupBonus(turn, vertex) }))
          .sort((a, b) => b.score - a.score || a.vertex - b.vertex)[0]!;
        const sfckCommand = createBotPolicy('standard').decide(view, ctxFor(actor));
        expect(sfckCommand, `p${step + 1}`).toEqual({ type: 'setup.placeBuilding', vertex: best.vertex });
        expect(createBotPolicy('standard', { modules: sfOnly }).decide(view, ctxFor(actor))).toEqual(sfckCommand);
        for (const seed of [1, 2, 3]) {
          expect(createBotPolicy('easy').decide(view, ctxFor(actor, 'easy', seed)), `easy#${seed}`).toEqual(
            createBotPolicy('easy', { modules: sfOnly }).decide(view, ctxFor(actor, 'easy', seed)),
          );
        }
        if (islandSetupBonus(turn, best.vertex) > 0) islandPicks++;
        state = expectAccepted(state, actor, sfckCommand);
        // 路或船：組合層回 undefined，SF 的 setup 決定。
        const road = turnOf(state, 'standard', MODULES, actor);
        expect(sfckSetup(road)).toBeUndefined();
        state = expectAccepted(state, actor, createBotPolicy('standard').decide(viewOf(state, actor), ctxFor(actor)));
      }
      expect(islandPicks, `${players} players: the island bonus reaches at least one coastal pick`).toBeGreaterThan(0);
    }
  });

  it('road stage after the round 2 city: the combination layer stays out, every policy places a legal road or ship', () => {
    const state = roundTwo(S1_PICKS);
    const actor = setupActor(state);
    const city = expectAccepted(state, actor, createBotPolicy('standard').decide(viewOf(state, actor), ctxFor(actor)));
    expect(city.turn.setup).toMatchObject({ stage: 'road', round: 2 });
    expect(city.board.buildings[(city.turn.setup as { lastVertex: number }).lastVertex]).toMatchObject({ player: actor, city: true });
    expect(sfckSetup(turnOf(city, 'standard', MODULES, actor))).toBeUndefined();
    const answers = expectEveryPolicyAnswers(city, actor);
    for (const [name, command] of answers) expect(['setup.placeRoad', 'setup.placeShip'], name).toContain(command.type);
    // 與 SF 單獨相同（standard、easy 的種子一致）。
    for (const [name, , level, seed] of POLICIES) {
      if (name === 'fallback') continue;
      expect(createBotPolicy(level).decide(viewOf(city, actor), ctxFor(actor, level, seed)), name).toEqual(
        createBotPolicy(level, { modules: WITHOUT_SFCK }).decide(viewOf(city, actor), ctxFor(actor, level, seed)),
      );
    }
  });

  it.each([3, 4, 5, 6] as const)('%i players: a whole setup is accepted at every step, building and road or ship alike', (players) => {
    for (const [name, policy, level, seed] of POLICIES) {
      let { state } = sfckGame(players);
      const types = new Set<string>();
      for (let step = 0; step < 80 && state.turn.phase === 'setup'; step++) {
        const actor = setupActor(state);
        const command = policy.decide(viewOf(state, actor), ctxFor(actor, level, seed + step));
        types.add(command!.type);
        state = expectAccepted(state, actor, command);
      }
      expect(state.turn.phase, `${name} left setup`).toBe('preroll');
      expect(types.has('setup.placeBuilding'), name).toBe(true);
      expect(types.has('setup.placeRoad') || types.has('setup.placeShip'), name).toBe(true);
      // 第 2 輪放的是城市。
      expect(state.board.buildings.filter((building) => building?.city), `${name} cities`).toHaveLength(players);
    }
  });
});

// ---------------------------------------------------------------------------
// FX-G：金礦
// ---------------------------------------------------------------------------

describe('FX-G gold', () => {
  /** 與 `sfck-duty.test.ts` 的 F7 相同：p1 在金礦 (3,-3) 4 旁有城市，擲出 4 之後輪到 p1 作答。 */
  function goldFrame(): GameState {
    const state = emptySfckGame(4, 0, 'preroll');
    settle(state, 'p1', V15, true);
    setImprovement(state, 'p3', 'science', 3);
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(1, 3, SCIENCE)).state;
    expect(moduleFrame(rolled)).toMatchObject({ kind: 'seafarers.gold', responders: ['p1'] });
    return rolled;
  }

  it('G1 the gold frame is answered with the card the plan lacks, by standard and easy', () => {
    const state = goldFrame();
    // 擲骰之後再佈置：p1 的另一座聚落（v28）可以升級城市（3 ore、2 grain），手上有 3 張 ore，缺 2 張 grain。
    settle(state, 'p1', V28);
    setHand(state, 'p1', { ore: 3 });
    const view = viewOf(state, 'p1');
    expect((view.hints!.modules!.seafarers as { goldRequired: number }).goldRequired).toBe(2);
    const answers = expectEveryPolicyAnswers(state, 'p1');
    for (const name of ['standard', 'easy#1', 'easy#2']) expect(answers.get(name), name).toEqual({ type: 'gold.choose', resources: ['grain', 'grain'] });
    // 保底只要合法（依 RESOURCES 順序），不必最缺。
    expect(answers.get('fallback')!.type).toBe('gold.choose');
    // 其他座位等待。
    for (const other of ['p2', 'p3', 'p4']) {
      for (const [name, policy, level, seed] of POLICIES) expect(policy.decide(viewOf(state, other), ctxFor(other, level, seed)), `${other} ${name}`).toBeNull();
    }
  });

  /** p1 有金礦聚落與另一座聚落，手牌剛好升級一座城市：`build.city` 的點就是估值較高的那一座。 */
  function upgradeWorld(gold: number, other: number): GameState {
    const state = emptySfckGame(4);
    settle(state, 'p1', gold);
    settle(state, 'p1', other);
    setHand(state, 'p1', { ore: 3, grain: 2 });
    return state;
  }
  const cityTarget = (state: GameState, level: BotLevel = 'standard'): number | undefined => {
    const command = createBotPolicy(level).decide(viewOf(state, 'p1'), ctxFor('p1', level)) as { type: string; vertex?: number };
    expect(command.type).toBe('build.city');
    return command.vertex;
  };
  const upgradeValue = (state: GameState, vertex: number): number => {
    const turn = turnOf(state);
    return productionValue(turn.model, vertex, turn.economy.weights);
  };

  it('G2 the gold settlement is upgraded when its value is higher, the forest one when it is higher', () => {
    // v15：金礦 4 加丘陵 5（7.13）；v47：森林 9 旁的海岸（4.4，一張 paper）；v75：森林 5 加草原 8 加田地 11（11.98）。
    const gold = upgradeWorld(V15, 47);
    expect(upgradeValue(gold, V15)).toBeGreaterThan(upgradeValue(gold, 47));
    expect(cityTarget(gold)).toBe(V15);
    const forest = upgradeWorld(V15, 75);
    expect(upgradeValue(forest, 75)).toBeGreaterThan(upgradeValue(forest, V15));
    expect(cityTarget(forest)).toBe(75);
    // 只有金礦（3 點）時，比一張 4 點的 paper 還低：金礦只是一張萬用牌，沒有商品。
    const pure = upgradeWorld(V10, 47);
    expect(upgradeValue(pure, V10)).toBeLessThan(upgradeValue(pure, 47));
    expect(cityTarget(pure)).toBe(47);
    // easy 也要升級，而且是兩座之一（topK 3，沒有更多候選）。
    for (const state of [gold, forest, pure]) {
      for (const seed of [1, 2, 3]) {
        const command = createBotPolicy('easy').decide(viewOf(state, 'p1'), ctxFor('p1', 'easy', seed));
        expectAccepted(state, 'p1', command);
        expect(command!.type).toBe('build.city');
      }
      expectEveryPolicyAnswers(state, 'p1');
    }
  });

  it('G2 a gold city is worth two wildcard cards and no commodity (COMB-8); a forest city one lumber and one paper', () => {
    const state = emptySfckGame(4);
    const turn = turnOf(state);
    const { model, economy } = turn;
    const weights = economy.weights;
    const wildcard = wildcardWeight(weights);
    // v10：只有金礦 4（3 點）。
    expect(goldPipsAt(model, V10)).toBe(3);
    expect(model.hexYield?.(model, hex(state, 3, -3), V10, true), 'C&K does not answer for gold').toBeUndefined();
    const city = vertexYield(model, V10, null, true);
    for (const kind of ['lumber', 'brick', 'wool', 'grain', 'ore', 'paper', 'cloth', 'coin'] as const) expect(city[kind] ?? 0, kind).toBe(0);
    // 聚落一張、城市兩張：升級多得一張（productionValue），聚落本身也是一張（settlementSpotValue 沒有缺資源加成時）。
    const full = { lumber: 1, brick: 1, wool: 1, grain: 1, ore: 1 };
    expect(productionValue(model, V10, weights)).toBeCloseTo(3 * wildcard, 9);
    expect(settlementSpotValue(model, V10, weights, full)).toBeCloseTo(3 * wildcard, 9);
    expect(productionValue(model, V10, weights) + settlementSpotValue(model, V10, weights, full)).toBeCloseTo(2 * 3 * wildcard, 9);
    // v49：森林 9 加金礦 10。城市在森林上是 1 張 lumber 加 1 張 paper（4 點），金礦另外算一張萬用牌。
    const mixed = vertexYield(model, 49, null, true);
    expect(mixed.lumber).toBe(4);
    expect(mixed.paper).toBe(4);
    const upgrade = productionValue(model, 49, weights);
    expect(upgrade).toBeCloseTo(4 * weights.paper! + goldPipsAt(model, 49) * wildcard, 9);
    expect(weightedPips(vertexYield(model, 49, null, false), weights)).toBeLessThan(weightedPips(mixed, weights));
  });
});

// ---------------------------------------------------------------------------
// FX-B3：首攻後擲出 7，海盜比強盜好
// ---------------------------------------------------------------------------

describe('FX-B3 either bandit after a 7', () => {
  /** 首攻之後 p1 擲出 7；p1 沒有建築、p2 沒有陸地上的建築，海盜旁有 p2 的船與 3 張牌可偷。 */
  function sevenWorld(): GameState {
    const state = afterFirstAttack(emptySfckGame(4, 0, 'preroll'));
    ship(state, 'p2', edgeBetween(state, 48, 47));
    setHand(state, 'p2', { brick: 1, wool: 1, grain: 1 });
    return actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, TRADE)).state;
  }

  it('standard moves the pirate to the ship of p2, easy and the duty move the robber', () => {
    const state = sevenWorld();
    expect(state.pending).toMatchObject({ kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false });
    const view = viewOf(state, 'p1');
    expect((view.hints!.modules!.seafarersCitiesKnights as { bandit: string }).bandit).toBe('either');
    const answers = expectEveryPolicyAnswers(state, 'p1');
    const target = (name: string): number => (answers.get(name) as { hex: number }).hex;
    // standard：海格（p2 的船旁），而且偷得到 p2。
    expect(view.board.terrain[target('standard')]).toBe('sea');
    const stolen = expectAccepted(state, 'p1', answers.get('standard')!);
    expect(stolen.pending).toMatchObject({ kind: 'steal', candidates: ['p2'], pirate: true });
    // easy 與保底：陸地（強盜），沒有海盜候選。
    for (const name of ['easy#1', 'easy#2', 'fallback']) expect(view.board.terrain[target(name)], name).not.toBe('sea');
  });

  it('with no ship of an opponent at sea the pirate has nothing to offer: standard moves the robber too', () => {
    const state = afterFirstAttack(emptySfckGame(4, 0, 'preroll'));
    const seven = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, TRADE)).state;
    const view = viewOf(seven, 'p1');
    expect((view.hints!.modules!.seafarersCitiesKnights as { bandit: string }).bandit).toBe('either');
    for (const [name, command] of expectEveryPolicyAnswers(seven, 'p1')) {
      expect(view.board.terrain[(command as { hex: number }).hex], name).not.toBe('sea');
    }
  });
});
