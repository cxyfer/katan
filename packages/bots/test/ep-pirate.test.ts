/**
 * Pirate Lairs 的固定狀態決策（E&P 計畫 §4.3、§4.4、§6.4 I9；E3）：海盜 frame 的 place／rob、開局三步，以及造 crew 的 `remove` 規則。
 * 每個決策都以規則引擎的 `applyCommand` 驗證被接受；fallback、standard、easy 三種座位各跑一次。
 *
 * 涵蓋 profile：'ep-pirate-lairs-2025'。
 */

import { describe, expect, it } from 'vitest';
import { EP_PIRATE_FRAME, seededRng, type GameState } from '@katan/rules';
import { fallbackPolicy } from '../src/fallback.ts';
import { turnContext } from '../src/heuristic.ts';
import { epGeometry } from '../src/modules/explorersPirates/geometry.ts';
import { crewBuild } from '../src/modules/explorersPirates/missions/lairs.ts';
import { chaseReady, fleetOf, hasWork } from '../src/modules/explorersPirates/movement.ts';
import { pirateHexScore } from '../src/modules/explorersPirates/pirate.ts';
import { epHints, epView } from '../src/modules/explorersPirates/view.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotCommand, BotLevel } from '../src/types.ts';
import { accept, ctxFor, enterMovement, hintsOf, newEpGame, slotOf, toAction } from './ep-fixtures.ts';
import { cloneState, viewFor } from './harness.ts';

const PROFILE = 'ep-pirate-lairs-2025';
const LEVELS = ['fallback', 'standard', 'easy'] as const;
const rng = () => seededRng(7);

function decide(state: GameState, id: string, who: (typeof LEVELS)[number]): BotCommand | null {
  const view = viewFor(state, id);
  if (who === 'fallback') return fallbackPolicy.decide(view, ctxFor(id));
  const ctx = { ...ctxFor(id), level: who as BotLevel };
  return createBotPolicy(who).decide(view, ctx) ?? fallbackPolicy.decide(view, ctx);
}

describe('pirate frames', () => {
  const base = toAction(PROFILE, 3, 1);
  const me = base.me;
  const others = base.state.players.map((player) => player.id).filter((id) => id !== me);
  const frame = (data: Record<string, unknown>): GameState => {
    const state = cloneState(base.state);
    state.pending = { kind: EP_PIRATE_FRAME, module: 'explorersPirates', responders: [me], data } as never;
    return state;
  };
  const targets = (state: GameState): number[] => hintsOf(viewFor(state, me)).pirateTargets;

  it('places the pirate for a seven on the hex that scores best (a rival ship on its edge)', () => {
    const state = frame({ stage: 'place', cause: 'seven' });
    const view = viewFor(state, me);
    const g = epGeometry(view, epView(view))!;
    // 把對手的船挪到某個目標格的邊上，讓那一格明顯最佳。
    const hex = targets(state).at(-1)!;
    const edge = g.topo.edges.findIndex((info, index) => info.hexes.includes(hex) && !g.ep.ships.some((ship) => ship.edge === index));
    const rival = slotOf(state).ships.find((ship) => ship.player === others[0])!;
    rival.edge = edge;
    const scored = targets(state).map((item) => pirateHexScore(turnContext(viewFor(state, me), ctxFor(me), 'standard'), epGeometry(viewFor(state, me), epView(viewFor(state, me)))!, item));
    expect(Math.max(...scored)).toBeGreaterThan(0);
    for (const who of LEVELS) {
      const command = decide(state, me, who);
      expect(command?.type, who).toBe('ep.placePirate');
      if (who === 'standard') expect((command as { hex: number }).hex).toBe(targets(state)[scored.indexOf(Math.max(...scored))]);
      accept(state, me, command!, rng());
    }
  });

  it('places the chasing pirate away from the chased hex', () => {
    const first = targets(frame({ stage: 'place', cause: 'seven' }))[0]!;
    const state = frame({ stage: 'place', cause: 'chase', from: first });
    for (const who of LEVELS) {
      const command = decide(state, me, who) as { type: string; hex: number };
      expect(command.type, who).toBe('ep.placePirate');
      expect(command.hex, who).not.toBe(first);
      accept(state, me, command, rng());
    }
  });

  it('robs the richer of two candidates, and only for the first responder', () => {
    const state = frame({ stage: 'rob', cause: 'seven', candidates: others });
    const hand = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    state.players.find((player) => player.id === others[0])!.resources = { ...hand, grain: 1 };
    state.players.find((player) => player.id === others[1])!.resources = { ...hand, grain: 4 };
    for (const who of LEVELS) {
      const command = decide(state, me, who);
      expect(command?.type, who).toBe('ep.robPlayer');
      if (who !== 'easy') expect((command as { victim: string }).victim, who).toBe(who === 'fallback' ? others[0] : others[1]);
      accept(state, me, command!, rng());
    }
    expect(decide(state, others[0]!, 'standard')).toBeNull();
  });
});

describe('variable setup', () => {
  it.each(['standard', 'easy'] as const)('is accepted for every step and seat (%s)', (level) => {
    const game = newEpGame(PROFILE, 4, 2);
    let state = game.state;
    const steps = new Set<string>();
    for (let guard = 0; state.turn.setup && guard < 60; guard++) {
      const id = state.players[state.turn.setup.order[state.turn.setup.index]!]!.id;
      const command = decide(state, id, level);
      expect(command?.type, `${level} ${id}`).toMatch(/^ep\.setup/);
      steps.add(command!.type);
      state = accept(state, id, command!, game.rng);
    }
    expect([...steps].sort()).toEqual(['ep.setupHarbor', 'ep.setupRoad', 'ep.setupSettlement', 'ep.setupShip']);
    expect(state.turn.setup).toBeFalsy();
  });
});

describe('crew building', () => {
  const NO_HAND = { lumber: 0, brick: 0, wool: 1, grain: 0, ore: 1 };
  const withLair = (): { state: GameState; me: string } => {
    const { state, me } = toAction(PROFILE, 3, 1);
    state.players.find((player) => player.id === me)!.resources = { ...NO_HAND };
    slotOf(state).sites.push({ hex: 0, kind: 'lair', crews: [], captured: false });
    return { state, me };
  };
  const build = (state: GameState, me: string, keep: boolean): BotCommand | null => {
    const view = viewFor(state, me);
    return crewBuild(epGeometry(view, epView(view))!, hintsOf(view), me, keep);
  };

  it('builds on a ship or harbour with room and never names a removal', () => {
    const { state, me } = withLair();
    const command = build(state, me, true);
    expect(command?.type).toBe('ep.buildCrew');
    expect(command).not.toHaveProperty('remove');
    for (const who of ['standard', 'easy'] as const) expect(decide(state, me, who)?.type, who).toBe('ep.buildCrew');
    accept(state, me, command!, rng());
  });

  it('removes a settler only when no slot is free anywhere and the settler is not wanted', () => {
    const { state, me } = withLair();
    // 船上已有 settler；harbour 也放滿 settler，沒有任何空位。
    for (const harbor of slotOf(state).harbors.filter((entry) => entry.player === me)) harbor.cargo = ['settler'];
    expect(build(state, me, true)).toBeNull();
    const command = build(state, me, false);
    expect(command).toMatchObject({ type: 'ep.buildCrew', remove: 'settler' });
    accept(state, me, command!, rng());
  });
});

describe('chase readiness', () => {
  it('enters Movement for a ship next to a rival pirate, and agrees with the rules chase hint', () => {
    const { state, me } = toAction(PROFILE, 3, 1);
    const rival = state.players.map((player) => player.id).find((id) => id !== me)!;
    const view = viewFor(state, me);
    const g = epGeometry(view, epView(view))!;
    const ship = slotOf(state).ships.find((entry) => entry.player === me)!;
    // 把對手的海盜放在我船端點碰到的海格上。
    const hex = g.topo.edges[ship.edge]!.vertices.flatMap((vertex) => g.topo.vertices[vertex]!.hexes).find((h) => view.board.terrain[h] === 'sea')!;
    slotOf(state).pirate = { hex, owner: rival };
    const action = viewFor(state, me);
    const turn = turnContext(action, ctxFor(me), 'standard');
    const fleet = fleetOf(turn, epGeometry(action, epView(action))!);
    const mine = epView(action)!.ships.find((entry) => entry.id === ship.id)!;
    expect(chaseReady(fleet, mine)).toBe(true);
    expect(hasWork(fleet, mine, 0, false)).toBe(true);
    // rules 在 Movement 中給出的 chase hint 必須一致。
    const moving = cloneState(state);
    enterMovement(moving, null);
    expect(epHints(viewFor(moving, me).hints)!.ships.find((info) => info.id === ship.id)!.chase).toBe(true);
    // 自己的海盜不追。
    slotOf(state).pirate = { hex, owner: me };
    const own = viewFor(state, me);
    expect(chaseReady(fleetOf(turnContext(own, ctxFor(me), 'standard'), epGeometry(own, epView(own))!), mine)).toBe(false);
  });
});
