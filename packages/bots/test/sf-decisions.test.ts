/**
 * SF-2a 決策測試（SF 計畫 §4.2、§6.1）：島嶼計畫與行動。
 *
 * 每個鉤子都在 rules 的固定盤面（`seafarers-helpers.ts`，不使用 harness）上驗證：島嶼聚落計畫的成本、
 * `nextCost` 與 +2 VP，`planStep` 的造船與登島聚落，移船（只取 `hints.movableShips`），免費路線的
 * 造船與造路，行動階段以船打出 Road Building，交易目標與立即得分的開價，以及 easy 的差異
 * （船路徑 ≤ 3、topK 3、不移船）。每個送出的指令都必須被 `applyCommand` 接受。
 *
 * I9 固定盤面（F1–F7 由 SF-1 與 SF-2b 負責）：
 * - F8：6 人 paired 的 Player 2 造船與移船、不開價；
 * - F9：道路存量用完時，以船打出 Road Building。
 * - D-SF6：船圈盤面（`seafarers-ships.test.ts`）上，策略送出的 `ship.move`，其 from 與 to 必須落在
 *   `hints.movableShips` 內。
 *
 * 幾何（4 人地圖，海格 (2,0) 周圍）：k3 是主島海岸，k5 與 k0 在東北小島（金礦 (3,0)）的西岸；
 * 環邊 NW k3–k4、NE k4–k5、E k5–k0。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  COSTS,
  getTopology,
  isLandHex,
  projectGame,
  seededRng,
  SHIP_COST,
  type Command,
  type GameState,
  type GameView,
} from '@catan/rules';
import { act, setHand } from '../../rules/test/helpers.ts';
import { corner, emptySeafarersGame, road, settle, ship, side } from '../../rules/test/seafarers-helpers.ts';
import { boardModel, playerYield, vertexYield } from '../src/board.ts';
import {
  goldPipsAt,
  PIP_VALUE,
  productionValue,
  settlementSpotValue,
  weightedPips,
  wildcardWeight,
  type Plan,
} from '../src/economy.ts';
import { fallbackPolicy } from '../src/fallback.ts';
import { turnContext } from '../src/heuristic.ts';
import { seafarersActions, seafarersFreeRouteCandidates } from '../src/modules/seafarers/actions.ts';
import {
  EASY_MAX_PLAN_SHIPS,
  ISLAND_BONUS_VP,
  ISLAND_SETTLEMENT,
  MAX_PLAN_SHIPS,
  seafarersEconomy,
  seafarersPlanStep,
} from '../src/modules/seafarers/plan.ts';
import type { TurnContext } from '../src/modules/types.ts';
import { moduleHints } from '../src/modules/view.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotCommand, BotContext, BotLevel, BotPolicy } from '../src/types.ts';

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

function turnOf(state: GameState, level: BotLevel = 'standard', selfId = 'p1', seed = 1): TurnContext {
  return turnContext(viewOf(state, selfId), ctxFor(selfId, level, seed), level);
}

function decide(state: GameState, level: BotLevel = 'standard', selfId = 'p1', seed = 1): BotCommand | null {
  return createBotPolicy(level).decide(viewOf(state, selfId), ctxFor(selfId, level, seed));
}

function islandPlans(turn: TurnContext): Plan[] {
  return turn.economy.plans.filter((plan) => plan.kind === ISLAND_SETTLEMENT);
}

/** 指令必須被引擎接受。 */
function expectAccepted(state: GameState, actor: string, command: BotCommand | null | undefined): void {
  expect(command, `${actor} has a command`).not.toBeNull();
  const outcome = applyCommand(state, actor, command as Command, seededRng(1));
  expect(outcome.ok, `${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
}

/** 決策並確認被接受。 */
function decideAccepted(state: GameState, level: BotLevel = 'standard', selfId = 'p1', seed = 1): BotCommand {
  const command = decide(state, level, selfId, seed);
  expectAccepted(state, selfId, command);
  return command!;
}

/** 4 人地圖：海格 (2,0) 周圍的環。 */
function ring(state: GameState) {
  const k = (n: number) => corner(state, 2, 0, n);
  const s = (n: number) => side(state, 2, 0, n);
  return { k0: k(0), k1: k(1), k2: k(2), k3: k(3), k4: k(4), k5: k(5), E: s(0), NE: s(1), NW: s(2), W: s(3), SW: s(4), SE: s(5) };
}

/** p1 在 k3 有一座聚落，手上有 `hand`。 */
function k3Game(hand: Parameters<typeof setHand>[2], level?: 'preroll' | 'action'): GameState {
  const state = emptySeafarersGame(4, 0, level ?? 'action');
  settle(state, 'p1', ring(state).k3);
  setHand(state, 'p1', hand);
  return state;
}

function modulesHintsOf(state: GameState, playerId = 'p1') {
  return moduleHints(viewOf(state, playerId).hints, 'seafarers')!;
}

/** 該小島的加分已經領過（直接改 rules 的模組狀態，模擬先前已在那座島蓋過聚落）。 */
function claimIsland(state: GameState, playerId: string, island: number): void {
  const slot = state.moduleState!.seafarers as { islands: Record<string, number[]> };
  slot.islands[playerId] = [...(slot.islands[playerId] ?? []), island];
}

/** 把玩家的道路補到 `count` 條（主島內陸西側的道路邊），避開環一帶。 */
function fillRoads(state: GameState, playerId: string, count: number): void {
  const topo = getTopology(state.board.layout.topologyId);
  const near = new Set<number>();
  for (const n of [0, 1, 2, 3, 4, 5]) near.add(corner(state, 2, 0, n));
  const edges = topo.edges.flatMap((info, edge) => {
    if (state.board.roads[edge] || info.x > 0 || info.vertices.some((vertex) => near.has(vertex))) return [];
    return info.hexes.filter((hex) => isLandHex(state, hex)).length === 2 ? [edge] : [];
  });
  expect(edges.length).toBeGreaterThanOrEqual(count);
  for (const edge of edges.slice(0, count)) state.board.roads[edge] = { player: playerId, ship: false };
}

const POLICIES: readonly (readonly [string, BotPolicy, BotLevel, number])[] = [
  ['fallback', fallbackPolicy, 'standard', 1],
  ['standard', createBotPolicy('standard'), 'standard', 1],
  ['easy#1', createBotPolicy('easy'), 'easy', 1],
  ['easy#2', createBotPolicy('easy'), 'easy', 2],
];

/** 每種策略在這個盤面上都送出被接受的指令；回傳各策略的指令（依 POLICIES 順序）。 */
function everyPolicy(state: GameState, actor: string): BotCommand[] {
  const view = viewOf(state, actor);
  return POLICIES.map(([name, policy, level, seed]) => {
    const command = policy.decide(view, ctxFor(actor, level, seed));
    expect(command, `${name} must not stall`).not.toBeNull();
    expectAccepted(state, actor, command);
    return command!;
  });
}


// ---------------------------------------------------------------------------
// 島嶼聚落計畫
// ---------------------------------------------------------------------------

describe('island settlement plan', () => {
  it('prices the ships, the settlement and the +2 VP of an unclaimed island', () => {
    const state = k3Game({ lumber: 4, wool: 4, brick: 1, grain: 1 });
    const turn = turnOf(state);
    const plans = islandPlans(turn);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.length).toBeLessThanOrEqual(3);
    const best = plans[0]!;
    expect(turn.economy.plans[0]).toBe(best);
    expect(best.kind).toBe('seafarers.islandSettlement');
    expect(best.ships).toHaveLength(2);
    // 成本 = SHIP_COST × n + 聚落；nextCost 是下一艘船，所以銀行交易以船為目標。
    expect(best.cost).toEqual({ lumber: 3, wool: 3, brick: 1, grain: 1 });
    expect(best.nextCost).toEqual(SHIP_COST);
    expect(best.roads).toEqual([]);
    expect(best.immediate).toBe(false);
    // 每艘船都能接起來：第一艘在 legalShips 內。
    expect(modulesHintsOf(state).legalShips).toContain(best.ships![0]);

    // 同一座島、同一個路口：領過加分之後價值少 2。
    const claimed = k3Game({ lumber: 4, wool: 4, brick: 1, grain: 1 });
    const island =
      claimed.board.layout.islands[
        getTopology(claimed.board.layout.topologyId).vertices[best.vertex!]!.hexes.find((hex) => isLandHex(claimed, hex))!
      ]!;
    expect(island).toBeGreaterThan(1);
    claimIsland(claimed, 'p1', island);
    const same = islandPlans(turnOf(claimed)).find((plan) => plan.vertex === best.vertex)!;
    expect(same.ships).toEqual(best.ships);
    expect(best.value - same.value).toBeCloseTo(ISLAND_BONUS_VP, 10);
    expect(ISLAND_BONUS_VP).toBe(2);
  });

  it('with the ships already in place, only the settlement is left and it counts as scoring now', () => {
    const state = k3Game({ lumber: 1, brick: 1, wool: 1 });
    const r = ring(state);
    ship(state, 'p1', r.NW);
    ship(state, 'p1', r.NE);
    const turn = turnOf(state);
    const plan = islandPlans(turn).find((candidate) => candidate.vertex === r.k5)!;
    expect(plan).toBeDefined();
    expect(plan.ships).toEqual([]);
    expect(plan.cost).toEqual(COSTS.settlement);
    expect(plan.nextCost).toEqual(COSTS.settlement);
    expect(plan.immediate).toBe(true);
    expect(viewOf(state, 'p1').hints!.legalSettlements).toContain(r.k5);
  });

  it('adds the economy hooks: ship cost and the ships left', () => {
    const state = k3Game({ lumber: 2, wool: 2 });
    const r = ring(state);
    expect(turnOf(state).economy.costs['ship']).toEqual(SHIP_COST);
    expect(turnOf(state).economy.left['ships']).toBe(15);
    ship(state, 'p1', r.NW);
    ship(state, 'p1', r.NE);
    expect(turnOf(state).economy.left['ships']).toBe(13);
    const model = boardModel(viewOf(state, 'p1'), 'p1');
    expect(seafarersEconomy.costs!(model)).toEqual({ ship: SHIP_COST });
    expect(seafarersEconomy.piecesLeft!(model)).toEqual({ ships: 13 });
  });

  it('prices gold as wildcard pips at a settlement spot and at the island plan target', () => {
    const state = k3Game({ lumber: 4, wool: 4, brick: 1, grain: 1 });
    const r = ring(state);
    const model = boardModel(viewOf(state, 'p1'), 'p1');
    // k5 touches the gold hex (3,0) (10 → 3 pips) and a forest (9 → 4 pips).
    expect(goldPipsAt(model, r.k5)).toBe(3);
    expect(goldPipsAt(model, r.k3)).toBe(0);
    const turn = turnOf(state);
    const weights = turn.economy.weights;
    const noGold = { ...model, hexGold: model.hexGold.map(() => false) };
    const mine = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    const withGold = settlementSpotValue(model, r.k5, weights, mine);
    const without = settlementSpotValue(noGold, r.k5, weights, mine);
    // 3 點萬用資源，再加上補一種缺少的資源（2.5，只算一次）。
    expect(withGold - without).toBeCloseTo(3 * wildcardWeight(weights) + 2.5, 10);
    // 沒有金礦時，與原本的 weightedPips 完全相同（base 不受影響）。
    expect(productionValue(noGold, r.k5, weights)).toBe(weightedPips(vertexYield(noGold, r.k5), weights));

    // 島嶼計畫的價值 = 聚落價值（含金礦，2 艘船打 0.9 折）+ 小島加分。
    const plan = islandPlans(turn).find((candidate) => candidate.vertex === r.k5)!;
    expect(plan).toBeDefined();
    expect(plan.ships).toHaveLength(2);
    const longTerm = playerYield(model, 'p1', true);
    expect(plan.value).toBeCloseTo((1 + PIP_VALUE * settlementSpotValue(model, r.k5, weights, longTerm)) * 0.9 ** 2 + ISLAND_BONUS_VP, 10);
  });

  it('values a city on gold by its wildcard card, a settlement by one', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    // 金礦 (3,0) 的角：只鄰接金礦與海。
    const gold = corner(state, 3, 0, 0);
    settle(state, 'p1', gold);
    setHand(state, 'p1', { grain: 2, ore: 3 });
    const turn = turnOf(state);
    const city = turn.economy.plans.find((plan) => plan.kind === 'city')!;
    expect(city.vertex).toBe(gold);
    const model = turn.model;
    expect(goldPipsAt(model, gold)).toBe(3);
    // 沒有一般資源，所以升級的價值全來自金礦：多得 1 張萬用資源（每個點數 × 最大權重）。
    expect(weightedPips(vertexYield(model, gold), turn.economy.weights)).toBe(0);
    expect(city.value).toBeCloseTo(1 + PIP_VALUE * 3 * wildcardWeight(turn.economy.weights), 10);
  });

  it('plans at most 4 ships for standard and 3 for easy', () => {
    expect(MAX_PLAN_SHIPS).toBe(4);
    expect(EASY_MAX_PLAN_SHIPS).toBe(3);
    // 主島西北岸 (-2,0) 的角 3：最近的小島 (0,-3) 要 4 艘船。
    const state = emptySeafarersGame(4, 0, 'action');
    const far = corner(state, -2, 0, 3);
    settle(state, 'p1', far);
    setHand(state, 'p1', { lumber: 5, wool: 5, brick: 1, grain: 1 });
    const standard = islandPlans(turnOf(state, 'standard'));
    expect(standard.map((plan) => plan.ships!.length)).toEqual([4]);
    expect(standard[0]!.cost).toEqual({ lumber: 5, wool: 5, brick: 1, grain: 1 });
    expect(islandPlans(turnOf(state, 'easy'))).toEqual([]);
    // 兩種難度都至少有一個 3 艘以內的選項時，easy 不會超過 3。
    const near = emptySeafarersGame(4, 0, 'action');
    settle(near, 'p1', corner(near, -2, 0, 4));
    setHand(near, 'p1', { lumber: 5, wool: 5, brick: 1, grain: 1 });
    expect(Math.max(...islandPlans(turnOf(near, 'standard')).map((plan) => plan.ships!.length))).toBe(4);
    expect(Math.max(...islandPlans(turnOf(near, 'easy')).map((plan) => plan.ships!.length))).toBe(3);
  });

  it('does not plan ships to main-island spots that roads cannot reach', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    settle(state, 'p1', corner(state, -3, 1, 4)); // 主島西北岸，最近的小島在 4 艘船以外或只有主島空點
    setHand(state, 'p1', { lumber: 5, wool: 5, brick: 1, grain: 1 });
    expect(islandPlans(turnOf(state))).toEqual([]);
  });

  it('plans nothing without ships left or settlements left to build', () => {
    const state = k3Game({ lumber: 4, wool: 4, brick: 1, grain: 1 });
    const turn = turnOf(state);
    expect(islandPlans(turn).length).toBeGreaterThan(0);
    const noShips = { ...turn.economy, left: { ...turn.economy.left, ships: 0 } };
    expect(seafarersEconomy.scoreExtras!({ model: turn.model, level: 'standard', base: noShips })).toEqual([]);
    const noSettlements = { ...turn.economy, left: { ...turn.economy.left, settlements: 0 } };
    expect(seafarersEconomy.scoreExtras!({ model: turn.model, level: 'standard', base: noSettlements })).toEqual([]);
  });

  it('is deterministic: the same view gives the same plans and the same decision', () => {
    const state = k3Game({ lumber: 4, wool: 4, brick: 1, grain: 1 });
    expect(islandPlans(turnOf(state))).toEqual(islandPlans(turnOf(state)));
    expect(decide(state)).toEqual(decide(state));
    expect(decide(state, 'easy', 'p1', 3)).toEqual(decide(state, 'easy', 'p1', 3));
  });
});

// ---------------------------------------------------------------------------
// planStep
// ---------------------------------------------------------------------------

describe('island plan step', () => {
  it('builds the next ship of the path, then the settlement on arrival', () => {
    const state = k3Game({ lumber: 3, wool: 3, brick: 1, grain: 1 });
    const plan = islandPlans(turnOf(state))[0]!;
    expect(plan.ships).toHaveLength(2);
    const first = decideAccepted(state);
    expect(first).toEqual({ type: 'build.ship', edge: plan.ships![0] });

    // 船依序造好，抵達後蓋聚落。
    const built = act(state, 'p1', first as Command).state;
    const second = decideAccepted(built);
    const next = islandPlans(turnOf(built)).find((candidate) => candidate.vertex === plan.vertex);
    expect(second).toEqual({ type: 'build.ship', edge: next!.ships![0] });
    const arrived = act(built, 'p1', second as Command).state;
    const settle1 = decideAccepted(arrived);
    expect(settle1).toEqual({ type: 'build.settlement', vertex: plan.vertex });
    expect(viewOf(arrived, 'p1').hints!.legalSettlements).toContain(plan.vertex);
  });

  it('answers undefined for plans of other kinds and null when the step is no longer legal', () => {
    const state = k3Game({ lumber: 3, wool: 3, brick: 1, grain: 1 });
    const turn = turnOf(state);
    const plan = islandPlans(turn)[0]!;
    const city = turn.economy.plans.find((candidate) => candidate.kind === 'city') ?? { ...plan, kind: 'city' as const };
    expect(seafarersPlanStep(turn, city)).toBeUndefined();
    expect(seafarersPlanStep(turn, { ...plan, kind: 'settlement' })).toBeUndefined();
    // 下一艘船不在 legalShips（例如被海盜或存量擋住）：回 null，由骨架繼續處理其他計畫。
    expect(seafarersPlanStep(turn, { ...plan, ships: [illegalShipEdge(state)] })).toBeNull();
    // 已經抵達、但這個路口不是合法的聚落位置：回 null。
    expect(seafarersPlanStep(turn, { ...plan, ships: [], vertex: ring(state).k3 })).toBeNull();
  });

  it('never builds a settlement without a settlement left (legalSettlements ignores the stock)', () => {
    const state = k3Game({ lumber: 1, brick: 1, wool: 1, grain: 1 });
    const r = ring(state);
    ship(state, 'p1', r.NW);
    ship(state, 'p1', r.NE);
    expect(decideAccepted(state)).toEqual({ type: 'build.settlement', vertex: r.k5 });
    // 聚落用完（4 座在別處）：不再送 build.settlement；legalSettlements 仍列出 k5，送出會被拒絕。
    const spots = [corner(state, -3, 3, 2), corner(state, -3, 1, 2), corner(state, -2, 3, 2), corner(state, -1, 3, 2)];
    for (const vertex of spots) settle(state, 'p1', vertex);
    expect(viewOf(state, 'p1').hints!.legalSettlements).toContain(r.k5);
    const outcome = applyCommand(state, 'p1', { type: 'build.settlement', vertex: r.k5 }, seededRng(1));
    expect(outcome.ok ? 'ok' : outcome.error.code).toBe('E_NO_PIECES');
    expect(islandPlans(turnOf(state))).toEqual([]);
    const command = decide(state);
    expect(command).not.toEqual({ type: 'build.settlement', vertex: r.k5 });
    expectAccepted(state, 'p1', command);
  });
});

/** 一條一定不在 legalShips 的邊（陸地內側的邊）。 */
function illegalShipEdge(state: GameState): number {
  const legal = new Set(modulesHintsOf(state).legalShips);
  const edge = state.board.roads.findIndex((_, index) => !legal.has(index));
  return edge;
}

// ---------------------------------------------------------------------------
// 移船
// ---------------------------------------------------------------------------

/** p1 在 k3 有聚落與一條 NW、NE 的船鏈；p2 在 k5：船鏈的尖端是死路，NE 不在任何計畫路徑上。 */
function deadEndGame(): GameState {
  const state = k3Game({ lumber: 2, wool: 2 });
  const r = ring(state);
  ship(state, 'p1', r.NW);
  ship(state, 'p1', r.NE);
  settle(state, 'p2', r.k5);
  return state;
}

describe('ship.move', () => {
  it('moves a ship that is on no plan path to the next edge of the best plan', () => {
    const state = deadEndGame();
    const r = ring(state);
    const sea = modulesHintsOf(state);
    expect(sea.movableShips).toEqual([{ edge: r.NE, targets: expect.arrayContaining([sea.legalShips[0]!]) }]);
    const plan = islandPlans(turnOf(state)).find((candidate) => (candidate.ships?.length ?? 0) > 0)!;
    expect(plan).toBeDefined();
    const candidates = seafarersActions(turnOf(state));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.item).toEqual({ type: 'ship.move', from: r.NE, to: plan.ships![0] });
    // from 與 to 只取自 hints.movableShips。
    const movable = sea.movableShips.find((entry) => entry.edge === r.NE)!;
    expect(movable.targets).toContain(plan.ships![0]);

    const command = decideAccepted(state);
    expect(command).toEqual({ type: 'ship.move', from: r.NE, to: plan.ships![0] });
    // 移完之後，同一個目標少一艘船。
    const moved = act(state, 'p1', command as Command).state;
    const after = islandPlans(turnOf(moved)).find((candidate) => candidate.vertex === plan.vertex)!;
    expect(after.ships).toHaveLength(plan.ships!.length - 1);
    // 一個視窗只能移一次：之後不再送 ship.move。
    expect(seafarersActions(turnOf(moved))).toEqual([]);
    expect(decide(moved)).not.toMatchObject({ type: 'ship.move' });
  });

  it('easy never moves ships', () => {
    const state = deadEndGame();
    expect(seafarersActions(turnOf(state, 'easy'))).toEqual([]);
    for (let seed = 1; seed <= 12; seed++) {
      const command = decideAccepted(state, 'easy', 'p1', seed);
      expect(command.type, `seed ${seed}`).not.toBe('ship.move');
    }
  });

  it('keeps a ship that is on the path of a plan', () => {
    const state = k3Game({ lumber: 2, wool: 2 });
    const r = ring(state);
    ship(state, 'p1', r.NW);
    ship(state, 'p1', r.NE);
    // NE 是尖端、也可以移動，但最近的計畫就是從它的尖端接下去。
    expect(modulesHintsOf(state).movableShips.map((entry) => entry.edge)).toEqual([r.NE]);
    expect(seafarersActions(turnOf(state))).toEqual([]);
    expect(decideAccepted(state).type).not.toBe('ship.move');
  });

  it('does not move a ship built this window', () => {
    const state = k3Game({ lumber: 3, wool: 3, brick: 1, grain: 1 });
    const built = act(state, 'p1', decideAccepted(state) as Command).state;
    expect(modulesHintsOf(built).movableShips).toEqual([]);
    expect(seafarersActions(turnOf(built))).toEqual([]);
  });

  it('ship circles: any ship.move stays inside hints.movableShips (D-SF6, SF-FAQ 18)', () => {
    // 沒有建築的船圈：SF25 p. 2 下沒有任何船有開放端，movableShips 為空，所以策略不能送 ship.move。
    const circle = emptySeafarersGame(4, 0, 'action');
    const r = ring(circle);
    for (const edge of [r.NW, r.NE, r.E, r.SE, r.SW, r.W]) ship(circle, 'p1', edge);
    setHand(circle, 'p1', { lumber: 2, wool: 2, brick: 1, grain: 1 });
    expect(modulesHintsOf(circle).movableShips).toEqual([]);
    for (const [name, policy, level, seed] of POLICIES) {
      const command = policy.decide(viewOf(circle, 'p1'), ctxFor('p1', level, seed));
      expect(command?.type, name).not.toBe('ship.move');
      if (command) expectAccepted(circle, 'p1', command);
    }

    // 兩端各有自己建築的船路加上一條分支（rules 的 SF-FAQ 14 盤面）：只有分支能動。
    const closed = emptySeafarersGame(4, 0, 'action');
    const c = ring(closed);
    settle(closed, 'p1', c.k3);
    settle(closed, 'p1', c.k1);
    for (const edge of [c.NW, c.NE, c.E, c.SE]) ship(closed, 'p1', edge);
    settle(closed, 'p2', c.k5);
    const branch = side(closed, 2, -1, 0);
    ship(closed, 'p1', branch);
    setHand(closed, 'p1', { lumber: 2, wool: 2, brick: 1, grain: 1 });
    const sea = modulesHintsOf(closed);
    expect(sea.movableShips.map((entry) => entry.edge)).toEqual([branch]);
    for (const [name, policy, level, seed] of POLICIES) {
      const command = policy.decide(viewOf(closed, 'p1'), ctxFor('p1', level, seed));
      expect(command, name).not.toBeNull();
      expectAccepted(closed, 'p1', command);
      if (command?.type === 'ship.move') {
        const move = command as unknown as { from: number; to: number };
        const entry = sea.movableShips.find((candidate) => candidate.edge === move.from);
        expect(entry, `${name}: from ${move.from} is movable`).toBeDefined();
        expect(entry!.targets, `${name}: to ${move.to} is a target`).toContain(move.to);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 免費路線（Road Building）
// ---------------------------------------------------------------------------

function playRoadBuilding(state: GameState): GameState {
  state.players[0]!.devCards = ['roadBuilding'];
  return act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
}

describe('free routes', () => {
  it('builds the next ship of the best plan, not just the first legal ship', () => {
    // k2 的 legalShips 是 [83, 85]；最佳計畫從 85 開始。
    const state = emptySeafarersGame(4, 0, 'action');
    settle(state, 'p1', ring(state).k2);
    setHand(state, 'p1', { lumber: 2, brick: 2, wool: 1, grain: 1 });
    const played = playRoadBuilding(state);
    const view = viewOf(played, 'p1');
    expect(view.pending).toMatchObject({ kind: 'freeRoads', actor: 'p1' });
    const sea = moduleHints(view.hints, 'seafarers')!;
    const best = islandPlans(turnOf(played))[0]!;
    expect(best.ships![0]).not.toBe(sea.legalShips[0]);
    const command = decideAccepted(played);
    expect(command).toEqual({ type: 'build.ship', edge: best.ships![0] });
    // 只有 base 的策略會挑道路。
    const baseOnly = createBotPolicy('standard', { modules: [] }).decide(view, ctxFor('p1'));
    expect(baseOnly?.type).toBe('build.road');
  });

  it('builds the next road of the best plan when that plan is a road', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    const r = ring(state);
    settle(state, 'p1', r.k3);
    road(state, 'p1', r.W);
    setHand(state, 'p1', { lumber: 2, brick: 2, wool: 1, grain: 1 });
    const played = playRoadBuilding(state);
    const turn = turnOf(played);
    const best = turn.economy.plans[0]!;
    expect(best.kind).toBe('settlement');
    expect(best.roads).toHaveLength(1);
    const view = viewOf(played, 'p1');
    expect(moduleHints(view.hints, 'seafarers')!.legalShips.length).toBeGreaterThan(0);
    // 候選同時含船與路，SF 的候選取代 base 的選路。
    const candidates = seafarersFreeRouteCandidates(turn);
    expect(candidates.some((candidate) => candidate.item.type === 'build.ship')).toBe(true);
    expect(candidates.some((candidate) => candidate.item.type === 'build.road')).toBe(true);
    expect(decideAccepted(played)).toEqual({ type: 'build.road', edge: best.roads[0] });
  });

  it('without sea edges the candidates are roads only and match the base choice', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    settle(state, 'p1', corner(state, 0, 0, 1));
    setHand(state, 'p1', { lumber: 2, brick: 2, wool: 1, grain: 1 });
    const played = playRoadBuilding(state);
    const view = viewOf(played, 'p1');
    expect(moduleHints(view.hints, 'seafarers')!.legalShips).toEqual([]);
    const candidates = seafarersFreeRouteCandidates(turnOf(played));
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.item.type === 'build.road')).toBe(true);
    const baseOnly = createBotPolicy('standard', { modules: [] }).decide(view, ctxFor('p1'));
    expect(decideAccepted(played)).toEqual(baseOnly);
  });

  it('never offers a road once the road supply ran out (legalRoads ignores the stock)', () => {
    const state = k3Game({ lumber: 2, wool: 2 });
    fillRoads(state, 'p1', 15);
    const played = playRoadBuilding(state);
    const view = viewOf(played, 'p1');
    expect(view.hints!.legalRoads.length).toBeGreaterThan(0);
    const candidates = seafarersFreeRouteCandidates(turnOf(played));
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.item.type === 'build.ship')).toBe(true);
    expect(decideAccepted(played).type).toBe('build.ship');
  });

  it('easy picks among the best 3 candidates, standard always the best', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    settle(state, 'p1', ring(state).k2);
    setHand(state, 'p1', { lumber: 2, brick: 2, wool: 1, grain: 1 });
    const played = playRoadBuilding(state);
    const candidates = seafarersFreeRouteCandidates(turnOf(played)).slice().sort((a, b) => b.score - a.score);
    expect(candidates.length).toBeGreaterThan(3);
    const top3 = candidates.slice(0, 3).map((candidate) => candidate.item);
    const standard = decide(played, 'standard');
    expect(standard).toEqual(candidates[0]!.item);
    const picked = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const command = decideAccepted(played, 'easy', 'p1', seed);
      expect(top3, `seed ${seed}`).toContainEqual(command);
      picked.add(JSON.stringify(command));
    }
    expect(picked.size).toBeGreaterThan(1);
  });

  it('gives no candidates outside the actor\'s own Road Building or action window', () => {
    const state = emptySeafarersGame(4, 1, 'action');
    settle(state, 'p1', ring(state).k3);
    // 不是 p1 的回合。
    expect(seafarersFreeRouteCandidates(turnOf(state))).toEqual([]);
    // preroll。
    const preroll = emptySeafarersGame(4, 0, 'preroll');
    settle(preroll, 'p1', ring(preroll).k3);
    expect(seafarersFreeRouteCandidates(turnOf(preroll))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F9：道路用完時以船打出 Road Building
// ---------------------------------------------------------------------------

describe('F9: Road Building with ships once the road supply ran out', () => {
  function f9(): GameState {
    const state = k3Game({ lumber: 2, wool: 2 });
    fillRoads(state, 'p1', 15);
    state.players[0]!.devCards = ['roadBuilding'];
    return state;
  }

  it('standard and easy play the card for the ships, the fallback does not', () => {
    const state = f9();
    const view = viewOf(state, 'p1');
    expect(view.hints!.legalRoads.length).toBeGreaterThan(0);
    expect(modulesHintsOf(state).legalShips.length).toBeGreaterThan(0);
    const [fallback, standard, easy1, easy2] = everyPolicy(state, 'p1');
    expect(standard).toEqual({ type: 'dev.playRoadBuilding' });
    expect(easy1).toEqual({ type: 'dev.playRoadBuilding' });
    expect(easy2).toEqual({ type: 'dev.playRoadBuilding' });
    expect(fallback).toEqual({ type: 'turn.end' });
    // base 的條件（道路存量 ≥ 1）不成立：只有 SF 的候選讓它打出。
    expect(createBotPolicy('standard', { modules: [] }).decide(view, ctxFor('p1'))).not.toEqual({ type: 'dev.playRoadBuilding' });
  });

  it('inside the effect every policy builds ships, never the road that would be refused', () => {
    const played = playRoadBuilding(f9());
    for (const command of everyPolicy(played, 'p1')) expect(command.type).toBe('build.ship');
    const road0 = viewOf(played, 'p1').hints!.legalRoads[0]!;
    const refused = applyCommand(played, 'p1', { type: 'build.road', edge: road0 }, seededRng(1));
    expect(refused.ok ? 'ok' : refused.error.code).toBe('E_NO_PIECES');
  });

  it('plays the whole card through to the end of the effect', () => {
    let state = f9();
    const first = decideAccepted(state);
    expect(first).toEqual({ type: 'dev.playRoadBuilding' });
    state = act(state, 'p1', first as Command).state;
    let ships = 0;
    for (let step = 0; step < 4 && viewOf(state, 'p1').pending?.kind === 'freeRoads'; step++) {
      const command = decideAccepted(state);
      expect(command.type).toBe('build.ship');
      state = act(state, 'p1', command as Command).state;
      ships += 1;
    }
    expect(ships).toBe(2);
    expect(viewOf(state, 'p1').pending).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 交易
// ---------------------------------------------------------------------------

describe('trade', () => {
  it('trades with the bank toward the next ship', () => {
    // 7 張木材（外加磚、穀各 1）、沒有羊毛：計畫的下一步是一艘船（木材 + 羊毛）；扣掉整個計畫要用的 3 張木材，
    // 剩 4 張過剩，4:1 換一張羊毛。
    const state = k3Game({ lumber: 7, brick: 1, grain: 1 });
    const turn = turnOf(state);
    expect(turn.economy.plans[0]!.kind).toBe(ISLAND_SETTLEMENT);
    expect(turn.economy.plans[0]!.nextCost).toEqual(SHIP_COST);
    expect(decideAccepted(state)).toEqual({ type: 'trade.bank', give: 'lumber', receive: 'wool' });
    expect(turn.economy.plans[0]!.nextCost).toEqual(turn.economy.costs['ship']);
  });

  it('offers a trade when only the settlement is missing, standard only', () => {
    // 船已到 k5，聚落缺 1 張穀物：立即得分的計畫，standard 對全桌開價，easy 不開。
    const state = k3Game({ lumber: 1, brick: 1, wool: 1, ore: 2 });
    const r = ring(state);
    ship(state, 'p1', r.NW);
    ship(state, 'p1', r.NE);
    setHand(state, 'p2', { grain: 2 });
    const turn = turnOf(state);
    expect(turn.economy.plans[0]).toMatchObject({ kind: ISLAND_SETTLEMENT, vertex: r.k5, immediate: true });
    const offer = decideAccepted(state);
    expect(offer).toEqual({ type: 'trade.offer', to: 'all', give: { ore: 1 }, want: { grain: 1 } });
    expect(decideAccepted(state, 'easy')).toEqual({ type: 'turn.end' });
    // 同一個局面但還差一艘船：不是立即得分，不開價。
    const further = k3Game({ lumber: 1, brick: 1, wool: 1, ore: 2 });
    setHand(further, 'p2', { grain: 2 });
    expect(decideAccepted(further).type).not.toBe('trade.offer');
  });
});

// ---------------------------------------------------------------------------
// F8：6 人 paired 的 Player 2
// ---------------------------------------------------------------------------

describe('F8: paired Player 2 (6 players)', () => {
  /** 6 人地圖：主島西岸的角 (-2,1)#3 是海岸；p1 在這裡。pairedActor 2 = 這個視窗是 P2。 */
  function paired(actor: 1 | 2 = 2): GameState {
    const state = emptySeafarersGame(6, 0, 'action');
    state.turn.pairedActor = actor;
    return state;
  }
  const origin = (state: GameState) => corner(state, -2, 1, 3);

  it('builds a ship in its window', () => {
    const state = paired();
    settle(state, 'p1', origin(state));
    setHand(state, 'p1', { lumber: 2, wool: 2 });
    expect(turnOf(state).pairedSecond).toBe(true);
    const commands = everyPolicy(state, 'p1');
    expect(commands[0]).toEqual({ type: 'turn.end' });
    for (const command of commands.slice(1)) expect(command.type).toBe('build.ship');
  });

  it('moves a ship in its window', () => {
    // 船 98 的尖端 70 被海盜擋成死路（海格 (-3,0)），最佳計畫改走 125。
    const state = paired();
    settle(state, 'p1', origin(state));
    ship(state, 'p1', 98);
    setHand(state, 'p1', { lumber: 2, wool: 2 });
    state.board.pirate = getTopology(state.board.layout.topologyId).vertices[70]!.hexes.find(
      (hex) => !getTopology(state.board.layout.topologyId).edges[98]!.hexes.includes(hex),
    )!;
    const sea = modulesHintsOf(state);
    expect(sea.movableShips).toEqual([{ edge: 98, targets: [125] }]);
    const commands = everyPolicy(state, 'p1');
    expect(commands[0]).toEqual({ type: 'turn.end' });
    expect(commands[1]).toEqual({ type: 'ship.move', from: 98, to: 125 });
    // easy 不移船，改造船。
    expect(commands[2]!.type).toBe('build.ship');
    expect(commands[3]!.type).toBe('build.ship');
  });

  it('makes no offer as Player 2, while Player 1 offers in the same position', () => {
    for (const [actor, expected] of [[1, 'trade.offer'], [2, 'turn.end']] as const) {
      const state = paired(actor);
      const o = origin(state);
      settle(state, 'p1', o);
      ship(state, 'p1', 98);
      ship(state, 'p1', 93);
      setHand(state, 'p1', { lumber: 1, brick: 1, wool: 1, ore: 2 });
      setHand(state, 'p2', { grain: 2 });
      const turn = turnOf(state);
      expect(turn.pairedSecond).toBe(actor === 2);
      expect(turn.economy.plans[0]).toMatchObject({ kind: ISLAND_SETTLEMENT, immediate: true });
      const command = decideAccepted(state);
      expect(command.type, `pairedActor ${actor}`).toBe(expected);
    }
  });
});
