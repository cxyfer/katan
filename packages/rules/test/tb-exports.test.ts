/**
 * bots 0.4.4（T&B 計畫 S0）依賴的 rules 匯出：各 part 的具名 view／hints 函式與
 * 型別、組合層型別、frame kind、part 對照表與規則常數。模擬對局在多個步驟比對
 * 引擎實際投影與具名函式的輸出，並確認匯出常數與 view 內的值一致。
 */

import { describe, expect, it } from 'vitest';
import {
  BA_CARD_COST,
  BA_DECK,
  BOOST_MP,
  BRIDGE_COST,
  BRIDGE_GOLD,
  CONQUER_AT,
  FISH_COSTS,
  FISH_LIMIT,
  FISH_SUPPLY,
  GOLD_PER_RESOURCE,
  PURCHASES_PER_TURN,
  STRONGEST_PORTS_MINIMUM,
  STRONGEST_PORTS_POINTS,
  TB_FRAME_KINDS,
  TB_PENDING_COMMANDS,
  TB_SCENARIO_PART_IDS,
  TB_VARIANT_PART_IDS,
  TRADERS_BARBARIANS,
  UPGRADE_COSTS,
  WAGON_LEVELS,
  WAGON_SUPPLY,
  actionHints,
  projectGame,
  type ModuleHintsMap,
  type ModuleViewMap,
  type TradersBarbariansHints,
  type TradersBarbariansView,
} from '../src/index.ts';
import { requireProfile, SCENARIO_IDS, VARIANT_IDS } from '../src/profiles.ts';
import { barbarianAttackHints, barbarianAttackPart, barbarianAttackView } from '../src/modules/tradersBarbarians/barbarians/index.ts';
import { coinsHints, coinsPart, coinsView } from '../src/modules/tradersBarbarians/coins/index.ts';
import { fishingHints, fishingPart, fishingView } from '../src/modules/tradersBarbarians/fishing/index.ts';
import {
  activeParts,
  tradersBarbariansHints,
  tradersBarbariansModule,
  tradersBarbariansView,
} from '../src/modules/tradersBarbarians/index.ts';
import { riversHints, riversPart, riversView } from '../src/modules/tradersBarbarians/rivers/index.ts';
import { tradersHints, tradersPart, tradersView } from '../src/modules/tradersBarbarians/traders/index.ts';
import { trainsHints, trainsPart, trainsView } from '../src/modules/tradersBarbarians/trains/index.ts';
import { friendlyRobberPart } from '../src/modules/tradersBarbarians/variants/friendlyRobber.ts';
import { harborsPart, harborsView } from '../src/modules/tradersBarbarians/variants/harbors.ts';
import type { GameState } from '../src/types.ts';
import { simulateGame, type SimulationBot } from './simulate.ts';
import { barbarianBot, fishingBot, riversBot, tradersBot, trainsBot } from './tb-bots.ts';
import { SIMULATION_TIMEOUT } from './tb-helpers.ts';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// 兩張 map 都以組合層型別登錄 T&B。
const viewEntry: Equal<ModuleViewMap['tradersBarbarians'], TradersBarbariansView> = true;
const hintsEntry: Equal<ModuleHintsMap['tradersBarbarians'], TradersBarbariansHints> = true;
void viewEntry;
void hintsEntry;

/** 8 個可玩的 T&B profile、預期的 part 順序與模擬用的 bot。 */
const PROFILES: [profileId: string, parts: string[], bot: SimulationBot | undefined][] = [
  ['tb-friendly-robber-2025', ['friendly-robber'], undefined],
  ['tb-harbors-2025', ['harbors'], undefined],
  ['tb-friendly-robber-harbors-2025', ['friendly-robber', 'harbors'], undefined],
  ['tb-fishing-2025', ['tb-fishing'], fishingBot],
  ['tb-rivers-2025', ['tb-coins', 'tb-rivers'], riversBot],
  ['tb-merchant-trains-2025', ['tb-merchant-trains'], trainsBot],
  ['tb-barbarian-attack-2025', ['tb-coins', 'tb-barbarian-attack'], barbarianBot],
  ['tb-traders-barbarians-2025', ['tb-coins', 'tb-traders-barbarians'], tradersBot],
];

/** 由匯出的對照表推出 profile 的 part；未知鍵查不到就略過。 */
function partIdsOf(profileId: string): string[] {
  const profile = requireProfile(profileId);
  return [
    ...(profile.scenario ? TB_SCENARIO_PART_IDS[profile.scenario] ?? [] : []),
    ...profile.variants.flatMap((variant) => TB_VARIANT_PART_IDS[variant] ?? []),
  ];
}

/** 跑一段決定性的對局，每隔幾個 bot 回合取一個狀態。 */
function sampledStates(profileId: string, bot: SimulationBot | undefined): GameState[] {
  const states: GameState[] = [];
  let calls = 0;
  const recorder: SimulationBot = {
    pending(state, rng) {
      calls += 1;
      if (calls % 10 === 0) states.push(state);
      return bot?.pending?.(state, rng) ?? null;
    },
    actions: (state, actor, step) => bot?.actions?.(state, actor, step) ?? [],
  };
  simulateGame(41, 1500, { players: 4, profileId, mode: 'variable', bot: recorder });
  return states;
}

function moduleView(state: GameState, viewerId: string): TradersBarbariansView {
  return (projectGame(state, viewerId).modules as Partial<ModuleViewMap>).tradersBarbarians!;
}

function moduleHints(state: GameState, playerId: string): TradersBarbariansHints {
  return (actionHints(state, playerId).modules as Partial<ModuleHintsMap>).tradersBarbarians!;
}

describe('traders & barbarians exports (bots plan S0)', () => {
  it('the module and every part use the exported named functions', () => {
    expect(tradersBarbariansModule.id).toBe(TRADERS_BARBARIANS);
    expect(TRADERS_BARBARIANS).toBe('tradersBarbarians');
    expect(tradersBarbariansModule.project).toBe(tradersBarbariansView);
    expect(tradersBarbariansModule.actionHints).toBe(tradersBarbariansHints);
    const named: [part: { project?: unknown; actionHints?: unknown }, view: unknown, hints: unknown][] = [
      [coinsPart, coinsView, coinsHints],
      [fishingPart, fishingView, fishingHints],
      [riversPart, riversView, riversHints],
      [trainsPart, trainsView, trainsHints],
      [barbarianAttackPart, barbarianAttackView, barbarianAttackHints],
      [tradersPart, tradersView, tradersHints],
      [harborsPart, harborsView, undefined],
      [friendlyRobberPart, undefined, undefined],
    ];
    for (const [part, view, hints] of named) {
      expect(part.project).toBe(view);
      expect(part.actionHints).toBe(hints);
    }
  });

  it('the part tables match each profile and the composed parts', () => {
    for (const [profileId, parts] of PROFILES) {
      expect(partIdsOf(profileId)).toEqual(parts);
      expect(activeParts(requireProfile(profileId)).map((part) => part.id)).toEqual(parts);
    }
    for (const scenario of SCENARIO_IDS.filter((id) => id.startsWith('tb-'))) expect(TB_SCENARIO_PART_IDS[scenario]).toBeDefined();
    expect(TB_SCENARIO_PART_IDS['new-shores']).toBeUndefined();
    // event-cards 沒有 part（profile 未實作），查不到才能讓 bots 判為不支援。
    expect(VARIANT_IDS).toContain('event-cards');
    expect(TB_VARIANT_PART_IDS['event-cards']).toBeUndefined();
    expect(Object.keys(TB_VARIANT_PART_IDS).sort()).toEqual(['friendly-robber', 'harbors']);
    expect(Object.isFrozen(TB_SCENARIO_PART_IDS) && Object.isFrozen(TB_VARIANT_PART_IDS)).toBe(true);
  });

  it('TB_FRAME_KINDS lists exactly the frames the parts own', () => {
    for (const [step, kind] of Object.entries(TB_FRAME_KINDS)) expect(kind).toBe(`tradersBarbarians.${step}`);
    const owned = [fishingPart, trainsPart, barbarianAttackPart, tradersPart].flatMap((part) => part.frames ?? []);
    expect(Object.values(TB_FRAME_KINDS).sort()).toEqual([...owned].sort());
  });

  it('TB_PENDING_COMMANDS is the module pendingCommands', () => {
    const owned = [fishingPart, trainsPart, barbarianAttackPart, tradersPart, coinsPart, riversPart].flatMap((part) => part.pendingCommands ?? []);
    expect([...TB_PENDING_COMMANDS].sort()).toEqual([...new Set(owned)].sort());
    expect(TB_PENDING_COMMANDS.length).toBe(15);
    expect(tradersBarbariansModule.pendingCommands).toEqual([...TB_PENDING_COMMANDS]);
  });

  it('the rule constants keep their values', () => {
    expect(FISH_COSTS).toEqual({ removeRobber: 2, steal: 3, takeResource: 4, road: 5, devCard: 7 });
    expect([FISH_LIMIT, [...FISH_SUPPLY]]).toEqual([7, [11, 10, 8]]);
    expect([GOLD_PER_RESOURCE, PURCHASES_PER_TURN, BRIDGE_GOLD, WAGON_SUPPLY, CONQUER_AT, BOOST_MP]).toEqual([2, 2, 3, 22, 3, 2]);
    expect(BRIDGE_COST).toEqual({ brick: 2, lumber: 1 });
    expect(BA_CARD_COST).toEqual({ wool: 1, grain: 1, ore: 1 });
    expect(BA_DECK).toHaveLength(26);
    expect(WAGON_LEVELS).toHaveLength(5);
    expect(UPGRADE_COSTS).toHaveLength(WAGON_LEVELS.length - 1);
    expect([STRONGEST_PORTS_POINTS, STRONGEST_PORTS_MINIMUM]).toEqual([2, 3]);
  });

  for (const [profileId, parts, bot] of PROFILES) {
    it(`${profileId}: projections and hints agree with the named functions along a simulated game`, () => {
      const profile = requireProfile(profileId);
      const viewParts = parts.filter((id) => id !== 'friendly-robber').sort();
      const hintParts = parts.filter((id) => id !== 'friendly-robber' && id !== 'harbors').sort();
      const states = sampledStates(profileId, bot);
      expect(states.length).toBeGreaterThan(10);
      for (const state of states) {
        for (const { id } of state.players) {
          const view = moduleView(state, id);
          expect(view).toEqual(tradersBarbariansView(state, id, { profile }));
          expect(Object.keys(view).sort()).toEqual(viewParts);
          if (view['tb-coins']) {
            expect(view['tb-coins']).toEqual(coinsView(state, id));
            expect(view['tb-coins'].goldPerResource).toBe(GOLD_PER_RESOURCE);
            expect(view['tb-coins'].purchasesLeft).toBeLessThanOrEqual(PURCHASES_PER_TURN);
          }
          if (view['tb-fishing']) {
            expect(view['tb-fishing']).toEqual(fishingView(state, id));
            expect([view['tb-fishing'].limit, view['tb-fishing'].costs]).toEqual([FISH_LIMIT, FISH_COSTS]);
          }
          if (view['tb-rivers']) {
            expect(view['tb-rivers']).toEqual(riversView(state));
            expect(view['tb-rivers'].bridgeCost).toEqual(BRIDGE_COST);
          }
          if (view['tb-merchant-trains']) {
            expect(view['tb-merchant-trains']).toEqual(trainsView(state));
            expect(view['tb-merchant-trains'].supply + view['tb-merchant-trains'].wagons.length).toBe(WAGON_SUPPLY);
          }
          if (view['tb-barbarian-attack']) {
            expect(view['tb-barbarian-attack']).toEqual(barbarianAttackView(state));
            const { deckCount, discard } = view['tb-barbarian-attack'];
            expect(deckCount + discard.length).toBe(BA_DECK.length);
          }
          if (view['tb-traders-barbarians']) {
            expect(view['tb-traders-barbarians']).toEqual(tradersView(state));
            expect([view['tb-traders-barbarians'].levels, view['tb-traders-barbarians'].upgradeCosts]).toEqual([WAGON_LEVELS, UPGRADE_COSTS]);
          }
          if (view.harbors) {
            expect(view.harbors).toEqual(harborsView(state));
            expect(view.harbors.minimum).toBe(STRONGEST_PORTS_MINIMUM);
          }

          const hints = moduleHints(state, id);
          const rootKeys = ['board', 'targets', ...(parts.includes('friendly-robber') ? ['robberHexes'] : [])];
          expect(Object.keys(hints).sort()).toEqual([...hintParts, ...rootKeys].sort());
          if (hints['tb-coins']) expect(hints['tb-coins']).toEqual(coinsHints(state, id));
          if (hints['tb-rivers']) expect(hints['tb-rivers']).toEqual(riversHints(state, id));
          if (hints['tb-merchant-trains']) expect(hints['tb-merchant-trains']).toEqual(trainsHints(state, id));
          if (hints['tb-barbarian-attack']) expect(hints['tb-barbarian-attack']).toEqual(barbarianAttackHints(state, id));
          if (hints['tb-traders-barbarians']) expect(hints['tb-traders-barbarians']).toEqual(tradersHints(state, id));
          if (hints['tb-fishing']) {
            // 道路目標需要引擎的合法性檢查（ctx.rules），其餘欄位不依賴它。
            const { targets: _engine, ...rest } = hints['tb-fishing'];
            const { targets: _plain, ...plain } = fishingHints(state, id, { profile })!;
            expect(rest).toEqual(plain);
          }
          const partBoards = parts.filter((part) => hintParts.includes(part)).map((part) => (hints[part as keyof TradersBarbariansHints] as { board?: unknown } | null)?.board ?? null);
          expect(hints.board).toEqual(partBoards.find((board) => board !== null) ?? null);
        }
      }
    }, SIMULATION_TIMEOUT);
  }
});
