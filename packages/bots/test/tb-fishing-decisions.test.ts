/**
 * Fishing on Catan 的固定盤面、B-FAIR 與 fuzz（T&B 計畫 §4.2、§6.1；S4）。
 *
 * 固定盤面以 rules 的測試工具建好（`tbPlayable` 之後直接改魚片、手牌、建築與強盜），每個決策都要被 `applyCommand` 接受：
 * - 付款：超付最少，同超付時用掉較多片；
 * - 花魚：7 條換發展卡（道路存量用完時，即使 hints 還列著道路也不買道路，G13）、5 條鋪計畫路線上的道路、4 條補齊下一步的資源
 *   （接著就蓋）、3 條偷領先者、2 條移走擋住自己的強盜；easy 不偷牌、不移強盜；
 * - 舊靴交給公開分數最高的對象；自己嚴格領先時沒有對象；
 * - `fishSwap`：standard 只換面額 1（非行動者也一樣），easy 放棄；
 * - 初始放置：base 的評分加上魚場與湖的點數。
 * B-FAIR：擾動對手的魚片面額與蓋著的 supply 組成（kit 的 `hideDifferently`）與對手手牌，投影相同、決策相同。
 * fuzz：kit 的 `perturb` 加上 harness 的手牌擾動；每個座位的答案都被接受，或是 null 且不欠動作。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  FISH_SUPPLY,
  projectGame,
  seededRng,
  topologyOf,
  type Command,
  type GameState,
  type GameView,
  type Resource,
  type Rng,
} from '@catan/rules';
import { placeBuilding, placeRoad, scriptedRng, setHand } from '../../rules/test/helpers.ts';
import { tbCreate, tbPlayable } from '../../rules/test/tb-helpers.ts';
import { setupSpotScore } from '../src/base/setup.ts';
import { pipsOf, roadStockLeft } from '../src/board.ts';
import { deficitOf } from '../src/economy.ts';
import { botOwesAction, fallbackPolicy } from '../src/fallback.ts';
import { turnContext } from '../src/heuristic.ts';
import {
  fishCandidates,
  fishPipsAt,
  FISH_PIP_WEIGHT,
  paymentFor,
} from '../src/modules/tradersBarbarians/fishing.ts';
import { TB_FRAME_KINDS } from '../src/modules/tradersBarbarians/frames.ts';
import { tbTargets } from '../src/modules/tradersBarbarians/view.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import type { BotCommand, BotContext, BotLevel, BotPolicy } from '../src/types.ts';
import { botSeats, cloneState, GAME_TIMEOUT, hideDifferently, mixedLevels, perturbState, runBotGame, viewFor } from './harness.ts';
import { tbConservationProblems, tradersBarbariansKit } from './modules/tradersBarbarians.ts';
import { partStateOf } from './modules/tb/part.ts';

const PROFILE = 'tb-fishing-2025';
const KITS = [tradersBarbariansKit];
const LEVELS: readonly BotLevel[] = ['standard', 'easy'];
const RESOURCE_LIST: readonly Resource[] = ['lumber', 'brick', 'wool', 'grain', 'ore'];

interface Slot {
  grounds: { number: number; vertices: number[] }[];
  lake: number;
  supply: { fish: [number, number, number]; boot: number };
  discard: [number, number, number];
  hands: Record<string, number[]>;
  boot: string | null;
}

const slotOf = (state: GameState): Slot => partStateOf<Slot>(state, 'tb-fishing')!;
const viewOf = (state: GameState, id: string): GameView => projectGame(state, id, { hints: actionHints(state, id) });
const ctxFor = (selfId: string, level: BotLevel): BotContext => ({ selfId, level, seed: 3, offerPhases: {} });
const decide = (state: GameState, id: string, level: BotLevel): BotCommand | null =>
  createBotPolicy(level).decide(viewOf(state, id), ctxFor(id, level));
const turnOf = (state: GameState, id: string, level: BotLevel = 'standard') => turnContext(viewOf(state, id), ctxFor(id, level), level);

function accept(state: GameState, actor: string, command: BotCommand | null | undefined, rng: Rng = seededRng(5)): GameState {
  expect(command, `${actor} has a command`).toBeTruthy();
  const outcome = applyCommand(state, actor, command as Command, rng);
  if (!outcome.ok) expect.fail(`${JSON.stringify(command)} → ${outcome.error.code} ${JSON.stringify(outcome.error.params)}`);
  return outcome.state;
}

/** 指令的欄位（BotCommand 的聯集沒有共同的欄位型別）。 */
const field = (command: BotCommand | null, key: string): unknown => (command as unknown as Record<string, unknown> | null)?.[key];

/** 把 `id` 的魚片換成 `tokens`：舊的歸還 supply，新的從 supply 取（守恆不變）。 */
function setFish(state: GameState, id: string, tokens: number[]): void {
  const slot = slotOf(state);
  for (const token of slot.hands[id] ?? []) slot.supply.fish[token - 1]! += 1;
  for (const token of tokens) slot.supply.fish[token - 1]! -= 1;
  slot.hands[id] = [...tokens];
}

/** p1 的行動階段：所有人沒有手牌、沒有魚，強盜在盤外。 */
function game(players = 3, seed = 9): GameState {
  const state = tbPlayable(PROFILE, { seed, players });
  for (const player of state.players) {
    setHand(state, player.id, {});
    setFish(state, player.id, []);
  }
  const slot = slotOf(state);
  slot.boot = null;
  slot.supply.boot = 1;
  state.board.robber = -1;
  return state;
}

/** 在空的邊上補 p1 的道路，直到用完道路存量（不必相連：只用來扣存量）。 */
function exhaustRoads(state: GameState): void {
  const topo = topologyOf(state);
  let left = roadStockLeft(viewOf(state, 'p1'), 'p1');
  for (let edge = topo.edges.length - 1; edge >= 0 && left > 0; edge--) {
    const [a, b] = topo.edges[edge]!.vertices;
    if (state.board.roads[edge] || state.board.buildings[a] || state.board.buildings[b]) continue;
    placeRoad(state, 'p1', edge);
    left -= 1;
  }
  expect(roadStockLeft(viewOf(state, 'p1'), 'p1')).toBe(0);
}

/** `id` 的一座聚落升級成城市（公開分數 +1）。 */
function upgrade(state: GameState, id: string): number {
  const vertex = state.board.buildings.findIndex((building) => building?.player === id && !building.city);
  expect(vertex, `${id} has a settlement`).toBeGreaterThanOrEqual(0);
  placeBuilding(state, id, vertex, true);
  return vertex;
}

/** 擲出 `total` 的骰（scripted rng 的值從 0 起算）。 */
function dice(total: number): [number, number] {
  const first = Math.max(1, Math.min(6, total - 1));
  return [first - 1, total - first - 1];
}

describe('paying with fish tokens', () => {
  it('overpays as little as possible and then uses the most tokens', () => {
    expect(paymentFor([3, 1, 2, 1], 4)).toEqual({ tokens: [1, 1, 2], paid: 4 });
    expect(paymentFor([3, 3, 3], 7)).toEqual({ tokens: [3, 3, 3], paid: 9 });
    expect(paymentFor([3, 2, 2], 5)).toEqual({ tokens: [2, 3], paid: 5 });
    expect(paymentFor([2, 3], 2)).toEqual({ tokens: [2], paid: 2 });
    expect(paymentFor([3, 3], 7)).toBeNull();
    expect(paymentFor([], 2)).toBeNull();
  });
});

describe('spending fish', () => {
  it('buys a development card with 7 fish, and no road once the road stock is used up (G13)', () => {
    const state = game();
    exhaustRoads(state);
    setFish(state, 'p1', [1, 3, 3]);
    // fishing 的道路 hints 不扣存量：hints 仍列著道路。
    expect(tbTargets(viewOf(state, 'p1').hints, 'tb.spendFish').length).toBeGreaterThan(0);
    const candidates = fishCandidates(turnOf(state, 'p1'));
    expect(candidates.map((candidate) => field(candidate.item, 'action'))).not.toContain('road');
    for (const level of LEVELS) {
      const command = decide(state, 'p1', level);
      expect(command, level).toEqual({ type: 'tb.spendFish', action: 'devCard', tokens: [1, 3, 3] });
      const next = accept(state, 'p1', command);
      expect(next.players[0]!.newDevCards, level).toHaveLength(1);
      expect(slotOf(next).hands.p1, level).toEqual([]);
    }
  });

  it('lays a road on the plan route with 5 fish', () => {
    const state = game();
    setFish(state, 'p1', [2, 3]);
    for (const level of LEVELS) {
      const turn = turnOf(state, 'p1', level);
      const targets = new Set(tbTargets(turn.view.hints, 'tb.spendFish'));
      const plan = turn.economy.plans.find(
        (candidate) => (candidate.kind === 'settlement' || candidate.kind === 'longestRoad') && targets.has(candidate.roads[0] ?? -1),
      );
      expect(plan, `${level}: a plan road the fish can buy`).toBeDefined();
      const command = decide(state, 'p1', level);
      expect(command, level).toEqual({ type: 'tb.spendFish', action: 'road', tokens: [2, 3], edge: plan!.roads[0] });
      const next = accept(state, 'p1', command);
      expect(next.board.roads[plan!.roads[0]!], level).toMatchObject({ player: 'p1' });
    }
  });

  it('takes the one resource that completes the next build, then builds', () => {
    const state = game();
    setFish(state, 'p1', [1, 3]);
    // 從主要計畫的下一步少一張的手牌找起：重算之後主要計畫的下一步剛好缺 1 張。
    const cost = turnOf(state, 'p1').economy.plans[0]!.nextCost;
    let missing: Resource | null = null;
    for (const resource of RESOURCE_LIST) {
      if (!(cost[resource] ?? 0)) continue;
      const hand = Object.fromEntries(RESOURCE_LIST.map((kind) => [kind, (cost[kind] ?? 0) - (kind === resource ? 1 : 0)]));
      setHand(state, 'p1', hand);
      const turn = turnOf(state, 'p1');
      const deficit = deficitOf(turn.economy.hand, turn.economy.plans[0]!.nextCost);
      if (RESOURCE_LIST.reduce((sum, kind) => sum + deficit[kind], 0) === 1) {
        missing = RESOURCE_LIST.find((kind) => deficit[kind] > 0)!;
        break;
      }
    }
    expect(missing, 'a hand one card short of the next build').not.toBeNull();
    for (const level of LEVELS) {
      const command = decide(state, 'p1', level);
      expect(command, level).toEqual({ type: 'tb.spendFish', action: 'takeResource', tokens: [1, 3], resource: missing });
      const next = accept(state, 'p1', command);
      const build = decide(next, 'p1', 'standard');
      expect(String(build?.type), level).toMatch(/^build\./);
      accept(next, 'p1', build);
    }
  });

  it('steals from the leader with 3 fish at standard; easy keeps them', () => {
    const state = game();
    setFish(state, 'p1', [3]);
    setHand(state, 'p2', { ore: 3 });
    setHand(state, 'p3', { wool: 1 });
    upgrade(state, 'p3');
    const command = decide(state, 'p1', 'standard');
    expect(command).toEqual({ type: 'tb.spendFish', action: 'steal', tokens: [3], victim: 'p3' });
    const next = accept(state, 'p1', command);
    expect(next.players[0]!.resources.wool).toBe(1);
    expect(field(decide(state, 'p1', 'easy'), 'type')).not.toBe('tb.spendFish');
  });

  it('does not steal for 3 fish when nobody leads it (the fish wait for a better use)', () => {
    const state = game();
    setFish(state, 'p1', [3]);
    setHand(state, 'p2', { ore: 3 });
    upgrade(state, 'p1');
    expect(fishCandidates(turnOf(state, 'p1'))).toEqual([]);
  });

  it('removes the robber from its own city with 2 fish at standard only', () => {
    const state = game();
    setFish(state, 'p1', [2]);
    const vertex = upgrade(state, 'p1');
    const hexes = topologyOf(state).vertices[vertex]!.hexes;
    const pips = (hex: number) => pipsOf(state.board.layout.numbers[hex]);
    state.board.robber = hexes.reduce((best, hex) => (pips(hex) > pips(best) ? hex : best));
    expect(pips(state.board.robber)).toBeGreaterThanOrEqual(3);
    const command = decide(state, 'p1', 'standard');
    expect(command).toEqual({ type: 'tb.spendFish', action: 'removeRobber', tokens: [2] });
    expect(accept(state, 'p1', command).board.robber).toBe(-1);
    expect(field(decide(state, 'p1', 'easy'), 'type')).not.toBe('tb.spendFish');
  });
});

describe('the old boot', () => {
  it('hands the boot to the highest-scoring eligible player at once', () => {
    const state = game(4);
    const slot = slotOf(state);
    slot.boot = 'p1';
    slot.supply.boot = 0;
    upgrade(state, 'p3');
    for (const level of LEVELS) {
      const command = decide(state, 'p1', level);
      expect(command, level).toEqual({ type: 'tb.giveBoot', to: 'p3' });
      expect(slotOf(accept(state, 'p1', command)).boot, level).toBe('p3');
    }
  });

  it('keeps the boot when every other player scores less', () => {
    const state = game(3);
    const slot = slotOf(state);
    slot.boot = 'p1';
    slot.supply.boot = 0;
    upgrade(state, 'p1');
    for (const level of LEVELS) expect(field(decide(state, 'p1', level), 'type'), level).not.toBe('tb.giveBoot');
  });
});

describe('fishSwap at the token limit', () => {
  /** `holder` 持有 7 片魚、在一個魚場旁邊有建築；p1 擲出那個魚場的號碼，`holder` 收到 `fishSwap`。 */
  function swapFrame(holder: string, tokens: number[]): GameState {
    const state = game(3);
    state.turn.phase = 'preroll';
    const ground = slotOf(state).grounds.find((candidate) => candidate.vertices.every((vertex) => !state.board.buildings[vertex]))!;
    expect(ground, 'an empty fishing ground').toBeDefined();
    placeBuilding(state, holder, ground.vertices[0]!);
    setFish(state, holder, tokens);
    const rolled = accept(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice(ground.number)));
    expect(rolled.pending).toMatchObject({ kind: TB_FRAME_KINDS.fishSwap, responders: [holder] });
    return rolled;
  }

  it('swaps a one-fish token at standard and declines at easy (actor and non-actor)', () => {
    for (const holder of ['p1', 'p2']) {
      const state = swapFrame(holder, [1, 1, 2, 2, 3, 3, 3]);
      const standard = decide(state, holder, 'standard');
      expect(standard, holder).toEqual({ type: 'tb.fishSwap', token: 1 });
      expect(slotOf(accept(state, holder, standard)).discard[0], holder).toBe(1);
      const easy = decide(state, holder, 'easy');
      expect(easy, holder).toEqual({ type: 'tb.fishSwap', token: null });
      accept(state, holder, easy);
      // 其他座位不作答。
      const other = holder === 'p1' ? 'p2' : 'p1';
      expect(decide(state, other, 'standard'), other).toBeNull();
    }
  });

  it('declines when no one-fish token is held', () => {
    const state = swapFrame('p1', [2, 2, 2, 3, 3, 3, 3]);
    const command = decide(state, 'p1', 'standard');
    expect(command).toEqual({ type: 'tb.fishSwap', token: null });
    expect(accept(state, 'p1', command).pending).toBeNull();
  });
});

describe('setup next to the fish', () => {
  it('adds the fishing ground and lake pips to the base setup score', () => {
    const state = tbCreate(PROFILE, { seed: 4, players: 3 });
    const view = viewOf(state, 'p1');
    const turn = turnOf(state, 'p1');
    const slot = slotOf(state);
    const ground = slot.grounds[0]!;
    const hexesOf = (vertex: number): number[] => topologyOf(state).vertices[vertex]!.hexes;
    expect(fishPipsAt(view, hexesOf(ground.vertices[0]!), ground.vertices[0]!)).toBe(pipsOf(ground.number));
    const lakeVertex = topologyOf(state).vertices.findIndex((info) => info.hexes.includes(slot.lake));
    expect(fishPipsAt(view, hexesOf(lakeVertex), lakeVertex)).toBe(6);

    const legal = view.hints!.legalSettlements;
    const score = (vertex: number): number => setupSpotScore(turn, vertex) + fishPipsAt(view, hexesOf(vertex), vertex) * FISH_PIP_WEIGHT;
    const best = legal.reduce((top, vertex) => (score(vertex) > score(top) ? vertex : top));
    const command = decide(state, 'p1', 'standard');
    expect(command).toEqual({ type: 'setup.placeBuilding', vertex: best });
    accept(state, 'p1', command);
  });
});

// ---------------------------------------------------------------------------
// B-FAIR 與 fuzz：真實對局的狀態
// ---------------------------------------------------------------------------

/** 3 人種子 61（每 5 步）與 4 人種子 62（每 7 步）的狀態，另加 `fishSwap` 進行中的狀態。 */
function samples(): GameState[] {
  const out: GameState[] = [];
  for (const [players, seed, every] of [
    [3, 61, 5],
    [4, 62, 7],
  ] as const) {
    const seats = botSeats(mixedLevels(players, seed), (level) => createBotPolicy(level));
    let step = 0;
    runBotGame({
      seats,
      seed,
      profileId: PROFILE,
      kits: KITS,
      onDecision: (state) => {
        if (state.result) return;
        if (step++ % every === 0 || state.pending?.kind === TB_FRAME_KINDS.fishSwap) out.push(cloneState(state));
      },
    });
  }
  return out;
}

let cached: GameState[] | null = null;
const states = (): GameState[] => (cached ??= samples());

describe('B-FAIR hidden information (opponent fish values, fish supply, opponent hands)', () => {
  it('collects mid-game states where opponents hold fish', () => {
    const all = states();
    expect(all.length).toBeGreaterThanOrEqual(60);
    const held = all.filter((state) => Object.values(slotOf(state).hands).filter((hand) => hand.length > 0).length >= 2);
    expect(held.length).toBeGreaterThanOrEqual(10);
  }, GAME_TIMEOUT);

  it('keeps the fish conservation when hiding differently', () => {
    for (const state of states()) {
      for (const player of state.players) {
        const { variant } = hideDifferently(state, player.id, KITS);
        expect(tbConservationProblems(variant)).toEqual([]);
        const counts = (s: GameState) => Object.fromEntries(Object.entries(slotOf(s).hands).map(([id, hand]) => [id, hand.length]));
        expect(counts(variant)).toEqual(counts(state));
        expect(slotOf(variant).hands[player.id]).toEqual(slotOf(state).hands[player.id]);
      }
    }
    expect(FISH_SUPPLY).toEqual([11, 10, 8]);
  }, GAME_TIMEOUT);

  for (const level of LEVELS) {
    it(`decides identically when only hidden information differs (${level})`, () => {
      const policy = createBotPolicy(level);
      let compared = 0;
      let fishChanged = 0;
      for (const state of states()) {
        for (const player of state.players) {
          const { variant, changed } = hideDifferently(state, player.id, KITS);
          if (!changed) continue;
          const original = viewFor(state, player.id);
          const altered = viewFor(variant, player.id);
          expect(JSON.stringify(altered), `seq ${state.seq} ${player.id}: projection changed`).toBe(JSON.stringify(original));
          if (JSON.stringify(slotOf(variant).hands) !== JSON.stringify(slotOf(state).hands)) fishChanged += 1;
          const ctx = { selfId: player.id, level, seed: botSeed('fair', player.id, state.seq), offerPhases: {} };
          expect(policy.decide(altered, ctx), `seq ${state.seq} ${player.id} ${state.pending?.kind ?? state.turn.phase}`).toEqual(
            policy.decide(original, ctx),
          );
          compared += 1;
        }
      }
      expect(compared, `compared ${compared} of ${states().length} states`).toBeGreaterThanOrEqual(100);
      expect(fishChanged, 'comparisons where opponent fish values changed').toBeGreaterThanOrEqual(20);
    }, GAME_TIMEOUT);
  }
});

describe('fuzz: perturbed fishing states', () => {
  const POLICIES: readonly (readonly [string, BotPolicy, BotLevel])[] = [
    ['standard', createBotPolicy('standard'), 'standard'],
    ['easy', createBotPolicy('easy'), 'easy'],
    ['fallback', fallbackPolicy, 'standard'],
  ];

  it('answers every perturbed state with an accepted command, or null when nothing is owed', () => {
    const rng = seededRng(97);
    const failures: string[] = [];
    let checked = 0;
    let spends = 0;
    for (const [index, state] of states().entries()) {
      const variant = perturbState(state, rng, KITS);
      const broken = tbConservationProblems(variant);
      if (broken.length > 0) failures.push(`#${index}: perturb broke conservation ${broken.join('; ')}`);
      for (const player of variant.players) {
        const view = viewFor(variant, player.id);
        for (const [name, policy, level] of POLICIES) {
          const ctx = { selfId: player.id, level, seed: botSeed('fuzz', player.id, variant.seq), offerPhases: {} };
          let command: BotCommand | null = null;
          try {
            command = policy.decide(view, ctx);
          } catch (error) {
            failures.push(`#${index} ${player.id} (${name}) threw ${String(error)}`);
            continue;
          }
          checked += 1;
          if (command) {
            if (command.type === 'tb.spendFish') spends += 1;
            const outcome = applyCommand(variant, player.id, command as Command, seededRng(1));
            if (!outcome.ok) failures.push(`#${index} ${player.id} (${name}) ${JSON.stringify(command)} → ${outcome.error.code}`);
          } else if (botOwesAction(view, player.id) !== null) {
            failures.push(`#${index} ${player.id} (${name}) returned null while owing an action`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(300);
    expect(spends, 'perturbed states where the strategy spent fish').toBeGreaterThan(0);
  }, GAME_TIMEOUT);
});
