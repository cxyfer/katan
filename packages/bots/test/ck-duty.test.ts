/**
 * I9 固定盤面（C&K 計畫 §4.2、§6.1）：Cities & Knights 的保底。
 *
 * 14 種 frame（13 種以真實指令走到，resolveRoll 是續行 frame）、含 commodity 的 base 棄牌、
 * `progressExcess`，以及 base 的強盜與偷牌在 C&K 上的行為。每個保底指令都必須被 `applyCommand` 接受，
 * 保底、standard、easy（兩個種子）都不會卡住，而且 B1 沒有策略鉤子，所以四種策略的答案相同。
 * 盤面由 `ck-fixtures.ts` 以 rules 的真實指令建構，不使用 harness。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  CK_RESOLVE_ROLL_FRAME,
  seededRng,
  type Command,
  type GameState,
  type GameView,
} from '@catan/rules';
import { actCk, emptyCkGame, giveCommodities, handCards, player, rollRng, SHIP, TRADE } from '../../rules/test/ck-helpers.ts';
import { give } from '../../rules/test/helpers.ts';
import { botOwesAction, fallbackDecision, fallbackPolicy } from '../src/fallback.ts';
import { citiesKnightsDuty } from '../src/modules/citiesKnights/duty.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotCommand, BotContext, BotLevel, BotPolicy } from '../src/types.ts';
import { FRAME_FIXTURES, viewOf, type FrameFixture } from './ck-fixtures.ts';

const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 1): BotContext => ({
  selfId,
  level,
  seed,
  offerPhases: {},
});

/** 保底，加上 standard 與 easy（兩個種子）：C&K 的策略鉤子要到 B2 才有，策略都靠保底作答。 */
const POLICIES: readonly (readonly [string, BotPolicy, BotLevel, number])[] = [
  ['fallback', fallbackPolicy, 'standard', 1],
  ['standard', createBotPolicy('standard'), 'standard', 1],
  ['easy#1', createBotPolicy('easy'), 'easy', 1],
  ['easy#2', createBotPolicy('easy'), 'easy', 2],
];

function expectAccepted(state: GameState, actor: string, command: BotCommand | null | undefined): GameState {
  expect(command, `${actor} has a command`).not.toBeNull();
  expect(command, `${actor} has a command`).not.toBeUndefined();
  const outcome = applyCommand(state, actor, command as Command, seededRng(1));
  expect(outcome.ok, `${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
  return outcome.ok ? outcome.state : state;
}

/** 每種策略在這個盤面上都送出同一個被接受的指令；回傳該指令。 */
function expectEveryPolicyAnswers(state: GameState, actor: string): BotCommand {
  const view = viewOf(state, actor);
  const answers = POLICIES.map(([name, policy, level, seed]) => {
    const command = policy.decide(view, ctxFor(actor, level, seed));
    expect(command, `${name} must not stall`).not.toBeNull();
    expectAccepted(state, actor, command);
    return command!;
  });
  for (const answer of answers) expect(answer).toEqual(answers[0]);
  return answers[0]!;
}

/** 從真實投影取 frame 的資料。 */
function dataOf(view: GameView): any {
  return (view.pending as { data: unknown }).data;
}

/** 計畫 §4.2 的最小動作：只取 frame data、hints 或手牌的第一個合法選項。 */
const EXPECTED: Readonly<Record<string, (fx: FrameFixture, view: GameView) => BotCommand>> = {
  'citiesKnights.pillage': (_fx, view) => ({ type: 'barbarians.pillage', vertex: dataOf(view).cities.p1[0] }),
  'citiesKnights.displaced': (_fx, view) => ({ type: 'knight.retreat', vertex: dataOf(view).options[0] }),
  'citiesKnights.progressDiscard': () => ({ type: 'progress.discard', cards: ['diplomacy'] }),
  'citiesKnights.defenderDraw': () => ({ type: 'barbarians.chooseDeck', track: 'science' }),
  'citiesKnights.scienceBonus': () => ({ type: 'science.take', resource: null }),
  'citiesKnights.harborExchange': () => ({ type: 'progress.harborAnswer', commodity: 'paper' }),
  // p2 的手牌依 CARD_KINDS 展開：grain、ore、ore、coin，取前 2 張。
  'citiesKnights.guildDues': () => ({ type: 'progress.takeCards', cards: ['grain', 'ore'] }),
  'citiesKnights.espionage': () => ({ type: 'progress.takeProgress', card: null }),
  // p2 的 ore 3、wool 2、coin 1：資源先、依 RESOURCES 順序，取前 3 張。
  'citiesKnights.sabotage': () => ({ type: 'progress.sabotageDiscard', cards: ['wool', 'wool', 'ore'] }),
  'citiesKnights.wedding': () => ({ type: 'progress.weddingGive', cards: ['wool', 'ore'] }),
  'citiesKnights.treasonRemove': (_fx, view) => ({ type: 'progress.treasonRemove', vertex: dataOf(view).knights[0] }),
  'citiesKnights.treasonPlace': () => ({ type: 'progress.treasonPlace', vertex: null }),
  'citiesKnights.diplomacyRoad': () => ({ type: 'progress.diplomacyRoad', edge: null }),
};

describe('14 種 C&K frame 的保底', () => {
  it('has an expectation for every real frame, and the fixtures cover them all', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(FRAME_FIXTURES).sort());
    // 13 種真實 frame 加上 resolveRoll 是計畫的 14 種。
    expect(Object.keys(FRAME_FIXTURES)).toHaveLength(13);
  });

  describe.each(Object.entries(FRAME_FIXTURES))('%s', (kind, build) => {
    it('the duty takes the first legal option, and every policy sends it', () => {
      const fx = build();
      const view = viewOf(fx.state, fx.responder);
      const expected = EXPECTED[kind]!(fx, view);
      expect(citiesKnightsDuty(view, fx.responder)).toEqual(expected);
      expect(expectEveryPolicyAnswers(fx.state, fx.responder)).toEqual(expected);
    });

    it('everyone else waits: the duty answers null, the policies do nothing', () => {
      const fx = build();
      const frame = fx.state.pending as { responders: string[] };
      for (const other of fx.state.players.map((candidate) => candidate.id).filter((id) => id !== frame.responders[0])) {
        const view = viewOf(fx.state, other);
        expect(citiesKnightsDuty(view, other), `${other} duty`).toBeNull();
        for (const [name, policy, level, seed] of POLICIES) {
          expect(policy.decide(view, ctxFor(other, level, seed)), `${other} ${name}`).toBeNull();
        }
      }
    });

    it('the owed action is reported for the first responder only', () => {
      const fx = build();
      const frame = fx.state.pending as { responders: string[] };
      expect(botOwesAction(viewOf(fx.state, frame.responders[0]!), frame.responders[0]!)).toBe('frame');
      for (const other of frame.responders.slice(1)) expect(botOwesAction(viewOf(fx.state, other), other)).toBeNull();
    });
  });

  it('resolveRoll is a continuation frame: nobody acts', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    state.pending = { kind: CK_RESOLVE_ROLL_FRAME, module: 'citiesKnights', responders: [], data: {} };
    for (const id of ['p1', 'p2']) {
      const view = viewOf(state, id);
      expect(citiesKnightsDuty(view, id)).toBeNull();
      expect(fallbackDecision(view, id, [])).toBeNull();
    }
  });

  it('answers a tied defender draw in order, one answer at a time', () => {
    const fx = FRAME_FIXTURES['citiesKnights.defenderDraw']!();
    expect(fx.state.pending).toMatchObject({ responders: ['p4', 'p2'] });
    const first = expectEveryPolicyAnswers(fx.state, 'p4');
    const after = expectAccepted(fx.state, 'p4', first);
    expect(after.pending).toMatchObject({ responders: ['p2'] });
    expectEveryPolicyAnswers(after, 'p2');
  });

  it('a displaced knight has no null option: the retreat is always a listed site', () => {
    const fx = FRAME_FIXTURES['citiesKnights.displaced']!();
    const view = viewOf(fx.state, fx.responder);
    const retreat = citiesKnightsDuty(view, fx.responder) as { vertex: number };
    expect(dataOf(view).options).toContain(retreat.vertex);
    expect((view.hints!.modules!.citiesKnights as { retreat: number[] }).retreat).toContain(retreat.vertex);
  });

  it('falls back to the hints when the frame data lacks the options', () => {
    const fx = FRAME_FIXTURES['citiesKnights.pillage']!();
    const view = JSON.parse(JSON.stringify(viewOf(fx.state, fx.responder))) as GameView;
    (view.pending as { data: unknown }).data = {};
    const command = citiesKnightsDuty(view, fx.responder);
    expect(command).toMatchObject({ type: 'barbarians.pillage', vertex: expect.any(Number) });
    expectAccepted(fx.state, fx.responder, command);
  });

  it('science bonus: only an explicit null is legal', () => {
    const fx = FRAME_FIXTURES['citiesKnights.scienceBonus']!();
    const command = citiesKnightsDuty(viewOf(fx.state, fx.responder), fx.responder);
    expect(command).toEqual({ type: 'science.take', resource: null });
    expect(command).toHaveProperty('resource', null);
  });
});

describe('frames the C&K duty does not own', () => {
  it('leaves base frames and other modules\' frames to the next duty (undefined)', () => {
    const state = emptyCkGame(4, 0, 'action');
    const base = JSON.parse(JSON.stringify(viewOf(state, 'p1'))) as GameView;
    base.pending = { kind: 'discard', required: { p1: 2 }, waitingFor: ['p1'] };
    expect(citiesKnightsDuty(base, 'p1')).toBeUndefined();
    base.pending = { kind: 'seafarers.gold', module: 'seafarers', responders: ['p1'], data: {} };
    expect(citiesKnightsDuty(base, 'p1')).toBeUndefined();
    base.pending = null;
    base.turn = { ...base.turn, phase: 'preroll' };
    expect(citiesKnightsDuty(base, 'p1')).toBeUndefined();
  });

  it('does nothing once the game is over', () => {
    const fx = FRAME_FIXTURES['citiesKnights.scienceBonus']!();
    const view = JSON.parse(JSON.stringify(viewOf(fx.state, fx.responder))) as GameView;
    (view as { result: unknown }).result = { winner: 'p1' };
    expect(citiesKnightsDuty(view, fx.responder)).toBeUndefined();
  });
});

describe('the duty never throws on a malformed view', () => {
  it.each(Object.entries(FRAME_FIXTURES))('%s', (_kind, build) => {
    const fx = build();
    const base = viewOf(fx.state, fx.responder);
    const variants: unknown[] = [undefined, null, 'x', 7, [], {}, { nested: { deep: true } }];
    for (const garbage of variants) {
      const view = JSON.parse(JSON.stringify(base)) as GameView;
      (view.pending as { data: unknown }).data = garbage;
      expect(() => citiesKnightsDuty(view, fx.responder)).not.toThrow();
      expect(() => fallbackDecision(view, fx.responder, [])).not.toThrow();
      const answer = citiesKnightsDuty(view, fx.responder);
      // 資料不可用時回 null（歸我管、不送指令），絕不是 undefined。
      if (garbage !== undefined && !Array.isArray(garbage)) expect(answer === undefined).toBe(false);
    }
    const bare = JSON.parse(JSON.stringify(base)) as GameView;
    bare.hints = undefined;
    bare.players = [];
    expect(() => citiesKnightsDuty(bare, fx.responder)).not.toThrow();
    expect(() => citiesKnightsDuty({} as GameView, fx.responder)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// base 的棄牌：含 commodity
// ---------------------------------------------------------------------------

/** p1 擲出 7，p2 持有指定手牌而必須棄牌（上限 7）。 */
function discardGame(resources: Partial<Record<'lumber' | 'brick' | 'wool' | 'grain' | 'ore', number>>, commodities: Partial<Record<'paper' | 'cloth' | 'coin', number>>) {
  const state = emptyCkGame(4, 0, 'preroll');
  give(state, 'p2', resources);
  giveCommodities(state, 'p2', commodities);
  const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, TRADE)).state;
  expect(rolled.pending).toMatchObject({ kind: 'discard' });
  return rolled;
}

describe('base discard with commodities', () => {
  it.each([
    ['resources and commodities', { lumber: 2 }, { coin: 6 }, 4],
    ['commodities only', {}, { paper: 8 }, 4],
    ['all three commodity kinds beside resources', { ore: 1, wool: 1 }, { paper: 3, cloth: 2, coin: 3 }, 5],
  ] as const)('%s: every policy discards the owed number of cards, all of them held', (_name, resources, commodities, owed) => {
    const state = discardGame(resources, commodities);
    expect((state.pending as { required: Record<string, number> }).required.p2).toBe(owed);
    for (const [name, policy, level, seed] of POLICIES) {
      const command = policy.decide(viewOf(state, 'p2'), ctxFor('p2', level, seed));
      expect(command, `${name} must not stall`).toMatchObject({ type: 'pending.discard' });
      expect((command as { resources: string[] }).resources).toHaveLength(owed);
      expectAccepted(state, 'p2', command);
    }
  });

  it('the fallback takes resources first, then commodities, in CARD_KINDS order', () => {
    const state = discardGame({ lumber: 2 }, { coin: 6 });
    expect(fallbackPolicy.decide(viewOf(state, 'p2'), ctxFor('p2'))).toEqual({
      type: 'pending.discard',
      resources: ['lumber', 'lumber', 'coin', 'coin'],
    });
    const only = discardGame({}, { cloth: 2, coin: 6 });
    expect(fallbackPolicy.decide(viewOf(only, 'p2'), ctxFor('p2'))).toEqual({
      type: 'pending.discard',
      resources: ['cloth', 'cloth', 'coin', 'coin'],
    });
  });

  it('standard keeps what the main plan needs and discards the rest', () => {
    // 3 ore 加 2 grain 是城市的成本；p2 有一座聚落可升級。其餘是 commodity 與雜牌。
    const state = emptyCkGame(4, 0, 'preroll');
    const city = state.board.buildings.findIndex((building) => building === null);
    state.board.buildings[city] = { player: 'p2', city: false };
    give(state, 'p2', { ore: 3, grain: 2, lumber: 1, wool: 1 });
    giveCommodities(state, 'p2', { cloth: 2 });
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, TRADE)).state;
    expect(rolled.pending).toMatchObject({ kind: 'discard', required: { p2: 4 } });
    const command = createBotPolicy('standard').decide(viewOf(rolled, 'p2'), ctxFor('p2'));
    expectAccepted(rolled, 'p2', command);
    const kept = new Map<string, number>([['ore', 3], ['grain', 2]]);
    for (const card of (command as { resources: string[] }).resources) if (kept.has(card)) kept.set(card, kept.get(card)! - 1);
    expect([...kept.values()], 'ore and grain for the city stay in hand').toEqual([3, 2]);
  });
});

// ---------------------------------------------------------------------------
// 進步卡超過上限
// ---------------------------------------------------------------------------

describe('progress hand excess in the action phase', () => {
  function excessGame(cards: string[]): GameState {
    const state = emptyCkGame(4, 0, 'action');
    handCards(state, 'p1', cards);
    return state;
  }

  it.each([
    [1, ['alchemy', 'crane', 'invention', 'medicine', 'mining'], ['alchemy']],
    [2, ['alchemy', 'crane', 'invention', 'medicine', 'mining', 'smithing'], ['alchemy', 'crane']],
  ] as const)('with %i excess the duty discards the first cards, which unlocks turn.end', (excess, cards, expected) => {
    const state = excessGame([...cards]);
    const hints = actionHints(state, 'p1');
    expect((hints.modules!.citiesKnights as { progressExcess: number }).progressExcess).toBe(excess);
    expect(hints.canEndTurn).toBe(false);
    const command = expectEveryPolicyAnswers(state, 'p1');
    expect(command).toEqual({ type: 'progress.discard', cards: expected });
    const after = expectAccepted(state, 'p1', command);
    expect(player(after, 'p1').progressCards).toHaveLength(4);
    expect(actionHints(after, 'p1').canEndTurn).toBe(true);
    // 解除否決之後保底回到 base 的結束回合。
    expect(fallbackPolicy.decide(viewOf(after, 'p1'), ctxFor('p1'))).toEqual({ type: 'turn.end' });
    expectAccepted(after, 'p1', { type: 'turn.end' });
  });

  it('does not discard within the limit, and ends the turn as base does', () => {
    const state = excessGame(['alchemy', 'crane', 'invention', 'medicine']);
    expect(citiesKnightsDuty(viewOf(state, 'p1'), 'p1')).toBeUndefined();
    expect(fallbackPolicy.decide(viewOf(state, 'p1'), ctxFor('p1'))).toEqual({ type: 'turn.end' });
  });

  it('is the owed action only on the actor\'s own turn', () => {
    const state = excessGame(['alchemy', 'crane', 'invention', 'medicine', 'mining']);
    expect(citiesKnightsDuty(viewOf(state, 'p2'), 'p2')).toBeUndefined();
    expect(fallbackPolicy.decide(viewOf(state, 'p2'), ctxFor('p2'))).toBeNull();
  });

  it('answers nothing it cannot back with a card in hand (does not invent cards)', () => {
    const state = excessGame(['alchemy', 'crane', 'invention', 'medicine', 'mining']);
    const view = JSON.parse(JSON.stringify(viewOf(state, 'p1'))) as GameView;
    view.players.find((candidate) => candidate.id === 'p1')!.progressCards = [];
    expect(citiesKnightsDuty(view, 'p1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// preroll、action 與 base 的強盜
// ---------------------------------------------------------------------------

describe('turn structure and the base duties under C&K', () => {
  it('rolls in preroll and ends the turn in action when nothing is owed', () => {
    const preroll = emptyCkGame(4, 0, 'preroll');
    expect(fallbackPolicy.decide(viewOf(preroll, 'p1'), ctxFor('p1'))).toEqual({ type: 'turn.roll' });
    const action = emptyCkGame(4, 0, 'action');
    expect(fallbackPolicy.decide(viewOf(action, 'p1'), ctxFor('p1'))).toEqual({ type: 'turn.end' });
  });

  it('moves the robber and steals once the barbarians have come (robber active)', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    const slot = state.moduleState!.citiesKnights as { attacks: number };
    slot.attacks = 1;
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, TRADE)).state;
    expect(rolled.pending).toMatchObject({ kind: 'moveRobber', actor: 'p1', cause: 'seven' });
    for (const [name, policy, level, seed] of POLICIES) {
      let current = rolled;
      for (let step = 0; step < 4 && current.pending; step++) {
        const owner = (current.pending as { actor: string }).actor;
        const command = policy.decide(viewOf(current, owner), ctxFor(owner, level, seed));
        expect(command, `${name} must not stall on ${current.pending.kind}`).not.toBeNull();
        current = expectAccepted(current, owner, command);
      }
      expect(current.pending, name).toBeNull();
    }
  });

  it('does not touch the Cities & Knights progress frames when the robber frame is the owed one', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    (state.moduleState!.citiesKnights as { attacks: number }).attacks = 1;
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, SHIP)).state;
    const view = viewOf(rolled, 'p1');
    // 擲出 3＋4 的事件骰是船：蠻族還沒到，只是 7 點。
    expect(citiesKnightsDuty(view, 'p1')).toBeUndefined();
  });
});
