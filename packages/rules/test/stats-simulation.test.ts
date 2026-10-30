/** 整局模擬：統計的資源流向必須與終局手牌、牌堆及骰子次數完全一致。 */

import { describe, expect, it } from 'vitest';
import { scoreOf } from '../src/analysis.ts';
import { requireProfile } from '../src/profiles.ts';
import { RESOURCES } from '../src/types.ts';
import { simulateGame } from './simulate.ts';

describe('statistics over a whole simulated game', () => {
  it.each([11, 29, 47])('balances every resource flow against the final hand (seed %i)', (seed) => {
    const state = simulateGame(seed);
    expect(state.result?.reason).toBe('victory');
    const stats = state.stats!;
    expect(stats.complete).toBe(true);

    for (const player of state.players) {
      const s = stats.players[player.id]!;
      for (const resource of RESOURCES) {
        const income =
          s.produced[resource] +
          s.startingResources[resource] +
          s.yearOfPlenty[resource] +
          s.monopolyGained[resource] +
          s.stolen[resource] +
          s.bankReceived[resource] +
          s.tradeReceived[resource];
        const expense =
          s.spent[resource] +
          s.discarded[resource] +
          s.robbed[resource] +
          s.monopolyLost[resource] +
          s.bankGiven[resource] +
          s.tradeGiven[resource];
        expect(income - expense, `${player.id} ${resource}`).toBe(player.resources[resource]);
      }
      expect(s.devCardsPlayed.knight).toBe(player.playedKnights);
      expect(s.peakHand).toBeGreaterThanOrEqual(Object.values(player.resources).reduce((a, b) => a + b, 0));
    }

    const drawn = Object.values(stats.players).reduce(
      (sum, s) => sum + Object.values(s.devCardsBought).reduce((a, b) => a + b, 0),
      0,
    );
    expect(drawn).toBe(requireProfile(state.profileId).devDeck.length - state.devDeck.length);

    const rolls = Object.values(stats.players).reduce((sum, s) => sum + s.rolls, 0);
    expect(stats.dice.reduce((a, b) => a + b, 0)).toBe(rolls);
    const sevens = Object.values(stats.players).reduce((sum, s) => sum + s.sevens, 0);
    expect(stats.dice[7]).toBe(sevens);

    // 最後一筆分數取樣即終局分數（含隱藏分）。
    const final = stats.timeline.at(-1)!;
    state.players.forEach((player, index) => {
      expect(final[index]).toBe(scoreOf(state, player.id, { includeHidden: true }));
    });
  });
});
