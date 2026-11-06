/**
 * Type and constant exports that `@catan/bots` builds on (bot plan RX / P8):
 * the Seafarers view, hints and gold-frame shapes, plus `SHIP_COST` and
 * `GOLD_FRAME`. The key lists below are `Record<keyof T, true>` so that a key
 * added to or removed from a type breaks `tsc`, and the tests compare them
 * with what the engine really projects, so a drifting projection breaks the
 * test run.
 */

import { describe, expect, it } from 'vitest';
import {
  GOLD_FRAME,
  SHIP_COST,
  actionHints,
  projectGame,
  type ModuleHintsMap,
  type ModuleViewMap,
  type SeafarersGoldPendingView,
  type SeafarersHints,
  type SeafarersView,
} from '../src/index.ts';
import { requireProfile } from '../src/profiles.ts';
import { explorersPiratesModule } from '../src/modules/explorersPirates/index.ts';
import { projectSeafarers, seafarersHints, seafarersModule } from '../src/modules/seafarers/index.ts';
import { seafarersState } from '../src/modules/seafarers/state.ts';
import type { GameState } from '../src/types.ts';
import { act, scriptedRng } from './helpers.ts';
import { corner, emptySeafarersGame, seafarersGame, settle, ship, side } from './seafarers-helpers.ts';

type Claim = SeafarersView['islandClaims'][number];

const VIEW_KEYS: Record<keyof SeafarersView, true> = {
  islandBonus: true,
  islandClaims: true,
  shipsBuiltThisTurn: true,
  shipMoved: true,
};

const CLAIM_KEYS: Record<keyof Claim, true> = { player: true, island: true, vertex: true };

const HINT_KEYS: Record<keyof SeafarersHints, true> = {
  legalShips: true,
  setupShips: true,
  movableShips: true,
  shipMoved: true,
  pirateTargets: true,
  robberTargets: true,
  goldRequired: true,
};

const GOLD_KEYS: Record<keyof SeafarersGoldPendingView, true> = { kind: true, module: true, responders: true, data: true };
const GOLD_DATA_KEYS: Record<keyof SeafarersGoldPendingView['data'], true> = { picks: true };

const keysOf = (record: object): string[] => Object.keys(record).sort();

// Both maps list the same modules, so a module added to one cannot be forgotten in the other.
type SameKeys = [keyof ModuleViewMap] extends [keyof ModuleHintsMap]
  ? [keyof ModuleHintsMap] extends [keyof ModuleViewMap] ? true : never
  : never;
const sameKeys: SameKeys = true;
void sameKeys;

function viewOf(state: GameState, viewerId: string): SeafarersView {
  const modules = projectGame(state, viewerId).modules as Partial<ModuleViewMap> | undefined;
  return modules!.seafarers!;
}

function hintsOf(state: GameState, playerId: string): SeafarersHints {
  const modules = actionHints(state, playerId).modules as Partial<ModuleHintsMap> | undefined;
  return modules!.seafarers!;
}

/** p1 (settlement) and p2 (city) both sit on the gold field (3,0); a 10 is rolled. */
function goldRoll(): GameState {
  const state = emptySeafarersGame(4, 0, 'preroll');
  settle(state, 'p1', corner(state, 2, 0, 5));
  settle(state, 'p2', corner(state, 3, 0, 0), true);
  return act(state, 'p1', { type: 'turn.roll' }, scriptedRng([3, 5])).state;
}

describe('seafarers module exports (bot plan RX)', () => {
  it('the module object uses the exported named functions', () => {
    expect(seafarersModule.project).toBe(projectSeafarers);
    expect(seafarersModule.actionHints).toBe(seafarersHints);
  });

  it('the projected view has exactly the keys of SeafarersView', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    for (const viewer of ['p1', 'p3']) expect(keysOf(viewOf(state, viewer))).toEqual(keysOf(VIEW_KEYS));
    expect(keysOf(projectSeafarers(state))).toEqual(keysOf(VIEW_KEYS));
  });

  it('a populated view keeps the key sets, including each island claim', () => {
    const state = emptySeafarersGame(4, 0, 'action');
    const slot = seafarersState(state);
    ship(state, 'p1', side(state, 2, 0, 0));
    slot.built.push(side(state, 2, 0, 0));
    slot.moved = true;
    slot.islands.p1!.push(1);
    slot.claims.push({ player: 'p1', island: 1, vertex: corner(state, 2, 0, 5) });
    const view = viewOf(state, 'p2');
    expect(keysOf(view)).toEqual(keysOf(VIEW_KEYS));
    expect(view.islandClaims).toHaveLength(1);
    expect(keysOf(view.islandClaims[0]!)).toEqual(keysOf(CLAIM_KEYS));
    expect(view.islandBonus.p1).toEqual([1]);
    expect(view.shipsBuiltThisTurn).toEqual([side(state, 2, 0, 0)]);
    expect(view.shipMoved).toBe(true);
  });

  it('the hints have exactly the keys of SeafarersHints for every viewer and phase', () => {
    const action = emptySeafarersGame(4, 0, 'action');
    const preroll = emptySeafarersGame(4, 0, 'preroll');
    const gold = goldRoll();
    const setup = seafarersGame(4).state;
    expect(setup.turn.setup).not.toBeNull();
    for (const state of [action, preroll, gold, setup]) {
      for (const playerId of ['p1', 'p2', 'p4']) expect(keysOf(hintsOf(state, playerId))).toEqual(keysOf(HINT_KEYS));
    }
    expect(keysOf(seafarersHints(action, 'p1', { profile: requireProfile(action.profileId) }))).toEqual(keysOf(HINT_KEYS));
  });

  it('hints are non-trivial where they should be (the key list is not satisfied by empty values)', () => {
    const action = emptySeafarersGame(4, 0, 'action');
    settle(action, 'p1', corner(action, 2, 0, 5));
    const mine = hintsOf(action, 'p1');
    expect(mine.legalShips.length).toBeGreaterThan(0);
    expect(mine.robberTargets.length).toBeGreaterThan(0);
    expect(hintsOf(action, 'p2').legalShips).toEqual([]);
    expect(hintsOf(goldRoll(), 'p1').goldRequired).toBe(1);
  });

  it('a gold frame projects as SeafarersGoldPendingView, identically for every seat', () => {
    const state = goldRoll();
    expect(state.pending).toMatchObject({ kind: GOLD_FRAME, module: 'seafarers' });
    for (const viewer of ['p1', 'p2', 'p3', 'p4']) {
      const pending = projectGame(state, viewer).pending as SeafarersGoldPendingView;
      expect(keysOf(pending)).toEqual(keysOf(GOLD_KEYS));
      expect(keysOf(pending.data)).toEqual(keysOf(GOLD_DATA_KEYS));
      expect(pending).toEqual({
        kind: 'seafarers.gold',
        module: 'seafarers',
        responders: ['p1', 'p2'],
        data: { picks: { p1: 1, p2: 2 } },
      } satisfies SeafarersGoldPendingView);
    }
  });

  it('a gold frame shrinks to the responders still owing a pick', () => {
    const state = act(goldRoll(), 'p1', { type: 'gold.choose', resources: ['ore'] } as never).state;
    const pending = projectGame(state, 'p3').pending as SeafarersGoldPendingView;
    expect(pending.responders).toEqual(['p2']);
    expect(pending.data).toEqual({ picks: { p2: 2 } });
  });

  it('exports the constants the bots read', () => {
    expect(SHIP_COST).toEqual({ lumber: 1, wool: 1 });
    expect(GOLD_FRAME).toBe('seafarers.gold');
  });

  it('ModuleViewMap and ModuleHintsMap are keyed by real module ids', () => {
    const ids: Record<keyof ModuleViewMap, string> = {
      seafarers: seafarersModule.id,
      explorersPirates: explorersPiratesModule.id,
    };
    expect(ids).toEqual({ seafarers: 'seafarers', explorersPirates: 'explorersPirates' });
  });
});
