/**
 * SF-2b：frame、強盜與 setup（SF 計畫 §4.2、§6.1）。
 *
 * - 每個策略鉤子都有決策測試：`answerFrame`（gold）、`banditCandidates`、`preroll`、`setup`（建築與路／船）。
 * - I9 固定盤面 F1–F7 以 standard 與 easy 各跑一次，每個送出的指令都必須被 `applyCommand` 接受。
 * - responder 資格：gold frame 只有 `responders[0]` 作答。
 * - B-FAIR：投影相同、隱藏資訊不同，決策必須相同；決策不得修改傳入的投影。
 *
 * 盤面用 rules 的 `seafarers-helpers` 直接建構，不使用 harness。4 人 New Shores 是固定盤面：
 * 主島在西側，(2,0) 是主島東側的海格，島 3（兩塊金礦）在它的東邊，(2,-1) 是它北邊的海格。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  projectGame,
  seededRng,
  type Command,
  type GameState,
  type GameView,
  type PublicModulePendingView,
  type Resource,
} from '@catan/rules';
import { act, scriptedRng } from '../../rules/test/helpers.ts';
import { corner, emptySeafarersGame, hex, road, seafarersGame, settle, ship, side } from '../../rules/test/seafarers-helpers.ts';
import { roadDirectionScore } from '../src/base/roads.ts';
import { setupSpotScore } from '../src/base/setup.ts';
import { boardModel } from '../src/board.ts';
import { heuristicPolicy, turnContext } from '../src/heuristic.ts';
import { seafarersBanditCandidates, seafarersPreroll } from '../src/modules/seafarers/bandit.ts';
import { seafarersAnswerFrame } from '../src/modules/seafarers/frames.ts';
import { ISLAND_VP_VALUE, islandSetupBonus, islandSites, setupShipScore, shipDiscount } from '../src/modules/seafarers/setup.ts';
import type { TurnContext } from '../src/modules/types.ts';
import { moduleHints } from '../src/modules/view.ts';
import { botOwesAction } from '../src/fallback.ts';
import { searchShips } from '../src/sea.ts';
import type { BotCommand, BotContext, BotLevel } from '../src/types.ts';
import { cloneState, hideDifferently, viewFor } from './harness.ts';

const TEN = () => scriptedRng([3, 5]); // 4 + 6：金礦 (3,0)
const SEVEN = () => scriptedRng([2, 3]); // 3 + 4

const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 1): BotContext => ({
  selfId,
  level,
  seed,
  offerPhases: {},
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

/** standard 一次，easy 兩個種子：easy 的挑選會消耗亂數，種子不同時結果可以不同。 */
const RUNS: readonly (readonly [string, BotLevel, number])[] = [
  ['standard', 'standard', 1],
  ['easy#1', 'easy', 1],
  ['easy#2', 'easy', 2],
];

function decide(state: GameState, actor: string, level: BotLevel, seed = 1): BotCommand | null {
  return heuristicPolicy(level).decide(viewOf(state, actor), ctxFor(actor, level, seed));
}

/** 指令必須被引擎接受。 */
function expectAccepted(state: GameState, actor: string, command: BotCommand | null | undefined): void {
  expect(command, `${actor} has a command`).not.toBeNull();
  const outcome = applyCommand(state, actor, command as Command, seededRng(1));
  expect(outcome.ok, `${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
}

/** standard 與 easy（兩個種子）在這個盤面上都送出被接受的指令；回傳各策略的指令。 */
function expectEveryRunMoves(state: GameState, actor: string): BotCommand[] {
  return RUNS.map(([name, level, seed]) => {
    const command = decide(state, actor, level, seed);
    expect(command, `${name} must not stall`).not.toBeNull();
    expectAccepted(state, actor, command);
    return command!;
  });
}

/** 讓每位玩家都有不同的手牌與發展卡，B-FAIR 才有隱藏資訊可以換。 */
function stockHands(state: GameState): void {
  const hands: Record<Resource, number>[] = [
    { lumber: 1, brick: 0, wool: 2, grain: 1, ore: 0 },
    { lumber: 0, brick: 3, wool: 0, grain: 0, ore: 2 },
    { lumber: 2, brick: 0, wool: 1, grain: 2, ore: 0 },
    { lumber: 0, brick: 1, wool: 0, grain: 1, ore: 3 },
  ];
  state.players.forEach((player, index) => {
    player.resources = { ...hands[index % hands.length]! };
  });
}

/** 玩家的手牌（其餘為 0）。 */
function giveHand(state: GameState, playerId: string, hand: Partial<Record<Resource, number>>): void {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  player.resources = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, ...hand };
}

const isSea = (view: GameView, hexIndex: number | null): boolean => hexIndex !== null && view.board.terrain[hexIndex] === 'sea';

// ---------------------------------------------------------------------------
// 共用盤面
// ---------------------------------------------------------------------------

/** 在 (3,0)（金礦、點數 10）旁放建築，由 `roller` 擲出 10。 */
function goldRoll(roller: string, build: (state: GameState) => void): GameState {
  const seat = Number(roller.slice(1)) - 1;
  const state = emptySeafarersGame(4, seat, 'preroll');
  build(state);
  return act(state, roller, { type: 'turn.roll' }, TEN()).state;
}

const gold = (state: GameState, k: number) => corner(state, 3, 0, k);

/** k3 是主島的海岸路口：它的三條邊是 NW（海邊）、W 與 E1（沿岸，可蓋路）。 */
function k3Edges(state: GameState) {
  return { k3: corner(state, 2, 0, 3), NW: side(state, 2, 0, 2), W: side(state, 2, 0, 3), E1: side(state, 1, 0, 1) };
}

/** p1 的聚落在 k3、手上有 Road Building；`blockLand` 為真時 k3 的兩條陸路被別人的道路占住。 */
function roadBuildingGame(blockLand: boolean): GameState {
  const state = emptySeafarersGame(4, 0, 'action');
  const e = k3Edges(state);
  settle(state, 'p1', e.k3);
  if (blockLand) {
    road(state, 'p2', e.W);
    road(state, 'p2', e.E1);
  }
  return state;
}

function playRoadBuilding(state: GameState): GameState {
  state.players[0]!.devCards = ['roadBuilding'];
  return act(state, 'p1', { type: 'dev.playRoadBuilding' }).state;
}

/** 把玩家的船補到 `count` 艘（不鄰接陸地的海邊，避開 (2,0) 一帶）。 */
function fillShips(state: GameState, playerId: string, count: number): void {
  const near = new Set<number>();
  for (const n of [0, 1, 2, 3, 4, 5]) near.add(corner(state, 2, 0, n));
  const model = boardModel(viewOf(state, playerId), playerId);
  const edges = model.topo.edges.flatMap((info, edge) => {
    if (state.board.roads[edge] || info.vertices.some((vertex) => near.has(vertex))) return [];
    return info.hexes.every((h) => !model.hexLand[h]) ? [edge] : [];
  });
  expect(edges.length).toBeGreaterThanOrEqual(count);
  for (const edge of edges.slice(0, count)) ship(state, playerId, edge);
}

/** 把玩家的道路補到 `count` 條（主島西側的陸地邊）。 */
function fillRoads(state: GameState, playerId: string, count: number): void {
  const near = new Set<number>();
  for (const n of [0, 1, 2, 3, 4, 5]) near.add(corner(state, 2, 0, n));
  const model = boardModel(viewOf(state, playerId), playerId);
  const edges = model.topo.edges.flatMap((info, edge) => {
    if (state.board.roads[edge] || info.vertices.some((vertex) => near.has(vertex)) || info.x > 0) return [];
    return info.hexes.filter((h) => model.hexLand[h]).length === 2 ? [edge] : [];
  });
  expect(edges.length).toBeGreaterThanOrEqual(count);
  for (const edge of edges.slice(0, count)) road(state, playerId, edge);
}

/**
 * 海盜擋路的盤面：p1 的聚落在 (1,0) 的東北角（A），到島 3 金礦邊的空點（(2,0) 的 corner 5，
 * 簡稱 S）只要沿 (2,0) 的 NW、NE 兩條邊各一艘船；海盜在 (2,0) 時，這兩條邊都不能放，
 * 最短的繞路要 4 艘。
 */
function blockedRoute(phase: 'preroll' | 'action' = 'preroll', pirate: 'blocking' | 'frame' = 'blocking') {
  const state = emptySeafarersGame(4, 0, phase);
  const a = corner(state, 1, 0, 5);
  const s = corner(state, 2, 0, 5);
  settle(state, 'p1', a);
  state.board.pirate = pirate === 'blocking' ? hex(state, 2, 0) : null;
  state.players[0]!.devCards = ['knight'];
  return { state, a, s, sea: hex(state, 2, 0) };
}

/** p1 到 S 還需要幾艘船（到不了為 Infinity）。 */
function shipsToSite(state: GameState, s: number): number {
  return searchShips(boardModel(viewOf(state, 'p1'), 'p1'), 'p1', 6).distance[s]!;
}

// ===========================================================================
// answerFrame：seafarers.gold
// ===========================================================================

describe('answerFrame: seafarers.gold', () => {
  /** p2 的城市在金礦上（欠 2 張），擲骰者 p1；p2 的計畫是把聚落升城市，缺 3 張礦。 */
  function goldForCityPlan() {
    return goldRoll('p1', (state) => {
      settle(state, 'p2', gold(state, 0), true);
      settle(state, 'p2', corner(state, 0, 0, 0)); // 一座聚落：下一個計畫是升城市
      giveHand(state, 'p2', { grain: 2 });
    });
  }

  it('picks what the best plan misses, as many as goldRequired', () => {
    const state = goldForCityPlan();
    const view = viewOf(state, 'p2');
    expect(view.pending).toMatchObject({ kind: 'seafarers.gold', responders: ['p2'] });
    expect(moduleHints(view.hints, 'seafarers')?.goldRequired).toBe(2);
    for (const [name, level, seed] of RUNS) {
      const command = decide(state, 'p2', level, seed);
      expect(command, name).toEqual({ type: 'gold.choose', resources: ['ore', 'ore'] });
      expectAccepted(state, 'p2', command);
    }
  });

  it('never takes more of a resource than the bank holds', () => {
    // 銀行只剩 1 張礦、1 張羊毛：欠 3 張時湊成 min(欠額, 銀行總數) = 2 張，每種各 1。
    const state = goldRoll('p1', (s) => {
      settle(s, 'p2', gold(s, 0), true);
      settle(s, 'p2', gold(s, 2));
      s.bank = { lumber: 0, brick: 0, wool: 1, grain: 0, ore: 1 };
    });
    const view = viewOf(state, 'p2');
    expect(moduleHints(view.hints, 'seafarers')?.goldRequired).toBe(2);
    for (const command of expectEveryRunMoves(state, 'p2')) {
      const resources = (command as { resources: Resource[] }).resources.slice().sort();
      expect(resources).toEqual(['ore', 'wool']);
    }
    // 直接問策略（而不是經過 decide 與保底）：張數取自 hints 的 goldRequired（2），不是 frame 的欠額（3）。
    const frame = view.pending as PublicModulePendingView;
    expect((frame.data as { picks: Record<string, number> }).picks.p2).toBe(3);
    const turn = turnContext(view, ctxFor('p2'), 'standard');
    expect(seafarersAnswerFrame(turn, frame)).toEqual({ type: 'gold.choose', resources: ['wool', 'ore'] });
  });

  it('re-checks what the plan misses after every pick', () => {
    // 升城市的計畫缺 1 張穀物與 1 張礦：第一張補其中一種之後，缺口隨之縮小，第二張要補另一種。
    const state = goldRoll('p1', (s) => {
      settle(s, 'p2', gold(s, 0), true);
      settle(s, 'p2', corner(s, 0, 0, 0));
      giveHand(s, 'p2', { grain: 1, ore: 2 });
      s.devDeck = []; // 沒有發展卡可買：最近的計畫就是升城市
    });
    expect(moduleHints(viewOf(state, 'p2').hints, 'seafarers')?.goldRequired).toBe(2);
    for (const [name, level, seed] of RUNS) {
      const command = decide(state, 'p2', level, seed);
      expect(command, name).toEqual({ type: 'gold.choose', resources: ['grain', 'ore'] });
      expectAccepted(state, 'p2', command);
    }
  });

  it('with a one-card bank takes that card', () => {
    const state = goldRoll('p1', (s) => {
      settle(s, 'p2', gold(s, 0), true);
      s.bank = { lumber: 0, brick: 0, wool: 0, grain: 1, ore: 0 };
    });
    for (const command of expectEveryRunMoves(state, 'p2')) {
      expect(command).toEqual({ type: 'gold.choose', resources: ['grain'] });
    }
  });

  it('only the first responder answers; the others stay silent until it is their turn', () => {
    // p4 擲骰且沒有金礦；順序 p4、p1、p2，所以 responders 是 [p1, p2]。
    const state = goldRoll('p4', (s) => {
      settle(s, 'p1', gold(s, 0));
      settle(s, 'p2', gold(s, 2));
    });
    expect(viewOf(state, 'p1').pending).toMatchObject({ kind: 'seafarers.gold', responders: ['p1', 'p2'] });
    expectEveryRunMoves(state, 'p1');
    for (const [name, level, seed] of RUNS) {
      expect(decide(state, 'p2', level, seed), `${name} second responder`).toBeNull();
      expect(decide(state, 'p4', level, seed), `${name} roller without gold`).toBeNull();
      expect(decide(state, 'p3', level, seed), `${name} bystander`).toBeNull();
    }
    const first = decide(state, 'p1', 'standard') as Command;
    const next = act(state, 'p1', first).state;
    expect(viewOf(next, 'p2').pending).toMatchObject({ responders: ['p2'] });
    expectEveryRunMoves(next, 'p2');
  });

  it('answers only its own frame, and leaves what it cannot decide to the duty', () => {
    const state = goldForCityPlan();
    const view = viewOf(state, 'p2');
    const turn = turnContext(view, ctxFor('p2'), 'standard');
    const frame = view.pending as PublicModulePendingView;
    expect(seafarersAnswerFrame(turn, frame)).toEqual({ type: 'gold.choose', resources: ['ore', 'ore'] });
    // 別的模組的 frame：不歸 SF 管。
    expect(seafarersAnswerFrame(turn, { ...frame, kind: 'citiesKnights.barbarians', module: 'citiesKnights' })).toBeUndefined();
    // 輪不到自己：歸 SF 管，但這次沒有動作。
    expect(seafarersAnswerFrame(turn, { ...frame, responders: ['p1', 'p2'] })).toBeNull();
    // 沒有 hints 就不知道欠幾張：不猜，回 null 交給保底。
    const bare = turnContext({ ...clone(view), hints: undefined }, ctxFor('p2'), 'standard');
    expect(seafarersAnswerFrame(bare, frame)).toBeNull();
    // 銀行已經拿光、湊不滿：不送必定被拒絕的指令。
    const drained = clone(view);
    drained.bank = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    expect(seafarersAnswerFrame(turnContext(drained, ctxFor('p2'), 'standard'), frame)).toBeNull();
  });

  it('the answer is deterministic and does not touch the rng', () => {
    const view = viewOf(goldForCityPlan(), 'p2');
    const frame = view.pending as PublicModulePendingView;
    for (const level of ['standard', 'easy'] as const) {
      const turn = turnContext(view, ctxFor('p2', level, 9), level);
      const first = seafarersAnswerFrame(turn, frame);
      expect(seafarersAnswerFrame(turn, frame)).toEqual(first);
      expect(turn.rng.int(1000)).toBe(seededRng(9).int(1000));
    }
  });
});

// ===========================================================================
// preroll：海盜擋住航線時打騎士
// ===========================================================================

describe('preroll: the knight moves a pirate that blocks the planned route', () => {
  it('standard plays the knight on the pirate and unblocks the route', () => {
    const { state, s } = blockedRoute();
    expect(shipsToSite(state, s)).toBeGreaterThan(3); // 被擋：最短的繞路要 4 艘
    const view = viewOf(state, 'p1');
    const command = heuristicPolicy('standard').decide(view, ctxFor('p1'));
    // 外框是最好的去處：沒有人在乎它，也不會擋住自己。
    expect(command).toEqual({ type: 'dev.playKnight', hex: null });
    const outcome = applyCommand(state, 'p1', command as Command, seededRng(1));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(shipsToSite(outcome.state, s)).toBe(2); // NW、NE 各一艘
  });

  it('the hook returns one candidate scored by what it frees', () => {
    const { state } = blockedRoute();
    const turn = turnContext(viewOf(state, 'p1'), ctxFor('p1'), 'standard');
    const candidates = seafarersPreroll(turn);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.item).toEqual({ type: 'dev.playKnight', hex: null });
    expect(candidates[0]!.score).toBeGreaterThan(5);
  });

  it('easy leaves the pirate alone (same as base)', () => {
    const { state } = blockedRoute();
    const turn = turnContext(viewOf(state, 'p1'), ctxFor('p1', 'easy'), 'easy');
    expect(seafarersPreroll(turn)).toEqual([]);
    expect(decide(state, 'p1', 'easy')).toEqual({ type: 'turn.roll' });
  });

  it('does nothing without a knight, without a blocking pirate, or without the pirate on the board', () => {
    const noKnight = blockedRoute();
    noKnight.state.players[0]!.devCards = [];
    expect(decide(noKnight.state, 'p1', 'standard')).toEqual({ type: 'turn.roll' });

    const far = blockedRoute();
    far.state.board.pirate = hex(far.state, 0, 3); // 與航線無關的海格
    expect(seafarersPreroll(turnContext(viewOf(far.state, 'p1'), ctxFor('p1'), 'standard'))).toEqual([]);
    expect(decide(far.state, 'p1', 'standard')).toEqual({ type: 'turn.roll' });

    const frame = blockedRoute('preroll', 'frame');
    expect(decide(frame.state, 'p1', 'standard')).toEqual({ type: 'turn.roll' });

    // 已經沒有船可造：航線不存在，海盜擋不住什麼。
    const noShips = blockedRoute();
    fillShips(noShips.state, 'p1', 15);
    expect(seafarersPreroll(turnContext(viewOf(noShips.state, 'p1'), ctxFor('p1'), 'standard'))).toEqual([]);
  });

  it('without ships left there is no route for the pirate to block', () => {
    const { state } = blockedRoute();
    const turn = turnContext(viewOf(state, 'p1'), ctxFor('p1'), 'standard');
    expect(seafarersPreroll(turn)).toHaveLength(1);
    // 同一個盤面，但這個座位的船已經用完（profile 的船數設成 0）：沒有船可造，海盜擋不住什麼。
    const spent = Object.create(turn, {
      model: { value: { ...turn.model, profile: { ...turn.model.profile, pieces: { ...turn.model.profile.pieces, ships: 0 } } } },
    }) as TurnContext;
    expect(seafarersPreroll(spent)).toEqual([]);
    expect(seafarersBanditCandidates(spent, 'knight').map((candidate) => candidate.item)).not.toContain(null);
  });

  it('never picks a hex that still blocks the route, even when it pays the most', () => {
    // 海盜在 (2,-1)，擋住直達的航線。p2 領先，船的開放端在 (2,0) 的 NE 邊：偷牌與封鎖前線都讓 (2,0)
    // 的分數最高，但放過去仍然擋住 p1，所以不能選；外框才是解除封鎖的移法。
    const { state, sea } = blockedRoute();
    state.board.pirate = hex(state, 2, -1);
    ship(state, 'p2', side(state, 2, 0, 1));
    giveHand(state, 'p2', { lumber: 3, brick: 3, wool: 2 });
    state.players[1]!.bonusPoints = 5;
    const view = viewOf(state, 'p1');
    const scores = seafarersBanditCandidates(turnContext(view, ctxFor('p1'), 'standard'), 'knight');
    const top = scores.reduce((a, b) => (b.score > a.score ? b : a));
    expect(top.item).toBe(sea);
    expect(heuristicPolicy('standard').decide(view, ctxFor('p1'))).toEqual({ type: 'dev.playKnight', hex: null });
  });

  it('plays the knight on the robber, not the pirate, when the robber presses my city', () => {
    // 強盜壓住自己的城市（(1,0) 點數 9），海盜同時擋路：移開強盜的收益遠大於解除海盜，
    // 所以是強盜被移走，海盜留在原處。
    const { state, sea } = blockedRoute();
    settle(state, 'p1', corner(state, 1, 0, 2), true);
    state.board.robber = hex(state, 1, 0);
    const view = viewOf(state, 'p1');
    const command = decide(state, 'p1', 'standard') as { type: string; hex: number | null };
    expect(command.type).toBe('dev.playKnight');
    expect(command.hex).not.toBeNull();
    expect(isSea(view, command.hex)).toBe(false);
    expect(command.hex).not.toBe(hex(state, 1, 0));
    const outcome = applyCommand(state, 'p1', command as Command, seededRng(1));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.state.board.robber).toBe(command.hex);
      expect(outcome.state.board.pirate).toBe(sea);
    }
    // 每個海盜候選都因為放棄移強盜而低於 0。
    const turn = turnContext(view, ctxFor('p1'), 'standard');
    for (const candidate of seafarersBanditCandidates(turn, 'knight')) expect(candidate.score).toBeLessThan(0);
  });

  it('does not consume the rng', () => {
    const { state } = blockedRoute();
    const turn = turnContext(viewOf(state, 'p1'), ctxFor('p1', 'standard', 5), 'standard');
    seafarersPreroll(turn);
    expect(turn.rng.int(1000)).toBe(seededRng(5).int(1000));
  });
});

// ===========================================================================
// banditCandidates：強盜與海盜一起評分
// ===========================================================================

describe('banditCandidates: robber and pirate scored together', () => {
  /** 7 點：p1 擲出 7，進入 moveRobber。 */
  function sevenOn(state: GameState): GameState {
    state.turn.phase = 'preroll';
    state.players[0]!.devCards = [];
    return act(state, 'p1', { type: 'turn.roll' }, SEVEN()).state;
  }

  /**
   * p2 的船在 (2,0) 與島 3 的金礦 (3,0) 之間（只有 (2,0) 一個海格可以偷到它），而且手上有牌；
   * 其他地方什麼也沒有。`withMyRoute` 為真時 p1 的聚落在 A，(2,0) 剛好在 p1 的航線上。
   */
  function raidable(withMyRoute: boolean) {
    const { state, ...rest } = blockedRoute('preroll', 'frame');
    if (!withMyRoute) state.board.buildings = state.board.buildings.map(() => null);
    ship(state, 'p2', side(state, 2, 0, 0));
    giveHand(state, 'p2', { lumber: 2, brick: 2, wool: 1 });
    return { state: sevenOn(state), ...rest };
  }

  it('moves the pirate to the frame when it blocks me and nothing is better', () => {
    const { state } = blockedRoute();
    const rolled = sevenOn(state);
    const view = viewOf(rolled, 'p1');
    expect(view.pending).toMatchObject({ kind: 'moveRobber', actor: 'p1', cause: 'seven' });
    const command = heuristicPolicy('standard').decide(view, ctxFor('p1'));
    expect(command).toEqual({ type: 'pending.moveRobber', hex: null });
    expectAccepted(rolled, 'p1', command);
  });

  it('easy only moves the robber', () => {
    const { state } = blockedRoute();
    const rolled = sevenOn(state);
    const view = viewOf(rolled, 'p1');
    for (const seed of [1, 2, 3, 4, 5]) {
      const command = heuristicPolicy('easy').decide(view, ctxFor('p1', 'easy', seed));
      expect(command).toMatchObject({ type: 'pending.moveRobber' });
      const target = (command as { hex: number | null }).hex;
      expect(target).not.toBeNull();
      expect(isSea(view, target)).toBe(false);
      expectAccepted(rolled, 'p1', command);
    }
    const turn = turnContext(view, ctxFor('p1', 'easy'), 'easy');
    expect(seafarersBanditCandidates(turn, 'seven')).toEqual([]);
  });

  it('a target that robs someone beats the frame', () => {
    const { state } = blockedRoute();
    ship(state, 'p2', side(state, 3, 1, 3)); // (3,1) 與 (2,1) 之間：離 p1 的航線很遠
    giveHand(state, 'p2', { lumber: 2, brick: 2, wool: 1 });
    const rolled = sevenOn(state);
    const view = viewOf(rolled, 'p1');
    const command = heuristicPolicy('standard').decide(view, ctxFor('p1')) as { type: string; hex: number | null };
    expect(command.type).toBe('pending.moveRobber');
    expect(isSea(view, command.hex)).toBe(true);
    // 離開 (2,0)：海盜不能再擋住自己；而且挑的是有人可偷的格子。
    const outcome = applyCommand(rolled, 'p1', command as Command, seededRng(1));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.state.pending).toMatchObject({ kind: 'steal', candidates: ['p2'] });
      expect(shipsToSite(outcome.state, corner(rolled, 2, 0, 5))).toBe(2);
    }
  });

  it('raids a rival when nothing of mine is in the way', () => {
    const { state, sea } = raidable(false);
    const view = viewOf(state, 'p1');
    const command = heuristicPolicy('standard').decide(view, ctxFor('p1')) as { type: string; hex: number | null };
    expect(command.type).toBe('pending.moveRobber');
    expect(command.hex).toBe(sea);
    const outcome = applyCommand(state, 'p1', command as Command, seededRng(1));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.state.pending).toMatchObject({ kind: 'steal', actor: 'p1', candidates: ['p2'] });
  });

  it('does not put the pirate on my own route to a rival', () => {
    // 與上一個案例相同的船，但這次 p1 的聚落在 A：(2,0) 在 p1 的航線上，放過去會擋住自己
    // （最短航線由 2 艘變 4 艘），扣掉的分數比偷牌多。pirate 改去只封鎖 p2 前線、不擋自己的 (2,1)。
    const { state, sea, s } = raidable(true);
    const view = viewOf(state, 'p1');
    const turn = turnContext(view, ctxFor('p1'), 'standard');
    const scores = new Map(seafarersBanditCandidates(turn, 'seven').map((candidate) => [candidate.item, candidate.score]));
    expect(scores.get(sea)).toBeLessThan(0);
    const command = heuristicPolicy('standard').decide(view, ctxFor('p1')) as { type: string; hex: number | null };
    expect(command.type).toBe('pending.moveRobber');
    expect(command.hex).toBe(hex(state, 2, 1));
    const outcome = applyCommand(state, 'p1', command as Command, seededRng(1));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(shipsToSite(outcome.state, s)).toBe(2);
  });

  it('a strong robber target outweighs the pirate', () => {
    const { state } = raidable(false);
    settle(state, 'p2', corner(state, 0, -1, 0), true); // p2 的城市在 (0,-1)（點數 6）
    state.pending = null;
    state.turn.phase = 'preroll';
    state.turn.seat = 0;
    const rolled = act(state, 'p1', { type: 'turn.roll' }, SEVEN()).state;
    const view = viewOf(rolled, 'p1');
    const command = heuristicPolicy('standard').decide(view, ctxFor('p1')) as { type: string; hex: number | null };
    expect(command.type).toBe('pending.moveRobber');
    expect(isSea(view, command.hex)).toBe(false);
    expect(command.hex).not.toBeNull();
    // 壓的是 p2 的城市所在的格子之一。
    const model = boardModel(view, 'p1');
    expect(model.hexVertices[command.hex!]).toContain(corner(state, 0, -1, 0));
    expectAccepted(rolled, 'p1', command);
  });

  it('moves the robber, not the pirate, when both block me and the robber costs more', () => {
    // M-2：p1 的城市在 (1,0)，強盜壓在上面（被擋 8 點），海盜同時擋住航線。
    // 反過來只有海盜擋路時，仍然移海盜：見上面的 frame 案例（強盜在沙漠，沒有壓住任何東西）。
    const { state } = blockedRoute();
    settle(state, 'p1', corner(state, 1, 0, 2), true);
    state.board.robber = hex(state, 1, 0);
    const rolled = sevenOn(state);
    const view = viewOf(rolled, 'p1');
    const command = heuristicPolicy('standard').decide(view, ctxFor('p1')) as { type: string; hex: number | null };
    expect(command.type).toBe('pending.moveRobber');
    expect(command.hex).not.toBeNull();
    expect(isSea(view, command.hex)).toBe(false);
    expect(command.hex).not.toBe(hex(state, 1, 0));
    expectAccepted(rolled, 'p1', command);
    // 外框仍是海盜中最好的，但放棄移強盜的收益之後，低於任何強盜目標（0）。
    const candidates = seafarersBanditCandidates(turnContext(view, ctxFor('p1'), 'standard'), 'seven');
    expect(candidates.at(-1)!.item).toBeNull();
    expect(candidates.at(-1)!.score).toBeLessThan(0);
  });

  it('keeps the robber where it already hurts a rival, and moves the pirate instead', () => {
    // 強盜壓著 p2 的城市：把它移走等於放掉這個收益，所以改移海盜（去哪裡都沒有損失）。
    const state = emptySeafarersGame(4, 0, 'preroll');
    settle(state, 'p2', corner(state, 0, -1, 0), true);
    state.board.robber = hex(state, 0, -1);
    const rolled = sevenOn(state);
    const view = viewOf(rolled, 'p1');
    const command = heuristicPolicy('standard').decide(view, ctxFor('p1')) as { type: string; hex: number | null };
    expect(command.type).toBe('pending.moveRobber');
    expect(isSea(view, command.hex)).toBe(true);
    const outcome = applyCommand(rolled, 'p1', command as Command, seededRng(1));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.state.board.robber).toBe(hex(state, 0, -1));
  });

  it('only offers legal pirate targets, and the frame only while the pirate blocks me', () => {
    const blocked = blockedRoute();
    const view = viewOf(sevenOn(blocked.state), 'p1');
    const legal = moduleHints(view.hints, 'seafarers')!.pirateTargets;
    const turn = turnContext(view, ctxFor('p1'), 'standard');
    const candidates = seafarersBanditCandidates(turn, 'seven');
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) expect(legal).toContain(candidate.item);
    expect(candidates.at(-1)!.item).toBeNull();
    // 外框的分數＝解除封鎖的價值＋微小偏好，高於任何不擋路的海格。
    const frame = candidates.at(-1)!.score;
    for (const candidate of candidates.slice(0, -1)) expect(candidate.score).toBeLessThan(frame);

    const free = blockedRoute('preroll', 'frame');
    const freeTurn = turnContext(viewOf(sevenOn(free.state), 'p1'), ctxFor('p1'), 'standard');
    const freeCandidates = seafarersBanditCandidates(freeTurn, 'seven');
    expect(freeCandidates.length).toBeGreaterThan(0);
    expect(freeCandidates.map((candidate) => candidate.item)).not.toContain(null);

    // 海盜在盤面上、但不擋路（(0,3)）：外框是合法的目標，卻不是候選。
    const far = blockedRoute();
    far.state.board.pirate = hex(far.state, 0, 3);
    const farView = viewOf(sevenOn(far.state), 'p1');
    expect(moduleHints(farView.hints, 'seafarers')!.pirateTargets).toContain(null);
    const farCandidates = seafarersBanditCandidates(turnContext(farView, ctxFor('p1'), 'standard'), 'seven');
    expect(farCandidates.length).toBeGreaterThan(0);
    expect(farCandidates.map((candidate) => candidate.item)).not.toContain(null);
  });

  it('gives no candidates without hints, and the cause does not change them', () => {
    const view = viewOf(sevenOn(blockedRoute().state), 'p1');
    const bare = turnContext({ ...clone(view), hints: undefined }, ctxFor('p1'), 'standard');
    expect(seafarersBanditCandidates(bare, 'seven')).toEqual([]);
    const turn = turnContext(view, ctxFor('p1'), 'standard');
    expect(seafarersBanditCandidates(turn, 'knight')).toEqual(seafarersBanditCandidates(turn, 'seven'));
  });

  it('is deterministic and does not touch the rng', () => {
    const view = viewOf(sevenOn(blockedRoute().state), 'p1');
    const turn = turnContext(view, ctxFor('p1', 'standard', 3), 'standard');
    const first = seafarersBanditCandidates(turn, 'seven');
    expect(seafarersBanditCandidates(turn, 'seven')).toEqual(first);
    expect(turn.rng.int(1000)).toBe(seededRng(3).int(1000));
    const command = heuristicPolicy('standard').decide(view, ctxFor('p1', 'standard', 3));
    expect(heuristicPolicy('standard').decide(view, ctxFor('p1', 'standard', 3))).toEqual(command);
  });
});

// ===========================================================================
// 海盜分數的組成：偷牌、對手前線、領先係數、現況的基準
// ===========================================================================

describe('pirate scoring: raids, fronts, lead and the status quo', () => {
  /** 沒有任何建築的盤面，p1 擲出 7；`setup` 在擲骰前佈置，`pirate` 是海盜目前的位置。 */
  function quiet(setup: (state: GameState) => void = () => {}, pirate: [number, number] | null = null): GameState {
    const state = emptySeafarersGame(4, 0, 'preroll');
    state.board.pirate = pirate === null ? null : hex(state, pirate[0], pirate[1]);
    setup(state);
    return act(state, 'p1', { type: 'turn.roll' }, SEVEN()).state;
  }

  function scoresOf(state: GameState): Map<number | null, number> {
    const turn = turnContext(viewOf(state, 'p1'), ctxFor('p1'), 'standard');
    return new Map(seafarersBanditCandidates(turn, 'seven').map((candidate) => [candidate.item, candidate.score]));
  }

  const expectSame = (a: Map<number | null, number>, b: Map<number | null, number>): void => {
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [key, value] of a) expect(b.get(key)).toBeCloseTo(value, 9);
  };

  it('a pirate can rob ships, not roads', () => {
    const edge = (s: GameState) => side(s, 2, 0, 3); // (1,0)｜(2,0)：沿岸，道路或船都能放
    const bare = scoresOf(quiet());
    const withRoad = scoresOf(quiet((s) => { road(s, 'p2', edge(s)); giveHand(s, 'p2', { lumber: 3, brick: 3 }); }));
    const withShip = scoresOf(quiet((s) => { ship(s, 'p2', edge(s)); giveHand(s, 'p2', { lumber: 3, brick: 3 }); }));
    const sea = hex(emptySeafarersGame(4), 2, 0);
    expectSame(withRoad, bare);
    expect(withShip.get(sea)).toBeGreaterThan(bare.get(sea)!);
  });

  it('only the open end of a ship is a front, not a settlement or a closed end', () => {
    const bare = scoresOf(quiet());
    const a = (s: GameState) => corner(s, 1, 0, 5);
    // 只有聚落（p2 的建築面向 (2,0) 與 (2,-1)）：沒有船就沒有前線。
    const settled = scoresOf(quiet((s) => settle(s, 'p2', a(s))));
    expectSame(settled, bare);
    // 船接在聚落上：靠聚落的一端是封閉的，只有另一端（面向 (2,-1) 北邊）才是前線。
    const withShip = scoresOf(quiet((s) => { settle(s, 'p2', a(s)); ship(s, 'p2', side(s, 1, 0, 1)); }));
    const sea = hex(emptySeafarersGame(4), 2, 0);
    const north = hex(emptySeafarersGame(4), 2, -1);
    expect(withShip.get(sea)).toBe(bare.get(sea));
    expect(withShip.get(north)).toBeGreaterThan(bare.get(north)!);
  });

  it('weighs a rival front by how far ahead the rival is', () => {
    const front = (bonus: number) =>
      scoresOf(quiet((s) => { ship(s, 'p2', side(s, 2, 0, 0)); s.players[1]!.bonusPoints = bonus; })).get(hex(emptySeafarersGame(4), 2, 0))!;
    const level = front(0);
    const ahead = front(3);
    const winning = front(11); // 離勝利 3 分以內：另外加權
    expect(level).toBeGreaterThan(0);
    expect(ahead).toBeGreaterThan(level);
    expect(winning).toBeGreaterThan(ahead);
  });

  it('counts the fronts the pirate blocks now, and charges for leaving them', () => {
    // 海盜在 (2,0)，p2 的船端旁邊的前線邊都被它擋著；p1 沒有航線。
    const state = quiet((s) => { ship(s, 'p2', side(s, 2, 0, 0)); s.players[1]!.bonusPoints = 3; }, [2, 0]);
    const scores = scoresOf(state);
    const neutral = scores.get(hex(state, 0, 3))!;
    const sea = hex(state, 2, 1);
    // 離開 (2,0) 就放開了 p2 的前線：沒有任何作用的海格因此是負的。
    expect(neutral).toBeLessThan(0);
    // (2,1) 鄰接 p2 的兩條前線邊，其中一條現在被海盜擋著；以海盜不在的盤面計算才算得到。
    expect(scores.get(sea)! - neutral).toBeGreaterThan(5);
    // 負分不會贏過強盜：仍然移強盜。
    const view = viewOf(state, 'p1');
    const command = heuristicPolicy('standard').decide(view, ctxFor('p1')) as { type: string; hex: number | null };
    expect(command.type).toBe('pending.moveRobber');
    expect(isSea(view, command.hex)).toBe(false);
  });
});

// ===========================================================================
// setup：登島加權與「路或船」
// ===========================================================================

describe('setup: islands and ships', () => {
  const setupView = () => viewOf(seafarersGame(4).state, 'p1');

  describe('islandSetupBonus', () => {
    it('rewards coast spots that reach an island within 3 ships, and nothing else', () => {
      const { state } = seafarersGame(4);
      const view = viewOf(state, 'p1');
      const turn = turnContext(view, ctxFor('p1'), 'standard');
      const coast = corner(state, 1, 0, 5); // 面向 (2,0)：2 艘船到島 3 的金礦邊
      const inland = corner(state, -2, 1, 1); // 主島內陸，離任何小島都超過 3 艘
      expect(view.hints!.legalSettlements).toContain(coast);
      expect(view.hints!.legalSettlements).toContain(inland);
      expect(islandSetupBonus(turn, coast)).toBeGreaterThan(3);
      expect(islandSetupBonus(turn, inland)).toBe(0);
      for (const vertex of view.hints!.legalSettlements) expect(islandSetupBonus(turn, vertex)).toBeGreaterThanOrEqual(0);
    });

    it('is worth less once the island bonus is already taken, and discounts distance', () => {
      const { state } = seafarersGame(4);
      const view = viewOf(state, 'p1');
      const coast = corner(state, 1, 0, 5);
      const open = islandSetupBonus(turnContext(view, ctxFor('p1'), 'standard'), coast);
      const taken = clone(view);
      (taken.modules!.seafarers as { islandBonus: Record<string, number[]> }).islandBonus = { p1: [2, 3, 4] };
      expect(islandSetupBonus(turnContext(taken, ctxFor('p1'), 'standard'), coast)).toBeLessThan(open);
      expect(shipDiscount(1)).toBe(1);
      expect(shipDiscount(2)).toBeLessThan(shipDiscount(1));
      expect(shipDiscount(3)).toBeLessThan(shipDiscount(2));
    });

    it('islandSites follows the claimed islands even on a model it has already seen', () => {
      const turn = turnContext(setupView(), ctxFor('p1'), 'standard');
      const open = islandSites(turn.model, []);
      const taken = islandSites(turn.model, [2, 3, 4]);
      expect(taken.map((site) => site.vertex)).toEqual(open.map((site) => site.vertex));
      expect(open.length).toBeGreaterThan(10);
      open.forEach((site, index) => expect(site.value - taken[index]!.value).toBeCloseTo(ISLAND_VP_VALUE, 9));
      // 只領取其中一座島：只有那座島的點不再有 +2 VP。
      islandSites(turn.model, [3]).forEach((site, index) => {
        expect(open[index]!.value - site.value).toBeCloseTo(site.island === 3 ? ISLAND_VP_VALUE : 0, 9);
      });
    });

    it('the +2 VP only counts under the New Shores island rules', () => {
      const turn = turnContext(setupView(), ctxFor('p1'), 'standard');
      const plain = { ...turn.model, profile: { ...turn.model.profile, scenario: null } };
      const withRules = islandSites(turn.model, []);
      islandSites(plain, []).forEach((site, index) => expect(withRules[index]!.value - site.value).toBeCloseTo(ISLAND_VP_VALUE, 9));
    });

    it('is pure: the same inputs give the same answer, and the rng is untouched', () => {
      const view = setupView();
      const turn = turnContext(view, ctxFor('p1', 'standard', 4), 'standard');
      const vertex = view.hints!.legalSettlements[0]!;
      expect(islandSetupBonus(turn, vertex)).toBe(islandSetupBonus(turn, vertex));
      expect(turn.rng.int(1000)).toBe(seededRng(4).int(1000));
    });

    it('is zero on a board without islands', () => {
      const base = projectGame(seafarersGame(4).state, 'p1', { hints: undefined });
      expect(base.board.islands.filter((island) => island > 1).length).toBeGreaterThan(0);
      const flat = { ...clone(base), board: { ...clone(base.board), islands: base.board.islands.map(() => 1) } };
      const turn = turnContext(flat, ctxFor('p1'), 'standard');
      for (let vertex = 0; vertex < turn.model.topo.vertices.length; vertex += 7) expect(islandSetupBonus(turn, vertex)).toBe(0);
    });
  });

  describe('the second round', () => {
    /** p1 在 A 放聚落與一艘朝島 3 的船；其他座位放遠處的點，直到輪到 p1 的第二座聚落。 */
    function secondRound(): GameState {
      let state = seafarersGame(4).state;
      const a = corner(state, 1, 0, 5);
      state = act(state, 'p1', { type: 'setup.placeBuilding', vertex: a }).state;
      state = act(state, 'p1', { type: 'setup.placeShip', edge: side(state, 2, 0, 2) } as unknown as Command).state;
      for (let step = 0; step < 20; step++) {
        const view = viewOf(state, 'p1');
        if (view.turn.phase !== 'setup' || view.turn.playerId === 'p1') break;
        const actor = view.turn.playerId;
        const mine = viewOf(state, actor);
        const command =
          mine.turn.setup!.stage === 'building'
            ? { type: 'setup.placeBuilding', vertex: mine.hints!.legalSettlements.at(-1)! }
            : mine.hints!.legalRoads.length > 0
              ? { type: 'setup.placeRoad', edge: mine.hints!.legalRoads[0]! }
              : { type: 'setup.placeShip', edge: moduleHints(mine.hints, 'seafarers')!.setupShips[0]! };
        state = act(state, actor, command as Command).state;
      }
      return state;
    }

    it('does not count what the first settlement and the first ship already reach', () => {
      const state = secondRound();
      const view = viewOf(state, 'p1');
      expect(view.turn).toMatchObject({ playerId: 'p1', setup: { stage: 'building', round: 2 } });
      const turn = turnContext(view, ctxFor('p1'), 'standard');
      const inland = corner(state, -2, 1, 1);
      expect(view.hints!.legalSettlements).toContain(inland);
      // 內陸的點本身離小島很遠；從自己的聚落或船出發的航路不能算進它的登島加權。
      expect(islandSetupBonus(turn, inland)).toBe(0);
      // 第一座聚落的那個海岸點仍然靠近島 3：同一個函式對真正靠海的點給正值。
      expect(view.hints!.legalSettlements.some((vertex) => islandSetupBonus(turn, vertex) > 0)).toBe(true);
    });

    it('the ship score of a second settlement ignores the first ship too', () => {
      const state = secondRound();
      // 第二座聚落放在離島很遠的海岸（第一輪就沒有分數的點）：沒有第一艘船的幫助，船分數仍是 0。
      const view = viewOf(state, 'p1');
      const turn = turnContext(view, ctxFor('p1'), 'standard');
      const quiet = view.hints!.legalSettlements.filter((vertex) => islandSetupBonus(turn, vertex) === 0);
      let checked = 0;
      for (const vertex of quiet) {
        const placed = act(state, 'p1', { type: 'setup.placeBuilding', vertex }).state;
        const placedView = viewOf(placed, 'p1');
        const placedTurn = turnContext(placedView, ctxFor('p1'), 'standard');
        for (const edge of moduleHints(placedView.hints, 'seafarers')?.setupShips ?? []) {
          expect(setupShipScore(placedTurn, edge)).toBe(0);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  });

  describe('setup building', () => {
    it('standard picks the best base score plus the island bonus, and that is not what base alone picks', () => {
      const { state } = seafarersGame(4);
      const view = viewOf(state, 'p1');
      const turn = turnContext(view, ctxFor('p1'), 'standard');
      const scored = view.hints!.legalSettlements.map((vertex) => ({ vertex, score: setupSpotScore(turn, vertex) + islandSetupBonus(turn, vertex) }));
      const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
      const command = heuristicPolicy('standard').decide(view, ctxFor('p1'));
      expect(command).toEqual({ type: 'setup.placeBuilding', vertex: best.vertex });
      expectAccepted(state, 'p1', command);
      // 沒有模組時（純 base）選另一個點：登島加權改變了決策。
      const baseOnly = heuristicPolicy('standard', []).decide(view, ctxFor('p1'));
      expect(baseOnly).not.toEqual(command);
    });

    it('easy picks among the best three by the same score', () => {
      const { state } = seafarersGame(4);
      const view = viewOf(state, 'p1');
      const turn = turnContext(view, ctxFor('p1'), 'easy');
      const scored = view.hints!.legalSettlements.map((vertex) => ({ vertex, score: setupSpotScore(turn, vertex) + islandSetupBonus(turn, vertex) }));
      const top3 = scored.slice().sort((a, b) => b.score - a.score).slice(0, 3).map((entry) => entry.vertex);
      const seen = new Set<number>();
      for (let seed = 1; seed <= 40; seed++) {
        const command = heuristicPolicy('easy').decide(view, ctxFor('p1', 'easy', seed)) as { type: string; vertex: number };
        expect(command.type).toBe('setup.placeBuilding');
        expect(top3).toContain(command.vertex);
        seen.add(command.vertex);
        if (seed <= 3) expectAccepted(state, 'p1', command);
      }
      expect(seen.size).toBeGreaterThan(1);
    });
  });

  describe('setup road: road or ship', () => {
    /** 每個合法的第一座聚落放下之後，輪到 p1 放路或船。 */
    function afterEachSettlement(): { vertex: number; state: GameState; view: GameView }[] {
      const { state } = seafarersGame(4);
      return viewOf(state, 'p1').hints!.legalSettlements.map((vertex) => {
        const placed = act(state, 'p1', { type: 'setup.placeBuilding', vertex }).state;
        return { vertex, state: placed, view: viewOf(placed, 'p1') };
      });
    }

    it('standard takes the higher of the best road and the best ship', () => {
      const types = new Set<string>();
      for (const { state, view } of afterEachSettlement()) {
        expect(view.turn.setup).toMatchObject({ stage: 'road' });
        const turn = turnContext(view, ctxFor('p1'), 'standard');
        const roads = view.hints!.legalRoads.map((edge) => ({ edge, score: roadDirectionScore(turn, edge) }));
        const ships = (moduleHints(view.hints, 'seafarers')?.setupShips ?? []).map((edge) => ({ edge, score: setupShipScore(turn, edge) }));
        const bestRoad = roads.reduce((a, b) => (b.score > a.score ? b : a), { edge: -1, score: -Infinity });
        const bestShip = ships.reduce((a, b) => (b.score > a.score ? b : a), { edge: -1, score: -Infinity });
        const command = heuristicPolicy('standard').decide(view, ctxFor('p1')) as { type: string; edge: number };
        // 同分取路。
        const expected = bestShip.score > bestRoad.score ? { type: 'setup.placeShip', edge: bestShip.edge } : { type: 'setup.placeRoad', edge: bestRoad.edge };
        expect(command).toEqual(expected);
        expectAccepted(state, 'p1', command);
        types.add(command.type);
      }
      // 兩種都會出現：靠近小島時放船，其餘放路。
      expect([...types].sort()).toEqual(['setup.placeRoad', 'setup.placeShip']);
    });

    it('easy only places roads', () => {
      for (const { state, view } of afterEachSettlement()) {
        expect(view.hints!.legalRoads.length).toBeGreaterThan(0);
        for (const seed of [1, 2]) {
          const command = heuristicPolicy('easy').decide(view, ctxFor('p1', 'easy', seed)) as { type: string; edge: number };
          expect(command.type).toBe('setup.placeRoad');
          expect(view.hints!.legalRoads).toContain(command.edge);
          expectAccepted(state, 'p1', command);
        }
      }
    });

    it('takes the road when the road and the ship score the same', () => {
      const { state } = seafarersGame(4);
      const coast = corner(state, 1, 0, 5);
      const placed = act(state, 'p1', { type: 'setup.placeBuilding', vertex: coast }).state;
      const view = clone(viewOf(placed, 'p1'));
      // 抹平所有價值：沒有點數、沒有港口、島上的 +2 VP 也已領走，路與船都是 0 分。
      view.board.numbers = view.board.numbers.map(() => null);
      view.board.harbors = [];
      (view.modules!.seafarers as { islandBonus: Record<string, number[]> }).islandBonus = { p1: [2, 3, 4] };
      const turn = turnContext(view, ctxFor('p1'), 'standard');
      const ships = moduleHints(view.hints, 'seafarers')!.setupShips;
      expect(view.hints!.legalRoads.length).toBeGreaterThan(0);
      expect(ships.length).toBeGreaterThan(0);
      for (const edge of view.hints!.legalRoads) expect(roadDirectionScore(turn, edge)).toBe(0);
      for (const edge of ships) expect(setupShipScore(turn, edge)).toBe(0);
      const command = heuristicPolicy('standard').decide(view, ctxFor('p1')) as { type: string; edge: number };
      expect(command).toEqual({ type: 'setup.placeRoad', edge: view.hints!.legalRoads[0] });
    });

    it('the ship score is zero when no island is in reach, and highest facing the closest island', () => {
      const { state } = seafarersGame(4);
      const coast = corner(state, 1, 0, 5);
      const placed = act(state, 'p1', { type: 'setup.placeBuilding', vertex: coast }).state;
      const view = viewOf(placed, 'p1');
      const turn = turnContext(view, ctxFor('p1'), 'standard');
      const scores = new Map(moduleHints(view.hints, 'seafarers')!.setupShips.map((edge) => [edge, setupShipScore(turn, edge)]));
      // 朝東北的 (2,-1)｜(2,0) 邊直達 S，是最好的方向。
      const toward = side(state, 2, 0, 2);
      expect(scores.size).toBeGreaterThan(1);
      for (const [edge, score] of scores) if (edge !== toward) expect(scores.get(toward)).toBeGreaterThan(score);
      expect(scores.get(toward)).toBeGreaterThan(8);
      const inland = act(state, 'p1', { type: 'setup.placeBuilding', vertex: corner(state, -2, 1, 1) }).state;
      const inlandView = viewOf(inland, 'p1');
      const inlandTurn = turnContext(inlandView, ctxFor('p1'), 'standard');
      for (const edge of moduleHints(inlandView.hints, 'seafarers')?.setupShips ?? []) expect(setupShipScore(inlandTurn, edge)).toBe(0);
    });
  });
});

// ===========================================================================
// I9 固定盤面：F1–F7，standard 與 easy
// ===========================================================================

describe('I9 fixed boards F1–F7 (standard and easy)', () => {
  it('F1: Road Building with only ship spots builds a ship', () => {
    const played = playRoadBuilding(roadBuildingGame(true));
    expect(viewOf(played, 'p1').pending).toMatchObject({ kind: 'freeRoads', actor: 'p1' });
    for (const command of expectEveryRunMoves(played, 'p1')) expect(command.type).toBe('build.ship');
  });

  it('F2: Road Building after the road supply ran out builds a ship, never the rejected road', () => {
    const state = roadBuildingGame(false);
    fillRoads(state, 'p1', 15);
    const played = playRoadBuilding(state);
    const view = viewOf(played, 'p1');
    expect(view.hints!.legalRoads.length).toBeGreaterThan(0);
    for (const command of expectEveryRunMoves(played, 'p1')) expect(command.type).toBe('build.ship');
  });

  it('F2b: both supplies ran out, every run ends the turn', () => {
    const state = roadBuildingGame(false);
    fillRoads(state, 'p1', 15);
    const played = playRoadBuilding(state);
    fillShips(played, 'p1', 15);
    expect(viewOf(played, 'p1').pending).toBeNull();
    for (const command of expectEveryRunMoves(played, 'p1')) expect(command).toEqual({ type: 'turn.end' });
  });

  it('F3: gold owed 2 with 1 card in the bank takes that card', () => {
    const state = emptySeafarersGame(4, 0, 'preroll');
    settle(state, 'p2', gold(state, 0), true);
    state.bank = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 1 };
    const rolled = act(state, 'p1', { type: 'turn.roll' }, TEN()).state;
    for (const command of expectEveryRunMoves(rolled, 'p2')) expect(command).toEqual({ type: 'gold.choose', resources: ['ore'] });
  });

  it('F3b: gold owed 3 with the bank split across two resources', () => {
    const state = emptySeafarersGame(4, 0, 'preroll');
    settle(state, 'p2', gold(state, 0), true);
    settle(state, 'p2', gold(state, 2));
    state.bank = { lumber: 0, brick: 0, wool: 1, grain: 0, ore: 1 };
    const rolled = act(state, 'p1', { type: 'turn.roll' }, TEN()).state;
    for (const command of expectEveryRunMoves(rolled, 'p2')) {
      expect((command as { resources: string[] }).resources.slice().sort()).toEqual(['ore', 'wool']);
    }
  });

  it('F4: the first responder is not the actor — it answers, the actor stays silent', () => {
    const state = goldRoll('p4', (s) => {
      settle(s, 'p1', gold(s, 0));
      settle(s, 'p2', gold(s, 2));
    });
    expectEveryRunMoves(state, 'p1');
    for (const [, level, seed] of RUNS) {
      expect(decide(state, 'p4', level, seed)).toBeNull();
      expect(decide(state, 'p2', level, seed)).toBeNull();
    }
  });

  it('F5: setup with only ship spots places the ship', () => {
    const { state } = seafarersGame(4);
    const e = k3Edges(state);
    const placed = act(state, 'p1', { type: 'setup.placeBuilding', vertex: e.k3 }).state;
    road(placed, 'p2', e.W);
    road(placed, 'p2', e.E1);
    const view = viewOf(placed, 'p1');
    expect(view.hints!.legalRoads).toEqual([]);
    for (const command of expectEveryRunMoves(placed, 'p1')) expect(command).toEqual({ type: 'setup.placeShip', edge: e.NW });
  });

  it('F6: moveRobber on a board with sea moves the robber to land', () => {
    const state = emptySeafarersGame(4, 0, 'preroll');
    const rolled = act(state, 'p1', { type: 'turn.roll' }, SEVEN()).state;
    const view = viewOf(rolled, 'p1');
    expect(view.pending).toMatchObject({ kind: 'moveRobber', actor: 'p1' });
    for (const command of expectEveryRunMoves(rolled, 'p1')) {
      expect(command.type).toBe('pending.moveRobber');
      expect(isSea(view, (command as { hex: number | null }).hex)).toBe(false);
    }
  });

  describe('F7: a knight sends the robber or the pirate to a sea hex', () => {
    /** p1 再打一張騎士就拿最大騎士團；強盜沒有壓著自己的東西，p2 的船在海上、有牌。 */
    function armyGame(): GameState {
      const state = emptySeafarersGame(4, 0, 'action');
      state.players[0]!.devCards = ['knight'];
      state.players[0]!.playedKnights = 2;
      ship(state, 'p2', side(state, 2, 1, 2));
      giveHand(state, 'p2', { lumber: 2, brick: 2, wool: 1 });
      return state;
    }

    /** p1 的城市（內陸，沒有航線）被強盜壓住；p2 的船在海上、有牌。 */
    function pressedGame(): GameState {
      const state = armyGame();
      state.players[0]!.playedKnights = 0;
      settle(state, 'p1', corner(state, 1, 0, 2), true);
      state.board.robber = hex(state, 1, 0);
      return state;
    }

    it('standard plays the knight on a sea hex where p2 can be robbed', () => {
      const state = armyGame();
      const view = viewOf(state, 'p1');
      const command = decide(state, 'p1', 'standard') as { type: string; hex: number | null };
      expect(command.type).toBe('dev.playKnight');
      expect(isSea(view, command.hex)).toBe(true);
      const outcome = applyCommand(state, 'p1', command as Command, seededRng(1));
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.state.board.pirate).toBe(command.hex);
        expect(outcome.state.pending).toMatchObject({ kind: 'steal', candidates: ['p2'] });
      }
    });

    it('easy does not chase the army and never sends anything to sea', () => {
      const state = armyGame();
      for (const seed of [1, 2, 3]) {
        const command = decide(state, 'p1', 'easy', seed);
        expect(command).not.toBeNull();
        expect(command!.type).not.toBe('dev.playKnight');
        expectAccepted(state, 'p1', command);
      }
    });

    it('when the robber presses my city, standard and easy both move the robber to land', () => {
      const state = pressedGame();
      const view = viewOf(state, 'p1');
      for (const [, level, seed] of RUNS) {
        const command = decide(state, 'p1', level, seed) as { type: string; hex: number | null };
        expect(command.type).toBe('dev.playKnight');
        expect(command.hex).not.toBeNull();
        expect(isSea(view, command.hex)).toBe(false);
        expect(command.hex).not.toBe(hex(state, 1, 0));
        expectAccepted(state, 'p1', command);
      }
    });
  });
});

// ===========================================================================
// B-FAIR
// ===========================================================================

describe('B-FAIR: the same projection gives the same decision', () => {
  /** 涵蓋 SF-2b 每個鉤子的狀態；每位玩家都有不同的手牌與發展卡。 */
  function fairStates(): { name: string; state: GameState }[] {
    const out: { name: string; state: GameState }[] = [];
    const add = (name: string, state: GameState) => {
      stockHands(state);
      out.push({ name, state });
    };
    add('setup building', seafarersGame(4).state);
    const setup = seafarersGame(4).state;
    add('setup road', act(setup, 'p1', { type: 'setup.placeBuilding', vertex: corner(setup, 1, 0, 5) }).state);
    const gold4 = goldRoll('p4', (s) => {
      settle(s, 'p1', gold(s, 0));
      settle(s, 'p2', gold(s, 2));
      stockHands(s);
    });
    add('gold frame', gold4);
    add('preroll, pirate blocks', blockedRoute().state);
    const seven = blockedRoute().state;
    ship(seven, 'p2', side(seven, 3, 1, 3));
    seven.players[0]!.devCards = [];
    add('moveRobber with pirate options', act(seven, 'p1', { type: 'turn.roll' }, SEVEN()).state);
    const knight = emptySeafarersGame(4, 0, 'action');
    settle(knight, 'p1', corner(knight, 1, 0, 2), true);
    knight.board.robber = hex(knight, 1, 0);
    knight.players[0]!.devCards = ['knight'];
    ship(knight, 'p2', side(knight, 2, 1, 2));
    add('action, knight', knight);
    return out;
  }

  const states = fairStates();

  it('covers every hook', () => {
    expect(states.map((entry) => entry.name)).toHaveLength(6);
  });

  for (const level of ['standard', 'easy'] as BotLevel[]) {
    it(`decides identically when only hidden information differs (${level})`, () => {
      const policy = heuristicPolicy(level);
      let compared = 0;
      for (const { name, state } of states) {
        for (const player of state.players) {
          const { variant, changed } = hideDifferently(state, player.id);
          if (!changed) continue;
          const original = viewFor(state, player.id);
          const altered = viewFor(variant, player.id);
          expect(JSON.stringify(altered), `${name} / ${player.id} projection`).toBe(JSON.stringify(original));
          const ctx = ctxFor(player.id, level, 61 + compared);
          expect(policy.decide(altered, ctx), `${name} / ${player.id}`).toEqual(policy.decide(original, ctx));
          compared += 1;
        }
      }
      expect(compared).toBeGreaterThanOrEqual(states.length * 3);
    });
  }

  it('never mutates the projection it is given', () => {
    const deepFreeze = <T>(value: T): T => {
      if (value && typeof value === 'object') {
        for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
        Object.freeze(value);
      }
      return value;
    };
    for (const { state } of states) {
      for (const player of state.players) {
        const view = deepFreeze(viewFor(cloneState(state), player.id));
        for (const level of ['standard', 'easy'] as const) {
          const ctx = deepFreeze(ctxFor(player.id, level, 7));
          expect(() => heuristicPolicy(level).decide(view, ctx)).not.toThrow();
        }
      }
    }
  });

  it('every decision on these states is accepted or a deliberate silence', () => {
    for (const { name, state } of states) {
      for (const player of state.players) {
        for (const [, level, seed] of RUNS) {
          const command = decide(state, player.id, level, seed);
          if (command === null) {
            // 刻意的沉默：此刻不欠任何動作（欠動作時策略與保底都回 null 才是卡住）。
            expect(botOwesAction(viewOf(state, player.id), player.id), `${name} / ${player.id} / ${level}: silent but owes`).toBeNull();
            continue;
          }
          const outcome = applyCommand(state, player.id, command as Command, seededRng(1));
          expect(outcome.ok, `${name} / ${player.id} / ${level}: ${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
        }
      }
    }
  });
});
