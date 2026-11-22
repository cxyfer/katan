import { describe, expect, it, vi } from 'vitest';
import { COSTS, getTopology, type GameState } from '@katan/rules';
import { act, forceTurn, give, newGame } from '../../rules/test/helpers.ts';
import type { Cost, Economy } from '../src/economy.ts';
import { hardHandRelief } from '../src/hard/hand-relief.ts';
import { HardTurn } from '../src/hard/turn.ts';
import { createBotPolicy } from '../src/index.ts';
import type { BotContext } from '../src/types.ts';
import { viewFor } from './harness.ts';

const ctx: BotContext = { selfId: 'p1', level: 'hard', seed: 1, offerPhases: {} };

function actionState(resources: Parameters<typeof give>[2], players = 4): GameState {
  const { state } = newGame({ players, profileId: players > 4 ? 'base-paired-2025' : 'base-2025' });
  forceTurn(state, 0, 'action');
  give(state, ctx.selfId, resources);
  return state;
}

function turnOf(state: GameState): HardTurn {
  const view = viewFor(state, ctx.selfId);
  return new HardTurn(view, ctx, view.players[0]!);
}

function reserve(turn: HardTurn, cost: Cost, valuation: Partial<Pick<Economy, 'rates' | 'weights'>> = {}): void {
  const economy = turn.economy;
  vi.spyOn(turn, 'economy', 'get').mockReturnValue({
    ...economy,
    ...valuation,
    plans: [{ kind: 'settlement', vertex: null, roads: [], ships: [], cost, nextCost: COSTS.road, value: 1, eta: 1, score: 0.5 }],
  });
}

function placeOreSettlements(state: GameState): void {
  const topo = getTopology(state.board.layout.topologyId);
  const ore = state.board.layout.terrain
    .map((terrain, hex) => ({ terrain, hex, pips: 6 - Math.abs(7 - (state.board.layout.numbers[hex] ?? 7)) }))
    .filter(({ terrain }) => terrain === 'mountains')
    .sort((first, second) => second.pips - first.pips);
  for (const { hex } of ore.slice(0, 2)) {
    const vertex = topo.vertices.findIndex((entry, index) => entry.hexes.includes(hex) &&
      !state.board.buildings[index] && entry.edges.every((edge) =>
        topo.edges[edge]!.vertices.every((neighbor) => !state.board.buildings[neighbor]),
      ));
    state.board.buildings[vertex] = { player: ctx.selfId, city: false };
  }
}

describe('hard hand relief', () => {
  it('ends the turn with eight cards when a four-card discard can preserve the city plan', () => {
    const state = actionState({ lumber: 2, wool: 2, grain: 2, ore: 2 });
    placeOreSettlements(state);
    const turn = turnOf(state);
    expect(turn.economy.plans[0]?.kind).toBe('city');
    expect(createBotPolicy('hard').decide(turn.view, ctx)).toEqual({ type: 'turn.end' });
  });

  it('builds a road if discarding half must consume cards reserved for the main plan', () => {
    const state = actionState({ lumber: 4, brick: 3, ore: 1 });
    state.board.buildings[0] = { player: ctx.selfId, city: false };
    const turn = turnOf(state);
    reserve(turn, { lumber: 4, brick: 4, wool: 1, grain: 1 });
    const command = hardHandRelief(turn);
    expect(command?.type).toBe('build.road');
    expect(act(state, ctx.selfId, command!).events.some((event) => event.type === 'build.road')).toBe(true);
  });

  it('trades at port before a safe build without using the private bank field', () => {
    const state = actionState({ lumber: 3, brick: 1, grain: 2, ore: 2 });
    const topo = getTopology(state.board.layout.topologyId);
    const port = state.board.layout.harbors.find((harbor) => harbor.type === 'lumber')!;
    state.board.buildings[topo.edges[port.edge]!.vertices[0]] = { player: ctx.selfId, city: false };
    const turn = turnOf(state);
    reserve(turn, COSTS.city);
    Object.defineProperty(turn.view, 'bank', { get: () => { throw new Error('read bank stock'); } });
    const command = hardHandRelief(turn);
    expect(command).toEqual({ type: 'trade.bank', give: 'lumber', receive: 'ore' });
    expect(act(state, ctx.selfId, command!).events.some((event) => event.type === 'trade.bank')).toBe(true);
  });

  it.each([
    ['received lumber', { give: 'wool', receive: 'lumber' }, { type: 'build.road' }],
    ['gave ore', { give: 'ore', receive: 'wool' }, { type: 'trade.bank', give: 'lumber' }],
  ])('obeys same-window trade history after it %s', (_label, trade, expected) => {
    const state = actionState({ lumber: 4, brick: 1, grain: 2, ore: 2 });
    state.board.buildings[0] = { player: ctx.selfId, city: false };
    const turn = turnOf(state);
    reserve(turn, COSTS.city);
    turn.view.events.push({ seq: turn.view.seq + 1, type: 'trade.bank', params: { playerId: ctx.selfId, rate: 4, ...trade } });
    const command = hardHandRelief(turn);
    expect(command).toMatchObject(expected);
    if (command?.type === 'trade.bank') expect(command.receive).not.toBe(trade.give);
  });

  it.each([[5, 1, null], [5, 2, 'build.devCard'], [6, 1, 'build.devCard'], [6, 2, 'build.devCard']] as const)(
    'uses the expected discard loss with %i players in paired window %i', (players, actor, expected) => {
      const state = actionState({ wool: 12, grain: 11, ore: 1 }, players);
      give(state, 'p2', { lumber: 24 });
      state.turn.pairedActor = actor;
      const turn = turnOf(state);
      reserve(turn, { ore: 2 }, {
        rates: { lumber: 2, brick: 2, wool: 2, grain: 2, ore: 2 },
        weights: { lumber: 1.3, brick: 1.3, wool: 1.3, grain: 1.3, ore: 1.3 },
      });
      expect(hardHandRelief(turn)?.type ?? null).toBe(expected);
    },
  );
});
