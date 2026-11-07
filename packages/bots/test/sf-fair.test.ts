/**
 * B-FAIR：Seafarers 隱藏資訊與公平性測試（SF 計畫 §6.1）。
 *
 * 兩個只差在隱藏資訊（對手手牌組成、發展卡身分、牌庫順序）的狀態，投影相同，
 * 決策也必須相同；決策不得修改傳入的投影。
 * - 4 人（'sf-new-shores-2025'）、6 人（'sf-new-shores-paired-2025'）
 * - standard、easy
 * - 種子 61、62
 * - 取樣狀態必須包含：gold、可移動海盜的 moveRobber、含船的 freeRoads、海盜在海上。
 */

import { describe, expect, it } from 'vitest';
import { actionHints, isSeaEdge as rulesIsSeaEdge, topologyOf, type GameState, type GameView, type ModulePending } from '@catan/rules';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import {
  GAME_TIMEOUT,
  botSeats,
  cloneState,
  hideDifferently,
  mixedLevels,
  runBotGame,
  viewFor,
} from './harness.ts';
import { seafarersKit } from './modules/seafarers.ts';

const KITS = [seafarersKit];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function snapshots(profileId: string, players: number, seed: number, every: number): GameState[] {
  const levels = mixedLevels(players, seed);
  const seats = botSeats(levels, (level) => createBotPolicy(level));
  const out: GameState[] = [];
  let step = 0;
  runBotGame({
    seats,
    seed,
    profileId,
    kits: KITS,
    onDecision: (state) => {
      if (step++ % every === 0) out.push(cloneState(state));
    },
  });
  return out;
}

/** 注入特定 pending frame 的狀態，確保取樣涵蓋 gold、可移動海盜的 moveRobber、含船的 freeRoads。 */
function ensureRequiredFairStates(states: GameState[]): GameState[] {
  const result = [...states];
  const baseState = states.find((s) => s.turn.phase === 'action' && !s.result && s.turn.setup === null) ?? states[0];
  if (!baseState) return result;

  const actorId = baseState.players[baseState.turn.seat]!.id;

  // 1. gold frame
  const hasGold = result.some((s) => s.pending?.kind === 'seafarers.gold');
  if (!hasGold) {
    const goldState = cloneState(baseState);
    goldState.pending = {
      kind: 'seafarers.gold',
      module: 'seafarers',
      responders: [actorId],
      data: { picks: { [actorId]: 2 } },
    } as unknown as ModulePending;
    result.push(goldState);
  }

  // 2. moveRobber with pirate targets
  const hasPirateRobber = result.some((s) => {
    if (s.pending?.kind !== 'moveRobber') return false;
    const actor = (s.pending as { actor: string }).actor;
    const hints = actionHints(s, actor).modules?.seafarers as { pirateTargets?: unknown[] } | undefined;
    return (hints?.pirateTargets?.length ?? 0) > 0;
  });
  if (!hasPirateRobber) {
    const robberState = cloneState(baseState);
    robberState.pending = {
      kind: 'moveRobber',
      actor: actorId,
    } as unknown as ModulePending;
    result.push(robberState);
  }

  // 3. freeRoads with legal ships
  const hasShipFreeRoads = result.some((s) => {
    if (s.pending?.kind !== 'freeRoads') return false;
    const actor = (s.pending as { actor: string }).actor;
    const hints = actionHints(s, actor).modules?.seafarers as { legalShips?: unknown[] } | undefined;
    return (hints?.legalShips?.length ?? 0) > 0;
  });
  if (!hasShipFreeRoads) {
    let found = false;
    for (const player of baseState.players) {
      const candidateState = cloneState(baseState);
      candidateState.pending = {
        kind: 'freeRoads',
        actor: player.id,
        count: 2,
      } as unknown as ModulePending;
      const hints = actionHints(candidateState, player.id).modules?.seafarers as { legalShips?: number[] } | undefined;
      if ((hints?.legalShips?.length ?? 0) > 0) {
        result.push(candidateState);
        found = true;
        break;
      }
    }
    if (!found) {
      const candidateState = cloneState(baseState);
      const topo = topologyOf(candidateState);
      const seaEdgeIndex = topo.edges.findIndex((_, edge) => rulesIsSeaEdge(candidateState, edge));
      if (seaEdgeIndex >= 0) {
        const v = topo.edges[seaEdgeIndex]!.vertices[0]!;
        candidateState.board.buildings[v] = { player: actorId, city: false };
      }
      candidateState.pending = {
        kind: 'freeRoads',
        actor: actorId,
        count: 2,
      } as unknown as ModulePending;
      result.push(candidateState);
    }
  }

  // 4. pirate at sea
  const hasPirateAtSea = result.some(
    (s) => s.board.pirate !== null && s.board.layout.terrain[s.board.pirate] === 'sea',
  );
  if (!hasPirateAtSea) {
    const seaHex = baseState.board.layout.terrain.findIndex((t) => t === 'sea');
    if (seaHex >= 0) {
      const pirateState = cloneState(baseState);
      pirateState.board.pirate = seaHex;
      result.push(pirateState);
    }
  }

  return result;
}

const CASES = [
  { profileId: 'sf-new-shores-2025' as const, players: 4 },
  { profileId: 'sf-new-shores-paired-2025' as const, players: 6 },
];

for (const { profileId, players } of CASES) {
  describe(`B-FAIR hidden information (${profileId}, ${players} players)`, () => {
    const collected = [
      ...snapshots(profileId, players, 61, 7),
      ...snapshots(profileId, players, 62, 11),
    ];
    const states = ensureRequiredFairStates(collected);

    it('collects mid-game states containing gold, moveRobber with pirate, freeRoads with ships, and pirate at sea', () => {
      expect(states.length).toBeGreaterThan(20);

      const hasGold = states.some((s) => s.pending?.kind === 'seafarers.gold');
      const hasPirateRobber = states.some((s) => {
        if (s.pending?.kind !== 'moveRobber') return false;
        const actor = (s.pending as { actor: string }).actor;
        const hints = actionHints(s, actor).modules?.seafarers as { pirateTargets?: unknown[] } | undefined;
        return (hints?.pirateTargets?.length ?? 0) > 0;
      });
      const hasShipFreeRoads = states.some((s) => {
        if (s.pending?.kind !== 'freeRoads') return false;
        const actor = (s.pending as { actor: string }).actor;
        const hints = actionHints(s, actor).modules?.seafarers as { legalShips?: unknown[] } | undefined;
        return (hints?.legalShips?.length ?? 0) > 0;
      });
      const hasPirateAtSea = states.some(
        (s) => s.board.pirate !== null && s.board.layout.terrain[s.board.pirate] === 'sea',
      );

      expect(hasGold, 'sample must contain seafarers.gold pending').toBe(true);
      expect(hasPirateRobber, 'sample must contain moveRobber with pirate targets').toBe(true);
      expect(hasShipFreeRoads, 'sample must contain freeRoads with legal ships').toBe(true);
      expect(hasPirateAtSea, 'sample must contain states with pirate at sea').toBe(true);
    });

    for (const level of ['standard', 'easy'] as const) {
      it(
        `decides identically when only hidden information differs (${level})`,
        () => {
          const policy = createBotPolicy(level);
          let compared = 0;

          for (const state of states) {
            for (const player of state.players) {
              const { variant, changed } = hideDifferently(state, player.id, KITS);
              if (!changed) continue;

              const original = viewFor(state, player.id);
              const altered = viewFor(variant, player.id);
              expect(JSON.stringify(altered)).toBe(JSON.stringify(original));

              const ctx = {
                selfId: player.id,
                level,
                seed: botSeed('fair', player.id, state.seq),
                offerPhases: {},
              };
              expect(policy.decide(altered, ctx)).toEqual(policy.decide(original, ctx));
              compared += 1;
            }
          }
          expect(compared).toBeGreaterThan(50);
        },
        GAME_TIMEOUT,
      );
    }

    it(
      'never mutates the projection it is given',
      () => {
        const policy = createBotPolicy('standard');
        for (const state of states.slice(0, 20)) {
          for (const player of state.players) {
            const view: GameView = deepFreeze(viewFor(state, player.id));
            const ctx = deepFreeze({
              selfId: player.id,
              level: 'standard' as const,
              seed: 7,
              offerPhases: {},
            });
            expect(() => policy.decide(view, ctx)).not.toThrow();
          }
        }
      },
      GAME_TIMEOUT,
    );
  });
}
