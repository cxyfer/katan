/**
 * `tb-game.ts` 自己的測試（T&B 計畫 §6.1–§6.2）：矩陣的形狀、Trains 投標途中的守恆，以及用工具跑一局短的 FR。
 *
 * FR 沒有模組指令，base 的策略就能終局，所以這一局要求勝者。S2 的 part 策略都還是 stub：其他 profile 的對局由各 part 的
 * 切片（S3–S8）以 `tbMatrix` 加 `expectTbGameHealthy` 驗收。
 */

import { describe, expect, it } from 'vitest';
import { requireProfile, topologyOf, type Command, type GameState } from '@katan/rules';
import { act, give, placeRoad } from '../../rules/test/helpers.ts';
import { tbPlayable } from '../../rules/test/tb-helpers.ts';
import { botModulesOf } from '../src/support.ts';
import { conservationProblems, fallbackSeatSeeds, GAME_TIMEOUT, limitsFor, mixedLevels, naivePolicy, seedsFor } from './harness.ts';
import { tbConservationProblems, tradersBarbariansKit } from './modules/tradersBarbarians.ts';
import { commandCount, expectTbGameHealthy, runTbGame, tbMatrix } from './tb-game.ts';

const FR = 'tb-friendly-robber-2025';

describe('tbMatrix', () => {
  it('lists the seedsFor seeds with mixed levels, plus one game where bot2 only uses the fallback', () => {
    for (const players of [3, 4]) {
      const specs = tbMatrix('tb-barbarian-attack-2025', players);
      const seeds = seedsFor(requireProfile('tb-barbarian-attack-2025'));
      expect(specs).toHaveLength(seeds.length + 1);
      expect(specs.slice(0, -1).map((spec) => spec.seed)).toEqual(seeds);
      for (const spec of specs) {
        expect(spec.players).toBe(players);
        expect(spec.levels).toEqual(mixedLevels(players, spec.seed));
      }
      expect(specs.slice(0, -1).every((spec) => spec.fallbackSeat === undefined)).toBe(true);
      expect(specs.at(-1)).toMatchObject({ seed: fallbackSeatSeeds(players)[0], fallbackSeat: 1 });
      expect(specs.at(-1)!.label).toBe(`tb-barbarian-attack-2025 ${players}p seed ${fallbackSeatSeeds(players)[0]} (seat 2 fallback)`);
    }
  });
});

describe('T&B conservation', () => {
  /** Trains：p1 蓋聚落收集車廂、結束回合，p2 出價 1 grain；全程只從銀行發牌，所以守恆。 */
  function midBid(): GameState {
    const state = tbPlayable('tb-merchant-trains-2025', { seed: 6 });
    const topology = topologyOf(state);
    const vertex = topology.vertices.findIndex(
      (info, index) =>
        !state.board.buildings[index] &&
        info.edges.every((edge) => topology.edges[edge]!.vertices.every((other) => !state.board.buildings[other])),
    );
    placeRoad(state, 'p1', topology.vertices[vertex]!.edges[0]!);
    give(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    give(state, 'p2', { grain: 1 });
    let next = act(state, 'p1', { type: 'build.settlement', vertex }).state;
    next = act(next, 'p1', { type: 'turn.end' }).state;
    next = act(next, 'p1', { type: 'tb.bidWagon', wool: 0, grain: 0 } as unknown as Command).state;
    return act(next, 'p2', { type: 'tb.bidWagon', wool: 0, grain: 1 } as unknown as Command).state;
  }

  it('counts the cards in a Trains bid, which the harness base check does not', () => {
    const state = midBid();
    expect(state.pending).toMatchObject({ kind: 'tradersBarbarians.wagonBid', responders: ['p3', 'p4'] });
    // harness 的 base 守恆只算手牌與銀行：投標中的 1 grain 被當成短少。
    expect(conservationProblems(state, [tradersBarbariansKit])).toEqual(['resource supply 94 != 95']);
    expect(tbConservationProblems(state)).toEqual([]);
    // 真的少了一張時照樣抓得到。
    state.bank.grain -= 1;
    expect(tbConservationProblems(state)).toEqual(['resource grain with bids 18 != 19']);
  });
});

describe('runTbGame', () => {
  it('plays a Friendly Robber game to a healthy finish and records it', () => {
    const spec = tbMatrix(FR, 3)[0]!;
    const record = runTbGame(spec);
    expectTbGameHealthy(record);
    expect(record.winner).not.toBeNull();
    expect(record.steps).toBeLessThanOrEqual(limitsFor(FR).maxSteps);
    expect(record.maxSteps).toBe(3000);
    // 三種來源的計數合計等於步數；FR 至少有一次移動強盜（目標都在 fold 集合內，見 `contract`）。
    const total = Object.values(record.commands).reduce(
      (sum, counts) => sum + Object.values(counts).reduce((inner, count) => inner + count, 0),
      0,
    );
    expect(total).toBe(record.steps);
    expect(commandCount(record, 'turn.roll', 'standard') + commandCount(record, 'turn.roll', 'easy')).toBeGreaterThan(0);
    expect(commandCount(record, 'pending.moveRobber')).toBeGreaterThan(0);
    expect(record.commands.fallback).toEqual({});
    // 同一種子重跑，決策序列相同（R2）。
    expect(runTbGame(spec).hash).toBe(record.hash);
  }, GAME_TIMEOUT);

  it('naive seats keep the Friendly Robber fold: a protected-everyone 7 leaves the robber on the desert', () => {
    // naive 只有 base 策略加保底；FR 的合法強盜格靠 robberTargets 的 fold，不是 duty（#189 審查）。
    const modules = botModulesOf(requireProfile(FR));
    for (const seed of [1, 2, 3]) {
      const spec = { ...tbMatrix(FR, 3)[0]!, seed, label: `${FR} 3p seed ${seed} (naive)` };
      const record = runTbGame(spec, { policyFor: (level) => naivePolicy(level, modules), maxSteps: 800, watchdogRolls: null });
      expectTbGameHealthy(record, { requireWinner: false });
      expect(commandCount(record, 'pending.moveRobber')).toBeGreaterThan(0);
    }
  }, GAME_TIMEOUT);
});
