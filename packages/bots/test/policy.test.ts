/**
 * B-POLICY／B-GAME：Bot 對 Bot 完整對局。每個決策都交給規則引擎驗證，並逐步檢查
 * 策略合約（規格 §5）。
 *
 * 對局走通用矩陣（`GENERIC_MATRIX`：每個開放且 Bot 玩得動的 profile × 人數；已有 family 測試檔的
 * profile 由該檔涵蓋），以仿 BotDriver 模式進行：策略閒置、但保底有動作，與卡死、看門狗逾限一樣算失敗。
 * base 另外與 v0.4.0 的 golden 逐局比對（B-GAME 40 局、保底席 3 局、wrapped 1 局；全保底 4 局在
 * `fallback.test.ts`），證明平台化沒有改變 base 的任何一個決策。要比對哪些局由 `goldenIdsFor` 決定，
 * `matrix.test.ts` 斷言它們合起來剛好是 fixture 的 48 局。
 */

import { describe, expect, it } from 'vitest';
import { getTopology, requireProfile, type GameState, type ProfileDefinition } from '@catan/rules';
import { botCommandLimit } from '../src/index.ts';
import { heuristicPolicy } from '../src/heuristic.ts';
import { createBotPolicy } from '../src/policy.ts';
import { MAX_OFFERS_PER_WINDOW } from '../src/trade.ts';
import type { BotCommand, BotLevel, BotPolicy } from '../src/types.ts';
import {
  allowedResponseCommands,
  BOT_WINDOW_COMMAND_LIMIT,
  botSeats,
  createDecisionHasher,
  fallbackSeatSeeds,
  GAME_TIMEOUT,
  GENERIC_MATRIX,
  goldenId,
  goldenIdsFor,
  goldenMismatches,
  mixedLevels,
  responseCommandDrift,
  runBotGame,
  seedsFor,
  WRAPPED_SEED,
  withFallbackSeat,
  type BotSeat,
  type Decision,
} from './harness.ts';
import type { ModuleTestKit } from './modules/types.ts';


/** 通用矩陣的 profile 沒有模組（有模組的 profile 由自己的 family 測試檔涵蓋）。 */
const NO_KITS: readonly ModuleTestKit[] = [];

/** 逐步檢查合約，並收集報價與強盜的觀察。 */
function contractChecks(seats: readonly BotSeat[], profile: ProfileDefinition, kits: readonly ModuleTestKit[] = NO_KITS) {
  const violations: string[] = responseCommandDrift(profile, kits).map((drift) => `response command drift: ${drift}`);
  const responseCommands = allowedResponseCommands(profile, kits);
  const check = (state: GameState, decision: Decision): void => {
    const { actor, command } = decision;
    const turnActor = state.players[state.turn.seat]!.id;
    const where = `seq ${state.seq} ${actor} ${command.type}`;
    // 規則 3：非行動者只回應待決效果與報價（base 加上模組宣告的 responseCommands）。
    if (actor !== turnActor && !responseCommands.has(command.type)) violations.push(`non-actor: ${where}`);
    if (actor !== turnActor && command.type === 'build.road' && state.pending?.kind !== 'freeRoads') {
      violations.push(`non-actor road: ${where}`);
    }
    // paired Player 2 不發起、不結算國內交易。
    const paired = requireProfile(state.profileId).paired && state.turn.pairedActor === 2;
    if (paired && actor === turnActor && (command.type === 'trade.offer' || command.type === 'trade.settle')) {
      violations.push(`paired second trades: ${where}`);
    }
    if (command.type === 'trade.offer') {
      const mine = state.offers.filter((offer) => offer.from === actor && offer.windowId === state.windowId);
      if (mine.length >= MAX_OFFERS_PER_WINDOW) violations.push(`offer limit: ${where}`);
      const same = mine.some(
        (offer) => JSON.stringify(offer.give) === JSON.stringify(command.give) && JSON.stringify(offer.want) === JSON.stringify(command.want),
      );
      if (same) violations.push(`repeated offer: ${where}`);
    }
    // standard 不把強盜放到只有自己建築的格子（有其他選擇時）。
    const seat = seats.find((candidate) => candidate.id === actor);
    const robberHex = robberTarget(command);
    if (seat?.level === 'standard' && robberHex !== null && ownsOnlyBuildingsOn(state, actor, robberHex)) {
      violations.push(`robber on own hex: ${where} hex ${robberHex}`);
    }
  };
  return { violations, check };
}

function robberTarget(command: BotCommand): number | null {
  if (command.type === 'pending.moveRobber' || command.type === 'dev.playKnight') return command.hex as number | null;
  return null;
}

function ownsOnlyBuildingsOn(state: GameState, playerId: string, hex: number): boolean {
  const owners = new Set<string>();
  state.board.buildings.forEach((building, vertex) => {
    if (!building) return;
    // 以拓樸判斷路口是否屬於該格：路口相鄰格包含 hex。
    if (topologyHexes(state, vertex).includes(hex)) owners.add(building.player);
  });
  return owners.size > 0 && [...owners].every((owner) => owner === playerId);
}

function topologyHexes(state: GameState, vertex: number): number[] {
  return getTopology(state.board.layout.topologyId).vertices[vertex]!.hexes;
}

/** 一局：合約檢查加上決策序列的雜湊（與 golden 相同的算法）。 */
function playGame(seats: BotSeat[], seed: number, profile: ProfileDefinition) {
  const contract = contractChecks(seats, profile);
  const hasher = createDecisionHasher();
  const run = runBotGame({
    seats,
    seed,
    profileId: profile.id,
    onDecision: (state, decision) => {
      contract.check(state, decision);
      hasher.onDecision(state, decision);
    },
  });
  return { run, violations: contract.violations, hash: hasher.digest() };
}

describe('B-GAME bot-only games', () => {
  for (const entry of GENERIC_MATRIX) {
    const { profile, players } = entry;
    const seeds = seedsFor(profile);
    const golden = new Set(goldenIdsFor(entry));
    it(`finishes with a winner and zero rejections (${profile.id}, ${players} players, ${seeds.length} seeds)`, () => {
      const limit = botCommandLimit(profile, BOT_WINDOW_COMMAND_LIMIT);
      let compared = 0;
      for (const seed of seeds) {
        const seats = botSeats(mixedLevels(players, seed), (level) => createBotPolicy(level));
        const { run, violations, hash } = playGame(seats, seed, profile);
        const label = `${profile.id} ${players}p seed ${seed}`;
        expect(run.failure, `${label}: ${JSON.stringify(run.failure)}`).toBeNull();
        expect(run.stuck, `${label}: both policy and fallback idle at seq ${run.state.seq}`).toBeNull();
        expect(run.watchdog, `${label}: no seat reached a new high for ${run.watchdog?.rolls} rolls`).toBeNull();
        // 策略閒置、但保底有動作：BotDriver 會悄悄改用保底，測試必須抓出來。
        expect(run.idleFallbacks, `${label}: policy idle while the fallback acted`).toEqual([]);
        expect(run.state.result?.reason, `${label}: no result after ${run.steps} steps`).toBe('victory');
        expect(run.state.pending, label).toBeNull();
        expect(run.conservation, label).toEqual([]);
        expect(run.maxWindowCommands, `${label}: commands in one window`).toBeLessThanOrEqual(limit);
        expect(violations, label).toEqual([]);

        // base 與 v0.4.0 逐局相同：步數、seq、勝者、結束原因與決策雜湊。
        const id = goldenId.bGame(players, seed);
        if (golden.has(id)) {
          expect(goldenMismatches(id, run, hash), `${label}: differs from the v0.4.0 golden`).toEqual([]);
          compared += 1;
        }
      }
      // 有 golden 的 profile，每個種子都必須真的比對到。
      expect(compared, `${profile.id} ${players}p: golden comparisons`).toBe(golden.size === 0 ? 0 : seeds.length);
    }, GAME_TIMEOUT);
  }

  // 每個（profile, 人數）至少 1 個種子讓 1 席只走保底，其餘座位用策略。
  for (const entry of GENERIC_MATRIX) {
    const { profile, players } = entry;
    const golden = new Set(goldenIdsFor(entry));
    it(`lets the fallback seat stay silent while offers time out (${profile.id}, ${players} players)`, () => {
      // 保底座位從不回應報價，報價必須經過 ready／expired 才撤回或結算。
      const levels: BotLevel[] = Array.from({ length: players }, (_, index) => (index === 1 ? 'easy' : 'standard'));
      const limit = botCommandLimit(profile, BOT_WINDOW_COMMAND_LIMIT);
      for (const seed of fallbackSeatSeeds(players)) {
        const seats = withFallbackSeat(botSeats(levels, (level) => createBotPolicy(level)), 1);
        const { run, violations, hash } = playGame(seats, seed, profile);
        const label = `${profile.id} ${players}p seed ${seed}`;
        expect(run.failure, `${label}: ${JSON.stringify(run.failure)}`).toBeNull();
        expect(run.stuck, label).toBeNull();
        expect(run.watchdog, label).toBeNull();
        expect(run.idleFallbacks, label).toEqual([]);
        expect(run.state.result?.reason, label).toBe('victory');
        expect(run.state.pending, label).toBeNull();
        expect(run.conservation, label).toEqual([]);
        expect(run.maxWindowCommands, `${label}: commands in one window`).toBeLessThanOrEqual(limit);
        expect(violations, label).toEqual([]);
        const offers = run.state.offers.filter((offer) => offer.from !== 'bot2');
        expect(offers.length, label).toBeGreaterThan(0);
        expect(offers.every((offer) => offer.status !== 'open'), label).toBe(true);
        const id = goldenId.fallbackSeat(players, seed);
        if (golden.has(id)) expect(goldenMismatches(id, run, hash), `${label}: differs from the v0.4.0 golden`).toEqual([]);
      }
    }, GAME_TIMEOUT);
  }

  // 經過 `createBotPolicy` 的一局（server 用的包裝），4 人。
  for (const entry of GENERIC_MATRIX.filter((candidate) => candidate.players === 4)) {
    const { profile } = entry;
    const golden = new Set(goldenIdsFor(entry));
    it(`runs through the wrapped policy the service uses (${profile.id})`, () => {
      const seats = botSeats(['standard', 'easy', 'easy', 'standard'], (level) => createBotPolicy(level));
      const { run, violations, hash } = playGame(seats, WRAPPED_SEED, profile);
      expect(run.failure).toBeNull();
      expect(run.idleFallbacks).toEqual([]);
      expect(run.state.result?.reason).toBe('victory');
      expect(violations).toEqual([]);
      const id = goldenId.wrapped(4, WRAPPED_SEED);
      if (golden.has(id)) expect(goldenMismatches(id, run, hash), 'differs from the v0.4.0 golden').toEqual([]);
    }, GAME_TIMEOUT);
  }
});

describe('B-POLICY determinism', () => {
  // 只取有 4 人的 profile：通用矩陣裡 base-2025 有 4 人，base-paired-2025（5、6 人）沒有，所以不跑。
  for (const { profile, players } of GENERIC_MATRIX.filter((entry) => entry.players === 4)) {
    const transcript = (policyFor: (level: BotLevel) => BotPolicy, seed: number): string[] => {
      const seats = botSeats(mixedLevels(players, seed), policyFor);
      const commands: string[] = [];
      runBotGame({
        seats,
        seed,
        profileId: profile.id,
        onDecision: (_state, decision) => commands.push(JSON.stringify(decision)),
      });
      return commands;
    };

    it(`replays the same game command for command (${profile.id})`, () => {
      for (const seed of [41, 42]) {
        const first = transcript((level) => heuristicPolicy(level), seed);
        const second = transcript((level) => heuristicPolicy(level), seed);
        expect(first.length).toBeGreaterThan(100);
        expect(second).toEqual(first);
      }
    }, GAME_TIMEOUT);

    it(`separate policy instances agree on the same view and context (${profile.id})`, () => {
      const a = transcript((level) => heuristicPolicy(level), 43);
      const b = transcript((level) => createBotPolicy(level), 43);
      expect(b).toEqual(a);
    }, GAME_TIMEOUT);
  }
});
