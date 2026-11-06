/**
 * I9 固定盤面（SF 計畫 §4.1、§6.1）：Seafarers 的保底。
 *
 * F1 只剩船位的 freeRoads；F2 道路存量用完；F2b 道路與船都用完；F3 gold 欠 2、銀行 1；
 * F3b 銀行分散在兩種資源；F4 第一位 responder 是非行動者；F5 setup 只剩船位；F6 moveRobber。
 * （F7–F9 涉及策略，由 SF-2a、SF-2b 負責。）
 *
 * 每個保底指令都必須被 `applyCommand` 接受，而且保底、standard、easy 三種策略在這些盤面上都不會卡住。
 * 盤面用 rules 的 `seafarers-helpers` 直接建構，不使用 harness。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  isLandHex,
  projectGame,
  RESOURCES,
  seededRng,
  type Command,
  type GameState,
  type GameView,
  type ProfileDefinition,
  getProfile,
  getTopology,
} from '@catan/rules';
import { act, scriptedRng } from '../../rules/test/helpers.ts';
import { corner, emptySeafarersGame, road, seafarersGame, settle, side } from '../../rules/test/seafarers-helpers.ts';
import { fallbackDecision, fallbackPolicy, botOwesAction } from '../src/fallback.ts';
import { createBotPolicy } from '../src/policy.ts';
import {
  BASE_RESPONSE_COMMANDS,
  BOT_MODULES,
  BOT_PACING,
  botCommandLimit,
  botModulesOf,
  botResponseCommands,
  botsCanPlay,
} from '../src/support.ts';
import { seafarersDuty } from '../src/modules/seafarers/duty.ts';
import { SEAFARERS_PACING, SUPPORTED_SCENARIOS } from '../src/modules/seafarers/index.ts';
import type { BotCommand, BotContext, BotLevel, BotPolicy } from '../src/types.ts';

/** 本套件不載入 DOM／Node 型別，沒有 structuredClone；狀態與 view 都是純 JSON。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

const TEN = () => scriptedRng([3, 5]); // 4 + 6：金礦 (3,0)
const SEVEN = () => scriptedRng([2, 3]); // 3 + 4

const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 1): BotContext => ({
  selfId,
  level,
  seed,
  offerPhases: {},
});

/** 保底，加上 standard 與 easy（兩個種子）：Seafarers 的策略鉤子還是 stub，策略要靠保底不卡住。 */
const POLICIES: readonly (readonly [string, BotPolicy, BotLevel, number])[] = [
  ['fallback', fallbackPolicy, 'standard', 1],
  ['standard', createBotPolicy('standard'), 'standard', 1],
  ['easy#1', createBotPolicy('easy'), 'easy', 1],
  ['easy#2', createBotPolicy('easy'), 'easy', 2],
];

/** 指令必須被引擎接受。 */
function expectAccepted(state: GameState, actor: string, command: BotCommand | null | undefined): void {
  expect(command, `${actor} has a command`).not.toBeNull();
  const outcome = applyCommand(state, actor, command as Command, seededRng(1));
  expect(outcome.ok, `${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
}

/** 每種策略在這個盤面上都送出被接受的指令；回傳各策略的指令。 */
function expectEveryPolicyMoves(state: GameState, actor: string): BotCommand[] {
  const view = viewOf(state, actor);
  return POLICIES.map(([name, policy, level, seed]) => {
    const command = policy.decide(view, ctxFor(actor, level, seed));
    expect(command, `${name} must not stall`).not.toBeNull();
    expectAccepted(state, actor, command);
    return command!;
  });
}

/** 把玩家的道路或船補到 `count` 個（內陸西側的道路邊，或不鄰接陸地的船位），避開環形 (2,0) 一帶。 */
function fillPieces(state: GameState, playerId: string, count: number, kind: 'road' | 'ship'): void {
  const topo = getTopology(state.board.layout.topologyId);
  const near = new Set<number>();
  for (const n of [0, 1, 2, 3, 4, 5]) near.add(corner(state, 2, 0, n));
  const edges = topo.edges.flatMap((info, edge) => {
    if (state.board.roads[edge] || info.vertices.some((vertex) => near.has(vertex))) return [];
    if (kind === 'road' && info.x > 0) return [];
    const land = info.hexes.filter((hex) => isLandHex(state, hex)).length;
    return (kind === 'road' ? land === 2 : land === 0) ? [edge] : [];
  });
  expect(edges.length).toBeGreaterThanOrEqual(count);
  for (const edge of edges.slice(0, count)) state.board.roads[edge] = { player: playerId, ship: kind === 'ship' };
}

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

describe('F1: Road Building with only ship spots', () => {
  function f1() {
    const played = playRoadBuilding(roadBuildingGame(true));
    const view = viewOf(played, 'p1');
    expect(view.pending).toMatchObject({ kind: 'freeRoads', actor: 'p1', remaining: 2 });
    expect(view.hints!.legalRoads).toEqual([]);
    return { state: played, view, ships: view.hints!.modules!.seafarers as { legalShips: number[] } };
  }

  it('the duty builds the first legal ship', () => {
    const { state, view, ships } = f1();
    expect(ships.legalShips.length).toBeGreaterThan(0);
    const command = seafarersDuty(view, 'p1');
    expect(command).toEqual({ type: 'build.ship', edge: ships.legalShips[0] });
    expectAccepted(state, 'p1', command!);
    expect(fallbackDecision(view, 'p1', botModulesOf(getProfile(view.profileId)!))).toEqual(command);
  });

  it('every policy builds a ship', () => {
    const { state } = f1();
    for (const command of expectEveryPolicyMoves(state, 'p1')) expect(command.type).toBe('build.ship');
  });
});

describe('F2: Road Building after the road supply ran out', () => {
  function f2() {
    const state = roadBuildingGame(false);
    fillPieces(state, 'p1', 15, 'road');
    const played = playRoadBuilding(state);
    const view = viewOf(played, 'p1');
    expect(view.pending).toMatchObject({ kind: 'freeRoads', actor: 'p1' });
    // legalRoads 不扣存量：它還是有值，送出會得到 E_NO_PIECES。
    expect(view.hints!.legalRoads.length).toBeGreaterThan(0);
    const roadOutcome = applyCommand(played, 'p1', { type: 'build.road', edge: view.hints!.legalRoads[0]! }, seededRng(1));
    expect(roadOutcome.ok ? 'ok' : roadOutcome.error.code).toBe('E_NO_PIECES');
    return { state: played, view, ships: view.hints!.modules!.seafarers as { legalShips: number[] } };
  }

  it('the duty builds a ship instead of the rejected road', () => {
    const { state, view, ships } = f2();
    const command = seafarersDuty(view, 'p1');
    expect(command).toEqual({ type: 'build.ship', edge: ships.legalShips[0] });
    expectAccepted(state, 'p1', command!);
  });

  it('every policy builds a ship, never the road', () => {
    const { state } = f2();
    for (const command of expectEveryPolicyMoves(state, 'p1')) expect(command.type).toBe('build.ship');
  });

  it('with road supply left and a legal road, the duty keeps building the road', () => {
    const played = playRoadBuilding(roadBuildingGame(false));
    const view = viewOf(played, 'p1');
    expect(seafarersDuty(view, 'p1')).toEqual({ type: 'build.road', edge: view.hints!.legalRoads[0] });
    for (const command of expectEveryPolicyMoves(played, 'p1')) expect(['build.road', 'build.ship']).toContain(command.type);
  });
});

describe('F2b: both supplies ran out', () => {
  function f2b() {
    const state = roadBuildingGame(false);
    fillPieces(state, 'p1', 15, 'road');
    const played = playRoadBuilding(state);
    fillPieces(played, 'p1', 15, 'ship');
    return played;
  }

  it('the frame is no longer projected, and every policy ends the turn', () => {
    const state = f2b();
    const view = viewOf(state, 'p1');
    expect(view.pending).toBeNull();
    expect(view.hints!.canEndTurn).toBe(true);
    expect(seafarersDuty(view, 'p1')).toBeUndefined();
    for (const command of expectEveryPolicyMoves(state, 'p1')) expect(command).toEqual({ type: 'turn.end' });
  });
});

/** 在 (3,0)（金礦、點數 10）旁放建築，由 `roller` 擲出 10。 */
function goldRoll(roller: string, build: (state: GameState) => void): GameState {
  const seat = Number(roller.slice(1)) - 1;
  const state = emptySeafarersGame(4, seat, 'preroll');
  build(state);
  return act(state, roller, { type: 'turn.roll' }, TEN()).state;
}

const gold = (state: GameState, corner_: number) => corner(state, 3, 0, corner_);

describe('F3: gold owed 2 with 1 card in the bank', () => {
  function f3() {
    const state = emptySeafarersGame(4, 0, 'preroll');
    settle(state, 'p2', gold(state, 0), true); // 城市：欠 2 張
    state.bank = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 1 };
    return act(state, 'p1', { type: 'turn.roll' }, TEN()).state;
  }

  it('takes what the bank has', () => {
    const state = f3();
    const view = viewOf(state, 'p2');
    expect(view.pending).toMatchObject({ kind: 'seafarers.gold', responders: ['p2'] });
    expect(view.hints!.modules!.seafarers).toMatchObject({ goldRequired: 1 });
    const command = seafarersDuty(view, 'p2');
    expect(command).toEqual({ type: 'gold.choose', resources: ['ore'] });
    expectAccepted(state, 'p2', command!);
  });

  it('every policy answers with the same single card', () => {
    const state = f3();
    for (const command of expectEveryPolicyMoves(state, 'p2')) {
      expect(command).toEqual({ type: 'gold.choose', resources: ['ore'] });
    }
  });
});

describe('F3b: gold owed 3, the bank split across two resources', () => {
  function f3b() {
    const state = emptySeafarersGame(4, 0, 'preroll');
    settle(state, 'p2', gold(state, 0), true);
    settle(state, 'p2', gold(state, 2));
    state.bank = { lumber: 0, brick: 0, wool: 1, grain: 0, ore: 1 };
    return act(state, 'p1', { type: 'turn.roll' }, TEN()).state;
  }

  it('fills the requirement in RESOURCES order without exceeding any stock', () => {
    const state = f3b();
    const view = viewOf(state, 'p2');
    expect(view.pending).toMatchObject({ kind: 'seafarers.gold', responders: ['p2'], data: { picks: { p2: 3 } } });
    expect(view.hints!.modules!.seafarers).toMatchObject({ goldRequired: 2 });
    const command = seafarersDuty(view, 'p2');
    expect(command).toEqual({ type: 'gold.choose', resources: ['wool', 'ore'] });
    expectAccepted(state, 'p2', command!);
  });

  it('every policy answers with wool and ore', () => {
    for (const command of expectEveryPolicyMoves(f3b(), 'p2')) {
      expect(command).toEqual({ type: 'gold.choose', resources: ['wool', 'ore'] });
    }
  });

  it('a full bank takes the first resources in order', () => {
    const state = goldRoll('p1', (s) => settle(s, 'p1', gold(s, 0), true));
    const view = viewOf(state, 'p1');
    expect(seafarersDuty(view, 'p1')).toEqual({ type: 'gold.choose', resources: ['lumber', 'lumber'] });
    expectEveryPolicyMoves(state, 'p1');
  });
});

describe('F4: gold with a first responder who is not the actor', () => {
  // p4 擲骰，p4 沒有金礦；順序 p4、p1、p2、p3，所以 responders 是 [p1, p2]。
  function f4() {
    return goldRoll('p4', (s) => {
      settle(s, 'p1', gold(s, 0));
      settle(s, 'p2', gold(s, 2));
    });
  }

  it('only the first responder answers', () => {
    const state = f4();
    expect(viewOf(state, 'p1').pending).toMatchObject({ kind: 'seafarers.gold', responders: ['p1', 'p2'] });
    const first = viewOf(state, 'p1');
    const second = viewOf(state, 'p2');
    const command = seafarersDuty(first, 'p1');
    expect(command).toMatchObject({ type: 'gold.choose' });
    expectAccepted(state, 'p1', command!);
    expect(seafarersDuty(second, 'p2')).toBeNull();
    // 骨架：保底與 botOwesAction 也都只認第一位。
    expect(botOwesAction(first, 'p1')).toBe('frame');
    expect(botOwesAction(second, 'p2')).toBeNull();
  });

  it('every policy answers for the first responder and stays silent for the second', () => {
    const state = f4();
    expectEveryPolicyMoves(state, 'p1');
    for (const [name, policy, level, seed] of POLICIES) {
      expect(policy.decide(viewOf(state, 'p2'), ctxFor('p2', level, seed)), `${name} p2`).toBeNull();
      // 非 responder 的座位（擲骰者 p4 沒有金礦）也不動作。
      expect(policy.decide(viewOf(state, 'p4'), ctxFor('p4', level, seed)), `${name} p4`).toBeNull();
    }
  });

  it('after the first answer the second becomes the responder', () => {
    const state = f4();
    const next = act(state, 'p1', seafarersDuty(viewOf(state, 'p1'), 'p1') as Command).state;
    expect(viewOf(next, 'p2').pending).toMatchObject({ responders: ['p2'] });
    expectAccepted(next, 'p2', seafarersDuty(viewOf(next, 'p2'), 'p2'));
  });
});

describe('F5: setup road stage with only ship spots', () => {
  function f5() {
    const { state } = seafarersGame(4);
    const e = k3Edges(state);
    const placed = act(state, 'p1', { type: 'setup.placeBuilding', vertex: e.k3 }).state;
    road(placed, 'p2', e.W);
    road(placed, 'p2', e.E1);
    const view = viewOf(placed, 'p1');
    expect(view.turn.setup).toMatchObject({ stage: 'road' });
    expect(view.hints!.legalRoads).toEqual([]);
    expect((view.hints!.modules!.seafarers as { setupShips: number[] }).setupShips).toEqual([e.NW]);
    return { state: placed, view, e };
  }

  it('the duty places the first setup ship', () => {
    const { state, view, e } = f5();
    const command = seafarersDuty(view, 'p1');
    expect(command).toEqual({ type: 'setup.placeShip', edge: e.NW });
    expectAccepted(state, 'p1', command!);
  });

  it('every policy places the ship', () => {
    const { state, e } = f5();
    for (const command of expectEveryPolicyMoves(state, 'p1')) {
      expect(command).toEqual({ type: 'setup.placeShip', edge: e.NW });
    }
  });

  it('with a legal road the road comes first, and a ship is the only alternative', () => {
    const { state } = seafarersGame(4);
    const e = k3Edges(state);
    const placed = act(state, 'p1', { type: 'setup.placeBuilding', vertex: e.k3 }).state;
    const view = viewOf(placed, 'p1');
    expect(view.hints!.legalRoads.length).toBeGreaterThan(0);
    expect(seafarersDuty(view, 'p1')).toEqual({ type: 'setup.placeRoad', edge: view.hints!.legalRoads[0] });
    for (const command of expectEveryPolicyMoves(placed, 'p1')) expect(['setup.placeRoad', 'setup.placeShip']).toContain(command.type);
  });

  it('the setup building stage is base business', () => {
    const { state } = seafarersGame(4);
    const view = viewOf(state, 'p1');
    expect(seafarersDuty(view, 'p1')).toBeUndefined();
    expect(fallbackPolicy.decide(view, ctxFor('p1'))).toEqual({ type: 'setup.placeBuilding', vertex: view.hints!.legalSettlements[0] });
    expectEveryPolicyMoves(state, 'p1');
  });
});

describe('F6: moveRobber on a board with sea', () => {
  function f6() {
    const state = emptySeafarersGame(4, 0, 'preroll');
    const rolled = act(state, 'p1', { type: 'turn.roll' }, SEVEN()).state;
    const view = viewOf(rolled, 'p1');
    expect(view.pending).toMatchObject({ kind: 'moveRobber', actor: 'p1' });
    return { state: rolled, view };
  }

  it('the fallback moves the robber to the first land hex, never the pirate', () => {
    const { state, view } = f6();
    const hex = view.board.terrain.findIndex((terrain, index) => index !== view.board.robber && terrain !== 'sea');
    const command = fallbackPolicy.decide(view, ctxFor('p1'));
    expect(command).toEqual({ type: 'pending.moveRobber', hex });
    expect(view.board.terrain[hex]).not.toBe('sea');
    expectAccepted(state, 'p1', command);
    // SF 的 duty 不處理 base 的 moveRobber。
    expect(seafarersDuty(view, 'p1')).toBeUndefined();
  });

  it('every policy moves the robber to a land hex', () => {
    const { state, view } = f6();
    for (const command of expectEveryPolicyMoves(state, 'p1')) {
      expect(command.type).toBe('pending.moveRobber');
      expect(view.board.terrain[(command as { hex: number }).hex]).not.toBe('sea');
    }
  });
});

describe('the duty never throws', () => {
  /**
   * 一組異常的 view。`realistic` 是 server 可能真的送來的缺漏（沒有 hints 或模組項目、responders 為空、
   * 查不到 profile…），整個保底都不得因此 throw；其餘是型別被破壞的 view，只要求 SF 的 duty 不 throw。
   */
  function mutations(view: GameView): readonly (readonly [string, GameView, boolean])[] {
    const out: (readonly [string, GameView, boolean])[] = [];
    const add = (name: string, realistic: boolean, patch: (v: GameView) => void): void => {
      const v = clone(view);
      patch(v);
      out.push([name, v, realistic]);
    };
    const loose = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
    add('no hints', true, (v) => void delete v.hints);
    add('no hints.modules', true, (v) => void delete v.hints?.modules);
    add('empty hints.modules', true, (v) => void (v.hints!.modules = {}));
    add('seafarers hints null', true, (v) => void (v.hints!.modules = { seafarers: null }));
    add('seafarers hints empty object', true, (v) => void (v.hints!.modules = { seafarers: {} }));
    add('no modules', true, (v) => void delete v.modules);
    add('unknown profile', true, (v) => void (v.profileId = 'no-such-profile'));
    add('no turn.setup', true, (v) => void (v.turn.setup = null));
    add('game over', true, (v) => void (v.result = { playerId: 'p1', reason: 'victory' }));
    add('pending null', true, (v) => void (v.pending = null));
    add('seafarers hints with wrong types', false, (v) => void (v.hints!.modules = { seafarers: { legalShips: 3, setupShips: 'x', goldRequired: 'many' } }));
    add('no legalRoads', false, (v) => void delete loose(v.hints).legalRoads);
    add('no bank', false, (v) => void delete loose(v).bank);
    add('negative bank', false, (v) => void (v.bank = { lumber: -1, brick: NaN, wool: 2.5, grain: 0, ore: 1 }));
    add('no board roads', false, (v) => void (v.board.roads = []));
    add('unknown phase', false, (v) => void (v.turn.phase = 'nonsense'));
    add('setup road stage', false, (v) => void (v.turn = { ...v.turn, phase: 'setup', setup: { seat: 0, stage: 'road', round: 1, remaining: 1 } }));
    if (view.pending && 'responders' in view.pending) {
      add('unknown module frame', true, (v) => void ((v.pending as { kind: string }).kind = 'nobody.frame'));
      add('responders empty', true, (v) => void ((v.pending as { responders: string[] }).responders = []));
      add('responders missing', false, (v) => void delete loose(v.pending).responders);
      add('data missing', false, (v) => void delete loose(v.pending).data);
      add('data without picks', false, (v) => void ((v.pending as { data: unknown }).data = {}));
      add('picks not numbers', false, (v) => void ((v.pending as { data: unknown }).data = { picks: { p2: 'x', p1: null } }));
    }
    return out;
  }

  const fixtures: readonly (readonly [string, () => GameState, string])[] = [
    ['gold frame', () => goldRoll('p1', (s) => settle(s, 'p1', gold(s, 0), true)), 'p1'],
    ['gold owed by the second responder', () => goldRoll('p4', (s) => { settle(s, 'p1', gold(s, 0)); settle(s, 'p2', gold(s, 2)); }), 'p2'],
    ['free roads', () => playRoadBuilding(roadBuildingGame(true)), 'p1'],
    ['setup road', () => act(seafarersGame(4).state, 'p1', { type: 'setup.placeBuilding', vertex: k3Edges(seafarersGame(4).state).k3 }).state, 'p1'],
    ['moveRobber', () => act(emptySeafarersGame(4, 0, 'preroll'), 'p1', { type: 'turn.roll' }, SEVEN()).state, 'p1'],
    ['action phase', () => emptySeafarersGame(4, 0, 'action'), 'p1'],
  ];

  it.each(fixtures)('on odd views of the %s state', (_name, build, actor) => {
    const view = viewOf(build(), actor);
    expect(() => seafarersDuty(view, actor)).not.toThrow();
    for (const [name, odd, realistic] of mutations(view)) {
      for (const self of [actor, 'p3', 'nobody']) {
        expect(() => seafarersDuty(odd, self), `${name} / ${self}`).not.toThrow();
        if (!realistic) continue;
        // 保底整體（server 的保底呼叫不在 try 裡）：查不到 profile 時用空清單，其餘用註冊的模組。
        expect(() => fallbackPolicy.decide(odd, ctxFor(self)), `${name} / ${self} fallback`).not.toThrow();
        expect(() => botOwesAction(odd, self), `${name} / ${self} owes`).not.toThrow();
      }
    }
  });

  it('returns undefined for what is not its business', () => {
    const preroll = viewOf(emptySeafarersGame(4, 0, 'preroll'), 'p1');
    const action = viewOf(emptySeafarersGame(4, 0, 'action'), 'p1');
    expect(seafarersDuty(preroll, 'p1')).toBeUndefined();
    expect(seafarersDuty(action, 'p1')).toBeUndefined();
    const discard = viewOf(act(emptySeafarersGame(4, 0, 'preroll'), 'p1', { type: 'turn.roll' }, SEVEN()).state, 'p1');
    expect(seafarersDuty(discard, 'p1')).toBeUndefined();
    const foreign = clone(viewOf(goldRoll('p1', (s) => settle(s, 'p1', gold(s, 0))), 'p1'));
    (foreign.pending as { kind: string }).kind = 'citiesKnights.barbarians';
    expect(seafarersDuty(foreign, 'p1')).toBeUndefined();
  });

  it('answers nothing in a finished game and when someone else owes the free road', () => {
    const view = viewOf(playRoadBuilding(roadBuildingGame(true)), 'p1');
    expect(seafarersDuty(view, 'p2')).toBeUndefined();
    const over = { ...clone(view), result: { playerId: 'p1', reason: 'victory' } } as GameView;
    expect(seafarersDuty(over, 'p1')).toBeUndefined();
  });
});

describe('module registration (SF-1)', () => {
  const profiles = ['sf-new-shores-2025', 'sf-new-shores-paired-2025'].map((id) => getProfile(id) as ProfileDefinition);

  it('registers the seafarers module for both profiles', () => {
    expect(BOT_MODULES.get('seafarers')).toBeDefined();
    for (const profile of profiles) expect(botModulesOf(profile).map((module) => module.id)).toEqual(['seafarers']);
  });

  it('does not open the profiles yet: no scenario is supported until SF-4', () => {
    expect(SUPPORTED_SCENARIOS).toEqual([]);
    for (const profile of profiles) {
      expect(profile.scenario).toBe('new-shores');
      expect(BOT_MODULES.get('seafarers')!.supports!(profile)).toBe(false);
      expect(botsCanPlay(profile)).toBe(false);
    }
  });

  it('merges the planned pacing, keeps the window limit and lets gold responders answer', () => {
    expect(SEAFARERS_PACING).toEqual({ 'build.ship': 900, 'setup.placeShip': 600, 'ship.move': 700, 'gold.choose': 800 });
    for (const [type, ms] of Object.entries(SEAFARERS_PACING)) expect(BOT_PACING[type]).toBe(ms);
    expect(BOT_MODULES.get('seafarers')!.maxCommandsPerWindow).toBeUndefined();
    for (const profile of profiles) expect(botCommandLimit(profile, 40)).toBe(40);
    for (const profile of profiles) {
      expect([...botResponseCommands(profile)].sort()).toEqual([...BASE_RESPONSE_COMMANDS, 'gold.choose'].sort());
    }
    // 其他 profile 不受影響。
    expect(botResponseCommands(getProfile('base-2025')!)).toEqual(BASE_RESPONSE_COMMANDS);
  });

  it('hooks nothing the skeleton never calls', () => {
    const module = BOT_MODULES.get('seafarers')!;
    for (const hook of ['phase', 'endWindow', 'robberTargets', 'rescore', 'trade'] as const) expect(hook in module).toBe(false);
    for (const hook of ['awards', 'cardKinds', 'rates', 'weights', 'hexYield', 'vertexBlocker', 'siteBlocked', 'routeEdge']) {
      expect(module.economy && hook in module.economy).toBeFalsy();
    }
  });

  it('keeps the gold frame resolvable in every resource order', () => {
    // 銀行只剩一種資源時，湊滿欠額也不會超過存量。
    for (const resource of RESOURCES) {
      const state = emptySeafarersGame(4, 0, 'preroll');
      settle(state, 'p2', gold(state, 0), true);
      state.bank = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, [resource]: 2 };
      const rolled = act(state, 'p1', { type: 'turn.roll' }, TEN()).state;
      const command = seafarersDuty(viewOf(rolled, 'p2'), 'p2');
      expect(command).toEqual({ type: 'gold.choose', resources: [resource, resource] });
      expectAccepted(rolled, 'p2', command);
    }
  });
});
