/**
 * Bot 強度與效能量測（不進 CI）：
 *
 *   pnpm --filter @catan/bots bench [局數] [設定名稱片段] [--profile <id>]
 *
 * 沒有 `--profile` 時跑 base（`base-2025` 與 `base-paired-2025`）的既有設定；`--profile` 指定任何
 * Bot 玩得動的 profile（例如擴充在 gating 翻轉之前）。每種座位組合輪流把 standard 放到不同座位，避免先手
 * 偏差；種子固定，結果可重現。對局用仿 BotDriver 模式與進度看門狗（`test/harness.ts`）。
 *
 * 輸出除了勝率與效能，還有：拒絕數、卡死與看門狗次數、保底次數（策略閒置、保底代為送出）、
 * 每個視窗的最大指令數、模組機制計數，以及和 rules 腳本模擬對照的回合數（沒有對照時為 n/a）。
 */

import { getProfile, requireProfile, type ProfileDefinition } from '@catan/rules';
import { botsCanPlay } from '../src/index.ts';
import { heuristicPolicy } from '../src/heuristic.ts';
import type { BotLevel } from '../src/types.ts';
import { baseProfileFor, botSeats, runBotGame } from '../test/harness.ts';
import { kitsOf, type ModuleTestKit } from '../test/modules/types.ts';

interface Config {
  name: string;
  profileId: string;
  players: number;
  /** 其中 standard 座位的數量，其餘為 easy。 */
  standard: number;
}

/** 既有的 base 設定：每項只決定人數與 standard 數，profile 由人數推得。 */
const BASE_CONFIGS: readonly { name: string; players: number; standard: number }[] = [
  { name: '3p 1 standard vs 2 easy', players: 3, standard: 1 },
  { name: '4p 1 standard vs 3 easy', players: 4, standard: 1 },
  { name: '4p 2 standard vs 2 easy', players: 4, standard: 2 },
  { name: '4p 4 standard', players: 4, standard: 4 },
  { name: '4p 4 easy', players: 4, standard: 0 },
  { name: '5p 1 standard vs 4 easy', players: 5, standard: 1 },
  { name: '6p 1 standard vs 5 easy', players: 6, standard: 1 },
];

/**
 * 模組測試工具（`test/modules/<id>.ts`）：有擴充的 profile 才有機制計數。擴充的測試切片把自己的 kit
 * 加在這裡；目前沒有任何模組。
 */
const BENCH_KITS: readonly ModuleTestKit[] = [];

/**
 * 與 rules 腳本模擬（確定性的腳本座位）對照的平均回合數：`profile id → 人數 → 回合數`。沒有腳本模擬的
 * profile（包括 base）不列，輸出標示 n/a；擴充的測試切片有實測時再加。
 */
const RULES_SIM_ROUNDS: Readonly<Record<string, Readonly<Record<number, number>>>> = {};

/** 沒有既有設定的 profile：每個人數跑 1 位 standard 對其餘 easy、全 standard、全 easy。 */
function templateConfigs(profile: ProfileDefinition): Config[] {
  return profile.playerCounts.flatMap((players) => [
    { name: `${players}p 1 standard vs ${players - 1} easy`, profileId: profile.id, players, standard: 1 },
    { name: `${players}p ${players} standard`, profileId: profile.id, players, standard: players },
    { name: `${players}p ${players} easy`, profileId: profile.id, players, standard: 0 },
  ]);
}

function configsFor(profile: ProfileDefinition): Config[] {
  if (profile.ruleModules.length > 0) return templateConfigs(profile);
  return BASE_CONFIGS.filter((config) => profile.playerCounts.includes(config.players)).map((config) => ({
    ...config,
    profileId: profile.id,
  }));
}

function parseArgs(argv: readonly string[]): { games: number; filter: string | undefined; profileId: string | undefined } {
  const positional: string[] = [];
  let profileId: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '--profile') profileId = argv[++index];
    else if (arg.startsWith('--profile=')) profileId = arg.slice('--profile='.length);
    else positional.push(arg);
  }
  const games = Number(positional[0] ?? 100);
  if (!Number.isInteger(games) || games < 1) throw new Error(`games must be a positive integer, got "${positional[0]}"`);
  if (profileId !== undefined && !profileId) throw new Error('--profile needs a profile id');
  return { games, filter: positional[1], profileId };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { games, filter, profileId: profileArg } = parseArgs(process.argv.slice(2));

const profiles: ProfileDefinition[] = profileArg
  ? [getProfile(profileArg) ?? fail(`unknown ruleset profile: ${profileArg}`)]
  : [requireProfile(baseProfileFor(3)), requireProfile(baseProfileFor(5))];
for (const profile of profiles) {
  if (!botsCanPlay(profile)) {
    fail(`bots cannot play ${profile.id}: a rules module of the profile has no registered Bot module`);
  }
}

function levelsFor(config: Config, game: number): BotLevel[] {
  return Array.from({ length: config.players }, (_, seat) =>
    (((seat - game) % config.players) + config.players) % config.players < config.standard ? 'standard' : 'easy',
  );
}

const rows: Record<string, string | number>[] = [];
const mechanicsRows: Record<string, string | number>[] = [];
for (const profile of profiles) {
  const kits = kitsOf(profile, BENCH_KITS);
  for (const config of configsFor(profile)) {
    if (filter && !config.name.includes(filter)) continue;
    let standardWins = 0;
    let finished = 0;
    let rounds = 0;
    let steps = 0;
    let decideCount = 0;
    let decideTotal = 0;
    let decideMax = 0;
    let problems = 0;
    let rejections = 0;
    let stuck = 0;
    let watchdog = 0;
    let fallbacks = 0;
    let maxWindowCommands = 0;
    let offers = 0;
    let settled = 0;
    const mechanics: Record<string, number> = {};
    const started = Date.now();
    for (let game = 0; game < games; game++) {
      const levels = levelsFor(config, game);
      const run = runBotGame({
        seats: botSeats(levels, (level) => heuristicPolicy(level)),
        seed: 10_000 + game,
        profileId: profile.id,
        kits,
        onDecision: (_state, decision) => {
          if (decision.command.type === 'trade.offer') offers += 1;
          if (decision.command.type === 'trade.settle') settled += 1;
        },
      });
      decideCount += run.decide.count;
      decideTotal += run.decide.totalMs;
      decideMax = Math.max(decideMax, run.decide.maxMs);
      rejections += run.rejections;
      stuck += run.stuck ? 1 : 0;
      watchdog += run.watchdog ? 1 : 0;
      fallbacks += run.idleFallbacks.length;
      maxWindowCommands = Math.max(maxWindowCommands, run.maxWindowCommands);
      for (const [key, count] of Object.entries(run.mechanics)) mechanics[key] = (mechanics[key] ?? 0) + count;
      if (
        run.failure ||
        run.stalled ||
        run.watchdog ||
        run.conservation.length > 0 ||
        run.state.result?.reason !== 'victory'
      ) {
        problems += 1;
        continue;
      }
      finished += 1;
      steps += run.steps;
      rounds += (run.state.stats?.turns ?? 0) / config.players;
      const winner = run.state.players.findIndex((player) => player.id === run.state.result!.playerId);
      if (levels[winner] === 'standard') standardWins += 1;
    }
    rows.push({
      profile: profile.id,
      config: config.name,
      games,
      'standard win %': config.standard > 0 ? +((standardWins / Math.max(1, finished)) * 100).toFixed(1) : '-',
      'fair share %': +((config.standard / config.players) * 100).toFixed(1),
      'avg rounds': +(rounds / Math.max(1, finished)).toFixed(1),
      'rules-sim rounds': RULES_SIM_ROUNDS[profile.id]?.[config.players] ?? 'n/a',
      'avg commands': Math.round(steps / Math.max(1, finished)),
      'max cmds/window': maxWindowCommands,
      'decide avg ms': +(decideTotal / Math.max(1, decideCount)).toFixed(3),
      'decide max ms': +decideMax.toFixed(2),
      'offers/game': +(offers / games).toFixed(1),
      'settled/game': +(settled / games).toFixed(1),
      rejections,
      stuck,
      watchdog,
      'fallback/game': +(fallbacks / games).toFixed(2),
      problems,
      seconds: +((Date.now() - started) / 1000).toFixed(1),
    });
    if (Object.keys(mechanics).length > 0) {
      mechanicsRows.push({
        config: `${profile.id} ${config.name}`,
        ...Object.fromEntries(Object.entries(mechanics).map(([key, count]) => [key, +(count / games).toFixed(2)])),
      });
    }
  }
}
console.table(rows);
if (mechanicsRows.length > 0) {
  console.log('module mechanics (average per game)');
  console.table(mechanicsRows);
} else {
  console.log('module mechanics: n/a (no module test kits for the profiles benchmarked)');
}
