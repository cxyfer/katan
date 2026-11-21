/**
 * E&P 航線規劃 `route.ts`（計畫 §4.5、§6.4；E1）：固定線形盤面驗證滿格邊、MP、探索與過路費的轉移規則，
 * 再以真實對局比對 `safeSteps` 與 rules 的 `H.ships[].steps`（兩者不得漂移）。
 * 另驗證 `remainingTiles` 與 `V.regionsLeft` 一致。
 */

import { describe, expect, it } from 'vitest';
import { seededRng, type GameState } from '@katan/rules';
import { epGeometry } from '../src/modules/explorersPirates/geometry.ts';
import { remainingTiles, tilesTotal } from '../src/modules/explorersPirates/inventory.ts';
import { canStop, isSafeStep, planRoute, reachableEdges, routeWorld, safeSteps, stepsFrom, type RouteWorld } from '../src/modules/explorersPirates/route.ts';
import { epPlayer, epView } from '../src/modules/explorersPirates/view.ts';
import { cloneState, GAME_TIMEOUT, viewFor } from './harness.ts';
import { accept, enterMovement, EP_PROFILES, hintsOf, slotOf, toAction } from './ep-fixtures.ts';
import { explorersPiratesKit } from './modules/explorersPirates.ts';

/** 線形盤面：邊 0..9 依序相鄰；`full` 的邊已有 2 艘其他船，`fog` 的邊會探索，`pirate` 的邊貼著海盜，`found` 的邊可就地定居。 */
function line(opts: { full?: number[]; fog?: number[]; pirate?: number[]; found?: number[] } = {}): RouteWorld {
  const has = (list: number[] | undefined, edge: number): boolean => list?.includes(edge) ?? false;
  return {
    neighbors: (edge) => [edge - 1, edge + 1].filter((other) => other >= 0 && other <= 9),
    occupants: (edge) => (has(opts.full, edge) ? 2 : 0),
    explores: (edge) => has(opts.fog, edge),
    pirateAt: (edge) => has(opts.pirate, edge),
    canFound: (edge) => has(opts.found, edge),
  };
}

describe('planRoute', () => {
  const w = line({ full: [2, 3] });

  it('accepts a route through full edges when the MP suffices, ending on a non-full edge', () => {
    const path = planRoute(w, 0, 4, 4, false, 1);
    expect(path).toEqual({ edges: [1, 2, 3, 4], mp: 4, tribute: false });
    expect(w.occupants(path!.edges.at(-1)!)).toBeLessThan(2);
  });

  it('rejects the route when the MP is one short', () => {
    expect(planRoute(w, 0, 4, 3, false, 1)).toBeNull();
  });

  it('never ends on a full edge', () => {
    expect(planRoute(w, 0, 3, 6, false, 1)).toBeNull();
    for (const [edge, path] of reachableEdges(w, 0, 6, false, 1)) {
      expect(w.occupants(edge), `edge ${edge}`).toBeLessThan(2);
      expect(w.occupants(path.edges.at(-1)!)).toBeLessThan(2);
    }
  });

  it('cannot enter a full edge with the last MP', () => {
    expect(stepsFrom(w, 1, 1, false, 1).map((step) => step.edge)).toEqual([0]);
    expect(stepsFrom(w, 1, 2, false, 1).map((step) => step.edge)).toEqual([0, 2]);
  });

  it('stops at an exploring edge and never routes through one', () => {
    const fog = line({ fog: [3] });
    expect(planRoute(fog, 0, 3, 4, false, 1)?.edges).toEqual([1, 2, 3]);
    expect(planRoute(fog, 0, 4, 6, false, 1)).toBeNull();
    expect(stepsFrom(line({ full: [3], fog: [3] }), 2, 4, false, 1).map((step) => step.edge)).toEqual([1]);
  });

  it('pays the tribute once and needs a coin for it', () => {
    const pirate = line({ pirate: [2] });
    expect(planRoute(pirate, 0, 4, 5, false, 1)).toMatchObject({ mp: 4, tribute: true });
    expect(planRoute(pirate, 0, 4, 5, false, 0)).toBeNull();
    expect(planRoute(pirate, 0, 4, 5, true, 0)).toMatchObject({ tribute: false });
  });
});

describe('isSafeStep', () => {
  const step = (edge: number, full: boolean) => ({ edge, tribute: false, full, explores: false });

  it('treats every non-full step as safe', () => {
    expect(isSafeStep(line({ full: [0, 1] }), step(2, false), 1, false, 0)).toBe(true);
  });

  it('allows a full step only while a non-full edge stays reachable', () => {
    expect(isSafeStep(line({ full: [1] }), step(1, true), 2, false, 0)).toBe(true);
    // 起點 0 與下一條 2 都滿格：剩 1 MP 時進不去，是死路。
    const dead = line({ full: [0, 1, 2] });
    expect(isSafeStep(dead, step(1, true), 2, false, 0)).toBe(false);
    expect(safeSteps(dead, 0, 2, false, 0)).toEqual([]);
    // 多一點 MP 就能走到非滿格的 3。
    expect(isSafeStep(dead, step(1, true), 3, false, 0)).toBe(true);
  });

  it('counts a settler founding as an exit, and needs a path through the full edges', () => {
    expect(isSafeStep(line({ full: [0, 1, 2], found: [1] }), step(1, true), 2, false, 0)).toBe(true);
    const wall = line({ full: [0, 1, 2, 3] });
    expect(canStop(wall, 1, 1, false, 0)).toBe(false);
    expect(canStop(wall, 1, 2, false, 0)).toBe(false);
    expect(canStop(wall, 1, 3, false, 0)).toBe(true);
  });
});

describe('route world vs rules hints', () => {
  it.each([...EP_PROFILES])('safeSteps equals H.ships[].steps with crowded edges (%s)', (profileId) => {
    for (const seed of [1, 2]) {
      const base = toAction(profileId, 3, seed);
      const rng = seededRng(seed);
      const state: GameState = cloneState(base.state);
      // 擾動出滿格邊：每次替非行動者在單艘船的邊上補一艘。
      for (let i = 0; i < 6; i++) explorersPiratesKit.perturb!(state, rng);
      const prepared = accept(state, base.me, { type: 'ep.startMovement' }, rng);
      const view = viewFor(prepared, base.me);
      const ep = epView(view)!;
      const g = epGeometry(view, ep)!;
      for (const info of hintsOf(view).ships) {
        const world = routeWorld(g, info.id)!;
        const ship = ep.ships.find((entry) => entry.id === info.id)!;
        const steps = safeSteps(world, ship.edge, info.movesLeft, false, epPlayer(ep, base.me)!.gold);
        expect(steps.map((step) => ({ edge: step.edge, full: step.full, tribute: step.tribute, explores: step.explores })), `${profileId} ${seed} ${info.id}`).toEqual(info.steps);
      }
    }
  }, GAME_TIMEOUT);

  it('derives the fixed-board strand from the real state', () => {
    const base = toAction('ep-pirate-lairs-2025', 3, 1);
    const state = cloneState(base.state);
    const ship = slotOf(state).ships.find((entry) => entry.player === base.me)!;
    enterMovement(state, ship.id);
    const view = viewFor(state, base.me);
    const g = epGeometry(view, epView(view))!;
    const world = routeWorld(g, ship.id)!;
    expect(world.occupants(ship.edge)).toBe(0);
    expect(routeWorld(g, 'nope')).toBeUndefined();
  });
});

describe('remainingTiles', () => {
  it.each([...EP_PROFILES])('matches V.regionsLeft after exploration (%s)', (profileId) => {
    const base = toAction(profileId, 3, 1);
    const view = viewFor(base.state, base.me);
    const ep = epView(view)!;
    const left = remainingTiles(epGeometry(view, ep)!)!;
    expect(tilesTotal(left.parrot)).toBe(ep.regionsLeft.parrot);
    expect(tilesTotal(left.goose)).toBe(ep.regionsLeft.goose);
    // 揭露一個霧格後減一：直接把 hex 從 fog 移除並寫成海。
    const state = cloneState(base.state);
    const slot = state as unknown as { moduleState: { explorersPirates: { fog: { hex: number; region: 'parrot' | 'goose' }[] } } };
    const revealed = slot.moduleState.explorersPirates.fog.shift()!;
    const tile = (['hills', 'forest', 'pasture', 'fields', 'mountains', 'sea'] as const).find((name) => (left[revealed.region][name] ?? 0) > 0)!;
    state.board.layout.terrain[revealed.hex] = tile;
    const after = viewFor(state, base.me);
    const next = remainingTiles(epGeometry(after, epView(after)!)!)!;
    expect(tilesTotal(next[revealed.region])).toBe(tilesTotal(left[revealed.region]) - 1);
  }, GAME_TIMEOUT);
});
