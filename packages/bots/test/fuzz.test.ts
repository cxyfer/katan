/**
 * B-POLICY 擾動狀態：從真實對局取樣，再隨機改動手牌、發展卡與銀行存量，要求
 * 每個決策都被規則引擎接受。用來覆蓋對局中少見的窗口（空銀行、大手牌、各種卡）。
 */

import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  RESOURCES,
  seededRng,
  type DevCardType,
  type GameState,
  type Rng,
} from '@catan/rules';
import { heuristicPolicy } from '../src/heuristic.ts';
import { botSeed } from '../src/seed.ts';
import type { BotLevel } from '../src/types.ts';
import { botSeats, runBotGame, viewFor } from './harness.ts';

// 整局模擬在忙碌的機器上可能超過預設的 5 秒。
const GAME_TIMEOUT = 120_000;

const CARDS: DevCardType[] = ['knight', 'victoryPoint', 'roadBuilding', 'yearOfPlenty', 'monopoly'];

function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function sample(players: number, seed: number, every: number): GameState[] {
  const levels: BotLevel[] = Array.from({ length: players }, (_, index) => (index % 2 === 0 ? 'standard' : 'easy'));
  const out: GameState[] = [];
  let step = 0;
  runBotGame({
    seats: botSeats(levels, (level) => heuristicPolicy(level)),
    seed,
    onDecision: (state) => {
      if (step++ % every === 0 && !state.result) out.push(clone(state));
    },
  });
  return out;
}

/**
 * 隨機改動一個狀態，同時維持銀行與手牌非負、供應總量不變。真實對局中不會變的
 * 東西保持不變：待棄牌玩家的手牌（應棄張數由它決定），以及已記錄的報價同意
 * （同意後到結算前，同意者的手牌不會變動）。
 */
function perturb(state: GameState, rng: Rng): GameState {
  const next = clone(state);
  const pending = next.pending;
  const frozen = new Set(pending?.kind === 'discard' ? Object.keys(pending.required) : []);
  for (const offer of next.offers) if (offer.status === 'open') offer.responses = {};
  const movable = next.players.filter((player) => !frozen.has(player.id));
  for (const player of movable) {
    for (const resource of RESOURCES) {
      next.bank[resource] += player.resources[resource];
      player.resources[resource] = 0;
    }
  }
  const scarce = rng.int(3) === 0 ? RESOURCES[rng.int(RESOURCES.length)]! : null;
  for (const player of movable) {
    for (const resource of RESOURCES) {
      const wanted = rng.int(resource === scarce ? 1 : 5);
      const amount = Math.min(wanted, next.bank[resource]);
      player.resources[resource] = amount;
      next.bank[resource] -= amount;
    }
    // 偶爾把某種資源的銀行存量抽乾。
    if (scarce && next.bank[scarce] > 0 && rng.int(2) === 0) {
      player.resources[scarce] += next.bank[scarce];
      next.bank[scarce] = 0;
    }
    if (rng.int(2) === 0) {
      const cards = Array.from({ length: rng.int(4) }, () => CARDS[rng.int(CARDS.length)]!);
      player.devCards = cards;
      player.newDevCards = rng.int(3) === 0 ? [CARDS[rng.int(CARDS.length)]!] : [];
    }
  }
  if (rng.int(2) === 0) next.turn.devCardPlayed = false;
  return next;
}

describe('B-POLICY perturbed states', () => {
  for (const players of [4, 6]) {
    it(`issues only accepted commands from perturbed ${players}-player states`, () => {
      const states = [...sample(players, 71, 5), ...sample(players, 72, 7)];
      const rng = seededRng(players * 1000 + 7);
      let checked = 0;
      const failures: string[] = [];
      for (const state of states) {
        for (let round = 0; round < 3; round++) {
          const variant = perturb(state, rng);
          for (const player of variant.players) {
            for (const level of ['standard', 'easy'] as BotLevel[]) {
              const ctx = { selfId: player.id, level, seed: botSeed('fuzz', player.id, variant.seq, round), offerPhases: {} };
              const command = heuristicPolicy(level).decide(viewFor(variant, player.id), ctx);
              if (!command) continue;
              const outcome = applyCommand(variant, player.id, command, seededRng(1));
              checked += 1;
              if (!outcome.ok) {
                failures.push(`${player.id} ${level} ${JSON.stringify(command)} -> ${outcome.error.code} ${JSON.stringify(outcome.error.params ?? {})}`);
              }
            }
          }
        }
      }
      expect(failures.slice(0, 10)).toEqual([]);
      expect(checked).toBeGreaterThan(500);
    }, GAME_TIMEOUT);
  }
});
