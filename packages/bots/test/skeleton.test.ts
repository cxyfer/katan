/**
 * 骨架的模組鉤子與規則 9。
 *
 * 0.4.1 沒有註冊任何 Bot 模組，golden replay 只能證明「模組清單為空時 base 不變」。這裡用只存在於
 * 測試內的假模組，經 `createBotPolicy(level, { modules })`、`createFallbackPolicy(modules)` 與
 * `turnContext(...)` 注入，逐一驗證鉤子的語意；註冊表本身只在 `vi.resetModules()` 後的獨立模組圖
 * 裡被改動，不會影響其他測試，也不碰 `REGISTERED`。
 *
 * 不依賴 `harness.ts`：盤面直接以 `@catan/rules` 的 API 建構。
 */

import { describe, expect, it, vi } from 'vitest';
import {
  actionHints,
  applyCommand,
  createGame,
  getProfile,
  PLAYER_COLORS,
  projectGame,
  seededRng,
  type GameState,
  type GameView,
  type Offer,
  type ProfileDefinition,
  type PublicPendingView,
  type Rng,
} from '@catan/rules';
import {
  botActingOrder,
  botOwesAction,
  createBotPolicy,
  createFallbackPolicy,
  fallbackPolicy,
  type BotContext,
  type BotLevel,
  type BotModule,
  type Scored,
} from '../src/index.ts';
import { pipsOf, vertexYield } from '../src/board.ts';
import { economyOf, isImmediate, PIP_VALUE, weightedPips, type Plan } from '../src/economy.ts';
import { turnContext } from '../src/heuristic.ts';
import { offerTermsKnown } from '../src/trade.ts';

// ---------------------------------------------------------------------------
// 盤面建構（不經 harness）
// ---------------------------------------------------------------------------

const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 1): BotContext => ({
  selfId,
  level,
  seed,
  offerPhases: {},
});

function newGame(seed: number): { state: GameState; rng: Rng } {
  const rng = seededRng(seed);
  const state = createGame({
    profileId: 'base-2025',
    players: Array.from({ length: 4 }, (_, index) => ({
      id: `bot${index + 1}`,
      nickname: `Bot ${index + 1}`,
      color: PLAYER_COLORS[index]!,
    })),
    setupMode: 'variable',
    rng,
  });
  return { state, rng };
}

/** 與伺服器相同的投影：自己座位的 view 加上 hints。 */
function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

const actorOf = (state: GameState): string => state.players[state.turn.seat]!.id;

/** 用保底策略往前推一步（照排程順序詢問各座位）。 */
function stepWithFallback(state: GameState, rng: Rng): GameState {
  const ids = state.players.map((player) => player.id);
  for (const id of botActingOrder(viewOf(state, ids[0]!), ids)) {
    const command = fallbackPolicy.decide(viewOf(state, id), ctxFor(id));
    if (!command) continue;
    const outcome = applyCommand(state, id, command, rng);
    if (!outcome.ok) throw new Error(`fallback command rejected: ${outcome.error.code}`);
    return outcome.state;
  }
  throw new Error('no seat can act');
}

interface Position {
  state: GameState;
  /** 輪到行動的座位。 */
  id: string;
  view: GameView;
}

function positionOf(state: GameState): Position {
  const id = actorOf(state);
  return { state, id, view: viewOf(state, id) };
}

/** 開局：第一位放置聚落。 */
function setupPosition(): Position {
  return positionOf(newGame(1).state);
}

/** 保底策略推到擲骰前（沒有待決效果）。 */
function prerollPosition(seed = 1): Position & { rng: Rng } {
  let { state, rng } = newGame(seed);
  for (let step = 0; step < 600 && !(state.turn.phase === 'preroll' && !state.pending); step++) {
    state = stepWithFallback(state, rng);
  }
  expect(state.turn.phase).toBe('preroll');
  return { ...positionOf(state), rng };
}

/** 擲骰後進入行動階段、沒有待決效果（骰到 7 的種子略過）。 */
function actionPosition(): Position {
  for (let seed = 1; seed <= 40; seed++) {
    const start = prerollPosition(seed);
    const rolled = applyCommand(start.state, start.id, { type: 'turn.roll' }, start.rng);
    if (rolled.ok && rolled.state.turn.phase === 'action' && !rolled.state.pending) return positionOf(rolled.state);
  }
  throw new Error('no seed reaches the action phase without a pending effect');
}

function withPending(view: GameView, pending: NonNullable<PublicPendingView>): GameView {
  return { ...view, pending };
}

function withHints(view: GameView, patch: Partial<NonNullable<GameView['hints']>>): GameView {
  return { ...view, hints: { ...view.hints!, ...patch } };
}

function withHand(view: GameView, playerId: string, resources: Record<'lumber' | 'brick' | 'wool' | 'grain' | 'ore', number>): GameView {
  return { ...view, players: view.players.map((p) => (p.id === playerId ? { ...p, resources } : p)) };
}

const RICH = { lumber: 9, brick: 9, wool: 9, grain: 9, ore: 9 } as const;

/** 沒有立即得分的建造可選，讓決策走到計畫與保底。 */
const noScoringBuilds = (view: GameView): GameView => withHints(view, { legalCities: [], legalSettlements: [] });

const cmd = (type: string) => ({ type });

const offerOf = (patch: Partial<Offer>, from: string, windowId: number): Offer => ({
  id: 'o1',
  revision: 1,
  from,
  to: 'all',
  give: { lumber: 1 },
  want: { grain: 1 },
  windowId,
  status: 'open',
  responses: {},
  agreedWith: null,
  createdSeq: 1,
  ...patch,
});
const scored = <T>(item: T, score: number): Scored<T> => ({ item, score });

// ---------------------------------------------------------------------------
// 保底的義務
// ---------------------------------------------------------------------------

describe('fallback duties', () => {
  it('lets a module duty answer before turn.roll, and null suppresses the default', () => {
    const { id, view } = prerollPosition();
    const duty = cmd('fx.duty');
    expect(createFallbackPolicy([{ id: 'fx', duty: () => duty }]).decide(view, ctxFor(id))).toBe(duty);
    // null = 歸模組管、這次不送指令：保底不再送 turn.roll。
    expect(createFallbackPolicy([{ id: 'fx', duty: () => null }]).decide(view, ctxFor(id))).toBeNull();
    // undefined = 不歸我管。
    expect(createFallbackPolicy([{ id: 'fx', duty: () => undefined }]).decide(view, ctxFor(id))?.type).toBe('turn.roll');
    expect(createFallbackPolicy([]).decide(view, ctxFor(id))?.type).toBe('turn.roll');
    expect(fallbackPolicy.decide(view, ctxFor(id))?.type).toBe('turn.roll');
  });

  it('asks modules in order: the first defined answer wins, even null', () => {
    const { id, view } = prerollPosition();
    const asked: string[] = [];
    const modules: BotModule[] = [
      { id: 'a', duty: () => (asked.push('a'), undefined) },
      { id: 'b', duty: () => (asked.push('b'), null) },
      { id: 'c', duty: () => (asked.push('c'), cmd('fx.c')) },
    ];
    expect(createFallbackPolicy(modules).decide(view, ctxFor(id))).toBeNull();
    expect(asked).toEqual(['a', 'b']);
  });

  it('lets a module duty replace turn.end in the action phase', () => {
    const { id, view } = actionPosition();
    expect(createFallbackPolicy([]).decide(view, ctxFor(id))?.type).toBe('turn.end');
    const duty = cmd('fx.duty');
    expect(createFallbackPolicy([{ id: 'fx', duty: () => duty }]).decide(view, ctxFor(id))).toBe(duty);
    expect(createFallbackPolicy([{ id: 'fx', duty: () => null }]).decide(view, ctxFor(id))).toBeNull();
    expect(createFallbackPolicy([{ id: 'fx', duty: () => undefined }]).decide(view, ctxFor(id))?.type).toBe('turn.end');
  });

  it('puts base first during setup', () => {
    const { id, view } = setupPosition();
    const policy = createFallbackPolicy([{ id: 'fx', duty: () => cmd('fx.duty') }]);
    expect(policy.decide(view, ctxFor(id))).toEqual({
      type: 'setup.placeBuilding',
      vertex: view.hints!.legalSettlements[0],
    });
  });

  it('puts base first for a pending base frame and asks modules only when base owes nothing', () => {
    const { id, view } = actionPosition();
    const other = view.players.find((player) => player.id !== id)!.id;
    const duty = cmd('fx.duty');
    const policy = createFallbackPolicy([{ id: 'fx', duty: () => duty }]);
    const owing = withPending(withHand(view, id, RICH), { kind: 'discard', required: { [id]: 2 }, waitingFor: [id] });
    expect(policy.decide(owing, ctxFor(id))?.type).toBe('pending.discard');
    const notOwing = withPending(view, { kind: 'discard', required: { [other]: 2 }, waitingFor: [other] });
    expect(policy.decide(notOwing, ctxFor(id))).toBe(duty);
    expect(createFallbackPolicy([]).decide(notOwing, ctxFor(id))).toBeNull();
  });

  it('answers a module frame only as its first responder, without asking the duty otherwise', () => {
    const { id, view, state } = actionPosition();
    const other = view.players.find((player) => player.id !== id)!.id;
    const duty = cmd('fx.duty');
    let asked = 0;
    const policy = createFallbackPolicy([{ id: 'fx', duty: () => (asked++, duty) }]);
    const frameFor = (responders: string[]) => ({ kind: 'fx.frame' as const, module: 'fx', responders, data: {} });
    // 第一位 responder：詢問模組的 duty。
    expect(policy.decide(withPending(view, frameFor([id, other])), ctxFor(id))).toBe(duty);
    expect(asked).toBe(1);
    // 在 responders 裡但不是第一位（P3：保底一律採保守的 responders[0]）：回 null，duty 沒有被呼叫。
    expect(policy.decide(withPending(view, frameFor([other, id])), ctxFor(id))).toBeNull();
    expect(asked).toBe(1);
    // 完全不在 responders 裡。
    expect(policy.decide(withPending(viewOf(state, other), frameFor([id])), ctxFor(other))).toBeNull();
    expect(asked).toBe(1);
    // base 不認得模組 frame：沒有模組時沒有義務。
    expect(createFallbackPolicy([]).decide(withPending(view, frameFor([id])), ctxFor(id))).toBeNull();
  });

  it('stays silent once the game has a result, and never throws on an unknown profile', () => {
    const { id, view } = prerollPosition();
    const policy = createFallbackPolicy([{ id: 'fx', duty: () => cmd('fx.duty') }]);
    expect(policy.decide({ ...view, result: { playerId: id, reason: 'victory' } }, ctxFor(id))).toBeNull();
    // 預設模組由 view.profileId 推導；查不到 profile 時只有 base。
    const odd = { ...view, profileId: 'no-such-profile' };
    expect(() => fallbackPolicy.decide(odd, ctxFor(id))).not.toThrow();
    expect(fallbackPolicy.decide(odd, ctxFor(id))?.type).toBe('turn.roll');
  });
});

// ---------------------------------------------------------------------------
// 策略的鉤子
// ---------------------------------------------------------------------------

describe('strategy hooks', () => {
  const policyOf = (modules: readonly BotModule[], level: BotLevel = 'standard') => createBotPolicy(level, { modules });

  describe('answerFrame', () => {
    const frameFor = (responders: string[]) => ({ kind: 'fx.frame' as const, module: 'fx', responders, data: {} });

    it('hands a module frame to the first module that answers', () => {
      const { id, view } = actionPosition();
      const answer = cmd('fx.answer');
      const asked: string[] = [];
      const modules: BotModule[] = [
        { id: 'a', answerFrame: () => (asked.push('a'), undefined) },
        { id: 'b', answerFrame: () => (asked.push('b'), answer) },
        { id: 'c', answerFrame: () => (asked.push('c'), cmd('fx.late')) },
      ];
      expect(policyOf(modules).decide(withPending(view, frameFor([id])), ctxFor(id))).toBe(answer);
      expect(asked).toEqual(['a', 'b']);
    });

    it('does not ask when the seat is not a responder', () => {
      const { id, view, state } = actionPosition();
      const other = view.players.find((player) => player.id !== id)!.id;
      let asked = 0;
      const module: BotModule = { id: 'fx', answerFrame: () => (asked++, cmd('fx.answer')) };
      const otherView = withPending(viewOf(state, other), frameFor([id]));
      expect(policyOf([module]).decide(otherView, ctxFor(other))).toBeNull();
      expect(asked).toBe(0);
    });

    it('asks answerFrame for any responder, while the fallback stays with the first one', () => {
      const { id, view } = actionPosition();
      const other = view.players.find((player) => player.id !== id)!.id;
      // 同時作答的 frame：自己在 responders 裡但不是第一位。
      const frame = withPending(view, frameFor([other, id]));
      const answer = cmd('fx.answer');
      expect(policyOf([{ id: 'fx', answerFrame: () => answer }]).decide(frame, ctxFor(id))).toBe(answer);
      // 模組不回答時退到保底：不是第一位，所以回 null，duty 沒有被呼叫。
      let asked = 0;
      const duty = (): ReturnType<NonNullable<BotModule['duty']>> => (asked++, cmd('fx.duty'));
      expect(policyOf([{ id: 'fx', answerFrame: () => undefined, duty }]).decide(frame, ctxFor(id))).toBeNull();
      expect(policyOf([{ id: 'fx', answerFrame: () => null, duty }]).decide(frame, ctxFor(id))).toBeNull();
      expect(asked).toBe(0);
    });

    it('falls back to the duty when nobody answers or the answer is null', () => {
      const { id, view } = actionPosition();
      const frame = withPending(view, frameFor([id]));
      const duty = cmd('fx.duty');
      expect(policyOf([{ id: 'fx', answerFrame: () => undefined }]).decide(frame, ctxFor(id))).toBeNull();
      expect(policyOf([{ id: 'fx', answerFrame: () => null }]).decide(frame, ctxFor(id))).toBeNull();
      expect(policyOf([{ id: 'fx', answerFrame: () => null, duty: () => duty }]).decide(frame, ctxFor(id))).toBe(duty);
    });
  });

  describe('setup', () => {
    it('lets the module answer, falls to base on undefined and to the duty on null', () => {
      const { id, view } = setupPosition();
      const base = policyOf([]).decide(view, ctxFor(id));
      expect(base?.type).toBe('setup.placeBuilding');
      const answer = cmd('fx.setup');
      expect(policyOf([{ id: 'fx', setup: () => answer }]).decide(view, ctxFor(id))).toBe(answer);
      expect(policyOf([{ id: 'fx', setup: () => undefined }]).decide(view, ctxFor(id))).toEqual(base);
      // null = 歸模組管但沒有指令：退到保底義務（第一個合法位置）。
      expect(policyOf([{ id: 'fx', setup: () => null }]).decide(view, ctxFor(id))).toEqual({
        type: 'setup.placeBuilding',
        vertex: view.hints!.legalSettlements[0],
      });
    });

    it('stays silent for the seats that are not placing', () => {
      const { id, view, state } = setupPosition();
      const other = view.players.find((player) => player.id !== id)!.id;
      let asked = 0;
      expect(policyOf([{ id: 'fx', setup: () => (asked++, cmd('fx.setup')) }]).decide(viewOf(state, other), ctxFor(other))).toBeNull();
      expect(asked).toBe(0);
    });
  });

  describe('preroll', () => {
    it('picks the best module candidate, and rolls when there is none', () => {
      const { id, view } = prerollPosition();
      const low = cmd('fx.low');
      const high = cmd('fx.high');
      const module: BotModule = { id: 'fx', preroll: () => [scored(low, 1), scored(high, 2)] };
      expect(policyOf([module]).decide(view, ctxFor(id))).toBe(high);
      expect(policyOf([{ id: 'fx', preroll: () => [] }]).decide(view, ctxFor(id))?.type).toBe('turn.roll');
      expect(policyOf([]).decide(view, ctxFor(id))?.type).toBe('turn.roll');
    });

    /** 自己被強盜擋住且手上有騎士卡：base 會打騎士。 */
    function knightPosition(): Position {
      for (let seed = 1; seed <= 40; seed++) {
        const { id, view } = prerollPosition(seed);
        const topology = turnContext(view, ctxFor(id), 'standard', []).model.topo;
        for (const [vertex, building] of view.board.buildings.entries()) {
          if (building?.player !== id) continue;
          const hex = topology.vertices[vertex]!.hexes.find((candidate) => pipsOf(view.board.numbers[candidate]) >= 3);
          if (hex === undefined) continue;
          const blocked: GameView = {
            ...view,
            board: { ...view.board, robber: hex },
            players: view.players.map((p) => (p.id === id ? { ...p, devCards: ['knight'] } : p)),
          };
          return { state: positionOf(newGame(seed).state).state, id, view: blocked };
        }
      }
      throw new Error('no knight position found');
    }

    it('lets a base knight go first; module candidates only fill the gap', () => {
      const { id, view } = knightPosition();
      expect(policyOf([]).decide(view, ctxFor(id))?.type).toBe('dev.playKnight');
      const module: BotModule = { id: 'fx', preroll: () => [scored(cmd('fx.high'), 1000)] };
      expect(policyOf([module]).decide(view, ctxFor(id))?.type).toBe('dev.playKnight');
    });

    it('asks banditCandidates with the knight cause, and a null target moves the bandit off the board', () => {
      const { id, view } = knightPosition();
      const causes: string[] = [];
      const module: BotModule = {
        id: 'fx',
        banditCandidates: (_turn, cause) => (causes.push(cause), [scored(null, 1e6)]),
      };
      expect(policyOf([module]).decide(view, ctxFor(id))).toEqual({ type: 'dev.playKnight', hex: null });
      expect(causes).toEqual(['knight']);
    });
  });

  describe('actions', () => {
    it('scores module candidates together with base builds, base first on ties', () => {
      const { id, view } = actionPosition();
      const rich = withHand(view, id, RICH);
      const base = policyOf([]).decide(rich, ctxFor(id));
      expect(base).not.toBeNull();
      const strong = cmd('fx.strong');
      expect(policyOf([{ id: 'fx', actions: () => [scored(strong, 1e6)] }]).decide(rich, ctxFor(id))).toBe(strong);
      const weak = cmd('fx.weak');
      expect(policyOf([{ id: 'fx', actions: () => [scored(weak, -1e6)] }]).decide(rich, ctxFor(id))).toEqual(base);
      expect(policyOf([{ id: 'fx', actions: () => [] }]).decide(rich, ctxFor(id))).toEqual(base);
    });

    it('puts a base build before a module candidate with the same score', () => {
      const { id, view } = actionPosition();
      const rich = withHand(view, id, RICH);
      const vertex = rich.board.buildings.findIndex((building) => building?.player === id && !building.city);
      // 只留一個城市升級：base 的唯一候選，分數可以直接算出來。
      const only = withHints(rich, { legalCities: [vertex], legalSettlements: [] });
      const turn = turnContext(only, ctxFor(id), 'standard', []);
      const score = 1 + PIP_VALUE * weightedPips(vertexYield(turn.model, vertex), turn.economy.weights);
      const tie = cmd('fx.tie');
      expect(policyOf([{ id: 'fx', actions: () => [scored(tie, score)] }]).decide(only, ctxFor(id))).toEqual({
        type: 'build.city',
        vertex,
      });
      expect(policyOf([{ id: 'fx', actions: () => [scored(tie, score + 1e-9)] }]).decide(only, ctxFor(id))).toBe(tie);
    });
  });

  describe('freeRouteCandidates', () => {
    it('replaces base road choice for a freeRoads frame when non-empty', () => {
      const { id, view } = actionPosition();
      const free = withPending(withHints(view, { legalRoads: [0, 1] }), { kind: 'freeRoads', actor: id, remaining: 2 });
      const base = policyOf([]).decide(free, ctxFor(id));
      expect(base?.type).toBe('build.road');
      const route = cmd('fx.route');
      expect(policyOf([{ id: 'fx', freeRouteCandidates: () => [scored(route, 1)] }]).decide(free, ctxFor(id))).toBe(route);
      expect(policyOf([{ id: 'fx', freeRouteCandidates: () => [] }]).decide(free, ctxFor(id))).toEqual(base);
    });

    it('makes Road Building worth playing when only a module has a route', () => {
      const { id, view } = actionPosition();
      const holding: GameView = {
        ...noScoringBuilds(withHints(view, { legalRoads: [] })),
        players: view.players.map((p) => (p.id === id ? { ...p, devCards: ['roadBuilding'] } : p)),
      };
      const withRoute: BotModule = { id: 'fx', freeRouteCandidates: () => [scored(cmd('fx.route'), 1)] };
      expect(policyOf([withRoute]).decide(holding, ctxFor(id))).toEqual({ type: 'dev.playRoadBuilding' });
      expect(policyOf([]).decide(holding, ctxFor(id))?.type).not.toBe('dev.playRoadBuilding');
      // base 有合法道路時照舊打出，模組不必參與。
      const roads = withHints(holding, { legalRoads: [0, 1] });
      expect(policyOf([]).decide(roads, ctxFor(id))).toEqual({ type: 'dev.playRoadBuilding' });
    });
  });

  describe('banditCandidates', () => {
    const moveRobber = (id: string, view: GameView, cause: string): GameView =>
      withPending(view, { kind: 'moveRobber', actor: id, cause });

    it('pools module candidates after the base ones and tells the cause', () => {
      const { id, view } = actionPosition();
      const seen: string[] = [];
      const module: BotModule = {
        id: 'fx',
        banditCandidates: (_turn, cause) => (seen.push(cause), [scored(null, 1e6)]),
      };
      expect(policyOf([module]).decide(moveRobber(id, view, 'seven'), ctxFor(id))).toEqual({
        type: 'pending.moveRobber',
        hex: null,
      });
      policyOf([module]).decide(moveRobber(id, view, 'knight'), ctxFor(id));
      expect(seen).toEqual(['seven', 'knight']);
      // 沒有模組、或模組沒有候選：與 base 相同。
      const base = policyOf([]).decide(moveRobber(id, view, 'seven'), ctxFor(id));
      expect(base?.type).toBe('pending.moveRobber');
      expect(policyOf([{ id: 'fx', banditCandidates: () => [] }]).decide(moveRobber(id, view, 'seven'), ctxFor(id))).toEqual(base);
    });

    it('tells "no candidate" from "picked the null target"', () => {
      const { id, view } = actionPosition();
      // 沒有任何陸地格可選：base 沒有候選，保底也找不到合法格。
      const sea: GameView = { ...view, board: { ...view.board, terrain: view.board.terrain.map(() => 'sea') } };
      const frame = moveRobber(id, sea, 'seven');
      expect(policyOf([]).decide(frame, ctxFor(id))).toBeNull();
      expect(policyOf([{ id: 'fx', banditCandidates: () => [] }]).decide(frame, ctxFor(id))).toBeNull();
      // 模組選中 null（外框）是一個真正的選擇，要送出 hex: null。
      expect(policyOf([{ id: 'fx', banditCandidates: () => [scored(null, 1)] }]).decide(frame, ctxFor(id))).toEqual({
        type: 'pending.moveRobber',
        hex: null,
      });
    });
  });

  describe('planStep default branch', () => {
    /** 手牌充裕、沒有立即得分的建造，模組計畫的分數最高。 */
    function planView() {
      const { id, view } = actionPosition();
      return { id, view: noScoringBuilds(withHand(view, id, RICH)) };
    }
    const islandPlan = (score: (baseTop: number) => number, nextCost: Plan['nextCost'] = {}): BotModule['economy'] => ({
      scoreExtras: ({ base }) => [
        { kind: 'fx.island', vertex: null, roads: [], cost: nextCost, nextCost, value: 1, eta: 0, score: score(base.plans[0]!.score) },
      ],
    });

    it('routes module plan kinds to the modules, never base kinds', () => {
      const { id, view } = planView();
      const out = cmd('fx.build');
      const seen: string[] = [];
      const module: BotModule = {
        id: 'fx',
        economy: islandPlan((top) => top + 100),
        planStep: (_turn, plan) => (seen.push(plan.kind), plan.kind === 'fx.island' ? out : undefined),
      };
      expect(policyOf([module]).decide(view, ctxFor(id))).toBe(out);
      expect(seen).toEqual(['fx.island']);
    });

    it('treats an undefined answer as "not mine" and an unaffordable step as not worth asking', () => {
      const { id, view } = planView();
      let asked = 0;
      const decline: BotModule = {
        id: 'fx',
        economy: islandPlan((top) => top + 100),
        planStep: () => (asked++, undefined),
      };
      // 模組不接手：決策繼續往下（不得送出模組指令，也不得卡住）。
      expect(policyOf([decline]).decide(view, ctxFor(id))).not.toBeNull();
      expect(asked).toBe(1);
      asked = 0;
      const unaffordable: BotModule = {
        id: 'fx',
        economy: islandPlan((top) => top + 100, { ore: 99 }),
        planStep: () => (asked++, cmd('fx.build')),
      };
      expect(policyOf([unaffordable]).decide(view, ctxFor(id))?.type).not.toBe('fx.build');
      expect(asked).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 模組 duty 在骨架尾端的收尾
// ---------------------------------------------------------------------------

describe('module duties behind the policy skeleton', () => {
  const policyOf = (modules: readonly BotModule[]) => createBotPolicy('standard', { modules });
  const duty = cmd('fx.duty');

  /** 第一位玩家放好聚落，輪到鋪路。 */
  function roadStagePosition(): Position {
    const { state, rng } = newGame(1);
    const id = actorOf(state);
    const placed = applyCommand(state, id, { type: 'setup.placeBuilding', vertex: viewOf(state, id).hints!.legalSettlements[0]! }, rng);
    if (!placed.ok) throw new Error(`placement rejected: ${placed.error.code}`);
    return positionOf(placed.state);
  }

  it('asks the duty at the end of preroll, and null keeps turn.roll from being sent', () => {
    const { id, view } = prerollPosition();
    expect(policyOf([]).decide(view, ctxFor(id))?.type).toBe('turn.roll');
    expect(policyOf([{ id: 'fx', duty: () => duty }]).decide(view, ctxFor(id))).toBe(duty);
    expect(policyOf([{ id: 'fx', duty: () => null }]).decide(view, ctxFor(id))).toBeNull();
    expect(policyOf([{ id: 'fx', duty: () => undefined }]).decide(view, ctxFor(id))?.type).toBe('turn.roll');
  });

  it('asks the duty when the action phase has nothing left to do, and null keeps turn.end from being sent', () => {
    const { id, view } = actionPosition();
    // 手牌是空的：沒有可建造、可交易、可開價的事。
    const idle = noScoringBuilds(withHand(view, id, { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 }));
    expect(policyOf([]).decide(idle, ctxFor(id))?.type).toBe('turn.end');
    expect(policyOf([{ id: 'fx', duty: () => duty }]).decide(idle, ctxFor(id))).toBe(duty);
    expect(policyOf([{ id: 'fx', duty: () => null }]).decide(idle, ctxFor(id))).toBeNull();
    expect(policyOf([{ id: 'fx', duty: () => undefined }]).decide(idle, ctxFor(id))?.type).toBe('turn.end');
  });

  it('asks the duty when setup has no move, and not when base can place', () => {
    const { id, view } = roadStagePosition();
    expect(view.turn.setup?.stage).toBe('road');
    const stuck = withHints(view, { legalRoads: [] });
    expect(policyOf([]).decide(stuck, ctxFor(id))).toBeNull();
    expect(policyOf([{ id: 'fx', setup: () => undefined, duty: () => duty }]).decide(stuck, ctxFor(id))).toBe(duty);
    expect(policyOf([{ id: 'fx', setup: () => undefined, duty: () => null }]).decide(stuck, ctxFor(id))).toBeNull();
    let asked = 0;
    const idleDuty: BotModule = { id: 'fx', duty: () => (asked++, duty) };
    expect(policyOf([idleDuty]).decide(view, ctxFor(id))?.type).toBe('setup.placeRoad');
    expect(asked).toBe(0);
  });

  it('never asks the duty while waiting for the answers to its own offer', () => {
    const { id, view } = actionPosition();
    const own = offerOf({ id: 'own1', give: { lumber: 1 }, want: { ore: 1 } }, id, view.windowId);
    const waiting = withHand({ ...view, offers: [own] }, id, RICH);
    let asked = 0;
    const policy = policyOf([{ id: 'fx', duty: () => (asked++, duty) }]);
    const phase = (offerPhase: 'collecting' | 'ready' | 'expired'): BotContext => ({
      ...ctxFor(id),
      offerPhases: { own1: offerPhase },
    });
    // 收集期間沒有人回應：等待（null），不是「沒事做」。
    expect(policy.decide(waiting, phase('collecting'))).toBeNull();
    expect(asked).toBe(0);
    // 逾時才撤回；撤回是策略的決定，同樣不經過 duty。
    expect(policy.decide(waiting, phase('expired'))).toEqual({ type: 'trade.withdraw', offerId: 'own1' });
    expect(asked).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TurnContext
// ---------------------------------------------------------------------------

describe('turnContext', () => {
  it('throws for an unknown seat but tolerates missing hints', () => {
    const { id, view } = actionPosition();
    expect(() => turnContext(view, ctxFor('nobody'), 'standard')).toThrow();
    const turn = turnContext({ ...view, hints: undefined }, ctxFor(id), 'easy');
    expect(turn.level).toBe('easy');
    expect(turn.me.id).toBe(id);
  });

  it('takes the module list from the profile unless one is given', () => {
    const { id, view } = actionPosition();
    expect(turnContext(view, ctxFor(id), 'standard').modules).toEqual([]);
    const module: BotModule = { id: 'fx' };
    expect(turnContext(view, ctxFor(id), 'standard', [module]).modules).toEqual([module]);
  });

  it('picks without touching the rng unless the level samples from the top candidates', () => {
    const { id, view } = actionPosition();
    const candidates = [scored('a', 1), scored('b', 3), scored('c', 2)];
    const reference = (draws: number): number => {
      const rng = seededRng(7);
      for (let i = 0; i < draws; i++) rng.int(3);
      return rng.int(1000);
    };
    const standard = turnContext(view, ctxFor(id, 'standard', 7), 'standard', []);
    expect(standard.pick(candidates)).toBe('b');
    expect(standard.pick([])).toBeNull();
    expect(standard.rng.int(1000)).toBe(reference(0));
    const easy = turnContext(view, ctxFor(id, 'easy', 7), 'easy', []);
    expect(['a', 'b', 'c']).toContain(easy.pick(candidates));
    expect(easy.pick([])).toBeNull();
    expect(easy.rng.int(1000)).toBe(reference(1));
  });

  it('keeps a null item distinguishable from an empty candidate list through choose', () => {
    const { id, view } = actionPosition();
    const turn = turnContext(view, ctxFor(id), 'standard', []);
    expect(turn.choose([])).toBeNull();
    expect(turn.choose([scored(null, 1)])).toEqual({ item: null, score: 1 });
    expect(turn.pick([scored(null, 1)])).toBeNull();
    // 同分保留原順序。
    expect(turn.choose([scored('first', 1), scored('second', 1)])?.item).toBe('first');
  });
});

// ---------------------------------------------------------------------------
// 經濟的組合
// ---------------------------------------------------------------------------

describe('economy composition', () => {
  const model = () => {
    const { id, view } = actionPosition();
    return turnContext(view, ctxFor(id), 'standard', []).model;
  };

  it('is exactly the base economy without modules', () => {
    const m = model();
    expect(economyOf(m, [], 'standard')).toEqual(economyOf(m));
    expect(Object.keys(economyOf(m).costs).sort()).toEqual(['city', 'devCard', 'road', 'settlement']);
  });

  it('merges costs and piece counts, keeping base costs and letting the first module win', () => {
    const m = model();
    const first: BotModule = {
      id: 'fx',
      economy: { costs: () => ({ ship: { lumber: 1, wool: 1 }, road: { ore: 9 } }), piecesLeft: () => ({ ships: 12, roads: 1 }) },
    };
    const second: BotModule = { id: 'fy', economy: { costs: () => ({ ship: { ore: 5 } }), piecesLeft: () => ({ ships: 3 }) } };
    const economy = economyOf(m, [first, second], 'standard');
    expect(economy.costs.ship).toEqual({ lumber: 1, wool: 1 });
    expect(economy.costs.road).toEqual({ lumber: 1, brick: 1 });
    expect(economy.left.ships).toBe(12);
    // 剩餘棋子可以覆寫 base 的鍵（例如 E&P 的聚落上限）。
    expect(economy.left.roads).toBe(1);
    expect(economy.left.cities).toBe(economyOf(m).left.cities);
  });

  it('adds module plans after the base ones on equal scores, and hands scoreExtras only the base plans', () => {
    const m = model();
    const base = economyOf(m);
    const seen: { kinds: string[]; level: string }[] = [];
    const extra = (kind: string, score: number): Plan => ({ kind: `fx.${kind}`, vertex: null, roads: [], cost: {}, nextCost: {}, value: 1, eta: 0, score });
    const first: BotModule = {
      id: 'fx',
      economy: {
        scoreExtras: ({ base: input, level }) => (
          seen.push({ kinds: input.plans.map((plan) => plan.kind), level }),
          [extra('a', base.plans[0]!.score), extra('b', base.plans[0]!.score)]
        ),
      },
    };
    const second: BotModule = { id: 'fy', economy: { scoreExtras: () => [extra('c', base.plans[0]!.score)] } };
    const economy = economyOf(m, [first, second], 'easy');
    expect(seen).toEqual([{ kinds: base.plans.map((plan) => plan.kind), level: 'easy' }]);
    const tied = economy.plans.filter((plan) => plan.score === base.plans[0]!.score).map((plan) => plan.kind);
    // base 的計畫在前；模組計畫依「模組順序，再依模組內順序」。
    expect(tied.slice(-3)).toEqual(['fx.a', 'fx.b', 'fx.c']);
    expect(tied[0]).toBe(base.plans[0]!.kind);
    expect(economy.plans.filter((plan) => !plan.kind.includes('.'))).toEqual(base.plans);
  });

  it('keeps module plan ties in module order, whatever their vertices are', () => {
    const m = model();
    const plan = (kind: `${string}.${string}`, vertex: number): Plan => ({ kind, vertex, roads: [], cost: {}, nextCost: {}, value: 1, eta: 0, score: 1000 });
    const kindsOf = (modules: readonly BotModule[]): string[] =>
      economyOf(m, modules, 'standard').plans.filter((candidate) => candidate.kind.includes('.')).map((candidate) => candidate.kind);
    // (a) 前一個模組的計畫路口編號較大，仍排在後一個模組的計畫之前。
    const early: BotModule = { id: 'fx', economy: { scoreExtras: () => [plan('fx.a', 100)] } };
    const late: BotModule = { id: 'fy', economy: { scoreExtras: () => [plan('fy.b', 1)] } };
    expect(kindsOf([early, late])).toEqual(['fx.a', 'fy.b']);
    expect(kindsOf([late, early])).toEqual(['fy.b', 'fx.a']);
    // (b) 同一個模組的計畫依插入順序，不依路口編號。
    const same: BotModule = {
      id: 'fx',
      economy: { scoreExtras: () => [plan('fx.x', 50), plan('fx.y', 5), plan('fx.z', 20)] },
    };
    expect(kindsOf([same])).toEqual(['fx.x', 'fx.y', 'fx.z']);
    // 模組計畫之間仍先比分數，路口編號不參與。
    const better: BotModule = {
      id: 'fz',
      economy: { scoreExtras: () => [{ ...plan('fz.c', 999), score: 2000 }] },
    };
    expect(kindsOf([early, late, better])).toEqual(['fz.c', 'fx.a', 'fy.b']);
  });

  it('decides which plans score immediately', () => {
    const plan = (patch: Partial<Plan>): Plan => ({ kind: 'city', vertex: 0, roads: [], cost: {}, nextCost: {}, value: 1, eta: 0, score: 1, ...patch });
    expect(isImmediate(plan({ kind: 'city' }))).toBe(true);
    expect(isImmediate(plan({ kind: 'settlement', roads: [] }))).toBe(true);
    expect(isImmediate(plan({ kind: 'settlement', roads: [3] }))).toBe(false);
    expect(isImmediate(plan({ kind: 'devCard' }))).toBe(false);
    expect(isImmediate(plan({ kind: 'longestRoad', roads: [1] }))).toBe(false);
    expect(isImmediate(plan({ kind: 'fx.island' }))).toBe(false);
    expect(isImmediate(plan({ kind: 'fx.island', immediate: true }))).toBe(true);
    expect(isImmediate(plan({ kind: 'city', immediate: false }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// botOwesAction
// ---------------------------------------------------------------------------

describe('botOwesAction', () => {
  it('follows the phase for the acting seat and is silent for everyone else', () => {
    const setup = setupPosition();
    const other = setup.view.players.find((player) => player.id !== setup.id)!.id;
    expect(botOwesAction(setup.view, setup.id)).toBe('setup');
    expect(botOwesAction(viewOf(setup.state, other), other)).toBeNull();
    const preroll = prerollPosition();
    expect(botOwesAction(preroll.view, preroll.id)).toBe('preroll');
    expect(botOwesAction(viewOf(preroll.state, other), other)).toBeNull();
    const action = actionPosition();
    expect(botOwesAction(action.view, action.id)).toBe('action');
  });

  it('owes a base frame to the one it waits for', () => {
    const { id, view } = actionPosition();
    const other = view.players.find((player) => player.id !== id)!.id;
    const discard = withPending(view, { kind: 'discard', required: { [other]: 2 }, waitingFor: [other] });
    expect(botOwesAction(discard, other)).toBe('pending');
    // 輪到行動的人不欠棄牌。
    expect(botOwesAction(discard, id)).toBeNull();
    const robber = withPending(view, { kind: 'moveRobber', actor: id, cause: 'seven' });
    expect(botOwesAction(robber, id)).toBe('pending');
    expect(botOwesAction(robber, other)).toBeNull();
    const steal = withPending(view, { kind: 'steal', actor: id, hex: 0, candidates: [other] });
    expect(botOwesAction(steal, id)).toBe('pending');
    const plenty = withPending(view, { kind: 'yearOfPlenty', actor: id, remaining: 2 });
    expect(botOwesAction(plenty, id)).toBe('pending');
    const roads = withPending(view, { kind: 'freeRoads', actor: id, remaining: 2 });
    expect(botOwesAction(roads, id)).toBe('pending');
    expect(botOwesAction(roads, other)).toBeNull();
  });

  it('owes a module frame to its first responder only', () => {
    const { id, view } = actionPosition();
    const other = view.players.find((player) => player.id !== id)!.id;
    const frame = withPending(view, { kind: 'fx.frame', module: 'fx', responders: [other, id], data: {} });
    expect(botOwesAction(frame, other)).toBe('frame');
    expect(botOwesAction(frame, id)).toBeNull();
  });

  it('owes nothing once the game is over', () => {
    const { id, view } = actionPosition();
    expect(botOwesAction({ ...view, result: { playerId: id, reason: 'victory' } }, id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 註冊表與 support：假模組只存在於獨立的模組圖裡
// ---------------------------------------------------------------------------

describe('registry and support with modules', () => {
  /** 重新載入 registry 與 support，把假模組放進這一份獨立的註冊表。 */
  async function withRegistered(modules: readonly BotModule[]) {
    vi.resetModules();
    const registry = await import('../src/modules/registry.ts');
    const map = registry.BOT_MODULES as Map<string, BotModule>;
    for (const module of modules) map.set(module.id, module);
    const support = await import('../src/support.ts');
    return { registry, support };
  }

  const profileWith = (ruleModules: readonly string[]): ProfileDefinition => ({
    ...getProfile('base-2025')!,
    ruleModules,
  });

  it('skips unregistered modules, keeps the profile order and does not check supports', async () => {
    const a: BotModule = { id: 'a', supports: () => false };
    const b: BotModule = { id: 'b' };
    const { registry } = await withRegistered([b, a]);
    expect(registry.botModulesOf({ ruleModules: ['a', 'missing', 'b', 'constructor'] })).toEqual([a, b]);
    expect(registry.botModulesOf({ ruleModules: [] })).toEqual([]);
  });

  it('seats bots only when every rules module is registered and supports the profile', async () => {
    const seen: string[] = [];
    const picky: BotModule = { id: 'picky', supports: (profile) => (seen.push(profile.id), profile.id === 'base-2025') };
    const { support } = await withRegistered([picky, { id: 'plain' }]);
    expect(support.botsCanPlay(profileWith(['plain']))).toBe(true);
    expect(support.botsCanPlay(profileWith(['plain', 'picky']))).toBe(true);
    expect(support.botsCanPlay({ ...profileWith(['picky']), id: 'other' })).toBe(false);
    expect(support.botsCanPlay(profileWith(['plain', 'missing']))).toBe(false);
    expect(seen).toEqual(['base-2025', 'other']);
    // 沒有規則模組的 profile（base）永遠可玩。
    expect(support.botsCanPlay(profileWith([]))).toBe(true);
  });

  it('merges pacing in registration order with the first module winning', async () => {
    const { support } = await withRegistered([
      { id: 'a', pacing: { 'fx.move': 500, 'fx.shared': 1 } },
      { id: 'b', pacing: { 'fx.shared': 2, 'fx.other': 700 } },
      { id: 'c' },
    ]);
    // 真正註冊的模組（Seafarers）的節奏也在裡面：只看假模組的鍵。
    const fixture = Object.fromEntries(Object.entries(support.BOT_PACING).filter(([type]) => type.startsWith('fx.')));
    expect(fixture).toEqual({ 'fx.move': 500, 'fx.shared': 1, 'fx.other': 700 });
  });

  it('takes the largest command limit among the profile modules, never below the base', async () => {
    const { support } = await withRegistered([
      { id: 'a', maxCommandsPerWindow: 80 },
      { id: 'b', maxCommandsPerWindow: 20 },
      { id: 'c' },
    ]);
    expect(support.botCommandLimit(profileWith(['a', 'b']), 40)).toBe(80);
    expect(support.botCommandLimit(profileWith(['b', 'c']), 40)).toBe(40);
    expect(support.botCommandLimit(profileWith(['b']), 10)).toBe(20);
    // 不在這個 profile 裡的模組不算。
    expect(support.botCommandLimit(profileWith(['c']), 40)).toBe(40);
    expect(support.botCommandLimit(profileWith([]), 40)).toBe(40);
  });

  it('adds the response commands of the profile modules to the base ones', async () => {
    const { support } = await withRegistered([
      { id: 'a', responseCommands: ['fx.answer', 'fx.pay'] },
      { id: 'b', responseCommands: ['fx.other'] },
    ]);
    expect(support.botResponseCommands(profileWith(['a']))).toEqual(new Set([...support.BASE_RESPONSE_COMMANDS, 'fx.answer', 'fx.pay']));
    expect(support.botResponseCommands(profileWith([]))).toEqual(support.BASE_RESPONSE_COMMANDS);
    expect(support.botResponseCommands(profileWith(['b'])).has('fx.answer')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 規則 9：無法估值的報價一律拒絕
// ---------------------------------------------------------------------------

describe('rule 9: offers the strategy cannot price', () => {
  it('prices only plain resource terms', () => {
    const offer = offerOf({}, 'a', 1);
    expect(offerTermsKnown(offer)).toBe(true);
    // 數量為 0 的欄位等於沒有。
    expect(offerTermsKnown({ ...offer, give: { lumber: 1, cloth: 0 } })).toBe(true);
    expect(offerTermsKnown({ ...offer, wantGoods: { gold: 0 } })).toBe(true);
    expect(offerTermsKnown({ ...offer, give: { cloth: 1 } })).toBe(false);
    expect(offerTermsKnown({ ...offer, want: { coin: 2 } })).toBe(false);
    expect(offerTermsKnown({ ...offer, giveGoods: { gold: 1 } })).toBe(false);
    expect(offerTermsKnown({ ...offer, wantGoods: { gold: 1 } })).toBe(false);
  });

  it('declines when answering as a non-actor, even if the base terms would be accepted', () => {
    const { id: actor, view: actorView, state } = actionPosition();
    const other = actorView.players.find((player) => player.id !== actor)!.id;
    const view = viewOf(state, other);
    // 對方白送整手牌：base 的估值一定同意。
    const gift = offerOf({ give: { lumber: 3, brick: 3, wool: 3, grain: 3, ore: 3 }, want: {} }, actor, view.windowId);
    const policy = createBotPolicy('standard');
    const answer = (offer: Offer) => policy.decide({ ...view, offers: [offer] }, ctxFor(other));
    expect(answer(gift)).toMatchObject({ type: 'trade.respond', response: 'consented' });
    expect(answer({ ...gift, giveGoods: { gold: 2 } })).toMatchObject({ type: 'trade.respond', response: 'declined' });
    expect(answer({ ...gift, wantGoods: { gold: 1 } })).toMatchObject({ type: 'trade.respond', response: 'declined' });
    expect(answer({ ...gift, give: { ...gift.give, cloth: 2 } })).toMatchObject({ type: 'trade.respond', response: 'declined' });
  });

  it('declines when it is the actor handling a counter-offer, instead of settling', () => {
    const { id: actor, view: actorView } = actionPosition();
    const other = actorView.players.find((player) => player.id !== actor)!.id;
    // 提議者要有足夠的手牌，base 才會結算。
    const view: GameView = {
      ...actorView,
      players: actorView.players.map((p) => (p.id === other ? { ...p, handSize: 20 } : p)),
    };
    const gift = offerOf({ from: other, to: actor, give: { lumber: 3, brick: 3, wool: 3, grain: 3, ore: 3 }, want: {} }, other, view.windowId);
    const policy = createBotPolicy('standard');
    const answer = (offer: Offer) => policy.decide({ ...view, offers: [offer] }, ctxFor(actor));
    expect(answer(gift)).toMatchObject({ type: 'trade.settle' });
    expect(answer({ ...gift, wantGoods: { gold: 1 } })).toMatchObject({ type: 'trade.respond', response: 'declined' });
    expect(answer({ ...gift, give: { ...gift.give, cloth: 2 } })).toMatchObject({ type: 'trade.respond', response: 'declined' });
  });
});
