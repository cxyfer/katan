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
 *   3. 或回傳 null 且確實不欠動作（`botOwesAction` 為 null）。
 */

import { describe, expect, it } from 'vitest';
import { applyCommand, RESOURCES, seededRng, type GameState } from '@catan/rules';
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
import { seafarersKit } from './modules/seafarers.ts';

declare const console: { log(...args: unknown[]): void };

const KITS = [seafarersKit];
const FUZZ_VARIANTS_TARGET = 150;

function sample(profileId: string, players: number, seed: number, every: number): GameState[] {
  const levels = mixedLevels(players, seed);
  const seats = botSeats(levels, (level) => createBotPolicy(level));
  const out: GameState[] = [];
  let step = 0;
  runBotGame({
    seats,
    seed,
    profileId,
    kits: KITS,
    onDecision: (state) => {
      if (step++ % every === 0 && !state.result) out.push(cloneState(state));
    },
  });
  return out;
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
        const baseStates = [
          ...sample(profileId, players, 71, 5),
          ...sample(profileId, players, 72, 7),
        ];
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
                if (
                  command.type === 'dev.playKnight' &&
                  typeof command.hex === 'number' &&
                  variant.board.layout.terrain[command.hex] === 'sea'
                ) {
                  knightMovesPirate += 1;
                }
                const outcome = applyCommand(variant, player.id, command, seededRng(1));
                if (!outcome.ok) {
                  failures.push(
                    `${player.id} (${level}) rejected: ${JSON.stringify(command)} -> ${outcome.error.code} ${JSON.stringify(outcome.error.params ?? {})}`,
                  );
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
        console.log(`fuzz ${profileId} (${players}p): knight moves pirate count = ${knightMovesPirate}`);
      },
      GAME_TIMEOUT,
    );

    it(`conserves resources and knight cards during seafarers perturbation (${profileId})`, () => {
      const baseStates = sample(profileId, players, 71, 5);
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
