/**
 * Spices 與 Full 的整局統計與 Q1 斷言（ep-spices、ep-full 共用；規則同 ep-fish.test.ts）。
 * Movement 只送移動、免費動作與 `turn.end`；擱淺時下一個指令是 active 船的安全步（§4.5 不變式）。
 */

import { expect } from 'vitest';
import { moduleStateOf, requireProfile, scoreOf } from '@katan/rules';
import { botCommandLimit } from '../src/index.ts';
import { createBotPolicy } from '../src/policy.ts';
import { epHints } from '../src/modules/explorersPirates/view.ts';
import { BOT_WINDOW_COMMAND_LIMIT, botSeats, mixedLevels, runBotGame, viewFor, withFallbackSeat } from './harness.ts';
import { explorersPiratesKit } from './modules/explorersPirates.ts';

const MOVEMENT_COMMANDS = ['ep.moveShip', 'ep.extraMove', 'ep.found', 'ep.load', 'ep.chase', 'ep.dropCrew', 'ep.pickCrew', 'ep.loadFish', 'ep.loadSpice', 'ep.deliver', 'ep.fishRoll', 'trade.respond', 'trade.withdraw', 'turn.end'];

export interface Stats {
  players: number;
  seed: number;
  fallbackSeat: boolean;
  steps: number;
  rounds: number;
  spice: number;
  fish: number;
  farmCrews: number;
  lairs: number;
  /** 各軌道被推進的次數。 */
  tracks: Record<string, number>;
  rejections: number;
  maxWindow: number;
  /** 各難度送出的指令數：`<level>:<type>`。 */
  commands: Record<string, number>;
}

export function play(profileId: string, players: number, seed: number, fallbackSeat: boolean) {
  let seats = botSeats(mixedLevels(players, seed), (level) => createBotPolicy(level));
  if (fallbackSeat) seats = withFallbackSeat(seats, 0);
  const problems: string[] = [];
  const stats: Stats = { players, seed, fallbackSeat, steps: 0, rounds: 0, spice: 0, fish: 0, farmCrews: 0, lairs: 0, tracks: {}, rejections: 0, maxWindow: 0, commands: {} };
  const run = runBotGame({
    seats,
    seed,
    profileId,
    kits: [explorersPiratesKit],
    onDecision: (state, decision) => {
      const hints = epHints(viewFor(state, decision.actor).hints);
      const { type } = decision.command;
      if (decision.source !== 'fallback') {
        if (hints?.phase === 'movement' && !MOVEMENT_COMMANDS.includes(type)) problems.push(`seq ${state.seq}: ${type} in Movement`);
        if (state.pending && !['ep.placePirate', 'ep.robPlayer', 'pending.discard'].includes(type)) problems.push(`seq ${state.seq}: ${type} in a pending frame`);
        if (state.turn.phase === 'setup' && !type.startsWith('ep.setup')) problems.push(`seq ${state.seq}: ${type} in setup`);
        const level = seats.find((seat) => seat.id === decision.actor)!.level;
        if (level === 'easy' && (type === 'trade.offer' || type === 'ep.extraMove')) problems.push(`seq ${state.seq}: easy sent ${type}`);
      }
      if (!hints?.stranded) return;
      const ep = moduleStateOf<{ turn: { active: string | null } }>(state, 'explorersPirates')!;
      const info = hints.ships.find((ship) => ship.id === ep.turn.active);
      const ok = info && (info.steps.length > 0
        ? decision.command.type === 'ep.moveShip' && decision.command.ship === info.id
        : decision.command.type === 'ep.extraMove' || decision.command.type === 'ep.found');
      if (!ok) problems.push(`seq ${state.seq}: stranded but ${decision.actor} sent ${JSON.stringify(decision.command)}`);
    },
    onStep: (step) => {
      if (step.command.type === 'turn.roll') stats.rounds += 1;
      if (step.source !== 'policy') return;
      const key = `${seats.find((entry) => entry.id === step.actor)!.level}:${step.command.type}`;
      stats.commands[key] = (stats.commands[key] ?? 0) + 1;
      for (const event of step.events) {
        if (event.type === 'ep.lairCaptured') stats.lairs += 1;
        if (event.type === 'ep.crewLanded' && event.params.site === 'spice') stats.farmCrews += 1;
        if (event.type === 'ep.delivered') {
          for (const piece of event.params.goods as string[]) stats[piece === 'spice' ? 'spice' : 'fish'] += 1;
        }
        if (event.type === 'ep.trackAdvanced') stats.tracks[event.params.mission as string] = (stats.tracks[event.params.mission as string] ?? 0) + 1;
      }
    },
  });
  stats.steps = run.steps;
  stats.rejections = run.rejections;
  stats.maxWindow = run.maxWindowCommands;
  return { stats, problems, run };
}

/** Q1：有勝者、0 拒絕、無停擺、守恆、每視窗指令數在上限內。 */
export function assertGame(profileId: string, label: string, { problems, run }: ReturnType<typeof play>): void {
  const profile = requireProfile(profileId);
  expect(run.failure, `${label}: ${JSON.stringify(run.failure)}`).toBeNull();
  expect(run.stuck, `${label}: both policy and fallback idle`).toBeNull();
  expect(run.watchdog, `${label}: watchdog tripped`).toBeNull();
  expect(run.idleFallbacks, `${label}: policy idled while fallback acted`).toEqual([]);
  expect(run.state.result?.reason, `${label}: no victory after ${run.steps} steps`).toBe('victory');
  expect(scoreOf(run.state, run.state.result!.playerId!, { includeHidden: true }), `${label}: winner score`).toBeGreaterThanOrEqual(profile.victoryTarget);
  expect(run.state.pending, `${label}: unresolved pending`).toBeNull();
  expect(run.conservation, `${label}: conservation`).toEqual([]);
  expect(run.maxWindowCommands, `${label}: commands in one window`).toBeLessThanOrEqual(botCommandLimit(profile, BOT_WINDOW_COMMAND_LIMIT));
  expect(problems, `${label}: strand invariant`).toEqual([]);
  expect(run.rejections).toBe(0);
}

export const average = (all: readonly Stats[], pick: (entry: Stats) => number): number => all.reduce((sum, entry) => sum + pick(entry), 0) / all.length;

/** 每個難度各自送出過建 settler、移動、定居，以及交付或放 crew。 */
export function assertLevels(all: readonly Stats[], players: number): void {
  for (const level of ['easy', 'standard']) {
    const sent = (type: string): number => all.filter((entry) => entry.players === players).reduce((sum, entry) => sum + (entry.commands[`${level}:${type}`] ?? 0), 0);
    for (const type of ['ep.buildSettler', 'ep.moveShip', 'ep.found']) expect(sent(type), `${players}p ${level} ${type}`).toBeGreaterThan(0);
    expect(sent('ep.deliver') + sent('ep.dropCrew'), `${players}p ${level} deliver or dropCrew`).toBeGreaterThan(0);
  }
}
