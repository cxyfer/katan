/** R-TB-BA: Barbarian Attack (TB25 pp. 15–19). */

import { describe, expect, it } from 'vitest';
import { harborRates, scoreOf, topologyOf } from '../src/analysis.ts';
import { legalBuildingVertices, legalRoadEdges, type Command } from '../src/engine.ts';
import { COASTAL_TERRAIN, INNER_TERRAIN, PRINTED_NUMBERS } from '../src/modules/tradersBarbarians/barbarians/board.ts';
import { BA_DECK, edgeOrientation, type BarbarianAttackState } from '../src/modules/tradersBarbarians/barbarians/index.ts';
import type { CoinsState } from '../src/modules/tradersBarbarians/coins/index.ts';
import { getProfile } from '../src/profiles.ts';
import { seededRng } from '../src/rng.ts';
import { verticesOfHex } from '../src/topology.ts';
import type { GameState } from '../src/types.ts';
import { act, expectRejected, forceTurn, placeBuilding, placeRoad, runSetup, scriptedRng, setHand } from './helpers.ts';
import { simulateGame } from './simulate.ts';
import { barbarianBot, tb } from './tb-bots.ts';
import { clearBoard, resourceTotal, SIMULATION_TIMEOUT, tbCreate, tbPlayable } from './tb-helpers.ts';

const PROFILE = 'tb-barbarian-attack-2025';
const ba = (state: GameState) => tb<BarbarianAttackState>(state, 'tb-barbarian-attack');
const coins = (state: GameState) => tb<CoinsState>(state, 'tb-coins');
const run = (state: GameState, actor: string, command: Record<string, unknown>, rng = seededRng(3)) =>
  act(state, actor, command as unknown as Command, rng);
const reject = (state: GameState, actor: string, command: Record<string, unknown>, code: string) =>
  expectRejected(state, actor, command as unknown as Command, code);
/** Scripted values for one two-dice roll with the given total. */
const roll = (total: number): [number, number] => {
  const first = Math.max(1, Math.min(6, total - 1));
  return [first - 1, total - first - 1];
};

function bare(): GameState {
  const state = tbPlayable(PROFILE, { seed: 9 });
  clearBoard(state);
  for (const player of state.players) setHand(state, player.id, {});
  const slot = ba(state);
  slot.knights = [];
  for (const hex of slot.coastal) slot.barbarians[hex] = 0;
  slot.supply = 36;
  return state;
}

function hexWith(state: GameState, number: number): number {
  return ba(state).coastal.find((hex) => state.board.layout.numbers[hex] === number)!;
}

function edgesOf(state: GameState, hex: number): number[] {
  return topologyOf(state).edges.map((info, edge) => (info.hexes.includes(hex) ? edge : -1)).filter((edge) => edge >= 0);
}

describe('R-TB-BA setup (p. 15)', () => {
  it('BA1: castle, desert and printed numbers; random coastal/inner terrain; barbarians on 2 and 12; 26 cards', () => {
    for (const seed of [1, 2, 3]) {
      const state = tbCreate(PROFILE, { seed });
      const topology = topologyOf(state);
      const at = (q: number, r: number) => topology.hexes.findIndex((hex) => hex.q === q && hex.r === r);
      expect(state.board.layout.terrain[at(-2, 2)]).toBe('castle');
      expect(state.board.layout.terrain[at(2, -2)]).toBe('desert');
      for (const printed of PRINTED_NUMBERS) expect(state.board.layout.numbers[at(printed.q, printed.r)]).toBe(printed.number);
      const slot = ba(state);
      expect(slot.coastal.map((hex) => state.board.layout.terrain[hex]).sort()).toEqual([...COASTAL_TERRAIN].sort());
      const inner = topology.hexes.map((hex, index) => ({ hex, index })).filter(({ hex }) => Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r)) <= 1);
      expect(inner.map(({ index }) => state.board.layout.terrain[index]).sort()).toEqual([...INNER_TERRAIN].sort());
      // Every coastal number 2–12 except 7 appears exactly once.
      expect(slot.coastal.map((hex) => state.board.layout.numbers[hex]).sort((a, b) => a! - b!)).toEqual([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
      expect(slot.coastal[0]).toBe(at(-2, 1));
      expect(slot.barbarians[hexWith(state, 2)]).toBe(1);
      expect(slot.barbarians[hexWith(state, 12)]).toBe(1);
      expect(slot.supply).toBe(34);
      expect(slot.deck.slice().sort()).toEqual([...BA_DECK].sort());
      expect(state.board.robber).toBe(-1);
      expect(state.devDeck).toEqual([]);
    }
    expect(getProfile(PROFILE)).toMatchObject({ victoryTarget: 12, enabled: true });
  });

  it('BA2: the second setup placement is a city with one resource per adjacent hex; no barbarians during setup', () => {
    const state = runSetup(tbCreate(PROFILE, { seed: 4 }), seededRng(4));
    for (const player of state.players) {
      const cities = state.board.buildings.filter((building) => building?.player === player.id && building.city);
      expect(cities).toHaveLength(1);
    }
    expect(Object.values(ba(state).barbarians).reduce((sum, count) => sum + count, 0)).toBe(2);
  });
});

describe('R-TB-BA barbarians land and conquer (pp. 16–17)', () => {
  it('BA3: a building rolls three distinct non-7 totals; a conquered hex takes no more', () => {
    const state = bare();
    const conquered = hexWith(state, 8);
    ba(state).barbarians[conquered] = 3;
    placeRoad(state, 'p1', 0);
    const vertex = topologyOf(state).edges[0]!.vertices[1]!;
    setHand(state, 'p1', { lumber: 1, brick: 1, wool: 1, grain: 1 });
    const built = run(state, 'p1', { type: 'build.settlement', vertex },
      scriptedRng([...roll(3), ...roll(7), ...roll(9), ...roll(3), ...roll(8)]));
    const landed = built.events.find((event) => event.type === 'tb.barbariansLanded')!;
    expect(landed.params).toMatchObject({ rolls: [3, 9, 8], hexes: [hexWith(state, 3), hexWith(state, 9)] });
    expect(ba(built.state).barbarians[conquered]).toBe(3);
    expect(ba(built.state).supply).toBe(34);
  });

  it('BA4: three barbarians conquer a hex: no production, no building there, conquered buildings lose VP and ports', () => {
    const state = bare();
    const hex = hexWith(state, 5);
    const topology = topologyOf(state);
    const coastal = verticesOfHex(topology, hex).find((vertex) => topology.vertices[vertex]!.hexes.length === 1)!;
    placeBuilding(state, 'p1', coastal);
    expect(scoreOf(state, 'p1', { includeHidden: false })).toBe(1);
    ba(state).barbarians[hex] = 3;
    expect(scoreOf(state, 'p1', { includeHidden: false })).toBe(0);
    forceTurn(state, 0, 'preroll');
    const produced = run(state, 'p1', { type: 'turn.roll' }, scriptedRng(roll(5))).state;
    expect(Object.values(produced.players[0]!.resources).reduce((a, b) => a + b, 0)).toBe(0);
    forceTurn(state, 0, 'action');
    expect(legalBuildingVertices(state, 'p2', { setup: true })).not.toContain(verticesOfHex(topology, hex)[0]);
    placeRoad(state, 'p1', topology.vertices[coastal]!.edges[0]!);
    for (const edge of legalRoadEdges(state, 'p1')) expect(topology.edges[edge]!.hexes).not.toContain(hex);
    // A harbour at a conquered building gives no rate.
    const harbor = state.board.layout.harbors[0]!;
    const port = topology.edges[harbor.edge]!.vertices[0]!;
    clearBoard(state);
    placeBuilding(state, 'p2', port);
    const before = harborRates(state, 'p2');
    for (const portHex of topology.vertices[port]!.hexes) ba(state).barbarians[portHex] = 3;
    expect(harborRates(state, 'p2')).not.toEqual(before);
    expect(Object.values(harborRates(state, 'p2'))).toEqual([4, 4, 4, 4, 4]);
  });

  it('BA5: on a 7 players discard, then the roller steals from a player of their choice', () => {
    const state = bare();
    forceTurn(state, 0, 'preroll');
    setHand(state, 'p2', { ore: 8 });
    setHand(state, 'p3', { wool: 1 });
    const rolled = run(state, 'p1', { type: 'turn.roll' }, scriptedRng(roll(7))).state;
    expect(rolled.pending).toMatchObject({ kind: 'discard' });
    const discarded = run(rolled, 'p2', { type: 'pending.discard', resources: ['ore', 'ore', 'ore', 'ore'] }).state;
    expect(discarded.pending).toMatchObject({ kind: 'tradersBarbarians.baSteal', responders: ['p1'] });
    reject(discarded, 'p1', { type: 'tb.baSteal', victim: 'p4' }, 'E_NO_ELIGIBLE_VICTIM');
    const stolen = run(discarded, 'p1', { type: 'tb.baSteal', victim: 'p3' }, scriptedRng([0]));
    expect(stolen.state.players[0]!.resources.wool).toBe(1);
    expect(stolen.events.find((event) => event.type === 'tb.baStole')!.private).toEqual({ to: ['p1', 'p3'], params: { resource: 'wool' } });
    expect(stolen.state.board.robber).toBe(-1);
  });
});

describe('R-TB-BA development cards (p. 17)', () => {
  const buyWith = (state: GameState, card: string) => {
    ba(state).deck = [card as never];
    ba(state).discard = [];
    setHand(state, 'p1', { wool: 1, grain: 1, ore: 1 });
    return run(state, 'p1', { type: 'tb.buildBaCard' }, scriptedRng([0, 0, 0]));
  };

  it('BA6: Capture takes a barbarian as a prisoner and liberates a conquered hex; with none it is replaced', () => {
    const state = bare();
    reject(state, 'p1', { type: 'build.devCard' }, 'E_DECK_EMPTY');
    const hex = hexWith(state, 6);
    ba(state).barbarians[hex] = 3;
    const drawn = buyWith(state, 'capture');
    expect(drawn.state.pending).toMatchObject({ kind: 'tradersBarbarians.baCapture' });
    const captured = run(drawn.state, 'p1', { type: 'tb.baCapture', hex });
    expect(ba(captured.state).barbarians[hex]).toBe(2);
    expect(ba(captured.state).prisoners.p1).toBe(1);
    expect(captured.events.map((event) => event.type)).toContain('tb.hexLiberated');
    expect(ba(captured.state).discard).toEqual(['capture']);
    // No barbarians on the coast: the Capture is discarded and the next card is played.
    const empty = bare();
    ba(empty).deck = ['knighthood', 'capture'];
    setHand(empty, 'p1', { wool: 1, grain: 1, ore: 1 });
    const replaced = run(empty, 'p1', { type: 'tb.buildBaCard' }, scriptedRng([1, 0]));
    expect(replaced.state.pending).toMatchObject({ kind: 'tradersBarbarians.baKnighthood' });
    expect(ba(replaced.state).discard.sort()).toEqual(['capture', 'knighthood']);
  });

  it('BA7: Knighthood places a knight on an empty castle edge; Swift Knight on any empty edge', () => {
    const state = bare();
    const castle = ba(state).castle;
    const castleEdge = edgesOf(state, castle)[0]!;
    const knighted = buyWith(state, 'knighthood').state;
    reject(knighted, 'p1', { type: 'tb.baPlaceKnight', edge: 0 }, 'E_ILLEGAL_TARGET');
    const placed = run(knighted, 'p1', { type: 'tb.baPlaceKnight', edge: castleEdge }).state;
    expect(ba(placed).knights).toEqual([{ player: 'p1', edge: castleEdge }]);
    const swift = buyWith(placed, 'swiftKnight').state;
    reject(swift, 'p1', { type: 'tb.baPlaceKnight', edge: castleEdge }, 'E_ILLEGAL_TARGET');
    expect(ba(run(swift, 'p1', { type: 'tb.baPlaceKnight', edge: 30 }).state).knights).toHaveLength(2);
  });

  it('BA8: Treason pays 2 gold and moves two barbarians to two other unconquered coastal hexes', () => {
    const state = bare();
    const [a, b, c, d] = [hexWith(state, 2), hexWith(state, 3), hexWith(state, 4), hexWith(state, 5)];
    ba(state).barbarians[a] = 1;
    ba(state).barbarians[b] = 2;
    ba(state).barbarians[d] = 3;
    const drawn = buyWith(state, 'treason').state;
    expect(coins(drawn).gold.p1).toBe(2);
    reject(drawn, 'p1', { type: 'tb.baTreason', from: a, to: d }, 'E_ILLEGAL_TARGET');
    const first = run(drawn, 'p1', { type: 'tb.baTreason', from: a, to: c }).state;
    // The second barbarian comes from another hex and goes to yet another one.
    reject(first, 'p1', { type: 'tb.baTreason', from: a, to: hexWith(state, 6) }, 'E_ILLEGAL_TARGET');
    reject(first, 'p1', { type: 'tb.baTreason', from: c, to: hexWith(state, 6) }, 'E_ILLEGAL_TARGET');
    reject(first, 'p1', { type: 'tb.baTreason', from: b, to: c }, 'E_ILLEGAL_TARGET');
    const second = run(first, 'p1', { type: 'tb.baTreason', from: b, to: hexWith(state, 6) }).state;
    expect(second.pending).toBeNull();
    expect(ba(second).barbarians).toMatchObject({ [a]: 0, [b]: 1, [c]: 1, [hexWith(state, 6)]: 1 });
    // Without barbarians on the board they come from the supply.
    const none = bare();
    const fromSupply = run(buyWith(none, 'treason').state, 'p1', { type: 'tb.baTreason', from: -1, to: c }).state;
    expect(ba(fromSupply).supply).toBe(35);
  });
});

describe('R-TB-BA end of turn (pp. 17–18)', () => {
  function withKnights(knights: { player: string; edge: number }[]): GameState {
    const state = bare();
    ba(state).knights = knights.map((knight) => ({ ...knight }));
    return state;
  }

  it('BA9: knights move up to 3 edges (5 for a grain), never onto a castle edge; castle knights must move', () => {
    const castle = edgesOf(bare(), ba(bare()).castle);
    const state = withKnights([{ player: 'p1', edge: castle[0]! }]);
    const open = run(state, 'p1', { type: 'turn.end' }).state;
    expect(open.pending).toMatchObject({ kind: 'tradersBarbarians.baKnights', responders: ['p1'] });
    reject(open, 'p1', { type: 'tb.endKnights' }, 'E_TB_KNIGHT_MUST_MOVE');
    reject(open, 'p1', { type: 'tb.moveKnight', from: castle[0], to: castle[1] }, 'E_TB_KNIGHT_RANGE');
    const far = topologyOf(open).edges.findIndex((_, edge) => edge > 60);
    reject(open, 'p1', { type: 'tb.moveKnight', from: castle[0], to: far }, 'E_TB_KNIGHT_RANGE');
    const near = topologyOf(open).vertices[topologyOf(open).edges[castle[0]!]!.vertices[0]!]!.edges.find((edge) => !castle.includes(edge))!;
    const moved = run(open, 'p1', { type: 'tb.moveKnight', from: castle[0], to: near }).state;
    reject(moved, 'p1', { type: 'tb.moveKnight', from: near, to: castle[0] }, 'E_ILLEGAL_TARGET');
    const ended = run(moved, 'p1', { type: 'tb.endKnights' }).state;
    expect(ended.pending).toBeNull();
    expect(ended.turn.seat).toBe(1);
  });

  it('BA10: more knights than barbarians win; a sole player takes every prisoner; 2 prisoners are 1 VP', () => {
    const base = bare();
    const hex = hexWith(base, 4);
    const edges = edgesOf(base, hex);
    const state = withKnights(edges.slice(0, 3).map((edge) => ({ player: 'p2', edge })));
    ba(state).barbarians[hex] = 2;
    const ended = run(state, 'p1', { type: 'turn.end' }, scriptedRng([0])).state;
    expect(ba(ended).prisoners.p2).toBe(2);
    expect(ba(ended).barbarians[hex]).toBe(0);
    expect(scoreOf(ended, 'p2', { includeHidden: false })).toBe(1);
    // Equal numbers do not win.
    const tied = withKnights(edges.slice(0, 2).map((edge) => ({ player: 'p2', edge })));
    ba(tied).barbarians[hex] = 2;
    expect(ba(run(tied, 'p1', { type: 'turn.end' }).state).barbarians[hex]).toBe(2);
  });

  it('BA11: shared victories give one prisoner each, the spare to the most knights (dice on a tie, 3 gold to the loser)', () => {
    const base = bare();
    const hex = hexWith(base, 9);
    const edges = edgesOf(base, hex);
    const state = withKnights([
      { player: 'p2', edge: edges[0]! }, { player: 'p2', edge: edges[1]! },
      { player: 'p3', edge: edges[2]! }, { player: 'p3', edge: edges[3]! },
    ]);
    ba(state).barbarians[hex] = 3;
    // Tie 2–2: p2 rolls 2+2, p3 rolls 6+6; then the knight-loss die.
    const ended = run(state, 'p1', { type: 'turn.end' }, scriptedRng([1, 1, 5, 5, 0])).state;
    expect(ba(ended).prisoners).toMatchObject({ p2: 1, p3: 2 });
    expect(coins(ended).gold.p2).toBeGreaterThanOrEqual(3);
  });

  it('BA12: too few prisoners go by dice; the others take 3 gold; knights on the rolled orientation are lost for 3 gold', () => {
    const base = bare();
    const hex = hexWith(base, 11);
    const edges = edgesOf(base, hex);
    const state = withKnights([
      { player: 'p2', edge: edges[0]! }, { player: 'p3', edge: edges[1]! }, { player: 'p4', edge: edges[2]! },
    ]);
    ba(state).barbarians[hex] = 1;
    // p2 4, p3 12, p4 7 → p3 takes the prisoner; then die 3 (vertical edges).
    const ended = run(state, 'p1', { type: 'turn.end' }, scriptedRng([1, 1, 5, 5, 2, 3, 2])).state;
    expect(ba(ended).prisoners).toMatchObject({ p2: 0, p3: 1, p4: 0 });
    const lostVertical = edges.slice(0, 3).filter((edge) => edgeOrientation(ended, edge) === 'vertical').length;
    expect(ba(ended).knights).toHaveLength(3 - lostVertical);
    expect(coins(ended).gold.p2).toBeGreaterThanOrEqual(3);
    expect(coins(ended).gold.p4).toBeGreaterThanOrEqual(3);
  });
});

describe('R-TB-BA simulated games', () => {
  for (const players of [3, 4]) {
    it(`a ${players}-player game finishes and conserves resources, gold and barbarians`, () => {
      const state = simulateGame(players * 71, 15000, { players, profileId: PROFILE, mode: 'variable', bot: barbarianBot });
      expect(state.result).toMatchObject({ reason: 'victory' });
      expect(scoreOf(state, state.result!.playerId!, { includeHidden: true })).toBeGreaterThanOrEqual(12);
      for (const resource of ['lumber', 'brick', 'wool', 'grain', 'ore'] as const) expect(resourceTotal(state, resource)).toBe(19);
      const slot = ba(state);
      const onBoard = Object.values(slot.barbarians).reduce((sum, count) => sum + count, 0);
      const prisoners = Object.values(slot.prisoners).reduce((sum, count) => sum + count, 0);
      expect(onBoard + prisoners + slot.supply).toBe(36);
      expect(slot.deck.length + slot.discard.length).toBe(26);
      const gold = coins(state);
      expect(gold.supply + Object.values(gold.gold).reduce((sum, amount) => sum + amount, 0)).toBe(100);
    }, SIMULATION_TIMEOUT);
  }
});
