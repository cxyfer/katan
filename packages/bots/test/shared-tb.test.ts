/**
 * T&B 用到的共用骨架修正（T&B 計畫 §4.3，S1）：個人勝利分（`targetOf`）、`economy.awards` 關掉最長道路、
 * 報價 goods 的規則 9（`trade.goods`／`goodValue`）、Rivers 的 `extraNumbers` 計入產量、橋不佔道路存量。
 *
 * registry 還沒有 T&B 模組，這裡用只存在於測試內的假模組，盤面用 base 的固定開局改出來。
 */

import { describe, expect, it } from 'vitest';
import { actionHints, projectGame, type GameState, type GameView, type Offer } from '@catan/rules';
import { placePath, playableGame } from '../../rules/test/helpers.ts';
import { boardModel, piecesLeft, piecesOnBoard, pipsOf, routeLength, targetOf, vertexYield } from '../src/board.ts';
import { robberCandidates } from '../src/base/robber.ts';
import { usefulRoad } from '../src/base/roads.ts';
import { economyOf } from '../src/economy.ts';
import { turnContext } from '../src/heuristic.ts';
import type { BotModule } from '../src/modules/types.ts';
import { createBotPolicy } from '../src/policy.ts';
import { acceptMargin, goodsGain, offerGain, offerValue } from '../src/trade.ts';
import type { BotContext } from '../src/types.ts';

const ctxFor = (selfId: string): BotContext => ({ selfId, level: 'standard', seed: 1, offerPhases: {} });

function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

/** base 開局完成、輪到 p1 的行動階段。 */
const opening = (): GameState => playableGame().state;

const withPlayer = (view: GameView, id: string, patch: Partial<GameView['players'][number]>): GameView => ({
  ...view,
  players: view.players.map((player) => (player.id === id ? { ...player, ...patch } : player)),
});

const awardsModule = (longestRoad?: boolean): BotModule => ({
  id: 'fx',
  economy: { awards: () => (longestRoad === undefined ? {} : { longestRoad }) },
});

describe('targetOf: per-player victory targets', () => {
  it('reads the player target first and falls back to the profile target', () => {
    const view = viewOf(opening(), 'p1');
    expect(targetOf(view, 'p2')).toBe(view.victoryTarget);
    expect(targetOf(withPlayer(view, 'p2', { victoryTarget: 13 }), 'p2')).toBe(13);
    expect(targetOf(view, 'nobody')).toBe(view.victoryTarget);
  });

  it('feeds acceptMargin and the base robber weighting', () => {
    const view = viewOf(opening(), 'p1');
    const score = view.players.find((player) => player.id === 'p2')!.publicScore;
    expect(acceptMargin(view, 'p1', 'p2', 0.6)).toBe(0.6);
    expect(acceptMargin(withPlayer(view, 'p2', { victoryTarget: score + 2 }), 'p1', 'p2', 0.6)).toBe(Infinity);
    // p2 接近自己的勝利分時，壓它的格子分數更高。
    const scores = (next: GameView) => robberCandidates(turnContext(next, ctxFor('p1'), 'standard', []));
    const near = scores(withPlayer(view, 'p2', { victoryTarget: score + 3 }));
    const far = scores(view);
    const p2Hex = far.findIndex((candidate, index) => near[index]!.score > candidate.score);
    expect(p2Hex).toBeGreaterThanOrEqual(0);
    expect(near.map((candidate) => candidate.item)).toEqual(far.map((candidate) => candidate.item));
  });
});

describe('economy.awards: no longest road award', () => {
  /** p1 有一條 4 段的路線，差 1 段就拿得到最長道路。 */
  function nearLongestRoad(): GameView {
    const state = opening();
    for (let edge = 0; edge < state.board.roads.length; edge++) if (state.board.roads[edge]?.player === 'p1') state.board.roads[edge] = null;
    placePath(state, 'p1', 4);
    return viewOf(state, 'p1');
  }

  it('drops the longestRoad plan when any module turns the award off', () => {
    const view = nearLongestRoad();
    const model = boardModel(view, 'p1');
    expect(routeLength(model, 'p1')).toBe(4);
    const kinds = (modules: BotModule[]) => economyOf(model, modules).plans.map((plan) => plan.kind);
    expect(kinds([])).toContain('longestRoad');
    expect(kinds([awardsModule()])).toContain('longestRoad');
    expect(kinds([awardsModule(true)])).toContain('longestRoad');
    expect(kinds([awardsModule(false)])).not.toContain('longestRoad');
    expect(kinds([awardsModule(true), awardsModule(false)])).not.toContain('longestRoad');
  });

  it('stops usefulRoad from extending the route, but still returns a road when one is required', () => {
    const view = viewOf(opening(), 'p1');
    // 沒有聚落與城市計畫：usefulRoad 只剩延長路線與路向評分。
    const noBuildings: BotModule['economy'] = { piecesLeft: () => ({ settlements: 0, cities: 0 }) };
    const turn = (longestRoad: boolean) =>
      turnContext(view, ctxFor('p1'), 'standard', [{ id: 'fx', economy: { ...noBuildings, awards: () => ({ longestRoad }) } }]);
    expect(usefulRoad(turn(true), false)).not.toBeNull();
    expect(usefulRoad(turn(false), false)).toBeNull();
    expect(view.hints!.legalRoads).toContain(usefulRoad(turn(false), true));
  });
});

describe('rule 9: offer goods', () => {
  const position = () => {
    // p1 是行動者；p2 回應 p1 對全桌的報價。
    const state = opening();
    return { state, view: viewOf(state, 'p2') };
  };
  const offerOf = (view: GameView, patch: Partial<Offer>): Offer => ({
    id: 'o1',
    revision: 1,
    from: 'p1',
    to: 'all',
    give: {},
    want: {},
    windowId: view.windowId,
    status: 'open',
    responses: {},
    agreedWith: null,
    createdSeq: 1,
    ...patch,
  });
  const goldModule = (held: Record<string, number>, perGold = 1): BotModule => ({
    id: 'fx',
    trade: {
      goods: (_view, playerId) => ({ gold: held[playerId] ?? 0 }),
      goodValue: (_turn, good, amount) => (good === 'gold' ? amount * perGold : undefined),
    },
  });
  const answer = (view: GameView, offer: Offer, modules: BotModule[]) =>
    createBotPolicy('standard', { modules }).decide({ ...view, offers: [offer] }, ctxFor('p2'));
  const consented = { type: 'trade.respond', response: 'consented' };
  const declined = { type: 'trade.respond', response: 'declined' };

  it('declines every goods offer when no module prices goods, as before', () => {
    const { view } = position();
    const gift = offerOf(view, { give: { lumber: 3, brick: 3, wool: 3, grain: 3, ore: 3 } });
    for (const modules of [[], [{ id: 'fx' }], [awardsModule()]] as BotModule[][]) {
      expect(answer(view, gift, modules)).toMatchObject(consented);
      expect(answer(view, { ...gift, giveGoods: { gold: 1 } }, modules)).toMatchObject(declined);
      expect(answer(view, { ...gift, wantGoods: { gold: 1 } }, modules)).toMatchObject(declined);
    }
  });

  it('(a) declines a good nobody prices, or one a module refuses to price', () => {
    const { view } = position();
    const gold = goldModule({ p1: 5, p2: 5 });
    expect(answer(view, offerOf(view, { giveGoods: { gold: 2 } }), [gold])).toMatchObject(consented);
    expect(answer(view, offerOf(view, { giveGoods: { gold: 2, silk: 1 } }), [gold])).toMatchObject(declined);
    const refuses: BotModule = { id: 'fy', trade: { goodValue: () => null } };
    expect(answer(view, offerOf(view, { giveGoods: { gold: 2 } }), [refuses, gold])).toMatchObject(declined);
    // 第一個非 undefined 勝出：gold 模組在前時 fy 不被採用。
    expect(answer(view, offerOf(view, { giveGoods: { gold: 2 } }), [gold, refuses])).toMatchObject(consented);
  });

  it('(b) declines when it would pay more goods than it holds', () => {
    const { view } = position();
    const gift = offerOf(view, { give: { lumber: 3, brick: 3, wool: 3, grain: 3, ore: 3 }, wantGoods: { gold: 2 } });
    expect(answer(view, gift, [goldModule({ p1: 0, p2: 1 })])).toMatchObject(declined);
    expect(answer(view, gift, [goldModule({ p1: 0, p2: 2 })])).toMatchObject(consented);
  });

  it('(c) declines when the proposer publicly holds fewer goods than it gives', () => {
    const { state, view } = position();
    const offer = offerOf(view, { giveGoods: { gold: 3 } });
    expect(answer(view, offer, [goldModule({ p1: 2 })])).toMatchObject(declined);
    expect(answer(view, offer, [goldModule({ p1: 3 })])).toMatchObject(consented);
    // 行動者處理反報價：提出者付不起 goods 就不結算。
    const actor = viewOf(state, 'p1');
    const counter = { ...offerOf(actor, { giveGoods: { gold: 3 } }), from: 'p2', to: 'p1' };
    const decide = (held: Record<string, number>) =>
      createBotPolicy('standard', { modules: [goldModule(held)] }).decide({ ...actor, offers: [counter] }, ctxFor('p1'));
    expect(decide({ p2: 2 })).toMatchObject(declined);
    expect(decide({ p2: 3 })).toMatchObject({ type: 'trade.settle', offerId: 'o1' });
  });

  it('(d) prices goods in resource equivalents on the hand-utility scale', () => {
    const { view } = position();
    const turn = (perGold: number) => turnContext(view, ctxFor('p2'), 'standard', [goldModule({ p1: 9, p2: 9 }, perGold)]);
    const plain = offerOf(view, { give: { wool: 1 }, want: { ore: 1 } });
    const t = turn(1);
    expect(offerValue(t, plain)).toBe(offerGain(t.economy, plain));
    const receive = goodsGain(t, { ...plain, giveGoods: { gold: 2 } })!;
    const pay = goodsGain(t, { ...plain, wantGoods: { gold: 2 } })!;
    expect(receive).toBeGreaterThan(0);
    expect(pay).toBeCloseTo(-receive);
    expect(goodsGain(turn(2), { ...plain, giveGoods: { gold: 2 } })).toBeCloseTo(2 * receive);
    expect(offerValue(t, { ...plain, giveGoods: { gold: 2 } })).toBeCloseTo(offerGain(t.economy, plain) + receive);
    // goods 的價值足以左右決定：同樣送 2 gold，估值高才同意。
    const goldOnly = offerOf(view, { giveGoods: { gold: 2 } });
    expect(answer(view, goldOnly, [goldModule({ p1: 9 }, 1)])).toMatchObject(consented);
    expect(answer(view, goldOnly, [goldModule({ p1: 9 }, 0.1)])).toMatchObject(declined);
  });
});

describe('board: Rivers numbers and bridges', () => {
  it('adds extraNumbers to the hex pips and the production estimate', () => {
    const view = viewOf(opening(), 'p1');
    const hex = view.board.numbers.findIndex((number) => number !== null);
    const vertex = boardModel(view, 'p1').hexVertices[hex]![0]!;
    const plain = boardModel(view, 'p1');
    const rivers = boardModel({ ...view, board: { ...view.board, extraNumbers: [{ hex, number: 2 }] } }, 'p1');
    expect(rivers.hexPips[hex]).toBe(plain.hexPips[hex]! + pipsOf(2));
    expect(rivers.hexPips.filter((_, index) => index !== hex)).toEqual(plain.hexPips.filter((_, index) => index !== hex));
    const resource = plain.hexResource[hex]!;
    expect(vertexYield(rivers, vertex)[resource]).toBe(vertexYield(plain, vertex)[resource] + pipsOf(2));
  });

  it('does not count bridges against the road stock', () => {
    const view = viewOf(opening(), 'p1');
    const free = view.board.roads.findIndex((road) => road === null);
    const roads = view.board.roads.slice();
    const before = piecesOnBoard(boardModel(view, 'p1'), 'p1').roads;
    roads[free] = { player: 'p1', ship: false, bridge: true };
    const bridged = boardModel({ ...view, board: { ...view.board, roads } }, 'p1');
    expect(piecesOnBoard(bridged, 'p1').roads).toBe(before);
    expect(piecesLeft(bridged, 'p1').roads).toBe(bridged.profile.pieces.roads - before);
    roads[free] = { player: 'p1', ship: false };
    expect(piecesOnBoard(boardModel({ ...view, board: { ...view.board, roads } }, 'p1'), 'p1').roads).toBe(before + 1);
  });
});
