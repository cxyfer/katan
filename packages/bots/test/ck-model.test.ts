/**
 * B-POLICY-MODEL（C&K 計畫 §6.1）：Bot 對 C&K 盤面的模型與 rules 不漂移，投影的 frame 形狀被鎖住，
 * 測試 kit 守得住它宣告的不變量。
 *
 * 取樣：`simulateCitiesKnights(n, seed)` 的終盤（3–6 人 × 種子 1、2），每位玩家都強制成行動者，比對
 * `board.ts` 的可蓋點、道路搜尋與路線長度和 hints／rules 的 `longestRouteLength`；騎士封路與封點由組合後
 * 的 `vertexBlocker`／`siteBlocked` 負責。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  CITIES_KNIGHTS,
  CK_PROGRESS_DECKS,
  longestRouteLength,
  projectGame,
  requireProfile,
  rulesModulesOf,
  seededRng,
  type Command,
  type GameState,
} from '@catan/rules';
import { addKnight, emptyCkGame, handCards, pathFrom, roadAlong, setBuilding, spreadVertices } from '../../rules/test/ck-helpers.ts';
import { forceTurn } from '../../rules/test/helpers.ts';
import { simulateCitiesKnights } from '../../rules/test/ck-sim.ts';
import { boardModel, isFreeSpot, isLandEdge, routeLength, searchRoads, type BoardModel } from '../src/board.ts';
import { citiesKnightsDuty } from '../src/modules/citiesKnights/duty.ts';
import { CK_PACING, CK_PENDING_COMMANDS, citiesKnightsBotModule } from '../src/modules/citiesKnights/index.ts';
import {
  ckCommands,
  ckHints,
  ckView,
  defenderDrawData,
  diplomacyData,
  displacedData,
  espionageData,
  giveCardsData,
  guildDuesData,
  harborData,
  isCkFrame,
  pillageData,
  progressDiscardData,
  treasonPlaceData,
  treasonRemoveData,
  CK_FRAME_KINDS,
} from '../src/modules/citiesKnights/view.ts';
import { botResponseCommands } from '../src/support.ts';
import { allowedResponseCommands, cloneState, hideDifferently, perturbState, responseCommandDrift } from './harness.ts';
import { FRAME_FIXTURES, viewOf } from './ck-fixtures.ts';
import { citiesKnightsKit, STAGEABLE_FRAMES, stageFrame } from './modules/citiesKnights.ts';

const SIM_TIMEOUT = 120_000;
const MODULES = [citiesKnightsBotModule];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 同一局只模擬一次：各組比對共用終盤。 */
const finals = new Map<string, GameState>();
function finalState(players: 3 | 4 | 5 | 6, seed: number): GameState {
  const key = `${players}:${seed}`;
  let state = finals.get(key);
  if (!state) {
    state = simulateCitiesKnights(players, seed).state;
    finals.set(key, state);
  }
  return state;
}

/** 把回合強制給某個座位的行動階段：沒有 pending、新的行動視窗（hints 會給這位玩家）。 */
function asActor(state: GameState, seat: number): GameState {
  const copy = clone(state);
  copy.result = null;
  forceTurn(copy, seat, 'action');
  copy.windowId += 1;
  return copy;
}

const PLAYER_COUNTS = [3, 4, 5, 6] as const;
const SAMPLES: (readonly [3 | 4 | 5 | 6, number])[] = PLAYER_COUNTS.flatMap((players) => [1, 2].map((seed) => [players, seed] as const));

// ---------------------------------------------------------------------------
// 盤面模型與 rules
// ---------------------------------------------------------------------------

describe('board model against the rules (end positions of simulated games)', () => {
  it.each(SAMPLES)('%i players, seed %i: settlement sites, roads and route lengths agree', (players, seed) => {
    const final = finalState(players, seed);
    let knightSites = 0;
    for (let seat = 0; seat < players; seat++) {
      const state = asActor(final, seat);
      const id = state.players[seat]!.id;
      const view = viewOf(state, id);
      const model = boardModel(view, id, MODULES);
      const hints = actionHints(state, id);

      // 可蓋點：騎士占的點不能蓋，legalSettlements 一定是 isFreeSpot 的子集。
      for (const vertex of ckView(view)!.knights.map((knight) => knight.vertex)) {
        knightSites += 1;
        expect(isFreeSpot(model, vertex), `knight at ${vertex}`).toBe(false);
        expect(hints.legalSettlements).not.toContain(vertex);
      }
      for (const vertex of hints.legalSettlements) expect(isFreeSpot(model, vertex), `legal settlement ${vertex}`).toBe(true);

      // 道路：從自己的網（建築與道路端點，不含被對手建築或騎士擋住的點）延伸一條的邊，就是 legalRoads。
      const search = searchRoads(model, id, 1);
      const fromSearch = model.topo.edges
        .map((info, edge) => ({ info, edge }))
        .filter(({ info, edge }) => !state.board.roads[edge] && isLandEdge(model, edge) && info.vertices.some((vertex) => search.distance[vertex] === 0))
        .map(({ edge }) => edge)
        .sort((a, b) => a - b);
      expect([...hints.legalRoads].sort((a, b) => a - b)).toEqual(fromSearch);

      // 路線長度：對手的建築與騎士都會切斷，與 rules 一致；再假設加上一條合法道路也一致。
      expect(routeLength(model, id), `route of ${id}`).toBe(longestRouteLength(state, id));
      for (const edge of hints.legalRoads.slice(0, 6)) {
        const extended = clone(state);
        extended.board.roads[edge] = { player: id, ship: false };
        expect(routeLength(model, id, [edge]), `route of ${id} with ${edge}`).toBe(longestRouteLength(extended, id));
      }
      // 其他座位的路線也一樣（自己的騎士不擋自己，別人的會擋）。
      for (const other of state.players) expect(routeLength(model, other.id)).toBe(longestRouteLength(state, other.id));
    }
    // 取樣有意義：終盤的盤面上確實有騎士。
    expect(knightSites).toBeGreaterThan(0);
  }, SIM_TIMEOUT);
});

/** p1 的一條 4 邊道路，p2 的騎士在第 3 個路口；回傳盤面與路徑。 */
function cutRoute(knightOwner: string) {
  const state = emptyCkGame(4, 0, 'action');
  const [a] = spreadVertices(state, 1);
  const path = pathFrom(state, a!, 4);
  setBuilding(state, 'p1', path[0]!, false);
  roadAlong(state, 'p1', path);
  addKnight(state, { player: knightOwner, vertex: path[2]!, level: 1, active: false });
  return { state, path };
}

describe('knights cut routes and close sites', () => {
  it('an opponent knight cuts the route like a building: the hooks agree with rules, the base model does not', () => {
    const { state, path } = cutRoute('p2');
    const view = viewOf(state, 'p1');
    const hooked = boardModel(view, 'p1', MODULES);
    const plain = boardModel(view, 'p1');
    expect(hooked.blocker?.(path[2]!)).toBe('p2');
    expect(longestRouteLength(state, 'p1')).toBe(2);
    expect(routeLength(hooked, 'p1')).toBe(2);
    expect(routeLength(plain, 'p1')).toBe(4);
    // 路徑搜尋：被對手騎士擋住的點到不了，也不能當起點。
    const search = searchRoads(hooked, 'p1', 3);
    expect(search.distance[path[2]!]).toBe(Infinity);
    expect(searchRoads(plain, 'p1', 3).distance[path[2]!]).toBeLessThan(Infinity);
  });

  it('an own knight does not cut the own route, but still closes the site', () => {
    const { state, path } = cutRoute('p1');
    const model = boardModel(viewOf(state, 'p1'), 'p1', MODULES);
    expect(longestRouteLength(state, 'p1')).toBe(4);
    expect(routeLength(model, 'p1')).toBe(4);
    expect(searchRoads(model, 'p1', 3).distance[path[2]!]).toBeLessThan(Infinity);
    // 騎士所在的點（含自己的）不能蓋建築。
    expect(model.siteBlocked?.(path[2]!)).toBe(true);
    expect(isFreeSpot(model, path[2]!)).toBe(false);
  });

  it('the hooks are only present for a model built with the module, and only for the hooks it provides', () => {
    const state = emptyCkGame(4, 0, 'action');
    const view = viewOf(state, 'p1');
    expect(boardModel(view, 'p1').blocker).toBeUndefined();
    expect(boardModel(view, 'p1', []).hexYield).toBeUndefined();
    const model = boardModel(view, 'p1', MODULES);
    expect(model.blocker).toBeTypeOf('function');
    expect(model.siteBlocked).toBeTypeOf('function');
    expect(model.hexYield).toBeTypeOf('function');
    // 沒有任何騎士時什麼都不擋。
    expect(model.blocker?.(0)).toBeNull();
    expect(model.siteBlocked?.(0)).toBe(false);
  });

  it('combines the hooks of several modules: first non-null blocker, any siteBlocked, first answered yield', () => {
    const state = emptyCkGame(4, 0, 'action');
    const view = viewOf(state, 'p1');
    const first: (typeof MODULES)[number] = {
      id: 'x',
      economy: { vertexBlocker: (_m, v) => (v === 1 ? 'p2' : null), siteBlocked: (_m, v) => v === 2, hexYield: () => undefined },
    };
    const second: (typeof MODULES)[number] = {
      id: 'y',
      economy: { vertexBlocker: (_m, v) => (v === 1 ? 'p3' : v === 3 ? 'p4' : null), siteBlocked: (_m, v) => v === 4, hexYield: (_m, hex) => (hex === 0 ? { ore: 5 } : undefined) },
    };
    const model: BoardModel = boardModel(view, 'p1', [first, second]);
    expect(model.blocker?.(1)).toBe('p2');
    expect(model.blocker?.(3)).toBe('p4');
    expect(model.blocker?.(5)).toBeNull();
    expect(model.siteBlocked?.(2)).toBe(true);
    expect(model.siteBlocked?.(4)).toBe(true);
    expect(model.siteBlocked?.(6)).toBe(false);
    expect(model.hexYield?.(0, 0, false)).toEqual({ ore: 5 });
    expect(model.hexYield?.(1, 0, false)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// frame 的投影形狀
// ---------------------------------------------------------------------------

describe('projected frame data keeps the shape the guards declare', () => {
  /** kind → 回應者看到的 data 的鍵，以及守衛。 */
  const SHAPES: Record<string, { keys: string[]; guard: (frame: any) => unknown }> = {
    'citiesKnights.pillage': { keys: ['cities'], guard: pillageData },
    'citiesKnights.displaced': { keys: ['active', 'from', 'level', 'options', 'player'], guard: displacedData },
    'citiesKnights.progressDiscard': { keys: ['required'], guard: progressDiscardData },
    'citiesKnights.defenderDraw': { keys: ['decks'], guard: defenderDrawData },
    'citiesKnights.scienceBonus': { keys: [], guard: () => ({}) },
    'citiesKnights.harborExchange': { keys: ['from', 'resource'], guard: harborData },
    'citiesKnights.guildDues': { keys: ['count', 'hand', 'victim'], guard: guildDuesData },
    'citiesKnights.espionage': { keys: ['cards', 'count', 'victim'], guard: espionageData },
    'citiesKnights.sabotage': { keys: ['actor', 'required'], guard: giveCardsData },
    'citiesKnights.wedding': { keys: ['actor', 'required'], guard: giveCardsData },
    'citiesKnights.treasonRemove': { keys: ['actor', 'knights'], guard: treasonRemoveData },
    'citiesKnights.treasonPlace': { keys: ['active', 'from', 'level', 'levels', 'sites'], guard: treasonPlaceData },
    'citiesKnights.diplomacyRoad': { keys: ['edge', 'edges'], guard: diplomacyData },
  };

  it('covers every real frame the fixtures reach', () => {
    expect(Object.keys(SHAPES).sort()).toEqual(Object.keys(FRAME_FIXTURES).sort());
    // 14 種 frame 加上續行的 resolveRoll；kind 都在 C&K 的命名空間。
    expect(CK_FRAME_KINDS).toHaveLength(14);
    for (const kind of CK_FRAME_KINDS) expect(kind.startsWith(`${CITIES_KNIGHTS}.`)).toBe(true);
  });

  it.each(Object.entries(FRAME_FIXTURES))('%s', (kind, build) => {
    const fx = build();
    const view = viewOf(fx.state, fx.responder);
    const frame = view.pending as { kind: string; module: string; responders: string[]; data: Record<string, unknown> };
    expect(isCkFrame(frame)).toBe(true);
    expect(frame).toMatchObject({ kind, module: CITIES_KNIGHTS });
    expect(frame.responders[0]).toBe(fx.responder);
    expect(Object.keys(frame.data).sort()).toEqual(SHAPES[kind]!.keys);
    expect(SHAPES[kind]!.guard(frame), 'the guard accepts the real projection').not.toBeNull();
  });

  it('the guards refuse a value of the wrong shape (they are not vacuous)', () => {
    const fx = FRAME_FIXTURES['citiesKnights.guildDues']!();
    const frame = clone(viewOf(fx.state, fx.responder).pending) as { data: Record<string, unknown> };
    expect(guildDuesData(frame as never)).toMatchObject({ victim: 'p2', count: 2, hand: { grain: 1, ore: 2, coin: 1 } });
    frame.data.count = 'two';
    expect(guildDuesData(frame as never)).toBeNull();
    frame.data = { victim: 'p2', count: 2, hand: { ore: 'x' } };
    expect(guildDuesData(frame as never)?.hand).toBeUndefined();
    expect(pillageData({ data: { cities: { p1: 'nope' } } } as never)).toBeNull();
    expect(displacedData({ data: {} } as never)).toBeNull();
    expect(isCkFrame({ kind: 'discard' })).toBe(false);
    expect(isCkFrame({ kind: 'seafarers.gold' })).toBe(false);
    expect(isCkFrame(null)).toBe(false);
  });

  it('hides what only the responders may see', () => {
    const harbor = FRAME_FIXTURES['citiesKnights.harborExchange']!();
    expect(harborData(viewOf(harbor.state, harbor.responder).pending as never)).toEqual({ from: 'p1', resource: 'ore' });
    expect(harborData(viewOf(harbor.state, 'p3').pending as never)).toEqual({ from: 'p1' });
    const dues = FRAME_FIXTURES['citiesKnights.guildDues']!();
    expect(guildDuesData(viewOf(dues.state, 'p3').pending as never)?.hand).toBeUndefined();
    const spy = FRAME_FIXTURES['citiesKnights.espionage']!();
    expect(espionageData(viewOf(spy.state, 'p3').pending as never)?.cards).toBeUndefined();
    expect(espionageData(viewOf(spy.state, spy.responder).pending as never)?.cards).toEqual(['taxation', 'crane']);
  });

  it('exposes the hints the duty and the economy read', () => {
    const state = emptyCkGame(4, 0, 'action');
    handCards(state, 'p1', ['alchemy', 'crane', 'invention', 'medicine', 'mining']);
    const hints = ckHints(viewOf(state, 'p1').hints)!;
    expect(hints.progressExcess).toBe(1);
    expect(hints.commodityRates).toEqual({ paper: 4, cloth: 4, coin: 4 });
    expect(hints.costs).toEqual({ wall: { brick: 2 }, knight: { wool: 1, ore: 1 }, promote: { wool: 1, ore: 1 }, activate: { grain: 1 } });
    expect(Array.isArray(hints.pillage) && Array.isArray(hints.retreat) && Array.isArray(hints.defenderDecks)).toBe(true);
    expect(ckView(viewOf(state, 'p1'))!.knights).toEqual([]);
    expect(ckHints(undefined)).toBeUndefined();
    expect(ckView({ modules: undefined } as never)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 指令建構函式與模組宣告對照 rules
// ---------------------------------------------------------------------------

describe('commands and declarations match the rules module', () => {
  const profile = requireProfile('ck-2025');
  const rules = rulesModulesOf(profile).find((module) => module.id === CITIES_KNIGHTS)!;

  it('declares the 13 pending commands the rules module lists, and paces every command it has', () => {
    expect([...CK_PENDING_COMMANDS].sort()).toEqual([...rules.pendingCommands!].sort());
    expect(Object.keys(CK_PACING).sort()).toEqual(Object.keys(rules.commands!).sort());
    expect([...(citiesKnightsKit.responseCommands ?? [])].sort()).toEqual([...rules.pendingCommands!].sort());
    expect(responseCommandDrift(profile, [citiesKnightsKit])).toEqual([]);
    expect(allowedResponseCommands(profile, [citiesKnightsKit])).toEqual(botResponseCommands(profile));
    // 每個回應型指令都有節奏。
    for (const command of CK_PENDING_COMMANDS) expect(CK_PACING).toHaveProperty(command);
  });

  it('builds commands the engine accepts (action commands)', () => {
    const state = emptyCkGame(4, 0, 'action');
    const [a] = spreadVertices(state, 1);
    const path = pathFrom(state, a!, 4);
    setBuilding(state, 'p1', path[0]!, true);
    roadAlong(state, 'p1', path);
    const p1 = state.players[0]!;
    p1.resources.wool = 6;
    p1.resources.ore = 6;
    p1.resources.grain = 3;
    p1.resources.brick = 2;
    p1.commodities.paper = 2;
    const accept = (command: unknown, from: GameState = state): GameState => {
      const outcome = applyCommand(from, 'p1', command as Command, seededRng(1));
      expect(outcome.ok, `${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
      return outcome.ok ? outcome.state : from;
    };
    let next = accept(ckCommands.recruitKnight(path[1]!));
    next = accept(ckCommands.activateKnight(path[1]!), next);
    next = accept(ckCommands.recruitKnight(path[2]!), next);
    next = accept(ckCommands.promoteKnight(path[2]!), next);
    next = accept(ckCommands.buildWall(path[0]!), next);
    next = accept(ckCommands.improveCity('science'), next);
    // 剛啟動的騎士本視窗不能動：換一個新的視窗再移動。
    next = clone(next);
    next.windowId += 1;
    next = accept(ckCommands.moveKnight(path[1]!, path[3]!), next);
    expect(ckView(viewOf(next, 'p1'))!.knights.map((knight) => knight.vertex).sort()).toEqual([path[2]!, path[3]!].sort());
  });

  it('builds the displace, chase and card commands with the fields the handlers read', () => {
    expect(ckCommands.displaceKnight(1, 2)).toEqual({ type: 'knight.displace', from: 1, to: 2 });
    expect(ckCommands.chaseRobber(3)).toEqual({ type: 'knight.chaseRobber', vertex: 3 });
    expect(ckCommands.playProgress('merchant', { hex: 4 })).toEqual({ type: 'progress.play', card: 'merchant', hex: 4 });
    expect(ckCommands.harborOffer('p2', 'ore')).toEqual({ type: 'progress.harborOffer', to: 'p2', resource: 'ore' });
    expect(ckCommands.improveCity('trade')).toEqual({ type: 'city.improve', track: 'trade' });
    expect(ckCommands.improveCity('trade', 9)).toEqual({ type: 'city.improve', track: 'trade', vertex: 9 });
    expect(ckCommands.treasonPlace(null)).toEqual({ type: 'progress.treasonPlace', vertex: null });
    expect(ckCommands.treasonPlace(5, 2)).toEqual({ type: 'progress.treasonPlace', vertex: 5, level: 2 });
    expect(ckCommands.scienceTake(null)).toEqual({ type: 'science.take', resource: null });
    // 回傳新的陣列，不共用呼叫端的。
    const cards = ['alchemy'];
    expect((ckCommands.discardProgress(cards) as unknown as { cards: string[] }).cards).not.toBe(cards);
  });

  it('the duty answers with a command whose type the module declares as a response command', () => {
    for (const [kind, build] of Object.entries(FRAME_FIXTURES)) {
      const fx = build();
      const command = citiesKnightsDuty(viewOf(fx.state, fx.responder), fx.responder);
      expect(command, kind).not.toBeNull();
      expect(CK_PENDING_COMMANDS, kind).toContain((command as { type: string }).type);
    }
  });
});

// ---------------------------------------------------------------------------
// 測試 kit
// ---------------------------------------------------------------------------

describe('the C&K test kit', () => {
  const state = () => finalState(4, 1);

  it('conservation: simulated games conserve everything, and the checker catches each kind of breach', () => {
    for (const [players, seed] of SAMPLES) expect(citiesKnightsKit.conservation!(finalState(players, seed)), `${players}p seed ${seed}`).toEqual([]);

    const breach = (mutate: (copy: GameState) => void): string[] => {
      const copy = clone(state());
      mutate(copy);
      return [...citiesKnightsKit.conservation!(copy)];
    };
    expect(breach((s) => (s.players[0]!.resources.lumber += 1)).join()).toContain('resource lumber');
    expect(breach((s) => (s.players[1]!.commodities.cloth += 1)).join()).toContain('commodity cloth');
    expect(breach((s) => (s.commodityBank.coin -= 20)).join()).toContain('commodity bank coin < 0');
    expect(breach((s) => s.progressDecks.trade.pop()).join()).toContain('progress deck trade');
    expect(breach((s) => (s.progressDecks.politics[0] = CK_PROGRESS_DECKS.politics.find((card) => card !== s.progressDecks.politics[0])!)).join()).toContain('progress deck politics');
    expect(breach((s) => s.players[0]!.progressCards.push('merchant')).join()).toContain('progress deck trade');
    const slot = (s: GameState) => s.moduleState!.citiesKnights as { knights: { player: string; vertex: number; level: number; active: boolean }[] };
    const bare = (s: GameState) => s.board.buildings.findIndex((building) => building === null);
    expect(breach((s) => slot(s).knights.push({ player: 'p1', vertex: s.board.buildings.findIndex((b) => b !== null), level: 1, active: false })).join()).toContain('share vertex');
    expect(
      breach((s) => {
        const free = bare(s);
        slot(s).knights.push({ player: 'p1', vertex: free, level: 1, active: false }, { player: 'p1', vertex: free, level: 1, active: false });
      }).join(),
    ).toContain('two knights');
    expect(
      breach((s) => {
        slot(s).knights = [];
        let vertex = 0;
        for (let i = 0; i < 3; i++) {
          while (s.board.buildings[vertex]) vertex++;
          slot(s).knights.push({ player: 'p1', vertex: vertex++, level: 1, active: false });
        }
      }).join(),
    ).toContain('level-1 knights > 2');
    expect(breach((s) => (s.players[0]!.cityWalls = 4)).join()).toContain('walls');
  });

  it('hideDifferently: changes only what the viewer cannot see, hand sizes and the viewer\'s own projection stay', () => {
    let changedAny = 0;
    // 進度牌堆被縮短來腳本化抽牌的 fixture 不守恆，不在此取樣（kit 只對守恆的盤面承諾）。
    const states = [...SAMPLES.map(([players, seed]) => finalState(players, seed)), ...Object.values(FRAME_FIXTURES).map((build) => build().state)].filter(
      (candidate) => citiesKnightsKit.conservation!(candidate).length === 0,
    );
    expect(states.length).toBeGreaterThan(SAMPLES.length);
    for (const base of states) {
      for (const viewer of base.players) {
        const source = base.result ? asActor(base, base.players.findIndex((p) => p.id === viewer.id)) : base;
        const { variant, changed } = hideDifferently(source, viewer.id, [citiesKnightsKit]);
        if (changed) changedAny += 1;
        expect(citiesKnightsKit.conservation!(variant)).toEqual([]);
        const view = (s: GameState) => JSON.stringify(projectGame(s, viewer.id, { hints: actionHints(s, viewer.id) }));
        expect(view(variant), `${viewer.id}'s projection must not change`).toBe(view(source));
      }
    }
    expect(changedAny).toBeGreaterThan(0);
  }, SIM_TIMEOUT);

  it('hideDifferently really changes the hidden C&K information', () => {
    const source = asActor(state(), 0);
    const { variant } = hideDifferently(source, 'p1', [citiesKnightsKit]);
    const others = (s: GameState) => JSON.stringify(s.players.slice(1).map((p) => [p.resources, p.commodities, p.progressCards]));
    expect(others(variant)).not.toBe(others(source));
    expect(JSON.stringify(variant.progressDecks)).not.toBe(JSON.stringify(source.progressDecks));
  });

  it('hideDifferently leaves the victim of a Guild Dues the actor is looking at alone', () => {
    const fx = FRAME_FIXTURES['citiesKnights.guildDues']!();
    const { variant } = hideDifferently(fx.state, fx.responder, [citiesKnightsKit]);
    const victim = (s: GameState) => JSON.stringify([s.players[1]!.resources, s.players[1]!.commodities]);
    expect(victim(variant)).toBe(victim(fx.state));
  });

  it('perturb keeps every supply, and what the engine needs to project and give hints', () => {
    const rng = seededRng(7);
    let framed = 0;
    for (const [players, seed] of SAMPLES) {
      for (let round = 0; round < 6; round++) {
        const source = asActor(finalState(players, seed), round % players);
        const next = perturbState(source, rng, [citiesKnightsKit]);
        expect(citiesKnightsKit.conservation!(next), `${players}p seed ${seed} round ${round}`).toEqual([]);
        for (const player of next.players) {
          expect(() => projectGame(next, player.id, { hints: actionHints(next, player.id) })).not.toThrow();
        }
        if (isCkFrame(next.pending)) framed += 1;
      }
    }
    expect(framed).toBeGreaterThan(0);
  }, SIM_TIMEOUT);

  it('perturb never touches the hands of a player who owes a base discard', () => {
    const rng = seededRng(3);
    const source = asActor(state(), 0);
    source.pending = { kind: 'discard', required: { p2: 2 }, submitted: {} } as never;
    const before = JSON.stringify([source.players[1]!.commodities, source.players[1]!.progressCards]);
    for (let i = 0; i < 20; i++) {
      const next = perturbState(source, rng, [citiesKnightsKit]);
      expect(JSON.stringify([next.players[1]!.commodities, next.players[1]!.progressCards])).toBe(before);
    }
  });

  it('every frame stageFrame can place has a shape the duty answers, with a command the engine accepts', () => {
    expect(STAGEABLE_FRAMES).toHaveLength(13);
    const staged = new Set<string>();
    for (const [players, seed] of SAMPLES) {
      const final = finalState(players, seed);
      for (let seat = 0; seat < players; seat++) {
        for (const kind of STAGEABLE_FRAMES) {
          const source = asActor(final, seat);
          const rng = seededRng(seat * 31 + seed);
          if (!stageFrame(source, kind, rng)) continue;
          staged.add(kind);
          const frame = source.pending as { kind: string; responders: string[] };
          expect(frame.kind).toBe(kind);
          const responder = frame.responders[0]!;
          const command = citiesKnightsDuty(viewOf(source, responder), responder);
          expect(command, `${kind} (${players}p, seat ${seat})`).not.toBeNull();
          const outcome = applyCommand(source, responder, command as Command, seededRng(1));
          expect(outcome.ok, `${kind}: ${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
        }
      }
    }
    // 所有種類都在某個盤面佈置成功過。
    expect([...staged].sort()).toEqual([...STAGEABLE_FRAMES].sort());
  }, SIM_TIMEOUT);

  it('stageFrame refuses outside the action phase, over a pending effect, and when nothing qualifies', () => {
    const source = asActor(state(), 0);
    const rng = seededRng(1);
    const preroll = clone(source);
    preroll.turn.phase = 'preroll';
    expect(stageFrame(preroll, STAGEABLE_FRAMES[0]!, rng)).toBe(false);
    const pending = clone(source);
    expect(stageFrame(pending, 'citiesKnights.scienceBonus', rng)).toBe(true);
    expect(stageFrame(pending, 'citiesKnights.scienceBonus', rng)).toBe(false);
    expect(stageFrame(clone(source), 'citiesKnights.resolveRoll', rng)).toBe(false);
    const empty = emptyCkGame(4, 0, 'action');
    expect(stageFrame(empty, 'citiesKnights.displaced', rng)).toBe(false);
    expect(empty.pending).toBeNull();
    expect(cloneState(empty)).toEqual(empty);
  });
});
