/**
 * hard 策略（docs/aegis/specs/2026-11-07-hard-bot.md §9）：B-GAME、B-POLICY、B-FAIR 涵蓋 hard，
 * 3–6 人；另測 `createBotPolicy('hard')` 與各 profile 可選的難度（`botLevelsFor`）。
 */

import { describe, expect, it } from 'vitest';
import { getTopology, PROFILES, requireProfile, type GameState, type GameView } from '@catan/rules';
import { botCommandLimit, botLevelsFor, botResponseCommands, botsCanPlay, createBotPolicy } from '../src/index.ts';
import { winningLine } from '../src/hard/endgame.ts';
import { HardTurn } from '../src/hard/turn.ts';
import { heuristicPolicy } from '../src/heuristic.ts';
import { botSeed } from '../src/seed.ts';
import { MAX_OFFERS_PER_WINDOW } from '../src/trade.ts';
import type { BotCommand, BotContext } from '../src/types.ts';
import {
  BOT_WINDOW_COMMAND_LIMIT,
  cloneState,
  GAME_TIMEOUT,
  hideDifferently,
  historyOf,
  newBotGame,
  runBotGame,
  setHistory,
  viewFor,
  type BotSeat,
  type Decision,
} from './harness.ts';

const CASES = [
  { profileId: 'base-2025', players: 3 },
  { profileId: 'base-2025', players: 4 },
  { profileId: 'base-paired-2025', players: 5 },
  { profileId: 'base-paired-2025', players: 6 },
] as const;

const SEEDS = [71, 72, 73];

/** 一席 hard（依種子輪換），其餘 standard 與 easy 交錯；`allHard` 時全部 hard。 */
function seatsFor(players: number, seed: number, allHard = false): BotSeat[] {
  return Array.from({ length: players }, (_, index) => {
    const hard = allHard || index === seed % players;
    const level = hard ? 'hard' : index % 2 === 0 ? 'standard' : 'easy';
    return { id: `bot${index + 1}`, level, policy: createBotPolicy(level) };
  });
}

function isHard(seat: BotSeat | undefined): boolean {
  return seat?.level === 'hard';
}

function robberHex(command: BotCommand): number | null {
  if (command.type === 'pending.moveRobber' || command.type === 'dev.playKnight') return command.hex as number;
  return null;
}

/** 這一格上只有 `playerId` 的建築（而且至少有一座）。 */
function onlyOwnBuildings(state: GameState, playerId: string, hex: number): boolean {
  const topo = getTopology(state.board.layout.topologyId);
  const owners = new Set<string>();
  state.board.buildings.forEach((building, vertex) => {
    if (building && topo.vertices[vertex]!.hexes.includes(hex)) owners.add(building.player);
  });
  return owners.size > 0 && [...owners].every((owner) => owner === playerId);
}

interface Played {
  run: ReturnType<typeof runBotGame>;
  violations: string[];
  /** 終盤搜尋找到勝利序列的時刻：座位與當時的行動視窗。 */
  lines: { actor: string; windowId: number }[];
}

function play(profileId: string, seats: readonly BotSeat[], seed: number): Played {
  const profile = requireProfile(profileId);
  const responses = botResponseCommands(profile);
  const violations: string[] = [];
  const lines: { actor: string; windowId: number }[] = [];
  const check = (state: GameState, decision: Decision): void => {
    const { actor, command } = decision;
    const turnActor = state.players[state.turn.seat]!.id;
    const where = `seq ${state.seq} ${actor} ${command.type}`;
    if (actor !== turnActor && !responses.has(command.type)) violations.push(`non-actor: ${where}`);
    if (actor !== turnActor && command.type === 'build.road' && state.pending?.kind !== 'freeRoads') {
      violations.push(`non-actor road: ${where}`);
    }
    if (profile.paired && state.turn.pairedActor === 2 && actor === turnActor) {
      if (command.type === 'trade.offer' || command.type === 'trade.settle') violations.push(`paired second trades: ${where}`);
    }
    if (command.type === 'trade.offer') {
      const mine = state.offers.filter((offer) => offer.from === actor && offer.windowId === state.windowId);
      if (mine.length >= MAX_OFFERS_PER_WINDOW) violations.push(`offer limit: ${where}`);
      if (mine.some((offer) => JSON.stringify(offer.give) === JSON.stringify(command.give) && JSON.stringify(offer.want) === JSON.stringify(command.want))) {
        violations.push(`repeated offer: ${where}`);
      }
    }
    const seat = seats.find((candidate) => candidate.id === actor);
    const hex = robberHex(command);
    if (isHard(seat) && hex !== null && onlyOwnBuildings(state, actor, hex)) violations.push(`robber on own hex: ${where}`);
    // 終盤搜尋的健全性：找到勝利序列時，這個視窗結束前一定獲勝。
    if (isHard(seat) && actor === turnActor && state.turn.phase === 'action' && !state.pending) {
      const view = viewFor(state, actor);
      const ctx: BotContext = { selfId: actor, level: 'hard', seed: 1, offerPhases: {} };
      const me = view.players.find((player) => player.id === actor)!;
      if (winningLine(new HardTurn(view, ctx, me))) lines.push({ actor, windowId: state.windowId });
    }
  };
  const run = runBotGame({ seats, seed, profileId, onDecision: check });
  return { run, violations, lines };
}

function expectClean(label: string, played: Played, profileId: string): void {
  const { run, violations, lines } = played;
  const limit = botCommandLimit(requireProfile(profileId), BOT_WINDOW_COMMAND_LIMIT);
  expect(run.failure, `${label}: ${JSON.stringify(run.failure)}`).toBeNull();
  expect(run.stuck, `${label}: both policy and fallback idle`).toBeNull();
  expect(run.watchdog, `${label}: watchdog`).toBeNull();
  expect(run.idleFallbacks, `${label}: policy idle while the fallback acted`).toEqual([]);
  expect(run.state.result?.reason, `${label}: no result after ${run.steps} steps`).toBe('victory');
  expect(run.conservation, label).toEqual([]);
  expect(run.maxWindowCommands, `${label}: commands in one window`).toBeLessThanOrEqual(limit);
  expect(violations, label).toEqual([]);
  for (const line of lines) {
    expect(run.state.result?.playerId, `${label}: ${line.actor} had a winning line`).toBe(line.actor);
    expect(run.state.windowId, `${label}: ${line.actor} won in the window of the line`).toBe(line.windowId);
  }
}

describe('B-GAME hard', () => {
  for (const { profileId, players } of CASES) {
    it(`finishes with a winner and keeps the bot contract (${profileId}, ${players} players, 1 hard)`, () => {
      for (const seed of SEEDS) expectClean(`${players}p seed ${seed}`, play(profileId, seatsFor(players, seed), seed), profileId);
    }, GAME_TIMEOUT);

    it(`finishes a game where every seat is hard (${profileId}, ${players} players)`, () => {
      const seed = 80 + players;
      const played = play(profileId, seatsFor(players, seed, true), seed);
      expectClean(`${players}p all hard seed ${seed}`, played, profileId);
      // 勝者通常在最後一個視窗由終盤搜尋找到勝利序列；健全性檢查因此不是空的。
      expect(played.lines.length, `${players}p all hard: winning lines`).toBeGreaterThan(0);
    }, GAME_TIMEOUT);
  }

  it('hands expansion profiles to standard', () => {
    const { state } = newBotGame({ profileId: 'sf-new-shores-2025', players: 4, seed: 1 });
    const id = state.players[state.turn.seat]!.id;
    const view = viewFor(state, id);
    const ctx: BotContext = { selfId: id, level: 'hard', seed: 9, offerPhases: {} };
    expect(createBotPolicy('hard').decide(view, ctx)).toEqual(heuristicPolicy('standard').decide(view, ctx));
  });
});

/** 第一個「行動階段、沒有待決事項」的狀態（setup 剛結束，每人兩座聚落）。 */
function firstActionState(players: number, seed: number): GameState {
  let found: GameState | null = null;
  runBotGame({
    seats: seatsFor(players, seed, true),
    seed,
    profileId: 'base-2025',
    onDecision: (state) => {
      if (!found && state.turn.phase === 'action' && !state.pending) found = cloneState(state);
    },
  });
  return found!;
}

describe('hard endgame search', () => {
  it('trades for resources that its own builds returned to the bank', () => {
    const state = firstActionState(4, 61);
    const me = state.players[state.turn.seat]!;
    const view0 = viewFor(state, me.id);
    expect(view0.hints!.legalCities.length).toBeGreaterThanOrEqual(2);
    const rate = view0.hints!.bankRates.wool;
    // 兩座聚落 + 6 張分數卡 = 8 分；手上只夠一座城市，第二座缺的 2 張穀物銀行裡沒有，
    // 只有第一座城市付出的穀物回到銀行後才換得到。
    me.devCards = Array(6).fill('victoryPoint');
    me.resources = { lumber: 0, brick: 0, wool: 2 * rate, grain: 2, ore: 6 };
    const others = state.players.filter((player) => player.id !== me.id);
    for (const player of others) player.resources.grain = 0;
    state.bank.grain = 0;
    const view = viewFor(state, me.id);
    const ctx: BotContext = { selfId: me.id, level: 'hard', seed: 1, offerPhases: {} };
    const turn = new HardTurn(view, ctx, view.players.find((player) => player.id === me.id)!);
    expect(turn.scoreOf(me.id)).toBe(view.victoryTarget - 2);
    expect(winningLine(turn)?.first.type).toBe('build.city');
  });
});

describe('hard level availability', () => {
  it('offers hard only in profiles without rules modules', () => {
    expect(botLevelsFor(requireProfile('base-2025'))).toEqual(['easy', 'standard', 'hard']);
    expect(botLevelsFor(requireProfile('base-paired-2025'))).toEqual(['easy', 'standard', 'hard']);
    expect(botLevelsFor(requireProfile('sf-new-shores-2025'))).toEqual(['easy', 'standard']);
    for (const profile of PROFILES) {
      const levels = botLevelsFor(profile);
      if (!botsCanPlay(profile)) expect(levels, profile.id).toEqual([]);
      else expect(levels.includes('hard'), profile.id).toBe(profile.ruleModules.length === 0);
    }
  });
});

describe('B-POLICY hard determinism', () => {
  const transcript = (seed: number): string[] => {
    const commands: string[] = [];
    runBotGame({
      seats: seatsFor(4, seed),
      seed,
      profileId: 'base-2025',
      onDecision: (_state, decision) => commands.push(JSON.stringify(decision)),
    });
    return commands;
  };

  it('replays the same game command for command', () => {
    const first = transcript(41);
    expect(first.length).toBeGreaterThan(100);
    expect(transcript(41)).toEqual(first);
  }, GAME_TIMEOUT);
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** hard 對局中的狀態快照，帶著完整歷史。 */
function snapshots(players: number, seed: number, every: number): GameState[] {
  const out: GameState[] = [];
  let step = 0;
  runBotGame({
    seats: seatsFor(players, seed, true),
    seed,
    profileId: 'base-2025',
    onDecision: (state) => {
      if (step++ % every !== 0) return;
      const copy = cloneState(state);
      setHistory(copy, historyOf(state));
      out.push(copy);
    },
  });
  return out;
}

describe('B-FAIR hard hidden information', () => {
  const states = [...snapshots(4, 51, 9), ...snapshots(3, 52, 11)];

  it('collects enough mid-game states', () => {
    expect(states.length).toBeGreaterThan(40);
  });

  it('decides identically when only hidden information differs', () => {
    const policy = createBotPolicy('hard');
    let compared = 0;
    for (const state of states) {
      for (const player of state.players) {
        const { variant, changed } = hideDifferently(state, player.id);
        if (!changed) continue;
        setHistory(variant, historyOf(state));
        const original: GameView = viewFor(state, player.id);
        const altered: GameView = viewFor(variant, player.id);
        expect(JSON.stringify(altered)).toBe(JSON.stringify(original));
        const ctx: BotContext = { selfId: player.id, level: 'hard', seed: botSeed('fair', player.id, state.seq), offerPhases: {} };
        expect(policy.decide(altered, ctx)).toEqual(policy.decide(original, ctx));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(100);
  }, GAME_TIMEOUT);

  it('never mutates the projection it is given', () => {
    const policy = createBotPolicy('hard');
    for (const state of states.slice(0, 30)) {
      for (const player of state.players) {
        const view: GameView = deepFreeze(viewFor(state, player.id));
        const ctx = deepFreeze({ selfId: player.id, level: 'hard' as const, seed: 7, offerPhases: {} });
        expect(() => policy.decide(view, ctx)).not.toThrow();
      }
    }
  }, GAME_TIMEOUT);
});
