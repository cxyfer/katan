/**
 * 'tb-friendly-robber-harbors-2025' 的 B-GAME（Q1）與 Q2（T&B 計畫 §6.1、§6.3；S3）。固定盤面與 B-FAIR 在 `tb-variants.test.ts`。
 *
 * - 對局：`tbMatrix`（3、4 人；`seedsFor` 的種子各一局，standard 與 easy 輪替；另加 bot2 只走保底的一局），每局
 *   `expectTbGameHealthy`（勝者、0 拒絕、守恆、合約、沒有「策略閒置、但保底有動作」）。
 * - Q2（只算 `seedsFor` 的 2S 局、只算策略座位的指令，與 Q1 共用同一批對局）：
 *   - 強盜落點 100% 在 hints 的 `robberHexes` 內（含騎士卡；保底座位也檢查）；
 *   - `pending.moveRobber` ≥ 3S（S=3 時 9、S=10 時 30）；
 *   - 終局時 Strongest Ports 有持有者的局數 ≥ ⌈0.3S⌉（S=3 時 1、S=10 時 3）；
 * - 決定性：最短的一局同種子重跑，決策雜湊相同。
 */

import { describe, expect, it } from 'vitest';
import { requireProfile, type GameState } from '@catan/rules';
import { tbRobberHexes } from '../src/modules/tradersBarbarians/view.ts';
import { GAME_TIMEOUT, seedsFor, viewFor, type Decision } from './harness.ts';
import { partStateOf } from './modules/tb/part.ts';
import { commandCount, expectTbGameHealthy, runTbGame, tbMatrix, type TbGameRecord } from './tb-game.ts';

const PROFILE = 'tb-friendly-robber-harbors-2025';
const S = seedsFor(requireProfile(PROFILE)).length;

/** 強盜落點：每個 `pending.moveRobber` 與 `dev.playKnight` 都在決策當下的 `robberHexes` 內，騎士卡不留在現位格。 */
interface RobberCheck {
  moves: number;
  outside: string[];
}

function checkRobber(check: RobberCheck, state: GameState, decision: Decision): void {
  const { actor, command } = decision;
  if (command.type !== 'pending.moveRobber' && command.type !== 'dev.playKnight') return;
  const hex = (command as { hex?: number }).hex!;
  const hexes = tbRobberHexes(viewFor(state, actor).hints) ?? [];
  if (decision.source !== 'fallback') check.moves += 1;
  if (!hexes.includes(hex)) check.outside.push(`seq ${state.seq} ${actor} ${command.type} ${hex} not in [${hexes.join(',')}]`);
  if (command.type === 'dev.playKnight' && hex === state.board.robber) check.outside.push(`seq ${state.seq} ${actor} knight stays on ${hex}`);
}

describe(`${PROFILE} B-GAME and Q2`, () => {
  const records: TbGameRecord[] = [];
  const robber: RobberCheck = { moves: 0, outside: [] };
  for (const players of [3, 4]) {
    for (const spec of tbMatrix(PROFILE, players)) {
      it(
        spec.label,
        () => {
          const record = runTbGame(spec, { onDecision: (state, decision) => checkRobber(robber, state, decision) });
          expectTbGameHealthy(record);
          records.push(record);
        },
        GAME_TIMEOUT,
      );
    }
  }

  it('Q2 thresholds over the seedsFor games', () => {
    const seeded = records.filter((record) => record.spec.fallbackSeat === undefined);
    expect(seeded).toHaveLength(2 * S);
    expect(robber.outside).toEqual([]);
    expect(robber.moves).toBeGreaterThan(0);
    const moves = seeded.reduce(
      (sum, record) => sum + commandCount(record, 'pending.moveRobber', 'standard') + commandCount(record, 'pending.moveRobber', 'easy'),
      0,
    );
    expect(moves, 'pending.moveRobber').toBeGreaterThanOrEqual(3 * S);
    const held = seeded.filter((record) => (partStateOf<{ holder: string | null }>(record.state, 'harbors')?.holder ?? null) !== null);
    expect(held.length, 'games ending with a Strongest Ports holder').toBeGreaterThanOrEqual(Math.ceil(0.3 * S));
  });

  it(
    'reruns the shortest game with the same decision hash',
    () => {
      const shortest = records.slice().sort((a, b) => a.steps - b.steps)[0]!;
      expect(runTbGame(shortest.spec).hash).toBe(shortest.hash);
    },
    GAME_TIMEOUT,
  );
});
