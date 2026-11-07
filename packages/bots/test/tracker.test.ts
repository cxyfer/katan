/**
 * 計牌模組（hard 規格 §6、§9）：
 * - T-SOUND：真實對局中，每個視角的推算都完整、張數吻合，真實手牌一定在可能集合中；
 * - T-FAIR：只差在隱藏資訊、私有事件欄位或銀行存量時，推算完全相同；
 * - T-UNIT：合成事件逐條驗證精確加減、偷牌展開、壟斷收斂、棄牌超幾何與降級。
 */

import { describe, expect, it } from 'vitest';
import { RESOURCES, type GameEvent, type GameState, type GameView, type Resource } from '@catan/rules';
import { heuristicPolicy } from '../src/heuristic.ts';
import { historyComplete, trackTable, type HandBelief } from '../src/tracker.ts';
import {
  GAME_TIMEOUT,
  botSeats,
  cloneState,
  hideDifferently,
  historyOf,
  newBotGame,
  runBotGame,
  setHistory,
  viewFor,
} from './harness.ts';

const tracker = import.meta.glob('../src/tracker.ts', { query: '?raw', import: 'default', eager: true });

function handOf(belief: HandBelief, hand: Record<Resource, number>): number | undefined {
  return belief.worlds.find((world) => RESOURCES.every((resource) => world.hand[resource] === hand[resource]))?.p;
}

/** 每隔 `every` 步取一個已登記完整歷史的狀態。 */
function sampledStates(players: number, seed: number, every: number): GameState[] {
  const policy = heuristicPolicy('standard');
  const out: GameState[] = [];
  let step = 0;
  runBotGame({
    seats: botSeats(Array.from({ length: players }, (_, index) => (index % 2 === 0 ? 'standard' : 'easy')), () => policy),
    seed,
    onStep: ({ after }) => {
      if (step++ % every === 0) out.push(after);
    },
  });
  return out;
}

describe('T-SOUND tracker on bot games', () => {
  for (const players of [3, 4, 5, 6]) {
    it(`keeps every opponent's real hand among the worlds (${players} players)`, () => {
      let checked = 0;
      let exact = 0;
      for (const seed of [61, 62]) {
        for (const state of sampledStates(players, seed, 7)) {
          for (const viewer of state.players) {
            const belief = trackTable(viewFor(state, viewer.id), viewer.id);
            expect(belief.complete).toBe(true);
            const opponents = state.players.filter((player) => player.id !== viewer.id);
            const held = opponents.reduce((sum, player) => sum + player.devCards.length + player.newDevCards.length, 0);
            expect(belief.dev.unseenTotal).toBe(state.devDeck.length + held);
            for (const player of opponents) {
              const hand = belief.hands[player.id]!;
              expect(hand.consistent).toBe(true);
              expect(hand.size).toBe(RESOURCES.reduce((sum, resource) => sum + player.resources[resource], 0));
              expect(handOf(hand, player.resources)).toBeGreaterThan(0);
              expect(hand.worlds.reduce((sum, world) => sum + world.p, 0)).toBeCloseTo(1, 9);
              for (const resource of RESOURCES) {
                expect(hand.min[resource]).toBeLessThanOrEqual(player.resources[resource]);
                expect(hand.max[resource]).toBeGreaterThanOrEqual(player.resources[resource]);
              }
              if (hand.exact) exact += 1;
              checked += 1;
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(200);
      // 只有偷牌與棄牌會帶來不確定性；多數時候仍能精確知道對手手牌。
      expect(exact / checked).toBeGreaterThan(0.25);
    }, GAME_TIMEOUT);
  }
});

describe('T-FAIR tracker reads only the projection', () => {
  const states = [...sampledStates(4, 71, 11), ...sampledStates(4, 72, 13)];

  it('gives the same belief when only hidden cards, deck order or private event fields differ', () => {
    let compared = 0;
    for (const state of states) {
      for (const viewer of state.players) {
        const original = viewFor(state, viewer.id);
        const expected = trackTable(original, viewer.id);

        // 對手手牌組成、未公開發展卡與牌庫順序不同，歷史相同。
        const { variant, changed } = hideDifferently(state, viewer.id);
        setHistory(variant, historyOf(state));
        const hidden = viewFor(variant, viewer.id);
        expect(JSON.stringify(hidden)).toBe(JSON.stringify(original));
        expect(trackTable(hidden, viewer.id)).toEqual(expected);

        // 其他座位之間的偷牌牌面全部改成礦石：投影會遮掉，推算不受影響。
        const rewritten = cloneState(state);
        setHistory(
          rewritten,
          historyOf(state).map((event): GameEvent =>
            event.type === 'robber.stole' && event.private && !event.private.to.includes(viewer.id)
              ? { ...event, private: { ...event.private, params: { resource: 'ore' } } }
              : event,
          ),
        );
        expect(trackTable(viewFor(rewritten, viewer.id), viewer.id)).toEqual(expected);
        if (changed) compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(40);
  }, GAME_TIMEOUT);

  it('never depends on the bank counts (#137)', () => {
    for (const state of states.slice(0, 20)) {
      for (const viewer of state.players) {
        const view = viewFor(state, viewer.id);
        const empty = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
        expect(trackTable({ ...view, bank: empty }, viewer.id)).toEqual(trackTable(view, viewer.id));
      }
    }
    // 原始碼層級的保證：模組沒有讀取任何 `bank` 欄位。
    const source = Object.values(tracker)[0] as string;
    // 去掉註解與字串常值（例如事件型別 'trade.bank'），只看程式碼。
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/'[^'\n]*'/g, "''");
    expect(code).not.toMatch(/\bbank\b/);
  }, GAME_TIMEOUT);
});

// ---------------------------------------------------------------------------
// 合成事件
// ---------------------------------------------------------------------------

/** 以真實開局的投影為底，換上合成的事件與對應的手牌張數。 */
function synthetic(events: { type: string; params: Record<string, unknown> }[], sizes: Record<string, number>): GameView {
  const { state } = newBotGame({ profileId: 'base-2025', players: 4, seed: 5 });
  const view = viewFor(state, 'bot1');
  return {
    ...view,
    seq: events.length,
    events: events.map((event, index) => ({ seq: index + 1, ...event })),
    players: view.players.map((player) => ({ ...player, handSize: sizes[player.id] ?? 0 })),
  };
}

const start = (playerId: string, resources: Record<string, number>) => ({
  type: 'setup.startingResources',
  params: { playerId, resources },
});

describe('T-UNIT tracker events', () => {
  it('tracks gains, builds and trades exactly', () => {
    const view = synthetic(
      [
        start('bot2', { lumber: 2, brick: 1 }),
        { type: 'production.resolved', params: { total: 6, grants: { bot2: { brick: 1, ore: 4 }, bot3: { wool: 1 } } } },
        { type: 'build.road', params: { playerId: 'bot2', edge: 3, free: false } },
        { type: 'build.road', params: { playerId: 'bot2', edge: 4, free: true } },
        { type: 'trade.bank', params: { playerId: 'bot2', give: 'ore', receive: 'grain', rate: 4 } },
        { type: 'trade.completed', params: { offerId: 'o', from: 'bot2', to: 'bot3', give: { brick: 1 }, want: { wool: 1 } } },
      ],
      { bot2: 3, bot3: 1 },
    );
    const belief = trackTable(view, 'bot1');
    expect(belief.complete).toBe(true);
    expect(belief.hands.bot2!.exact).toBe(true);
    expect(belief.hands.bot2!.worlds[0]!.hand).toEqual({ lumber: 1, brick: 0, wool: 1, grain: 1, ore: 0 });
    expect(belief.hands.bot3!.worlds[0]!.hand).toEqual({ lumber: 0, brick: 1, wool: 0, grain: 0, ore: 0 });
  });

  it('splits an unseen theft by the victim’s odds and collapses it on monopoly', () => {
    const events = [
      start('bot2', { ore: 2, wool: 1 }),
      { type: 'robber.stole', params: { playerId: 'bot3', victim: 'bot2' } },
    ];
    const stolen = trackTable(synthetic(events, { bot2: 2, bot3: 1 }), 'bot1');
    expect(handOf(stolen.hands.bot2!, { lumber: 0, brick: 0, wool: 1, grain: 0, ore: 1 })).toBeCloseTo(2 / 3, 12);
    expect(handOf(stolen.hands.bot2!, { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 2 })).toBeCloseTo(1 / 3, 12);
    expect(stolen.hands.bot3!.expected.ore).toBeCloseTo(2 / 3, 12);
    expect(stolen.hands.bot3!.expected.wool).toBeCloseTo(1 / 3, 12);

    // bot4 壟斷礦石：只拿到 bot2 的 1 張，所以 bot2 剩羊毛、bot3 偷到的是羊毛。
    const monopoly = trackTable(
      synthetic(
        [...events, { type: 'dev.monopoly', params: { playerId: 'bot4', resource: 'ore', taken: { bot2: 1 } } }],
        { bot2: 1, bot3: 1, bot4: 1 },
      ),
      'bot1',
    );
    expect(monopoly.complete).toBe(true);
    expect(monopoly.hands.bot2!.worlds).toEqual([{ hand: { lumber: 0, brick: 0, wool: 1, grain: 0, ore: 0 }, p: 1 }]);
    expect(monopoly.hands.bot3!.worlds).toEqual([{ hand: { lumber: 0, brick: 0, wool: 1, grain: 0, ore: 0 }, p: 1 }]);
    expect(monopoly.hands.bot4!.worlds[0]!.hand.ore).toBe(1);
    expect(monopoly.dev.players.bot4!.played.monopoly).toBe(1);
  });

  it('uses the private card of a theft the viewer took part in', () => {
    const view = synthetic(
      [start('bot2', { ore: 2, wool: 1 }), { type: 'robber.stole', params: { playerId: 'bot1', victim: 'bot2', resource: 'wool' } }],
      { bot1: 1, bot2: 2 },
    );
    expect(trackTable(view, 'bot1').hands.bot2!.worlds).toEqual([{ hand: { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 2 }, p: 1 }]);
  });

  it('weighs an unseen discard by the multivariate hypergeometric law', () => {
    const view = synthetic(
      [start('bot2', { lumber: 4, ore: 4 }), { type: 'discard.submitted', params: { playerId: 'bot2', count: 4 } }],
      { bot2: 4 },
    );
    const hand = trackTable(view, 'bot1').hands.bot2!;
    expect(hand.worlds).toHaveLength(5);
    expect(handOf(hand, { lumber: 2, brick: 0, wool: 0, grain: 0, ore: 2 })).toBeCloseTo(36 / 70, 12);
    expect(handOf(hand, { lumber: 4, brick: 0, wool: 0, grain: 0, ore: 0 })).toBeCloseTo(1 / 70, 12);
    expect(hand.worlds[0]!.hand).toEqual({ lumber: 2, brick: 0, wool: 0, grain: 0, ore: 2 });
    expect(hand.expected.lumber).toBeCloseTo(2, 12);
  });

  it('falls back to production shares when the history is incomplete or contradicts the table', () => {
    const events = [start('bot2', { lumber: 2 })];
    const cases: GameView[] = [
      // 第一筆不是 seq 1。
      { ...synthetic(events, { bot2: 2 }), events: [{ seq: 2, type: 'setup.startingResources', params: { playerId: 'bot2', resources: { lumber: 2 } } }], seq: 2 },
      // 最後一筆不是 view.seq。
      { ...synthetic(events, { bot2: 2 }), seq: 5 },
      // 張數與公開 handSize 不吻合。
      synthetic(events, { bot2: 3 }),
      // 無法理解的事件格式。
      synthetic([...events, { type: 'trade.bank', params: { playerId: 'bot2', give: 'gold', receive: 'ore', rate: 4 } }], { bot2: 2 }),
    ];
    for (const view of cases) {
      const belief = trackTable(view, 'bot1');
      expect(belief.complete).toBe(false);
      for (const player of view.players.filter((candidate) => candidate.id !== 'bot1')) {
        const hand = belief.hands[player.id]!;
        expect(hand.consistent).toBe(false);
        expect(hand.worlds).toEqual([]);
        expect(hand.size).toBe(player.handSize);
        expect(RESOURCES.reduce((sum, resource) => sum + hand.expected[resource], 0)).toBeCloseTo(player.handSize, 12);
      }
    }
    expect(historyComplete({ events: [], seq: 0 })).toBe(false);
  });

  it('degrades on profiles with rules modules', () => {
    const { state } = newBotGame({ profileId: 'sf-new-shores-2025', players: 3, seed: 3 });
    expect(trackTable(viewFor(state, 'bot1'), 'bot1').complete).toBe(false);
  });

  it('counts unseen development cards and expected hidden points', () => {
    const view = synthetic([{ type: 'dev.yearOfPlenty', params: { playerId: 'bot3' } }], {});
    const players = view.players.map((player) =>
      player.id === 'bot1'
        ? { ...player, devCards: ['victoryPoint'], newDevCards: ['knight'] }
        : player.id === 'bot2'
          ? { ...player, devCardCount: 2, playedKnights: 1 }
          : player,
    );
    const belief = trackTable({ ...view, players }, 'bot1');
    // base 牌庫 25 張：自己持有 2 張、bot2 打出 1 張騎士、bot3 打出 1 張豐收。
    expect(belief.dev.unseen).toMatchObject({ knight: 12, victoryPoint: 4, roadBuilding: 2, yearOfPlenty: 1, monopoly: 2 });
    expect(belief.dev.unseenTotal).toBe(21);
    expect(belief.dev.players.bot2).toMatchObject({ held: 2, played: { knight: 1 } });
    expect(belief.dev.players.bot2!.victoryPoints).toBeCloseTo((2 * 4) / 21, 12);
    expect(belief.dev.players.bot3!.played.yearOfPlenty).toBe(1);
  });
});
