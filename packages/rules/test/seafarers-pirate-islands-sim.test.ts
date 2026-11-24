/**
 * S7a 的隨機合法動作模擬（spec §6.6、OQ-3、§11.2 SFX-S7）：西島船線有沒有「完全無路可走」。
 * 預設只跑少量局；大量模擬用環境變數：`PI_SIM_GAMES=1500 PI_SIM_REPORT=1`（記錄在 work record）。
 */

import { describe, expect, it } from 'vitest';
import { scoreOf } from '../src/analysis.ts';
import { lineContext } from '../src/modules/seafarers/pirateIslands.ts';
import { simulatePirateIslands, type PirateSimResult } from './seafarers-pirate-islands-sim.ts';

// 測試環境沒有 node 型別：以 globalThis 取環境變數與 stderr（結果以 JSON 印在 stderr，記錄在 work record）。
const host = globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(text: string): void } } };
const GAMES = Number(host.process.env.PI_SIM_GAMES ?? 12);
const REPORT = host.process.env.PI_SIM_REPORT === '1';

interface Summary {
  games: number;
  gamesWithUnreachable: number;
  unreachableObservations: number;
  noStart: number;
  noExtension: number;
  relaxedShips: number;
  gamesWithRelaxedShips: number;
  linesDone: number;
  playerLines: number;
  outOfShips: number;
  turns: number;
}

function run(players: 3 | 4, lineBias: number, from: number): Summary {
  const sum: Summary = { games: 0, gamesWithUnreachable: 0, unreachableObservations: 0, noStart: 0, noExtension: 0, relaxedShips: 0, gamesWithRelaxedShips: 0, linesDone: 0, playerLines: 0, outOfShips: 0, turns: 0 };
  for (let seed = from; seed < from + GAMES; seed++) {
    const result: PirateSimResult = simulatePirateIslands({ players, seed, lineBias, maxTurns: 60 });
    sum.games++;
    if (result.unreachable > 0) sum.gamesWithUnreachable++;
    sum.unreachableObservations += result.unreachable;
    sum.noStart += result.noStart;
    sum.noExtension += result.noExtension;
    sum.relaxedShips += result.relaxedShips;
    if (result.relaxedShips > 0) sum.gamesWithRelaxedShips++;
    sum.linesDone += result.linesDone;
    sum.playerLines += players;
    sum.outOfShips += result.outOfShips;
    sum.turns += result.turns;
  }
  return sum;
}

describe('Pirate Islands random legal-move simulation (S7a)', () => {
  it('every game keeps the ship lines legal; no line is ever left with no legal extension', () => {
    const table: Record<string, Summary> = {};
    for (const players of [3, 4] as const) {
      for (const bias of [0.85, 0.4]) table[`${players}p-bias${bias}`] = run(players, bias, 1);
    }
    if (REPORT) host.process.stderr.write(`PI_SIM ${JSON.stringify(table)}\n`);
    for (const [name, sum] of Object.entries(table)) {
      expect(sum.games, name).toBe(GAMES);
      // 放寬之後不會有「有船線卻沒有任何合法延伸」的玩家（配件用完以外）。
      expect(sum.noExtension, name).toBe(0);
      expect(sum.noStart, name).toBe(0);
    }
  }, 3_600_000);

  it('a finished game leaves every fortress unrecaptured and scores unaffected by it', () => {
    const result = simulatePirateIslands({ players: 4, seed: 3, maxTurns: 30 });
    for (const player of result.state.players) {
      expect(lineContext(result.state, player.id)).not.toBeNull();
      expect(scoreOf(result.state, player.id, { includeHidden: true })).toBeLessThan(10);
    }
  });
});
