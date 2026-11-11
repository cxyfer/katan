/**
 * SF+CK 組合層的 I9 固定盤面與 `robberTargets` 真值表（SF+CK 計畫 §4.2、§4.3、§6.3）。
 *
 * - `supports`：三個模組都要註冊，而且組合層的 `supports` 是唯一的開關（SFCK-G 才開放）。
 * - `targets.ts` 的單元測試：只依 hint `bandit` 收窄，不 throw、不改輸入。
 * - 真值表：3、4、6 人地圖 × 三種 `bandit`，fold 的集合等於 rules 的合法集合（實測 `pending.moveRobber`，
 *   不手算），而且非空。
 * - F1–F11 固定盤面：保底、standard、easy（兩個種子）送出的指令都被 `applyCommand` 接受。探查腳本已不存在，
 *   盤面由 `packages/rules/test/sfck-helpers.ts` 與 rules 的 R-COMB 案例重建；編號沿用計畫 §4.3：
 *   F1 追擊海盜、F2 追擊強盜、F3 首攻後擲出 7、F4 首攻前含 commodity 的棄牌、F5 Road Building 只剩船位或道路用完、
 *   F6 海盜與強盜偷牌（只有 commodity 的手牌）、F7a／F7b 金礦 frame 接著 aqueduct、F8／F8c 騎士釘船與擋船、
 *   F9 merchant 不放金礦、F10 Diplomacy 重建船、F11 全海路口不能招募。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  getProfile,
  seededRng,
  topologyOf,
  type Command,
  type GameState,
  type GameView,
  type ProfileDefinition,
} from '@catan/rules';
import {
  actCk,
  addKnight,
  edgeBetween,
  giveCommodities,
  handCards,
  moduleFrame,
  playCard,
  rollRng,
  setImprovement,
  SCIENCE,
  TRADE,
} from '../../rules/test/ck-helpers.ts';
import { give, setHand } from '../../rules/test/helpers.ts';
import { corner, hex, settle, ship } from '../../rules/test/seafarers-helpers.ts';
import { afterFirstAttack, emptySfckGame } from '../../rules/test/sfck-helpers.ts';
import { fallbackDecision, fallbackPolicy } from '../src/fallback.ts';
import { BOT_MODULES, botModulesOf, botsCanPlay } from '../src/index.ts';
import { SFCK_BOTS_RELEASED, seafarersCitiesKnightsBotModule } from '../src/modules/seafarersCitiesKnights/index.ts';
import { sfckRobberTargets } from '../src/modules/seafarersCitiesKnights/targets.ts';
import { SEAFARERS_CITIES_KNIGHTS, type SfckBandit } from '../src/modules/seafarersCitiesKnights/view.ts';
import type { BanditTarget, BotModule } from '../src/modules/types.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotCommand, BotContext, BotLevel, BotPolicy } from '../src/types.ts';
import { viewOf } from './ck-fixtures.ts';

const COMBINED_IDS = ['sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025'] as const;
const combinedProfile = (id: string = COMBINED_IDS[0]): ProfileDefinition => getProfile(id)!;

/** 組合 profile 的三個模組，依 `ruleModules` 順序：sfck、sf、ck。 */
const MODULES = botModulesOf(combinedProfile());
/** 沒有組合層、只有 sf 與 ck：用來證明「沒有 SFCK 的收窄」時，base 的選擇會被 rules 拒絕。 */
const WITHOUT_SFCK = MODULES.filter((module) => module.id !== SEAFARERS_CITIES_KNIGHTS);

const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 1): BotContext => ({
  selfId,
  level,
  seed,
  offerPhases: {},
});

/** 保底，加上 standard 與 easy（兩個種子）；第一項（保底）的答案是「第一個合法選項」的基準。 */
const POLICIES: readonly (readonly [string, BotPolicy, BotLevel, number])[] = [
  ['fallback', fallbackPolicy, 'standard', 1],
  ['standard', createBotPolicy('standard'), 'standard', 1],
  ['easy#1', createBotPolicy('easy'), 'easy', 1],
  ['easy#2', createBotPolicy('easy'), 'easy', 2],
];

function expectAccepted(state: GameState, actor: string, command: BotCommand | null | undefined): GameState {
  expect(command, `${actor} has a command`).not.toBeNull();
  expect(command, `${actor} has a command`).not.toBeUndefined();
  const outcome = applyCommand(state, actor, command as Command, seededRng(1));
  expect(outcome.ok, `${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
  return outcome.ok ? outcome.state : state;
}

/** 被拒絕時回傳錯誤碼與參數；被接受就讓測試失敗。 */
function rejection(state: GameState, actor: string, command: BotCommand | null): { code: string; params: unknown } {
  expect(command).not.toBeNull();
  const outcome = applyCommand(state, actor, command as Command, seededRng(1));
  expect(outcome.ok, `${JSON.stringify(command)} should be rejected`).toBe(false);
  return outcome.ok ? { code: 'accepted', params: undefined } : { code: outcome.error.code, params: outcome.error.params };
}

/** 每種策略在這個盤面上都送出被引擎接受的指令；回傳保底的指令（第一個合法選項）。 */
function expectEveryPolicyAnswers(state: GameState, actor: string): BotCommand {
  const view = viewOf(state, actor);
  const answers = POLICIES.map(([name, policy, level, seed]) => {
    const command = policy.decide(view, ctxFor(actor, level, seed));
    expect(command, `${name} must not stall`).not.toBeNull();
    expectAccepted(state, actor, command);
    return command!;
  });
  return answers[0]!;
}

/** 其他座位此刻都沒有事可做：保底與策略都回 null。 */
function expectOthersWait(state: GameState, owners: readonly string[]): void {
  for (const other of state.players.map((candidate) => candidate.id).filter((id) => !owners.includes(id))) {
    const view = viewOf(state, other);
    for (const [name, policy, level, seed] of POLICIES) {
      expect(policy.decide(view, ctxFor(other, level, seed)), `${other} ${name}`).toBeNull();
    }
  }
}

// ---------------------------------------------------------------------------
// supports
// ---------------------------------------------------------------------------

describe('SF+CK Bot module registration', () => {
  it('is registered, runs first in the combined profiles, and leaves every other hook to its parts', () => {
    expect(BOT_MODULES.get(SEAFARERS_CITIES_KNIGHTS)).toBe(seafarersCitiesKnightsBotModule);
    for (const id of COMBINED_IDS) {
      expect(botModulesOf(combinedProfile(id)).map((module) => module.id), id).toEqual([
        'seafarersCitiesKnights',
        'seafarers',
        'citiesKnights',
      ]);
    }
    // 組合層只有 robberTargets、supports 與 pacing：frame、經濟、策略都屬於 base、SF 或 C&K。
    const keys = Object.keys(seafarersCitiesKnightsBotModule).sort();
    expect(keys).toEqual(['id', 'pacing', 'robberTargets', 'supports']);
  });

  it('opens a combined profile only when its own supports says so', () => {
    for (const id of COMBINED_IDS) {
      const profile = combinedProfile(id);
      // 部件模組都支援這個 profile；組合層的 `supports` 是唯一的開關（SFCK-G 才改變）。
      expect(BOT_MODULES.get('seafarers')!.supports!(profile), `${id} seafarers`).toBe(true);
      expect(BOT_MODULES.get('citiesKnights')!.supports!(profile), `${id} citiesKnights`).toBe(true);
      expect(seafarersCitiesKnightsBotModule.supports!(profile), `${id} sfck`).toBe(SFCK_BOTS_RELEASED);
      expect(botsCanPlay(profile), id).toBe(SFCK_BOTS_RELEASED);
    }
  });

  it.each(['seafarersCitiesKnights', 'seafarers', 'citiesKnights'])(
    'refuses a profile that lacks the %s Bot module, whatever the others say',
    (missing) => {
      for (const id of COMBINED_IDS) {
        const base = combinedProfile(id);
        // 缺一個：該位置換成沒有人註冊的 id；其餘兩個都有註冊。
        const ruleModules = base.ruleModules.map((module) => (module === missing ? `${missing}-unregistered` : module));
        expect(botsCanPlay({ ...base, ruleModules }), `${id} without ${missing}`).toBe(false);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// targets.ts 的單元測試
// ---------------------------------------------------------------------------

describe('SF+CK robberTargets', () => {
  // 0 森林、1 海、2 沙漠、3 海、4 山脈；5 是不存在的 hex。
  const TERRAIN = ['forest', 'sea', 'desert', 'sea', 'mountains'] as const;
  const ALL: readonly BanditTarget[] = [0, 1, 2, 3, 4, null];

  /** 最小的 view：只有 `robberTargets` 會讀的欄位。 */
  function viewWith(bandit: unknown, options: { hints?: boolean; entry?: boolean } = {}): GameView {
    const hints =
      options.hints === false
        ? undefined
        : { modules: options.entry === false ? {} : { [SEAFARERS_CITIES_KNIGHTS]: { pirateActive: true, pirateChase: [], bandit } } };
    return { board: { terrain: [...TERRAIN] }, hints } as unknown as GameView;
  }

  it('keeps only sea hexes and the frame when the pirate must move', () => {
    expect(sfckRobberTargets(viewWith('pirate'), 'p1', ALL)).toEqual([1, 3, null]);
    expect(sfckRobberTargets(viewWith('pirate'), 'p1', [0, 2, 4])).toEqual([]);
  });

  it('keeps only land hexes when the robber must move', () => {
    expect(sfckRobberTargets(viewWith('robber'), 'p1', ALL)).toEqual([0, 2, 4]);
    expect(sfckRobberTargets(viewWith('robber'), 'p1', [1, 3, null])).toEqual([]);
  });

  it('leaves the set alone when either bandit may move, or the hint says nothing', () => {
    const targets = [...ALL];
    expect(sfckRobberTargets(viewWith('either'), 'p1', targets)).toBe(targets);
    expect(sfckRobberTargets(viewWith(null), 'p1', targets)).toBe(targets);
    // 缺漏或形狀不對的 hint 一律當作沒有（保底路徑不得 throw）。
    for (const bandit of [undefined, 'bogus', 7, {}, []]) {
      expect(sfckRobberTargets(viewWith(bandit), 'p1', targets), String(bandit)).toBe(targets);
    }
    expect(sfckRobberTargets(viewWith(null, { hints: false }), 'p1', targets)).toBe(targets);
    expect(sfckRobberTargets(viewWith(null, { entry: false }), 'p1', targets)).toBe(targets);
    expect(sfckRobberTargets({ board: { terrain: [] } } as unknown as GameView, 'p1', targets)).toBe(targets);
  });

  it('keeps the order of the incoming set and never edits it', () => {
    const targets: readonly BanditTarget[] = Object.freeze([4, 3, null, 0, 1, 2]);
    expect(sfckRobberTargets(viewWith('pirate'), 'p1', targets)).toEqual([3, null, 1]);
    expect(sfckRobberTargets(viewWith('robber'), 'p1', targets)).toEqual([4, 0, 2]);
    expect(targets).toEqual([4, 3, null, 0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// 真值表：fold 的集合 = rules 的合法集合，而且非空
// ---------------------------------------------------------------------------

/** 盜賊預設（fold 的初值）：陸地非現位、海格非現位，海盜在場時最後加上 `null`。 */
function defaultTargets(view: GameView): BanditTarget[] {
  const { terrain, robber, pirate } = view.board;
  const land: BanditTarget[] = [];
  const sea: BanditTarget[] = [];
  terrain.forEach((kind, hexIndex) => {
    if (kind === 'sea') {
      if (hexIndex !== pirate) sea.push(hexIndex);
    } else if (hexIndex !== robber) {
      land.push(hexIndex);
    }
  });
  return [...land, ...sea, ...(pirate !== null ? [null] : [])];
}

/** 依模組順序 fold，與 rules 的 `legalRobberHexes` 相同。 */
function foldTargets(modules: readonly BotModule[], view: GameView, selfId: string): readonly BanditTarget[] {
  let targets: readonly BanditTarget[] = defaultTargets(view);
  for (const module of modules) if (module.robberTargets) targets = module.robberTargets(view, selfId, targets);
  return targets;
}

/** rules 的合法集合：對每個 hex 與 `null` 實際送 `pending.moveRobber`，看 `applyCommand` 是否接受。 */
function rulesLegalTargets(state: GameState, actor: string): BanditTarget[] {
  const legal: BanditTarget[] = [];
  for (const target of [...topologyOf(state).hexes.keys(), null]) {
    const outcome = applyCommand(state, actor, { type: 'pending.moveRobber', hex: target } as Command, seededRng(1));
    if (outcome.ok) legal.push(target);
  }
  return legal;
}

const sorted = (targets: readonly BanditTarget[]): number[] => targets.map((target) => target ?? -1).sort((a, b) => a - b);

interface BanditCase {
  readonly name: string;
  readonly expected: SfckBandit;
  /** 盜賊的位置：首攻前兩者都在外框；之後強盜在劇本指定的 hex。 */
  readonly attacked: boolean;
  readonly pirate: 'frame' | 'board';
  readonly cause: 'seven' | 'knight';
  readonly chasingPirate: boolean;
}

const BANDIT_CASES: readonly BanditCase[] = [
  { name: 'robber before the first attack', expected: 'robber', attacked: false, pirate: 'frame', cause: 'seven', chasingPirate: false },
  { name: 'robber after a knight chased it, pirate on the frame', expected: 'robber', attacked: true, pirate: 'frame', cause: 'knight', chasingPirate: false },
  { name: 'robber after a knight chased it, pirate at sea', expected: 'robber', attacked: true, pirate: 'board', cause: 'knight', chasingPirate: false },
  { name: 'either after a 7, pirate on the frame', expected: 'either', attacked: true, pirate: 'frame', cause: 'seven', chasingPirate: false },
  { name: 'either after a 7, pirate at sea', expected: 'either', attacked: true, pirate: 'board', cause: 'seven', chasingPirate: false },
  { name: 'pirate after a knight chased it', expected: 'pirate', attacked: true, pirate: 'board', cause: 'knight', chasingPirate: true },
];

function banditState(players: 3 | 4 | 6, test: BanditCase): GameState {
  const base = emptySfckGame(players);
  const state = test.attacked ? afterFirstAttack(base) : base;
  if (test.pirate === 'board') state.board.pirate = state.board.layout.terrain.indexOf('sea');
  state.pending = { kind: 'moveRobber', actor: 'p1', cause: test.cause, pirate: test.chasingPirate };
  return state;
}

describe.each([
  [3, 'sf-new-shores-4'],
  [4, 'sf-new-shores-4'],
  [6, 'sf-new-shores-56'],
] as const)('robberTargets truth table, %i players (%s)', (players, topologyId) => {
  it.each(BANDIT_CASES)('$name: the fold is the rules legal set, and not empty', (test) => {
    const state = banditState(players, test);
    expect(getProfile(state.profileId)!.topologyId).toBe(topologyId);
    const modules = botModulesOf(getProfile(state.profileId)!);
    expect(modules.map((module) => module.id)).toEqual(['seafarersCitiesKnights', 'seafarers', 'citiesKnights']);

    const view = viewOf(state, 'p1');
    // 盤面真的是我們要的那一種 frame。
    expect((actionHints(state, 'p1').modules!.seafarersCitiesKnights as { bandit: string | null }).bandit).toBe(test.expected);

    const folded = foldTargets(modules, view, 'p1');
    const legal = rulesLegalTargets(state, 'p1');
    expect(legal.length, 'rules has a legal target').toBeGreaterThan(0);
    expect(folded.length, 'the fold has a target').toBeGreaterThan(0);
    expect(sorted(folded)).toEqual(sorted(legal));
    // 不重複。
    expect(new Set(folded).size).toBe(folded.length);

    // 型態與順序：陸地在前，保底因此在 `either` 時一律移強盜；`pirate` 時第一項是海格。
    const first = folded[0]!;
    if (test.expected === 'pirate') expect(first === null ? 'sea' : view.board.terrain[first]).toBe('sea');
    else expect(view.board.terrain[first as number]).not.toBe('sea');
  });

  it('without the combination layer, a pirate frame still lists land hexes that rules refuses', () => {
    const test = BANDIT_CASES.find((candidate) => candidate.expected === 'pirate')!;
    const state = banditState(players, test);
    const view = viewOf(state, 'p1');
    const unnarrowed = foldTargets(WITHOUT_SFCK, view, 'p1');
    const legal = new Set(rulesLegalTargets(state, 'p1'));
    expect(unnarrowed.filter((target) => !legal.has(target)).length).toBeGreaterThan(0);
    expect(sorted(foldTargets(MODULES, view, 'p1'))).toEqual(sorted([...legal]));
  });
});

// ---------------------------------------------------------------------------
// F3–F11 固定盤面（4 人地圖；座標見 packages/rules/test/sfck-clauses.test.ts）
// ---------------------------------------------------------------------------

const V28 = 28; // 主島海岸
const V11 = 11; // 三個海格之間
const V10 = 10; // 金礦格的海岸
const V15 = 15; // 小島：金礦 (3,-3) 4 與丘陵 (3,-2) 5
const V29 = 29;

/** p1：V28 的聚落，船 V28–V11 與 V11–V10。 */
function shipLine(): GameState {
  const state = emptySfckGame(4);
  settle(state, 'p1', V28);
  ship(state, 'p1', edgeBetween(state, V28, V11));
  ship(state, 'p1', edgeBetween(state, V11, V10));
  return state;
}

describe('F3 a 7 after the first attack: either bandit may move', () => {
  function sevenState(): GameState {
    const state = afterFirstAttack(emptySfckGame(4, 0, 'preroll'));
    return actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, TRADE)).state;
  }

  it('the duty moves the robber to the first land hex, and every policy answers legally', () => {
    const state = sevenState();
    expect(state.pending).toMatchObject({ kind: 'moveRobber', cause: 'seven', pirate: false });
    const view = viewOf(state, 'p1');
    expect((view.hints!.modules!.seafarersCitiesKnights as { bandit: string }).bandit).toBe('either');
    const first = view.board.terrain.findIndex((terrain, index) => terrain !== 'sea' && index !== view.board.robber);
    const duty = expectEveryPolicyAnswers(state, 'p1');
    expect(duty).toEqual({ type: 'pending.moveRobber', hex: first });
    expect(fallbackDecision(view, 'p1', WITHOUT_SFCK)).toEqual(duty);
    expectOthersWait(state, ['p1']);
  });

  it('the pirate is a legal answer too, with a ship of an opponent holding a card at sea', () => {
    const state = afterFirstAttack(emptySfckGame(4, 0, 'preroll'));
    ship(state, 'p2', edgeBetween(state, 48, 47));
    setHand(state, 'p2', { brick: 1 });
    const next = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, TRADE)).state;
    expect(next.pending).toMatchObject({ kind: 'moveRobber', pirate: false });
    expectEveryPolicyAnswers(next, 'p1');
    // 打到海上也被接受。
    const sea = hex(next, 2, 0);
    expectAccepted(next, 'p1', { type: 'pending.moveRobber', hex: sea });
  });
});

describe('F4 a 7 before the first attack with commodities in the hand', () => {
  it('discards cards the engine counts, commodities included, and moves neither bandit', () => {
    const state = emptySfckGame(4, 0, 'preroll');
    // p2 有 10 張牌：1 wool、5 paper、4 coin。要棄 5 張，所以一定會交出 commodity。
    setHand(state, 'p2', { wool: 1 });
    giveCommodities(state, 'p2', { paper: 5, coin: 4 });
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, TRADE)).state;
    expect(viewOf(rolled, 'p2').pending).toMatchObject({ kind: 'discard', waitingFor: ['p2'], required: { p2: 5 } });
    const duty = expectEveryPolicyAnswers(rolled, 'p2');
    expect(duty.type).toBe('pending.discard');
    const cards = (duty as { resources: string[] }).resources;
    expect(cards).toHaveLength(5);
    expect(cards.some((card) => card === 'paper' || card === 'coin' || card === 'cloth')).toBe(true);
    // 棄牌之後沒有 pending，兩個盜賊都還在外框。
    const done = expectAccepted(rolled, 'p2', duty);
    expect(done.pending).toBeNull();
    expect(done.board.robber).toBe(-1);
    expect(done.board.pirate).toBeNull();
    expectOthersWait(rolled, ['p2']);
  });
});

describe('F5 Road Building with only ships left to place', () => {
  /** p1：V28 的聚落與一艘船；`roadsUsed` 為 0 時所有陸路都被 p2 佔滿，否則 p1 已用掉這麼多道路。 */
  function roadBuilding(roadsUsed: number): GameState {
    const state = emptySfckGame(4);
    settle(state, 'p1', V28);
    ship(state, 'p1', edgeBetween(state, V28, V11));
    const topo = topologyOf(state);
    if (roadsUsed === 0) {
      for (const edge of topo.vertices[V28]!.edges) if (!state.board.roads[edge]) state.board.roads[edge] = { player: 'p2', ship: false };
    } else {
      const land = topo.edges
        .map((_, edge) => edge)
        .filter((edge) => !state.board.roads[edge] && topo.edges[edge]!.vertices.every((vertex) => topo.vertices[vertex]!.hexes.some((cell) => state.board.layout.terrain[cell] !== 'sea')))
        .filter((edge) => !topo.edges[edge]!.vertices.includes(V28));
      expect(land.length).toBeGreaterThanOrEqual(roadsUsed);
      for (const edge of land.slice(0, roadsUsed)) state.board.roads[edge] = { player: 'p1', ship: false };
    }
    handCards(state, 'p1', ['roadBuilding']);
    return playCard(state, 'p1', 'roadBuilding').state;
  }

  it.each([
    ['no land edge left, only ships', 0, 'build.ship'],
    ['all 15 road pieces used, only ships', 15, 'build.ship'],
    ['one road piece plus ships', 14, 'build.road'],
  ] as const)('%s: every policy finishes both routes legally', (_name, roadsUsed, firstCommand) => {
    const frame = roadBuilding(roadsUsed);
    expect(frame.pending).toMatchObject({ kind: 'freeRoads', remaining: 2 });
    expect(expectEveryPolicyAnswers(frame, 'p1').type).toBe(firstCommand);
    expectOthersWait(frame, ['p1']);
    for (const [name, policy, level, seed] of POLICIES) {
      let state = frame;
      for (let step = 0; step < 3 && state.pending?.kind === 'freeRoads'; step++) {
        state = expectAccepted(state, 'p1', policy.decide(viewOf(state, 'p1'), ctxFor('p1', level, seed)));
      }
      expect(state.pending, `${name} placed both routes`).toBeNull();
    }
  });
});

describe('F6 stealing after the pirate or the robber moved, from a commodity-only hand', () => {
  it.each(['paper', 'cloth', 'coin'] as const)('the robber victim with only %s is stolen from', (commodity) => {
    const state = afterFirstAttack(emptySfckGame(4));
    const topo = topologyOf(state);
    const target = state.board.layout.terrain.findIndex((terrain, index) => terrain !== 'sea' && index !== state.board.robber);
    settle(state, 'p2', topo.vertices.findIndex((vertex) => vertex.hexes.includes(target)));
    giveCommodities(state, 'p2', { [commodity]: 1 });
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
    const moved = actCk(state, 'p1', { type: 'pending.moveRobber', hex: target }).state;
    expect(moved.pending).toMatchObject({ kind: 'steal', candidates: ['p2'], pirate: false });
    expect(expectEveryPolicyAnswers(moved, 'p1')).toEqual({ type: 'pending.steal', victim: 'p2' });
  });

  it('the pirate victim with a commodity-only hand is stolen from', () => {
    const state = afterFirstAttack(shipLine());
    state.board.pirate = hex(state, 2, -2);
    ship(state, 'p2', edgeBetween(state, 48, 47));
    giveCommodities(state, 'p2', { cloth: 1 });
    addKnight(state, { player: 'p1', vertex: V11, level: 1, active: true });
    const chased = actCk(state, 'p1', { type: 'knight.chasePirate', vertex: V11 }).state;
    const moved = actCk(chased, 'p1', { type: 'pending.moveRobber', hex: hex(state, 2, 0) }).state;
    expect(moved.pending).toMatchObject({ kind: 'steal', candidates: ['p2'], pirate: true });
    expect(expectEveryPolicyAnswers(moved, 'p1')).toEqual({ type: 'pending.steal', victim: 'p2' });
  });
});

describe('F7 a gold field answer comes before the aqueduct bonus', () => {
  function goldBoard(): GameState {
    const state = emptySfckGame(4, 0, 'preroll');
    settle(state, 'p1', V15, true); // 金礦 (3,-3) 4 旁的城市
    settle(state, 'p2', corner(state, 1, -1, 1), true); // 山脈 (1,-1) 4 旁的城市
    setImprovement(state, 'p1', 'science', 3);
    setImprovement(state, 'p3', 'science', 3);
    return actCk(state, 'p1', { type: 'turn.roll' }, rollRng(1, 3, SCIENCE)).state;
  }

  it('F7a the gold frame: the first responder takes two cards, the others wait', () => {
    const state = goldBoard();
    expect(moduleFrame(state)).toMatchObject({ kind: 'seafarers.gold', responders: ['p1'] });
    const duty = expectEveryPolicyAnswers(state, 'p1');
    expect(duty.type).toBe('gold.choose');
    expect((duty as { resources: string[] }).resources).toHaveLength(2);
    expectOthersWait(state, ['p1']);
  });

  it('F7b the aqueduct bonus follows, and the science player takes the free card', () => {
    const gold = goldBoard();
    const duty = expectEveryPolicyAnswers(gold, 'p1');
    const next = expectAccepted(gold, 'p1', duty);
    expect(moduleFrame(next)).toMatchObject({ kind: 'citiesKnights.scienceBonus', responders: ['p3'] });
    expect(expectEveryPolicyAnswers(next, 'p3')).toEqual({ type: 'science.take', resource: null });
    expectOthersWait(next, ['p3']);
  });
});

describe('F8 knights pin ships', () => {
  it('F8 an own knight on the last ship closes the route: moving it is refused, the policies do not try', () => {
    const state = shipLine();
    addKnight(state, { player: 'p1', vertex: V10, level: 1, active: true });
    const tip = edgeBetween(state, V11, V10);
    const naive = { type: 'ship.move', from: tip, to: edgeBetween(state, V11, 6) } as unknown as BotCommand;
    expect(rejection(state, 'p1', naive).code).toBe('E_SHIP_PINNED_BY_KNIGHT');
    // 保底永遠不送 ship.move：行動階段只結束回合。
    expect(expectEveryPolicyAnswers(state, 'p1')).toEqual({ type: 'turn.end' });
  });

  it('F8 an opponent knight between two ships pins both of them', () => {
    const state = shipLine();
    addKnight(state, { player: 'p2', vertex: V11, level: 1, active: false });
    const tip = edgeBetween(state, V11, V10);
    const naive = { type: 'ship.move', from: tip, to: edgeBetween(state, V10, V15) } as unknown as BotCommand;
    expect(rejection(state, 'p1', naive).code).toBe('E_SHIP_PINNED_BY_KNIGHT');
    expect(expectEveryPolicyAnswers(state, 'p1')).toEqual({ type: 'turn.end' });
  });

  it('F8c a ship may not be built past an opponent knight, with the resources in hand', () => {
    const state = emptySfckGame(4);
    settle(state, 'p1', V28);
    ship(state, 'p1', edgeBetween(state, V28, V11));
    addKnight(state, { player: 'p2', vertex: V11, level: 1, active: true });
    give(state, 'p1', { lumber: 1, wool: 1 });
    const naive = { type: 'build.ship', edge: edgeBetween(state, V11, V10) } as unknown as BotCommand;
    expect(rejection(state, 'p1', naive).code).toBe('E_ILLEGAL_TARGET');
    expect(expectEveryPolicyAnswers(state, 'p1')).toEqual({ type: 'turn.end' });
  });
});

describe('F9 the merchant does not stand on a gold field', () => {
  it('only the hills next to the gold are offered, and the policies keep to them', () => {
    const state = emptySfckGame(4);
    settle(state, 'p1', V15);
    handCards(state, 'p1', ['merchant', 'merchant']);
    const gold = hex(state, 3, -3);
    const hills = hex(state, 3, -2);
    const naive = { type: 'progress.play', card: 'merchant', hex: gold } as unknown as BotCommand;
    expect(rejection(state, 'p1', naive).code).toBe('E_ILLEGAL_TARGET');
    expectAccepted(state, 'p1', { type: 'progress.play', card: 'merchant', hex: hills } as unknown as BotCommand);
    expect(expectEveryPolicyAnswers(state, 'p1')).toEqual({ type: 'turn.end' });
    for (const [, policy, level, seed] of POLICIES) {
      const command = policy.decide(viewOf(state, 'p1'), ctxFor('p1', level, seed)) as { type: string; card?: string; hex?: number };
      if (command.type === 'progress.play' && command.card === 'merchant') expect(command.hex).toBe(hills);
    }
  });
});

describe('F10 Diplomacy replaces a ship with a ship', () => {
  it('the frame answers `{ edge: null }`; an inland road edge would be refused', () => {
    const state = shipLine();
    handCards(state, 'p1', ['diplomacy']);
    const tip = edgeBetween(state, V11, V10);
    const played = playCard(state, 'p1', 'diplomacy', { edge: tip }).state;
    expect(moduleFrame(played)).toMatchObject({ kind: 'citiesKnights.diplomacyRoad', responders: ['p1'], data: { ship: true } });
    // 有一條道路可以接，所以 `legalRoads` 不是空的；內陸的道路邊對船不合法。
    played.board.roads[edgeBetween(state, V28, V29)] = { player: 'p1', ship: false };
    const inland = edgeBetween(state, V29, corner(state, 1, -1, 2));
    const naive = { type: 'progress.diplomacyRoad', edge: inland } as unknown as BotCommand;
    expect(rejection(played, 'p1', naive).code).toBe('E_ILLEGAL_TARGET');
    expect(expectEveryPolicyAnswers(played, 'p1')).toEqual({ type: 'progress.diplomacyRoad', edge: null });
    expectOthersWait(played, ['p1']);
  });
});

describe('F11 a knight cannot be recruited on a sea intersection', () => {
  it('the engine refuses the sea intersection, and no policy recruits there', () => {
    const state = shipLine();
    give(state, 'p1', { wool: 2, ore: 2 });
    const naive = { type: 'knight.recruit', vertex: V11 } as unknown as BotCommand;
    expect(rejection(state, 'p1', naive).code).toBe('E_ILLEGAL_TARGET');
    // 靠海岸的路口（接到自己的船）是合法的。
    expectAccepted(state, 'p1', { type: 'knight.recruit', vertex: V10 } as unknown as BotCommand);
    expectEveryPolicyAnswers(state, 'p1');
    for (const [, policy, level, seed] of POLICIES) {
      const command = policy.decide(viewOf(state, 'p1'), ctxFor('p1', level, seed)) as { type: string; vertex?: number };
      if (command.type === 'knight.recruit') expect(command.vertex).not.toBe(V11);
    }
  });
});
