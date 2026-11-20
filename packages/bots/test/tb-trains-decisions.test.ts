/**
 * Merchant Trains 的固定盤面、B-FAIR 與 fuzz（T&B 計畫 §4.2、§6.1；S5）。
 *
 * 固定盤面以 rules 的測試工具建好（`tbPlayable` 之後清空盤面，直接擺車廂、建築與道路），再用真實指令推進到投票 frame；
 * 每個決策都要被 `applyCommand` 接受：
 * - 出價（依序）：只有 `responders[0]` 作答；standard 用計畫外的 wool／grain 出價，讓車廂夾住自己的建築；easy 出 0；
 * - 過半者（非行動者）放置：放在夾住自己建築的邊；
 * - 分配（同時）：不是 `responders[0]` 的出價者也作答，而且避開讓對手得分的位置；平手時行動者放置；
 * - 放置在自己的道路上：加權後拿下最長道路；對手放置時避開這條邊；
 * - `trainRoad` 計畫：車廂讓道路算 2，一條路就拿下最長道路；
 * - 夾在兩節車廂之間的空路口：立即建造加 1 VP，並有 `wagonSettlement` 計畫。
 * B-FAIR：擾動對手的出價牌（kit 的 `hideDifferently`，加上 harness 的手牌與牌庫擾動），投影相同、決策相同。
 * fuzz：在投票 frame 上套用 harness 的手牌擾動；每個座位的答案都被接受，或是 null 且不欠動作。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  projectGame,
  seededRng,
  TRADERS_BARBARIANS,
  topologyOf,
  type BoardTopology,
  type Command,
  type GameState,
  type GameView,
  type Rng,
} from '@catan/rules';
import { placeBuilding, placeRoad, setHand } from '../../rules/test/helpers.ts';
import { clearBoard, tbPlayable } from '../../rules/test/tb-helpers.ts';
import { boardModel } from '../src/board.ts';
import { botOwesAction } from '../src/fallback.ts';
import { turnContext } from '../src/heuristic.ts';
import { TB_FRAME_KINDS } from '../src/modules/tradersBarbarians/frames.ts';
import {
  spareBidCards,
  trainScene,
  TRAIN_ROAD_PLAN,
  WAGON_SETTLEMENT_PLAN,
  weightedRoute,
} from '../src/modules/tradersBarbarians/trains.ts';
import { tbPartHints, tbPartView } from '../src/modules/tradersBarbarians/view.ts';
import { createBotPolicy } from '../src/policy.ts';
import { botSeed } from '../src/seed.ts';
import type { BotCommand, BotContext, BotLevel } from '../src/types.ts';
import { botSeats, cloneState, GAME_TIMEOUT, hideDifferently, mixedLevels, perturbState, runBotGame, viewFor } from './harness.ts';
import { tradersBarbariansKit } from './modules/tradersBarbarians.ts';
import { partStateOf } from './modules/tb/part.ts';

const PROFILE = 'tb-merchant-trains-2025';
const KITS = [tradersBarbariansKit];
const LEVELS: readonly BotLevel[] = ['standard', 'easy'];
const VOTE_FRAMES: ReadonlySet<string> = new Set([TB_FRAME_KINDS.wagonBid, TB_FRAME_KINDS.wagonAssign, TB_FRAME_KINDS.wagonPlace]);

interface Slot {
  starts: { vertex: number; edge: number }[];
  wagons: { edge: number; train: number }[];
  supply: number;
}

const slotOf = (state: GameState): Slot => partStateOf<Slot>(state, 'tb-merchant-trains')!;
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
const votesOf = (command: BotCommand | null): number => Number(field(command, 'wool') ?? 0) + Number(field(command, 'grain') ?? 0);

const otherEnd = (topo: BoardTopology, edge: number, vertex: number): number => {
  const [a, b] = topo.edges[edge]!.vertices;
  return a === vertex ? b : a;
};

/** 3 人、清空盤面與手牌，輪到 p1 的行動階段。 */
function bare(): GameState {
  const state = tbPlayable(PROFILE, { players: 3, seed: 6 });
  clearBoard(state);
  for (const player of state.players) setHand(state, player.id, {});
  return state;
}

/** 列車 0 的起點、第一條邊的另一端 `h1`、以及從 `h1` 出去的另一條邊 `e2`（同分取編號小者）。 */
function train0(state: GameState) {
  const topo = topologyOf(state);
  const start = slotOf(state).starts[0]!;
  const h1 = otherEnd(topo, start.edge, start.vertex);
  const e2 = Math.min(...topo.vertices[h1]!.edges.filter((edge) => edge !== start.edge));
  const oasisEdge = Math.min(...topo.vertices[start.vertex]!.edges.filter((edge) => edge !== start.edge));
  return { topo, start, h1, e2, oasisEdge };
}

function addWagon(state: GameState, edge: number, train: number): void {
  const slot = slotOf(state);
  slot.wagons.push({ edge, train });
  slot.supply -= 1;
}

/** 遠離 `avoid` 的空路口：p1 在那裡蓋聚落（收一節車廂）並結束回合，投票開始。 */
function openVote(state: GameState, avoid: readonly number[]): GameState {
  const topo = topologyOf(state);
  const near = new Set(avoid.flatMap((vertex) => [vertex, ...topo.vertices[vertex]!.edges.map((edge) => otherEnd(topo, edge, vertex))]));
  const vertex = topo.vertices.findIndex(
    (info, index) =>
      index > 20 &&
      !near.has(index) &&
      !state.board.buildings[index] &&
      info.edges.every((edge) => topo.edges[edge]!.vertices.every((other) => !state.board.buildings[other] && !near.has(other))),
  );
  placeRoad(state, 'p1', topo.vertices[vertex]!.edges[0]!);
  setHand(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
  const built = applyCommand(state, 'p1', { type: 'build.settlement', vertex } as Command, seededRng(3));
  if (!built.ok) expect.fail(`setup build: ${built.error.code}`);
  expect(built.events.map((event) => event.type)).toContain('tb.wagonCollected');
  return accept(built.state, 'p1', { type: 'turn.end' } as BotCommand);
}

const betweenOf = (state: GameState): readonly number[] => tbPartView(viewOf(state, 'p1'), 'tb-merchant-trains')?.betweenWagons ?? [];
const touches = (topo: BoardTopology, edge: number, vertex: number): boolean => topo.edges[edge]!.vertices.includes(vertex);

describe('Merchant Trains vote frames', () => {
  it('bids in table order with spare wool and grain; the majority holder places beside its own building', () => {
    const state = bare();
    const { topo, start, h1 } = train0(state);
    addWagon(state, start.edge, 0);
    placeBuilding(state, 'p2', h1);
    let next = openVote(state, [h1]);
    setHand(next, 'p2', { wool: 3, grain: 1 });
    expect(next.pending).toMatchObject({ kind: TB_FRAME_KINDS.wagonBid, responders: ['p1', 'p2', 'p3'] });

    // 依序回應：p2 還沒輪到，策略與保底都不作答。
    for (const level of LEVELS) expect(decide(next, 'p2', level), `${level} p2 before its turn`).toBeNull();
    const p1 = decide(next, 'p1', 'standard');
    expect(votesOf(p1), 'p1 has no spare cards').toBe(0);
    next = accept(next, 'p1', p1);

    // standard 用計畫外的牌出價（拿下過半），easy 一律出 0。
    const spare = spareBidCards(turnContext(viewOf(next, 'p2'), ctxFor('p2', 'standard'), 'standard'));
    const bid = decide(next, 'p2', 'standard');
    expect(field(bid, 'type')).toBe('tb.bidWagon');
    expect(votesOf(bid)).toBeGreaterThan(0);
    expect(Number(field(bid, 'wool'))).toBeLessThanOrEqual(spare.wool);
    expect(Number(field(bid, 'grain'))).toBeLessThanOrEqual(spare.grain);
    expect(votesOf(decide(next, 'p2', 'easy')), 'easy bids 0').toBe(0);
    next = accept(next, 'p2', bid);
    next = accept(next, 'p3', decide(next, 'p3', 'standard'));

    // 過半者 p2（不是行動者）放置：夾住自己在 h1 的建築。
    expect(next.pending).toMatchObject({ kind: TB_FRAME_KINDS.wagonPlace, responders: ['p2'] });
    for (const level of LEVELS) {
      const place = decide(next, 'p2', level);
      expect(field(place, 'type')).toBe('tb.placeWagon');
      expect(touches(topo, Number(field(place, 'edge')), h1), `${level} places beside its building`).toBe(true);
    }
    const placed = accept(next, 'p2', decide(next, 'p2', 'standard'));
    expect(betweenOf(placed)).toContain(h1);
    expect(placed.pending).toBeNull();
    expect(placed.turn.seat).toBe(1);

    // 同一個位置對行動者 p1 是讓對手得分：p1 自己放置時會避開。
    const p1View = viewOf(next, 'p1');
    const scene = trainScene(boardModel(p1View, 'p1'), tbPartHints(p1View.hints, 'tb-merchant-trains')?.locations ?? [])!;
    expect(touches(topo, scene.preferred('p2')!, h1)).toBe(true);
    expect(touches(topo, scene.preferred('p1')!, h1)).toBe(false);
  });

  it('assigns votes simultaneously: a later responder answers too and keeps the wagon away from a rival', () => {
    const state = bare();
    const { topo, start, h1 } = train0(state);
    addWagon(state, start.edge, 0);
    placeBuilding(state, 'p2', h1);
    let next = openVote(state, [h1]);
    // 各留一張主要計畫用不到的牌（聚落計畫要用掉 1 wool、1 grain）。
    setHand(next, 'p2', { wool: 2, grain: 1 });
    setHand(next, 'p3', { wool: 1, grain: 2 });
    next = accept(next, 'p1', decide(next, 'p1', 'standard'));
    const p2bid = decide(next, 'p2', 'standard');
    expect(votesOf(p2bid)).toBe(1);
    next = accept(next, 'p2', p2bid);
    // p3 看到 p2 出 1 張：不出價就讓 p2 過半放在 h1 旁；出 1 張就平手，結果交回行動者（出 2 張多花一張，結果相同）。
    const p3 = decide(next, 'p3', 'standard');
    expect(votesOf(p3)).toBe(1);
    next = accept(next, 'p3', p3);
    expect(next.pending).toMatchObject({ kind: TB_FRAME_KINDS.wagonAssign, responders: ['p2', 'p3'] });

    // 同時回應：p3 不是 responders[0]，策略也作答；保底不欠動作。
    const assign = decide(next, 'p3', 'standard');
    expect(field(assign, 'type')).toBe('tb.assignWagon');
    expect(touches(topo, Number(field(assign, 'edge')), h1), 'p3 avoids the edge that scores for p2').toBe(false);
    expect(botOwesAction(viewOf(next, 'p3'), 'p3')).toBeNull();
    next = accept(next, 'p3', assign);
    // p2 拿不到 h1（p3 已經投給別處，最好也只能平手交回行動者），選對自己最好的結果。
    next = accept(next, 'p2', decide(next, 'p2', 'standard'));
    if (next.pending) {
      // 平手：行動者 p1 放置，避開讓 p2 得分的邊。
      expect(next.pending).toMatchObject({ kind: TB_FRAME_KINDS.wagonPlace, responders: ['p1'] });
      const place = decide(next, 'p1', 'standard');
      expect(touches(topo, Number(field(place, 'edge')), h1)).toBe(false);
      next = accept(next, 'p1', place);
    }
    expect(next.pending).toBeNull();
    expect(betweenOf(next)).not.toContain(h1);
    expect(slotOf(next).wagons).toHaveLength(2);
  });

  it('places a wagon on its own road to take Longest Road; an opponent avoids that edge', () => {
    const state = bare();
    const { topo, start, h1, e2, oasisEdge } = train0(state);
    const x2 = otherEnd(topo, e2, h1);
    const e3 = Math.min(...topo.vertices[x2]!.edges.filter((edge) => edge !== e2));
    for (const edge of [oasisEdge, start.edge, e2, e3]) placeRoad(state, 'p1', edge);
    const frame = (responder: string): GameState => {
      const copy = cloneState(state);
      copy.pending = {
        kind: TB_FRAME_KINDS.wagonPlace,
        module: TRADERS_BARBARIANS,
        responders: [responder],
        data: { bids: {}, assignments: {}, active: 'p1' },
      };
      return copy;
    };
    const model = boardModel(viewOf(state, 'p1'), 'p1');
    expect(weightedRoute(model, 'p1', new Set())).toBe(4);
    expect(weightedRoute(model, 'p1', new Set([start.edge]))).toBe(5);

    const mine = frame('p1');
    for (const level of LEVELS) expect(field(decide(mine, 'p1', level), 'edge'), level).toBe(start.edge);
    const placed = accept(mine, 'p1', decide(mine, 'p1', 'standard'));
    expect(placed.awards.longestRoad).toBe('p1');

    const theirs = frame('p2');
    const other = decide(theirs, 'p2', 'standard');
    expect(field(other, 'type')).toBe('tb.placeWagon');
    expect(field(other, 'edge')).not.toBe(start.edge);
    expect(accept(theirs, 'p2', other).awards.longestRoad).toBeNull();
  });
});

describe('Merchant Trains plans', () => {
  it('builds the road on a wagon edge that takes Longest Road (trainRoad)', () => {
    const state = bare();
    const { start, e2, oasisEdge } = train0(state);
    addWagon(state, start.edge, 0);
    addWagon(state, e2, 0);
    placeRoad(state, 'p1', oasisEdge);
    placeRoad(state, 'p1', start.edge);
    setHand(state, 'p1', { lumber: 1, brick: 1 });

    const turn = turnContext(viewOf(state, 'p1'), ctxFor('p1', 'standard'), 'standard');
    const plan = turn.economy.plans.find((entry) => entry.kind === TRAIN_ROAD_PLAN);
    expect(plan?.roads).toEqual([e2]);
    // base 只算道路條數（2），覺得還差 3 條，不推動最長道路。
    expect(turn.economy.plans.some((entry) => entry.kind === 'longestRoad')).toBe(false);
    const easy = turnContext(viewOf(state, 'p1'), ctxFor('p1', 'easy'), 'easy');
    expect(easy.economy.plans.some((entry) => entry.kind === TRAIN_ROAD_PLAN), 'easy has no train plans').toBe(false);

    const road = decide(state, 'p1', 'standard');
    expect(road).toEqual({ type: 'build.road', edge: e2 });
    const built = accept(state, 'p1', road);
    expect(built.awards.longestRoad).toBe('p1');
    expect(built.players[0]!.longestRoadLength).toBe(5);
  });

  it('values a free spot between two wagons one point higher (wagonSettlement and the immediate build)', () => {
    const state = bare();
    const { topo, start, h1, e2 } = train0(state);
    addWagon(state, start.edge, 0);
    addWagon(state, e2, 0);
    const spur = Math.min(...topo.vertices[h1]!.edges.filter((edge) => edge !== start.edge && edge !== e2));
    placeRoad(state, 'p1', spur);
    expect(betweenOf(state)).toContain(h1);

    // 手上沒牌：計畫裡有 h1 的 wagonSettlement，價值比 base 的同一點高 1。
    const empty = turnContext(viewOf(state, 'p1'), ctxFor('p1', 'standard'), 'standard');
    const plan = empty.economy.plans.find((entry) => entry.kind === WAGON_SETTLEMENT_PLAN && entry.vertex === h1);
    expect(plan, 'wagonSettlement plan at h1').toBeDefined();
    const base = empty.economy.plans.find((entry) => entry.kind === 'settlement' && entry.vertex === h1);
    if (base) expect(plan!.value - base.value).toBeCloseTo(1, 6);

    // 付得起：立即蓋在 h1，分數 +2（聚落 1、夾在車廂之間 1）。
    setHand(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    const before = viewOf(state, 'p1').players[0]!.publicScore;
    const build = decide(state, 'p1', 'standard');
    expect(build).toEqual({ type: 'build.settlement', vertex: h1 });
    const built = accept(state, 'p1', build);
    expect(viewOf(built, 'p1').players[0]!.publicScore - before).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// B-FAIR 與 fuzz：真實對局中的投票 frame
// ---------------------------------------------------------------------------

/**
 * 真實對局的同時回應 frame 不常出現：在出價 frame 的狀態上佈置一個 `wagonAssign`（座位順序的前兩位各出 1 張，尚未分配）。
 * 只用來比較決策與檢查指令被接受；出價的牌沒有從手牌扣掉，這些狀態不檢查守恆。
 */
function stagedAssigns(states: readonly GameState[]): GameState[] {
  return states
    .filter((state) => state.pending?.kind === TB_FRAME_KINDS.wagonBid)
    .map((state) => {
      const copy = cloneState(state);
      const [a, b] = copy.players.map((player) => player.id);
      const data = (copy.pending as unknown as { data: { active: string } }).data;
      copy.pending = {
        kind: TB_FRAME_KINDS.wagonAssign,
        module: TRADERS_BARBARIANS,
        responders: [a!, b!],
        data: { bids: { [a!]: { wool: 1, grain: 0 }, [b!]: { wool: 0, grain: 1 } }, assignments: {}, active: data.active },
      };
      return copy;
    });
}

function snapshots(players: number, seed: number, every: number): GameState[] {
  const seats = botSeats(mixedLevels(players, seed), (level) => createBotPolicy(level));
  const out: GameState[] = [];
  let step = 0;
  runBotGame({
    seats,
    seed,
    profileId: PROFILE,
    kits: KITS,
    onDecision: (state) => {
      const vote = !!state.pending && VOTE_FRAMES.has(state.pending.kind);
      if ((vote || step % every === 0) && !state.result) out.push(cloneState(state));
      step += 1;
    },
  });
  return out;
}

describe('Merchant Trains B-FAIR and fuzz', () => {
  const collected = [...snapshots(3, 71, 13), ...snapshots(4, 72, 17)];
  const states = [...collected, ...stagedAssigns(collected)];
  const votes = states.filter((state) => state.pending && VOTE_FRAMES.has(state.pending.kind));

  it('samples every vote frame kind', () => {
    expect(new Set(votes.map((state) => state.pending!.kind))).toEqual(VOTE_FRAMES);
  });

  for (const level of LEVELS) {
    it(`decides identically when only opponents' hidden cards differ (${level})`, () => {
      const policy = createBotPolicy(level);
      let compared = 0;
      let comparedVotes = 0;
      for (const state of states) {
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
          if (state.pending && VOTE_FRAMES.has(state.pending.kind)) comparedVotes += 1;
        }
      }
      expect(compared).toBeGreaterThanOrEqual(100);
      expect(comparedVotes, 'comparisons on vote frames').toBeGreaterThanOrEqual(30);
    }, GAME_TIMEOUT);
  }

  it('answers perturbed vote frames with accepted commands, or owes nothing', () => {
    const rng = seededRng(97);
    let answered = 0;
    for (const state of votes) {
      for (let round = 0; round < 1; round++) {
        const variant = perturbState(state, rng, KITS);
        for (const player of variant.players) {
          for (const level of LEVELS) {
            const view = viewFor(variant, player.id);
            const command = createBotPolicy(level).decide(view, ctxFor(player.id, level));
            if (command === null) {
              expect(botOwesAction(view, player.id), `seq ${variant.seq} ${player.id} ${level} idles while owing`).toBeNull();
              continue;
            }
            const outcome = applyCommand(variant, player.id, command as Command, seededRng(1));
            if (!outcome.ok) expect.fail(`seq ${variant.seq} ${player.id} ${level} ${JSON.stringify(command)} → ${outcome.error.code}`);
            answered += 1;
          }
        }
      }
    }
    expect(answered).toBeGreaterThanOrEqual(40);
  }, GAME_TIMEOUT);
});
