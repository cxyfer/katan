/**
 * Land Ho! 的 B-GAME（Q1）與 Q2 門檻（E&P 計畫 §6.1、§6.2）。
 *
 * - 'ep-land-ho-2025'：3、4 人；種子 `seedsFor`（預設 1–3，`BOTS_SEEDS=10` 為 1–10）；
 *   座位 standard 與 easy 交錯，另有「1 個保底席、其餘走策略」的對局。
 * - 每局：有勝者且分數達標、0 拒絕、無殘留 pending、守恆、每視窗 ≤ 80 指令、0 停擺、看門狗不觸發、
 *   策略閒置而保底有動作 0 次，擱淺時下一個指令是 active 船的 `ep.moveShip`（§4.5 不變式）。
 * - Q2：每局 Bot 在新島上定居 ≥ 1 座、探索 ≥ 4 次；平均 `ep.harborBuilt` ≥ 1.0；
 *   easy 與 standard 各自送出過 `ep.buildSettler`、`ep.moveShip`、`ep.found`。
 */

import { describe, expect, it } from 'vitest';
import { getTopology, moduleStateOf, requireProfile, scoreOf, type GameState } from '@katan/rules';
import { botCommandLimit } from '../src/index.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotLevel } from '../src/types.ts';
import { epHints } from '../src/modules/explorersPirates/view.ts';
import { BOT_WINDOW_COMMAND_LIMIT, botSeats, GAME_TIMEOUT, mixedLevels, runBotGame, seedsFor, viewFor, withFallbackSeat } from './harness.ts';
import { explorersPiratesKit } from './modules/explorersPirates.ts';

declare const console: { table(data: unknown): void };

const PROFILE = 'ep-land-ho-2025';
const profile = requireProfile(PROFILE);
const KITS = [explorersPiratesKit];
const COMMANDS = ['ep.buildSettler', 'ep.moveShip', 'ep.found'] as const;
const MOVEMENT_COMMANDS = ['ep.moveShip', 'ep.extraMove', 'ep.found', 'ep.load', 'trade.respond', 'trade.withdraw', 'turn.end'];

interface Stats {
  players: number;
  seed: number;
  fallbackSeat: boolean;
  steps: number;
  rounds: number;
  newIslandFounds: number;
  explored: number;
  harbors: number;
  /** 各難度送出的指令數：`<level>:<type>`。 */
  commands: Record<string, number>;
}

/** 起始島以外的定居點（頂點不碰起始島的任何格）。 */
function onNewIsland(state: GameState, vertex: number): boolean {
  const start = new Set(moduleStateOf<{ startIsland: number[] }>(state, 'explorersPirates')!.startIsland);
  return !getTopology(state.board.layout.topologyId).vertices[vertex]!.hexes.some((hex) => start.has(hex));
}

function play(players: number, seed: number, fallbackSeat: boolean): { stats: Stats; problems: string[]; run: ReturnType<typeof runBotGame> } {
  let seats = botSeats(mixedLevels(players, seed), (level) => createBotPolicy(level));
  if (fallbackSeat) seats = withFallbackSeat(seats, 0);
  const problems: string[] = [];
  const stats: Stats = { players, seed, fallbackSeat, steps: 0, rounds: 0, newIslandFounds: 0, explored: 0, harbors: 0, commands: {} };
  const run = runBotGame({
    seats,
    seed,
    profileId: PROFILE,
    kits: KITS,
    onDecision: (state, decision) => {
      const hints = epHints(viewFor(state, decision.actor).hints);
      const { type } = decision.command;
      const level = seats.find((seat) => seat.id === decision.actor)!.level;
      if (decision.source !== 'fallback') {
        // Movement 只送移動、免費動作與 `turn.end`；不主動提出含金幣的報價；easy 不開價、不買 extra move。
        if (hints?.phase === 'movement' && !MOVEMENT_COMMANDS.includes(type)) problems.push(`seq ${state.seq}: ${type} in Movement`);
        const offer = decision.command as { giveGoods?: object; wantGoods?: object };
        if (type === 'trade.offer' && (offer.giveGoods || offer.wantGoods)) problems.push(`seq ${state.seq}: gold offer`);
        if (level === 'easy' && (type === 'trade.offer' || type === 'ep.extraMove')) problems.push(`seq ${state.seq}: easy sent ${type}`);
      }
      // §4.5：擱淺時下一個指令是 active 船的安全步（無步可走時才允許 extraMove／found 脫困）。
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
      const seat = seats.find((entry) => entry.id === step.actor)!;
      const key = `${seat.level}:${step.command.type}`;
      stats.commands[key] = (stats.commands[key] ?? 0) + 1;
      for (const event of step.events) {
        if (event.type === 'ep.explored') stats.explored += 1;
        if (event.type === 'ep.harborBuilt') stats.harbors += 1;
        if (event.type === 'ep.settlementFounded' && onNewIsland(step.after, event.params.vertex as number)) stats.newIslandFounds += 1;
      }
    },
  });
  stats.steps = run.steps;
  return { stats, problems, run };
}

function assertGame(label: string, { stats, problems, run }: ReturnType<typeof play>): void {
  const limit = botCommandLimit(profile, BOT_WINDOW_COMMAND_LIMIT);
  expect(run.failure, `${label}: ${JSON.stringify(run.failure)}`).toBeNull();
  expect(run.stuck, `${label}: both policy and fallback idle`).toBeNull();
  expect(run.watchdog, `${label}: watchdog tripped`).toBeNull();
  expect(run.idleFallbacks, `${label}: policy idled while fallback acted`).toEqual([]);
  expect(run.state.result?.reason, `${label}: no victory after ${run.steps} steps`).toBe('victory');
  const winner = run.state.result!.playerId!;
  expect(scoreOf(run.state, winner, { includeHidden: true }), `${label}: winner score`).toBeGreaterThanOrEqual(profile.victoryTarget);
  expect(run.state.pending, `${label}: unresolved pending`).toBeNull();
  expect(run.conservation, `${label}: conservation`).toEqual([]);
  expect(run.maxWindowCommands, `${label}: commands in one window`).toBeLessThanOrEqual(limit);
  expect(problems, `${label}: strand invariant`).toEqual([]);
  expect(run.rejections).toBe(0);
  void stats;
}

describe('Land Ho! B-GAME and Q2', () => {
  const all: Stats[] = [];
  const seeds = seedsFor(profile);

  for (const players of profile.playerCounts) {
    it(
      `finishes with Q1 invariants (${PROFILE}, ${players} players, ${seeds.length} seeds)`,
      () => {
        for (const seed of seeds) {
          const game = play(players, seed, false);
          all.push(game.stats);
          assertGame(`${players}p seed ${seed}`, game);
          // Q2：每局都要有人在新島上定居、探索至少 4 次。
          expect(game.stats.newIslandFounds, `${players}p seed ${seed}: founds on a new island`).toBeGreaterThanOrEqual(1);
          expect(game.stats.explored, `${players}p seed ${seed}: explored hexes`).toBeGreaterThanOrEqual(4);
        }
      },
      GAME_TIMEOUT * 2,
    );

    it(
      `finishes with one fallback seat and heuristic seats (${PROFILE}, ${players} players)`,
      () => {
        const game = play(players, 1, true);
        all.push(game.stats);
        assertGame(`${players}p fallback seat`, game);
        // 保底席從不建造，贏的一定是策略席。
        expect(game.run.state.result?.playerId).not.toBe('bot1');
      },
      GAME_TIMEOUT,
    );
  }

  it('meets the average and per-level Q2 thresholds', () => {
    const mixed = all.filter((entry) => !entry.fallbackSeat);
    console.table(all.map((s) => ({ game: `${s.players}p s${s.seed}${s.fallbackSeat ? ' fb' : ''}`, steps: s.steps, rounds: s.rounds, founds: s.newIslandFounds, explored: s.explored, harbors: s.harbors })));
    expect(mixed.length).toBeGreaterThan(0);
    const harborAverage = mixed.reduce((sum, entry) => sum + entry.harbors, 0) / mixed.length;
    expect(harborAverage, 'average ep.harborBuilt per game').toBeGreaterThanOrEqual(1);
    for (const players of profile.playerCounts) {
      for (const level of ['easy', 'standard'] as const satisfies readonly BotLevel[]) {
        for (const type of COMMANDS) {
          const sent = mixed.filter((entry) => entry.players === players).reduce((sum, entry) => sum + (entry.commands[`${level}:${type}`] ?? 0), 0);
          expect(sent, `${players}p ${level} ${type}`).toBeGreaterThan(0);
        }
      }
    }
  });
});
