/**
 * 海路通達（#171）：沒有船的出發點時，沿海聚落計畫 `seafarers.coastSettlement`。
 *
 * 船只能接在自己的建築或船上，不能接路，所以兩棟建築都在內陸的玩家要先在沿海、還有空海邊的路口蓋聚落才造得了船。
 * 固定盤面（rules 的 4 人 New Shores，`seafarers-helpers.ts`）上驗證：
 * - 內陸開局：最好的計畫是修路到沿海空點，決策是那條路（base 的聚落計畫走向內陸的另一條路）；兩邊都能蓋時，
 *   立即蓋的是沿海點而不是產能較高的內陸點；Road Building 的免費道路也走同一條路。
 * - 已有出發點時（含只被海盜擋住的海邊）不產生計畫、不加分：`scoreExtras` 與只有島嶼計畫時完全相同。
 * - 海邊被占走的沿海點、沒有船或聚落可用時不產生計畫；`planStep` 只送 hints 認可的指令。
 * - SF+CK：騎士站到沿海計畫的建地上要付該計畫的價值（`rescore`）。
 *
 * 每個送出的指令都必須被 `applyCommand` 接受。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  COSTS,
  getProfile,
  getTopology,
  projectGame,
  seededRng,
  type Command,
  type GameState,
  type GameView,
} from '@catan/rules';
import { act, setHand } from '../../rules/test/helpers.ts';
import { emptySeafarersGame, road, settle } from '../../rules/test/seafarers-helpers.ts';
import { emptySfckGame } from '../../rules/test/sfck-helpers.ts';
import { isSeaEdge, playerYield, type BoardModel } from '../src/board.ts';
import { economyOf, PIP_VALUE, settlementSpotValue, type Plan } from '../src/economy.ts';
import { turnContext } from '../src/heuristic.ts';
import { botModulesOf } from '../src/index.ts';
import { seafarersActions } from '../src/modules/seafarers/actions.ts';
import {
  ACCESS_WEIGHT,
  claimedIslands,
  COAST_SETTLEMENT,
  coastSettlementPlans,
  hasLaunchPoint,
  islandSettlementPlans,
  MAX_PLAN_SHIPS,
  seaAccessValue,
  seafarersEconomy,
  seafarersPlanStep,
} from '../src/modules/seafarers/plan.ts';
import { sfckRescore } from '../src/modules/seafarersCitiesKnights/rescore.ts';
import type { BotModule, PlanInput, TurnContext } from '../src/modules/types.ts';
import { moduleHints } from '../src/modules/view.ts';
import { createBotPolicy } from '../src/policy.ts';
import { shipEdgesOf } from '../src/sea.ts';
import type { BotCommand, BotContext, BotLevel } from '../src/types.ts';

// ---------------------------------------------------------------------------
// 工具與幾何
// ---------------------------------------------------------------------------

/**
 * 4 人地圖：v41 在主島內陸（三條邊都不是海邊）。從 v41 出發，沿海空點 v37 要修 52、53 兩條路，
 * 內陸的 v43 要修 56、55（base 的聚落計畫裡產能最高的點）。v27 與 v41 相鄰，有 31、32 兩條海邊。
 */
const INLAND = 41;
const COAST = 37;
const TO_COAST = [52, 53] as const;
const RICHER_INLAND = 43;
const TO_INLAND = [56, 55] as const;
const SHORE = 27;
/** 遠離 v41 的沿海點（有空的海邊），用來給 p1 一個現成的出發點。 */
const FAR_SHORE = 92;

const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 1): BotContext => ({ selfId, level, seed, offerPhases: {} });

function viewOf(state: GameState, playerId = 'p1'): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

function turnOf(state: GameState, level: BotLevel = 'standard', selfId = 'p1'): TurnContext {
  return turnContext(viewOf(state, selfId), ctxFor(selfId, level), level);
}

function decideAccepted(state: GameState, level: BotLevel = 'standard', selfId = 'p1'): BotCommand {
  const command = createBotPolicy(level).decide(viewOf(state, selfId), ctxFor(selfId, level));
  expect(command, `${selfId} has a command`).not.toBeNull();
  const outcome = applyCommand(state, selfId, command as Command, seededRng(1));
  expect(outcome.ok, `${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
  return command!;
}

/** 改動之前的 SF 經濟鉤子：只有島嶼計畫（沒有沿海計畫，也就沒有沿海的立即建造與罰分）。 */
const SF_MODULES = botModulesOf(getProfile('sf-new-shores-2025')!);
const ISLAND_ONLY: readonly BotModule[] = SF_MODULES.map((module) =>
  module.id === 'seafarers' ? { ...module, economy: { ...module.economy!, scoreExtras: islandSettlementPlans } } : module,
);

function islandOnlyDecision(state: GameState, level: BotLevel = 'standard'): BotCommand | null {
  return createBotPolicy(level, { modules: ISLAND_ONLY }).decide(viewOf(state), ctxFor('p1', level));
}

const coastPlans = (turn: TurnContext): Plan[] => turn.economy.plans.filter((plan) => plan.kind === COAST_SETTLEMENT);

function seaEdgesAt(model: BoardModel, vertex: number): number[] {
  return model.topo.vertices[vertex]!.edges.filter((edge) => isSeaEdge(model, edge));
}

/** p1 只有一座內陸聚落，手上有 `hand`。 */
function landlocked(hand: Parameters<typeof setHand>[2] = { lumber: 1, brick: 1 }): GameState {
  const state = emptySeafarersGame(4, 0, 'action');
  settle(state, 'p1', INLAND);
  setHand(state, 'p1', hand);
  return state;
}

const HANDS: readonly Parameters<typeof setHand>[2][] = [
  {},
  { lumber: 1, brick: 1 },
  { lumber: 1, wool: 1 },
  { lumber: 1, brick: 1, wool: 1, grain: 1 },
  { grain: 2, ore: 3 },
  { lumber: 3, brick: 3, wool: 2, grain: 2, ore: 1 },
];

function inputOf(turn: TurnContext, left: Readonly<Record<string, number>> = {}): PlanInput {
  return { model: turn.model, level: turn.level, base: { ...turn.economy, left: { ...turn.economy.left, ...left } } };
}

// ---------------------------------------------------------------------------
// 內陸開局
// ---------------------------------------------------------------------------

describe('a landlocked start plans roads to the coast (#171)', () => {
  it('has no launch point, so the best plan is a coastal settlement two roads away', () => {
    const turn = turnOf(landlocked());
    const { model } = turn;
    expect(seaEdgesAt(model, INLAND), 'v41 is inland').toEqual([]);
    expect(hasLaunchPoint(model)).toBe(false);
    expect(shipEdgesOf(model)).toEqual([]);

    const best = turn.economy.plans[0]!;
    expect(best).toMatchObject({ kind: COAST_SETTLEMENT, vertex: COAST, roads: [...TO_COAST], ships: [], nextCost: COSTS.road, immediate: false });
    // 蓋好之後還有一條空的海邊可以放船（路徑沒有占掉全部的海邊）。
    expect(seaEdgesAt(model, COAST).some((edge) => !best.roads.includes(edge))).toBe(true);
    // 價值：聚落本身加上一半的出海價值，再依兩條路打折。
    const longTerm = playerYield(model, 'p1', true);
    const access = seaAccessValue(model, COAST, best.roads, MAX_PLAN_SHIPS, turn.economy, longTerm, claimedIslands(model));
    expect(access).toBeGreaterThan(0);
    const settlement = 1 + PIP_VALUE * settlementSpotValue(model, COAST, turn.economy.weights, longTerm);
    expect(best.value).toBeCloseTo((settlement + ACCESS_WEIGHT * access) * 0.9 ** 2, 12);
  });

  it('builds the first road toward the coast, where base alone heads inland', () => {
    const state = landlocked();
    const turn = turnOf(state);
    const baseOnly = economyOf(turn.model, []).plans.find((plan) => plan.kind === 'settlement')!;
    expect(baseOnly.vertex).toBe(RICHER_INLAND);
    expect(baseOnly.roads).toEqual([...TO_INLAND]);
    expect(seaEdgesAt(turn.model, RICHER_INLAND)).toEqual([]);
    expect(islandOnlyDecision(state)).toEqual({ type: 'build.road', edge: TO_INLAND[0] });
    expect(decideAccepted(state)).toEqual({ type: 'build.road', edge: TO_COAST[0] });
  });

  it('settles the coastal site before a richer inland one when it can build both', () => {
    const state = landlocked({ lumber: 1, brick: 1, wool: 1, grain: 1 });
    for (const edge of [...TO_COAST, ...TO_INLAND]) road(state, 'p1', edge);
    const turn = turnOf(state);
    const legal = turn.view.hints!.legalSettlements;
    expect(legal).toEqual(expect.arrayContaining([COAST, RICHER_INLAND]));
    // base 的立即建造只看產能：內陸點分數較高。
    const mine = playerYield(turn.model, 'p1', true);
    const weights = turn.economy.weights;
    expect(settlementSpotValue(turn.model, RICHER_INLAND, weights, mine)).toBeGreaterThan(settlementSpotValue(turn.model, COAST, weights, mine));
    const plan = coastPlans(turn).find((candidate) => candidate.vertex === COAST)!;
    expect(plan).toMatchObject({ roads: [], nextCost: COSTS.settlement, immediate: true });
    expect(seafarersActions(turn)).toContainEqual({ item: { type: 'build.settlement', vertex: COAST }, score: plan.value });
    expect(islandOnlyDecision(state)).toEqual({ type: 'build.settlement', vertex: RICHER_INLAND });
    expect(decideAccepted(state)).toEqual({ type: 'build.settlement', vertex: COAST });
  });

  it('uses a free road from Road Building on the coastal plan', () => {
    const state = landlocked({ lumber: 1, brick: 1 });
    state.players[0]!.devCards = ['roadBuilding'];
    const played = act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
    expect(viewOf(played).pending).toMatchObject({ kind: 'freeRoads', actor: 'p1' });
    expect(decideAccepted(played)).toEqual({ type: 'build.road', edge: TO_COAST[0] });
  });

  it('easy plans the coast too, within its shorter ship reach', () => {
    const state = landlocked();
    const turn = turnOf(state, 'easy');
    expect(coastPlans(turn).length).toBeGreaterThan(0);
    decideAccepted(state, 'easy');
  });
});

// ---------------------------------------------------------------------------
// 已有出發點：決策不變
// ---------------------------------------------------------------------------

describe('an existing launch point leaves the decisions unchanged', () => {
  function expectNoCoastPlans(state: GameState): void {
    for (const level of ['standard', 'easy'] as const) {
      const turn = turnOf(state, level);
      expect(hasLaunchPoint(turn.model), level).toBe(true);
      expect(coastPlans(turn), level).toEqual([]);
      const input = inputOf(turn);
      // 經濟鉤子的結果與只有島嶼計畫時完全相同（plans 與分數一樣，所以決策也一樣）。
      expect(seafarersEconomy.scoreExtras!(input), level).toEqual(islandSettlementPlans(input));
      expect(coastSettlementPlans(input), level).toEqual([]);
      expect(seafarersActions(turn), level).toEqual(seafarersActions(turnContext(viewOf(state), ctxFor('p1', level), level, ISLAND_ONLY)));
    }
    // 各種手牌下，決策與只有島嶼計畫的策略相同。
    for (const hand of HANDS) {
      setHand(state, 'p1', hand);
      for (const level of ['standard', 'easy'] as const) {
        expect(decideAccepted(state, level), `${level} ${JSON.stringify(hand)}`).toEqual(islandOnlyDecision(state, level));
      }
    }
  }

  it('a coastal building with a free sea edge', () => {
    const state = landlocked();
    settle(state, 'p1', FAR_SHORE);
    expect(seaEdgesAt(turnOf(state).model, FAR_SHORE).length).toBeGreaterThan(0);
    expectNoCoastPlans(state);
  });

  it('a coastal building whose sea edges only touch the pirate (the pirate moves away)', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    settle(state, 'p1', SHORE);
    setHand(state, 'p1', { lumber: 1, brick: 1 });
    const topo = getTopology(state.board.layout.topologyId);
    const model = turnOf(state).model;
    const sea = seaEdgesAt(model, SHORE);
    const shared = topo.edges[sea[0]!]!.hexes.filter((hex) => sea.every((edge) => topo.edges[edge]!.hexes.includes(hex)) && state.board.layout.terrain[hex] === 'sea');
    expect(shared).toHaveLength(1);
    state.board.pirate = shared[0]!;
    expect(moduleHints(viewOf(state).hints, 'seafarers')!.legalShips).toEqual([]);
    expectNoCoastPlans(state);
  });
});

// ---------------------------------------------------------------------------
// 不產生計畫的情況與 planStep
// ---------------------------------------------------------------------------

describe('coastal sites that do not give a launch point', () => {
  it('skips a coastal site whose sea edges are already taken by other roads', () => {
    const state = landlocked();
    const model = turnOf(state).model;
    for (const edge of seaEdgesAt(model, COAST)) road(state, 'p2', edge);
    const turn = turnOf(state);
    expect(hasLaunchPoint(turn.model)).toBe(false);
    expect(coastPlans(turn).map((plan) => plan.vertex)).not.toContain(COAST);
    expect(coastPlans(turn).length).toBeGreaterThan(0);
  });

  it('makes no plan without a ship or a settlement left', () => {
    const turn = turnOf(landlocked());
    expect(coastSettlementPlans(inputOf(turn))).not.toEqual([]);
    expect(coastSettlementPlans(inputOf(turn, { ships: 0 }))).toEqual([]);
    expect(coastSettlementPlans(inputOf(turn, { settlements: 0 }))).toEqual([]);
  });

  it('makes no plan when no island is within the ship reach', () => {
    // 只剩 1 艘船：從 v37 出海一艘船登不上任何小島，出海價值為 0，沿海點與內陸點沒有差別。
    const turn = turnOf(landlocked());
    const longTerm = playerYield(turn.model, 'p1', true);
    expect(seaAccessValue(turn.model, COAST, [...TO_COAST], 1, turn.economy, longTerm, claimedIslands(turn.model))).toBe(0);
    expect(coastSettlementPlans(inputOf(turn, { ships: 1 }))).toEqual([]);
  });

  it('planStep builds the next road, then the settlement, and only what the hints allow', () => {
    const state = landlocked({ lumber: 2, brick: 2, wool: 1, grain: 1 });
    const turn = turnOf(state);
    const plan = coastPlans(turn)[0]!;
    expect(seafarersPlanStep(turn, plan)).toEqual({ type: 'build.road', edge: TO_COAST[0] });
    // 不在 legalRoads 的路：回 null，骨架會繼續處理別的計畫。
    expect(seafarersPlanStep(turn, { ...plan, roads: [TO_COAST[1]] })).toBeNull();
    for (const edge of TO_COAST) road(state, 'p1', edge);
    const arrived = turnOf(state);
    const there = coastPlans(arrived).find((candidate) => candidate.vertex === COAST)!;
    expect(seafarersPlanStep(arrived, there)).toEqual({ type: 'build.settlement', vertex: COAST });
    expect(seafarersPlanStep(arrived, { ...there, vertex: RICHER_INLAND })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SF+CK：騎士位置的罰分
// ---------------------------------------------------------------------------

describe('SF+CK rescore', () => {
  it('a knight on the own coastal-plan site costs the plan value', () => {
    const state = emptySfckGame(4, 0, 'action');
    settle(state, 'p1', INLAND);
    setHand(state, 'p1', { lumber: 1, brick: 1 });
    const modules = botModulesOf(getProfile('sf-ck-new-shores-2025')!);
    const turn = turnContext(viewOf(state), ctxFor('p1'), 'standard', modules);
    const plan = coastPlans(turn)[0]!;
    expect(plan).toBeDefined();
    for (const command of [
      { type: 'knight.move', from: 5, to: plan.vertex! },
      { type: 'knight.displace', from: 5, to: plan.vertex! },
      { type: 'knight.recruit', vertex: plan.vertex! },
    ] as BotCommand[]) {
      expect(sfckRescore(turn, command), command.type).toBe(-plan.value);
    }
  });
});
