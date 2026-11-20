/**
 * T&B 變體 Friendly Robber 與 Harbors 的策略測試（T&B 計畫 §4.2 variants 列、§6.1；S3）：固定盤面、B-FAIR 與決定性。
 * B-GAME 與 Q2 依 profile 拆檔（Q2 要合計 3、4 人共 2S 局）：'tb-friendly-robber-2025' 在 `tb-variants-fr.test.ts`、
 * 'tb-harbors-2025' 在 `tb-variants-h.test.ts`、'tb-friendly-robber-harbors-2025' 在 `tb-variants-frh.test.ts`。
 *
 * - FR：`moveRobber` 的 fold 是 hints 的 `robberHexes`（全部受保護時只剩沙漠，策略也送沙漠並被接受）；standard 在集合內選
 *   base 評分最高的格；打騎士卡時去掉強盜現位格，沒有別的格可去就不打；hints 缺漏時原樣回傳。
 * - H：`portBonus` 的取捨（拿到、守住、還差幾分）；standard 為了拿 Strongest Ports 改蓋港口聚落（不估港口的模組選別處），
 *   引擎接受並轉手板塊；港口計畫（`scoreExtras`）與它的下一步（`planStep`）；easy 不估。
 * - B-FAIR：FR+H 的對局狀態，只擾動對手手牌與發展卡牌庫（兩個變體都沒有自己的隱藏資訊），決策不變。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  COSTS,
  projectGame,
  seededRng,
  topologyOf,
  type Command,
  type GameState,
  type GameView,
  type Resource,
} from '@katan/rules';
import { scriptedRng, setHand } from '../../rules/test/helpers.ts';
import { clearBoard, tbPlayable } from '../../rules/test/tb-helpers.ts';
import { robberCandidates } from '../src/base/robber.ts';
import { heuristicPolicy, turnContext } from '../src/heuristic.ts';
import { createTradersBarbariansModule } from '../src/modules/tradersBarbarians/index.ts';
import { TB_PART_BOTS } from '../src/modules/tradersBarbarians/parts.ts';
import {
  friendlyRobberBot,
  harborsBot,
  PORT_SETTLEMENT_PLAN,
  portActions,
  portBonus,
  portPlans,
} from '../src/modules/tradersBarbarians/variants.ts';
import { tbRobberHexes } from '../src/modules/tradersBarbarians/view.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import type { BotCommand, BotContext, BotLevel } from '../src/types.ts';
import { cloneState, GAME_TIMEOUT, hideDifferently, viewFor } from './harness.ts';
import { tradersBarbariansKit } from './modules/tradersBarbarians.ts';
import { partStateOf } from './modules/tb/part.ts';
import { runTbGame, tbMatrix } from './tb-game.ts';

const FR = 'tb-friendly-robber-2025';
const H = 'tb-harbors-2025';
const FRH = 'tb-friendly-robber-harbors-2025';
const LEVELS: readonly BotLevel[] = ['standard', 'easy'];

function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 1): BotContext => ({ selfId, level, seed, offerPhases: {} });

const decide = (state: GameState, playerId: string, level: BotLevel): BotCommand | null =>
  createBotPolicy(level).decide(viewOf(state, playerId), ctxFor(playerId, level));

function accept(state: GameState, actor: string, command: BotCommand | null | undefined, rng = seededRng(5)): GameState {
  expect(command, `${actor} has a command`).toBeTruthy();
  const outcome = applyCommand(state, actor, command as Command, rng);
  if (!outcome.ok) expect.fail(`${JSON.stringify(command)} → ${outcome.error.code} ${JSON.stringify(outcome.error.params)}`);
  return outcome.state;
}

/** 擲出指定點數（兩顆骰子的 `rng.int(6)` 值）。 */
const dice = (total: number) => {
  const first = Math.max(1, Math.min(6, total - 1));
  return scriptedRng([first - 1, total - first - 1]);
};

// ---------------------------------------------------------------------------
// Friendly Robber
// ---------------------------------------------------------------------------

/** 全部受保護的盤面（FR3，`rules/test/tb-variants.test.ts`）：p1 只有 2 VP，建築碰到沙漠以外的每一格；強盜在沙漠。 */
function everyoneProtected(phase: 'preroll' | 'action' = 'preroll'): { state: GameState; desert: number } {
  const state = tbPlayable(FR, { mode: 'fixed', phase });
  clearBoard(state);
  for (const player of state.players) setHand(state, player.id, {});
  const topology = topologyOf(state);
  const desert = state.board.layout.terrain.indexOf('desert');
  const uncovered = new Set(state.board.layout.terrain.map((_, hex) => hex).filter((hex) => hex !== desert));
  let placed = 0;
  for (let vertex = 0; vertex < topology.vertices.length && uncovered.size > 0; vertex++) {
    const hexes = topology.vertices[vertex]!.hexes.filter((hex) => uncovered.has(hex));
    if (hexes.length === 0 || topology.vertices[vertex]!.hexes.includes(desert)) continue;
    state.board.buildings[vertex] = { player: 'p1', city: false };
    placed += 1;
    for (const hex of hexes) uncovered.delete(hex);
  }
  state.players[0]!.bonusPoints = 2 - placed;
  expect(state.board.robber).toBe(desert);
  return { state, desert };
}

/** p1 手上有一張可以打的騎士卡，已打過 2 張：standard 會為了最大騎士團打它（`eagerKnights`）。 */
function withKnight(state: GameState): GameState {
  state.players[0]!.devCards = ['knight'];
  state.players[0]!.playedKnights = 2;
  return state;
}

describe('Friendly Robber: the robber fold is the hints’ robberHexes', () => {
  it('moves the robber within robberHexes, to the hex base scores highest (standard)', () => {
    const state = tbPlayable(FR, { seed: 2, phase: 'preroll' });
    for (const player of state.players) setHand(state, player.id, {});
    setHand(state, 'p2', { ore: 2 });
    // p2 的兩座聚落都升級成城市：4 VP，不再受保護；p3 仍受保護。
    state.board.buildings = state.board.buildings.map((building) => (building?.player === 'p2' ? { ...building, city: true } : building));
    const rolled = accept(state, 'p1', { type: 'turn.roll' }, dice(7));
    const view = viewOf(rolled, 'p1');
    const hexes = tbRobberHexes(view.hints)!;
    expect(friendlyRobberBot.robberTargets!(view, 'p1', [])).toEqual(hexes);
    // 受保護的 p3 的格不在集合內。
    const topology = topologyOf(rolled);
    const p3Hexes = new Set(
      rolled.board.buildings.flatMap((building, vertex) => (building?.player === 'p3' ? topology.vertices[vertex]!.hexes : [])),
    );
    expect(hexes.some((hex) => p3Hexes.has(hex))).toBe(false);

    const turn = turnContext(view, ctxFor('p1'), 'standard');
    const best = robberCandidates(turn)
      .filter((candidate) => hexes.includes(candidate.item))
      .sort((a, b) => b.score - a.score)[0]!;
    const move = decide(rolled, 'p1', 'standard');
    expect(move).toEqual({ type: 'pending.moveRobber', hex: best.item });
    for (const level of LEVELS) {
      const answer = decide(rolled, 'p1', level);
      expect(hexes, level).toContain((answer as { hex: number }).hex);
      accept(rolled, 'p1', answer);
    }
  });

  it('keeps the robber on the desert when everyone is protected, for both levels', () => {
    const { state, desert } = everyoneProtected();
    const rolled = accept(state, 'p1', { type: 'turn.roll' }, dice(7));
    const view = viewOf(rolled, 'p1');
    expect(tbRobberHexes(view.hints)).toEqual([desert]);
    expect(friendlyRobberBot.robberTargets!(view, 'p1', [1, 2])).toEqual([desert]);
    for (const level of LEVELS) {
      const answer = decide(rolled, 'p1', level);
      expect(answer, level).toEqual({ type: 'pending.moveRobber', hex: desert });
      expect(accept(rolled, 'p1', answer).board.robber).toBe(desert);
    }
  });

  it('plays a Knight only when it can move the robber somewhere else', () => {
    // 全部受保護、強盜在沙漠：唯一合法格就是現位格，騎士卡沒有目標，不打。
    const { state } = everyoneProtected();
    withKnight(state);
    const view = viewOf(state, 'p1');
    expect(friendlyRobberBot.robberTargets!(view, 'p1', [])).toEqual([]);
    expect(decide(state, 'p1', 'standard')).toEqual({ type: 'turn.roll' });

    // 有人不受保護：照樣打，目標在 robberHexes 內、不是現位格，引擎接受。
    const open = withKnight(tbPlayable(FR, { seed: 2, phase: 'preroll' }));
    open.board.buildings = open.board.buildings.map((building) => (building?.player === 'p2' ? { ...building, city: true } : building));
    const hexes = tbRobberHexes(viewOf(open, 'p1').hints)!;
    const knight = decide(open, 'p1', 'standard') as { type: string; hex: number };
    expect(knight.type).toBe('dev.playKnight');
    expect(hexes).toContain(knight.hex);
    expect(knight.hex).not.toBe(open.board.robber);
    accept(open, 'p1', knight);
  });

  it('returns the received set when the hints have no robberHexes', () => {
    const view = viewOf(tbPlayable(FR, { seed: 2 }), 'p1');
    const bare = { ...view, hints: undefined } as unknown as GameView;
    expect(friendlyRobberBot.robberTargets!(bare, 'p1', [3, 5])).toEqual([3, 5]);
  });
});

// ---------------------------------------------------------------------------
// Harbors
// ---------------------------------------------------------------------------

describe('Harbors: Strongest Ports value', () => {
  const standing = (points: Record<string, number>, holder: string | null = null) => ({ holder, points });

  it('values the build that takes the tile at 2 VP, defends it when tied, and gives a little for progress', () => {
    expect(portBonus(standing({ p1: 2, p2: 0 }), 'p1')).toBe(2);
    expect(portBonus(standing({ p1: 3, p2: 3 }, 'p2'), 'p1')).toBe(2);
    // 必須嚴格超過持有者：3 對 3 不轉手，還差 2 分。
    expect(portBonus(standing({ p1: 2, p2: 3 }, 'p2'), 'p1')).toBeCloseTo(0.3);
    // 沒有持有者、但有人並列 3 分：同樣要超過最高者。
    expect(portBonus(standing({ p1: 2, p2: 3, p3: 3 }), 'p1')).toBeCloseTo(0.3);
    expect(portBonus(standing({ p1: 0, p2: 0 }), 'p1')).toBeCloseTo(0.2);
    // 持有者：被追平時守住有價值，領先時沒有。
    expect(portBonus(standing({ p1: 3, p2: 3 }, 'p1'), 'p1')).toBeCloseTo(0.7);
    expect(portBonus(standing({ p1: 4, p2: 2 }, 'p1'), 'p1')).toBe(0);
  });
});

interface PortBoard {
  readonly state: GameState;
  /** 要搶的港口路口與通往它的最後一條路。 */
  readonly port: number;
  readonly lastRoad: number;
  /** 另一個合法的非港口聚落點。 */
  readonly other: number;
}

/**
 * p1 在港口 A 有一座城市（2 分），從聚落 M 有兩條路線：一條通到港口 C、一條通到非港口 D，兩個都是合法聚落點；手上剛好一份聚落。
 * 依路口編號找第一個「不估港口的模組選 D」的盤面，讓 standard 的選擇只能來自 Strongest Ports 的價值。
 */
function portBoard(): PortBoard {
  const withoutHarbors = createTradersBarbariansModule(new Map([...TB_PART_BOTS].filter(([id]) => id !== 'harbors')));
  const base = tbPlayable(H, { players: 3, seed: 4 });
  const topology = topologyOf(base);
  const ports = new Set(base.board.layout.harbors.flatMap((harbor) => topology.edges[harbor.edge]!.vertices));
  const neighbors = (vertex: number): number[] =>
    topology.vertices[vertex]!.edges.map((edge) => topology.edges[edge]!.vertices.find((other) => other !== vertex)!);
  const edgeBetween = (a: number, b: number): number =>
    topology.vertices[a]!.edges.find((edge) => topology.edges[edge]!.vertices.includes(b))!;
  const near = (a: number, b: number): boolean => a === b || neighbors(a).includes(b);

  for (const port of [...ports].sort((a, b) => a - b)) {
    for (const n of neighbors(port)) {
      for (const m of neighbors(n)) {
        if (m === port || near(m, port) || ports.has(m) || ports.has(n)) continue;
        for (const x of neighbors(m)) {
          if (x === n || near(x, port)) continue;
          for (const other of neighbors(x)) {
            if (other === m || near(other, m) || near(other, port) || near(other, n) || ports.has(other) || ports.has(x)) continue;
            const city = [...ports].find((a) => [port, n, m, x, other].every((v) => !near(a, v) && !neighbors(a).some((w) => near(w, v))));
            if (city === undefined) continue;
            const state = cloneState(base);
            clearBoard(state);
            for (const player of state.players) setHand(state, player.id, {});
            state.board.buildings[city] = { player: 'p1', city: true };
            state.board.buildings[m] = { player: 'p1', city: false };
            for (const [a, b] of [
              [m, n],
              [n, port],
              [m, x],
              [x, other],
            ] as const) {
              state.board.roads[edgeBetween(a, b)] = { player: 'p1', ship: false };
            }
            setHand(state, 'p1', COSTS.settlement as Partial<Record<Resource, number>>);
            const view = viewOf(state, 'p1');
            const legal = view.hints!.legalSettlements;
            if (!legal.includes(port) || !legal.includes(other)) continue;
            const plain = heuristicPolicy('standard', [withoutHarbors]).decide(view, ctxFor('p1'));
            if (plain?.type === 'build.settlement' && (plain as { vertex: number }).vertex === other) {
              return { state, port, lastRoad: edgeBetween(n, port), other };
            }
          }
        }
      }
    }
  }
  throw new Error('no port board found');
}

describe('Harbors: building for Strongest Ports (standard only)', () => {
  const fixture = portBoard();

  it('builds the port settlement that takes the tile, where a module without Harbors builds elsewhere', () => {
    const { state, port } = fixture;
    const turn = turnContext(viewOf(state, 'p1'), ctxFor('p1'), 'standard');
    const candidates = portActions(turn);
    expect(candidates.map((candidate) => candidate.item)).toContainEqual({ type: 'build.settlement', vertex: port });
    const build = decide(state, 'p1', 'standard');
    expect(build).toEqual({ type: 'build.settlement', vertex: port });
    const after = accept(state, 'p1', build);
    expect(partStateOf<{ holder: string | null }>(after, 'harbors')?.holder).toBe('p1');
    // easy 不估 Strongest Ports。
    expect(portActions(turnContext(viewOf(state, 'p1'), ctxFor('p1', 'easy'), 'easy'))).toEqual([]);
    accept(state, 'p1', decide(state, 'p1', 'easy'));
  });

  it('plans the road to the port and takes its next step through planStep', () => {
    const { state, port, lastRoad } = fixture;
    const short = cloneState(state);
    short.board.roads[lastRoad] = null;
    setHand(short, 'p1', COSTS.road as Partial<Record<Resource, number>>);
    const turn = turnContext(viewOf(short, 'p1'), ctxFor('p1'), 'standard');
    const plans = portPlans({ model: turn.model, level: 'standard', base: turn.economy });
    const plan = plans.find((candidate) => candidate.kind === PORT_SETTLEMENT_PLAN && candidate.vertex === port)!;
    expect(plan).toMatchObject({ roads: [lastRoad], nextCost: COSTS.road });
    expect(harborsBot.planStep!(turn, plan)).toEqual({ type: 'build.road', edge: lastRoad });
    expect(harborsBot.planStep!(turn, { ...plan, kind: 'city' })).toBeUndefined();
    // 主要計畫是一個港口聚落（拿下板塊的 2 VP 讓它排在 base 的聚落之前），策略照它的下一步鋪路。
    const primary = turn.economy.plans[0]!;
    expect(primary.kind).toBe(PORT_SETTLEMENT_PLAN);
    const road = decide(short, 'p1', 'standard');
    expect(road).toEqual(harborsBot.planStep!(turn, primary));
    expect(road?.type).toBe('build.road');
    accept(short, 'p1', road);
    // easy 沒有港口計畫。
    expect(portPlans({ model: turn.model, level: 'easy', base: turn.economy })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B-FAIR
// ---------------------------------------------------------------------------

describe('B-FAIR hidden information (FR + Harbors)', () => {
  const states: GameState[] = [];
  for (const players of [3, 4]) {
    let step = 0;
    runTbGame(
      { ...tbMatrix(FRH, players)[0]!, seed: 7, label: `${FRH} ${players}p snapshots` },
      {
        onDecision: (state) => {
          if (step++ % 7 === 0 && !state.result) states.push(cloneState(state));
        },
      },
    );
  }

  for (const level of LEVELS) {
    it(
      `decides identically when only opponents' hands and the development deck differ (${level})`,
      () => {
        const policy = createBotPolicy(level);
        let compared = 0;
        for (const state of states) {
          for (const player of state.players) {
            const { variant, changed } = hideDifferently(state, player.id, [tradersBarbariansKit]);
            if (!changed) continue;
            const original = viewFor(state, player.id);
            const altered = viewFor(variant, player.id);
            expect(JSON.stringify(altered), `seq ${state.seq} ${player.id}: projection changed`).toBe(JSON.stringify(original));
            const ctx = ctxFor(player.id, level, botSeed('fair', player.id, state.seq));
            expect(policy.decide(altered, ctx), `seq ${state.seq} ${player.id}`).toEqual(policy.decide(original, ctx));
            compared += 1;
          }
        }
        expect(compared).toBeGreaterThanOrEqual(100);
      },
      GAME_TIMEOUT,
    );
  }
});
