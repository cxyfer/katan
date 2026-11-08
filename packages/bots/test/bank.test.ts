/**
 * 投影的銀行只到 `BANK_VIEW_CAP`（§8.3、#137）。Bot 一次送出的指令只需要 `view.bank > 0`；
 * 連續規劃好幾筆銀行交易時，把「至少上限」當成足夠，只有牌堆真的低於上限時才受限。
 */

import { describe, expect, it } from 'vitest';
import { BANK_VIEW_CAP, requireProfile, type GameState } from '@catan/rules';
import { plannedBank } from '../src/bank.ts';
import { heuristicPolicy, turnContext } from '../src/heuristic.ts';
import { bankTradeToward } from '../src/trade.ts';
import type { BotContext } from '../src/types.ts';
import { botSeats, cloneState, runBotGame, viewFor } from './harness.ts';

/** setup 剛結束、第一個行動階段的狀態。 */
function firstActionState(seed: number): GameState {
  let found: GameState | null = null;
  runBotGame({
    seats: botSeats(['standard', 'standard', 'standard', 'standard'], (level) => heuristicPolicy(level)),
    seed,
    onDecision: (state) => {
      if (!found && state.turn.phase === 'action' && !state.pending) found = cloneState(state);
    },
  });
  if (!found) throw new Error('no action state');
  return found;
}

describe('plannedBank', () => {
  it('keeps counts below the cap and reads the cap as the whole pile', () => {
    const full = requireProfile('base-2025').bankPerResource;
    const view = { profileId: 'base-2025', bank: { lumber: 0, brick: 1, wool: BANK_VIEW_CAP, grain: BANK_VIEW_CAP, ore: 0 } };
    expect(plannedBank(view)).toEqual({ lumber: 0, brick: 1, wool: full, grain: full, ore: 0 });
  });
});

describe('bankTradeToward with a capped bank', () => {
  function tradeForThreeOre(oreInBank: number) {
    const state = firstActionState(7);
    const me = state.players[state.turn.seat]!;
    me.resources = { lumber: 0, brick: 0, wool: 12, grain: 0, ore: 0 };
    state.bank.ore = oreInBank;
    const view = viewFor(state, me.id);
    const ctx: BotContext = { selfId: me.id, level: 'standard', seed: 1, offerPhases: {} };
    const economy = turnContext(view, ctx, 'standard').economy;
    return { view, command: bankTradeToward(view, economy, { ore: 3 }, {}) };
  }

  it('plans three trades for one resource although view.bank shows only the cap', () => {
    const { view, command } = tradeForThreeOre(19);
    expect(view.bank.ore).toBe(BANK_VIEW_CAP);
    expect(command).toEqual({ type: 'trade.bank', give: 'wool', receive: 'ore' });
  });

  it('does not start trades a pile below the cap cannot finish', () => {
    const { view, command } = tradeForThreeOre(1);
    expect(view.bank.ore).toBe(1);
    expect(command).toBeNull();
  });
});
