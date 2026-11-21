/**
 * B-FAIR：Land Ho! 的隱藏資訊與公平性（E&P 計畫 §6.1）。
 *
 * 兩個只差在隱藏資訊的狀態，投影相同，決策也必須相同：
 * - 對手的資源組成互換、發展卡與牌庫順序（harness `hideDifferently`）；
 * - 霧區的圓片順序（E&P kit：`pools.discs`、`abilities`、`lairTokens`；view 不投影它們）；
 * - view 有沒有附事件歷史（策略只讀公開狀態，不讀事件）。
 * 決策不得修改傳入的投影；同一局重播，決策序列逐一相同。
 * 取樣涵蓋 Action 與 Movement 兩個子階段，standard 與 easy 各至少 100 次比較。
 */

import { describe, expect, it } from 'vitest';
import type { GameState, GameView } from '@katan/rules';
import { epHints } from '../src/modules/explorersPirates/view.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import { bankTradesThisTurn } from '../src/trade.ts';
import type { BotLevel } from '../src/types.ts';
import { botSeats, cloneState, GAME_TIMEOUT, hideDifferently, mixedLevels, runBotGame, viewFor } from './harness.ts';
import { explorersPiratesKit } from './modules/explorersPirates.ts';

const PROFILE = 'ep-land-ho-2025';
const KITS = [explorersPiratesKit];

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
      if (step++ % every === 0 && !state.result) out.push(cloneState(state));
    },
  });
  return out;
}

const ctxOf = (id: string, level: BotLevel, state: GameState) => ({ selfId: id, level, seed: botSeed('fair', id, state.seq), offerPhases: {} });

for (const players of [3, 4]) {
  describe(`B-FAIR hidden information (${PROFILE}, ${players} players)`, () => {
    const states = [...snapshots(players, 61, 3), ...snapshots(players, 62, 4)];

    it('samples both the Action and the Movement sub-phases', () => {
      const phases = new Set(states.flatMap((state) => state.players.map((player) => epHints(viewFor(state, player.id).hints)?.phase)));
      expect(phases.has('action')).toBe(true);
      expect(phases.has('movement')).toBe(true);
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
              expect(JSON.stringify(altered)).toBe(JSON.stringify(original));
              const ctx = ctxOf(player.id, level, state);
              expect(policy.decide(altered, ctx)).toEqual(policy.decide(original, ctx));
              compared += 1;
            }
          }
          expect(compared).toBeGreaterThan(100);
        },
        GAME_TIMEOUT,
      );

      it(
        `decides identically with and without the event history (${level})`,
        () => {
          const policy = createBotPolicy(level);
          let compared = 0;
          for (const state of states) {
            for (const player of state.players) {
              const withEvents = viewFor(state, player.id);
              // 同回合的銀行交易（base 的來回換守門）本來就讀事件；E&P 自己的決策不讀。
              const bank = bankTradesThisTurn(withEvents, player.id);
              if (bank.received.size > 0 || bank.gave.size > 0) continue;
              const bare: GameView = { ...withEvents, events: [] };
              const ctx = ctxOf(player.id, level, state);
              expect(policy.decide(bare, ctx)).toEqual(policy.decide(withEvents, ctx));
              compared += 1;
            }
          }
          expect(compared).toBeGreaterThan(100);
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
              const view = deepFreeze(viewFor(state, player.id));
              const ctx = deepFreeze(ctxOf(player.id, level, state));
              expect(() => policy.decide(view, ctx)).not.toThrow();
            }
          }
        }
      },
      GAME_TIMEOUT,
    );
  });
}

describe(`B-POLICY determinism (${PROFILE})`, () => {
  it(
    'replays a game identically',
    () => {
      const record = (): string[] => {
        const out: string[] = [];
        runBotGame({
          seats: botSeats(mixedLevels(4, 3), (level) => createBotPolicy(level)),
          seed: 3,
          profileId: PROFILE,
          kits: KITS,
          onDecision: (_, decision) => out.push(`${decision.actor}:${JSON.stringify(decision.command)}`),
        });
        return out;
      };
      const first = record();
      expect(first.length).toBeGreaterThan(0);
      expect(record()).toEqual(first);
    },
    GAME_TIMEOUT,
  );
});
