/**
 * Cities & Knights 保底混座與計數器測試（C&K 計畫 §6.1）。
 *
 * - 保底混座：`[standard, fallback, easy, fallback, …]`，種子 1–3，800 步。
 *   純保底局永遠不改良、不打進步卡，因此以混座驗證 0 拒絕、不卡死、守恆。
 * - 涵蓋 profile：'ck-2025'（3、4 人）、'ck-paired-2025'（5、6 人）。
 * - kit 的 `mechanics` 計數器：事件欄位讀 `event.params.*`，策略與保底、standard 與 easy 分開計。
 */

import { describe, expect, it } from 'vitest';
import type { GameEvent, GameState } from '@catan/rules';
import { fallbackPolicy } from '../src/fallback.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import type { BotLevel, BotPolicy } from '../src/types.ts';
import { GAME_TIMEOUT, newBotGame, runBotGame, viewFor, type BotSeat } from './harness.ts';
import { citiesKnightsKit } from './modules/citiesKnights.ts';

const CK_FALLBACK_STEPS = 800;
const CK_FALLBACK_SEEDS = [1, 2, 3] as const;

interface CkProfileCase {
  readonly profileId: 'ck-2025' | 'ck-paired-2025';
  readonly players: number;
}

const CK_CASES: readonly CkProfileCase[] = [
  { profileId: 'ck-2025', players: 3 },
  { profileId: 'ck-2025', players: 4 },
  { profileId: 'ck-paired-2025', players: 5 },
  { profileId: 'ck-paired-2025', players: 6 },
];

/** 座位模式：[standard, fallback, easy, fallback, …] */
function mixedFallbackSeats(players: number): BotSeat[] {
  const pattern: (BotLevel | 'fallback')[] = ['standard', 'fallback', 'easy', 'fallback'];
  return Array.from({ length: players }, (_, index) => {
    const role = pattern[index % pattern.length]!;
    const level: BotLevel = role === 'fallback' ? 'standard' : role;
    const policy: BotPolicy = role === 'fallback' ? fallbackPolicy : createBotPolicy(level);
    return { id: `bot${index + 1}`, level, policy };
  });
}

describe('Cities & Knights fallback mixed seating', () => {
  for (const { profileId, players } of CK_CASES) {
    it(
      `only issues accepted commands and never stalls (${profileId}, ${players} players)`,
      () => {
        for (const seed of CK_FALLBACK_SEEDS) {
          const run = runBotGame({
            seats: mixedFallbackSeats(players),
            seed,
            profileId,
            maxSteps: CK_FALLBACK_STEPS,
            watchdogRolls: null,
            kits: [citiesKnightsKit],
          });

          const label = `${profileId} ${players}p seed ${seed}`;
          expect(run.failure, `${label}: rejected command: ${JSON.stringify(run.failure)}`).toBeNull();
          expect(run.stuck, `${label}: stalled at step ${run.steps}`).toBeNull();
          expect(run.stalled, `${label}: game stalled`).toBe(false);
          if (!run.state.result) expect(run.steps, `${label}: did not reach step limit`).toBe(CK_FALLBACK_STEPS);
          expect(run.conservation, `${label}: conservation failed`).toEqual([]);
        }
      },
      GAME_TIMEOUT,
    );
  }

  it('leaves seats without a duty alone in the Cities & Knights setup', () => {
    const { state } = newBotGame({ profileId: 'ck-2025', players: 4, seed: 7 });
    const [first, ...others] = state.players.map((player) => player.id);
    const ctx = (selfId: string) => ({ selfId, level: 'standard' as const, seed: botSeed(selfId), offerPhases: {} });

    expect(fallbackPolicy.decide(viewFor(state, first!), ctx(first!))?.type).toBe('setup.placeBuilding');
    for (const id of others) expect(fallbackPolicy.decide(viewFor(state, id), ctx(id))).toBeNull();
  });
});

describe('Cities & Knights mechanics tally', () => {
  const state = { players: [], board: { buildings: [] }, moduleState: {} } as unknown as GameState;
  const event = (type: string, params: Record<string, unknown>, seq = 1): GameEvent => ({ seq, type, params }) as GameEvent;
  const observe = (
    tally: ReturnType<NonNullable<typeof citiesKnightsKit.mechanics>>,
    command: string,
    source: 'policy' | 'fallback',
    level: BotLevel,
    events: GameEvent[],
  ): void => {
    tally.observe({ actor: 'bot1', level, command: { type: command } as never, source, before: state, after: state, events });
  };

  it('counts events from event.params, split by source and by seat level', () => {
    const tally = citiesKnightsKit.mechanics!();
    observe(tally, 'knight.recruit', 'policy', 'standard', [event('ck.knightRecruited', { playerId: 'bot1', vertex: 3 })]);
    observe(tally, 'knight.recruit', 'policy', 'easy', [event('ck.knightRecruited', { playerId: 'bot2', vertex: 4 })]);
    observe(tally, 'knight.recruit', 'fallback', 'standard', [event('ck.knightRecruited', { playerId: 'bot3', vertex: 5 })]);
    observe(tally, 'progress.play', 'policy', 'standard', [
      event('ck.progressPlayed', { playerId: 'bot1', card: 'smithing', track: 'science' }),
    ]);
    observe(tally, 'city.improve', 'policy', 'standard', [
      event('ck.cityImproved', { playerId: 'bot1', track: 'trade', level: 2, commodity: 'cloth', cost: 2 }),
    ]);
    observe(tally, 'city.improve', 'policy', 'standard', [
      event('ck.cityImproved', { playerId: 'bot1', track: 'trade', level: 4, commodity: 'cloth', cost: 4 }),
      event('ck.metropolisAwarded', { playerId: 'bot1', track: 'trade', vertex: 9, permanent: true }),
    ]);
    const snapshot = tally.snapshot();
    expect(snapshot['ev.ck.knightRecruited']).toBe(3);
    expect(snapshot['ev.policy.ck.knightRecruited']).toBe(2);
    expect(snapshot['ev.standard.ck.knightRecruited']).toBe(1);
    expect(snapshot['ev.easy.ck.knightRecruited']).toBe(1);
    expect(snapshot['cmd.knight.recruit']).toBe(2);
    expect(snapshot['cmd.standard.knight.recruit']).toBe(1);
    expect(snapshot['card.smithing']).toBe(1);
    expect(snapshot.maxImprovement).toBe(4);
    expect(snapshot['ev.ck.metropolisAwarded']).toBe(1);
  });

  it('counts only the played card from the policy, never from the fallback', () => {
    const tally = citiesKnightsKit.mechanics!();
    observe(tally, 'progress.play', 'fallback', 'standard', [
      event('ck.progressPlayed', { playerId: 'bot1', card: 'mining', track: 'science' }),
    ]);
    expect(tally.snapshot()['card.mining']).toBeUndefined();
    expect(tally.snapshot()['ev.ck.progressPlayed']).toBe(1);
  });

  it('counts attack outcomes, the exposed seats and the pillaged cities', () => {
    const before = {
      players: [{ id: 'bot1' }, { id: 'bot2' }],
      board: { buildings: [{ player: 'bot1', city: true }, { player: 'bot2', city: false }] },
      moduleState: { citiesKnights: { metropolises: {} } },
    } as unknown as GameState;
    const tally = citiesKnightsKit.mechanics!();
    tally.observe({
      actor: 'bot1',
      level: 'standard',
      command: { type: 'turn.roll' } as never,
      source: 'policy',
      before,
      after: before,
      events: [
        event('ck.barbariansAttack', { barbarians: 2, defenders: 0, contributions: { bot1: 0, bot2: 0 }, outcome: 'barbarians' }),
        event('ck.cityPillaged', { playerId: 'bot1', vertex: 0, wallLost: false, toppled: false }, 2),
      ],
    });
    tally.observe({
      actor: 'bot1',
      level: 'standard',
      command: { type: 'turn.roll' } as never,
      source: 'policy',
      before,
      after: before,
      events: [event('ck.barbariansAttack', { barbarians: 1, defenders: 2, contributions: { bot1: 2, bot2: 0 }, outcome: 'defenders' })],
    });
    const snapshot = tally.snapshot();
    expect(snapshot['attack.barbarians']).toBe(1);
    expect(snapshot['attack.defenders']).toBe(1);
    // 只有 bot1 有城市，兩次攻擊都暴露；bot2 只有聚落，不算。
    expect(snapshot['exposed.bot1']).toBe(2);
    expect(snapshot['exposed.bot2']).toBeUndefined();
    expect(snapshot['lost.bot1']).toBe(1);
  });
});
