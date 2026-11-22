/**
 * H-I3（docs/aegis/specs/2026-11-07-hard-bot.md）的實際範圍（v2 spec E18）：standard／easy 的決策不因「完整的事件歷史」
 * 而改變，但 `bankTradesThisTurn` 會讀 `view.events` 裡**這個回合**（自最近一次 `turn.started` 起）自己的 `trade.bank`。
 * 所以不變量是：把 `view.events` 截成「自最近一次 `turn.started` 起」，standard／easy 的決策與完整歷史完全相同；
 * 反過來，同回合有沒有 `trade.bank` 事件則會影響（`plan-bank-trade.test.ts`、`hand-relief.test.ts`）。
 *
 * golden 測試的 driver 傳空 events，覆蓋不到這點，所以在這裡用整局對局補上。
 */

import { describe, expect, it } from 'vitest';
import type { GameView } from '@katan/rules';
import { heuristicPolicy } from '../src/heuristic.ts';
import type { BotLevel, BotPolicy } from '../src/types.ts';
import { baseProfileFor, runBotGame } from './harness.ts';

/** 自最近一次 `turn.started` 起的事件（含它）；歷史裡還沒有 `turn.started`（開局）時原樣保留。 */
function currentTurnEvents(events: GameView['events']): GameView['events'] {
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]!.type === 'turn.started') return events.slice(index);
  }
  return events;
}

const SEEDS = 12;

function twinChecked(level: 'standard' | 'easy', mismatches: string[]): BotPolicy {
  const policy = heuristicPolicy(level);
  return {
    decide(view, ctx) {
      const full = policy.decide(view, ctx);
      const truncated = policy.decide({ ...view, events: currentTurnEvents(view.events) }, ctx);
      if (JSON.stringify(full) !== JSON.stringify(truncated)) {
        mismatches.push(`seq ${view.seq}: ${JSON.stringify(full)} vs ${JSON.stringify(truncated)}`);
      }
      return full;
    },
  };
}

describe('standard and easy do not read history before the current turn', () => {
  for (const players of [3, 4, 5]) {
    it(`${players} players: truncating events to the current turn changes no decision`, () => {
      const mismatches: string[] = [];
      const seats = Array.from({ length: players }, (_, index) => {
        const level: BotLevel = index % 2 === 0 ? 'standard' : 'easy';
        return { id: `bot${index + 1}`, level, policy: twinChecked(level as 'standard' | 'easy', mismatches) };
      });
      for (let seed = 0; seed < SEEDS; seed++) {
        const run = runBotGame({ seats, seed: 10_000 + seed, profileId: baseProfileFor(players) });
        expect(run.state.result?.reason).toBe('victory');
      }
      expect(mismatches).toEqual([]);
    }, 180_000);
  }
});
