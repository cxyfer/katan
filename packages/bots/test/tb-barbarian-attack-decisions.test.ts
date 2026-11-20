/**
 * Barbarian Attack 的固定盤面、B-FAIR 與 fuzz（T&B 計畫 §4.2、§6.1；S6）。
 *
 * 固定盤面以 rules 的測試工具建好（`tbPlayable` 之後直接擺蠻族、騎士、建築與 BA 牌庫的下一張），再用真實指令推進到 frame；
 * 每個決策都要被 `applyCommand` 接受：
 * - BA 卡：自己的沿海建築受到威脅時，計畫價值上升，standard 與 easy 都買卡；
 * - 被征服的格不生產（`economy.hexYield`）；
 * - 回合結束的騎士：走到可驅逐的格、驅逐後拿到俘虜；standard 在 grain 夠時加速，easy 不加速；城堡邊的騎士一定移走；
 * - Swift Knight 放在讓格子立刻可驅逐的邊；Knighthood 放在離蠻族最近的城堡邊；
 * - Capture 選解放自己的格；Treason 選最傷害領先者的走法（easy 取第一個）；偷牌選手牌最多的對手。
 * B-FAIR：擾動 BA 牌庫的順序（kit 的 `hideDifferently`）與對手手牌，投影相同、決策相同。
 * fuzz：kit 的 `perturb` 加上 harness 的手牌擾動；每個座位的答案都被接受，或是 null 且不欠動作。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  projectGame,
  seededRng,
  topologyOf,
  type Command,
  type GameState,
  type GameView,
  type PublicModulePendingView,
  type Resource,
  type Rng,
} from '@catan/rules';
import { placeBuilding, scriptedRng, setHand } from '../../rules/test/helpers.ts';
import { tbPlayable } from '../../rules/test/tb-helpers.ts';
import { vertexYield } from '../src/board.ts';
import { botOwesAction, fallbackPolicy } from '../src/fallback.ts';
import { turnContext } from '../src/heuristic.ts';
import { BA_CARD_PLAN, baCardValue } from '../src/modules/tradersBarbarians/barbarianAttack.ts';
import { TB_FRAME_KINDS } from '../src/modules/tradersBarbarians/frames.ts';
import { edgeDistances } from '../src/modules/tradersBarbarians/graph.ts';
import { tbPartView } from '../src/modules/tradersBarbarians/view.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import type { BotCommand, BotContext, BotLevel, BotPolicy } from '../src/types.ts';
import { botSeats, cloneState, GAME_TIMEOUT, hideDifferently, mixedLevels, perturbState, runBotGame, viewFor } from './harness.ts';
import { tbConservationProblems, tradersBarbariansKit } from './modules/tradersBarbarians.ts';
import { partStateOf } from './modules/tb/part.ts';

const BA = 'tb-barbarian-attack-2025';
const KITS = [tradersBarbariansKit];
const LEVELS: readonly BotLevel[] = ['standard', 'easy'];

interface Slot {
  castle: number;
  coastal: number[];
  barbarians: Record<number, number>;
  supply: number;
  knights: { player: string; edge: number }[];
  prisoners: Record<string, number>;
  deck: string[];
  discard: string[];
}

const slotOf = (state: GameState): Slot => partStateOf<Slot>(state, 'tb-barbarian-attack')!;
const viewOf = (state: GameState, id: string): GameView => projectGame(state, id, { hints: actionHints(state, id) });
const ctxFor = (selfId: string, level: BotLevel): BotContext => ({ selfId, level, seed: 3, offerPhases: {} });
const decide = (state: GameState, id: string, level: BotLevel): BotCommand | null =>
  createBotPolicy(level).decide(viewOf(state, id), ctxFor(id, level));

function accept(state: GameState, actor: string, command: BotCommand | null | undefined, rng: Rng = seededRng(5)): GameState {
  expect(command, `${actor} has a command`).toBeTruthy();
  const outcome = applyCommand(state, actor, command as Command, rng);
  if (!outcome.ok) expect.fail(`${JSON.stringify(command)} → ${outcome.error.code} ${JSON.stringify(outcome.error.params)}`);
  return outcome.state;
}

/** 指令的欄位（BotCommand 的聯集沒有共同的欄位型別）。 */
const field = (command: BotCommand | null, key: string): unknown => (command as unknown as Record<string, unknown> | null)?.[key];

const sumOf = (record: Record<string, number>): number => Object.values(record).reduce((total, count) => total + count, 0);

/** 只在 `counts` 的格放蠻族，其餘歸還 supply（守恆不變）。 */
function setBarbarians(state: GameState, counts: Record<number, number>): void {
  const slot = slotOf(state);
  slot.barbarians = { ...counts };
  slot.supply = 36 - sumOf(counts) - sumOf(slot.prisoners);
}

function setKnights(state: GameState, knights: { player: string; edge: number }[]): void {
  slotOf(state).knights = knights;
}

const edgesOfHex = (state: GameState, hex: number): number[] =>
  topologyOf(state).edges.flatMap((info, edge) => (info.hexes.includes(hex) ? [edge] : []));

const castleEdgesOf = (state: GameState): number[] => edgesOfHex(state, slotOf(state).castle);

/** 從 `from` 到 `targets` 中最近一條邊的步數；8 步內走不到時是 Infinity。 */
function distanceTo(state: GameState, from: number, targets: readonly number[]): number {
  if (targets.includes(from)) return 0;
  const distances = edgeDistances(topologyOf(state), from, 8);
  return Math.min(...targets.map((edge) => distances.get(edge) ?? Infinity));
}

/** 離 `targets` 剛好 `min`–`max` 步、不在城堡邊上的第一條邊。 */
function edgeAt(state: GameState, targets: readonly number[], min: number, max: number): number {
  const castle = new Set(castleEdgesOf(state));
  const edge = topologyOf(state).edges.findIndex((_, index) => {
    if (castle.has(index)) return false;
    const distance = distanceTo(state, index, targets);
    return distance >= min && distance <= max;
  });
  expect(edge, `an edge ${min}–${max} steps away`).toBeGreaterThanOrEqual(0);
  return edge;
}

/** 這一格上一個空的、周圍也沒有建築的路口（擺建築用）。 */
function freeVertexOf(state: GameState, hex: number, avoid: readonly number[] = []): number {
  const topo = topologyOf(state);
  const vertex = topo.vertices.findIndex((info, index) => {
    if (!info.hexes.includes(hex) || info.hexes.some((other) => avoid.includes(other)) || state.board.buildings[index]) return false;
    return info.edges.every((edge) => topo.edges[edge]!.vertices.every((other) => !state.board.buildings[other]));
  });
  expect(vertex, `a free vertex on hex ${hex}`).toBeGreaterThanOrEqual(0);
  return vertex;
}

/** p1 在行動階段買 BA 卡，牌庫的下一張是 `card`。 */
function buyCard(state: GameState, card: string): GameState {
  const slot = slotOf(state);
  slot.discard = [...slot.discard, ...slot.deck];
  slot.deck = [card];
  slot.discard.splice(slot.discard.indexOf(card), 1);
  setHand(state, 'p1', { wool: 1, grain: 1, ore: 1 });
  return accept(state, 'p1', { type: 'tb.buildBaCard' });
}

function frameOf(state: GameState): PublicModulePendingView {
  return viewOf(state, 'p1').pending as PublicModulePendingView;
}

/** 一個遠離城堡的海岸格（盤面的另一側）。 */
const farHex = (state: GameState): number => slotOf(state).coastal[4]!;

describe('BA cards and production', () => {
  it('values a BA card more when an own coastal building is threatened, and both levels buy it', () => {
    const state = tbPlayable(BA, { seed: 9, players: 3 });
    const hex = slotOf(state).coastal[6]!;
    const vertex = freeVertexOf(state, hex);
    placeBuilding(state, 'p1', vertex);
    setBarbarians(state, {});
    setHand(state, 'p1', { wool: 1, grain: 1, ore: 1 });
    const calm = turnContext(viewOf(state, 'p1'), ctxFor('p1', 'standard'), 'standard');
    const calmValue = baCardValue(calm.model, tbPartView(calm.view, 'tb-barbarian-attack')!);
    setBarbarians(state, { [hex]: 2 });
    const threatened = turnContext(viewOf(state, 'p1'), ctxFor('p1', 'standard'), 'standard');
    const plan = threatened.economy.plans.find((candidate) => candidate.kind === BA_CARD_PLAN);
    expect(plan, 'BA card plan').toBeDefined();
    expect(plan!.value).toBeGreaterThan(calmValue);
    for (const level of LEVELS) {
      const command = decide(state, 'p1', level);
      expect(command, level).toEqual({ type: 'tb.buildBaCard' });
      accept(state, 'p1', command);
    }
  });

  it('counts no production from a conquered hex', () => {
    const state = tbPlayable(BA, { seed: 9, players: 3 });
    const hex = slotOf(state).coastal[6]!;
    const vertex = freeVertexOf(state, hex);
    placeBuilding(state, 'p1', vertex);
    const total = (counts: Record<number, number>): number => {
      setBarbarians(state, counts);
      const turn = turnContext(viewOf(state, 'p1'), ctxFor('p1', 'standard'), 'standard');
      const yields = vertexYield(turn.model, vertex);
      return (['lumber', 'brick', 'wool', 'grain', 'ore'] as Resource[]).reduce((sum, resource) => sum + yields[resource], 0);
    };
    const free = total({ [hex]: 2 });
    const conquered = total({ [hex]: 3 });
    const pips = 6 - Math.abs(7 - (state.board.layout.numbers[hex] ?? 7));
    expect(free - conquered).toBe(pips);
  });
});

describe('knights at the end of the turn', () => {
  /** p1 有一隻騎士在 `hex` 的邊上，另一隻在 `min`–`max` 步外；`hex` 上 1 個蠻族，p1 結束回合。 */
  function knightsAt(min: number, max: number, grain = 0): { state: GameState; hex: number; edges: number[]; far: number } {
    const state = tbPlayable(BA, { seed: 9, players: 3 });
    const hex = farHex(state);
    const edges = edgesOfHex(state, hex);
    const far = edgeAt(state, edges.slice(1), min, max);
    setBarbarians(state, { [hex]: 1 });
    setKnights(state, [
      { player: 'p1', edge: edges[0]! },
      { player: 'p1', edge: far },
    ]);
    setHand(state, 'p1', { grain });
    const ended = accept(state, 'p1', { type: 'turn.end' });
    expect(frameOf(ended)).toMatchObject({ kind: TB_FRAME_KINDS.baKnights, responders: ['p1'] });
    return { state: ended, hex, edges, far };
  }

  it('moves a knight within range onto the hex and drives the barbarian off for a prisoner', () => {
    for (const level of LEVELS) {
      const { state, hex, edges, far } = knightsAt(2, 3);
      const move = decide(state, 'p1', level);
      expect(move, level).toMatchObject({ type: 'tb.moveKnight', from: far, boost: false });
      expect(edges, level).toContain(field(move, 'to'));
      let next = accept(state, 'p1', move);
      const end = decide(next, 'p1', level);
      expect(end, level).toEqual({ type: 'tb.endKnights' });
      next = accept(next, 'p1', end);
      expect(slotOf(next).prisoners.p1, level).toBe(1);
      expect(slotOf(next).barbarians[hex] ?? 0, level).toBe(0);
      expect(next.turn.seat, level).toBe(1);
    }
  });

  it('boosts with spare grain only at standard', () => {
    const { state, edges, far } = knightsAt(4, 5, 2);
    const move = decide(state, 'p1', 'standard');
    expect(move).toMatchObject({ type: 'tb.moveKnight', from: far, boost: true });
    expect(edges).toContain(field(move, 'to'));
    const after = accept(state, 'p1', move);
    expect(after.players[0]!.resources.grain).toBe(1);

    // easy：同一個盤面不加速，一步一步移動直到結束。
    let next = state;
    for (let step = 0; step < 8 && next.pending; step++) {
      const command = decide(next, 'p1', 'easy');
      if (command?.type === 'tb.moveKnight') expect(field(command, 'boost')).toBe(false);
      next = accept(next, 'p1', command);
    }
    expect(next.pending).toBeNull();
    expect(next.players[0]!.resources.grain).toBe(2);
  });

  it('moves a new knight off the castle before ending', () => {
    for (const level of LEVELS) {
      let state = buyCard(tbPlayable(BA, { seed: 9, players: 3 }), 'knighthood');
      state = accept(state, 'p1', decide(state, 'p1', level));
      const castle = castleEdgesOf(state);
      expect(castle, level).toContain(slotOf(state).knights[0]!.edge);
      state = accept(state, 'p1', { type: 'turn.end' });
      const move = decide(state, 'p1', level);
      expect(move, level).toMatchObject({ type: 'tb.moveKnight', boost: false });
      expect(castle, level).toContain(field(move, 'from'));
      state = accept(state, 'p1', move);
      state = accept(state, 'p1', decide(state, 'p1', level));
      expect(state.pending, level).toBeNull();
    }
  });
});

describe('BA card frames', () => {
  it('Swift Knight lands on the edge that drives the barbarians off this turn', () => {
    for (const level of LEVELS) {
      const state = tbPlayable(BA, { seed: 9, players: 3 });
      const hex = farHex(state);
      const edges = edgesOfHex(state, hex);
      setBarbarians(state, { [hex]: 1 });
      setKnights(state, [{ player: 'p1', edge: edges[0]! }]);
      const framed = buyCard(state, 'swiftKnight');
      expect(frameOf(framed), level).toMatchObject({ kind: TB_FRAME_KINDS.baSwiftKnight });
      const command = decide(framed, 'p1', level);
      expect(command, level).toMatchObject({ type: 'tb.baPlaceKnight' });
      expect(edges.slice(1), level).toContain(field(command, 'edge'));
      accept(framed, 'p1', command);
    }
  });

  it('Knighthood takes the free castle edge closest to the barbarians', () => {
    for (const level of LEVELS) {
      const state = tbPlayable(BA, { seed: 9, players: 3 });
      const hex = farHex(state);
      setBarbarians(state, { [hex]: 2 });
      const framed = buyCard(state, 'knighthood');
      const command = decide(framed, 'p1', level);
      expect(command, level).toMatchObject({ type: 'tb.baPlaceKnight' });
      const edges = edgesOfHex(state, hex);
      const closest = Math.min(...castleEdgesOf(state).map((edge) => distanceTo(state, edge, edges)));
      expect(distanceTo(state, field(command, 'edge') as number, edges), level).toBe(closest);
      accept(framed, 'p1', command);
    }
  });

  it('Capture liberates the conquered hex next to an own building', () => {
    for (const level of LEVELS) {
      const state = tbPlayable(BA, { seed: 9, players: 3 });
      const [mine, other] = [slotOf(state).coastal[2]!, slotOf(state).coastal[6]!];
      placeBuilding(state, 'p1', freeVertexOf(state, mine, [other]));
      setBarbarians(state, { [mine]: 3, [other]: 2 });
      const framed = buyCard(state, 'capture');
      const command = decide(framed, 'p1', level);
      expect(command, level).toEqual({ type: 'tb.baCapture', hex: mine });
      const after = accept(framed, 'p1', command);
      expect(slotOf(after).barbarians[mine], level).toBe(2);
      expect(slotOf(after).prisoners.p1, level).toBe(1);
    }
  });

  it('Treason moves a barbarian from an own hex onto the leader at standard, and takes the first move at easy', () => {
    const state = tbPlayable(BA, { seed: 9, players: 3 });
    const [mine, leader] = [slotOf(state).coastal[2]!, slotOf(state).coastal[6]!];
    placeBuilding(state, 'p1', freeVertexOf(state, mine, [leader]));
    placeBuilding(state, 'p2', freeVertexOf(state, leader, [mine]), true);
    slotOf(state).prisoners.p2 = 6;
    setBarbarians(state, { [mine]: 2, [leader]: 2 });
    const framed = buyCard(state, 'treason');
    expect(frameOf(framed)).toMatchObject({ kind: TB_FRAME_KINDS.baTreason });
    const standard = decide(framed, 'p1', 'standard');
    expect(standard).toEqual({ type: 'tb.baTreason', from: mine, to: leader });
    accept(framed, 'p1', standard);
    const first = (actionHints(framed, 'p1').modules?.tradersBarbarians as { 'tb-barbarian-attack': { treasonMoves: number[][] } })[
      'tb-barbarian-attack'
    ].treasonMoves[0]!;
    const easy = decide(framed, 'p1', 'easy');
    expect(easy).toEqual({ type: 'tb.baTreason', from: first[0], to: first[1] });
    accept(framed, 'p1', easy);
  });

  it('steals from the opponent holding the most cards on a 7', () => {
    for (const level of LEVELS) {
      const state = tbPlayable(BA, { seed: 9, players: 3, phase: 'preroll' });
      setHand(state, 'p1', {});
      setHand(state, 'p2', { wool: 1 });
      setHand(state, 'p3', { wool: 2, ore: 3 });
      const rolled = accept(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3]));
      expect(frameOf(rolled), level).toMatchObject({ kind: TB_FRAME_KINDS.baSteal });
      const command = decide(rolled, 'p1', level);
      expect(command, level).toEqual({ type: 'tb.baSteal', victim: 'p3' });
      accept(rolled, 'p1', command);
    }
  });
});

// ---------------------------------------------------------------------------
// B-FAIR 與 fuzz：真實對局的狀態
// ---------------------------------------------------------------------------

/** 3 人種子 61（每 7 步）與 4 人種子 62（每 9 步）的狀態，另加 BA frame 進行中的狀態（各局最多 30 個）。 */
function samples(): GameState[] {
  const out: GameState[] = [];
  for (const [players, seed, every] of [
    [3, 61, 7],
    [4, 62, 9],
  ] as const) {
    const seats = botSeats(mixedLevels(players, seed), (level) => createBotPolicy(level));
    let step = 0;
    let frames = 0;
    runBotGame({
      seats,
      seed,
      profileId: BA,
      kits: KITS,
      onDecision: (state) => {
        if (state.result) return;
        const framed = state.pending?.kind.startsWith('tradersBarbarians.ba') === true;
        if (step++ % every === 0 || (framed && frames++ < 30)) out.push(cloneState(state));
      },
    });
  }
  return out;
}

let cached: GameState[] | null = null;
const states = (): GameState[] => (cached ??= samples());

describe('B-FAIR hidden information (BA deck order, opponent hands)', () => {
  it('collects mid-game states with the BA frames and knights on the board', () => {
    const all = states();
    expect(all.length).toBeGreaterThanOrEqual(40);
    const kinds = new Set(all.map((state) => state.pending?.kind));
    for (const kind of [TB_FRAME_KINDS.baKnights, TB_FRAME_KINDS.baKnighthood]) expect(kinds.has(kind as never), kind).toBe(true);
    expect(all.some((state) => slotOf(state).knights.length > 0)).toBe(true);
  }, GAME_TIMEOUT);

  for (const level of LEVELS) {
    it(`decides identically when only hidden information differs (${level})`, () => {
      const policy = createBotPolicy(level);
      let compared = 0;
      for (const state of states()) {
        for (const player of state.players) {
          const { variant, changed } = hideDifferently(state, player.id, KITS);
          if (!changed) continue;
          const original = viewFor(state, player.id);
          const altered = viewFor(variant, player.id);
          expect(JSON.stringify(altered), `seq ${state.seq} ${player.id}: projection changed`).toBe(JSON.stringify(original));
          const ctx = { selfId: player.id, level, seed: botSeed('fair', player.id, state.seq), offerPhases: {} };
          expect(policy.decide(altered, ctx), `seq ${state.seq} ${player.id} ${state.pending?.kind ?? state.turn.phase}`).toEqual(
            policy.decide(original, ctx),
          );
          compared += 1;
        }
      }
      expect(compared, `compared ${compared} of ${states().length} states`).toBeGreaterThanOrEqual(100);
    }, GAME_TIMEOUT);
  }
});

describe('fuzz: perturbed BA states', () => {
  const POLICIES: readonly (readonly [string, BotPolicy, BotLevel])[] = [
    ['standard', createBotPolicy('standard'), 'standard'],
    ['easy', createBotPolicy('easy'), 'easy'],
    ['fallback', fallbackPolicy, 'standard'],
  ];

  it('answers every perturbed state with an accepted command, or null when nothing is owed', () => {
    const rng = seededRng(97);
    const failures: string[] = [];
    let checked = 0;
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
  }, GAME_TIMEOUT);
});
