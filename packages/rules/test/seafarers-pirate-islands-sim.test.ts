/**
 * S7a 起的隨機合法動作模擬（S7b 起海盜真的沿航道走）（spec §6.6、OQ-3、§11.2 SFX-S7）：西島船線有沒有「完全無路可走」。
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
const FULL_BIASES = (host.process.env.PI_SIM_FULL_BIASES ?? '0.85').split(',').map(Number);
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
  ruleDeadlocks: number;
  wallRefusals: number;
  hintCalls: number;
  hintMs: number;
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
  rolls: number;
  attacks: number;
  steals: number;
  pirateBlockedTurns: number;
  lineTurns: number;
  /** S7c（完整對局）：有贏家的局數、戰船改裝、進攻的結果、收復、海盜移出的局數、守恆與船數違規的局數。 */
  won: number;
  converted: number;
  attacksWon: number;
  attacksLost: number;
  attacksTied: number;
  recaptures: number;
  pirateRemovedGames: number;
  notConserved: number;
  tooManyShips: number;
}

function run(players: 3 | 4, lineBias: number, from: number, full = false): Summary {
  const sum: Summary = { games: 0, gamesWithUnreachable: 0, unreachableObservations: 0, noStart: 0, noExtension: 0, backtracks: 0, illegalRoads: 0, badEnds: 0, inconsistent: 0, ruleDeadlocks: 0, wallRefusals: 0, hintCalls: 0, hintMs: 0, walledPlayers: 0, escaped: 0, stillWalled: 0, hopeless: 0, stuckPlayers: 0, gamesWithBacktracks: 0, linesDone: 0, playerLines: 0, outOfShips: 0, turns: 0, rolls: 0, attacks: 0, steals: 0, pirateBlockedTurns: 0, lineTurns: 0, won: 0, converted: 0, attacksWon: 0, attacksLost: 0, attacksTied: 0, recaptures: 0, pirateRemovedGames: 0, notConserved: 0, tooManyShips: 0 };
  for (let seed = from; seed < from + GAMES; seed++) {
    const result: PirateSimResult = simulatePirateIslands({ players, seed, lineBias, full, ...(full ? {} : { maxTurns: 60 }) });
    sum.games++;
    if (result.unreachable > 0) sum.gamesWithUnreachable++;
    sum.unreachableObservations += result.unreachable;
    sum.noStart += result.noStart;
    sum.noExtension += result.noExtension;
    sum.backtracks += result.backtracks;
    sum.illegalRoads += result.illegalRoads;
    sum.badEnds += result.badEnds;
    sum.inconsistent += result.inconsistent;
    sum.ruleDeadlocks += result.ruleDeadlocks;
    sum.wallRefusals += result.wallRefusals;
    sum.hintCalls += result.hintCalls;
    sum.hintMs += result.hintMs;
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
    sum.rolls += result.rolls;
    sum.attacks += result.attacks;
    sum.steals += result.steals;
    sum.pirateBlockedTurns += result.pirateBlockedTurns;
    sum.lineTurns += result.lineTurns;
    if (result.winner !== null) sum.won++;
    sum.converted += result.warshipsConverted;
    sum.attacksWon += result.attacksWon;
    sum.attacksLost += result.attacksLost;
    sum.attacksTied += result.attacksTied;
    sum.recaptures += result.recaptures;
    if (result.pirateRemoved) sum.pirateRemovedGames++;
    if (!result.conserved) sum.notConserved++;
    if (!result.shipsWithinSupply) sum.tooManyShips++;
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
      // `walledPlayers`、`stuckPlayers`、`ruleDeadlocks` 是觀測值（work record）：不得圍死的規則減少但不能消除卡死。
      // S7b：每次擲骰海盜都走一步，所以整場至少有擲骰；沒有戰船，被攻擊就是輸（沒有選牌 frame），所以不會有人拿到牌。
      expect(sum.rolls, name).toBeGreaterThan(0);
      expect(sum.backtracks >= 0 && sum.linesDone <= sum.playerLines, name).toBe(true);
    }
  }, 3_600_000);

  it('S7c: full games (knights to warships, attacks on the fortress, recapture, 10 points) end with a winner, a conserved supply and at most 15 ships each', () => {
    const table: Record<string, Summary> = {};
    for (const players of [3, 4] as const) {
      for (const bias of FULL_BIASES) table[`${players}p-bias${bias}`] = run(players, bias, 1, true);
    }
    if (REPORT) host.process.stderr.write(`PI_SIM_FULL ${JSON.stringify(table)}\n`);
    for (const [name, sum] of Object.entries(table)) {
      expect(sum.games, name).toBe(GAMES);
      // 每一局都跑到有贏家（回合上限內），贏家一定收復了自己的堡壘（`fortressRecaptured`）。
      expect(sum.won, name).toBe(GAMES);
      expect(sum.recaptures, name).toBeGreaterThanOrEqual(GAMES);
      expect(sum.converted, name).toBeGreaterThan(0);
      expect(sum.attacksWon + sum.attacksLost + sum.attacksTied, name).toBeGreaterThan(0);
      expect(sum.notConserved, name).toBe(0);
      expect(sum.tooManyShips, name).toBe(0);
      expect(sum.illegalRoads, name).toBe(0);
      expect(sum.badEnds, name).toBe(0);
      expect(sum.inconsistent, name).toBe(0);
    }
  }, 3_600_000);

  it('a game stopped early leaves every fortress state consistent with its events', () => {
    const result = simulatePirateIslands({ players: 4, seed: 3, maxTurns: 6 });
    for (const player of result.state.players) {
      expect(lineContext(result.state, player.id)).not.toBeNull();
      expect(scoreOf(result.state, player.id, { includeHidden: true })).toBeLessThan(10);
    }
  });
});
