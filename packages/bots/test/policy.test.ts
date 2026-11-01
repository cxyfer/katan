/**
 * B-POLICY／B-GAME：Bot 對 Bot 完整對局。每個決策都交給規則引擎驗證，並逐步檢查
 * 策略合約（規格 §5）。
 */

import { describe, expect, it } from 'vitest';
import { getTopology, requireProfile, type Command, type GameState } from '@catan/rules';
import { fallbackPolicy } from '../src/fallback.ts';
import { heuristicPolicy } from '../src/heuristic.ts';
import { createBotPolicy } from '../src/policy.ts';
import { MAX_OFFERS_PER_WINDOW } from '../src/trade.ts';
import type { BotLevel, BotPolicy } from '../src/types.ts';
import { botSeats, runBotGame, supplyTotal, type BotSeat, type Decision } from './harness.ts';

// 整局模擬在忙碌的機器上可能超過預設的 5 秒。
const GAME_TIMEOUT = 120_000;

const RESPONSE_COMMANDS = new Set([
  'pending.discard',
  'pending.moveRobber',
  'pending.steal',
  'pending.takeResource',
  'build.road',
  'trade.respond',
]);

function mixedLevels(players: number, seed: number): BotLevel[] {
  return Array.from({ length: players }, (_, index) => ((index + seed) % 2 === 0 ? 'standard' : 'easy'));
}

/** 逐步檢查合約，並收集報價與強盜的觀察。 */
function contractChecks(seats: readonly BotSeat[]) {
  const violations: string[] = [];
  const check = (state: GameState, decision: Decision): void => {
    const { actor, command } = decision;
    const turnActor = state.players[state.turn.seat]!.id;
    const where = `seq ${state.seq} ${actor} ${command.type}`;
    // 規則 3：非行動者只回應待決效果與報價。
    if (actor !== turnActor && !RESPONSE_COMMANDS.has(command.type)) violations.push(`non-actor: ${where}`);
    if (actor !== turnActor && command.type === 'build.road' && state.pending?.kind !== 'freeRoads') {
      violations.push(`non-actor road: ${where}`);
    }
    // paired Player 2 不發起、不結算國內交易。
    const paired = requireProfile(state.profileId).paired && state.turn.pairedActor === 2;
    if (paired && actor === turnActor && (command.type === 'trade.offer' || command.type === 'trade.settle')) {
      violations.push(`paired second trades: ${where}`);
    }
    if (command.type === 'trade.offer') {
      const mine = state.offers.filter((offer) => offer.from === actor && offer.windowId === state.windowId);
      if (mine.length >= MAX_OFFERS_PER_WINDOW) violations.push(`offer limit: ${where}`);
      const same = mine.some(
        (offer) => JSON.stringify(offer.give) === JSON.stringify(command.give) && JSON.stringify(offer.want) === JSON.stringify(command.want),
      );
      if (same) violations.push(`repeated offer: ${where}`);
    }
    // standard 不把強盜放到只有自己建築的格子（有其他選擇時）。
    const seat = seats.find((candidate) => candidate.id === actor);
    const robberHex = robberTarget(command);
    if (seat?.level === 'standard' && robberHex !== null && ownsOnlyBuildingsOn(state, actor, robberHex)) {
      violations.push(`robber on own hex: ${where} hex ${robberHex}`);
    }
  };
  return { violations, check };
}

function robberTarget(command: Command): number | null {
  if (command.type === 'pending.moveRobber' || command.type === 'dev.playKnight') return command.hex;
  return null;
}

function ownsOnlyBuildingsOn(state: GameState, playerId: string, hex: number): boolean {
  const owners = new Set<string>();
  state.board.buildings.forEach((building, vertex) => {
    if (!building) return;
    // 以拓樸判斷路口是否屬於該格：路口相鄰格包含 hex。
    if (topologyHexes(state, vertex).includes(hex)) owners.add(building.player);
  });
  return owners.size > 0 && [...owners].every((owner) => owner === playerId);
}

function topologyHexes(state: GameState, vertex: number): number[] {
  return getTopology(state.board.layout.topologyId).vertices[vertex]!.hexes;
}

function playGame(seats: BotSeat[], seed: number) {
  const contract = contractChecks(seats);
  const run = runBotGame({ seats, seed, maxSteps: 5000, onDecision: contract.check });
  return { run, violations: contract.violations };
}

describe('B-GAME bot-only games', () => {
  for (const players of [3, 4, 5, 6]) {
    it(`finishes with a winner and zero rejections (${players} players, 10 seeds)`, () => {
      const supply = requireProfile(players >= 5 ? 'base-paired-2025' : 'base-2025').bankPerResource * 5;
      for (let seed = 1; seed <= 10; seed++) {
        const seats = botSeats(mixedLevels(players, seed), (level) => heuristicPolicy(level));
        const { run, violations } = playGame(seats, seed);
        const label = `${players}p seed ${seed}`;
        expect(run.failure, `${label}: ${JSON.stringify(run.failure)}`).toBeNull();
        expect(run.stalled, `${label}: stalled at seq ${run.state.seq}`).toBe(false);
        expect(run.state.result?.reason, `${label}: no result after ${run.steps} steps`).toBe('victory');
        expect(run.state.pending, label).toBeNull();
        expect(supplyTotal(run.state), label).toBe(supply);
        expect(violations, label).toEqual([]);
      }
    }, GAME_TIMEOUT);
  }

  it('lets the fallback seat stay silent while offers time out', () => {
    // 保底座位從不回應報價，報價必須經過 ready／expired 才撤回或結算。
    const levels: BotLevel[] = ['standard', 'easy', 'standard', 'standard'];
    for (const seed of [21, 22, 23]) {
      const seats: BotSeat[] = botSeats(levels, (level) => heuristicPolicy(level));
      seats[1] = { ...seats[1]!, policy: fallbackPolicy };
      const { run, violations } = playGame(seats, seed);
      expect(run.failure, JSON.stringify(run.failure)).toBeNull();
      expect(run.stalled).toBe(false);
      expect(run.state.result?.reason).toBe('victory');
      expect(violations).toEqual([]);
      const offers = run.state.offers.filter((offer) => offer.from !== 'bot2');
      expect(offers.length).toBeGreaterThan(0);
      expect(offers.every((offer) => offer.status !== 'open')).toBe(true);
    }
  }, GAME_TIMEOUT);

  it('runs through the wrapped policy the service uses', () => {
    const seats = botSeats(['standard', 'easy', 'easy', 'standard'], (level) => createBotPolicy(level));
    const { run, violations } = playGame(seats, 31);
    expect(run.failure).toBeNull();
    expect(run.state.result?.reason).toBe('victory');
    expect(violations).toEqual([]);
  }, GAME_TIMEOUT);
});

describe('B-POLICY determinism', () => {
  function transcript(policyFor: (level: BotLevel) => BotPolicy, seed: number): string[] {
    const seats = botSeats(mixedLevels(4, seed), policyFor);
    const commands: string[] = [];
    runBotGame({ seats, seed, onDecision: (_state, decision) => commands.push(JSON.stringify(decision)) });
    return commands;
  }

  it('replays the same game command for command', () => {
    for (const seed of [41, 42]) {
      const first = transcript((level) => heuristicPolicy(level), seed);
      const second = transcript((level) => heuristicPolicy(level), seed);
      expect(first.length).toBeGreaterThan(100);
      expect(second).toEqual(first);
    }
  }, GAME_TIMEOUT);

  it('separate policy instances agree on the same view and context', () => {
    const a = transcript((level) => heuristicPolicy(level), 43);
    const b = transcript((level) => createBotPolicy(level), 43);
    expect(b).toEqual(a);
  }, GAME_TIMEOUT);
});
