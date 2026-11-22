/** 官方 5–6 人版圖（`official` 佈局）：混合難度的純 Bot 局能打完，沒有被拒絕或卡死的決策。 */

import { describe, expect, it } from 'vitest';
import { OFFICIAL_56_TOPOLOGY_ID } from '@katan/rules';
import { createBotPolicy } from '../src/index.ts';
import { botSeats, GAME_TIMEOUT, mixedLevels, runBotGame } from './harness.ts';

describe('official 5–6 board bots', () => {
  for (const players of [5, 6]) {
    it(`finishes a ${players}-player mixed-level game`, () => {
      const seats = botSeats(mixedLevels(players, 3), (level) => createBotPolicy(level));
      const run = runBotGame({ seats, seed: 21, profileId: 'base-paired-2025', setupMode: 'official' });
      expect(run.state.board.layout.topologyId).toBe(OFFICIAL_56_TOPOLOGY_ID);
      expect(run.failure, JSON.stringify(run.failure)).toBeNull();
      expect(run.stuck).toBeNull();
      expect(run.idleFallbacks).toEqual([]);
      expect(run.state.result?.reason).toBe('victory');
      expect(run.conservation).toEqual([]);
    }, GAME_TIMEOUT);
  }
});
