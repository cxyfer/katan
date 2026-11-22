import { describe, expect, it } from 'vitest';
import { applyCommand, getTopology, type DevCardType, type GameView } from '@katan/rules';
import { createBotPolicy } from '../src/index.ts';
import type { BotContext } from '../src/types.ts';
import { historyOf, newBotGame, setHistory, viewFor } from './harness.ts';

const ctx: BotContext = { selfId: 'bot1', level: 'hard', seed: 1, offerPhases: {} };
const policy = createBotPolicy('hard');

function fixture(cards: DevCardType[], phase: 'preroll' | 'action' = 'action') {
  const { state, rng } = newBotGame({ profileId: 'base-2025', players: 3, seed: 17 });
  const me = state.players[0]!;
  const rival = state.players[1]!;
  state.turn.phase = phase;
  state.turn.seat = 0;
  state.turn.setup = null;
  me.devCards = cards;
  const topology = getTopology(state.board.layout.topologyId);
  const vertex = topology.vertices.findIndex(({ hexes }) => !hexes.includes(state.board.robber!));
  state.board.buildings[vertex] = { player: me.id, city: false };
  return { state, rng, me, rival, topology, vertex };
}

function decide(view: GameView) {
  return policy.decide(view, ctx);
}

describe('hard development-card timing', () => {
  it('saves the last knight when Largest Army is secure and nothing needs unblocking', () => {
    const { state, me, rival } = fixture(['knight'], 'preroll');
    state.awards.largestArmy = me.id;
    me.playedKnights = 4;
    rival.playedKnights = 2;
    expect(decide(viewFor(state, me.id))).toEqual({ type: 'turn.roll' });
  });

  it('defers an ordinary knight so a useful Monopoly can be played after the roll', () => {
    const { state, me, rival } = fixture(['knight', 'monopoly'], 'preroll');
    rival.resources.ore = 18;
    expect(decide(viewFor(state, me.id))).toEqual({ type: 'turn.roll' });
    state.turn.phase = 'action';
    expect(decide(viewFor(state, me.id))?.type).toBe('dev.playMonopoly');
  });

  it('saves Road Building when a legal road neither scores nor secures anything', () => {
    const { state, me } = fixture(['roadBuilding']);
    const view = viewFor(state, me.id);
    expect(view.hints!.legalRoads.length).toBeGreaterThan(0);
    expect(decide(view)).toEqual({ type: 'turn.end' });
  });

  it('uses both free placements when the second road secures Longest Road', () => {
    const { state, rng, me, topology, vertex } = fixture(['roadBuilding']);
    let end = vertex;
    const visited = new Set([vertex]);
    for (let length = 0; length < 3; length++) {
      const next = topology.vertices[end]!.edges.map((edge) => ({
        edge, vertex: topology.edges[edge]!.vertices.find((other) => other !== end)!,
      })).find((step) => !visited.has(step.vertex))!;
      state.board.roads[next.edge] = { player: me.id, ship: false };
      end = next.vertex;
      visited.add(end);
    }
    me.longestRoadLength = 3;
    let current = state;
    for (const type of ['dev.playRoadBuilding', 'build.road', 'build.road']) {
      const command = decide(viewFor(current, me.id))!;
      expect(command.type).toBe(type);
      const outcome = applyCommand(current, me.id, command, rng);
      if (!outcome.ok) throw new Error(outcome.error.code);
      current = outcome.state;
    }
    expect(current.awards.longestRoad).toBe(me.id);
  });

  it('considers Year of Plenty without inspecting bank stock before its pending window', () => {
    const { state, me } = fixture(['yearOfPlenty']);
    me.resources.grain = 2;
    me.resources.ore = 2;
    const view = viewFor(state, me.id);
    Object.defineProperty(view, 'bank', { get: () => { throw new Error('bank accessed before pending choice'); } });
    expect(decide(view)).toEqual({ type: 'dev.playYearOfPlenty' });
  });

  it('uses pending bank stock to finish a payable plan rather than chase an unavailable deficit', () => {
    const { state, rng, me, topology, vertex } = fixture([]);
    for (const hex of topology.vertices[vertex]!.hexes) {
      state.board.layout.terrain[hex] = 'mountains';
      state.board.layout.numbers[hex] = 6;
    }
    me.resources.grain = 2;
    me.resources.ore = 1;
    state.bank = { lumber: 0, brick: 0, wool: 1, grain: 0, ore: 1 };
    state.pending = { kind: 'yearOfPlenty', actor: me.id, remaining: 2 };
    const first = decide(viewFor(state, me.id))!;
    expect(first).toEqual({ type: 'pending.takeResource', resource: 'wool' });
    const outcome = applyCommand(state, me.id, first, rng);
    if (!outcome.ok) throw new Error(outcome.error.code);
    expect(decide(viewFor(outcome.state, me.id))).toEqual({ type: 'pending.takeResource', resource: 'ore' });
  });

  it('makes an immediate scoring build before a non-winning Monopoly', () => {
    const { state, me, rival } = fixture(['monopoly']);
    me.resources.grain = 2;
    me.resources.ore = 3;
    rival.resources.ore = 18;
    rival.resources.grain = 18;
    expect(decide(viewFor(state, me.id))?.type).toBe('build.city');
  });

  it('plays a guaranteed winning Monopoly even when the expected haul is only one card', () => {
    const { state, me, rival } = fixture(['monopoly']);
    me.devCards.push(...Array<DevCardType>(8).fill('victoryPoint'));
    me.resources.grain = 2;
    me.resources.ore = 2;
    rival.resources.ore = 1;
    state.seq++;
    setHistory(state, [...historyOf(state), {
      seq: state.seq, type: 'production.resolved', params: { grants: { [rival.id]: { ore: 1 } } },
    }]);
    expect(decide(viewFor(state, me.id))).toEqual({ type: 'dev.playMonopoly', resource: 'ore' });
  });
});
