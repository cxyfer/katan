/**
 * bots 平台鉤子（0.4.3 SFCK-P）：盜賊目標 fold、`rescore`、`sea.ts` 的 blocker 預設。
 *
 * 與 `packages/rules/test/sfck-hooks.test.ts` 同名但在不同 package：那一份測 rules 的 SF+CK 鉤子，這一份只測
 * bots 的骨架。沒有註冊任何 SFCK 模組，所以一律用只存在於測試內的假模組，加上真正的 C&K／SF 模組檢查
 * blocker 預設。
 */

import { describe, expect, it, vi } from 'vitest';
import {
  actionHints,
  getProfile,
  projectGame,
  type GameState,
  type GameView,
  type PublicPendingView,
} from '@catan/rules';
import { addKnight } from '../../rules/test/ck-helpers.ts';
import { forceTurn, newGame } from '../../rules/test/helpers.ts';
import { emptySeafarersGame, road, settle, ship } from '../../rules/test/seafarers-helpers.ts';
import { afterFirstAttack, emptySfckGame } from '../../rules/test/sfck-helpers.ts';
import { banditChoice, banditTargets, defaultBanditTargets } from '../src/base/robber.ts';
import { boardModel, isLandVertex, type BoardModel } from '../src/board.ts';
import { createFallbackPolicy, fallbackDecision } from '../src/fallback.ts';
import { rescoreCandidates, turnContext } from '../src/heuristic.ts';
import { pendingDuty } from '../src/index.ts';
import { rescoreDelta } from '../src/modules/compose.ts';
import { botModulesOf } from '../src/modules/registry.ts';
import type { BanditTarget, BotModule, Scored } from '../src/modules/types.ts';
import { createBotPolicy } from '../src/policy.ts';
import { isLandEdge, isSeaEdge, roadEdgesFrom, roadEdgesOf, searchShips, shipEdgesFrom, shipEdgesOf } from '../src/sea.ts';
import type { BotCommand, BotContext, BotLevel } from '../src/types.ts';

// ---------------------------------------------------------------------------
// 共用建構
// ---------------------------------------------------------------------------

const ctxFor = (selfId: string, level: BotLevel = 'standard'): BotContext => ({ selfId, level, seed: 1, offerPhases: {} });

/** 與伺服器相同的投影：自己座位的 view 加上 hints。 */
function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

function withMoveRobber(view: GameView, actor: string, cause = 'seven'): GameView {
  return { ...view, pending: { kind: 'moveRobber', actor, cause } as NonNullable<PublicPendingView> };
}

const scored = <T>(item: T, score: number): Scored<T> => ({ item, score });
const cmd = (type: string): BotCommand => ({ type }) as unknown as BotCommand;

/** 盤面上的陸地／海格 index（遞增）。 */
function hexesOf(view: GameView): { land: number[]; sea: number[] } {
  const land: number[] = [];
  const sea: number[] = [];
  view.board.terrain.forEach((terrain, hex) => (terrain === 'sea' ? sea : land).push(hex));
  return { land, sea };
}

/** 全部座位都沒有建築的 base 行動階段；p2 的聚落放在產能最高的路口，讓強盜候選的分數有差別。 */
function baseView(): { view: GameView; id: string } {
  const { state } = newGame({ players: 4 });
  forceTurn(state, 0, 'action');
  state.windowId += 1;
  const model = boardModel(viewOf(state, 'p1'), 'p1');
  let best = 0;
  let bestPips = -1;
  model.topo.vertices.forEach((_info, vertex) => {
    const pips = model.hexVertices.reduce((sum, vertices, hex) => sum + (vertices.includes(vertex) ? model.hexPips[hex]! : 0), 0);
    if (pips > bestPips) {
      bestPips = pips;
      best = vertex;
    }
  });
  settle(state, 'p2', best);
  return { view: viewOf(state, 'p1'), id: 'p1' };
}

/** 把海盜放到第一個海格（新海岸開局時海盜還在外框）。 */
function placePirate(state: GameState): number {
  const sea = state.board.layout.terrain.findIndex((terrain) => terrain === 'sea');
  expect(sea).toBeGreaterThanOrEqual(0);
  state.board.pirate = sea;
  return sea;
}

/** 新海岸 SF 盤面；`pirate: true` 時海盜在場，否則還在外框（開局時的狀態）。robber 的位置沿用 layout。 */
function seaView(pirate = true): { state: GameState; view: GameView } {
  const state = emptySeafarersGame(4, 0, 'action');
  if (pirate) placePirate(state);
  return { state, view: viewOf(state, 'p1') };
}

// ---------------------------------------------------------------------------
// 盜賊目標 fold
// ---------------------------------------------------------------------------

describe('bots platform hooks (SFCK-P): bandit target fold', () => {
  describe('initial value (bandit default)', () => {
    it('lists land except the robber, then sea except the pirate, then the frame when the pirate is on board', () => {
      const { view } = seaView();
      const { robber, pirate } = view.board;
      expect(robber).toBeGreaterThanOrEqual(0);
      expect(pirate).not.toBeNull();
      const { land, sea } = hexesOf(view);
      expect(sea.length).toBeGreaterThan(0);
      const targets = defaultBanditTargets(view);
      expect(targets).toEqual([...land.filter((hex) => hex !== robber), ...sea.filter((hex) => hex !== pirate), null]);
      // 陸地全部排在海格前面，即使 index 交錯；外框最後。
      expect(targets.at(-1)).toBeNull();
      expect(targets).not.toContain(robber);
      expect(targets).not.toContain(pirate);
      const firstSea = targets.findIndex((hex) => hex !== null && view.board.terrain[hex] === 'sea');
      expect(targets.slice(0, firstSea).every((hex) => hex !== null && view.board.terrain[hex] !== 'sea')).toBe(true);
      expect(banditTargets(view, 'p1', [])).toEqual(targets);
    });

    it('has no frame target when the pirate is off board, and then every sea hex is a target', () => {
      const { view } = seaView(false);
      expect(view.board.pirate).toBeNull();
      const { land, sea } = hexesOf(view);
      const targets = defaultBanditTargets(view);
      expect(targets).toEqual([...land.filter((hex) => hex !== view.board.robber), ...sea]);
      expect(targets).not.toContain(null);
    });

    it('adds sea hexes and the frame only for a profile with a pirate (hasPirate)', () => {
      const { state } = seaView();
      const pirate = placePirate(state);
      const view = viewOf(state, 'p1');
      const { land, sea } = hexesOf(view);
      expect(sea.length).toBeGreaterThan(0);
      for (const id of ['sf-new-shores-2025', 'sf-new-shores-paired-2025', 'sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025']) {
        expect(getProfile(id)?.hasPirate, id).toBe(true);
      }
      expect(defaultBanditTargets(view)).toEqual([...land.filter((hex) => hex !== view.board.robber), ...sea.filter((hex) => hex !== pirate), null]);
      // 盤面有海格、但 profile 沒有海盜（ck-2025）：初值只有陸地，沒有海格也沒有外框。
      expect(getProfile('ck-2025')?.hasPirate).toBe(false);
      const noPirate: GameView = { ...view, profileId: 'ck-2025' };
      expect(defaultBanditTargets(noPirate)).toEqual(land.filter((hex) => hex !== view.board.robber));
      expect(banditTargets(noPirate, 'p1', [])).toEqual(defaultBanditTargets(noPirate));
      // 查不到 profile：維持只看盤面的行為，而且不 throw。
      const unknown: GameView = { ...view, profileId: 'no-such-profile' };
      expect(() => defaultBanditTargets(unknown)).not.toThrow();
      expect(defaultBanditTargets(unknown)).toEqual(defaultBanditTargets(view));
    });

    it('keeps every land hex before the first attack (robber = -1), with and without a pirate', () => {
      const state = emptySfckGame(4);
      const view = viewOf(state, 'p1');
      expect(view.board.robber).toBe(-1);
      const { land, sea } = hexesOf(view);
      expect(view.board.pirate).toBeNull();
      expect(defaultBanditTargets(view)).toEqual([...land, ...sea]);
      const pirate = placePirate(state);
      expect(defaultBanditTargets(viewOf(state, 'p1'))).toEqual([...land, ...sea.filter((hex) => hex !== pirate), null]);
      // 首攻之後強盜在場：它所在的格子不再是目標。
      const after = viewOf(afterFirstAttack(emptySfckGame(4)), 'p1');
      expect(after.board.robber).toBeGreaterThanOrEqual(0);
      expect(defaultBanditTargets(after)).not.toContain(after.board.robber);
    });

    it('is only the land hexes except the robber on a base board (no sea, no pirate)', () => {
      const { view } = baseView();
      expect(view.board.pirate).toBeNull();
      expect(view.board.terrain).not.toContain('sea');
      const expected = view.board.terrain.flatMap((_terrain, hex) => (hex === view.board.robber ? [] : [hex]));
      expect(defaultBanditTargets(view)).toEqual(expected);
      // 與 0.4.2 的保底相同：第一個不是強盜現位的陸地格。
      expect(defaultBanditTargets(view)[0]).toBe(view.board.terrain.findIndex((_terrain, hex) => hex !== view.board.robber));
    });
  });

  describe('folding the modules', () => {
    it('hands each module the previous result, in ruleModules order', () => {
      const { view } = baseView();
      const initial = defaultBanditTargets(view);
      const seen: (readonly BanditTarget[])[] = [];
      const dropFirst: BotModule = {
        id: 'a',
        robberTargets: (_view, _self, targets) => (seen.push(targets), targets.slice(1)),
      };
      const addFrame: BotModule = {
        id: 'b',
        robberTargets: (_view, _self, targets) => (seen.push(targets), [...targets, null]),
      };
      const plain: BotModule = { id: 'c' };
      expect(banditTargets(view, 'p1', [plain, dropFirst, plain, addFrame])).toEqual([...initial.slice(1), null]);
      expect(seen).toEqual([initial, initial.slice(1)]);
      // 順序不同、結果不同：後面的模組看到前面的結果。
      seen.length = 0;
      expect(banditTargets(view, 'p1', [addFrame, dropFirst])).toEqual([...initial.slice(1), null]);
      expect(seen).toEqual([initial, [...initial, null]]);
    });

    it('passes the view and the seat, and lets a module replace the set (or hand back the robber hex)', () => {
      const { view } = baseView();
      const calls: [GameView, string][] = [];
      const frWithCurrent: BotModule = {
        id: 'fr',
        robberTargets: (v, self) => (calls.push([v, self]), [v.board.robber]),
      };
      // T&B 的 Friendly Robber 可能回傳現位格：fold 之後不再排除 `view.board.robber`。
      expect(banditTargets(view, 'p3', [frWithCurrent])).toEqual([view.board.robber]);
      expect(calls).toEqual([[view, 'p3']]);
      const widen: BotModule = { id: 'w', robberTargets: () => [view.board.robber, 1, null] };
      expect(banditTargets(view, 'p1', [widen])).toEqual([view.board.robber, 1, null]);
    });

    it('only accepts in-range integers and null, ignores non-arrays, and survives a throwing module', () => {
      const { view } = baseView();
      const initial = defaultBanditTargets(view);
      const hexCount = view.board.terrain.length;
      const messy: BotModule = {
        id: 'messy',
        robberTargets: () =>
          [3, 1.5, Number.NaN, '4', null, undefined, 7, Infinity, { hex: 2 }, -1, hexCount, hexCount - 1, 0, 10_000] as unknown as BanditTarget[],
      };
      // 範圍外的整數（負數、等於或超過 hex 數）也丟掉；0 與最後一格都算。
      expect(banditTargets(view, 'p1', [messy])).toEqual([3, null, 7, hexCount - 1, 0]);
      for (const bad of [undefined, null, 5, 'x', {}] as const) {
        const broken: BotModule = { id: 'broken', robberTargets: () => bad as unknown as BanditTarget[] };
        expect(banditTargets(view, 'p1', [broken])).toEqual(initial);
      }
      const boom: BotModule = {
        id: 'boom',
        robberTargets: () => {
          throw new Error('boom');
        },
      };
      const trim: BotModule = { id: 'trim', robberTargets: (_v, _s, targets) => targets.slice(0, 2) };
      expect(() => banditTargets(view, 'p1', [boom])).not.toThrow();
      // 丟例外的模組視為沒有意見：沿用上一組，後面的模組照常運作。
      expect(banditTargets(view, 'p1', [boom, trim])).toEqual(initial.slice(0, 2));
      expect(banditTargets(view, 'p1', [])).toEqual(initial);
    });
  });

  describe('banditChoice', () => {
    const narrowTo = (...hexes: BanditTarget[]): BotModule => ({ id: 'narrow', robberTargets: () => hexes });

    it('is the same with a pass-through fold as with no modules, rng draws included', () => {
      const { view, id } = baseView();
      const passThrough: BotModule = { id: 'pass', robberTargets: (_v, _s, targets) => targets };
      for (const level of ['standard', 'easy'] as const) {
        const plain = turnContext(view, ctxFor(id, level), level, []);
        const folded = turnContext(view, ctxFor(id, level), level, [passThrough]);
        const plainDraws = vi.spyOn(plain.rng, 'int');
        const foldedDraws = vi.spyOn(folded.rng, 'int');
        expect(banditChoice(folded, 'seven')).toEqual(banditChoice(plain, 'seven'));
        expect(foldedDraws.mock.calls).toEqual(plainDraws.mock.calls);
      }
    });

    it('filters base candidates by the fold, then picks among the survivors', () => {
      const { view, id } = baseView();
      const plain = turnContext(view, ctxFor(id), 'standard', []);
      const best = banditChoice(plain, 'seven')!.target;
      const other = defaultBanditTargets(view).find((hex) => hex !== best && hex !== null)!;
      expect(banditChoice(turnContext(view, ctxFor(id), 'standard', [narrowTo(other)]), 'seven')).toEqual({ target: other });
      // 最佳格不在集合裡：不會被選中，即使它的分數最高。
      const without = defaultBanditTargets(view).filter((hex) => hex !== best);
      const choice = banditChoice(turnContext(view, ctxFor(id), 'standard', [narrowTo(...without)]), 'seven')!;
      expect(choice.target).not.toBe(best);
      expect(without).toContain(choice.target);
    });

    it('drops module candidates that are outside the fold and keeps those inside', () => {
      const { view, id } = baseView();
      const inside = defaultBanditTargets(view)[3]!;
      const outside = view.board.robber; // 初值排除現位；沒有模組把它加回來
      const wants: BotModule = {
        id: 'wants',
        banditCandidates: () => [scored(outside, 1e6), scored(inside, 1e5)],
      };
      expect(banditChoice(turnContext(view, ctxFor(id), 'standard', [wants]), 'seven')).toEqual({ target: inside });
      // 同一個模組把外框加進集合後，外框的候選才算數。
      const allowsFrame: BotModule = {
        id: 'frame',
        robberTargets: (_v, _s, targets) => [...targets, null],
        banditCandidates: () => [scored(null, 1e6)],
      };
      expect(banditChoice(turnContext(view, ctxFor(id), 'standard', [allowsFrame]), 'seven')).toEqual({ target: null });
    });

    it('takes the first target without drawing rng when no candidate survives', () => {
      const { view, id } = baseView();
      // 集合只有外框：base 的候選都是陸地、全部被濾掉，沒有模組候選，所以直接取第一項。
      const frameOnly = turnContext(view, ctxFor(id, 'easy'), 'easy', [narrowTo(null)]);
      const frameDraws = vi.spyOn(frameOnly.rng, 'int');
      expect(banditChoice(frameOnly, 'seven')).toEqual({ target: null });
      expect(frameDraws).not.toHaveBeenCalled();
      // 對照：有候選存活時 easy 會抽一次，所以上面的「沒抽」不是空測。
      const survivors = turnContext(view, ctxFor(id, 'easy'), 'easy', [narrowTo(null, 4, 5)]);
      const draws = vi.spyOn(survivors.rng, 'int');
      banditChoice(survivors, 'seven');
      expect(draws).toHaveBeenCalledTimes(1);
    });

    it('takes the first sea hex when the fold keeps only the sea and the frame (pirate frame)', () => {
      const { view } = seaView();
      const sea: BotModule = {
        id: 'pirate-only',
        robberTargets: (v, _s, targets) => targets.filter((hex) => hex === null || v.board.terrain[hex] === 'sea'),
      };
      const turn = turnContext(view, ctxFor('p1', 'easy'), 'easy', [sea]);
      const draws = vi.spyOn(turn.rng, 'int');
      const first = banditTargets(view, 'p1', [sea])[0]!;
      expect(view.board.terrain[first!]).toBe('sea');
      expect(banditChoice(turn, 'seven')).toEqual({ target: first });
      expect(draws).not.toHaveBeenCalled();
      // 整條策略路徑（easy、topK > 1）也一樣：集合有很多項、沒有候選，答案與種子無關，永遠是第一項。
      expect(banditTargets(view, 'p1', [sea]).length).toBeGreaterThan(2);
      const frame = withMoveRobber(view, 'p1');
      const answers = new Set<string>();
      for (let seed = 1; seed <= 20; seed++) {
        answers.add(JSON.stringify(createBotPolicy('easy', { modules: [sea] }).decide(frame, { ...ctxFor('p1', 'easy'), seed })));
      }
      expect([...answers]).toEqual([JSON.stringify({ type: 'pending.moveRobber', hex: first })]);
      expect(fallbackDecision(frame, 'p1', [sea])).toEqual({ type: 'pending.moveRobber', hex: first });
    });

    it('returns null only when the fold itself is empty', () => {
      const { view, id } = baseView();
      expect(banditChoice(turnContext(view, ctxFor(id), 'standard', [narrowTo()]), 'seven')).toBeNull();
      expect(banditChoice(turnContext(view, ctxFor(id), 'standard', []), 'seven')).not.toBeNull();
    });

    it('goes through the whole policy for a moveRobber frame (strategy and the fallback behind it)', () => {
      const { view, id } = baseView();
      const frame = withMoveRobber(view, id);
      const only = defaultBanditTargets(view)[5]!;
      const module: BotModule = { id: 'narrow', robberTargets: () => [only] };
      expect(createBotPolicy('standard', { modules: [module] }).decide(frame, ctxFor(id))).toEqual({
        type: 'pending.moveRobber',
        hex: only,
      });
      expect(createFallbackPolicy([module]).decide(frame, ctxFor(id))).toEqual({ type: 'pending.moveRobber', hex: only });
    });
  });

  describe('pendingDuty and the fallback', () => {
    it('keeps the two-argument call working: the first land hex that is not the robber, as in 0.4.2', () => {
      for (const { view, id } of [baseView(), { view: seaView().view, id: 'p1' }]) {
        const frame = withMoveRobber(view, id);
        const hex = view.board.terrain.findIndex((terrain, index) => index !== view.board.robber && terrain !== 'sea');
        expect(pendingDuty(frame, id)).toEqual({ type: 'pending.moveRobber', hex });
        expect(pendingDuty(frame, id, [])).toEqual({ type: 'pending.moveRobber', hex });
        // 不是自己的 frame：不欠動作。
        expect(pendingDuty(frame, 'p2')).toBeNull();
      }
    });

    it('takes the first target of the fold, which may be the frame (null) or the current robber hex', () => {
      const { view, id } = baseView();
      const frame = withMoveRobber(view, id);
      const first = (...targets: BanditTarget[]): BotModule => ({ id: 'fx', robberTargets: () => targets });
      expect(pendingDuty(frame, id, [first(null, 2)])).toEqual({ type: 'pending.moveRobber', hex: null });
      expect(pendingDuty(frame, id, [first(view.board.robber)])).toEqual({ type: 'pending.moveRobber', hex: view.board.robber });
      expect(pendingDuty(frame, id, [first()])).toBeNull();
      // 模組的集合在 fold 之後生效，只有第一項被取用。
      const trimmed: BotModule = { id: 'trim', robberTargets: (_v, _s, targets) => targets.slice(2) };
      expect(pendingDuty(frame, id, [trimmed])).toEqual({
        type: 'pending.moveRobber',
        hex: defaultBanditTargets(view)[2],
      });
    });

    it('is passed the module list by fallbackDecision', () => {
      const { view, id } = baseView();
      const frame = withMoveRobber(view, id);
      const module: BotModule = { id: 'fx', robberTargets: () => [7] };
      expect(fallbackDecision(frame, id, [module])).toEqual({ type: 'pending.moveRobber', hex: 7 });
      expect(fallbackDecision(frame, id, [])).toEqual(pendingDuty(frame, id));
      // 模組丟例外也不會讓保底丟例外。
      const boom: BotModule = {
        id: 'boom',
        robberTargets: () => {
          throw new Error('boom');
        },
      };
      expect(() => fallbackDecision(frame, id, [boom])).not.toThrow();
      expect(fallbackDecision(frame, id, [boom])).toEqual(pendingDuty(frame, id));
    });

    it('is terminal when the fold is empty: no module duty is asked, even one that would send a move', () => {
      const { view, id } = baseView();
      const frame = withMoveRobber(view, id);
      const asked = vi.fn((): BotCommand => ({ type: 'pending.moveRobber', hex: 0 }));
      const empty: BotModule = { id: 'fx', robberTargets: () => [], duty: asked };
      // 集合是完整的合法集合：空的時候沒有任何模組的 duty 能做得更好，整體回 null 交給 server 診斷。
      expect(pendingDuty(frame, id, [empty])).toBeNull();
      expect(fallbackDecision(frame, id, [empty])).toBeNull();
      expect(createFallbackPolicy([empty]).decide(frame, ctxFor(id))).toBeNull();
      expect(createBotPolicy('standard', { modules: [empty] }).decide(frame, ctxFor(id))).toBeNull();
      expect(asked).not.toHaveBeenCalled();
      // 只有「自己欠 moveRobber」才是終止結果：別的待決效果沒有 base 動作時，照舊詢問模組的 duty。
      const steal = { ...view, pending: { kind: 'steal', actor: id, hex: 0, candidates: [], pirate: false } } as unknown as GameView;
      expect(fallbackDecision(steal, id, [empty])).toEqual({ type: 'pending.moveRobber', hex: 0 });
      expect(asked).toHaveBeenCalledTimes(1);
      // 集合不是空的：base 的第一項優先，duty 不會被問到。
      asked.mockClear();
      const one: BotModule = { id: 'fx', robberTargets: () => [4], duty: asked };
      expect(fallbackDecision(frame, id, [one])).toEqual({ type: 'pending.moveRobber', hex: 4 });
      expect(asked).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// rescore
// ---------------------------------------------------------------------------

describe('bots platform hooks (SFCK-P): rescore', () => {
  /** 沒有手牌、沒有可建造的 base 行動階段：只剩模組的 `actions` 候選。 */
  function idleActionView(): { view: GameView; id: string } {
    const { state } = newGame({ players: 4 });
    forceTurn(state, 0, 'action');
    state.windowId += 1;
    return { view: viewOf(state, 'p1'), id: 'p1' };
  }

  const A = cmd('fx.a');
  const B = cmd('fx.b');
  const actionsOf = (...items: Scored<BotCommand>[]): BotModule => ({ id: 'acts', actions: () => items });

  it('does not call anything, and returns the very same list, when no module provides rescore', () => {
    const { view, id } = idleActionView();
    const turn = turnContext(view, ctxFor(id), 'standard', [actionsOf(scored(A, 1))]);
    const list = [scored(A, 1), scored(B, 2)];
    expect(rescoreCandidates(turn, list)).toBe(list);
    expect(rescoreCandidates(turnContext(view, ctxFor(id), 'standard', []), list)).toBe(list);
  });

  it('decides exactly as before without a provider (the module only supplies actions)', () => {
    const { view, id } = idleActionView();
    const run = (modules: BotModule[]) => createBotPolicy('standard', { modules }).decide(view, ctxFor(id));
    expect(run([actionsOf(scored(A, 1e6), scored(B, 1e6 - 1))])).toBe(A);
    // `rescore` 為 undefined 的欄位也算沒有提供。
    expect(run([{ ...actionsOf(scored(A, 1e6), scored(B, 1e6 - 1)), rescore: undefined }])).toBe(A);
  });

  it('adds the deltas of every module that provides it, and only changes scores', () => {
    const { view, id } = idleActionView();
    const seen: string[] = [];
    const first: BotModule = { id: 'one', rescore: (_t, c) => (seen.push(`one:${c.type}`), c.type === 'fx.b' ? 1 : 0) };
    const second: BotModule = { id: 'two', rescore: (_t, c) => (seen.push(`two:${c.type}`), c.type === 'fx.b' ? 0.25 : -0.5) };
    const plain: BotModule = { id: 'plain' };
    const turn = turnContext(view, ctxFor(id), 'standard', [first, plain, second]);
    const list = [scored(A, 10), scored(B, 9)];
    const out = rescoreCandidates(turn, list);
    expect(out).toEqual([scored(A, 9.5), scored(B, 10.25)]);
    // 不新增、不移除、不改順序，也不改動輸入。
    expect(out.map((candidate) => candidate.item)).toEqual([A, B]);
    expect(list).toEqual([scored(A, 10), scored(B, 9)]);
    // 每個提供者對每個候選各問一次，依模組順序。
    expect(seen).toEqual(['one:fx.a', 'two:fx.a', 'one:fx.b', 'two:fx.b']);
  });

  it('rescoreDelta (compose.ts) sums the finite deltas of the modules that provide rescore', () => {
    const { view, id } = idleActionView();
    const turn = turnContext(view, ctxFor(id), 'standard', []);
    const args: unknown[][] = [];
    const one: BotModule = { id: 'one', rescore: (...rest) => (args.push(rest), 1.5) };
    const two: BotModule = { id: 'two', rescore: () => -0.25 };
    expect(rescoreDelta([], turn, A)).toBe(0);
    expect(rescoreDelta([{ id: 'plain' }], turn, A)).toBe(0);
    expect(rescoreDelta([one, { id: 'plain' }, two], turn, A)).toBe(1.25);
    expect(args).toEqual([[turn, A]]);
    // 非有限值視為 0：不能用 −∞ 表達排除，要壓低分數請回有限的負值。
    const nan: BotModule = { id: 'nan', rescore: () => Number.NaN };
    const inf: BotModule = { id: 'inf', rescore: () => Infinity };
    const minusInf: BotModule = { id: 'minus-inf', rescore: () => -Infinity };
    expect(rescoreDelta([nan, inf, minusInf], turn, A)).toBe(0);
    expect(rescoreDelta([nan, one, inf, two, minusInf], turn, A)).toBe(1.25);
    // 骨架用的就是這個加總。
    const scoredList = [scored(A, 10)];
    expect(rescoreCandidates(turnContext(view, ctxFor(id), 'standard', [one, two]), scoredList)).toEqual([scored(A, 11.25)]);
  });

  it('treats a delta of 0 or a non-finite delta as no change', () => {
    const { view, id } = idleActionView();
    const weird: BotModule = { id: 'weird', rescore: (_t, c) => (c.type === 'fx.a' ? Number.NaN : Infinity) };
    const zero: BotModule = { id: 'zero', rescore: () => 0 };
    const list = [scored(A, 3), scored(B, 2)];
    const out = rescoreCandidates(turnContext(view, ctxFor(id), 'standard', [weird, zero]), list);
    expect(out).toEqual(list);
    expect(out[0]).toBe(list[0]);
  });

  it('is applied to the merged, deduped list before the pick (once per distinct command)', () => {
    const { view, id } = idleActionView();
    const asked: string[] = [];
    const module: BotModule = {
      id: 'dup',
      // 同一個指令出現兩次（去重後只剩一個，取較高分）。
      actions: () => [scored(A, 1e6), scored(B, 1e6 + 5), scored(A, 1e6 + 1)],
      rescore: (_t, c) => (asked.push(c.type), c.type === 'fx.a' ? 10 : 0),
    };
    expect(createBotPolicy('standard', { modules: [module] }).decide(view, ctxFor(id))).toBe(A);
    expect(asked.filter((type) => type === 'fx.a')).toHaveLength(1);
    expect(asked.filter((type) => type === 'fx.b')).toHaveLength(1);
  });

  it('can change which candidate wins, but never adds one', () => {
    const { view, id } = idleActionView();
    const acts = actionsOf(scored(A, 1e6), scored(B, 1e6 - 1));
    const boost: BotModule = { id: 'boost', rescore: (_t, c) => (c.type === 'fx.b' ? 2 : 0) };
    const decide = (modules: BotModule[]) => createBotPolicy('standard', { modules }).decide(view, ctxFor(id));
    expect(decide([acts])).toBe(A);
    expect(decide([acts, boost])).toBe(B);
    // 只有 rescore、沒有候選：什麼都不會被加進來（候選仍然只來自 base 與 actions）。
    const base = decide([]);
    expect(decide([boost])).toEqual(base);
  });

  it('applies to base builds too, so a module can steer between a build and its own action', () => {
    const { state } = newGame({ players: 4 });
    forceTurn(state, 0, 'action');
    state.windowId += 1;
    const model = boardModel(viewOf(state, 'p1'), 'p1');
    const spot = model.topo.vertices.findIndex((info) => info.edges.length === 3);
    const player = state.players.find((candidate) => candidate.id === 'p1')!;
    player.resources = { lumber: 9, brick: 9, wool: 9, grain: 9, ore: 9 };
    // 自己的聚落與道路讓城市升級成為合法的立即建造。
    settle(state, 'p1', spot);
    const view = viewOf(state, 'p1');
    expect(view.hints!.legalCities).toContain(spot);
    const upgrade: BotCommand = { type: 'build.city', vertex: spot };
    const asked: string[] = [];
    const veto: BotModule = {
      id: 'veto',
      actions: () => [scored(A, 0.5)],
      rescore: (_t, c) => (asked.push(c.type), c.type === 'build.city' ? -1e6 : 0),
    };
    const decide = (modules: BotModule[]) => createBotPolicy('standard', { modules }).decide(view, ctxFor('p1'));
    expect(decide([])).toEqual(upgrade);
    expect(decide([veto])).toBe(A);
    expect(asked).toContain('build.city');
  });
});

// ---------------------------------------------------------------------------
// sea.ts 的 blocker 預設（G-SC3）
// ---------------------------------------------------------------------------

describe('bots platform hooks (SFCK-P): sea.ts blocker default', () => {
  const profile = getProfile('sf-ck-new-shores-2025')!;
  // 沒有註冊 SFCK 模組；SF 與 C&K 就是這個 profile 在 0.4.3 之前能用的全部。
  const modules = botModulesOf(profile);

  /** 一艘船可以接過去的海岸路口對：`near` 是自己的聚落，`far` 是船的外端，`beyond` 是 `far` 的另一條海邊。 */
  function coast(model: BoardModel): { near: number; far: number; link: number; beyond: number } {
    const { topo } = model;
    for (let near = 0; near < topo.vertices.length; near++) {
      if (!isLandVertex(model, near)) continue;
      for (const link of topo.vertices[near]!.edges) {
        if (!isSeaEdge(model, link)) continue;
        const [a, b] = topo.edges[link]!.vertices;
        const far = a === near ? b : a;
        const beyond = topo.vertices[far]!.edges.find((edge) => edge !== link && isSeaEdge(model, edge));
        if (beyond !== undefined) return { near, far, link, beyond };
      }
    }
    throw new Error('no coast pair');
  }

  /** 一條路可以接過去的陸地路口對。 */
  function inland(model: BoardModel): { near: number; far: number; link: number; beyond: number } {
    const { topo } = model;
    for (let near = 0; near < topo.vertices.length; near++) {
      for (const link of topo.vertices[near]!.edges) {
        if (!isLandEdge(model, link)) continue;
        const [a, b] = topo.edges[link]!.vertices;
        const far = a === near ? b : a;
        const beyond = topo.vertices[far]!.edges.find((edge) => edge !== link && isLandEdge(model, edge));
        if (beyond !== undefined) return { near, far, link, beyond };
      }
    }
    throw new Error('no inland pair');
  }

  function game(): GameState {
    const state = emptySfckGame(4, 0, 'action');
    state.board.pirate = null; // 海盜另有測試；這裡只看騎士
    return state;
  }

  const withKnight = (state: GameState, vertex: number, player: string): GameView => {
    addKnight(state, { player, vertex, level: 1, active: true });
    return viewOf(state, 'p1');
  };

  it('has the C&K module supply a blocker for opponent knights and none without modules', () => {
    const state = game();
    const near = coast(boardModel(viewOf(state, 'p1'), 'p1')).far;
    const view = withKnight(state, near, 'p2');
    // SFCK-1 起組合層也已註冊，排在 SF 與 C&K 之前；它沒有 `economy`，所以 blocker 仍然來自 C&K。
    expect(modules.map((module) => module.id)).toEqual(['seafarersCitiesKnights', 'seafarers', 'citiesKnights']);
    expect(boardModel(view, 'p1', modules).blocker?.(boardModel(view, 'p1', modules), near)).toBe('p2');
    expect(boardModel(view, 'p1').blocker).toBeUndefined();
  });

  it('keeps a ship search from expanding into, or starting from, a vertex held by an opponent knight', () => {
    const state = game();
    const geometry = coast(boardModel(viewOf(state, 'p1'), 'p1'));
    const { near, far, link } = geometry;
    settle(state, 'p1', near);
    // 擴張（searchShips 的 BFS）：沒有騎士時一艘船就到；對手騎士在外端時到不了。
    const open = boardModel(viewOf(state, 'p1'), 'p1', modules);
    expect(searchShips(open, 'p1', 2).distance[far]).toBe(1);
    const blockedView = withKnight(clone(state), far, 'p2');
    const blocked = boardModel(blockedView, 'p1', modules);
    expect(searchShips(blocked, 'p1', 3).distance[far]).toBe(Infinity);
    // 自己的騎士不擋。
    const ownView = withKnight(clone(state), far, 'p1');
    expect(searchShips(boardModel(ownView, 'p1', modules), 'p1', 2).distance[far]).toBe(1);
    // 沒有模組的 model 沒有 blocker，行為與先前相同。
    expect(searchShips(boardModel(blockedView, 'p1'), 'p1', 2).distance[far]).toBe(1);

    // 起點：船的外端有對手騎士時，它不再是起點。
    ship(state, 'p1', link);
    const started = boardModel(viewOf(state, 'p1'), 'p1', modules);
    expect(searchShips(started, 'p1', 1).distance[far]).toBe(0);
    const pinnedView = withKnight(clone(state), far, 'p2');
    expect(searchShips(boardModel(pinnedView, 'p1', modules), 'p1', 3).distance[far]).toBe(Infinity);
    expect(searchShips(boardModel(pinnedView, 'p1'), 'p1', 1).distance[far]).toBe(0);
  });

  it('keeps a ship from being placed beyond a vertex held by an opponent knight (canPlaceShip)', () => {
    const state = game();
    const { near, far, link, beyond } = coast(boardModel(viewOf(state, 'p1'), 'p1'));
    settle(state, 'p1', near);
    ship(state, 'p1', link);
    const open = viewOf(state, 'p1');
    expect(shipEdgesOf(boardModel(open, 'p1', modules))).toContain(beyond);
    const pinnedView = withKnight(clone(state), far, 'p2');
    expect(shipEdgesOf(boardModel(pinnedView, 'p1', modules))).not.toContain(beyond);
    // 自己的騎士、沒有模組：照舊可以放。
    expect(shipEdgesOf(boardModel(withKnight(clone(state), far, 'p1'), 'p1', modules))).toContain(beyond);
    expect(shipEdgesOf(boardModel(pinnedView, 'p1'))).toContain(beyond);
    // view 版本把 modules 傳進去（F9）；省略時與只有 base 的 model 相同。
    expect(shipEdgesFrom(pinnedView, 'p1', {}, modules)).toEqual(shipEdgesOf(boardModel(pinnedView, 'p1', modules)));
    expect(shipEdgesFrom(pinnedView, 'p1')).toEqual(shipEdgesOf(boardModel(pinnedView, 'p1')));
    expect(shipEdgesFrom(pinnedView, 'p1', {}, modules)).not.toContain(beyond);
  });

  it('keeps a road from extending through a vertex held by an opponent knight (roadEdgesOf)', () => {
    const state = game();
    const { near, far, link, beyond } = inland(boardModel(viewOf(state, 'p1'), 'p1'));
    settle(state, 'p1', near);
    road(state, 'p1', link);
    expect(roadEdgesOf(boardModel(viewOf(state, 'p1'), 'p1', modules))).toContain(beyond);
    const pinnedView = withKnight(clone(state), far, 'p2');
    expect(roadEdgesOf(boardModel(pinnedView, 'p1', modules))).not.toContain(beyond);
    expect(roadEdgesOf(boardModel(pinnedView, 'p1'))).toContain(beyond);
    expect(roadEdgesOf(boardModel(withKnight(clone(state), far, 'p1'), 'p1', modules))).toContain(beyond);
    expect(roadEdgesFrom(pinnedView, 'p1', {}, modules)).toEqual(roadEdgesOf(boardModel(pinnedView, 'p1', modules)));
    expect(roadEdgesFrom(pinnedView, 'p1')).toEqual(roadEdgesOf(boardModel(pinnedView, 'p1')));
  });

  it('lets an explicit options.blocker replace the default rather than stack on it', () => {
    const state = game();
    const { near, far, link, beyond } = coast(boardModel(viewOf(state, 'p1'), 'p1'));
    settle(state, 'p1', near);
    const pinnedView = withKnight(clone(state), far, 'p2');
    const pinned = boardModel(pinnedView, 'p1', modules);
    // 預設擋住 far；傳入「誰都不擋」的 blocker 之後以傳入者為準。
    expect(searchShips(pinned, 'p1', 2).distance[far]).toBe(Infinity);
    expect(searchShips(pinned, 'p1', 2, { blocker: () => null }).distance[far]).toBe(1);
    expect(searchShips(pinned, 'p1', 2, { blocker: (vertex) => (vertex === near ? 'p3' : null) }).distance[far]).toBe(1);
    // 反過來：傳入的 blocker 擋住 far，即使 model 本身沒有騎士。
    const open = boardModel(viewOf(state, 'p1'), 'p1', modules);
    expect(searchShips(open, 'p1', 2, { blocker: (vertex) => (vertex === far ? 'p2' : null) }).distance[far]).toBe(Infinity);
    // 船位：同一條規則。
    const shipped = clone(state);
    ship(shipped, 'p1', link);
    const shippedPinned = boardModel(withKnight(clone(shipped), far, 'p2'), 'p1', modules);
    expect(shipEdgesOf(shippedPinned)).not.toContain(beyond);
    expect(shipEdgesOf(shippedPinned, 'p1', { blocker: () => null })).toContain(beyond);
    expect(shipEdgesFrom(withKnight(clone(shipped), far, 'p2'), 'p1', { blocker: () => null }, modules)).toContain(beyond);
  });

  it('reads the model it is handed, not the one it was built from (hypothetical boards)', () => {
    const state = game();
    const { near, far } = coast(boardModel(viewOf(state, 'p1'), 'p1'));
    settle(state, 'p1', near);
    const emptyView = viewOf(state, 'p1');
    const knightView = withKnight(clone(state), far, 'p2');
    const built = boardModel(emptyView, 'p1', modules);
    // 以空盤面建的 model，換成有騎士的假設 view：預設 blocker 讀到的是假設盤面。
    const hypothetical: BoardModel = { ...built, view: knightView };
    expect(searchShips(built, 'p1', 2).distance[far]).toBe(1);
    expect(searchShips(hypothetical, 'p1', 2).distance[far]).toBe(Infinity);
    // 反過來：以有騎士的盤面建的 model，換成沒有騎士的 view。
    const pinned = boardModel(knightView, 'p1', modules);
    const lifted: BoardModel = { ...pinned, view: emptyView };
    expect(searchShips(pinned, 'p1', 2).distance[far]).toBe(Infinity);
    expect(searchShips(lifted, 'p1', 2).distance[far]).toBe(1);
  });
});

/** 本套件沒有 structuredClone；狀態是純 JSON。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
