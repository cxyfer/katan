/**
 * B-POLICY 擾動狀態：從真實對局取樣，再隨機改動手牌、發展卡與銀行存量，要求
 * 每個決策都被規則引擎接受。用來覆蓋對局中少見的窗口（空銀行、大手牌、各種卡）。
 */

import { describe, expect, it } from 'vitest';
import { applyCommand, seededRng, type GameState } from '@catan/rules';
import { heuristicPolicy } from '../src/heuristic.ts';
import { botSeed } from '../src/seed.ts';
import type { BotLevel } from '../src/types.ts';
import { GAME_TIMEOUT, botSeats, cloneState, GENERIC_MATRIX, perturbState, runBotGame, viewFor } from './harness.ts';
import type { ModuleTestKit } from './modules/types.ts';


/** 通用矩陣的 profile 沒有模組；有模組的 profile 由自己的 family 測試檔傳入 kit。 */
const KITS: readonly ModuleTestKit[] = [];

function sample(profileId: string, players: number, seed: number, every: number): GameState[] {
  const levels: BotLevel[] = Array.from({ length: players }, (_, index) => (index % 2 === 0 ? 'standard' : 'easy'));
  const out: GameState[] = [];
  let step = 0;
  runBotGame({
    seats: botSeats(levels, (level) => heuristicPolicy(level)),
    seed,
    profileId,
    onDecision: (state) => {
      if (step++ % every === 0 && !state.result) out.push(cloneState(state));
    },
  });
  return out;
}

describe('B-POLICY perturbed states', () => {
  // 4 人與 6 人：通用矩陣裡 base-2025 有 4 人，base-paired-2025 有 6 人。
  for (const { profile, players } of GENERIC_MATRIX.filter((entry) => entry.players === 4 || entry.players === 6)) {
    it(`issues only accepted commands from perturbed ${players}-player states (${profile.id})`, () => {
      const states = [...sample(profile.id, players, 71, 5), ...sample(profile.id, players, 72, 7)];
      const rng = seededRng(players * 1000 + 7);
      let checked = 0;
      const failures: string[] = [];
      for (const state of states) {
        for (let round = 0; round < 3; round++) {
          const variant = perturbState(state, rng, KITS);
          for (const player of variant.players) {
            for (const level of ['standard', 'easy'] as BotLevel[]) {
              const ctx = { selfId: player.id, level, seed: botSeed('fuzz', player.id, variant.seq, round), offerPhases: {} };
              const command = heuristicPolicy(level).decide(viewFor(variant, player.id), ctx);
              if (!command) continue;
              const outcome = applyCommand(variant, player.id, command, seededRng(1));
              checked += 1;
              if (!outcome.ok) {
                failures.push(`${player.id} ${level} ${JSON.stringify(command)} -> ${outcome.error.code} ${JSON.stringify(outcome.error.params ?? {})}`);
              }
            }
          }
        }
      }
      expect(failures.slice(0, 10)).toEqual([]);
      expect(checked).toBeGreaterThan(500);
    }, GAME_TIMEOUT);
  }
});
