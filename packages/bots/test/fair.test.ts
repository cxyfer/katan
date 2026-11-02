/**
 * B-FAIR：兩個只差在隱藏資訊（對手手牌組成、發展卡身分、牌庫順序）的狀態，投影
 * 相同，決策也必須相同；決策不得修改傳入的投影。
 */

import { describe, expect, it } from 'vitest';
import { RESOURCES, type GameState, type GameView } from '@catan/rules';
import { heuristicPolicy } from '../src/heuristic.ts';
import { botSeed } from '../src/seed.ts';
import type { BotLevel } from '../src/types.ts';
import { botSeats, runBotGame, viewFor } from './harness.ts';

// 整局模擬在忙碌的機器上可能超過預設的 5 秒。
const GAME_TIMEOUT = 120_000;

function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/** 只改動 `viewerId` 看不到的資訊；手牌張數與各資源總量都不變。 */
function hideDifferently(state: GameState, viewerId: string): { variant: GameState; changed: boolean } {
  const variant = clone(state);
  let changed = false;
  const opponents = variant.players.filter((player) => player.id !== viewerId);
  // 兩位對手各交換一張不同的資源。
  outer: for (const a of opponents) {
    for (const b of opponents) {
      if (a === b) continue;
      for (const give of RESOURCES) {
        for (const take of RESOURCES) {
          if (give === take || a.resources[give] === 0 || b.resources[take] === 0) continue;
          a.resources[give] -= 1;
          a.resources[take] += 1;
          b.resources[take] -= 1;
          b.resources[give] += 1;
          changed = true;
          break outer;
        }
      }
    }
  }
  // 對手的一張未公開發展卡與牌庫交換身分，再把牌庫倒序。
  for (const player of opponents) {
    const index = player.devCards.findIndex((card) => variant.devDeck.some((other) => other !== card));
    if (index < 0) continue;
    const deckIndex = variant.devDeck.findIndex((other) => other !== player.devCards[index]);
    const card = player.devCards[index]!;
    player.devCards[index] = variant.devDeck[deckIndex]!;
    variant.devDeck[deckIndex] = card;
    changed = true;
    break;
  }
  if (variant.devDeck.length > 1) {
    variant.devDeck.reverse();
    changed = true;
  }
  return { variant, changed };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function snapshots(seed: number, every: number): GameState[] {
  const seats = botSeats(['standard', 'easy', 'standard', 'easy'], (level) => heuristicPolicy(level));
  const out: GameState[] = [];
  let step = 0;
  runBotGame({
    seats,
    seed,
    onDecision: (state) => {
      if (step++ % every === 0) out.push(clone(state));
    },
  });
  return out;
}

describe('B-FAIR hidden information', () => {
  const states = [...snapshots(51, 9), ...snapshots(52, 13)];

  it('collects enough mid-game states with hidden variety', () => {
    expect(states.length).toBeGreaterThan(40);
  });

  for (const level of ['standard', 'easy'] as BotLevel[]) {
    it(`decides identically when only hidden information differs (${level})`, () => {
      const policy = heuristicPolicy(level);
      let compared = 0;
      for (const state of states) {
        for (const player of state.players) {
          const { variant, changed } = hideDifferently(state, player.id);
          if (!changed) continue;
          const original = viewFor(state, player.id);
          const altered = viewFor(variant, player.id);
          expect(JSON.stringify(altered)).toBe(JSON.stringify(original));
          const ctx = { selfId: player.id, level, seed: botSeed('fair', player.id, state.seq), offerPhases: {} };
          expect(policy.decide(altered, ctx)).toEqual(policy.decide(original, ctx));
          compared += 1;
        }
      }
      expect(compared).toBeGreaterThan(100);
    }, GAME_TIMEOUT);
  }

  it('never mutates the projection it is given', () => {
    const policy = heuristicPolicy('standard');
    for (const state of states.slice(0, 30)) {
      for (const player of state.players) {
        const view: GameView = deepFreeze(viewFor(state, player.id));
        const ctx = deepFreeze({ selfId: player.id, level: 'standard' as const, seed: 7, offerPhases: {} });
        expect(() => policy.decide(view, ctx)).not.toThrow();
      }
    }
  }, GAME_TIMEOUT);
});
