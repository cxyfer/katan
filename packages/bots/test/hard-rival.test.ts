import { describe, expect, it, vi } from 'vitest';
import { actionHints, edgesOfHex, getTopology, verticesOfHex, type GameState, type Offer } from '@katan/rules';
import { forceTurn, give, newGame } from '../../rules/test/helpers.ts';
import { economyOf } from '../src/economy.ts';
import { acceptOdds, hardAccepts, rivalModel } from '../src/hard/trade.ts';
import { HardTurn } from '../src/hard/turn.ts';
import { offerGain } from '../src/trade.ts';
import { setHistory, viewFor } from './harness.ts';

const selfId = 'p1';
const rivalId = 'p2';

function actionState(seat = 0): GameState {
  const { state } = newGame({ players: 3 });
  forceTurn(state, seat, 'action');
  return state;
}

function hardTurn(state: GameState): HardTurn {
  const view = viewFor(state, selfId);
  return new HardTurn(view, { selfId, level: 'hard', seed: 1, offerPhases: {} }, view.players[0]!);
}

function knownRivalHand(state: GameState, resources: Parameters<typeof give>[2]): void {
  give(state, rivalId, resources);
  state.seq = 1;
  setHistory(state, [{ seq: 1, type: 'production.resolved', params: { grants: { [rivalId]: resources } } }]);
}

function placeRoads(state: GameState, count: number): number[] {
  const topo = getTopology(state.board.layout.topologyId);
  const vertices = verticesOfHex(topo, 0);
  for (const edge of edgesOfHex(topo, 0)) {
    if (topo.edges[edge]!.vertices.every((vertex) => vertices.slice(0, count + 1).includes(vertex))) {
      state.board.roads[edge] = { player: rivalId, ship: false };
    }
  }
  return vertices;
}

describe('hard rival model', () => {
  it('uses the rival’s public harbors, not the viewer’s rates', () => {
    const state = actionState();
    const topo = getTopology(state.board.layout.topologyId);
    const generic = state.board.layout.harbors.find((harbor) => harbor.type === 'generic')!;
    const ore = state.board.layout.harbors.find((harbor) => harbor.type === 'ore')!;
    state.board.buildings[topo.edges[generic.edge]!.vertices[0]] = { player: rivalId, city: true };
    state.board.buildings[topo.edges[ore.edge]!.vertices[0]] = { player: rivalId, city: false };
    knownRivalHand(state, { wool: 1 });
    const turn = hardTurn(state);
    expect(turn.view.hints!.bankRates.ore).toBe(4);
    expect(rivalModel(turn, rivalId).worlds[0]!.economy.rates).toEqual({ lumber: 3, brick: 3, wool: 3, grain: 3, ore: 2 });
  });

  it('matches the engine’s building hints and excludes blocked settlements and road extensions', () => {
    const state = actionState(1);
    const [occupied, adjacent, settlement, , free] = placeRoads(state, 4);
    state.board.buildings[occupied!] = { player: selfId, city: false };
    state.board.buildings[settlement!] = { player: rivalId, city: false };
    knownRivalHand(state, { wool: 1 });
    const hints = rivalModel(hardTurn(state), rivalId).worlds[0]!.economy.model.view.hints!;
    expect(hints).toMatchObject({ legalSettlements: [free], legalCities: [settlement] });
    expect(hints.legalSettlements).not.toContain(occupied);
    expect(hints.legalSettlements).not.toContain(adjacent);
    expect(hints.legalRoads).toEqual(actionHints(state, rivalId).legalRoads);
  });

  it('rejects a trade completing a one-road award even when the rival’s top plan is a city', () => {
    const state = actionState(1);
    const [start] = placeRoads(state, 4);
    state.board.buildings[start!] = { player: rivalId, city: false };
    give(state, selfId, { wool: 1, brick: 1 });
    knownRivalHand(state, { ore: 4, grain: 2, lumber: 1 });
    const offer: Offer = {
      id: 'road-offer', revision: 1, from: rivalId, to: selfId, status: 'open', responses: {},
      give: { ore: 1 }, want: { brick: 1 }, agreedWith: null, windowId: state.windowId, createdSeq: state.seq,
    };
    const turn = hardTurn(state);
    const { plans } = rivalModel(turn, rivalId).worlds[0]!.economy;
    expect(plans[0]?.kind).toBe('city');
    expect(plans).toContainEqual(expect.objectContaining({ kind: 'longestRoad', cost: { lumber: 1, brick: 1 } }));
    expect(offerGain(turn.economy, offer)).toBeGreaterThan(0.6);
    expect(hardAccepts(turn, offer)).toBe(false);

    state.board.roads.fill(null);
    placeRoads(state, 3);
    const twoRoadsShort = hardTurn(state);
    expect(rivalModel(twoRoadsShort, rivalId).worlds[0]!.economy.plans).toContainEqual(
      expect.objectContaining({ kind: 'longestRoad', cost: { lumber: 2, brick: 2 } }),
    );
    expect(hardAccepts(twoRoadsShort, offer)).toBe(true);
  });

  it('keeps an offer estimable when the tracker has only a fractional expectation', () => {
    const state = actionState();
    give(state, rivalId, { wool: 2 });
    const turn = hardTurn(state);
    expect(turn.hand(rivalId)).toMatchObject({ worlds: [], size: 2 });
    const rival = rivalModel(turn, rivalId);
    expect(rival.worlds).toMatchObject([{ p: 1, hand: { lumber: 1, brick: 1, wool: 0, grain: 0, ore: 0 } }]);
    expect(acceptOdds(turn, rival, { give: { ore: 1 }, want: { brick: 1 } })).toBe(1);
    expect(rivalModel(turn, 'p3').worlds).toEqual([]);
  });

  it('reuses the same road candidate without changing plans for a different hand', () => {
    const state = actionState(1);
    placeRoads(state, 4);
    knownRivalHand(state, { lumber: 1, ore: 1 });
    const turn = hardTurn(state);
    const belief = turn.hand(rivalId)!;
    vi.spyOn(turn, 'hand').mockReturnValue({
      ...belief,
      worlds: [
        { p: 0.5, hand: belief.worlds[0]!.hand },
        { p: 0.5, hand: { ...belief.worlds[0]!.hand, ore: 0, brick: 1 } },
      ],
    });
    const [first, second] = rivalModel(turn, rivalId).worlds;
    expect(first!.economy.model.view.hints).toBe(second!.economy.model.view.hints);
    expect(second!.economy.model.view.hints!.legalRoads.length).toBeGreaterThan(1);
    expect(second!.economy.plans).toContainEqual(expect.objectContaining({ kind: 'longestRoad', eta: 0 }));
    expect(second!.economy.plans).toEqual(economyOf(second!.economy.model).plans);
  });
});
