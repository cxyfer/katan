/**
 * CK-C 測試（C&K 計畫 §4.1、§4.3、§4.4、§5 CK-C、§6.2 M8）：互動型進步卡（F2，10 種）、Alchemy、Commercial Harbor
 * 報價與騎士封鎖戰術。
 *
 * - 每種 F2 卡與 Alchemy 的決策單元測試：該打與不該打各一；打出的指令一律被 rules 接受。
 * - 多目標的合法性（K3）：Invention 的兩格、Commercial Harbor 的報價對象與資源。
 * - Commercial Harbor 的報價數上限：每位對手最多一次，每張卡最多 N−1 次。
 * - easy 不打 F2 與 Alchemy（D-CK3）。
 * - M8：`BOTS_SEEDS ≥ 10` 時，全部 C&K 格合計 F2 每種 ≥ 1、Alchemy ≥ 1、`progress.harborOffer` ≥ 1。計數讀
 *   `event.params.*`（kit 的 `mechanics`），只計策略席位。
 */

import { describe, expect, it } from 'vitest';
import {
  actionHints,
  applyCommand,
  projectGame,
  requireProfile,
  seededRng,
  topologyOf,
  type Command,
  type GameState,
  type GameView,
} from '@catan/rules';
import {
  actCk,
  addKnight,
  cornersOf,
  emptyCkGame,
  freePath,
  giveCommodities,
  handCards,
  pathFrom,
  roadAlong,
  setBuilding,
  setImprovement,
  spreadVertices,
} from '../../rules/test/ck-helpers.ts';
import { give } from '../../rules/test/helpers.ts';
import { turnContext } from '../src/heuristic.ts';
import { CARD_VALUE, F1_CARDS, cardValue } from '../src/modules/citiesKnights/cards.ts';
import {
  F2_CARDS,
  harborNeed,
  harborOfferActions,
  interactiveCardActions,
  inventionPlan,
  roadHolderAfter,
} from '../src/modules/citiesKnights/cards-interactive.ts';
import { ALCHEMY_MIN, alchemyChoice, citiesKnightsPreroll, drawValue, sevenValue } from '../src/modules/citiesKnights/preroll.ts';
import {
  TACTIC_MIN,
  blockValue,
  expansionValue,
  reachableFrom,
  tacticsActions,
  withKnightMoved,
} from '../src/modules/citiesKnights/tactics.ts';
import type { TurnContext } from '../src/modules/types.ts';
import { defenseWindow } from '../src/modules/citiesKnights/defense.ts';
import { threatOf } from '../src/modules/citiesKnights/knights.ts';
import { createBotPolicy } from '../src/policy.ts';
import type { BotCommand, BotContext, BotLevel } from '../src/types.ts';
import { botSeats, cloneState, GAME_TIMEOUT, mixedLevels, runBotGame, seedsFor } from './harness.ts';
import { citiesKnightsKit } from './modules/citiesKnights.ts';

declare const console: { table(data: unknown): void; log(...args: unknown[]): void };

// ---------------------------------------------------------------------------
// M8：全部 C&K 格合計
// ---------------------------------------------------------------------------

const CK_ENTRIES = [
  { profileId: 'ck-2025', players: 3 },
  { profileId: 'ck-2025', players: 4 },
  { profileId: 'ck-paired-2025', players: 5 },
  { profileId: 'ck-paired-2025', players: 6 },
] as const;

describe('M8：互動卡、Alchemy 與 Commercial Harbor 報價（全部 C&K 格合計）', () => {
  const seeds = seedsFor(requireProfile('ck-2025'));

  it.skipIf(seeds.length < 10)(
    `plays every F2 card, Alchemy and a harbor offer at least once (${seeds.length} seeds × ${CK_ENTRIES.length} cells)`,
    () => {
      const totals: Record<string, number> = {};
      const rows: Record<string, unknown>[] = [];
      for (const { profileId, players } of CK_ENTRIES) {
        const cell: Record<string, number> = {};
        for (const seed of seeds) {
          const run = runBotGame({
            seats: botSeats(mixedLevels(players, seed), (level) => createBotPolicy(level)),
            seed,
            profileId,
            kits: [citiesKnightsKit],
          });
          expect(run.failure, `${profileId} ${players}p seed ${seed}: ${JSON.stringify(run.failure)}`).toBeNull();
          const tally = (key: string): number => run.mechanics[`citiesKnights.${key}`] ?? 0;
          // 事件欄位（`event.params.card`）計出來的打牌次數，只計策略席位。
          for (const card of [...F2_CARDS, 'alchemy']) cell[card] = (cell[card] ?? 0) + tally(`card.${card}`);
          // 每次報價恰好產生下列三種事件之一（有 2 種以上 commodity 的接收者另外答一次 harborExchanged）。
          const offers = tally('ev.policy.ck.harborReturned') + tally('ev.policy.ck.harborExchanged');
          cell.harborOffer = (cell.harborOffer ?? 0) + offers;
          // 交叉檢查：指令數與事件數一致（frame 的答案是另一種指令，所以報價事件不少於報價指令）。
          expect(offers, `${profileId} ${players}p seed ${seed}: harbor events vs offer commands`).toBeGreaterThanOrEqual(
            tally('cmd.progress.harborOffer') - tally('ev.policy.ck.harborOffered'),
          );
        }
        for (const [key, count] of Object.entries(cell)) totals[key] = (totals[key] ?? 0) + count;
        rows.push({ cell: `${profileId} ${players}p`, ...cell });
      }
      console.table(rows);
      console.log('M8 totals', JSON.stringify(totals));
      for (const card of F2_CARDS) expect.soft(totals[card] ?? 0, `M8: ${card} played`).toBeGreaterThanOrEqual(1);
      expect.soft(totals.alchemy ?? 0, 'M8: alchemy played').toBeGreaterThanOrEqual(1);
      expect.soft(totals.harborOffer ?? 0, 'M8: progress.harborOffer').toBeGreaterThanOrEqual(1);
    },
    GAME_TIMEOUT * 4,
  );
});

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function viewOf(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

const ctxFor = (selfId: string, level: BotLevel = 'standard', seed = 1): BotContext => ({
  selfId,
  level,
  seed,
  offerPhases: {},
});

function turnOf(state: GameState, level: BotLevel = 'standard', selfId = 'p1'): TurnContext {
  return turnContext(viewOf(state, selfId), ctxFor(selfId, level), level);
}

function decide(state: GameState, level: BotLevel = 'standard', selfId = 'p1'): BotCommand | null {
  return createBotPolicy(level).decide(viewOf(state, selfId), ctxFor(selfId, level));
}

/** 指令必須被 rules 接受。 */
function expectAccepted(state: GameState, actor: string, command: BotCommand | null | undefined): void {
  expect(command, `${actor} has a command`).not.toBeNull();
  const outcome = applyCommand(state, actor, command as Command, seededRng(1));
  expect(outcome.ok, `${JSON.stringify(command)} → ${outcome.ok ? 'ok' : outcome.error.code}`).toBe(true);
}

function setBarbarian(state: GameState, position: number, attacks = 0): void {
  Object.assign(state.moduleState!.citiesKnights as object, { barbarian: position, attacks });
}

/** 互動卡候選中，打這張卡的那一個。 */
function candidateOf(state: GameState, card: string, level: BotLevel = 'standard', selfId = 'p1') {
  return interactiveCardActions(turnOf(state, level, selfId)).find((entry) => (entry.item as { card?: string }).card === card && entry.item.type === 'progress.play');
}

function fieldsOf(command: BotCommand): Record<string, unknown> {
  return command as unknown as Record<string, unknown>;
}

/** p2 有兩座聚落、p3 一座：分數 p2 > p3 > p1 = p4。 */
function rankedGame(): GameState {
  const state = emptyCkGame(4);
  const [a, b, c] = spreadVertices(state, 3);
  setBuilding(state, 'p2', a!, false);
  setBuilding(state, 'p2', b!, false);
  setBuilding(state, 'p3', c!, false);
  return state;
}

/** p1 有一條 3 步的路；`opponent` 給 p2 一座建築與 `length` 步的路（避開 p1）。 */
function roadsGame(opponentLength = 0): { state: GameState; mine: number[]; theirs: number[] } {
  const state = emptyCkGame(4);
  const [start] = spreadVertices(state, 1);
  const mine = pathFrom(state, start!, 3);
  setBuilding(state, 'p1', mine[0]!, false);
  roadAlong(state, 'p1', mine);
  let theirs: number[] = [];
  if (opponentLength > 0) {
    theirs = freePath(state, opponentLength, mine);
    setBuilding(state, 'p2', theirs[0]!, false);
    roadAlong(state, 'p2', theirs);
  }
  return { state, mine, theirs };
}

// ---------------------------------------------------------------------------
// F2 十張卡：該打與不該打
// ---------------------------------------------------------------------------

/** 每張卡：一個值得打的盤面與一個不該打的盤面（手牌都已經放進 p1）。 */
const SCENARIOS: Record<string, { play: () => GameState; skip: () => GameState; field: string }> = {
  guildDues: {
    field: 'target',
    play: () => {
      const state = rankedGame();
      give(state, 'p2', { ore: 2, grain: 2 });
      handCards(state, 'p1', ['guildDues']);
      return state;
    },
    skip: () => {
      // 領先者的手牌只有 2 張：拿 2 張等於搬空，不值得用掉卡。
      const state = rankedGame();
      give(state, 'p2', { ore: 2 });
      handCards(state, 'p1', ['guildDues']);
      return state;
    },
  },
  espionage: {
    field: 'target',
    play: () => {
      const state = emptyCkGame(4);
      handCards(state, 'p1', ['espionage']);
      handCards(state, 'p2', ['taxation', 'crane']);
      return state;
    },
    skip: () => {
      // 對手只有 1 張進步卡：沒有得挑，也只是用一張換一張。
      const state = emptyCkGame(4);
      handCards(state, 'p1', ['espionage']);
      handCards(state, 'p2', ['crane']);
      return state;
    },
  },
  intrigue: {
    field: 'vertex',
    play: () => {
      const { state, mine } = roadsGame();
      addKnight(state, { player: 'p2', vertex: mine[2]!, level: 1, active: false });
      handCards(state, 'p1', ['intrigue']);
      return state;
    },
    skip: () => {
      // 對手的騎士沒有碰到自己的路線：卡打不出去。
      const { state } = roadsGame();
      const [far] = spreadVertices(state, 1, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      addKnight(state, { player: 'p2', vertex: far!, level: 1, active: false });
      handCards(state, 'p1', ['intrigue']);
      return state;
    },
  },
  sabotage: {
    field: '',
    play: () => {
      const state = rankedGame();
      give(state, 'p2', { ore: 4, wool: 4 });
      handCards(state, 'p1', ['sabotage']);
      return state;
    },
    skip: () => {
      // 分數不低於自己的對手手牌都很少：要棄的牌太少。
      const state = rankedGame();
      give(state, 'p2', { ore: 2 });
      give(state, 'p3', { grain: 1 });
      handCards(state, 'p1', ['sabotage']);
      return state;
    },
  },
  wedding: {
    field: '',
    play: () => {
      const state = rankedGame();
      give(state, 'p2', { ore: 2 });
      handCards(state, 'p1', ['wedding']);
      return state;
    },
    skip: () => {
      // 分數比自己高的對手手上都沒有牌。
      const state = rankedGame();
      handCards(state, 'p1', ['wedding']);
      return state;
    },
  },
  taxation: {
    field: 'hex',
    play: () => {
      const state = emptyCkGame(4);
      setBarbarian(state, 0, 1);
      const hex = state.board.layout.numbers.findIndex((number, index) => number !== null && index !== state.board.robber);
      const corners = cornersOf(state, hex);
      setBuilding(state, 'p2', corners[0]!, false);
      setBuilding(state, 'p3', corners[2]!, false);
      give(state, 'p2', { ore: 2 });
      give(state, 'p3', { grain: 2 });
      handCards(state, 'p1', ['taxation']);
      return state;
    },
    skip: () => {
      // 強盜還沒有啟動（第一次蠻族攻擊之前）：卡打不出去。
      const state = emptyCkGame(4);
      const hex = state.board.layout.numbers.findIndex((number, index) => number !== null && index !== state.board.robber);
      const corners = cornersOf(state, hex);
      setBuilding(state, 'p2', corners[0]!, false);
      setBuilding(state, 'p3', corners[2]!, false);
      give(state, 'p2', { ore: 2 });
      give(state, 'p3', { grain: 2 });
      handCards(state, 'p1', ['taxation']);
      return state;
    },
  },
  treason: {
    field: 'target',
    play: () => {
      const { state, mine } = roadsGame();
      const theirs = freePath(state, 3, mine);
      setBuilding(state, 'p2', theirs[0]!, false);
      roadAlong(state, 'p2', theirs);
      addKnight(state, { player: 'p2', vertex: theirs[1]!, level: 3, active: true });
      addKnight(state, { player: 'p2', vertex: theirs[2]!, level: 1, active: false });
      handCards(state, 'p1', ['treason']);
      return state;
    },
    skip: () => {
      // 自己沒有路，放不下騎士：只剩對手少一隻騎士，不值得用掉卡。
      const state = emptyCkGame(4);
      const [a, b] = spreadVertices(state, 2);
      setBuilding(state, 'p2', a!, false);
      addKnight(state, { player: 'p2', vertex: b!, level: 3, active: true });
      handCards(state, 'p1', ['treason']);
      return state;
    },
  },
  diplomacy: {
    field: 'edge',
    play: () => {
      // p2 持有最長道路（5 條），最末一條是開放的：拆掉它，p2 掉到 4 條，失去最長道路。
      const state = emptyCkGame(4);
      const path = freePath(state, 5);
      setBuilding(state, 'p2', path[0]!, false);
      roadAlong(state, 'p2', path);
      state.awards.longestRoad = 'p2';
      handCards(state, 'p1', ['diplomacy']);
      return state;
    },
    skip: () => {
      // 只有自己的開放道路，與一條很短的對手路線：拆自己的路沒有好處，拆短路線的好處太小。
      const { state } = roadsGame(2);
      handCards(state, 'p1', ['diplomacy']);
      return state;
    },
  },
  invention: {
    field: 'hexes',
    play: () => inventionGame(true),
    skip: () => inventionGame(false),
  },
  commercialHarbor: {
    field: '',
    play: () => harborGame(4).state,
    skip: () => {
      // 三條軌道的下一級都買得起：先改良，不打卡。
      const { state } = harborGame(4);
      giveCommodities(state, 'p1', { paper: 1, cloth: 1, coin: 1 });
      return state;
    },
  },
};

/** 把所有可以換數字的格子都設成 4，自己的城市在 3 上、對手的城市在 5 上（`better`）；或全部 4（沒有好處）。 */
function inventionGame(better: boolean): GameState {
  const state = emptyCkGame(4);
  const numbers = state.board.layout.numbers;
  const eligible = numbers.flatMap((number, hex) => (number !== null && ![2, 6, 8, 12].includes(number) ? [hex] : []));
  for (const hex of eligible) numbers[hex] = 4;
  const a = eligible[0]!;
  const b = eligible.find((hex) => cornersOf(state, hex).every((vertex) => !cornersOf(state, a).includes(vertex)))!;
  const cornersA = cornersOf(state, a);
  const cornersB = cornersOf(state, b);
  setBuilding(state, 'p1', cornersA[0]!, true);
  setBuilding(state, 'p2', cornersB[0]!, true);
  if (better) {
    numbers[a] = 3;
    numbers[b] = 5;
  }
  handCards(state, 'p1', ['invention']);
  return state;
}

/** p1 有一座城市與多餘的 wool，改良缺 commodity，手上有 Commercial Harbor。 */
function harborGame(players: 3 | 4 | 5 | 6): { state: GameState; city: number } {
  const state = emptyCkGame(players);
  const [city] = spreadVertices(state, 1);
  setBuilding(state, 'p1', city!, true);
  give(state, 'p1', { wool: 4 });
  handCards(state, 'p1', ['commercialHarbor']);
  return { state, city: city! };
}

describe('F2 互動卡：該打與不該打', () => {
  it('has a scenario for each of the ten cards', () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual([...F2_CARDS].sort());
    for (const card of F2_CARDS) expect(F1_CARDS, card).not.toContain(card);
  });

  for (const [card, scenario] of Object.entries(SCENARIOS)) {
    describe(card, () => {
      it('plays the card when it is worth it, and the command is accepted by rules', () => {
        const state = scenario.play();
        const candidate = candidateOf(state, card);
        expect(candidate, `${card} candidate`).toBeDefined();
        expectAccepted(state, 'p1', candidate!.item);
        if (scenario.field) expect(fieldsOf(candidate!.item)[scenario.field]).toBeDefined();
      });

      it('keeps the card when it is not worth it (or cannot be played)', () => {
        expect(candidateOf(scenario.skip(), card)).toBeUndefined();
      });

      it('easy never plays it (D-CK3)', () => {
        const state = scenario.play();
        expect(candidateOf(state, card, 'easy')).toBeUndefined();
        expect(interactiveCardActions(turnOf(state, 'easy'))).toEqual([]);
      });

      it('scores above an immediate build and below the barbarian defense', () => {
        const candidate = candidateOf(scenario.play(), card)!;
        expect(candidate.score).toBeGreaterThan(1.7);
        expect(candidate.score).toBeLessThan(3.5);
      });
    });
  }

  it('the policy plays a worthwhile card end to end (guild dues from the richest hand)', () => {
    const state = SCENARIOS.guildDues!.play();
    const command = decide(state);
    expect(command).toMatchObject({ type: 'progress.play', card: 'guildDues', target: 'p2' });
    expectAccepted(state, 'p1', command);
  });

  it('with progress excess, a card with a small but positive value is played instead of discarded', () => {
    const state = rankedGame();
    give(state, 'p2', { ore: 2 });
    // 5 張進步卡：guild dues 在不超過上限時不值得打（對手只有 2 張牌），超過上限就打出去而不是棄掉。
    handCards(state, 'p1', ['guildDues', 'sabotage', 'treason', 'wedding', 'taxation']);
    expect(actionHints(state, 'p1').canEndTurn).toBe(false);
    const candidates = interactiveCardActions(turnOf(state));
    const dues = candidates.find((entry) => (entry.item as { card?: string }).card === 'guildDues');
    expect(dues, 'guild dues candidate').toBeDefined();
    expect(dues!.score).toBeGreaterThanOrEqual(10);
    expectAccepted(state, 'p1', dues!.item);
    const calm = rankedGame();
    give(calm, 'p2', { ore: 2 });
    handCards(calm, 'p1', ['guildDues']);
    expect(candidateOf(calm, 'guildDues')).toBeUndefined();
  });

  it('plays on after a card is spent: every candidate stays legal across a whole sequence', () => {
    // 同一個盤面連續打，直到沒有候選：每一步都被接受（沒有重複打、沒有打不存在的牌）。
    let state = rankedGame();
    give(state, 'p2', { ore: 4, wool: 4 });
    give(state, 'p3', { grain: 3 });
    handCards(state, 'p1', ['sabotage', 'wedding', 'guildDues']);
    for (let i = 0; i < 6; i++) {
      const next = interactiveCardActions(turnOf(state))[0];
      if (!next) break;
      expectAccepted(state, 'p1', next.item);
      state = actCk(state, 'p1', next.item as never).state;
      // frame 由受害者自己回答：直接用各自的策略答完。
      for (let guard = 0; guard < 8 && state.pending; guard++) {
        const frame = state.pending as { responders?: string[] };
        const who = frame.responders?.[0];
        if (!who) break;
        const answer = decide(state, 'standard', who);
        expectAccepted(state, who, answer);
        state = actCk(state, who, answer as never).state;
      }
    }
    expect(state.players.find((p) => p.id === 'p1')!.progressCards).toEqual([]);
  });
});

describe('Intrigue：只在擠走騎士對自己有好處時打', () => {
  /** p1 只有聚落與一條 1 步的路；p2 的騎士站在路的另一端，那個路口的其他兩條邊都已被 p2 的路佔住（封死）。 */
  function closedVertexGame(): { state: GameState; vertex: number } {
    const state = emptyCkGame(4);
    const [start] = spreadVertices(state, 1);
    const [a, vertex] = pathFrom(state, start!, 1);
    setBuilding(state, 'p1', a!, false);
    roadAlong(state, 'p1', [a!, vertex!]);
    const topo = topologyOf(state);
    for (const edge of topo.vertices[vertex!]!.edges) {
      if (!state.board.roads[edge]) state.board.roads[edge] = { player: 'p2', ship: false };
    }
    addKnight(state, { player: 'p2', vertex: vertex!, level: 1, active: false });
    return { state, vertex: vertex! };
  }

  it('keeps the card for a knight that blocks nothing: a sealed vertex next to its own settlement', () => {
    const { state } = closedVertexGame();
    handCards(state, 'p1', ['intrigue']);
    expect(actionHints(state, 'p1').modules!.citiesKnights).toMatchObject({ progress: [{ card: 'intrigue', playable: true }] });
    expect(candidateOf(state, 'intrigue')).toBeUndefined();
  });

  it('with progress excess it plays the useless target only when the card would be discarded anyway', () => {
    const lowest = closedVertexGame().state;
    // intrigue 是最低價值的牌：本來就會被棄掉，打出去不會更差。
    handCards(lowest, 'p1', ['intrigue', 'merchant', 'medicine', 'crane', 'smithing']);
    const forced = candidateOf(lowest, 'intrigue');
    expect(forced, 'forced intrigue').toBeDefined();
    expect(forced!.score).toBeGreaterThanOrEqual(10);
    expectAccepted(lowest, 'p1', forced!.item);
    // 手上有更低價值的牌（taxation）：棄那張，intrigue 留著。
    const other = closedVertexGame().state;
    handCards(other, 'p1', ['intrigue', 'merchant', 'medicine', 'crane', 'taxation']);
    expect(candidateOf(other, 'intrigue')).toBeUndefined();
  });

  it('values a knight that cuts the own route above one at the end of it', () => {
    const cut = candidateOf(SCENARIOS.intrigue!.play(), 'intrigue')!;
    const { state, mine } = roadsGame();
    addKnight(state, { player: 'p2', vertex: mine[3]!, level: 1, active: false });
    handCards(state, 'p1', ['intrigue']);
    const end = candidateOf(state, 'intrigue')!;
    expect(fieldsOf(end.item).vertex).toBe(mine[3]);
    // 路線中間的騎士讓最長路線少一格；路線盡頭的只擋住延伸（底分）。
    expect(cut.score).toBeGreaterThan(end.score);
    expectAccepted(state, 'p1', end.item);
  });
});

describe('價值表', () => {
  it('F2 and Alchemy are valued within the F1 range, not below the lowest F1 card', () => {
    const lowestF1 = Math.min(...F1_CARDS.map((card) => cardValue(card)));
    for (const card of [...F2_CARDS, 'alchemy']) expect(cardValue(card), card).toBeGreaterThanOrEqual(lowestF1);
  });

  it('leaves the F1 values as CK-B2 set them', () => {
    expect(Object.fromEntries(F1_CARDS.map((card) => [card, CARD_VALUE[card]]))).toEqual({
      irrigation: 3,
      mining: 3,
      merchant: 5,
      merchantFleet: 1.8,
      resourceMonopoly: 2.8,
      tradeMonopoly: 2.2,
      medicine: 4.5,
      crane: 4,
      engineering: 2.4,
      smithing: 3.6,
      encouragement: 3.2,
      roadBuilding: 2.6,
    });
  });
});

// ---------------------------------------------------------------------------
// Invention：多目標的組合（K3）
// ---------------------------------------------------------------------------

describe('Invention 的兩格', () => {
  it('swaps the pair with the best net gain, both hexes distinct and legal', () => {
    const state = inventionGame(true);
    const turn = turnOf(state);
    const hints = actionHints(state, 'p1').modules!.citiesKnights as { progress: { card: string; targets: { hexes: number[] } }[] };
    const hexes = hints.progress.find((entry) => entry.card === 'invention')!.targets.hexes;
    const plan = inventionPlan(turn, hexes)!;
    expect(plan.net).toBeGreaterThan(3);
    expect(plan.hexes[0]).not.toBe(plan.hexes[1]);
    for (const hex of plan.hexes) expect(hexes).toContain(hex);
    const candidate = candidateOf(state, 'invention')!;
    expect(fieldsOf(candidate.item).hexes).toEqual(plan.hexes);
    // 換完之後，自己城市的格子拿到更高的點數、對手的格子更低。
    const after = actCk(state, 'p1', candidate.item as never).state;
    const numbers = state.board.layout.numbers;
    expect(after.board.layout.numbers[plan.hexes[0]]).toBe(numbers[plan.hexes[1]]);
    expect(after.board.layout.numbers[plan.hexes[1]]).toBe(numbers[plan.hexes[0]]);
  });

  it('needs two different hexes and never moves a fixed disc', () => {
    const turn = turnOf(inventionGame(true));
    expect(inventionPlan(turn, [])).toBeNull();
    expect(inventionPlan(turn, [3])).toBeNull();
    // 兩格點數相同：換了沒有差別。
    const same = turnOf(inventionGame(false));
    const eligible = same.view.board.numbers.flatMap((number, hex) => (number !== null && ![2, 6, 8, 12].includes(number) ? [hex] : []));
    expect(inventionPlan(same, eligible)).toBeNull();
    for (const hex of eligible) expect([2, 6, 8, 12]).not.toContain(same.view.board.numbers[hex]);
  });

  it('does not count the hex the robber sits on (the robber stays when the discs swap)', () => {
    const state = inventionGame(true);
    setBarbarian(state, 0, 1);
    const turn = turnOf(state);
    const numbers = state.board.layout.numbers;
    const eligible = numbers.flatMap((number, hex) => (number !== null && ![2, 6, 8, 12].includes(number) ? [hex] : []));
    const mine = eligible.find((hex) => numbers[hex] === 3)!;
    const plan = inventionPlan(turn, eligible)!;
    expect(plan.hexes).toContain(mine);
    // 強盜壓在自己的格子上：那格沒有產出，換進去的點數也沒有用，不再值得換。
    state.board.robber = mine;
    const blocked = inventionPlan(turnOf(state), eligible);
    expect(blocked === null || blocked.net < plan.net).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Commercial Harbor：報價
// ---------------------------------------------------------------------------

describe('Commercial Harbor 的報價', () => {
  /** 打出卡之後連續報價，直到沒有候選；回傳每次報價的對象。 */
  function offerAll(start: GameState, actor = 'p1'): { targets: string[]; end: GameState } {
    let state = actCk(start, actor, { type: 'progress.play', card: 'commercialHarbor' }).state;
    const targets: string[] = [];
    for (let i = 0; i < 12; i++) {
      const next = harborOfferActions(turnOf(state, 'standard', actor))[0];
      if (!next) break;
      expectAccepted(state, actor, next.item);
      targets.push(String(fieldsOf(next.item).to));
      state = actCk(state, actor, next.item as never).state;
      // 對手有 2 種以上 commodity 時要答；這裡沒有這種對手，保險起見讓它們各自答完。
      for (let guard = 0; guard < 4 && state.pending; guard++) {
        const who = (state.pending as { responders?: string[] }).responders?.[0];
        if (!who) break;
        const answer = decide(state, 'standard', who);
        expectAccepted(state, who, answer);
        state = actCk(state, who, answer as never).state;
      }
    }
    return { targets, end: state };
  }

  for (const players of [3, 4, 5, 6] as const) {
    it(`offers at most once to each of the ${players - 1} opponents (${players} players)`, () => {
      const { state } = harborGame(players);
      const { targets, end } = offerAll(state);
      // 對手都沒有 commodity：每次報價牌都退回，所以每位對手都報價一次，剛好 N−1 次，沒有重複。
      expect(targets).toHaveLength(players - 1);
      expect(new Set(targets).size).toBe(targets.length);
      expect(targets).not.toContain('p1');
      // 牌都退回來了：自己的資源沒有少。
      expect(end.players.find((p) => p.id === 'p1')!.resources.wool).toBe(4);
      // 報價用完之後 `hints.harborTargets` 是空的，沒有候選。
      expect(harborOfferActions(turnOf(end))).toEqual([]);
    });
  }

  it('stops offering as soon as the improvement can be paid (one commodity came back)', () => {
    const { state } = harborGame(4);
    giveCommodities(state, 'p2', { cloth: 1 });
    const { targets, end } = offerAll(state);
    // p2（手牌最多）先報價，換回 1 cloth：trade 的第 1 級買得起，不再報價。
    expect(targets).toEqual(['p2']);
    expect(end.players.find((p) => p.id === 'p1')!.commodities.cloth).toBe(1);
    expect(end.players.find((p) => p.id === 'p1')!.resources.wool).toBe(3);
  });

  it('offers the resource it has the most spare of, and never one it does not hold', () => {
    const { state } = harborGame(4);
    give(state, 'p1', { grain: 1 });
    const candidate = harborOfferActions(turnOf(actCk(state, 'p1', { type: 'progress.play', card: 'commercialHarbor' }).state))[0]!;
    expect(fieldsOf(candidate.item).resource).toBe('wool');
  });

  it('makes no offer without a harbor open, without a city, or when the improvement is already affordable', () => {
    const { state } = harborGame(4);
    expect(harborOfferActions(turnOf(state))).toEqual([]);
    const opened = actCk(state, 'p1', { type: 'progress.play', card: 'commercialHarbor' }).state;
    expect(harborOfferActions(turnOf(opened)).length).toBeGreaterThan(0);
    const affordable = cloneAffordable(opened);
    expect(harborNeed(turnOf(affordable))).toBeNull();
    expect(harborOfferActions(turnOf(affordable))).toEqual([]);
    expect(harborNeed(turnOf(emptyCkGame(4)))).toBeNull();
  });

  it('paired player 2 plays it from the hints (D-CK2)', () => {
    const state = emptyCkGame(5);
    const ended = actCk(state, 'p1', { type: 'turn.end' }).state;
    expect(ended.turn.pairedActor).toBe(2);
    const actor = ended.players[ended.turn.seat]!.id;
    const [city] = spreadVertices(ended, 1);
    setBuilding(ended, actor, city!, true);
    give(ended, actor, { wool: 4 });
    handCards(ended, actor, ['commercialHarbor']);
    const candidate = candidateOf(ended, 'commercialHarbor', 'standard', actor);
    expect(candidate).toBeDefined();
    expectAccepted(ended, actor, candidate!.item);
  });
});

/** 給 p1 三種 commodity 各 1 張（每條軌道的第 1 級都買得起）。 */
function cloneAffordable(state: GameState): GameState {
  const copy = cloneState(state);
  giveCommodities(copy, 'p1', { paper: 1, cloth: 1, coin: 1 });
  return copy;
}

// ---------------------------------------------------------------------------
// Alchemy
// ---------------------------------------------------------------------------

describe('Alchemy：窮舉 36 種骰面', () => {
  /** p1 有兩座城市靠著同一格 8（5 點）：擲出 8 的產量遠高於平均。 */
  function alchemyGame(): { state: GameState; hex: number } {
    const state = emptyCkGame(4, 0, 'preroll');
    const hex = state.board.layout.numbers.findIndex((number) => number === 8);
    const corners = cornersOf(state, hex);
    setBuilding(state, 'p1', corners[0]!, true);
    setBuilding(state, 'p1', corners[2]!, true);
    handCards(state, 'p1', ['alchemy']);
    return { state, hex };
  }

  it('plays the dice that make the roll its own best number, and the command is accepted', () => {
    const { state } = alchemyGame();
    const choice = alchemyChoice(turnOf(state))!;
    expect(choice.yellow + choice.red).toBe(8);
    expect(choice.gain).toBeGreaterThanOrEqual(ALCHEMY_MIN);
    const command = decide(state);
    expect(command).toMatchObject({ type: 'progress.play', card: 'alchemy' });
    const dice = (command as unknown as { dice: [number, number] }).dice;
    expect(dice[0] + dice[1]).toBe(8);
    expectAccepted(state, 'p1', command);
  });

  it('enumerates all 36 faces: the choice is the same whichever way the faces are ordered', () => {
    const { state } = alchemyGame();
    const choice = alchemyChoice(turnOf(state))!;
    // 同值取黃骰小、再取紅骰小：8 = 2 + 6。
    expect([choice.yellow, choice.red]).toEqual([2, 6]);
    expect(choice.average).toBeLessThan(choice.value);
  });

  it('keeps the card when no roll is clearly better than an ordinary one', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    const [city] = spreadVertices(state, 1);
    setBuilding(state, 'p1', city!, false);
    handCards(state, 'p1', ['alchemy']);
    const choice = alchemyChoice(turnOf(state))!;
    expect(choice.gain).toBeLessThan(ALCHEMY_MIN);
    expect(citiesKnightsPreroll(turnOf(state))).toEqual([]);
    // 沒有生產可言時，擲骰交給保底義務。
    expect(decide(state)).toMatchObject({ type: 'turn.roll' });
  });

  it('easy never plays Alchemy (D-CK3)', () => {
    const { state } = alchemyGame();
    expect(citiesKnightsPreroll(turnOf(state, 'easy'))).toEqual([]);
    expect(decide(state, 'easy')).toMatchObject({ type: 'turn.roll' });
  });

  it('avoids a 7 that would make it discard', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    give(state, 'p1', { ore: 4, wool: 4, grain: 4 });
    handCards(state, 'p1', ['alchemy']);
    const turn = turnOf(state);
    expect(sevenValue(turn)).toBe(-6);
    const choice = alchemyChoice(turn)!;
    expect(choice.yellow + choice.red).not.toBe(7);
  });

  it('uses a 7 as a weapon: rivals over the limit discard, and the robber moves once it is active', () => {
    const state = emptyCkGame(4, 0, 'preroll');
    setBarbarian(state, 0, 1);
    give(state, 'p2', { ore: 5, wool: 5, grain: 4 });
    handCards(state, 'p1', ['alchemy']);
    const turn = turnOf(state);
    // p2 有 14 張，超過上限 7：棄 7 張；強盜已啟動，另有 1 張的當量。
    expect(sevenValue(turn)).toBeGreaterThan(4);
    const choice = alchemyChoice(turn)!;
    expect(choice.yellow + choice.red).toBe(7);
    expectAccepted(state, 'p1', decide(state));
    // 對手手牌在上限以內，7 不值得。
    const calm = emptyCkGame(4, 0, 'preroll');
    give(calm, 'p2', { ore: 3 });
    handCards(calm, 'p1', ['alchemy']);
    expect(sevenValue(turnOf(calm))).toBe(0);
  });

  it('weighs the red die by who draws a progress card on a city gate', () => {
    // 自己的 science 軌道 3 級（紅骰 ≤ 4 抽卡），對手都是 0 級：紅骰越小，自己越有機會抽到、對手不會抽。
    const { state } = alchemyGame();
    setImprovement(state, 'p1', 'science', 3);
    const choice = alchemyChoice(turnOf(state))!;
    expect(choice.yellow + choice.red).toBe(8);
    // 8 的組合裡紅骰最小的是 2（2 + 6），其次 3、4：抽卡的紅骰 ≤ 4 都可以，最小的紅骰先被選到。
    expect(choice.red).toBeLessThanOrEqual(4);
  });

  it('counts the hand after Alchemy leaves it: a full hand of four still has room for one draw', () => {
    // 三人的三條軌道都是 1 級（紅骰 ≤ 2 就抽）；p1 手上 4 張含 Alchemy。Alchemy 先打出，手牌 4→3，抽得下。
    const { state } = alchemyGame();
    for (const id of ['p1', 'p2', 'p3']) {
      for (const track of ['science', 'trade', 'politics'] as const) setImprovement(state, id, track, 1);
    }
    handCards(state, 'p1', ['guildDues', 'wedding', 'treason']);
    expect(state.players[0]!.progressCards).toHaveLength(4);
    const turn = turnOf(state);
    // 紅骰 2 對自己仍有正的抽牌價值（沒有被腰斬成負值）。
    expect(drawValue(turn, 2)).toBeGreaterThan(0);
    const choice = alchemyChoice(turn)!;
    expect([choice.yellow, choice.red]).toEqual([6, 2]);
    const command = decide(state);
    expect(command).toMatchObject({ type: 'progress.play', card: 'alchemy', dice: [6, 2] });
    expectAccepted(state, 'p1', command);
    const after = actCk(state, 'p1', command as never).state;
    expect(after.players[0]!.progressCards).toHaveLength(3);
  });

  describe('牌堆張數限制抽牌的人數', () => {
    /** 只有 science 軌道有 1 張牌；三人的 science 都是 1 級（紅骰 ≤ 2 就抽）。`seat` 是正在擲骰的座位。 */
    function oneCardDeck(seat: number, selfLevel = 1): GameState {
      const state = emptyCkGame(4, seat, 'preroll');
      state.progressDecks.science = state.progressDecks.science.slice(0, 1);
      state.progressDecks.trade = [];
      state.progressDecks.politics = [];
      setImprovement(state, 'p1', 'science', selfLevel);
      setImprovement(state, 'p2', 'science', 1);
      setImprovement(state, 'p3', 'science', 1);
      return state;
    }

    it('gives the only card to the roller when self rolls first, so rivals draw nothing', () => {
      const first = drawValue(turnOf(oneCardDeck(0)), 2);
      // 自己（擲骰者）抽到唯一的一張：2 / 6；對手分不到。
      expect(first).toBeCloseTo(2 / 6);
    });

    it('values a draw as 0 for self when a rival draws the last card first', () => {
      // p2 在擲骰，排在 p1 前面：牌被 p2 抽走，p1 抽不到，價值只剩對手抽到的扣分（和 p1 沒有資格時一樣）。
      const eligible = drawValue(turnOf(oneCardDeck(1)), 2);
      const ineligible = drawValue(turnOf(oneCardDeck(1, 0)), 2);
      expect(eligible).toBeLessThan(0);
      expect(eligible).toBeCloseTo(ineligible);
    });

    it('stops at an empty deck: nobody draws', () => {
      const state = oneCardDeck(0);
      state.progressDecks.science = [];
      expect(drawValue(turnOf(state), 2)).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Diplomacy：最長道路的接手者（照 rules 的重算規則）
// ---------------------------------------------------------------------------

describe('Diplomacy：最長道路由誰接手', () => {
  const players = [
    { id: 'p1', seat: 0 },
    { id: 'p2', seat: 1 },
    { id: 'p3', seat: 2 },
    { id: 'p4', seat: 3 },
  ];
  const lengthsOf = (p1: number, p3: number, p4: number): Map<string, number> =>
    new Map([['p1', p1], ['p2', 9], ['p3', p3], ['p4', p4]]);

  it('hands a tie to the earliest seat once the holder drops below five', () => {
    expect(roadHolderAfter(players, lengthsOf(5, 5, 0), 'p2', 4)).toBe('p1');
    expect(roadHolderAfter(players, lengthsOf(0, 5, 5), 'p2', 4)).toBe('p3');
    // 傳入的順序不影響結果：依座位排。
    expect(roadHolderAfter(players.slice().reverse(), lengthsOf(0, 5, 5), 'p2', 4)).toBe('p3');
  });

  it('gives the award to the longest eligible road, and to nobody when none reaches five', () => {
    expect(roadHolderAfter(players, lengthsOf(0, 5, 6), 'p2', 4)).toBe('p4');
    expect(roadHolderAfter(players, lengthsOf(4, 0, 4), 'p2', 4)).toBeNull();
  });

  it('keeps the holder on a tie while it still has five, and lets the first strictly longer seat take over', () => {
    // 持有者仍有 5 條、對手 5 條：平手不奪走。
    expect(roadHolderAfter(players, lengthsOf(5, 5, 5), 'p2', 5)).toBe('p2');
    // 嚴格較長的人接手，但是依座位順序第一個，不是最長的那個。
    expect(roadHolderAfter(players, lengthsOf(0, 6, 7), 'p2', 5)).toBe('p3');
    expect(roadHolderAfter(players, lengthsOf(0, 5, 7), 'p2', 5)).toBe('p4');
  });

  /** 每人的道路條數（這些路都是單一路徑，條數就是最長路線）。 */
  function roadLengths(state: GameState): Map<string, number> {
    const lengths = new Map(state.players.map((player) => [player.id, 0]));
    for (const road of state.board.roads) if (road) lengths.set(road.player, (lengths.get(road.player) ?? 0) + 1);
    return lengths;
  }

  /** 三條互不相連的 5 步路：p2（持有者，起點有聚落，最末一條開放）、p1、p3。 */
  function tiedRoadsGame(seat: number): GameState {
    const state = emptyCkGame(4, seat);
    const theirs = freePath(state, 5);
    setBuilding(state, 'p2', theirs[0]!, false);
    roadAlong(state, 'p2', theirs);
    const first = freePath(state, 5, theirs);
    roadAlong(state, 'p1', first);
    const third = freePath(state, 5, [...theirs, ...first]);
    roadAlong(state, 'p3', third);
    state.awards.longestRoad = 'p2';
    handCards(state, state.players[seat]!.id, ['diplomacy']);
    return state;
  }

  it('does not count on taking the award when a tied rival sits in an earlier seat (rules agree)', () => {
    const state = tiedRoadsGame(2);
    // 三人各 5 條；打掉 p2 的最末一條後 p2 剩 4 條：p1 與 p3 平手，座位較前的 p1 拿走。
    expect(roadHolderAfter(viewOf(state, 'p3').players, roadLengths(state), 'p2', 4)).toBe('p1');
    const candidate = candidateOf(state, 'diplomacy', 'standard', 'p3');
    expect(candidate, 'p3 still plays Diplomacy to strip the holder').toBeDefined();
    expect(state.board.roads[fieldsOf(candidate!.item).edge as number]?.player).toBe('p2');
    const after = actCk(state, 'p3', candidate!.item as never).state;
    expect(after.awards.longestRoad).toBe('p1');
  });

  it('counts on taking the award when self is the earliest tied seat (rules agree)', () => {
    const state = tiedRoadsGame(0);
    expect(roadHolderAfter(viewOf(state, 'p1').players, roadLengths(state), 'p2', 4)).toBe('p1');
    const candidate = candidateOf(state, 'diplomacy');
    expect(candidate).toBeDefined();
    expect(state.board.roads[fieldsOf(candidate!.item).edge as number]?.player).toBe('p2');
    const after = actCk(state, 'p1', candidate!.item as never).state;
    expect(after.awards.longestRoad).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
// Treason：放置價值要看得到的騎士棋子存量
// ---------------------------------------------------------------------------

describe('Treason：放置價值取決於棋子存量', () => {
  /**
   * p1 有 3 步的路（有招募點）與一座可被掠奪的城市，蠻族逼近（防守視窗內且自己有風險）；p2 只有一隻未啟動的騎士（預設 1 級）。
   * `basicsOut`：p1 的兩隻基本（1 級）騎士都已上場，存量裡沒有 1 級棋子。
   */
  function treasonGame(basicsOut: boolean, victimLevel: 1 | 2 | 3 = 1): GameState {
    const { state, mine } = roadsGame();
    const theirs = freePath(state, 2, mine);
    setBuilding(state, 'p2', theirs[0]!, false);
    roadAlong(state, 'p2', theirs);
    addKnight(state, { player: 'p2', vertex: theirs[1]!, level: victimLevel, active: false });
    // 兩座城市：蠻族強度 2，場上沒有啟動的騎士（防守強度 0）；自己與 p3 的貢獻都是 0，自己會被掠奪。
    const [city, other] = spreadVertices(state, 2, [...mine, ...theirs]);
    setBuilding(state, 'p1', city!, true);
    setBuilding(state, 'p3', other!, true);
    setBarbarian(state, 4);
    if (basicsOut) {
      addKnight(state, { player: 'p1', vertex: mine[1]!, level: 1, active: false });
      addKnight(state, { player: 'p1', vertex: mine[2]!, level: 1, active: false });
    }
    handCards(state, 'p1', ['treason']);
    return state;
  }

  it('counts the placement and the defense bonus while a basic knight can be placed', () => {
    const state = treasonGame(false);
    const turn = turnOf(state);
    expect(defenseWindow(turn)).toBe(true);
    expect(threatOf(turn.view, 'p1').atRisk).toBe(true);
    const candidate = candidateOf(state, 'treason');
    expect(candidate, 'treason is played to get a ready defender').toBeDefined();
    expect(fieldsOf(candidate!.item).target).toBe('p2');
    expectAccepted(state, 'p1', candidate!.item);
  });

  it('counts neither the placement nor the defense bonus once the basic knights are all out', () => {
    const state = treasonGame(true);
    const turn = turnOf(state);
    expect(defenseWindow(turn)).toBe(true);
    // p2 只會交出 1 級騎士，p1 沒有 1 級棋子可放：打了只是少對手一隻騎士，不值得用掉卡。
    expect(candidateOf(state, 'treason')).toBeUndefined();
  });

  it('checks the supply itself instead of trusting the recruit sites: a level-2 victim can still be answered by a level-2 knight', () => {
    // 假設招募點的 hint 不隨 1 級存量過濾（直接塞進去）：Treason 自己要檢查棋子存量。
    const withSites = (state: GameState): TurnContext => {
      const view = viewOf(state, 'p1');
      const modules = view.hints!.modules as { citiesKnights: Record<string, unknown> };
      const hints = { ...view.hints!, modules: { ...modules, citiesKnights: { ...modules.citiesKnights, recruitSites: [1, 2, 3] } } };
      return turnContext({ ...view, hints }, ctxFor('p1'), 'standard');
    };
    const treasonOf = (state: GameState) => interactiveCardActions(withSites(state)).find((entry) => (entry.item as { card?: string }).card === 'treason');
    // 受害者只有 1 級騎士、p1 的 1 級棋子用完：放不下（等級 ≤ 1 的存量是 0）。
    expect(treasonOf(treasonGame(true, 1))).toBeUndefined();
    // 受害者的是 2 級騎士：p1 還有 2 級棋子，放得下，照常計放置價值與防守加分。
    expect(treasonOf(treasonGame(true, 2))).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 騎士封鎖戰術
// ---------------------------------------------------------------------------

describe('騎士封鎖戰術', () => {
  /** p1 有一座聚落與一條 5 步的路（路口多，計畫的目標點之外還有騎士可以去的點），一隻騎士站在第 2 個路口；p2 的路網在別處。 */
  function blockadeGame(options: { active: boolean; grain?: number }): { state: GameState; path: number[]; theirs: number[] } {
    const state = emptyCkGame(4, 0, 'action');
    const [start] = spreadVertices(state, 1);
    const path = pathFrom(state, start!, 5);
    setBuilding(state, 'p1', path[0]!, false);
    roadAlong(state, 'p1', path);
    addKnight(state, { player: 'p1', vertex: path[1]!, level: 1, active: options.active });
    const theirs = freePath(state, 2, path);
    setBuilding(state, 'p2', theirs[0]!, false);
    roadAlong(state, 'p2', theirs);
    give(state, 'p1', { grain: options.grain ?? 1 });
    return { state, path, theirs };
  }

  function hintsOf(state: GameState) {
    return (actionHints(state, 'p1').modules!.citiesKnights as { knights: { vertex: number; moves: number[]; canAct: boolean }[] }).knights;
  }

  it('reachableFrom agrees with the moves the rules offer an active knight', () => {
    const { state, path } = blockadeGame({ active: true });
    const knight = hintsOf(state).find((entry) => entry.vertex === path[1])!;
    expect(knight.canAct).toBe(true);
    expect(reachableFrom(turnOf(state), path[1]!)).toEqual(knight.moves);
  });

  it('a hypothetical knight move equals the real one (same expansion value for the rival)', () => {
    const { state, path } = blockadeGame({ active: true });
    const turn = turnOf(state);
    const knight = hintsOf(state).find((entry) => entry.vertex === path[1])!;
    for (const to of knight.moves) {
      const real = cloneState(state);
      const moving = (real.moduleState!.citiesKnights as { knights: { vertex: number }[] }).knights.find((entry) => entry.vertex === path[1])!;
      moving.vertex = to;
      for (const rival of ['p2', 'p3']) {
        const hypothetical = expansionValue(withKnightMoved(turn.model, 'p1', path[1]!, to), rival);
        expect(hypothetical, `${rival} after moving to ${to}`).toBeCloseTo(expansionValue(turnOf(real).model, rival), 9);
      }
    }
  });

  it('a rival with a road network has an expansion value, a rival with nothing has none', () => {
    const { state } = blockadeGame({ active: true });
    const turn = turnOf(state);
    expect(expansionValue(turn.model, 'p2')).toBeGreaterThan(1);
    expect(expansionValue(turn.model, 'p3')).toBe(0);
  });

  it('does not move the knight for a negligible block (default threshold)', () => {
    const { state } = blockadeGame({ active: true });
    expect(tacticsActions(turnOf(state))).toEqual([]);
    expect(TACTIC_MIN).toBeGreaterThan(0.5);
  });

  it('moves an active knight along its route when the block is worth it, and rules accept the move', () => {
    const { state, path } = blockadeGame({ active: true });
    const candidates = tacticsActions(turnOf(state), -Infinity);
    const move = candidates.find((entry) => entry.item.type === 'knight.move')!;
    expect(move, 'a move candidate').toBeDefined();
    expect(fieldsOf(move.item).from).toBe(path[1]);
    expectAccepted(state, 'p1', move.item);
  });

  it('leaves every knight alone while the barbarian window is open (the knights are the defense)', () => {
    const { state } = blockadeGame({ active: true });
    // 自己有一座可掠奪的城市：蠻族還遠時戰術可以動（對照組），逼近到視窗內就不動、也不啟動。
    const [city] = spreadVertices(state, 1, Array.from({ length: 30 }, (_, vertex) => vertex));
    setBuilding(state, 'p1', city!, true);
    setBarbarian(state, 0);
    expect(tacticsActions(turnOf(state), -Infinity).length).toBeGreaterThan(0);
    // 視窗內（還差 4 艘船以內）一律不動；視窗外的啟動要多留 2 艘船。
    for (const position of [3, 5]) {
      setBarbarian(state, position);
      expect(tacticsActions(turnOf(state), -Infinity), `position ${position}`).toEqual([]);
    }
  });

  it('activates an idle knight outside the window, and not while another knight is already active', () => {
    const { state, path } = blockadeGame({ active: false });
    const candidates = tacticsActions(turnOf(state), -Infinity);
    const activate = candidates.find((entry) => entry.item.type === 'knight.activate')!;
    expect(activate, 'an activation candidate').toBeDefined();
    expect(fieldsOf(activate.item).vertex).toBe(path[1]);
    expectAccepted(state, 'p1', activate.item);
    // 沒有 grain 付不起。
    const broke = blockadeGame({ active: false, grain: 0 }).state;
    expect(tacticsActions(turnOf(broke), -Infinity)).toEqual([]);
    // 已經有一隻啟動中、還不能動的騎士（剛啟動）：不再多啟動一隻。
    const after = actCk(state, 'p1', activate.item as never).state;
    expect(tacticsActions(turnOf(after), -Infinity).filter((entry) => entry.item.type === 'knight.activate')).toEqual([]);
  });

  it('easy and a player without knights do nothing', () => {
    const { state } = blockadeGame({ active: true });
    expect(tacticsActions(turnOf(state, 'easy'), -Infinity)).toEqual([]);
    const none = emptyCkGame(4);
    expect(tacticsActions(turnOf(none), -Infinity)).toEqual([]);
  });

  it('blockValue: a vertex next to the own building blocks nobody and costs nothing; a plan vertex is never blocked', () => {
    const { state, path } = blockadeGame({ active: true });
    const turn = turnOf(state);
    const before = new Map([['p2', expansionValue(turn.model, 'p2')], ['p3', 0], ['p4', 0]]);
    // path[1] 緊鄰自己的聚落（距離規則）：誰都不能蓋，騎士站在那裡沒有影響。
    expect(blockValue(turn, path[2]!, path[1]!, before)).toBeCloseTo(0, 9);
    const planVertex = turn.economy.plans.find((plan) => plan.vertex !== null)?.vertex;
    if (planVertex !== undefined && planVertex !== null) expect(blockValue(turn, path[1]!, planVertex, before)).toBe(-Infinity);
  });
});
