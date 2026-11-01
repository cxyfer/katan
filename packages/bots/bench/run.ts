/**
 * Bot 強度與效能量測（不進 CI）：`pnpm --filter @catan/bots bench [局數] [設定名稱片段]`。
 *
 * 每種座位組合輪流把 standard 放到不同座位，避免先手偏差；種子固定，結果可重現。
 */

import { heuristicPolicy } from '../src/heuristic.ts';
import type { BotLevel } from '../src/types.ts';
import { botSeats, runBotGame } from '../test/harness.ts';

interface Config {
  name: string;
  players: number;
  standard: number;
}

const CONFIGS: Config[] = [
  { name: '3p 1 standard vs 2 easy', players: 3, standard: 1 },
  { name: '4p 1 standard vs 3 easy', players: 4, standard: 1 },
  { name: '4p 2 standard vs 2 easy', players: 4, standard: 2 },
  { name: '4p 4 standard', players: 4, standard: 4 },
  { name: '4p 4 easy', players: 4, standard: 0 },
  { name: '5p 1 standard vs 4 easy', players: 5, standard: 1 },
  { name: '6p 1 standard vs 5 easy', players: 6, standard: 1 },
];

const games = Number(process.argv[2] ?? 100);
const filter = process.argv[3];

function levelsFor(config: Config, game: number): BotLevel[] {
  return Array.from({ length: config.players }, (_, seat) =>
    (((seat - game) % config.players) + config.players) % config.players < config.standard ? 'standard' : 'easy',
  );
}

const rows: Record<string, string | number>[] = [];
for (const config of CONFIGS) {
  if (filter && !config.name.includes(filter)) continue;
  let standardWins = 0;
  let finished = 0;
  let rounds = 0;
  let steps = 0;
  let decideCount = 0;
  let decideTotal = 0;
  let decideMax = 0;
  let problems = 0;
  let offers = 0;
  let settled = 0;
  const started = Date.now();
  for (let game = 0; game < games; game++) {
    const levels = levelsFor(config, game);
    const run = runBotGame({
      seats: botSeats(levels, (level) => heuristicPolicy(level)),
      seed: 10_000 + game,
      onDecision: (_state, decision) => {
        if (decision.command.type === 'trade.offer') offers += 1;
        if (decision.command.type === 'trade.settle') settled += 1;
      },
    });
    decideCount += run.decide.count;
    decideTotal += run.decide.totalMs;
    decideMax = Math.max(decideMax, run.decide.maxMs);
    if (run.failure || run.stalled || run.state.result?.reason !== 'victory') {
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
    config: config.name,
    games,
    'standard win %': config.standard > 0 ? +((standardWins / Math.max(1, finished)) * 100).toFixed(1) : '-',
    'fair share %': +((config.standard / config.players) * 100).toFixed(1),
    'avg rounds': +(rounds / Math.max(1, finished)).toFixed(1),
    'avg commands': Math.round(steps / Math.max(1, finished)),
    'decide avg ms': +(decideTotal / Math.max(1, decideCount)).toFixed(3),
    'decide max ms': +decideMax.toFixed(2),
    'offers/game': +(offers / games).toFixed(1),
    'settled/game': +(settled / games).toFixed(1),
    problems,
    seconds: +((Date.now() - started) / 1000).toFixed(1),
  });
}
console.table(rows);
