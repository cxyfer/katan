/** 針對個別窗口的決策：報價生命週期、開價限制、引擎修正採用與棄牌。 */

import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  COSTS,
  getTopology,
  seededRng,
  type GameState,
  type Offer,
  type Resource,
} from '@catan/rules';
import { boardModel, searchRoads } from '../src/board.ts';
import { economyOf } from '../src/economy.ts';
import { heuristicPolicy } from '../src/heuristic.ts';
import { proposeOffer } from '../src/trade.ts';
import type { BotContext, OfferPhase } from '../src/types.ts';
import { botSeats, newBotGame, runBotGame, viewFor } from './harness.ts';

const standard = heuristicPolicy('standard');

function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/** 取第一個符合條件、即將輪到某個 Bot 決策的狀態。 */
function stateWhere(seed: number, predicate: (state: GameState) => boolean): GameState {
  let found: GameState | null = null;
  runBotGame({
    seats: botSeats(['standard', 'standard', 'standard', 'standard'], (level) => heuristicPolicy(level)),
    seed,
    onDecision: (state) => {
      if (!found && predicate(state)) found = clone(state);
    },
  });
  if (!found) throw new Error('no matching state');
  return found;
}

const actorOf = (state: GameState) => state.players[state.turn.seat]!;

/** 行動階段、沒有待決效果、本視窗還沒有任何報價，而且已經蓋過幾座聚落。 */
function actionState(seed: number): GameState {
  return stateWhere(
    seed,
    (state) =>
      state.turn.phase === 'action' &&
      !state.pending &&
      !state.offers.some((offer) => offer.windowId === state.windowId) &&
      state.board.buildings.filter((building) => building?.player === actorOf(state).id).length >= 3,
  );
}

function setHand(state: GameState, playerId: string, hand: Partial<Record<Resource, number>>): void {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  player.resources = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, ...hand };
}

function ctx(selfId: string, offerPhases: Record<string, OfferPhase> = {}): BotContext {
  return { selfId, level: 'standard', seed: 1, offerPhases };
}

function withOffer(state: GameState, responses: Offer['responses']): { state: GameState; offer: Offer } {
  const next = clone(state);
  const actor = actorOf(next).id;
  setHand(next, actor, { ore: 2, lumber: 1 });
  for (const player of next.players) if (player.id !== actor) setHand(next, player.id, { grain: 2, wool: 1 });
  const offer: Offer = {
    id: 'offer-test',
    revision: 1,
    from: actor,
    to: 'all',
    give: { ore: 1 },
    want: { grain: 1 },
    windowId: next.windowId,
    status: 'open',
    responses,
    agreedWith: null,
    createdSeq: next.seq,
  };
  next.offers.push(offer);
  return { state: next, offer };
}

describe('own offer lifecycle', () => {
  const base = actionState(61);
  const actor = actorOf(base).id;
  const others = base.players.map((player) => player.id).filter((id) => id !== actor);
  const decide = (state: GameState, phase: OfferPhase) =>
    standard.decide(viewFor(state, actor), ctx(actor, { 'offer-test': phase }));

  it('waits while collecting and nobody has answered', () => {
    const { state } = withOffer(base, {});
    expect(decide(state, 'collecting')).toBeNull();
  });

  it('settles as soon as everyone answered, even while collecting', () => {
    const responses = Object.fromEntries(others.map((id, index) => [id, index === 1 ? 'consented' : 'declined'])) as Offer['responses'];
    const { state } = withOffer(base, responses);
    const command = decide(state, 'collecting');
    expect(command).toEqual({ type: 'trade.settle', offerId: 'offer-test', counterparty: others[1] });
    expect(applyCommand(state, actor, command!, seededRng(1)).ok).toBe(true);
  });

  it('waits for the collection window before taking an early consent', () => {
    const { state } = withOffer(base, { [others[0]!]: 'consented' });
    expect(decide(state, 'collecting')).toBeNull();
    expect(decide(state, 'ready')).toEqual({ type: 'trade.settle', offerId: 'offer-test', counterparty: others[0] });
  });

  it('withdraws when everyone declined', () => {
    const responses = Object.fromEntries(others.map((id) => [id, 'declined'])) as Offer['responses'];
    const { state } = withOffer(base, responses);
    for (const phase of ['collecting', 'ready', 'expired'] as OfferPhase[]) {
      expect(decide(state, phase)).toEqual({ type: 'trade.withdraw', offerId: 'offer-test' });
    }
  });

  it('keeps waiting while ready but withdraws once expired', () => {
    const { state } = withOffer(base, { [others[0]!]: 'declined' });
    expect(decide(state, 'ready')).toBeNull();
    expect(decide(state, 'expired')).toEqual({ type: 'trade.withdraw', offerId: 'offer-test' });
  });

  it('treats an offer the clock does not know as expired', () => {
    const { state } = withOffer(base, { [others[0]!]: 'declined' });
    expect(standard.decide(viewFor(state, actor), ctx(actor))).toEqual({ type: 'trade.withdraw', offerId: 'offer-test' });
  });

  it('withdraws when it can no longer pay its own terms', () => {
    const { state } = withOffer(base, { [others[0]!]: 'consented' });
    setHand(state, actor, { lumber: 1 });
    expect(decide(state, 'expired')).toEqual({ type: 'trade.withdraw', offerId: 'offer-test' });
  });

  it('skips a consenter whose hand is too small to pay', () => {
    const { state } = withOffer(base, { [others[0]!]: 'consented' });
    setHand(state, others[0]!, {});
    expect(decide(state, 'expired')).toEqual({ type: 'trade.withdraw', offerId: 'offer-test' });
  });
});

describe('answering offers', () => {
  const base = actionState(62);
  const actor = actorOf(base).id;
  // 選一位有聚落可升級的非行動者。
  const responder = base.players.find(
    (player) =>
      player.id !== actor && base.board.buildings.some((building) => building?.player === player.id && !building.city),
  )!.id;

  it('declines what it cannot pay and never answers twice', () => {
    const { state } = withOffer(base, {});
    setHand(state, responder, { wool: 2 });
    expect(standard.decide(viewFor(state, responder), ctx(responder))).toEqual({
      type: 'trade.respond',
      offerId: 'offer-test',
      response: 'declined',
    });
    state.offers.at(-1)!.responses[responder] = 'declined';
    expect(standard.decide(viewFor(state, responder), ctx(responder))).toBeNull();
  });

  it('consents to a trade that completes its city', () => {
    const { state } = withOffer(base, {});
    // 缺 1 礦就能升級城市，用多餘的穀換。
    setHand(state, responder, { grain: 4, ore: 2 });
    const command = standard.decide(viewFor(state, responder), ctx(responder));
    expect(command).toEqual({ type: 'trade.respond', offerId: 'offer-test', response: 'consented' });
  });
});

describe('proposing offers', () => {
  const base = actionState(63);
  const actor = actorOf(base).id;

  function propose(state: GameState) {
    const view = viewFor(state, actor);
    const economy = economyOf(boardModel(view, actor));
    const crafted = { ...economy, hand: { lumber: 1, brick: 1, wool: 1, grain: 0, ore: 2 } };
    return proposeOffer(view, crafted, actor, COSTS.settlement);
  }

  function pastOffer(state: GameState, give: Offer['give'], status: Offer['status']): void {
    state.offers.push({
      id: `offer-past-${state.offers.length}`,
      revision: 1,
      from: actor,
      to: 'all',
      give,
      want: { grain: 1 },
      windowId: state.windowId,
      status,
      responses: {},
      agreedWith: null,
      createdSeq: state.seq,
    });
  }

  it('asks 1:1 for the missing card with a surplus card', () => {
    expect(propose(clone(base))).toEqual({ type: 'trade.offer', to: 'all', give: { ore: 1 }, want: { grain: 1 } });
  });

  it('sweetens instead of repeating the same terms', () => {
    const state = clone(base);
    pastOffer(state, { ore: 1 }, 'withdrawn');
    expect(propose(state)).toEqual({ type: 'trade.offer', to: 'all', give: { ore: 2 }, want: { grain: 1 } });
  });

  it('stops after two offers in one window and while one is open', () => {
    const twice = clone(base);
    pastOffer(twice, { ore: 1 }, 'withdrawn');
    pastOffer(twice, { ore: 2 }, 'withdrawn');
    expect(propose(twice)).toBeNull();
    const open = clone(base);
    pastOffer(open, { ore: 1 }, 'open');
    expect(propose(open)).toBeNull();
  });
});

describe('rule fixes adopted by the policy', () => {
  const base = actionState(64);
  const actor = actorOf(base).id;

  it('plays Year of Plenty when the bank holds one card and completes the effect', () => {
    const state = clone(base);
    const me = actorOf(state);
    me.devCards = ['yearOfPlenty'];
    me.newDevCards = [];
    state.turn.devCardPlayed = false;
    // 拿滿城市與聚落，讓發展卡成為主要計畫；只缺一張 ore。
    state.board.buildings = state.board.buildings.map(() => null);
    for (let vertex = 0; vertex < 9; vertex++) {
      state.board.buildings[vertex] = { player: actor, city: vertex < 4 };
    }
    state.awards.longestRoad = actor;
    setHand(state, actor, { wool: 1, grain: 1 });
    state.bank = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 1 };

    const command = standard.decide(viewFor(state, actor), ctx(actor));
    expect(command).toEqual({ type: 'dev.playYearOfPlenty' });
    const played = applyCommand(state, actor, command!, seededRng(1));
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pending).toEqual({ kind: 'yearOfPlenty', actor, remaining: 1 });

    const pick = standard.decide(viewFor(played.state, actor), ctx(actor));
    expect(pick).toEqual({ type: 'pending.takeResource', resource: 'ore' });
    const finished = applyCommand(played.state, actor, pick!, seededRng(1));
    expect(finished.ok).toBe(true);
    if (finished.ok) expect(finished.state.pending).toBeNull();
  });

  it('plays Road Building with one road piece left and completes the effect', () => {
    const state = clone(base);
    const me = actorOf(state);
    me.devCards = ['roadBuilding'];
    me.newDevCards = [];
    state.turn.devCardPlayed = false;
    const settlement = state.board.buildings.findIndex((building) => building?.player === actor && !building.city);
    const topo = getTopology(state.board.layout.topologyId);
    const keepOpen = new Set(topo.vertices[settlement]!.edges);
    state.board.roads = state.board.roads.map((_road, edge) =>
      edge < 14 && !keepOpen.has(edge) ? { player: actor, ship: false } : null,
    );
    // 上面固定選前 14 條保留邊，可能不足 14 條，補足到只剩一個棋子。
    for (let edge = 0; edge < state.board.roads.length; edge++) {
      const owned = state.board.roads.filter((road) => road?.player === actor).length;
      if (owned >= 14) break;
      if (!state.board.roads[edge] && !keepOpen.has(edge)) state.board.roads[edge] = { player: actor, ship: false };
    }
    expect(state.board.roads.filter((road) => road?.player === actor)).toHaveLength(14);

    const command = standard.decide(viewFor(state, actor), ctx(actor));
    expect(command).toEqual({ type: 'dev.playRoadBuilding' });
    const played = applyCommand(state, actor, command!, seededRng(1));
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pending).toEqual({ kind: 'freeRoads', actor, remaining: 1, granted: 1 });

    const road = standard.decide(viewFor(played.state, actor), ctx(actor));
    expect(road?.type).toBe('build.road');
    const finished = applyCommand(played.state, actor, road!, seededRng(1));
    expect(finished.ok).toBe(true);
    if (finished.ok) expect(finished.state.pending).toBeNull();
  });

  it('plays an older progress card even when a copy was bought this turn', () => {
    const state = clone(base);
    const me = actorOf(state);
    me.devCards = ['monopoly'];
    me.newDevCards = ['monopoly'];
    state.turn.devCardPlayed = false;
    for (const player of state.players) if (player.id !== actor) setHand(state, player.id, { wool: 10 });
    const command = standard.decide(viewFor(state, actor), ctx(actor));
    expect(command?.type).toBe('dev.playMonopoly');
    const played = applyCommand(state, actor, command!, seededRng(1));
    expect(played.ok).toBe(true);
    if (played.ok) {
      expect(played.state.players.find((player) => player.id === actor)?.devCards).toEqual([]);
      expect(played.state.players.find((player) => player.id === actor)?.newDevCards).toEqual(['monopoly']);
    }
  });

  it('does not play a progress card when only this turn\'s copy exists', () => {
    const state = clone(base);
    const me = actorOf(state);
    me.devCards = [];
    me.newDevCards = ['monopoly'];
    state.turn.devCardPlayed = false;
    for (const player of state.players) if (player.id !== actor) setHand(state, player.id, { wool: 5 });
    expect(standard.decide(viewFor(state, actor), ctx(actor))?.type).not.toBe('dev.playMonopoly');
  });

  it('extends from the player side of an opponent cut when planning roads', () => {
    const { state } = newBotGame(4, 71);
    const owner = state.players[0]!.id;
    const opponent = state.players[1]!.id;
    state.board.buildings = state.board.buildings.map(() => null);
    state.board.roads = state.board.roads.map(() => null);
    const topo = getTopology(state.board.layout.topologyId);
    const middle = topo.vertices.findIndex((vertex) => vertex.edges.length === 3);
    const [fromEdge, nextEdge] = topo.vertices[middle]!.edges as [number, number, number];
    const other = (edge: number) => topo.edges[edge]!.vertices.find((vertex) => vertex !== middle)!;
    const blocked = other(fromEdge);
    const next = other(nextEdge);
    state.board.buildings[blocked] = { player: opponent, city: false };
    state.board.roads[fromEdge] = { player: owner, ship: false };

    const search = searchRoads(boardModel(viewFor(state, owner), owner), owner, 1);
    expect(search.distance[blocked]).toBe(Infinity);
    expect(search.distance[middle]).toBe(0);
    expect(search.distance[next]).toBe(1);
  });
});

describe('discarding', () => {
  it('keeps the cards its plan needs and drops the surplus first', () => {
    const base = actionState(65);
    const state = clone(base);
    const actor = actorOf(state).id;
    const victim = state.players.find(
      (player) =>
        player.id !== actor && state.board.buildings.some((building) => building?.player === player.id && !building.city),
    )!.id;
    setHand(state, victim, { ore: 6, grain: 2 });
    state.pending = { kind: 'discard', required: { [victim]: 4 }, submitted: {} };
    const command = standard.decide(viewFor(state, victim), ctx(victim));
    expect(command?.type).toBe('pending.discard');
    const discarded = (command as { resources: Resource[] }).resources;
    expect(discarded).toHaveLength(4);
    expect(discarded.filter((resource) => resource === 'ore').length).toBeGreaterThanOrEqual(3);
    expect(applyCommand(state, victim, command!, seededRng(1)).ok).toBe(true);
  });
});
