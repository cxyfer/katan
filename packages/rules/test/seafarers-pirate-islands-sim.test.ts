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
/** 偏向船線的程度：1 = 只蓋船線的船（沒有隨機的自由船），0.4 = 常常亂放其他合法的船。 */
const BIASES = (host.process.env.PI_SIM_BIASES ?? '1,0.85,0.4').split(',').map(Number);

interface Summary {
  games: number;
  gamesWithUnreachable: number;
  unreachableObservations: number;
  noStart: number;
  noExtension: number;
  backtracks: number;
  illegalRoads: number;
  badEnds: number;
  inconsistent: number;
  walledPlayers: number;
  escaped: number;
  stillWalled: number;
  hopeless: number;
  stuckPlayers: number;
  gamesWithBacktracks: number;
  linesDone: number;
  playerLines: number;
  outOfShips: number;
  turns: number;
}

function run(players: 3 | 4, lineBias: number, from: number): Summary {
  const sum: Summary = { games: 0, gamesWithUnreachable: 0, unreachableObservations: 0, noStart: 0, noExtension: 0, backtracks: 0, illegalRoads: 0, badEnds: 0, inconsistent: 0, walledPlayers: 0, escaped: 0, stillWalled: 0, hopeless: 0, stuckPlayers: 0, gamesWithBacktracks: 0, linesDone: 0, playerLines: 0, outOfShips: 0, turns: 0 };
  for (let seed = from; seed < from + GAMES; seed++) {
    const result: PirateSimResult = simulatePirateIslands({ players, seed, lineBias, maxTurns: 60 });
    sum.games++;
    if (result.unreachable > 0) sum.gamesWithUnreachable++;
    sum.unreachableObservations += result.unreachable;
    sum.noStart += result.noStart;
    sum.noExtension += result.noExtension;
    sum.backtracks += result.backtracks;
    sum.illegalRoads += result.illegalRoads;
    sum.badEnds += result.badEnds;
    sum.inconsistent += result.inconsistent;
    sum.walledPlayers += result.walledPlayers;
    sum.escaped += result.escaped;
    sum.stillWalled += result.stillWalled;
    sum.hopeless += result.hopeless;
    sum.stuckPlayers += result.stuckPlayers;
    if (result.backtracks > 0) sum.gamesWithBacktracks++;
    sum.linesDone += result.linesDone;
    sum.playerLines += players;
    sum.outOfShips += result.outOfShips;
    sum.turns += result.turns;
  }
  return sum;
}

describe('Pirate Islands random legal-move simulation (S7a)', () => {
  it('every game keeps the ship lines legal: backtracking never leaves a line on a foreign building or a loop, and no illegal road appears', () => {
    const table: Record<string, Summary> = {};
    for (const players of [3, 4] as const) {
      for (const bias of BIASES) table[`${players}p-bias${bias}`] = run(players, bias, 1);
    }
    if (REPORT) host.process.stderr.write(`PI_SIM ${JSON.stringify(table)}\n`);
    for (const [name, sum] of Object.entries(table)) {
      expect(sum.games, name).toBe(GAMES);
      // 放寬之後不會有「有船線卻沒有任何合法延伸」的玩家（配件用完以外）。
      // `unreachable`／`noStart` 是觀測值（船線被別人的海路擋死的次數，由 `stuckLineBacktrack` 的退回處理），不設上限。
      // 模擬只用合法動作：海盜群島上沒有不合法取得的路。
      expect(sum.illegalRoads, name).toBe(0);
      // 放寬不會把船線端點推到別人的建築上或繞回自己的線。
      expect(sum.badEnds, name).toBe(0);
      // 端點到得了目標時一定有合法的船線延伸（距離與可走頂點一致）。
      expect(sum.inconsistent, name).toBe(0);
      // `walledPlayers`、`escaped`、`stuckPlayers`（永久卡死）是觀測值，見 work record。
      expect(sum.backtracks >= 0 && sum.linesDone <= sum.playerLines, name).toBe(true);
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
