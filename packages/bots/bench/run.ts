/**
 * Bot 強度與效能量測（不進 CI）：
 *
 *   pnpm --filter @catan/bots bench [局數] [設定名稱片段] [--profile <id>] [--markdown <檔案>]
 *
 * 沒有 `--profile` 時跑 base（`base-2025` 與 `base-paired-2025`）；`--profile` 指定任何 Bot 玩得動的
 * profile（例如擴充在 gating 翻轉之前）。每個人數跑四種對局（Seafarers 計畫 §6.3）：
 * ① 1 位 standard 對其餘 easy；② 1 位 standard 對其餘 naive；③ 全 standard；④ 全 easy。
 * standard 依局數輪換座位，避免先手偏差；種子從 10000 起，結果可重現。對局用仿 BotDriver 模式與
 * 進度看門狗（`test/harness.ts`）。
 *
 * naive 座位只保留模組的 `duty`（`naivePolicy`），等於 v0.4.0 的行為；沒有 Bot 模組的 profile（base）
 * 沒有東西可保留，naive 與 standard 完全相同，② 照跑只是為了表格形狀一致。
 *
 * 輸出除了勝率與效能，還有：拒絕數、卡死與看門狗次數、保底次數（策略閒置、保底代為送出）、
 * 每個視窗的最大指令數、模組機制計數，以及和 rules 腳本模擬對照的回合數（沒有對照時為 n/a）。
 * `--markdown` 把同一份表寫成 markdown 檔。
 */

import { writeFileSync } from 'node:fs';
import { getProfile, requireProfile, type ProfileDefinition } from '@catan/rules';
import { botModulesOf, botsCanPlay } from '../src/index.ts';
import { heuristicPolicy } from '../src/heuristic.ts';
import type { BotPolicy } from '../src/types.ts';
import { baseProfileFor, naivePolicy, runBotGame, type BotSeat } from '../test/harness.ts';
import { seafarersKit } from '../test/modules/seafarers.ts';
import { kitsOf, type ModuleTestKit } from '../test/modules/types.ts';
import { BENCH_USAGE, BenchArgError, parseBenchArgs } from './args.ts';

type Role = 'standard' | 'easy' | 'naive';

interface Config {
  name: string;
  profileId: string;
  players: number;
  /** 其中 standard 座位的數量，其餘為 `rest`。 */
  standard: number;
  rest: 'easy' | 'naive';
}

/**
 * 模組測試工具（`test/modules/<id>.ts`）：有擴充的 profile 才有機制計數。擴充的測試切片把自己的 kit
 * 加在這裡。
 */
const BENCH_KITS: readonly ModuleTestKit[] = [seafarersKit];

/**
 * 與 rules 腳本模擬（確定性的腳本座位）對照的平均回合數：`profile id → 人數 → 回合數`。沒有腳本模擬的
 * profile（包括 base）不列，輸出標示 n/a；擴充的測試切片有實測時再加。
 */
const RULES_SIM_ROUNDS: Readonly<Record<string, Readonly<Record<number, number>>>> = {};

/** 每個人數的四種對局。 */
function configsFor(profile: ProfileDefinition): Config[] {
  return profile.playerCounts.flatMap((players): Config[] => {
    const base = { profileId: profile.id, players };
    return [
      { ...base, name: `${players}p 1 standard vs ${players - 1} easy`, standard: 1, rest: 'easy' },
      { ...base, name: `${players}p 1 standard vs ${players - 1} naive`, standard: 1, rest: 'naive' },
      { ...base, name: `${players}p ${players} standard`, standard: players, rest: 'easy' },
      { ...base, name: `${players}p ${players} easy`, standard: 0, rest: 'easy' },
    ];
  });
}

function fail(message: string, usage = false): never {
  console.error(`error: ${message}`);
  if (usage) console.error(BENCH_USAGE);
  process.exit(1);
}

let args;
try {
  args = parseBenchArgs(process.argv.slice(2));
} catch (error) {
  if (error instanceof BenchArgError) fail(error.message, true);
  throw error;
}
const { games, filter, profileId: profileArg, markdown } = args;

const profiles: ProfileDefinition[] = profileArg
  ? [getProfile(profileArg) ?? fail(`unknown ruleset profile: ${profileArg}`)]
  : [requireProfile(baseProfileFor(3)), requireProfile(baseProfileFor(5))];
for (const profile of profiles) {
  if (!botsCanPlay(profile)) {
    fail(`bots cannot play ${profile.id}: a rules module of the profile has no registered Bot module`);
  }
}

function rolesFor(config: Config, game: number): Role[] {
  return Array.from({ length: config.players }, (_, seat) =>
    (((seat - game) % config.players) + config.players) % config.players < config.standard ? 'standard' : config.rest,
  );
}

function seatsFor(roles: readonly Role[], profile: ProfileDefinition): BotSeat[] {
  const modules = botModulesOf(profile);
  return roles.map((role, index) => {
    const policy: BotPolicy =
      role === 'naive' ? naivePolicy('standard', modules) : heuristicPolicy(role === 'easy' ? 'easy' : 'standard');
    return { id: `bot${index + 1}`, level: role === 'easy' ? 'easy' : 'standard', policy };
  });
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
      const roles = rolesFor(config, game);
      const run = runBotGame({
        seats: seatsFor(roles, profile),
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
      if (roles[winner] === 'standard') standardWins += 1;
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
const notes = [
  'standard rotates through the seats game by game; seeds run from 10000.',
  "naive seats keep only each module's duty (the v0.4.0 behaviour). A profile without bot modules (base) has " +
    'nothing to strip, so there a naive seat plays exactly like standard.',
  "'fallback/game' counts commands the BotDriver-like harness took from the fallback because the policy idled. " +
    'Every seat should be 0, naive included (the skeleton falls back to the module duty itself); a non-zero count is a defect.',
  "'max cmds/window' is the most commands one seat sent in one action window (the server forces the fallback after 40).",
];

function renderMarkdown(): string {
  const table = (data: readonly Record<string, string | number>[]): string[] => {
    const columns = [...new Set(data.flatMap((row) => Object.keys(row)))];
    return [
      `| ${columns.join(' | ')} |`,
      `| ${columns.map(() => '---').join(' | ')} |`,
      ...data.map((row) => `| ${columns.map((column) => String(row[column] ?? '')).join(' | ')} |`),
    ];
  };
  return [
    '# Bot bench',
    '',
    `\`pnpm --filter @catan/bots bench ${process.argv.slice(2).join(' ')}\` — ${games} games per config.`,
    '',
    ...table(rows),
    '',
    ...(mechanicsRows.length > 0
      ? ['Module mechanics (average per game):', '', ...table(mechanicsRows), '']
      : ['Module mechanics: n/a (no module test kits for the profiles benchmarked).', '']),
    ...notes.map((note) => `- ${note}`),
    '',
  ].join('\n');
}

console.table(rows);
if (mechanicsRows.length > 0) {
  console.log('module mechanics (average per game)');
  console.table(mechanicsRows);
} else {
  console.log('module mechanics: n/a (no module test kits for the profiles benchmarked)');
}
for (const note of notes) console.log(`note: ${note}`);
if (markdown) {
  writeFileSync(markdown, renderMarkdown());
  console.log(`markdown written to ${markdown}`);
}
