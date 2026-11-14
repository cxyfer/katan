/**
 * Seafarers + Cities & Knights 保底混座與計數器測試（SF+CK 計畫 §6.1、§12.1）。
 *
 * - 保底混座：`[standard, fallback, easy, fallback, …]`，從 setup 開始跑整局（涵蓋第 1 輪聚落、第 2 輪城市接著放路或放船、
 *   preroll 與行動階段），種子 1–3，800 步。純保底局永遠不造船、不改良，因此以混座驗證 0 拒絕、不卡死、守恆。
 * - 涵蓋 profile：'sf-ck-new-shores-2025'（3、4 人）、'sf-ck-new-shores-paired-2025'（5、6 人）。
 * - 組合 kit 的 `mechanics` 計數器：追擊海盜、`either` 時兩種盜賊各移幾次、自己的騎士釘住自己船的窗口、騎士站在自己
 *   可蓋的小島空點的窗口；事件欄位讀 `event.params.*`，策略與保底、standard 與 easy 分開計。
 */

import { describe, expect, it } from 'vitest';
import type { GameEvent, GameState } from '@catan/rules';
import { addKnight, edgeBetween } from '../../rules/test/ck-helpers.ts';
import { settle, ship } from '../../rules/test/seafarers-helpers.ts';
import { emptySfckGame } from '../../rules/test/sfck-helpers.ts';
import { fallbackPolicy } from '../src/fallback.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import type { BotLevel, BotPolicy } from '../src/types.ts';
import { GAME_TIMEOUT, newBotGame, runBotGame, viewFor, type BotSeat } from './harness.ts';
import { citiesKnightsKit } from './modules/citiesKnights.ts';
import { seafarersKit } from './modules/seafarers.ts';
import { sfckKit } from './modules/seafarersCitiesKnights.ts';

const SFCK_FALLBACK_STEPS = 800;
const SFCK_FALLBACK_SEEDS = [1, 2, 3] as const;

interface SfckProfileCase {
  readonly profileId: 'sf-ck-new-shores-2025' | 'sf-ck-new-shores-paired-2025';
  readonly players: number;
}

const SFCK_CASES: readonly SfckProfileCase[] = [
  { profileId: 'sf-ck-new-shores-2025', players: 3 },
  { profileId: 'sf-ck-new-shores-2025', players: 4 },
  { profileId: 'sf-ck-new-shores-paired-2025', players: 5 },
  { profileId: 'sf-ck-new-shores-paired-2025', players: 6 },
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

describe('Seafarers + Cities & Knights fallback mixed seating', () => {
  for (const { profileId, players } of SFCK_CASES) {
    it(
      `only issues accepted commands and never stalls (${profileId}, ${players} players)`,
      () => {
        for (const seed of SFCK_FALLBACK_SEEDS) {
          const kinds = new Set<string>();
          let buildings = 0;
          let citiesAtSetupEnd = -1;
          const run = runBotGame({
            seats: mixedFallbackSeats(players),
            seed,
            profileId,
            maxSteps: SFCK_FALLBACK_STEPS,
            watchdogRolls: null,
            kits: [seafarersKit, citiesKnightsKit, sfckKit],
            onDecision: (_state, decision) => {
              kinds.add(decision.command.type);
              if (decision.command.type === 'setup.placeBuilding') buildings += 1;
            },
            onStep: (step) => {
              // 開局結束的那一步：第 2 輪放下的城市都還在（還沒有蠻族攻擊）。
              if (citiesAtSetupEnd < 0 && step.before.turn.setup !== null && step.after.turn.setup === null) {
                citiesAtSetupEnd = step.after.board.buildings.filter((building) => building?.city === true).length;
              }
            },
          });

          const label = `${profileId} ${players}p seed ${seed}`;
          expect(run.failure, `${label}: rejected command: ${JSON.stringify(run.failure)}`).toBeNull();
          expect(run.stuck, `${label}: stalled at step ${run.steps}`).toBeNull();
          expect(run.stalled, `${label}: game stalled`).toBe(false);
          if (!run.state.result) expect(run.steps, `${label}: did not reach step limit`).toBe(SFCK_FALLBACK_STEPS);
          expect(run.conservation, `${label}: conservation failed`).toEqual([]);
          // 整局從 setup 開始：第 1 輪聚落、第 2 輪城市、之後的道路或船、preroll 與行動階段都走到。
          expect([...kinds], label).toEqual(
            expect.arrayContaining(['setup.placeBuilding', 'setup.placeRoad', 'turn.roll', 'turn.end']),
          );
          expect(run.state.turn.phase, `${label}: setup finished`).not.toBe('setup');
          expect(buildings, `${label}: two setup buildings per seat`).toBe(2 * players);
          expect(citiesAtSetupEnd, `${label}: a city for every seat from the second setup round`).toBe(players);
        }
      },
      GAME_TIMEOUT,
    );
  }

  it('leaves seats without a duty alone in the combined setup', () => {
    const { state } = newBotGame({ profileId: 'sf-ck-new-shores-2025', players: 4, seed: 7 });
    const [first, ...others] = state.players.map((player) => player.id);
    const ctx = (selfId: string) => ({ selfId, level: 'standard' as const, seed: botSeed(selfId), offerPhases: {} });

    expect(fallbackPolicy.decide(viewFor(state, first!), ctx(first!))?.type).toBe('setup.placeBuilding');
    for (const id of others) expect(fallbackPolicy.decide(viewFor(state, id), ctx(id))).toBeNull();
  });
});

describe('Seafarers + Cities & Knights mechanics tally', () => {
  const dummy = { players: [], board: { buildings: [], roads: [] }, moduleState: {}, turn: { phase: 'preroll' } } as unknown as GameState;
  const event = (type: string, params: Record<string, unknown>, seq = 1): GameEvent => ({ seq, type, params }) as GameEvent;
  const observe = (
    tally: ReturnType<NonNullable<typeof sfckKit.mechanics>>,
    source: 'policy' | 'fallback',
    level: BotLevel,
    events: GameEvent[],
  ): void => {
    tally.observe({ actor: 'bot1', level, command: { type: 'turn.end' } as never, source, before: dummy, after: dummy, events });
  };

  it('counts the chase and the bandit moves, split by source and by seat level', () => {
    const tally = sfckKit.mechanics!();
    observe(tally, 'policy', 'standard', [event('sfck.knightChasedPirate', { playerId: 'bot1', vertex: 11, hex: 20 })]);
    observe(tally, 'policy', 'standard', [event('pirate.moved', { playerId: 'bot1', hex: 21, cause: 'knight' })]);
    observe(tally, 'fallback', 'easy', [event('sfck.knightChasedPirate', { playerId: 'bot2', vertex: 12, hex: 21 })]);
    // `either`：首攻後擲出 7，移強盜或移海盜。
    observe(tally, 'policy', 'standard', [event('pirate.moved', { playerId: 'bot1', hex: 22, cause: 'seven' })]);
    observe(tally, 'policy', 'standard', [event('robber.moved', { playerId: 'bot1', hex: 4, cause: 'seven' })]);
    observe(tally, 'policy', 'easy', [event('robber.moved', { playerId: 'bot2', hex: 5, cause: 'seven' })]);
    // 追擊強盜之後移強盜。
    observe(tally, 'policy', 'standard', [event('robber.moved', { playerId: 'bot1', hex: 6, cause: 'knight' })]);
    const snapshot = tally.snapshot();
    expect(snapshot.knightChasedPirate).toBe(2);
    expect(snapshot['policy.knightChasedPirate']).toBe(1);
    expect(snapshot['standard.knightChasedPirate']).toBe(1);
    expect(snapshot['easy.knightChasedPirate']).toBeUndefined();
    expect(snapshot['chased.pirate']).toBe(1);
    expect(snapshot['chased.robber']).toBe(1);
    expect(snapshot['either.pirate']).toBe(1);
    expect(snapshot['either.robber']).toBe(2);
    expect(snapshot['either.standard.pirate']).toBe(1);
    expect(snapshot['either.standard.robber']).toBe(1);
    expect(snapshot['either.easy.robber']).toBe(1);
    expect(snapshot['either.easy.pirate']).toBeUndefined();
  });

  it('does not share a key with the Seafarers or the Cities & Knights tally', () => {
    const sfck = sfckKit.mechanics!();
    const sf = seafarersKit.mechanics!();
    const ck = citiesKnightsKit.mechanics!();
    const events = [
      event('sfck.knightChasedPirate', { playerId: 'bot1', vertex: 11, hex: 20 }),
      event('pirate.moved', { playerId: 'bot1', hex: 21, cause: 'knight' }),
      event('pirate.moved', { playerId: 'bot1', hex: 22, cause: 'seven' }),
      event('robber.moved', { playerId: 'bot1', hex: 4, cause: 'seven' }),
    ];
    for (const tally of [sfck, sf, ck]) observe(tally, 'policy', 'standard', events);
    const mine = new Set(Object.keys(sfck.snapshot()));
    for (const other of [sf, ck]) {
      for (const key of Object.keys(other.snapshot())) expect(mine.has(key), `shared key ${key}`).toBe(false);
    }
  });

  // 4 人地圖：p1 在 V28 有聚落，船 V28–V11–V10（V10 是小島金礦的海岸，也是船的開放端）。
  const V28 = 28;
  const V11 = 11;
  const V10 = 10;
  const shipLine = (): GameState => {
    const state = emptySfckGame(4);
    settle(state, 'p1', V28);
    ship(state, 'p1', edgeBetween(state, V28, V11));
    ship(state, 'p1', edgeBetween(state, V11, V10));
    return state;
  };
  const observeWindow = (before: GameState, actor = 'p1'): Readonly<Record<string, number>> => {
    const tally = sfckKit.mechanics!();
    const step = { actor, level: 'standard' as const, command: { type: 'turn.end' } as never, source: 'policy' as const, before, after: before, events: [] };
    tally.observe(step);
    tally.observe(step); // 同一個視窗只算一次
    return tally.snapshot();
  };

  it('counts a window where an own knight pins an own ship, once per window', () => {
    const free = observeWindow(shipLine());
    expect(free['window.evaluated']).toBe(1);
    expect(free['window.movable']).toBe(1);
    expect(free['window.selfPinned']).toBeUndefined();

    const pinned = shipLine();
    addKnight(pinned, { player: 'p1', vertex: V10, level: 1, active: true });
    const snapshot = observeWindow(pinned);
    expect(snapshot['window.evaluated']).toBe(1);
    expect(snapshot['window.movable']).toBe(1);
    expect(snapshot['window.selfPinned']).toBe(1);
  });

  it('does not count an opponent knight as an own pin, and counts nothing outside the actor action window', () => {
    const state = shipLine();
    addKnight(state, { player: 'p2', vertex: V11, level: 1, active: false });
    expect(observeWindow(state)['window.selfPinned']).toBeUndefined();

    const preroll = shipLine();
    preroll.turn.phase = 'preroll';
    expect(observeWindow(preroll)['window.evaluated']).toBeUndefined();
    expect(observeWindow(shipLine(), 'p2')['window.evaluated']).toBeUndefined();
  });

  it('counts a window where an own knight stands on a small-island spot the player could settle', () => {
    const free = observeWindow(shipLine());
    expect(free['window.knightOnIslandSpot']).toBeUndefined();
    const state = shipLine();
    addKnight(state, { player: 'p1', vertex: V10, level: 1, active: true });
    expect(observeWindow(state)['window.knightOnIslandSpot']).toBe(1);
    // 對手的騎士站在那裡不算「自己的騎士」。
    const opponent = shipLine();
    addKnight(opponent, { player: 'p2', vertex: V10, level: 1, active: true });
    expect(observeWindow(opponent)['window.knightOnIslandSpot']).toBeUndefined();
  });
});
