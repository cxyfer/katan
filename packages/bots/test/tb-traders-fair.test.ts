/**
 * B-FAIR：Traders & Barbarians 劇本的隱藏資訊（T&B 計畫 §6.1；S7）。
 *
 * 兩個只差在隱藏資訊的狀態，投影相同，決策也必須相同；決策不得修改傳入的投影。隱藏資訊由 harness 的 `hideDifferently`
 * （對手的資源組成、對手的發展卡與牌庫交換身分、牌庫倒序）加上 T&B kit（各貨物堆的內容與順序、對手本回合新買的發展卡）擾動。
 *
 * - 3 人、4 人，種子 61、62，standard 與 easy；
 * - 取樣必須包含：`tbWagon` frame、`tbBarbarian` frame、持有可打的蠻族騎士卡的 preroll；每個 level 至少 100 次比較。
 */

import { describe, expect, it } from 'vitest';
import { actionHints, TB_FRAME_KINDS, TRADERS_BARBARIANS, type GameState, type GameView } from '@katan/rules';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import { botSeats, cloneState, GAME_TIMEOUT, hideDifferently, mixedLevels, runBotGame, viewFor } from './harness.ts';
import { tradersBarbariansKit } from './modules/tradersBarbarians.ts';

const PROFILE = 'tb-traders-barbarians-2025';
const KITS = [tradersBarbariansKit];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function snapshots(players: number, seed: number, every: number): GameState[] {
  const seats = botSeats(mixedLevels(players, seed), (level) => createBotPolicy(level));
  const out: GameState[] = [];
  let step = 0;
  runBotGame({
    seats,
    seed,
    profileId: PROFILE,
    kits: KITS,
    onDecision: (state) => {
      // frame 與「preroll 有騎士卡可打」的狀態全部收進來（數量少），其他每 `every` 步取一次。
      const frame = state.pending?.kind === TB_FRAME_KINDS.tbWagon || state.pending?.kind === TB_FRAME_KINDS.tbBarbarian;
      if ((frame || step % every === 0 || knightPreroll(state)) && !state.result) out.push(cloneState(state));
      step += 1;
    },
  });
  return out;
}

/** 行動者在 preroll、手上有可以打的蠻族騎士卡。 */
function knightPreroll(state: GameState): boolean {
  if (state.turn.phase !== 'preroll' || state.pending) return false;
  const actor = state.players[state.turn.seat]!.id;
  const hints = actionHints(state, actor).modules?.[TRADERS_BARBARIANS] as Record<string, { canPlayKnight?: boolean }> | undefined;
  return hints?.['tb-traders-barbarians']?.canPlayKnight === true;
}

for (const players of [3, 4]) {
  describe(`B-FAIR hidden information (${PROFILE}, ${players} players)`, () => {
    const states = [...snapshots(players, 61, 9), ...snapshots(players, 62, 13)];

    it('collects wagon moves, barbarian moves and a knight in hand before the roll', () => {
      expect(states.filter((state) => state.pending?.kind === TB_FRAME_KINDS.tbWagon).length).toBeGreaterThan(10);
      expect(states.some((state) => state.pending?.kind === TB_FRAME_KINDS.tbBarbarian), 'a tbBarbarian frame').toBe(true);
      expect(states.some(knightPreroll), 'a preroll with a playable Barbarian Knight').toBe(true);
    });

    for (const level of ['standard', 'easy'] as const) {
      it(
        `decides identically when only hidden information differs (${level})`,
        () => {
          const policy = createBotPolicy(level);
          let compared = 0;
          for (const state of states) {
            for (const player of state.players) {
              const { variant, changed } = hideDifferently(state, player.id, KITS);
              if (!changed) continue;
              const original = viewFor(state, player.id);
              const altered = viewFor(variant, player.id);
              expect(JSON.stringify(altered), `seq ${state.seq} ${player.id}: projection changed`).toBe(JSON.stringify(original));
              const ctx = { selfId: player.id, level, seed: botSeed('fair', player.id, state.seq), offerPhases: {} };
              expect(policy.decide(altered, ctx), `seq ${state.seq} ${player.id} ${state.pending?.kind ?? state.turn.phase}`).toEqual(
                policy.decide(original, ctx),
              );
              compared += 1;
            }
          }
          expect(compared).toBeGreaterThanOrEqual(100);
        },
        GAME_TIMEOUT,
      );
    }

    it(
      'never mutates the projection it is given',
      () => {
        for (const level of ['standard', 'easy'] as const) {
          const policy = createBotPolicy(level);
          for (const state of states.slice(0, 40)) {
            for (const player of state.players) {
              const view: GameView = deepFreeze(viewFor(state, player.id));
              const ctx = deepFreeze({ selfId: player.id, level, seed: 7, offerPhases: {} });
              expect(() => policy.decide(view, ctx)).not.toThrow();
            }
          }
        }
      },
      GAME_TIMEOUT,
    );
  });
}
