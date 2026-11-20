/**
 * T&B 的 `supports`、part 組合與模組合約（T&B 計畫 §3.2–§3.3、§4.4；S2）。
 *
 * - 4 個 `tb-event-cards*` 的 `supports` 一律回 false，即使所有 part 都開放：直接呼叫 `supports`，因為它們本來就是
 *   `enabled:false`，`botsCanPlay` 擋不擋都看不出來。
 * - S2 的 `TB_READY_PARTS` 是空集合：8 個 profile 都不能讓 Bot 入座。開放清單以注入的集合測試，不改常數：把某個 part
 *   移出時，只有含它的 profile 關閉。
 */

import { describe, expect, it } from 'vitest';
import {
  getProfile,
  getRulesModule,
  PROFILES,
  TB_PENDING_COMMANDS,
  TB_SCENARIO_PART_IDS,
  TB_VARIANT_PART_IDS,
  type GameView,
  type ProfileDefinition,
  type PublicModulePendingView,
} from '@catan/rules';
import { BOT_MODULES, botCommandLimit, botLevelsFor, botModulesOf, botResponseCommands, botsCanPlay } from '../src/index.ts';
import type { BoardModel } from '../src/board.ts';
import type { Plan } from '../src/economy.ts';
import type { BotCommand, TurnContext } from '../src/modules/types.ts';
import {
  createTradersBarbariansModule,
  TB_COMMANDS_PER_WINDOW,
  TB_PACING,
  TB_RESPONSE_COMMANDS,
  tradersBarbariansBotModule,
} from '../src/modules/tradersBarbarians/index.ts';
import type { TbPartBot } from '../src/modules/tradersBarbarians/part.ts';
import { TB_PART_BOTS, TB_READY_PARTS, tbPartsOf, tbSupports } from '../src/modules/tradersBarbarians/parts.ts';
import { TB_PART_IDS, tbPartIdsOf } from '../src/modules/tradersBarbarians/view.ts';
import { tradersBarbariansKit, TB_PART_KITS } from './modules/tradersBarbarians.ts';

/** 8 個開放（`enabled:true`）的 T&B profile 與各自的 part（rules 順序，`TB/index.ts:28-40`）。 */
const TB_PROFILES: Readonly<Record<string, readonly string[]>> = {
  'tb-friendly-robber-2025': ['friendly-robber'],
  'tb-harbors-2025': ['harbors'],
  'tb-friendly-robber-harbors-2025': ['friendly-robber', 'harbors'],
  'tb-fishing-2025': ['tb-fishing'],
  'tb-rivers-2025': ['tb-coins', 'tb-rivers'],
  'tb-merchant-trains-2025': ['tb-merchant-trains'],
  'tb-barbarian-attack-2025': ['tb-coins', 'tb-barbarian-attack'],
  'tb-traders-barbarians-2025': ['tb-coins', 'tb-traders-barbarians'],
};

const EVENT_CARD_PROFILES = [
  'tb-event-cards-2025',
  'tb-event-cards-friendly-robber-2025',
  'tb-event-cards-harbors-2025',
  'tb-event-cards-friendly-robber-harbors-2025',
] as const;

const ALL_PARTS: ReadonlySet<string> = new Set(Object.values(TB_PART_IDS));

const profile = (id: string): ProfileDefinition => getProfile(id)!;
const tbProfiles = (): ProfileDefinition[] => PROFILES.filter((candidate) => candidate.ruleModules.includes('tradersBarbarians'));

describe('T&B supports (§3.3)', () => {
  it('knows every T&B profile and every rules part', () => {
    expect(tbProfiles().map((candidate) => candidate.id).sort()).toEqual(
      [...Object.keys(TB_PROFILES), ...EVENT_CARD_PROFILES].sort(),
    );
    for (const [id, parts] of Object.entries(TB_PROFILES)) {
      expect(profile(id).enabled, id).toBe(true);
      expect(tbPartIdsOf(profile(id)), id).toEqual(parts);
      expect(tbPartsOf(profile(id)).map((part) => part.id), id).toEqual(parts);
    }
    const ruleParts = new Set([...Object.values(TB_SCENARIO_PART_IDS), ...Object.values(TB_VARIANT_PART_IDS)].flat());
    expect([...TB_PART_BOTS.keys()].sort()).toEqual([...ruleParts].sort());
    expect([...TB_PART_KITS.keys()].sort()).toEqual([...ruleParts].sort());
    expect([...ALL_PARTS].sort()).toEqual([...ruleParts].sort());
  });

  it('opens no T&B profile in S2: the ready set is empty', () => {
    expect(TB_READY_PARTS.size).toBe(0);
    for (const candidate of tbProfiles()) {
      expect(tradersBarbariansBotModule.supports!(candidate), candidate.id).toBe(false);
      expect(botsCanPlay(candidate), candidate.id).toBe(false);
      expect(botLevelsFor(candidate), candidate.id).toEqual([]);
      // 模組本身一直是註冊狀態：保底與測試工具照樣拿得到它。
      expect(botModulesOf(candidate).map((module) => module.id), candidate.id).toEqual(['tradersBarbarians']);
    }
  });

  it('never supports the event-card profiles, even with every part ready', () => {
    for (const id of EVENT_CARD_PROFILES) {
      expect(profile(id).enabled, id).toBe(false);
      // rules 的 activeParts 會把 event-cards 丟掉，只剩 FR、H；supports 讀原始 id，所以擋得下來。
      expect(tbSupports(profile(id), ALL_PARTS), id).toBe(false);
      expect(createTradersBarbariansModule(TB_PART_BOTS, ALL_PARTS).supports!(profile(id)), id).toBe(false);
    }
  });

  it('supports all eight playable profiles once every part is ready', () => {
    const module = createTradersBarbariansModule(TB_PART_BOTS, ALL_PARTS);
    for (const id of Object.keys(TB_PROFILES)) expect(module.supports!(profile(id)), id).toBe(true);
  });

  it('closes exactly the profiles that contain a part taken out of the ready set', () => {
    for (const missing of ALL_PARTS) {
      const ready = new Set([...ALL_PARTS].filter((id) => id !== missing));
      for (const [id, parts] of Object.entries(TB_PROFILES)) {
        expect(tbSupports(profile(id), ready), `${id} without ${missing}`).toBe(!parts.includes(missing));
      }
    }
    // 只開放一個 part：只有完全由它組成的 profile 打開（tb-coins 單獨沒有 profile）。
    expect(Object.keys(TB_PROFILES).filter((id) => tbSupports(profile(id), new Set(['friendly-robber'])))).toEqual([
      'tb-friendly-robber-2025',
    ]);
    expect(Object.keys(TB_PROFILES).filter((id) => tbSupports(profile(id), new Set(['tb-coins'])))).toEqual([]);
    expect(
      Object.keys(TB_PROFILES).filter((id) => tbSupports(profile(id), new Set(['tb-coins', 'tb-rivers', 'harbors']))),
    ).toEqual(['tb-harbors-2025', 'tb-rivers-2025']);
  });

  it('refuses unknown scenarios, unknown variants and profiles without any part', () => {
    const base = profile('tb-fishing-2025');
    expect(tbSupports({ ...base, scenario: 'tb-no-such-scenario' as ProfileDefinition['scenario'] }, ALL_PARTS)).toBe(false);
    expect(tbSupports({ ...base, variants: ['harbors', 'no-such-variant'] }, ALL_PARTS)).toBe(false);
    expect(tbSupports({ ...base, scenario: null, variants: [] }, ALL_PARTS)).toBe(false);
    expect(tbSupports({ ...base, variants: ['constructor'] }, ALL_PARTS)).toBe(false);
  });
});

describe('T&B module contract (§3.2, §4.4)', () => {
  it('is registered and answers only for its own id', () => {
    expect(BOT_MODULES.get('tradersBarbarians')).toBe(tradersBarbariansBotModule);
    expect(tradersBarbariansKit.id).toBe('tradersBarbarians');
  });

  it('lists the 15 rules pending commands as response commands', () => {
    const rules = getRulesModule('tradersBarbarians')!;
    expect(TB_RESPONSE_COMMANDS).toEqual(TB_PENDING_COMMANDS);
    expect([...TB_RESPONSE_COMMANDS].sort()).toEqual([...(rules.pendingCommands ?? [])].sort());
    expect(TB_RESPONSE_COMMANDS).toHaveLength(15);
    // 多數持有者可能不是行動者：`wagonPlace` 也要能由非行動者送出。
    expect(TB_RESPONSE_COMMANDS).toEqual(expect.arrayContaining(['tb.bidWagon', 'tb.assignWagon', 'tb.placeWagon']));
    expect([...(tradersBarbariansBotModule.responseCommands ?? [])].sort()).toEqual([...TB_PENDING_COMMANDS].sort());
    const responses = botResponseCommands(profile('tb-merchant-trains-2025'));
    for (const type of TB_PENDING_COMMANDS) expect(responses.has(type), type).toBe(true);
    expect([...(tradersBarbariansKit.responseCommands ?? [])].sort()).toEqual([...TB_PENDING_COMMANDS].sort());
  });

  it('paces every T&B command with its own tb.* key and keeps the window limit at 40', () => {
    const commands = Object.keys(getRulesModule('tradersBarbarians')!.commands ?? {});
    expect(Object.keys(TB_PACING).sort()).toEqual(commands.sort());
    expect(Object.keys(TB_PACING)).toHaveLength(24);
    expect(tradersBarbariansBotModule.pacing).toEqual(TB_PACING);
    expect(TB_PACING).toMatchObject({
      'tb.wagonStep': 450,
      'tb.wagonStop': 500,
      'tb.moveBarbarian': 1200,
      'tb.playKnight': 1100,
      'tb.buyResource': 800,
    });
    expect(TB_COMMANDS_PER_WINDOW).toBe(40);
    for (const id of Object.keys(TB_PROFILES)) expect(botCommandLimit(profile(id), 40), id).toBe(40);
  });

  it('exposes only the economy and trade hooks some part defines', () => {
    // 骨架以「鉤子存在」決定是否組合盤面掛點：沒有任何 part 定義的鉤子，模組上也沒有。
    const parts = [...TB_PART_BOTS.values()];
    const defined = (group: 'economy' | 'trade') => [...new Set(parts.flatMap((part) => Object.keys(part[group] ?? {})))].sort();
    expect(Object.keys(tradersBarbariansBotModule.economy ?? {}).sort()).toEqual(defined('economy'));
    expect(Object.keys(tradersBarbariansBotModule.trade ?? {}).sort()).toEqual(defined('trade'));
  });
});

// ---------------------------------------------------------------------------
// part 組合（注入假的 part 表）
// ---------------------------------------------------------------------------

const cmd = (type: string): BotCommand => ({ type }) as BotCommand;
/** 組合只讀 `view.profileId`（與 economy 的 `model.profile`）；其餘欄位用不到。 */
const turnFor = (profileId: string): TurnContext => ({ view: { profileId } as GameView }) as TurnContext;
const modelFor = (profileId: string): BoardModel => ({ profile: profile(profileId) }) as BoardModel;
const plan = { kind: 'tradersBarbarians.fake' } as unknown as Plan;
const frame: PublicModulePendingView = { kind: 'tradersBarbarians.fishSwap', module: 'tradersBarbarians', responders: ['bot1'], data: {} };

/** 以 profile 的 part 順序檢查組合：coins 在前（劇本的 part），接著是劇本本身。 */
function fakeTable(): Map<string, TbPartBot> {
  const coins: TbPartBot = {
    id: 'tb-coins',
    answerFrame: () => undefined,
    setup: () => null,
    preroll: () => [{ item: cmd('coins.preroll'), score: 1 }],
    actions: () => [{ item: cmd('coins.action'), score: 1 }],
    planStep: () => undefined,
    robberTargets: (_view, _self, targets) => targets.filter((hex) => hex !== 0),
    economy: {
      costs: () => ({ bridge: { brick: 2 }, shared: { ore: 1 } }),
      piecesLeft: () => ({ bridges: 3 }),
      scoreExtras: () => [{ kind: 'tradersBarbarians.coins' } as unknown as Plan],
      hexYield: () => undefined,
      discardLimit: (_model, base) => base + 2,
      awards: () => ({}),
    },
    trade: { goods: () => ({ gold: 4 }), goodValue: () => undefined },
    pacing: { 'tb.fake': 1, 'tb.wagonStep': 1 },
    responseCommands: ['tb.fake'],
  };
  const rivers: TbPartBot = {
    id: 'tb-rivers',
    answerFrame: () => cmd('rivers.frame'),
    setup: () => cmd('rivers.setup'),
    preroll: () => [{ item: cmd('rivers.preroll'), score: 2 }],
    actions: () => [{ item: cmd('rivers.action'), score: 2 }],
    planStep: () => cmd('rivers.plan'),
    robberTargets: () => {
      throw new Error('a broken part keeps the previous set');
    },
    economy: {
      costs: () => ({ shared: { wool: 9 } }),
      scoreExtras: () => [{ kind: 'tradersBarbarians.rivers' } as unknown as Plan],
      hexYield: () => ({ grain: 3 }),
      discardLimit: (_model, base) => base * 2,
      awards: () => ({ longestRoad: false }),
    },
    trade: { goods: () => ({ gold: 9, fish: 1 }), goodValue: (_turn, _good, amount) => amount / 2 },
  };
  return new Map([
    ['tb-coins', coins],
    ['tb-rivers', rivers],
  ]);
}

describe('T&B part composition (§3.2)', () => {
  const module = createTradersBarbariansModule(fakeTable(), ALL_PARTS);
  const rivers = 'tb-rivers-2025';
  const fishing = 'tb-fishing-2025';

  it('asks the active parts in rules order: first answer wins, candidates concatenate', () => {
    const turn = turnFor(rivers);
    expect(module.answerFrame!(turn, frame)).toEqual(cmd('rivers.frame'));
    // 不是 T&B 的 frame：不詢問任何 part。
    expect(module.answerFrame!(turn, { ...frame, kind: 'citiesKnights.pillage' })).toBeUndefined();
    // coins 的 null 先出現（歸我管、不送指令），rivers 不再被詢問。
    expect(module.setup!(turn)).toBeNull();
    expect(module.planStep!(turn, plan)).toEqual(cmd('rivers.plan'));
    expect(module.preroll!(turn).map((entry) => entry.item.type)).toEqual(['coins.preroll', 'rivers.preroll']);
    expect(module.actions!(turn).map((entry) => entry.item.type)).toEqual(['coins.action', 'rivers.action']);
    // fishing 的 part 不在這張表裡：沒有任何 part 回答。
    expect(module.setup!(turnFor(fishing))).toBeUndefined();
    expect(module.actions!(turnFor(fishing))).toEqual([]);
    expect(module.robberTargets!({ profileId: fishing } as GameView, 'bot1', [0, 1, 2])).toEqual([0, 1, 2]);
  });

  it('folds robber targets in order and skips a part that throws', () => {
    expect(module.robberTargets!({ profileId: rivers } as GameView, 'bot1', [0, 1, 2])).toEqual([1, 2]);
  });

  it('composes the economy hooks', () => {
    const economy = module.economy!;
    const model = modelFor(rivers);
    expect(economy.costs!(model)).toEqual({ bridge: { brick: 2 }, shared: { ore: 1 } });
    expect(economy.piecesLeft!(model)).toEqual({ bridges: 3 });
    expect(economy.scoreExtras!({ model } as never).map((entry) => entry.kind)).toEqual([
      'tradersBarbarians.coins',
      'tradersBarbarians.rivers',
    ]);
    expect(economy.hexYield!(model, 0, 0, false)).toEqual({ grain: 3 });
    expect(economy.discardLimit!(model, 7)).toBe(18);
    expect(economy.awards!(model)).toEqual({ longestRoad: false });
    // 沒有任何 part 關閉最長道路時維持開啟（省略即 true）。
    expect(economy.awards!(modelFor(fishing))).toEqual({});
    expect(economy.discardLimit!(modelFor(fishing), 7)).toBe(7);
  });

  it('merges trade goods (first part wins) and takes the first good value', () => {
    const trade = module.trade!;
    expect(trade.goods!({ profileId: rivers } as GameView, 'bot1')).toEqual({ gold: 4, fish: 1 });
    expect(trade.goodValue!(turnFor(rivers), 'gold', 4)).toBe(2);
    expect(trade.goodValue!(turnFor(fishing), 'gold', 4)).toBeUndefined();
  });

  it('keeps the §4.4 pacing over part pacing and adds part response commands', () => {
    expect(module.pacing).toMatchObject({ 'tb.fake': 1, 'tb.wagonStep': TB_PACING['tb.wagonStep'] });
    expect(module.responseCommands).toEqual([...TB_PENDING_COMMANDS, 'tb.fake']);
  });
});
