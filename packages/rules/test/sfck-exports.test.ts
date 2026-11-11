/**
 * Type and constant exports that `@catan/bots` builds on (bot plan SFCK-X /
 * P8): the Seafarers + Cities & Knights combination view and hint shapes, the
 * `SfckBandit` value domain and the module id. The key lists below are
 * `Record<keyof T, true>` so that a key added to or removed from a type breaks
 * `tsc`, and the tests compare them with what the engine really projects, so
 * a drifting projection breaks the test run.
 */

import { describe, expect, it } from 'vitest';
import {
  SEAFARERS_CITIES_KNIGHTS,
  actionHints,
  projectGame,
  type ModuleHintsMap,
  type ModuleViewMap,
  type SeafarersCitiesKnightsHints,
  type SeafarersCitiesKnightsView,
  type SfckBandit,
} from '../src/index.ts';
import { requireProfile } from '../src/profiles.ts';
import {
  projectSeafarersCitiesKnights,
  seafarersCitiesKnightsHints,
  seafarersCitiesKnightsModule,
} from '../src/modules/seafarersCitiesKnights/index.ts';
import type { GameState } from '../src/types.ts';
import { actCk, addKnight, edgeBetween, rollRng, TRADE } from './ck-helpers.ts';
import { hex, settle, ship } from './seafarers-helpers.ts';
import { afterFirstAttack, emptySfckGame, sfckGame } from './sfck-helpers.ts';

const V10 = 10;
const V11 = 11;
const V28 = 28;
const V29 = 29;

const VIEW_KEYS: Record<keyof SeafarersCitiesKnightsView, true> = { pirateActive: true };

const HINT_KEYS: Record<keyof SeafarersCitiesKnightsHints, true> = {
  pirateActive: true,
  pirateChase: true,
  bandit: true,
};

/** Every value `SfckBandit` can take; a member added to or removed from the type breaks `tsc`. */
const BANDIT_VALUES: Record<SfckBandit, true> = { robber: true, pirate: true, either: true };

const keysOf = (record: object): string[] => Object.keys(record).sort();

// `bandit` is exactly `SfckBandit | null`, in both directions.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const banditType: Equal<SeafarersCitiesKnightsHints['bandit'], SfckBandit | null> = true;
void banditType;

// Both maps list the same modules, so a module added to one cannot be forgotten in the other.
type SameKeys = [keyof ModuleViewMap] extends [keyof ModuleHintsMap]
  ? [keyof ModuleHintsMap] extends [keyof ModuleViewMap] ? true : never
  : never;
const sameKeys: SameKeys = true;
void sameKeys;

function viewOf(state: GameState, viewerId: string): SeafarersCitiesKnightsView {
  const modules = projectGame(state, viewerId).modules as Partial<ModuleViewMap> | undefined;
  return modules!.seafarersCitiesKnights!;
}

function hintsOf(state: GameState, playerId: string): SeafarersCitiesKnightsHints {
  const modules = actionHints(state, playerId).modules as Partial<ModuleHintsMap> | undefined;
  return modules!.seafarersCitiesKnights!;
}

/** p1: settlement v28 with ships v28–v11 and v11–v10, an active knight on v11 next to the pirate on the sea hex (2,-2). */
function pirateChase(): GameState {
  const state = afterFirstAttack(emptySfckGame(4));
  settle(state, 'p1', V28);
  ship(state, 'p1', edgeBetween(state, V28, V11));
  ship(state, 'p1', edgeBetween(state, V11, V10));
  state.board.pirate = hex(state, 2, -2);
  addKnight(state, { player: 'p1', vertex: V11, level: 1, active: true });
  return state;
}

describe('seafarers + cities & knights module exports (bot plan SFCK-X)', () => {
  it('the module object uses the exported named functions and the exported id', () => {
    expect(seafarersCitiesKnightsModule.project).toBe(projectSeafarersCitiesKnights);
    expect(seafarersCitiesKnightsModule.actionHints).toBe(seafarersCitiesKnightsHints);
    expect(seafarersCitiesKnightsModule.id).toBe(SEAFARERS_CITIES_KNIGHTS);
    expect(SEAFARERS_CITIES_KNIGHTS).toBe('seafarersCitiesKnights');
  });

  it('only the combined profiles enable the module, and they enable it first', () => {
    for (const id of ['sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025']) {
      expect(requireProfile(id).ruleModules[0]).toBe(SEAFARERS_CITIES_KNIGHTS);
    }
    for (const id of ['sf-new-shores-2025', 'ck-2025', 'base-2025']) {
      expect(requireProfile(id).ruleModules).not.toContain(SEAFARERS_CITIES_KNIGHTS);
    }
  });

  it('the projected view has exactly the keys of SeafarersCitiesKnightsView for every viewer', () => {
    const state = emptySfckGame(4);
    for (const viewer of ['p1', 'p3']) expect(keysOf(viewOf(state, viewer))).toEqual(keysOf(VIEW_KEYS));
    expect(keysOf(projectSeafarersCitiesKnights(state))).toEqual(keysOf(VIEW_KEYS));
  });

  it('the view tracks the first barbarian attack, the same for every viewer', () => {
    const state = emptySfckGame(4);
    for (const viewer of ['p1', 'p2']) expect(viewOf(state, viewer)).toEqual({ pirateActive: false });
    const attacked = afterFirstAttack(emptySfckGame(4));
    for (const viewer of ['p1', 'p2']) {
      expect(viewOf(attacked, viewer)).toEqual({ pirateActive: true });
      expect(keysOf(viewOf(attacked, viewer))).toEqual(keysOf(VIEW_KEYS));
    }
  });

  it('the hints have exactly the keys of SeafarersCitiesKnightsHints for every viewer and phase', () => {
    const setup = sfckGame(4).state;
    expect(setup.turn.setup).not.toBeNull();
    const states = [
      setup,
      emptySfckGame(4, 0, 'preroll'),
      emptySfckGame(4, 0, 'action'),
      afterFirstAttack(emptySfckGame(4, 0, 'action')),
      pirateChase(),
    ];
    for (const state of states) {
      for (const playerId of ['p1', 'p2', 'p4']) expect(keysOf(hintsOf(state, playerId))).toEqual(keysOf(HINT_KEYS));
    }
    expect(keysOf(seafarersCitiesKnightsHints(states[2]!, 'p1'))).toEqual(keysOf(HINT_KEYS));
  });

  it('the hints agree with the exported named function', () => {
    for (const state of [emptySfckGame(4), afterFirstAttack(emptySfckGame(4)), pirateChase()]) {
      for (const playerId of ['p1', 'p2']) expect(hintsOf(state, playerId)).toEqual(seafarersCitiesKnightsHints(state, playerId));
    }
  });

  it('pirateChase lists the own knights next to the pirate, only on the owner’s action turn', () => {
    const state = pirateChase();
    expect(hintsOf(state, 'p1').pirateChase).toEqual([V11]);
    expect(hintsOf(state, 'p2').pirateChase).toEqual([]);
    state.turn.phase = 'preroll';
    expect(hintsOf(state, 'p1').pirateChase).toEqual([]);
  });

  describe('the value domain of the bandit hint', () => {
    const observed = new Set<SfckBandit | null>();
    const bandit = (state: GameState, playerId: string): SfckBandit | null => {
      const value = hintsOf(state, playerId).bandit;
      observed.add(value);
      return value;
    };

    it('is null while no moveRobber frame waits for the viewer', () => {
      const state = afterFirstAttack(emptySfckGame(4, 0, 'action'));
      expect(bandit(state, 'p1')).toBeNull();
      expect(bandit(emptySfckGame(4, 0, 'preroll'), 'p1')).toBeNull();
      // A frame that waits for p1 says nothing to the other players.
      state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
      expect(bandit(state, 'p2')).toBeNull();
    });

    it('is "robber" before the first attack, as only the robber is in play', () => {
      const state = emptySfckGame(4);
      state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
      expect(hintsOf(state, 'p1').pirateActive).toBe(false);
      expect(bandit(state, 'p1')).toBe('robber');
    });

    it('is "either" after a 7 once the first attack has happened', () => {
      const state = afterFirstAttack(emptySfckGame(4, 0, 'preroll'));
      const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, TRADE));
      expect(rolled.state.pending).toMatchObject({ kind: 'moveRobber', cause: 'seven', pirate: false });
      expect(bandit(rolled.state, 'p1')).toBe('either');
      expect(bandit(rolled.state, 'p2')).toBeNull();
    });

    it('is "robber" for a knight chasing the robber, even after the first attack', () => {
      const state = pirateChase();
      addKnight(state, { player: 'p1', vertex: V29, level: 1, active: true });
      state.board.robber = hex(state, 1, -1);
      const chased = actCk(state, 'p1', { type: 'knight.chaseRobber', vertex: V29 });
      expect(chased.state.pending).toMatchObject({ kind: 'moveRobber', cause: 'knight', pirate: false });
      expect(bandit(chased.state, 'p1')).toBe('robber');
    });

    it('is "pirate" for a knight chasing the pirate', () => {
      const chased = actCk(pirateChase(), 'p1', { type: 'knight.chasePirate', vertex: V11 });
      expect(chased.state.pending).toMatchObject({ kind: 'moveRobber', cause: 'knight', pirate: true });
      expect(bandit(chased.state, 'p1')).toBe('pirate');
      expect(bandit(chased.state, 'p2')).toBeNull();
    });

    it('takes no value outside SfckBandit | null', () => {
      // The scenarios above run first (tests in a describe run in order).
      expect([...observed].sort((a, b) => String(a).localeCompare(String(b)))).toEqual(
        [null, ...keysOf(BANDIT_VALUES)].sort((a, b) => String(a).localeCompare(String(b))),
      );
    });
  });

  it('the module id keys both maps', () => {
    const ids: Record<keyof ModuleViewMap, string> = {
      seafarers: 'seafarers',
      explorersPirates: 'explorersPirates',
      citiesKnights: 'citiesKnights',
      seafarersCitiesKnights: seafarersCitiesKnightsModule.id,
    };
    expect(ids.seafarersCitiesKnights).toBe('seafarersCitiesKnights');
    const state = emptySfckGame(4);
    expect(Object.keys(projectGame(state, 'p1').modules ?? {}).sort()).toEqual(['citiesKnights', 'seafarers', 'seafarersCitiesKnights']);
    expect(Object.keys(actionHints(state, 'p1').modules ?? {}).sort()).toEqual(['citiesKnights', 'seafarers', 'seafarersCitiesKnights']);
  });
});
