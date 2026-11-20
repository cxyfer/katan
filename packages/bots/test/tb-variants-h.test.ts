/**
 * 'tb-harbors-2025' 的 B-GAME（Q1）與 Q2（T&B 計畫 §6.1、§6.3；S3）。固定盤面與 B-FAIR 在 `tb-variants.test.ts`。
 *
 * - 對局：`tbMatrix`（3、4 人；`seedsFor` 的種子各一局，standard 與 easy 輪替；另加 bot2 只走保底的一局），每局
 *   `expectTbGameHealthy`（勝者、0 拒絕、守恆、合約、沒有「策略閒置、但保底有動作」）。
 * - Q2（只算 `seedsFor` 的 2S 局、只算策略座位的指令，與 Q1 共用同一批對局）：
 *   - 終局時 Strongest Ports 有持有者的局數 ≥ ⌈0.3S⌉（S=3 時 1、S=10 時 3）；
 * - 決定性：最短的一局同種子重跑，決策雜湊相同。
 */

import { describe, expect, it } from 'vitest';
import { requireProfile } from '@catan/rules';
import { GAME_TIMEOUT, seedsFor } from './harness.ts';
import { partStateOf } from './modules/tb/part.ts';
import { expectTbGameHealthy, runTbGame, tbMatrix, type TbGameRecord } from './tb-game.ts';

const PROFILE = 'tb-harbors-2025';
const S = seedsFor(requireProfile(PROFILE)).length;

describe(`${PROFILE} B-GAME and Q2`, () => {
  const records: TbGameRecord[] = [];
  for (const players of [3, 4]) {
    for (const spec of tbMatrix(PROFILE, players)) {
      it(
        spec.label,
        () => {
          const record = runTbGame(spec);
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
