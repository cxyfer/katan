/**
 * B-POLICY 擾動狀態測試（SF 計畫 §6.1 fuzz）。
 *
 * 從真實對局取樣，再隨機改動手牌、發展卡、銀行存量、船、海盜位置、gold frame、freeRoads。
 * - 4 人（'sf-new-shores-2025'）、6 人（'sf-new-shores-paired-2025'）
 * - standard、easy、fallback
 * - 各 150 個擾動狀態
 * - 斷言：
 *   1. 不拋錯；
 *   2. 回傳的指令被接受；
 *   3. 或回傳 null 且確實不欠動作（`botOwesAction` 為 null）；
 *   4. 騎士打海盜的路徑確實被走到（issue #133）：擾動後的擲骰前狀態（`stageKnightPirate`）中，
 *      standard bot 出騎士並移動海盜的次數與比例都不得低於門檻，且引擎只動海盜、不動強盜。
 */

import { describe, expect, it } from 'vitest';
import { applyCommand, isLandHex, RESOURCES, seededRng, type GameState } from '@catan/rules';
import { botOwesAction, fallbackPolicy } from '../src/fallback.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import type { BotLevel, BotPolicy } from '../src/types.ts';
import {
  GAME_TIMEOUT,
  botSeats,
  cloneState,
  mixedLevels,
  perturbState,
  runBotGame,
  viewFor,
} from './harness.ts';
import { seafarersKit, stageKnightPirate } from './modules/seafarers.ts';

declare const console: { log(...args: unknown[]): void };

const KITS = [seafarersKit];
const FUZZ_VARIANTS_TARGET = 150;
/**
 * 騎士移動海盜的覆蓋門檻（issue #133；種子固定，實測值見 PR 說明）。門檻留有餘裕，策略微調不致誤報，
 * 但覆蓋掉回 0 或只剩零星幾次時會失敗：
 * - 至少 MIN_PIRATE_KNIGHTS 次 standard bot 出騎士並移動海盜；
 * - 佈置好的情境中，至少 MIN_PIRATE_SHARE 的狀態走到這條路徑。
 */
const MIN_PIRATE_KNIGHTS = 5;
const MIN_PIRATE_SHARE = 0.2;

interface Samples {
  /** 沿用的取樣：種子 71 每 5 個決策、種子 72 每 7 個決策。 */
  spread: GameState[];
  /** 兩局裡所有擲骰前、沒有待決效果的狀態（可打騎士的時機）。 */
  preroll: GameState[];
}

function runSample(
  profileId: string,
  players: number,
  seed: number,
  every: number,
  spread: GameState[],
  preroll: GameState[],
): void {
  const levels = mixedLevels(players, seed);
  const seats = botSeats(levels, (level) => createBotPolicy(level));
  let step = 0;
  runBotGame({
    seats,
    seed,
    profileId,
    kits: KITS,
    onDecision: (state) => {
      if (step++ % every === 0 && !state.result) spread.push(cloneState(state));
      if (state.turn.phase === 'preroll' && !state.pending && !state.result) preroll.push(cloneState(state));
    },
  });
}

const sampleCache = new Map<string, Samples>();

/** 同一個 profile 的兩局只跑一次，各個測試共用（取樣是確定的，測試只會 clone 後再改）。 */
function samplesOf(profileId: string, players: number): Samples {
  const cached = sampleCache.get(profileId);
  if (cached) return cached;
  const samples: Samples = { spread: [], preroll: [] };
  runSample(profileId, players, 71, 5, samples.spread, samples.preroll);
  runSample(profileId, players, 72, 7, samples.spread, samples.preroll);
  sampleCache.set(profileId, samples);
  return samples;
}

/** 騎士的目標不是陸地（海域或外框 null）就是移動海盜。 */
function targetsPirate(state: GameState, hex: unknown): hex is number | null {
  return hex === null || (typeof hex === 'number' && !isLandHex(state, hex));
}

/** 移動海盜被接受之後，引擎只該動海盜：海盜在目標上，強盜留在原處。回傳問題描述，沒問題為 null。 */
function pirateMoveProblem(before: GameState, after: GameState, hex: number | null): string | null {
  if (after.board.pirate === hex && after.board.robber === before.board.robber) return null;
  return `knight to ${String(hex)} left pirate ${String(after.board.pirate)} / robber ${after.board.robber} (was robber ${before.board.robber})`;
}

const CASES = [
  { profileId: 'sf-new-shores-2025' as const, players: 4 },
  { profileId: 'sf-new-shores-paired-2025' as const, players: 6 },
];

describe('Seafarers fuzz perturbed states', () => {
  for (const { profileId, players } of CASES) {
    it(
      `issues only accepted commands or valid nulls from 150 perturbed ${players}-player states (${profileId})`,
      () => {
        const baseStates = samplesOf(profileId, players).spread;
        expect(baseStates.length).toBeGreaterThan(0);

        const rng = seededRng(players * 1000 + 7);
        const variants: GameState[] = [];

        // 產生 150 個擾動狀態
        let stateIndex = 0;
        while (variants.length < FUZZ_VARIANTS_TARGET) {
          const base = baseStates[stateIndex % baseStates.length]!;
          variants.push(perturbState(base, rng, KITS));
          stateIndex += 1;
        }

        expect(variants).toHaveLength(FUZZ_VARIANTS_TARGET);

        // 驗證守恆：所有變體的資源總數都等於 bank 存量（4 人 19*5，6 人 24*5）
        let conservationFailures = 0;
        for (const variant of variants) {
          const probs = seafarersKit.conservation!(variant);
          if (probs.length > 0) conservationFailures += 1;
        }
        console.log(
          `fuzz ${profileId} (${players}p): 150 variants conservation failures = ${conservationFailures}`,
        );
        expect(conservationFailures).toBe(0);

        const pirateAtSeaCount = variants.filter(
          (v) => v.board.pirate !== null && v.board.layout.terrain[v.board.pirate] === 'sea',
        ).length;
        expect(pirateAtSeaCount, 'fuzz variants must contain states with pirate at sea').toBeGreaterThanOrEqual(1);

        let checked = 0;
        let standardKnights = 0;
        let knightMovesPirate = 0;
        const failures: string[] = [];

        for (const [vIdx, variant] of variants.entries()) {
          for (const player of variant.players) {
            for (const level of ['standard', 'easy', 'fallback'] as const) {
              const effectiveLevel: BotLevel = level === 'fallback' ? 'standard' : level;
              const policy: BotPolicy = level === 'fallback' ? fallbackPolicy : createBotPolicy(effectiveLevel);
              const ctx = {
                selfId: player.id,
                level: effectiveLevel,
                seed: botSeed('fuzz', player.id, variant.seq, vIdx),
                offerPhases: {},
              };
              const view = viewFor(variant, player.id);

              let command = null;
              try {
                command = policy.decide(view, ctx);
              } catch (error) {
                failures.push(
                  `${player.id} (${level}) threw exception: ${error instanceof Error ? error.stack : String(error)}`,
                );
                continue;
              }

              checked += 1;

              if (command) {
                const outcome = applyCommand(variant, player.id, command, seededRng(1));
                if (!outcome.ok) {
                  failures.push(
                    `${player.id} (${level}) rejected: ${JSON.stringify(command)} -> ${outcome.error.code} ${JSON.stringify(outcome.error.params ?? {})}`,
                  );
                } else if (command.type === 'dev.playKnight' && level === 'standard') {
                  standardKnights += 1;
                  if (targetsPirate(variant, command.hex)) {
                    knightMovesPirate += 1;
                    const problem = pirateMoveProblem(variant, outcome.state, command.hex);
                    if (problem) failures.push(`${player.id} ${problem}`);
                  }
                }
              } else {
                const owed = botOwesAction(view, player.id);
                if (owed !== null) {
                  failures.push(
                    `${player.id} (${level}) returned null while owing action: ${JSON.stringify(owed)}`,
                  );
                }
              }
            }
          }
        }

        expect(failures.slice(0, 10)).toEqual([]);
        expect(checked).toBeGreaterThanOrEqual(FUZZ_VARIANTS_TARGET * players * 3);
        console.log(
          `fuzz ${profileId} (${players}p): knight moves pirate count = ${knightMovesPirate} of ${standardKnights} standard knights`,
        );
      },
      GAME_TIMEOUT,
    );

    it(`moves the pirate with a knight in staged preroll states (${profileId})`, () => {
      const { preroll } = samplesOf(profileId, players);
      expect(preroll.length).toBeGreaterThan(0);
      const rng = seededRng(players * 3000 + 17);
      const policy = createBotPolicy('standard');
      let staged = 0;
      let knights = 0;
      let pirateKnights = 0;
      const failures: string[] = [];

      for (const base of preroll) {
        // 一般擾動（手牌、銀行、發展卡）之後，一律佈置成「持有騎士、海盜擋在我的船端前」
        const variant = perturbState(base, rng);
        if (!stageKnightPirate(variant, rng, 1)) continue;
        staged += 1;
        const actor = variant.players[variant.turn.seat]!;
        const ctx = {
          selfId: actor.id,
          level: 'standard' as const,
          seed: botSeed('fuzz-knight', actor.id, variant.seq, staged),
          offerPhases: {},
        };
        const command = policy.decide(viewFor(variant, actor.id), ctx);
        if (command?.type !== 'dev.playKnight') continue;
        knights += 1;
        const outcome = applyCommand(variant, actor.id, command, seededRng(1));
        if (!outcome.ok) {
          failures.push(`${actor.id} rejected: ${JSON.stringify(command)} -> ${outcome.error.code}`);
          continue;
        }
        if (targetsPirate(variant, command.hex)) {
          pirateKnights += 1;
          const problem = pirateMoveProblem(variant, outcome.state, command.hex);
          if (problem) failures.push(`${actor.id} ${problem}`);
        }
      }

      console.log(
        `knight pirate (${profileId} ${players}p): ${preroll.length} preroll bases, ${staged} staged, ${knights} knights played, ${pirateKnights} moved the pirate (${((100 * pirateKnights) / Math.max(staged, 1)).toFixed(0)}% of staged)`,
      );
      expect(failures.slice(0, 10)).toEqual([]);
      expect(staged, 'staged knight/pirate states').toBeGreaterThan(0);
      expect(pirateKnights, 'standard knights that move the pirate').toBeGreaterThanOrEqual(MIN_PIRATE_KNIGHTS);
      expect(pirateKnights / staged).toBeGreaterThanOrEqual(MIN_PIRATE_SHARE);
    }, GAME_TIMEOUT);

    it(`conserves resources and knight cards during seafarers perturbation (${profileId})`, () => {
      const baseStates = samplesOf(profileId, players).spread;
      const rng = seededRng(players * 2000 + 13);
      let checked = 0;
      let knightGiven = 0;
      for (const base of baseStates) {
        const state = cloneState(base);
        const beforeResources = RESOURCES.map(
          (r) => state.bank[r] + state.players.reduce((sum, p) => sum + p.resources[r], 0),
        );
        const beforeDeckKnights = state.devDeck.filter((c) => c === 'knight').length;
        const beforeHeldKnights = state.players.reduce(
          (sum, p) => sum + p.devCards.filter((c) => c === 'knight').length,
          0,
        );
        const beforeTotalDevCards =
          state.devDeck.length + state.players.reduce((sum, p) => sum + p.devCards.length, 0);

        seafarersKit.perturb!(state, rng);

        const afterResources = RESOURCES.map(
          (r) => state.bank[r] + state.players.reduce((sum, p) => sum + p.resources[r], 0),
        );
        const afterDeckKnights = state.devDeck.filter((c) => c === 'knight').length;
        const afterHeldKnights = state.players.reduce(
          (sum, p) => sum + p.devCards.filter((c) => c === 'knight').length,
          0,
        );
        const afterTotalDevCards =
          state.devDeck.length + state.players.reduce((sum, p) => sum + p.devCards.length, 0);

        expect(afterResources).toEqual(beforeResources);
        expect(afterDeckKnights + afterHeldKnights).toBe(beforeDeckKnights + beforeHeldKnights);
        expect(afterTotalDevCards).toBe(beforeTotalDevCards);
        if (afterHeldKnights > beforeHeldKnights) knightGiven += 1;
        checked += 1;
      }
      console.log(
        `perturb conservation (${profileId} ${players}p): ${checked} states checked, resources & dev cards conserved, knights transferred from deck = ${knightGiven}`,
      );
    });
  }
});
