/**
 * Seafarers 保底混座與保底義務測試（SF 計畫 §6.1）。
 *
 * - 保底混座：`[standard, fallback, easy, fallback, …]`，種子 1–3，800 步。
 *   純保底局永遠不造船，因此以混座驗證 0 拒絕、不卡死。
 * - 涵蓋 profile：'sf-new-shores-2025'（3、4 人）、'sf-new-shores-paired-2025'（5、6 人）。
 */

import { describe, expect, it } from 'vitest';
import { getTopology, type GameState } from '@catan/rules';
import { fallbackPolicy } from '../src/fallback.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import type { BotLevel, BotPolicy } from '../src/types.ts';
import {
  GAME_TIMEOUT,
  newBotGame,
  runBotGame,
  viewFor,
  type BotSeat,
} from './harness.ts';
import { seafarersKit } from './modules/seafarers.ts';

const SF_FALLBACK_STEPS = 800;
const SF_FALLBACK_SEEDS = [1, 2, 3] as const;

interface SFProfileCase {
  readonly profileId: 'sf-new-shores-2025' | 'sf-new-shores-paired-2025';
  readonly players: number;
}

const SF_CASES: readonly SFProfileCase[] = [
  { profileId: 'sf-new-shores-2025', players: 3 },
  { profileId: 'sf-new-shores-2025', players: 4 },
  { profileId: 'sf-new-shores-paired-2025', players: 5 },
  { profileId: 'sf-new-shores-paired-2025', players: 6 },
];

/** 座位模式：[standard, fallback, easy, fallback, …] */
function mixedFallbackSeats(players: number): BotSeat[] {
  const pattern: (BotLevel | 'fallback')[] = ['standard', 'fallback', 'easy', 'fallback'];
  return Array.from({ length: players }, (_, index) => {
    const role = pattern[index % pattern.length]!;
    const level: BotLevel = role === 'fallback' ? 'standard' : role;
    const policy: BotPolicy = role === 'fallback' ? fallbackPolicy : createBotPolicy(level);
    return {
      id: `bot${index + 1}`,
      level,
      policy,
    };
  });
}

describe('Seafarers fallback mixed seating', () => {
  for (const { profileId, players } of SF_CASES) {
    it(
      `only issues accepted commands and never stalls (${profileId}, ${players} players)`,
      () => {
        for (const seed of SF_FALLBACK_SEEDS) {
          const run = runBotGame({
            seats: mixedFallbackSeats(players),
            seed,
            profileId,
            maxSteps: SF_FALLBACK_STEPS,
            watchdogRolls: null,
            kits: [seafarersKit],
          });

          const label = `${profileId} ${players}p seed ${seed}`;
          expect(run.failure, `${label}: rejected command: ${JSON.stringify(run.failure)}`).toBeNull();
          expect(run.stuck, `${label}: stalled at step ${run.steps}`).toBeNull();
          expect(run.stalled, `${label}: game stalled`).toBe(false);
          if (!run.state.result) {
            expect(run.steps, `${label}: did not reach step limit`).toBe(SF_FALLBACK_STEPS);
          }
          expect(run.conservation, `${label}: conservation failed`).toEqual([]);
        }
      },
      GAME_TIMEOUT,
    );
  }

  it('leaves seats without a duty alone in Seafarers setup', () => {
    const { state } = newBotGame({ profileId: 'sf-new-shores-2025', players: 4, seed: 7 });
    const [first, ...others] = state.players.map((player) => player.id);
    const ctx = (selfId: string) => ({ selfId, level: 'standard' as const, seed: botSeed(selfId), offerPhases: {} });

    // 第一位放置聚落
    expect(fallbackPolicy.decide(viewFor(state, first!), ctx(first!))?.type).toBe('setup.placeBuilding');
    for (const id of others) {
      expect(fallbackPolicy.decide(viewFor(state, id), ctx(id))).toBeNull();
    }
  });

  it('counts robber and pirate moves accurately without duplicate increments on knight', () => {
    const tally = seafarersKit.mechanics!();
    const dummyState = { awards: { longestRoad: null } } as unknown as GameState;

    // 1. 騎士移海盜：發出 pirate.moved 和 dev.knight { pirate: true }
    tally.observe({
      level: 'standard',
      command: { type: 'dev.playKnight', hex: 20 },
      source: 'policy',
      actor: 'bot1',
      before: dummyState,
      after: dummyState,
      events: [
        { seq: 1, type: 'pirate.moved', params: { playerId: 'bot1', hex: 20, cause: 'knight' } },
        { seq: 2, type: 'dev.knight', params: { playerId: 'bot1', hex: 20, victim: null, pirate: true } },
      ],
    });
    let snapshot = tally.snapshot();
    expect(snapshot.pirateMoves).toBe(1);
    expect(snapshot.robberMoves).toBe(0);

    // 2. 7 點移強盜：發出 robber.moved
    tally.observe({
      level: 'standard',
      command: { type: 'pending.moveRobber', hex: 10 },
      source: 'policy',
      actor: 'bot1',
      before: dummyState,
      after: dummyState,
      events: [{ seq: 3, type: 'robber.moved', params: { playerId: 'bot1', hex: 10, cause: 'seven' } }],
    });
    snapshot = tally.snapshot();
    expect(snapshot.pirateMoves).toBe(1);
    expect(snapshot.robberMoves).toBe(1);

    // 3. 騎士移強盜：發出 dev.knight { pirate: false }
    tally.observe({
      level: 'standard',
      command: { type: 'dev.playKnight', hex: 12 },
      source: 'policy',
      actor: 'bot1',
      before: dummyState,
      after: dummyState,
      events: [{ seq: 4, type: 'dev.knight', params: { playerId: 'bot1', hex: 12, victim: null, pirate: false } }],
    });
    snapshot = tally.snapshot();
    expect(snapshot.pirateMoves).toBe(1);
    expect(snapshot.robberMoves).toBe(2);
  });

  it('records longestRoadIncludesShips as 1 only when ships actually lengthen the route', () => {
    const { state } = newBotGame({ profileId: 'sf-new-shores-2025', players: 4, seed: 1 });
    const p1 = state.players[0]!.id;
    state.awards.longestRoad = p1;
    const topo = getTopology(state.board.layout.topologyId);

    const v0 = topo.edges[0]!.vertices[0]!;
    const v1 = topo.edges[0]!.vertices[1]!;
    const e1 = topo.edges.findIndex((e, idx) => idx !== 0 && e.vertices.includes(v1));
    const v2 = topo.edges[e1]!.vertices.find((v) => v !== v1)!;
    const e2 = topo.edges.findIndex((e, idx) => idx !== 0 && idx !== e1 && e.vertices.includes(v2));

    state.board.roads[0] = { player: p1, ship: false };
    state.board.roads[e1] = { player: p1, ship: false };
    state.board.roads[e2] = { player: p1, ship: false };
    state.board.buildings[v0] = { player: p1, city: false };

    // 情況 1：在遠方（與 v0, v1, v2 無關的邊）放一艘孤立船，最長路線長度不受影響
    const farEdge = topo.edges.findIndex(
      (e, idx) => idx !== 0 && idx !== e1 && idx !== e2 && !e.vertices.some((v) => [v0, v1, v2].includes(v)),
    );
    state.board.roads[farEdge] = { player: p1, ship: true };

    const tally1 = seafarersKit.mechanics!();
    tally1.observe({
      level: 'standard',
      command: { type: 'turn.end' },
      source: 'policy',
      actor: p1,
      before: state,
      after: state,
      events: [],
    });
    expect(tally1.snapshot().longestRoadIncludesShips).toBe(0);

    // 情況 2：把該船改接在路線尾端 v0 上，藉由 v0 上的聚落相連並延長路線
    delete state.board.roads[farEdge];
    const connectingEdge = topo.edges.findIndex((e, idx) => idx !== 0 && idx !== e1 && idx !== e2 && e.vertices.includes(v0));
    state.board.roads[connectingEdge] = { player: p1, ship: true };

    const tally2 = seafarersKit.mechanics!();
    tally2.observe({
      level: 'standard',
      command: { type: 'turn.end' },
      source: 'policy',
      actor: p1,
      before: state,
      after: state,
      events: [],
    });
    expect(tally2.snapshot().longestRoadIncludesShips).toBe(1);
  });
});
