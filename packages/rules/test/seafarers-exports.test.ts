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
import { getProfile, requireProfile } from '../src/profiles.ts';
import { citiesKnightsModule } from '../src/modules/citiesKnights/index.ts';
import { explorersPiratesModule } from '../src/modules/explorersPirates/index.ts';
import { projectSeafarers, seafarersHints, seafarersModule } from '../src/modules/seafarers/index.ts';
import { seafarersState } from '../src/modules/seafarers/state.ts';
import { seafarersCitiesKnightsModule } from '../src/modules/seafarersCitiesKnights/index.ts';
import { tradersBarbariansModule } from '../src/modules/tradersBarbarians/index.ts';
import type { GameState } from '../src/types.ts';
import { applyCommand, moduleCommandTypesOf } from '../src/engine.ts';
import { act, expectRejected, forceTurn, newGame, scriptedRng } from './helpers.ts';
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
  pirateIslands: true,
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
  pirateLine: true,
  pirateGift: true,
  sevenSteal: true,
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
const HINT_KEYS_WITHOUT_TRIBE = Object.keys(HINT_KEYS).filter((key) => !['harborChoices', 'targets', 'board', 'clothVictims', 'robberChoice', 'wonders', 'pirateLine', 'pirateGift', 'sevenSteal'].includes(key)).sort();
/** `home` 只在排除 home 島的劇本（四島群島、新世界）的設置結束後出現，New Shores 不帶。 */
const VIEW_KEYS_WITHOUT_HOME = Object.keys(VIEW_KEYS).filter((key) => key !== 'home' && key !== 'fog' && key !== 'tribe' && key !== 'cloth' && key !== 'world' && key !== 'wonders' && key !== 'pirateIslands').sort();
/** `fog` 只在未知海域劇本、`tribe` 只在世外部落、`cloth` 只在布匹產地、`world` 只在新世界、`wonders` 只在卡坦奇觀、`pirateIslands` 只在海盜巢穴出現。 */

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
    expect(keysOf(projectSeafarers(state))).toEqual(keysOf(VIEW_KEYS).filter((key) => key !== 'home' && key !== 'tribe' && key !== 'cloth' && key !== 'world' && key !== 'wonders' && key !== 'pirateIslands'));
    expect(viewOf(state, 'p2').fog).toHaveLength(12);
  });

  it('a home-island scenario adds `home` once setup has recorded it', () => {
    const state = emptySeafarersGame(4, 0, 'action', 'sf-four-islands-2025');
    expect(keysOf(projectSeafarers(state))).toEqual(VIEW_KEYS_WITHOUT_HOME);
    seafarersState(state).home = { p1: [2], p2: [3], p3: [], p4: [5, 4] };
    expect(keysOf(projectSeafarers(state))).toEqual(keysOf(VIEW_KEYS).filter((key) => key !== 'fog' && key !== 'cloth' && key !== 'tribe' && key !== 'world' && key !== 'wonders' && key !== 'pirateIslands'));
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
    expect(keysOf(hintsOf(tribe, 'p1'))).toEqual(keysOf(HINT_KEYS).filter((key) => key !== 'clothVictims' && key !== 'robberChoice' && !['wonders', 'pirateLine', 'pirateGift', 'sevenSteal'].includes(key)));
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
    expect(keysOf(hintsOf(cloth, 'p1'))).toEqual(keysOf(HINT_KEYS).filter((key) => !['harborChoices', 'targets', 'board', 'robberChoice', 'wonders', 'pirateLine', 'pirateGift', 'sevenSteal'].includes(key)));
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
    expect(keysOf(projectSeafarers(state))).toEqual(keysOf(VIEW_KEYS).filter((key) => !['home', 'fog', 'tribe', 'cloth', 'wonders', 'pirateIslands'].includes(key)));
    const worldHints = keysOf(HINT_KEYS).filter((key) => key !== 'clothVictims' && key !== 'robberChoice' && !['wonders', 'pirateLine', 'pirateGift', 'sevenSteal'].includes(key));
    expect(keysOf(hintsOf(state, 'p1'))).toEqual(worldHints);
    expect(keysOf(hintsOf(state, 'p2'))).toEqual(worldHints);
    for (const profileId of ['sf-new-shores-2025', 'sf-forgotten-tribe-2025']) {
      expect(applyCommand(emptySeafarersGame(4, 0, 'action', profileId), 'p1', { type: 'world.harbor', edge: 0 } as never, scriptedRng([]))).toMatchObject({ ok: false, error: { code: 'E_INVALID_COMMAND' } });
    }
  });

  // D7：只有卡坦奇觀有 wonders 投影與提示欄位，以及 wonder.* 指令；其他劇本的鍵集合與錯誤碼不變，module state 不多出 wonders。
  // D7：海盜巢穴的狀態、提示與船線限制只出現在海盜巢穴（其 profile 未啟用，但引擎可建局）。
  it('only The Pirate Islands adds pirateIslands to the view and pirateLine to the hints; no other scenario has them', () => {
    const pirate = emptySeafarersGame(3, 0, 'action', 'sf-pirate-islands-2025');
    expect(keysOf(projectSeafarers(pirate))).toContain('pirateIslands');
    expect(keysOf(hintsOf(pirate, 'p1'))).toContain('pirateLine');
    for (const profileId of ['sf-new-shores-2025', 'sf-four-islands-2025', 'sf-fog-islands-2025', 'sf-forgotten-tribe-2025', 'sf-cloth-for-catan-2025', 'sf-through-the-desert-2025', 'sf-new-world-2025', 'sf-wonders-of-catan-2025']) {
      const state = emptySeafarersGame(profileId === 'sf-new-shores-2025' ? 4 : 3, 0, 'action', profileId);
      expect(keysOf(projectSeafarers(state)), profileId).not.toContain('pirateIslands');
      expect(keysOf(hintsOf(state, 'p1')), profileId).not.toContain('pirateLine');
      expect(Object.keys(seafarersState(state)), profileId).not.toContain('pirateIslands');
      expect(keysOf(hintsOf(state, 'p1')), profileId).not.toContain('pirateGift');
      expect(keysOf(hintsOf(state, 'p1')), profileId).not.toContain('sevenSteal');
    }
  });

  // D7（S7b）：巡弋海盜、攻擊與 7 的偷牌只在海盜巢穴；其他八個劇本的海盜不動、7 照舊、新指令是未知指令。
  it('only The Pirate Islands cruises the pirate, attacks and lets a 7 steal; the other eight scenarios are unchanged', () => {
    const others: [string, 3 | 4][] = [['sf-new-shores-2025', 4], ['sf-four-islands-2025', 3], ['sf-fog-islands-2025', 3], ['sf-forgotten-tribe-2025', 3], ['sf-cloth-for-catan-2025', 3], ['sf-through-the-desert-2025', 3], ['sf-new-world-2025', 3], ['sf-wonders-of-catan-2025', 3]];
    for (const [profileId, players] of others) {
      const state = emptySeafarersGame(players, 0, 'preroll', profileId);
      const pirate = state.board.pirate;
      // 非 7：海盜不動、沒有巡弋或攻擊事件、沒有 frame、log 沒有新的事件種類。
      const normal = act(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3]));
      expect(normal.state.board.pirate, profileId).toBe(pirate);
      const kinds = normal.state.log.map((event) => event.type);
      for (const type of ['pirate.cruised', 'pirate.attacked', 'pirate.gifted', 'seven.stole', 'seven.stealSkipped']) expect(kinds, `${profileId} ${type}`).not.toContain(type);
      // 7：照舊（移強盜或該劇本自己的步驟），不會出現這個劇本的偷牌 frame。
      const seven = act(emptySeafarersGame(players, 0, 'preroll', profileId), 'p1', { type: 'turn.roll' }, scriptedRng([3, 2]));
      expect(seven.state.pending?.kind, profileId).not.toBe('seafarers.sevenSteal');
      expect(seven.state.pending?.kind, profileId).not.toBe('seafarers.pirateGift');
      expect(seven.state.pending?.kind, profileId).not.toBe('seafarers.pirateResume');
      expect(seven.state.board.pirate, profileId).toBe(pirate);
      // 新指令在其他劇本是未知指令（沒有 frame），有 frame 時被一般規則擋下；模組狀態與錯誤碼都沒有新增。
      const idle = emptySeafarersGame(players, 0, 'action', profileId);
      expectRejected(idle, 'p1', { type: 'pirate.gift', resource: 'ore' } as never, 'E_INVALID_COMMAND');
      expectRejected(idle, 'p1', { type: 'seven.steal', victim: null } as never, 'E_INVALID_COMMAND');
      const busy = emptySeafarersGame(players, 0, 'action', profileId);
      busy.pending = { kind: 'yearOfPlenty', actor: 'p1', remaining: 2 };
      expectRejected(busy, 'p1', { type: 'pirate.gift', resource: 'ore' } as never, 'E_PENDING_EFFECT');
      expectRejected(busy, 'p1', { type: 'seven.steal', victim: null } as never, 'E_PENDING_EFFECT');
    }
  });

  // D7（S7b，審查 P2）：sf-2025.2 的兩個 New Shores profile 不列出、也不放行海盜巢穴的兩個指令；
  // 回應與沒有 Seafarers 模組的 base profile 完全一致（含待答狀態時的 E_PENDING_EFFECT 參數）。
  it('the sf-2025.2 profiles do not register pirate.gift or seven.steal and answer them exactly like a base game', () => {
    const base = (pending: boolean) => {
      const { state } = newGame({ players: 4 });
      forceTurn(state, 0, 'action');
      if (pending) state.pending = { kind: 'yearOfPlenty', actor: 'p1', remaining: 2 };
      return state;
    };
    const pirate = emptySeafarersGame(3, 0, 'action', 'sf-pirate-islands-2025');
    expect(moduleCommandTypesOf(pirate)).toEqual(expect.arrayContaining(['pirate.gift', 'seven.steal']));
    for (const players of [4, 5] as const) {
      const sample = emptySeafarersGame(players, 0, 'action');
      expect(getProfile(sample.profileId)!.ruleVersion).toBe('sf-2025.2');
      expect(moduleCommandTypesOf(sample)).not.toContain('pirate.gift');
      expect(moduleCommandTypesOf(sample)).not.toContain('seven.steal');
      for (const command of [{ type: 'pirate.gift', resource: 'ore' }, { type: 'seven.steal', victim: null }]) {
        for (const pending of [false, true]) {
          const sea = emptySeafarersGame(players, 0, 'action');
          if (pending) sea.pending = { kind: 'yearOfPlenty', actor: 'p1', remaining: 2 };
          const mine = applyCommand(sea, 'p1', command as never, scriptedRng([]));
          const reference = applyCommand(base(pending), 'p1', command as never, scriptedRng([]));
          expect(mine.ok).toBe(false);
          expect(mine).toEqual(reference);
        }
      }
    }
  });

  it('only The Wonders of Catan adds the wonders view and hint keys; elsewhere wonder.* keeps the unknown-command errors', () => {
    const wonders = emptySeafarersGame(3, 0, 'action', 'sf-wonders-of-catan-2025');
    expect(keysOf(projectSeafarers(wonders))).toEqual(keysOf(VIEW_KEYS).filter((key) => !['home', 'fog', 'tribe', 'cloth', 'world', 'pirateIslands'].includes(key)));
    expect(keysOf(hintsOf(wonders, 'p1'))).toEqual(keysOf(HINT_KEYS).filter((key) => !['harborChoices', 'targets', 'board', 'clothVictims', 'robberChoice', 'pirateLine', 'pirateGift', 'sevenSteal'].includes(key)));
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
