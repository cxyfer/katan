/**
 * Type and constant exports that `@katan/bots` builds on (bot plan RX / P8):
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
import { citiesKnightsModule } from '../src/modules/citiesKnights/index.ts';
import { explorersPiratesModule } from '../src/modules/explorersPirates/index.ts';
import { projectSeafarers, seafarersHints, seafarersModule } from '../src/modules/seafarers/index.ts';
import { seafarersState } from '../src/modules/seafarers/state.ts';
import { seafarersCitiesKnightsModule } from '../src/modules/seafarersCitiesKnights/index.ts';
import { tradersBarbariansModule } from '../src/modules/tradersBarbarians/index.ts';
import type { GameState } from '../src/types.ts';
import { applyCommand } from '../src/engine.ts';
import { act, scriptedRng } from './helpers.ts';
import { corner, emptySeafarersGame, seafarersGame, settle, ship, side } from './seafarers-helpers.ts';

type Claim = SeafarersView['islandClaims'][number];

const VIEW_KEYS: Record<keyof SeafarersView, true> = {
  islandBonus: true,
  islandClaims: true,
  shipsBuiltThisTurn: true,
  shipMoved: true,
  home: true,
  fog: true,
  tribe: true,
  cloth: true,
  world: true,
  wonders: true,
};

const CLAIM_KEYS: Record<keyof Claim, true> = { player: true, island: true, vertex: true };

const HINT_KEYS: Record<keyof SeafarersHints, true> = {
  legalShips: true,
  setupShips: true,
  movableShips: true,
  shipMoved: true,
  pirateTargets: true,
  clothVictims: true,
  robberChoice: true,
  robberTargets: true,
  goldRequired: true,
  goldBank: true,
  harborChoices: true,
  targets: true,
  board: true,
  wonders: true,
};

const GOLD_KEYS: Record<keyof SeafarersGoldPendingView, true> = { kind: true, module: true, responders: true, data: true };
const GOLD_DATA_KEYS: Record<keyof SeafarersGoldPendingView['data'], true> = { picks: true };

const keysOf = (record: object): string[] => Object.keys(record).sort();
/** 世外部落以外的劇本沒有港口放置的提示欄位。 */
const HINT_KEYS_WITHOUT_TRIBE = Object.keys(HINT_KEYS).filter((key) => !['harborChoices', 'targets', 'board', 'clothVictims', 'robberChoice', 'wonders'].includes(key)).sort();
/** `home` 只在排除 home 島的劇本（四島群島、新世界）的設置結束後出現，New Shores 不帶。 */
const VIEW_KEYS_WITHOUT_HOME = Object.keys(VIEW_KEYS).filter((key) => key !== 'home' && key !== 'fog' && key !== 'tribe' && key !== 'cloth' && key !== 'world' && key !== 'wonders').sort();
/** `fog` 只在未知海域劇本、`tribe` 只在世外部落、`cloth` 只在布匹產地、`world` 只在新世界、`wonders` 只在卡坦奇觀出現。 */

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
    for (const viewer of ['p1', 'p3']) expect(keysOf(viewOf(state, viewer))).toEqual(VIEW_KEYS_WITHOUT_HOME);
    expect(keysOf(projectSeafarers(state))).toEqual(VIEW_KEYS_WITHOUT_HOME);
  });

  it('a fog scenario adds the unrevealed hexes as `fog`', () => {
    const state = emptySeafarersGame(3, 0, 'action', 'sf-fog-islands-2025');
    expect(keysOf(projectSeafarers(state))).toEqual(keysOf(VIEW_KEYS).filter((key) => key !== 'home' && key !== 'tribe' && key !== 'cloth' && key !== 'world' && key !== 'wonders'));
    expect(viewOf(state, 'p2').fog).toHaveLength(12);
  });

  it('a home-island scenario adds `home` once setup has recorded it', () => {
    const state = emptySeafarersGame(4, 0, 'action', 'sf-four-islands-2025');
    expect(keysOf(projectSeafarers(state))).toEqual(VIEW_KEYS_WITHOUT_HOME);
    seafarersState(state).home = { p1: [2], p2: [3], p3: [], p4: [5, 4] };
    expect(keysOf(projectSeafarers(state))).toEqual(keysOf(VIEW_KEYS).filter((key) => key !== 'fog' && key !== 'cloth' && key !== 'tribe' && key !== 'world' && key !== 'wonders'));
    expect(viewOf(state, 'p3').home).toEqual({ p1: [2], p2: [3], p3: [], p4: [5, 4] });
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
    expect(keysOf(view)).toEqual(VIEW_KEYS_WITHOUT_HOME);
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
      for (const playerId of ['p1', 'p2', 'p4']) expect(keysOf(hintsOf(state, playerId))).toEqual(HINT_KEYS_WITHOUT_TRIBE);
    }
    expect(keysOf(seafarersHints(action, 'p1', { profile: requireProfile(action.profileId) }))).toEqual(HINT_KEYS_WITHOUT_TRIBE);
  });

  // D7：New Shores（sf-2025.2）與其他沒有禮物的劇本不得多出世外部落的提示欄位與指令。
  it('only The Forgotten Tribe adds the harbour hint keys; elsewhere harbor.place keeps the unknown-command errors', () => {
    const tribe = emptySeafarersGame(3, 0, 'action', 'sf-forgotten-tribe-2025');
    expect(keysOf(hintsOf(tribe, 'p1'))).toEqual(keysOf(HINT_KEYS).filter((key) => key !== 'clothVictims' && key !== 'robberChoice' && key !== 'wonders'));
    for (const profileId of ['sf-new-shores-2025', 'sf-four-islands-2025', 'sf-through-the-desert-2025']) {
      const state = emptySeafarersGame(4, 0, 'action', profileId);
      expect(keysOf(hintsOf(state, 'p1')), profileId).toEqual(HINT_KEYS_WITHOUT_TRIBE);
      expect(applyCommand(state, 'p1', { type: 'harbor.place', edge: 0, harbor: 'wool' } as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_INVALID_COMMAND' } });
      state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
      expect(applyCommand(state, 'p1', { type: 'harbor.place', edge: 0, harbor: 'wool' } as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_PENDING_EFFECT' } });
    }
  });

  // D7：只有布匹產地有 clothVictims 提示與 cloth.steal 指令；其他劇本的鍵集合與錯誤碼不變。
  it('only Cloth for Catan adds clothVictims; elsewhere cloth.steal keeps the unknown-command errors', () => {
    const cloth = emptySeafarersGame(3, 0, 'action', 'sf-cloth-for-catan-2025');
    expect(keysOf(hintsOf(cloth, 'p1'))).toEqual(keysOf(HINT_KEYS).filter((key) => !['harborChoices', 'targets', 'board', 'robberChoice', 'wonders'].includes(key)));
    for (const profileId of ['sf-new-shores-2025', 'sf-four-islands-2025', 'sf-forgotten-tribe-2025', 'sf-through-the-desert-2025', 'sf-new-world-2025']) {
      const state = emptySeafarersGame(profileId === 'sf-new-shores-2025' ? 4 : 3, 0, 'action', profileId);
      expect(keysOf(hintsOf(state, 'p1')), profileId).not.toContain('clothVictims');
      expect(applyCommand(state, 'p1', { type: 'cloth.steal', victim: 'p2' } as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_INVALID_COMMAND' } });
      expect(applyCommand(state, 'p1', { type: 'cloth.robber', hex: 0 } as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_INVALID_COMMAND' } });
      state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
      expect(applyCommand(state, 'p1', { type: 'cloth.steal', victim: 'p2' } as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_PENDING_EFFECT' } });
      expect(applyCommand(state, 'p1', { type: 'cloth.robber', hex: 0 } as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_PENDING_EFFECT' } });
    }
  });

  it('New World adds `world` to the view and the harbour hint keys to the hints, and takes world.harbor only there', () => {
    const state = seafarersGame(4, 1, 'sf-new-world-2025').state;
    expect(keysOf(projectSeafarers(state))).toEqual(keysOf(VIEW_KEYS).filter((key) => !['home', 'fog', 'tribe', 'cloth', 'wonders'].includes(key)));
    const worldHints = keysOf(HINT_KEYS).filter((key) => key !== 'clothVictims' && key !== 'robberChoice' && key !== 'wonders');
    expect(keysOf(hintsOf(state, 'p1'))).toEqual(worldHints);
    expect(keysOf(hintsOf(state, 'p2'))).toEqual(worldHints);
    for (const profileId of ['sf-new-shores-2025', 'sf-forgotten-tribe-2025']) {
      expect(applyCommand(emptySeafarersGame(4, 0, 'action', profileId), 'p1', { type: 'world.harbor', edge: 0 } as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_INVALID_COMMAND' } });
    }
  });

  // D7：只有卡坦奇觀有 wonders 投影與提示欄位，以及 wonder.* 指令；其他劇本的鍵集合與錯誤碼不變，module state 不多出 wonders。
  it('only The Wonders of Catan adds the wonders view and hint keys; elsewhere wonder.* keeps the unknown-command errors', () => {
    const wonders = emptySeafarersGame(3, 0, 'action', 'sf-wonders-of-catan-2025');
    expect(keysOf(projectSeafarers(wonders))).toEqual(keysOf(VIEW_KEYS).filter((key) => !['home', 'fog', 'tribe', 'cloth', 'world'].includes(key)));
    expect(keysOf(hintsOf(wonders, 'p1'))).toEqual(keysOf(HINT_KEYS).filter((key) => !['harborChoices', 'targets', 'board', 'clothVictims', 'robberChoice'].includes(key)));
    for (const profileId of ['sf-new-shores-2025', 'sf-four-islands-2025', 'sf-forgotten-tribe-2025', 'sf-cloth-for-catan-2025', 'sf-through-the-desert-2025', 'sf-new-world-2025']) {
      const state = emptySeafarersGame(profileId === 'sf-new-shores-2025' ? 4 : 3, 0, 'action', profileId);
      expect(keysOf(viewOf(state, 'p1')), profileId).not.toContain('wonders');
      expect(keysOf(hintsOf(state, 'p1')), profileId).not.toContain('wonders');
      expect(Object.keys(seafarersState(state)), profileId).not.toContain('wonders');
      for (const command of [{ type: 'wonder.choose', wonder: 'greatWall' }, { type: 'wonder.build' }]) {
        expect(applyCommand(state, 'p1', command as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_INVALID_COMMAND' } });
      }
      state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
      expect(applyCommand(state, 'p1', { type: 'wonder.build' } as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_PENDING_EFFECT' } });
    }
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
      citiesKnights: citiesKnightsModule.id,
      seafarersCitiesKnights: seafarersCitiesKnightsModule.id,
      tradersBarbarians: tradersBarbariansModule.id,
    };
    expect(ids).toEqual({
      seafarers: 'seafarers',
      explorersPirates: 'explorersPirates',
      citiesKnights: 'citiesKnights',
      seafarersCitiesKnights: 'seafarersCitiesKnights',
      tradersBarbarians: 'tradersBarbarians',
    });
  });
});
