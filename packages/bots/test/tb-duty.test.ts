/**
 * I9 固定盤面（T&B 計畫 §4.1、§6.1；S2）：T&B 保底表的 17 列，加上回合結束時排入的 frame（`onEndTurn` defer）與依序
 * 回應的多 responder frame。
 *
 * 盤面以 rules 的測試工具（`tbPlayable`、`forceTurn`、`setHand`）建好，再用真實指令推進到該 frame；只有指令推不到的
 * 狀態（BA 牌庫的下一張、Traders 的 Swift Journey）才直接改 part 狀態。每個保底指令都必須被 `applyCommand` 接受；
 * standard 與 easy 在 S2 還沒有 part 策略，它們回答 T&B frame 時走同一個保底，所以也一併斷言不會卡住。
 *
 * 最後 8 個 profile 各跑一次「全部座位只走保底」的有界局（3、4 人各 1 個種子，800 步）：gating 關著也能跑，因為
 * `fallbackPolicy` 依 profile 直接取註冊的模組（不看 `botsCanPlay`）。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  projectGame,
  seededRng,
  topologyOf,
  type Command,
  type GameState,
  type GameView,
  type PublicModulePendingView,
  type Rng,
} from '@catan/rules';
import { placeRoad, scriptedRng, setHand } from '../../rules/test/helpers.ts';
import { clearBoard, tbCreate, tbPlayable } from '../../rules/test/tb-helpers.ts';
import { pendingDuty } from '../src/base/duty.ts';
import { botOwesAction, fallbackDecision, fallbackPolicy } from '../src/fallback.ts';
import { botModulesOf } from '../src/modules/registry.ts';
import { tradersBarbariansDuty } from '../src/modules/tradersBarbarians/duty.ts';
import { isMine, TB_END_TURN_FRAMES, TB_FRAME_KINDS, TB_FRAMES } from '../src/modules/tradersBarbarians/frames.ts';
import { edgeDistances, edgesTo, pathTo, vertexPaths, wagonStepCost } from '../src/modules/tradersBarbarians/graph.ts';
import { tbPartView, tbRobberHexes } from '../src/modules/tradersBarbarians/view.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotCommand, BotContext, BotLevel, BotPolicy } from '../src/types.ts';
import { ALL_FALLBACK_STEPS, GAME_TIMEOUT, runBotGame, type BotSeat } from './harness.ts';
import { tradersBarbariansKit } from './modules/tradersBarbarians.ts';
import { partStateOf } from './modules/tb/part.ts';

const FR = 'tb-friendly-robber-2025';
const FISHING = 'tb-fishing-2025';
const TRAINS = 'tb-merchant-trains-2025';
const BA = 'tb-barbarian-attack-2025';
const TRADERS = 'tb-traders-barbarians-2025';

function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 1): BotContext => ({
  selfId,
  level,
  seed,
  offerPhases: {},
});

const POLICIES: readonly (readonly [string, BotPolicy, BotLevel])[] = [
  ['standard', createBotPolicy('standard'), 'standard'],
  ['easy', createBotPolicy('easy'), 'easy'],
];

/** 指令被引擎接受；回傳套用後的狀態。 */
function accept(state: GameState, actor: string, command: BotCommand | null | undefined, rng: Rng = seededRng(5)): GameState {
  expect(command, `${actor} has a command`).toBeTruthy();
  const outcome = applyCommand(state, actor, command as Command, rng);
  if (!outcome.ok) expect.fail(`${JSON.stringify(command)} → ${outcome.error.code} ${JSON.stringify(outcome.error.params)}`);
  return outcome.state;
}

/**
 * `actor` 欠動作：模組的 duty、保底與 standard／easy 都送出同一個被接受的指令（S2 沒有 part 策略），其他座位的保底
 * 都回 null。`type` 是預期的指令；回傳套用保底指令後的狀態。
 */
function dutyStep(state: GameState, actor: string, type: string, rng?: Rng): GameState {
  const view = viewOf(state, actor);
  const modules = botModulesOf({ ruleModules: ['tradersBarbarians'] });
  const command = fallbackDecision(view, actor, modules);
  expect(command?.type, `${actor} fallback`).toBe(type);
  expect(fallbackPolicy.decide(view, ctxFor(actor))).toEqual(command);
  expect(botOwesAction(view, actor), `${actor} owes an action`).not.toBeNull();
  for (const [name, policy, level] of POLICIES) {
    const answer = policy.decide(view, ctxFor(actor, level));
    expect(answer, `${name} must not stall`).not.toBeNull();
    accept(state, actor, answer, seededRng(5));
  }
  for (const other of state.players.map((player) => player.id).filter((id) => id !== actor)) {
    expect(fallbackPolicy.decide(viewOf(state, other), ctxFor(other)), `${other} stays idle`).toBeNull();
  }
  return accept(state, actor, command, rng ?? seededRng(5));
}

/** 模組 frame 進行中的 frame（投影）。 */
function frameOf(state: GameState, viewer = 'p1'): PublicModulePendingView {
  const pending = viewOf(state, viewer).pending;
  expect(pending && 'module' in pending, 'a module frame is pending').toBe(true);
  return pending as PublicModulePendingView;
}

/** 各資源的手牌加銀行總量。 */
const resourceTotals = (state: GameState): Record<string, number> =>
  Object.fromEntries(
    (['lumber', 'brick', 'wool', 'grain', 'ore'] as const).map((resource) => [
      resource,
      state.bank[resource] + state.players.reduce((total, player) => total + player.resources[resource], 0),
    ]),
  );

/** 擲出指定點數（兩顆骰子的 `rng.int(6)` 值）。 */
const dice = (total: number): Rng => {
  const first = Math.max(1, Math.min(6, total - 1));
  return scriptedRng([first - 1, total - first - 1]);
};

/** 擲出 7 並處理完棄牌之後的狀態（每人手牌都設在 7 張以內）。 */
function rolledSeven(profileId: string, seed: number, hands: Record<string, Parameters<typeof setHand>[2]> = {}): GameState {
  const state = tbPlayable(profileId, { seed, phase: 'preroll' });
  for (const player of state.players) setHand(state, player.id, hands[player.id] ?? {});
  return accept(state, 'p1', { type: 'turn.roll' }, dice(7));
}

// ---------------------------------------------------------------------------
// 資格判定（P3）
// ---------------------------------------------------------------------------

describe('T&B frame eligibility (P3)', () => {
  const frame = (kind: string, responders: string[]): PublicModulePendingView =>
    ({ kind, module: 'tradersBarbarians', responders, data: {} }) as PublicModulePendingView;

  it('covers the 12 rules frames; three of them are queued at the end of the turn', () => {
    expect(TB_FRAMES).toHaveLength(12);
    expect([...TB_END_TURN_FRAMES].sort()).toEqual(
      [TB_FRAME_KINDS.wagonBid, TB_FRAME_KINDS.baKnights, TB_FRAME_KINDS.tbWagon].sort(),
    );
  });

  it('answers sequential frames only as responders[0]; the simultaneous wagonAssign by includes, the duty still by responders[0]', () => {
    for (const kind of TB_FRAMES) {
      const queued = frame(kind, ['p2', 'p3']);
      expect(isMine(queued, 'p2'), kind).toBe(true);
      expect(isMine(queued, 'p2', 'duty'), kind).toBe(true);
      expect(isMine(queued, 'p3', 'duty'), kind).toBe(false);
      expect(isMine(queued, 'p3'), kind).toBe(kind === TB_FRAME_KINDS.wagonAssign);
      expect(isMine(queued, 'p1'), kind).toBe(false);
    }
  });

  it('leaves frames of other modules and base duties to others, and never throws', () => {
    const state = tbPlayable(BA, { seed: 3 });
    const view = viewOf(state, 'p1');
    expect(tradersBarbariansDuty(view, 'p1')).toBeUndefined();
    expect(tradersBarbariansDuty({ ...view, pending: frame('citiesKnights.pillage', ['p1']) } as GameView, 'p1')).toBeUndefined();
    // 自己的 T&B frame 但輪不到自己：歸我管、不送指令。
    expect(tradersBarbariansDuty({ ...view, pending: frame(TB_FRAME_KINDS.baSteal, ['p2']) } as GameView, 'p1')).toBeNull();
    // 形狀不明的投影：不 throw。
    const broken = { ...view, pending: frame(TB_FRAME_KINDS.baKnights, ['p1']), hints: { modules: 7 } } as unknown as GameView;
    expect(() => tradersBarbariansDuty(broken, 'p1')).not.toThrow();
    expect(tradersBarbariansDuty(broken, 'p1')).toEqual({ type: 'tb.endKnights' });
    const garbage = { pending: { kind: TB_FRAME_KINDS.tbWagon, responders: ['p1'] }, players: null } as unknown as GameView;
    expect(() => tradersBarbariansDuty(garbage, 'p1')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 保底表（§4.1）
// ---------------------------------------------------------------------------

describe('row 1: fishSwap', () => {
  it('declines the swap for a non-active player at the token limit', () => {
    const state = tbPlayable(FISHING, { seed: 4, phase: 'preroll' });
    const slot = partStateOf<{ grounds: { number: number; vertices: number[] }[]; hands: Record<string, number[]> }>(
      state,
      'tb-fishing',
    )!;
    state.board.buildings = state.board.buildings.map(() => null);
    const ground = slot.grounds.find((candidate) => candidate.number !== 7)!;
    state.board.buildings[ground.vertices[0]!] = { player: 'p2', city: false };
    slot.hands.p2 = [1, 1, 1, 1, 1, 1, 1];
    const rolled = accept(state, 'p1', { type: 'turn.roll' }, dice(ground.number));
    expect(frameOf(rolled)).toMatchObject({ kind: TB_FRAME_KINDS.fishSwap, responders: ['p2'] });
    expect(tradersBarbariansDuty(viewOf(rolled, 'p2'), 'p2')).toEqual({ type: 'tb.fishSwap', token: null });
    const after = dutyStep(rolled, 'p2', 'tb.fishSwap');
    expect(after.pending).toBeNull();
    expect(after.turn.phase).toBe('action');
  });
});

/** Trains：p1 蓋一座聚落（收集一節車廂）後結束回合，投票 frame 在回合結束時排入（`onEndTurn` defer）。 */
function voting(seed: number, bids: Record<string, Parameters<typeof setHand>[2]> = {}): GameState {
  const state = tbPlayable(TRAINS, { seed });
  for (const player of state.players) setHand(state, player.id, bids[player.id] ?? {});
  const topology = topologyOf(state);
  const vertex = topology.vertices.findIndex(
    (info, index) =>
      !state.board.buildings[index] &&
      info.edges.every((edge) => topology.edges[edge]!.vertices.every((other) => !state.board.buildings[other])),
  );
  placeRoad(state, 'p1', topology.vertices[vertex]!.edges[0]!);
  setHand(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1, ...bids.p1 });
  const built = accept(state, 'p1', { type: 'build.settlement', vertex });
  // 回合結束：先有投標 frame，回合還沒換人。
  const ended = accept(built, 'p1', { type: 'turn.end' });
  expect(ended.turn.seat).toBe(0);
  return ended;
}

describe('rows 2–4: Merchant Trains voting (onEndTurn defer, sequential multi-responder)', () => {
  it('row 2: bids 0 in table order; only responders[0] owes the bid; row 4: the active player places', () => {
    let state = voting(6);
    expect(frameOf(state)).toMatchObject({ kind: TB_FRAME_KINDS.wagonBid, responders: ['p1', 'p2', 'p3', 'p4'] });
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      // 依序作答：還沒輪到的座位不欠動作，策略也不作答。
      for (const later of state.players.map((player) => player.id).filter((other) => other !== id)) {
        expect(botOwesAction(viewOf(state, later), later), `${later} waits for ${id}`).toBeNull();
        expect(createBotPolicy('standard').decide(viewOf(state, later), ctxFor(later)), `${later} waits`).toBeNull();
      }
      expect(tradersBarbariansDuty(viewOf(state, id), id)).toEqual({ type: 'tb.bidWagon', wool: 0, grain: 0 });
      state = dutyStep(state, id, 'tb.bidWagon');
    }
    // 沒有人出價：行動者放置。
    expect(frameOf(state)).toMatchObject({ kind: TB_FRAME_KINDS.wagonPlace, responders: ['p1'] });
    state = dutyStep(state, 'p1', 'tb.placeWagon');
    expect(partStateOf<{ wagons: unknown[] }>(state, 'tb-merchant-trains')!.wagons).toHaveLength(1);
    // 投票結束後才換人。
    expect(state.pending).toBeNull();
    expect(state.turn.seat).toBe(1);
  });

  it('row 3: the simultaneous assignment — strategy eligibility by includes, the duty one responder at a time', () => {
    let state = voting(6, { p2: { grain: 1 }, p3: { grain: 1 } });
    state = dutyStep(state, 'p1', 'tb.bidWagon');
    // 出價者自己的投標指令：保底出 0（不花 wool 與 grain），所以這裡以真實指令出價 1，製造沒有多數的局面。
    state = accept(state, 'p2', { type: 'tb.bidWagon', wool: 0, grain: 1 });
    state = accept(state, 'p3', { type: 'tb.bidWagon', wool: 0, grain: 1 });
    state = dutyStep(state, 'p4', 'tb.bidWagon');
    const frame = frameOf(state);
    expect(frame).toMatchObject({ kind: TB_FRAME_KINDS.wagonAssign, responders: ['p2', 'p3'] });
    expect(isMine(frame, 'p3')).toBe(true);
    expect(isMine(frame, 'p3', 'duty')).toBe(false);
    // 保底保守：第二位出價者在第一位作答前不動作（P3）；S2 沒有 part 策略，standard 也就沒有東西可答。
    expect(tradersBarbariansDuty(viewOf(state, 'p3'), 'p3')).toBeNull();
    expect(fallbackPolicy.decide(viewOf(state, 'p3'), ctxFor('p3'))).toBeNull();
    const targets = viewOf(state, 'p2').hints!.modules!.tradersBarbarians as { board: { targets: number[] } };
    expect(tradersBarbariansDuty(viewOf(state, 'p2'), 'p2')).toEqual({ type: 'tb.assignWagon', edge: targets.board.targets[0] });
    state = dutyStep(state, 'p2', 'tb.assignWagon');
    expect(frameOf(state)).toMatchObject({ kind: TB_FRAME_KINDS.wagonAssign, responders: ['p3'] });
    state = dutyStep(state, 'p3', 'tb.assignWagon');
    // 兩人都分給同一個位置：直接放置，投票結束、換人。
    expect(state.pending).toBeNull();
    expect(state.turn.seat).toBe(1);
    expect(partStateOf<{ wagons: { edge: number }[] }>(state, 'tb-merchant-trains')!.wagons.map((wagon) => wagon.edge)).toEqual([
      targets.board.targets[0],
    ]);
  });

  it('row 4: a non-active majority holder places the wagon', () => {
    let state = voting(6, { p3: { grain: 3 } });
    const totals = resourceTotals(state);
    state = dutyStep(state, 'p1', 'tb.bidWagon');
    state = dutyStep(state, 'p2', 'tb.bidWagon');
    state = accept(state, 'p3', { type: 'tb.bidWagon', wool: 0, grain: 3 });
    state = dutyStep(state, 'p4', 'tb.bidWagon');
    expect(frameOf(state)).toMatchObject({ kind: TB_FRAME_KINDS.wagonPlace, responders: ['p3'] });
    state = dutyStep(state, 'p3', 'tb.placeWagon');
    expect(state.pending).toBeNull();
    // 投標中的 grain 回到銀行（`setHand` 本身不守恆，所以比對前後的總量）。
    expect(resourceTotals(state)).toEqual(totals);
  });
});

/** BA：p1 在行動階段買 BA 卡，牌庫只剩 `card`。 */
function baCard(card: string, seed = 9, prepare?: (state: GameState) => void): GameState {
  const state = tbPlayable(BA, { seed });
  const slot = partStateOf<{ deck: string[]; discard: string[]; barbarians: Record<number, number>; coastal: number[] }>(
    state,
    'tb-barbarian-attack',
  )!;
  slot.discard = [...slot.discard, ...slot.deck.filter((_, index) => index > 0)];
  slot.deck = [card];
  setHand(state, 'p1', { wool: 1, grain: 1, ore: 1 });
  prepare?.(state);
  return accept(state, 'p1', { type: 'tb.buildBaCard' });
}

describe('rows 5–10: Barbarian Attack', () => {
  it('row 5: the roller steals from the first player with cards', () => {
    const state = rolledSeven(BA, 9, { p3: { wool: 1 } });
    expect(frameOf(state)).toMatchObject({ kind: TB_FRAME_KINDS.baSteal, responders: ['p1'] });
    expect(tradersBarbariansDuty(viewOf(state, 'p1'), 'p1')).toEqual({ type: 'tb.baSteal', victim: 'p3' });
    const after = dutyStep(state, 'p1', 'tb.baSteal');
    expect(after.pending).toBeNull();
  });

  it('row 6: Capture takes a barbarian from the first coastal hex that has one', () => {
    const state = baCard('capture');
    expect(frameOf(state)).toMatchObject({ kind: TB_FRAME_KINDS.baCapture, responders: ['p1'] });
    const after = dutyStep(state, 'p1', 'tb.baCapture');
    expect(partStateOf<{ prisoners: Record<string, number> }>(after, 'tb-barbarian-attack')!.prisoners.p1).toBe(1);
  });

  it('rows 7–8: Knighthood places on a free castle edge, Swift Knight on any free edge', () => {
    for (const [card, kind] of [
      ['knighthood', TB_FRAME_KINDS.baKnighthood],
      ['swiftKnight', TB_FRAME_KINDS.baSwiftKnight],
    ] as const) {
      const state = baCard(card);
      expect(frameOf(state), card).toMatchObject({ kind, responders: ['p1'] });
      const after = dutyStep(state, 'p1', 'tb.baPlaceKnight');
      expect(partStateOf<{ knights: { player: string }[] }>(after, 'tb-barbarian-attack')!.knights, card).toEqual([
        expect.objectContaining({ player: 'p1' }),
      ]);
      expect(after.pending, card).toBeNull();
    }
  });

  it('row 9: Treason moves barbarians along treasonMoves[0] until the frame closes', () => {
    let state = baCard('treason');
    expect(frameOf(state)).toMatchObject({ kind: TB_FRAME_KINDS.baTreason, responders: ['p1'] });
    for (let step = 0; step < 2 && state.pending; step++) state = dutyStep(state, 'p1', 'tb.baTreason');
    expect(state.pending).toBeNull();
    expect(tradersBarbariansKit.conservation!(state)).toEqual([]);
  });

  it('row 10: knights move off the castle at the end of the turn, then the move ends (onEndTurn defer)', () => {
    let state = baCard('knighthood');
    state = accept(state, 'p1', tradersBarbariansDuty(viewOf(state, 'p1'), 'p1'));
    const ended = accept(state, 'p1', { type: 'turn.end' });
    expect(frameOf(ended)).toMatchObject({ kind: TB_FRAME_KINDS.baKnights, responders: ['p1'] });
    expect(ended.turn.seat).toBe(0);
    // 騎士停在城堡邊：`tb.endKnights` 會被拒絕，保底先把它移走。
    expect(applyCommand(ended, 'p1', { type: 'tb.endKnights' } as unknown as Command, seededRng(1)).ok).toBe(false);
    let next = dutyStep(ended, 'p1', 'tb.moveKnight');
    next = dutyStep(next, 'p1', 'tb.endKnights');
    expect(next.pending).toBeNull();
    expect(next.turn.seat).toBe(1);
  });

  it('row 10: with no knight on the castle the duty ends the moves at once', () => {
    let state = baCard('swiftKnight');
    state = accept(state, 'p1', tradersBarbariansDuty(viewOf(state, 'p1'), 'p1'));
    const ended = accept(state, 'p1', { type: 'turn.end' });
    expect(frameOf(ended)).toMatchObject({ kind: TB_FRAME_KINDS.baKnights });
    const next = dutyStep(ended, 'p1', 'tb.endKnights');
    expect(next.turn.seat).toBe(1);
  });
});

describe('rows 11–12: Traders & Barbarians', () => {
  it('row 11: a 7 moves the first barbarian to the first free edge', () => {
    const state = rolledSeven(TRADERS, 10);
    expect(frameOf(state)).toMatchObject({ kind: TB_FRAME_KINDS.tbBarbarian, responders: ['p1'] });
    const before = partStateOf<{ barbarians: number[] }>(state, 'tb-traders-barbarians')!.barbarians;
    const after = dutyStep(state, 'p1', 'tb.moveBarbarian');
    expect(partStateOf<{ barbarians: number[] }>(after, 'tb-traders-barbarians')!.barbarians).not.toEqual(before);
    expect(after.pending).toBeNull();
  });

  it('row 12: the wagon stops at the end of the turn (onEndTurn defer)', () => {
    const state = tbPlayable(TRADERS, { seed: 10 });
    const ended = accept(state, 'p1', { type: 'turn.end' });
    expect(frameOf(ended)).toMatchObject({ kind: TB_FRAME_KINDS.tbWagon, responders: ['p1'] });
    expect(ended.turn.seat).toBe(0);
    const next = dutyStep(ended, 'p1', 'tb.wagonStop');
    expect(next.pending).toBeNull();
    expect(next.turn.seat).toBe(1);
  });

  it('row 12: with Swift Journey the duty stops twice', () => {
    const state = tbPlayable(TRADERS, { seed: 10 });
    state.players[0]!.devCards = ['swiftJourney'];
    const played = accept(state, 'p1', { type: 'tb.playSwiftJourney' } as unknown as Command);
    const ended = accept(played, 'p1', { type: 'turn.end' });
    expect(frameOf(ended)).toMatchObject({ kind: TB_FRAME_KINDS.tbWagon, data: { extra: 1 } });
    const again = dutyStep(ended, 'p1', 'tb.wagonStop');
    expect(frameOf(again)).toMatchObject({ kind: TB_FRAME_KINDS.tbWagon, responders: ['p1'], data: { extra: 0 } });
    const next = dutyStep(again, 'p1', 'tb.wagonStop');
    expect(next.pending).toBeNull();
    expect(next.turn.seat).toBe(1);
  });
});

describe('row 13: Friendly Robber moveRobber', () => {
  it('keeps the robber on the desert when every player is protected (the fold may return the current hex)', () => {
    // FR3 的盤面（`rules/test/tb-variants.test.ts`）：p1 只有 2 VP，建築碰到沙漠以外的每一格；強盜已在沙漠。
    const state = tbPlayable(FR, { mode: 'fixed', phase: 'preroll' });
    clearBoard(state);
    for (const player of state.players) setHand(state, player.id, {});
    const topology = topologyOf(state);
    const desert = state.board.layout.terrain.indexOf('desert');
    const uncovered = new Set(state.board.layout.terrain.map((_, hex) => hex).filter((hex) => hex !== desert));
    let placed = 0;
    for (let vertex = 0; vertex < topology.vertices.length && uncovered.size > 0; vertex++) {
      const hexes = topology.vertices[vertex]!.hexes.filter((hex) => uncovered.has(hex));
      if (hexes.length === 0 || topology.vertices[vertex]!.hexes.includes(desert)) continue;
      state.board.buildings[vertex] = { player: 'p1', city: false };
      placed += 1;
      for (const hex of hexes) uncovered.delete(hex);
    }
    state.players[0]!.bonusPoints = 2 - placed;
    expect(state.board.robber).toBe(desert);
    const rolled = accept(state, 'p1', { type: 'turn.roll' }, dice(7));
    expect(viewOf(rolled, 'p1').pending).toMatchObject({ kind: 'moveRobber', actor: 'p1' });
    const view = viewOf(rolled, 'p1');
    expect(tbRobberHexes(view.hints)).toEqual([desert]);
    // 沒有模組時，base 的 fold 初值排除現位格，保底會送出被拒的指令；T&B 的 robberTargets 才讓它合法。
    const bare = pendingDuty(view, 'p1', []);
    expect(bare).not.toEqual({ type: 'pending.moveRobber', hex: desert });
    expect(applyCommand(rolled, 'p1', bare as Command, seededRng(1)).ok).toBe(false);
    expect(tradersBarbariansDuty(view, 'p1')).toBeUndefined();
    const after = dutyStep(rolled, 'p1', 'pending.moveRobber');
    expect(after.board.robber).toBe(desert);
  });

  it('moves to a hex without protected players once someone has more than 2 VP', () => {
    const state = tbPlayable(FR, { seed: 2, phase: 'preroll' });
    for (const player of state.players) setHand(state, player.id, {});
    // p2 的兩座聚落都升級成城市：4 VP，不再受保護。
    state.board.buildings = state.board.buildings.map((building) => (building?.player === 'p2' ? { ...building, city: true } : building));
    const rolled = accept(state, 'p1', { type: 'turn.roll' }, dice(7));
    const hexes = tbRobberHexes(viewOf(rolled, 'p1').hints)!;
    expect(hexes.length).toBeGreaterThan(0);
    expect(hexes).not.toContain(rolled.board.robber);
    const after = dutyStep(rolled, 'p1', 'pending.moveRobber');
    expect(hexes).toContain(after.board.robber);
  });
});

describe('rows 14–17: cards, base pending, setup and turn steps stay with base', () => {
  it('row 14: does not play a Barbarian Knight or a Knight card; row 17: ends the turn', () => {
    for (const [profileId, card] of [
      [TRADERS, 'barbarianKnight'],
      [FR, 'knight'],
    ] as const) {
      const state = tbPlayable(profileId, { seed: 10 });
      state.players[0]!.devCards = [card];
      const view = viewOf(state, 'p1');
      expect(tradersBarbariansDuty(view, 'p1'), profileId).toBeUndefined();
      expect(fallbackPolicy.decide(view, ctxFor('p1')), profileId).toEqual({ type: 'turn.end' });
      accept(state, 'p1', { type: 'turn.end' });
    }
  });

  it('row 17: rolls in preroll (Traders rerolls 2 and 12 inside the command)', () => {
    const state = tbPlayable(TRADERS, { seed: 10, phase: 'preroll' });
    expect(tradersBarbariansDuty(viewOf(state, 'p1'), 'p1')).toBeUndefined();
    // 先擲出 1+1（重擲）再擲出 3+5。
    const rolled = dutyStep(state, 'p1', 'turn.roll', scriptedRng([0, 0, 2, 4]));
    expect(rolled.turn.dice).toEqual([3, 5]);
  });

  it('row 15: discards and builds free roads through base before the barbarian moves', () => {
    const state = tbPlayable(TRADERS, { seed: 10, phase: 'preroll' });
    for (const player of state.players) setHand(state, player.id, {});
    setHand(state, 'p2', { ore: 9 });
    let next = accept(state, 'p1', { type: 'turn.roll' }, dice(7));
    expect(viewOf(next, 'p2').pending).toMatchObject({ kind: 'discard' });
    next = dutyStep(next, 'p2', 'pending.discard');
    next = dutyStep(next, 'p1', 'tb.moveBarbarian');
    next.players[0]!.devCards = ['roadBuilding'];
    next = accept(next, 'p1', { type: 'dev.playRoadBuilding' });
    expect(viewOf(next, 'p1').pending).toMatchObject({ kind: 'freeRoads' });
    next = dutyStep(next, 'p1', 'build.road');
    next = dutyStep(next, 'p1', 'build.road');
    expect(next.pending).toBeNull();
  });

  it('row 16: setup places through base; BA and Traders place a city in round 2, Fishing keeps its tokens', () => {
    for (const profileId of [BA, TRADERS, FISHING, FR]) {
      let state = tbCreate(profileId, { seed: 11 });
      let steps = 0;
      while (state.turn.phase === 'setup' && steps < 40) {
        const actor = state.players[state.turn.setup!.order[state.turn.setup!.index]!]!.id;
        const view = viewOf(state, actor);
        expect(tradersBarbariansDuty(view, actor), profileId).toBeUndefined();
        const command = fallbackPolicy.decide(view, ctxFor(actor));
        expect(['setup.placeBuilding', 'setup.placeRoad'], profileId).toContain(command?.type);
        state = accept(state, actor, command);
        steps += 1;
      }
      expect(state.turn.phase, profileId).toBe('preroll');
      const buildings = state.board.buildings.filter((building) => building !== null);
      expect(buildings, profileId).toHaveLength(state.players.length * 2);
      const cities = buildings.filter((building) => building!.city).length;
      expect(cities, profileId).toBe(profileId === BA || profileId === TRADERS ? state.players.length : 0);
      expect(tradersBarbariansKit.conservation!(state), profileId).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// graph.ts
// ---------------------------------------------------------------------------

describe('graph tools (S6, S7)', () => {
  it('finds the cheapest wagon route by MP, deterministically, and mirrors the rules step cost', () => {
    const state = tbPlayable(TRADERS, { seed: 10 });
    const view = viewOf(state, 'p1');
    const topo = topologyOf(state);
    const barbarians = new Set(partStateOf<{ barbarians: number[] }>(state, 'tb-traders-barbarians')!.barbarians);
    const start = partStateOf<{ wagons: Record<string, { vertex: number }> }>(state, 'tb-traders-barbarians')!.wagons.p1!.vertex;
    const cost = (edge: number) => wagonStepCost(view, 'p1', edge, barbarians).mp;
    const paths = vertexPaths(topo, start, cost);
    expect(paths.cost[start]).toBe(0);
    for (let vertex = 0; vertex < topo.vertices.length; vertex++) {
      const route = pathTo(paths, vertex)!;
      const edges = edgesTo(paths, vertex)!;
      expect(route[0]).toBe(start);
      expect(route.at(-1)).toBe(vertex);
      expect(edges).toHaveLength(route.length - 1);
      expect(edges.reduce((total, edge) => total + cost(edge), 0)).toBe(paths.cost[vertex]);
      // 最短：任何一條邊都不能再放鬆。
      for (const edge of topo.vertices[vertex]!.edges) {
        const other = topo.edges[edge]!.vertices.find((end) => end !== vertex)!;
        expect(paths.cost[vertex]!).toBeLessThanOrEqual(paths.cost[other]! + cost(edge));
      }
    }
    // 同一份輸入，同一份結果。
    expect(vertexPaths(topo, start, cost)).toEqual(paths);
    // 自己的道路 1 MP、空邊 2 MP、蠻族 +2，對手的道路收過路費。
    const own = state.board.roads.findIndex((road) => road?.player === 'p1');
    const rival = state.board.roads.findIndex((road) => road?.player === 'p2');
    const empty = state.board.roads.findIndex((road, edge) => !road && !barbarians.has(edge));
    expect(wagonStepCost(view, 'p1', own, barbarians)).toEqual({ mp: 1, toll: null });
    expect(wagonStepCost(view, 'p1', rival, barbarians)).toEqual({ mp: 1, toll: 'p2' });
    expect(wagonStepCost(view, 'p1', empty, barbarians)).toEqual({ mp: 2, toll: null });
    expect(wagonStepCost(view, 'p1', empty, new Set([empty]))).toEqual({ mp: 4, toll: null });
    // 不能走的邊：起點以外全部走不到。
    const blocked = vertexPaths(topo, start, () => null);
    expect(blocked.cost.filter((value) => value < Infinity)).toEqual([0]);
    expect(pathTo(blocked, (start + 1) % topo.vertices.length)).toBeNull();
    expect(vertexPaths(topo, -1, cost).cost.every((value) => value === Infinity)).toBe(true);
  });

  it('breaks ties by vertex number', () => {
    // 四個路口的環：0–1–2–3–0，每條邊成本 1；到 2 有兩條同成本的路，取前一站編號小的（1）。
    const topo = {
      vertices: [{ edges: [0, 3] }, { edges: [0, 1] }, { edges: [1, 2] }, { edges: [2, 3] }],
      edges: [{ vertices: [0, 1] }, { vertices: [1, 2] }, { vertices: [2, 3] }, { vertices: [3, 0] }],
    } as unknown as Parameters<typeof vertexPaths>[0];
    const paths = vertexPaths(topo, 0, () => 1);
    expect(pathTo(paths, 2)).toEqual([0, 1, 2]);
    expect(edgesTo(paths, 2)).toEqual([0, 1]);
    expect(edgesTo(paths, 0)).toEqual([]);
  });

  it('matches the knight range of the rules (BA hints)', () => {
    let state = baCard('knighthood');
    state = accept(state, 'p1', tradersBarbariansDuty(viewOf(state, 'p1'), 'p1'));
    const ended = accept(state, 'p1', { type: 'turn.end' });
    const hints = viewOf(ended, 'p1').hints!.modules!.tradersBarbarians as {
      'tb-barbarian-attack': { knightMoves: { from: number; targets: number[]; boosted: number[] }[] };
    };
    const castle = new Set(tbPartView(viewOf(ended, 'p1'), 'tb-barbarian-attack')!.castleEdges);
    const topo = topologyOf(ended);
    for (const move of hints['tb-barbarian-attack'].knightMoves) {
      for (const [range, expected] of [
        [3, move.targets],
        [5, move.boosted],
      ] as const) {
        const reach = [...edgeDistances(topo, move.from, range).keys()].filter((edge) => !castle.has(edge));
        expect(reach.sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
      }
      const layers = [...edgeDistances(topo, move.from, 3).values()];
      expect(layers).toEqual([...layers].sort((a, b) => a - b));
    }
    expect(edgeDistances(topo, -1, 3).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 全部座位只走保底的有界局（§4.1 保底的驗收；§6.1 最後一列）
// ---------------------------------------------------------------------------

const BOUNDED_PROFILES = [
  'tb-friendly-robber-2025',
  'tb-harbors-2025',
  'tb-friendly-robber-harbors-2025',
  'tb-fishing-2025',
  'tb-rivers-2025',
  'tb-merchant-trains-2025',
  'tb-barbarian-attack-2025',
  'tb-traders-barbarians-2025',
] as const;

function fallbackSeats(players: number): BotSeat[] {
  return Array.from({ length: players }, (_, index) => ({ id: `bot${index + 1}`, level: 'standard' as const, policy: fallbackPolicy }));
}

describe('all-fallback bounded games', () => {
  for (const profileId of BOUNDED_PROFILES) {
    for (const players of [3, 4]) {
      it(`only issues accepted commands and never stalls (${profileId}, ${players} players)`, () => {
        const kinds = new Set<string>();
        const run = runBotGame({
          seats: fallbackSeats(players),
          seed: 1,
          profileId,
          maxSteps: ALL_FALLBACK_STEPS,
          watchdogRolls: null,
          kits: [tradersBarbariansKit],
          onDecision: (_state, decision) => kinds.add(decision.command.type),
        });
        const label = `${profileId} ${players}p`;
        if (run.failure) expect.fail(`${label}: ${JSON.stringify(run.failure)}`);
        expect(run.stuck, `${label}: stalled at step ${run.steps}`).toBeNull();
        expect(run.steps, label).toBe(ALL_FALLBACK_STEPS);
        expect(run.state.turn.phase, label).not.toBe('setup');
        expect(run.conservation, label).toEqual([]);
        expect([...kinds], label).toEqual(
          expect.arrayContaining(['setup.placeBuilding', 'setup.placeRoad', 'turn.roll', 'turn.end', 'pending.discard']),
        );
        // 每回合結束都有車隊移動；擲出 7 時移動蠻族。
        if (profileId === TRADERS) expect([...kinds], label).toEqual(expect.arrayContaining(['tb.wagonStop', 'tb.moveBarbarian']));
        if (profileId === BA) expect([...kinds], label).toContain('tb.baSteal');
        if (profileId.includes('friendly-robber')) expect([...kinds], label).toContain('pending.moveRobber');
      }, GAME_TIMEOUT);
    }
  }
});
