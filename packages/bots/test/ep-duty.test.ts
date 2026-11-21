/**
 * E&P 保底義務（計畫 §4.1、§6.4；E1）：固定盤面逐一驗證保底的最小動作被規則引擎接受，
 * 再以 5 個 profile × 3、4 人的純保底有界局驗證 0 拒絕、0 停擺。
 *
 * 涵蓋 profile：'ep-land-ho-2025'、'ep-pirate-lairs-2025'、'ep-fish-2025'、'ep-spices-2025'、'ep-full-2025'。
 * 擱淺「全都沒有」一列：ep-2025.2（#97）起 `stranded` 為 false、`canEndTurn` 為 true，保底送 `turn.end`，不會回 null。
 */

import { describe, expect, it } from 'vitest';
import { EP_PIRATE_FRAME, seededRng, type GameState, type GameView } from '@katan/rules';
import { fallbackPolicy } from '../src/fallback.ts';
import { explorersPiratesDuty } from '../src/modules/explorersPirates/duty.ts';
import { epGeometry, foundVertices, isSeaRoute } from '../src/modules/explorersPirates/geometry.ts';
import { epView } from '../src/modules/explorersPirates/view.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotCommand, BotLevel } from '../src/types.ts';
import { cloneState, GAME_TIMEOUT, newBotGame, runBotGame, viewFor } from './harness.ts';
import {
  accept,
  adjacentEdges,
  crowd,
  ctxFor,
  dutyOf,
  enterMovement,
  EP_PROFILES,
  fallbackSeats,
  hintsOf,
  slotOf,
  toAction,
} from './ep-fixtures.ts';
import { explorersPiratesKit } from './modules/explorersPirates.ts';

const LAIRS = 'ep-pirate-lairs-2025';
const rng = () => seededRng(7);
const cursorOf = (state: GameState): string => state.players[state.turn.setup!.order[state.turn.setup!.index]!]!.id;

/** 策略（standard、easy）回 null 時與 BotDriver 一樣改問保底；fallback 本身就是保底。 */
function decisions(state: GameState, id: string): [string, BotCommand | null][] {
  const view = viewFor(state, id);
  const out: [string, BotCommand | null][] = [['fallback', fallbackPolicy.decide(view, ctxFor(id))]];
  for (const level of ['standard', 'easy'] as BotLevel[]) {
    const ctx = { ...ctxFor(id), level };
    out.push([level, createBotPolicy(level).decide(view, ctx) ?? fallbackPolicy.decide(view, ctx)]);
  }
  return out;
}

describe('setup', () => {
  function atSetup(count: number): GameState {
    const fresh = newBotGame({ profileId: LAIRS, players: 3, seed: 1 });
    let state = fresh.state;
    for (let i = 0; i < count; i++) state = accept(state, cursorOf(state), dutyOf(state, cursorOf(state))!, fresh.rng);
    return state;
  }

  it.each([
    ['harbor', 0, 'ep.setupHarbor'],
    ['settlement', 3, 'ep.setupSettlement'],
    ['route', 6, 'ep.setupShip'],
  ])('answers the %s step for fallback, standard and easy', (_step, done, type) => {
    const state = atSetup(done);
    const id = cursorOf(state);
    for (const [who, command] of decisions(state, id)) {
      expect(command?.type, who).toBe(type);
      accept(state, id, command!, rng());
    }
  });

  it('places the road after the ship, and the ship after the road', () => {
    const state = atSetup(6);
    const id = cursorOf(state);
    const road = hintsOf(viewFor(state, id)).setup!.road[0]!;
    const afterRoad = accept(state, id, { type: 'ep.setupRoad', edge: road }, rng());
    expect(dutyOf(afterRoad, id)?.type).toBe('ep.setupShip');
    accept(afterRoad, id, dutyOf(afterRoad, id)!, rng());
    const ship = hintsOf(viewFor(state, id)).setup!.ship[0]!;
    const afterShip = accept(state, id, { type: 'ep.setupShip', edge: ship }, rng());
    expect(dutyOf(afterShip, id)?.type).toBe('ep.setupRoad');
    accept(afterShip, id, dutyOf(afterShip, id)!, rng());
  });

  it('stays silent for seats off the setup cursor', () => {
    const state = atSetup(0);
    for (const player of state.players.filter((entry) => entry.id !== cursorOf(state))) expect(dutyOf(state, player.id)).toBeNull();
  });
});

describe('pirate frames and discards', () => {
  const base = toAction(LAIRS, 3, 1);
  const me = base.me;
  const others = base.state.players.map((player) => player.id).filter((id) => id !== me);
  const frame = (data: Record<string, unknown>): GameState => {
    const state = cloneState(base.state);
    state.pending = { kind: EP_PIRATE_FRAME, module: 'explorersPirates', responders: [me], data } as never;
    return state;
  };
  const target = (state: GameState): number => hintsOf(viewFor(state, me)).pirateTargets[0]!;

  it('places the pirate for a seven, never on the hex it already occupies', () => {
    const state = frame({ stage: 'place', cause: 'seven' });
    const first = target(state);
    for (const [who, command] of decisions(state, me)) {
      expect(command, who).toEqual({ type: 'ep.placePirate', hex: first });
      accept(state, me, command!, rng());
    }
    slotOf(state).pirate = { hex: first, owner: others[0]! };
    const moved = dutyOf(state, me)!;
    expect((moved as { hex?: number }).hex).not.toBe(first);
    accept(state, me, moved, rng());
  });

  it('places the chasing pirate away from the chased hex', () => {
    const first = target(frame({ stage: 'place', cause: 'seven' }));
    const state = frame({ stage: 'place', cause: 'chase', from: first });
    const command = dutyOf(state, me) as { type: string; hex: number };
    expect(command.type).toBe('ep.placePirate');
    expect(command.hex).not.toBe(first);
    accept(state, me, command, rng());
  });

  it('robs the first of two candidates, and only for the first responder', () => {
    const state = frame({ stage: 'rob', cause: 'seven', candidates: others });
    for (const [who, command] of decisions(state, me)) {
      expect(command, who).toEqual({ type: 'ep.robPlayer', victim: others[0] });
      accept(state, me, command!, rng());
    }
    expect(dutyOf(state, others[0]!)).toBeNull();
  });

  it('discards through the base duty', () => {
    const state = cloneState(base.state);
    state.players.find((player) => player.id === me)!.resources = { lumber: 2, brick: 2, wool: 2, grain: 2, ore: 2 };
    state.pending = { kind: 'discard', required: { [me]: 3 }, submitted: {} };
    const command = dutyOf(state, me);
    expect(command?.type).toBe('pending.discard');
    accept(state, me, command!, rng());
  });

  it('ends the Action sub-phase with turn.end', () => {
    expect(dutyOf(base.state, me)).toEqual({ type: 'turn.end' });
    accept(base.state, me, dutyOf(base.state, me)!, rng());
  });

  it('ends an idle Movement phase with turn.end', () => {
    const state = cloneState(base.state);
    enterMovement(state, null);
    expect(hintsOf(viewFor(state, me)).phase).toBe('movement');
    expect(dutyOf(state, me)).toEqual({ type: 'turn.end' });
    accept(state, me, dutyOf(state, me)!, rng());
  });
});

describe('stranded active ship', () => {
  const base = toAction(LAIRS, 3, 1);
  const me = base.me;
  const others = base.state.players.map((player) => player.id).filter((id) => id !== me);
  const mine = slotOf(base.state).ships.find((ship) => ship.player === me)!;

  /** 船停在有 3 艘的邊上；`ring` 把相鄰的邊都塞滿 2 艘（只剩滿格步）。 */
  function strand(opts: { ring: boolean; used: number; wool: number; settler: boolean; edge?: number }): { state: GameState; view: GameView } {
    const state = cloneState(base.state);
    const ship = slotOf(state).ships.find((entry) => entry.id === mine.id)!;
    if (opts.edge !== undefined) ship.edge = opts.edge;
    ship.cargo = opts.settler ? ['settler'] : [];
    state.players.find((player) => player.id === me)!.resources.wool = opts.wool;
    crowd(state, ship.edge, 2, others);
    if (opts.ring) for (const edge of adjacentEdges(state, ship.edge)) crowd(state, edge, 2, others);
    enterMovement(state, ship.id, opts.used);
    return { state, view: viewFor(state, me) };
  }

  it('takes a non-full step first', () => {
    const { state, view } = strand({ ring: false, used: 0, wool: 0, settler: false });
    expect(hintsOf(view).stranded).toBe(true);
    const command = dutyOf(state, me) as { type: string; edge: number };
    expect(command.type).toBe('ep.moveShip');
    expect(hintsOf(view).ships[0]!.steps.find((step) => step.edge === command.edge)?.full).toBe(false);
    accept(state, me, command, rng());
  });

  it('crosses a full edge only when an exit remains', () => {
    const { state, view } = strand({ ring: true, used: 0, wool: 0, settler: false });
    const steps = hintsOf(view).ships[0]!.steps;
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((step) => step.full)).toBe(true);
    const command = dutyOf(state, me) as { type: string };
    expect(command.type).toBe('ep.moveShip');
    accept(state, me, command as BotCommand, rng());
  });

  it('buys the extra move with wool, then sails out', () => {
    const { state, view } = strand({ ring: true, used: 3, wool: 1, settler: false });
    expect(hintsOf(view).stranded).toBe(true);
    expect(hintsOf(view).ships[0]!.steps).toEqual([]);
    const bought = accept(state, me, dutyOf(state, me)!, rng());
    expect(dutyOf(state, me)).toMatchObject({ type: 'ep.extraMove' });
    expect(dutyOf(bought, me)?.type).toBe('ep.moveShip');
    accept(bought, me, dutyOf(bought, me)!, rng());
  });

  it('founds a settlement with the settler when nothing else is left', () => {
    const probe = viewFor(base.state, me);
    const g = epGeometry(probe, epView(probe))!;
    const edge = g.topo.edges.findIndex((_, index) => isSeaRoute(g, index) && foundVertices(g, index, me).length > 0);
    expect(edge).toBeGreaterThanOrEqual(0);
    const { state, view } = strand({ ring: true, used: 3, wool: 0, settler: true, edge });
    expect(hintsOf(view).stranded).toBe(true);
    const command = dutyOf(state, me);
    expect(command?.type).toBe('ep.found');
    accept(state, me, command!, rng());
  });

  it('ends the turn when a stranded ship has no exit (ep-2025.2)', () => {
    const { state, view } = strand({ ring: true, used: 3, wool: 0, settler: false });
    expect(hintsOf(view).stranded).toBe(false);
    expect(view.hints!.canEndTurn).toBe(true);
    expect(dutyOf(state, me)).toEqual({ type: 'turn.end' });
    accept(state, me, { type: 'turn.end' }, rng());
  });
});

describe('never throws', () => {
  it('ignores malformed views', () => {
    expect(explorersPiratesDuty({} as GameView, 'bot1')).toBeUndefined();
    expect(explorersPiratesDuty({ turn: { playerId: 'bot1' }, hints: { modules: { explorersPirates: { phase: 'movement', stranded: true } } } } as unknown as GameView, 'bot1')).toBeUndefined();
  });
});

describe('all-fallback bounded games', () => {
  const STEPS = 1500;
  for (const profileId of EP_PROFILES) {
    for (const players of [3, 4]) {
      it(`only issues accepted commands and never stalls (${profileId}, ${players} players)`, () => {
        for (const seed of [1, 2]) {
          const run = runBotGame({ seats: fallbackSeats(players), seed, profileId, maxSteps: STEPS, watchdogRolls: null, kits: [explorersPiratesKit] });
          const label = `${profileId} ${players}p seed ${seed}`;
          expect(run.failure, `${label}: ${JSON.stringify(run.failure)}`).toBeNull();
          expect(run.stuck, `${label}: stalled at step ${run.steps}`).toBeNull();
          expect(run.steps, label).toBe(STEPS);
          expect(run.conservation, label).toEqual([]);
        }
      }, GAME_TIMEOUT);
    }
  }
});
