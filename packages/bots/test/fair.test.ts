/**
 * B-FAIR：兩個只差在隱藏資訊（對手手牌組成、發展卡身分、牌庫順序）的狀態，投影
 * 相同，決策也必須相同；決策不得修改傳入的投影。
 */

import { describe, expect, it } from 'vitest';
import type { GameState, GameView } from '@catan/rules';
import { heuristicPolicy } from '../src/heuristic.ts';
import { botSeed } from '../src/seed.ts';
import type { BotLevel } from '../src/types.ts';
import { GAME_TIMEOUT, botSeats, cloneState, GENERIC_MATRIX, hideDifferently, runBotGame, viewFor } from './harness.ts';
import type { ModuleTestKit } from './modules/types.ts';


/** 通用矩陣的 profile 沒有模組；有模組的 profile 由自己的 family 測試檔傳入 kit。 */
const KITS: readonly ModuleTestKit[] = [];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function snapshots(profileId: string, players: number, seed: number, every: number): GameState[] {
  const levels: BotLevel[] = Array.from({ length: players }, (_, index) => (index % 2 === 0 ? 'standard' : 'easy'));
  const seats = botSeats(levels, (level) => heuristicPolicy(level));
  const out: GameState[] = [];
  let step = 0;
  runBotGame({
    seats,
    seed,
    profileId,
    onDecision: (state) => {
      if (step++ % every === 0) out.push(cloneState(state));
    },
  });
  return out;
}

// 4 人（沒有 4 人的 profile 由自己的 family 測試檔涵蓋）。
for (const { profile, players } of GENERIC_MATRIX.filter((entry) => entry.players === 4)) {
  describe(`B-FAIR hidden information (${profile.id}, ${players} players)`, () => {
    const states = [...snapshots(profile.id, players, 51, 9), ...snapshots(profile.id, players, 52, 13)];

    it('collects enough mid-game states with hidden variety', () => {
      expect(states.length).toBeGreaterThan(40);
    });

    for (const level of ['standard', 'easy'] as BotLevel[]) {
      it(`decides identically when only hidden information differs (${level})`, () => {
        const policy = heuristicPolicy(level);
        let compared = 0;
        for (const state of states) {
          for (const player of state.players) {
            const { variant, changed } = hideDifferently(state, player.id, KITS);
            if (!changed) continue;
            const original = viewFor(state, player.id);
            const altered = viewFor(variant, player.id);
            expect(JSON.stringify(altered)).toBe(JSON.stringify(original));
            const ctx = { selfId: player.id, level, seed: botSeed('fair', player.id, state.seq), offerPhases: {} };
            expect(policy.decide(altered, ctx)).toEqual(policy.decide(original, ctx));
            compared += 1;
          }
        }
        expect(compared).toBeGreaterThan(100);
      }, GAME_TIMEOUT);
    }

    it('never mutates the projection it is given', () => {
      const policy = heuristicPolicy('standard');
      for (const state of states.slice(0, 30)) {
        for (const player of state.players) {
          const view: GameView = deepFreeze(viewFor(state, player.id));
          const ctx = deepFreeze({ selfId: player.id, level: 'standard' as const, seed: 7, offerPhases: {} });
          expect(() => policy.decide(view, ctx)).not.toThrow();
        }
      }
    }, GAME_TIMEOUT);
  });
}
