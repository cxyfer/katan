/**
 * R-TB-FI: Fishing on Catan (TB25 pp. 9–10). Each case states its start
 * state, actor/window, command, expected public/private result and clause.
 */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { applyCommand, type Command } from '../src/engine.ts';
import { BASE_NUMBER_TOKENS, BASE_TERRAIN_MULTISET } from '../src/layout.ts';
import { GROUND_NUMBERS } from '../src/modules/tradersBarbarians/fishing/board.ts';
import type { FishingState } from '../src/modules/tradersBarbarians/fishing/index.ts';
import { getProfile } from '../src/profiles.ts';
import { projectGame } from '../src/project.ts';
import { seededRng } from '../src/rng.ts';
import { verticesOfHex } from '../src/topology.ts';
import type { GameState, ModulePending } from '../src/types.ts';
import { act, expectRejected, forceTurn, placeBuilding, placeRoad, scriptedRng, setHand } from './helpers.ts';
import { simulateGame } from './simulate.ts';
import { fishingBot, tb } from './tb-bots.ts';
import { clearBoard, resourceTotal, SIMULATION_TIMEOUT, tbCreate, tbPlayable } from './tb-helpers.ts';

const PROFILE = 'tb-fishing-2025';
const fish = (state: GameState) => tb<FishingState>(state, 'tb-fishing');
const run = (state: GameState, actor: string, command: Record<string, unknown>, rng = seededRng(3)) =>
  act(state, actor, command as unknown as Command, rng);
const reject = (state: GameState, actor: string, command: Record<string, unknown>, code: string) =>
  expectRejected(state, actor, command as unknown as Command, code);

/** Dice values (0-based for the scripted rng) summing to `total`. */
function dice(total: number): [number, number] {
  const first = Math.max(1, Math.min(6, total - 1));
  return [first - 1, total - first - 1];
}

/** An empty-board game in p1's pre-roll window. */
function bare(seed = 5): GameState {
  const state = tbPlayable(PROFILE, { seed, phase: 'preroll' });
  clearBoard(state);
  for (const player of state.players) setHand(state, player.id, {});
  const slot = fish(state);
  for (const id of Object.keys(slot.hands)) slot.hands[id] = [];
  slot.supply = { fish: [11, 10, 8], boot: 1 };
  slot.discard = [0, 0, 0];
  slot.boot = null;
  return state;
}

function fishTotal(state: GameState): [number, number, number, number] {
  const slot = fish(state);
  const counts: [number, number, number, number] = [slot.supply.fish[0] + slot.discard[0], slot.supply.fish[1] + slot.discard[1], slot.supply.fish[2] + slot.discard[2], slot.supply.boot + (slot.boot ? 1 : 0)];
  for (const hand of Object.values(slot.hands)) for (const value of hand) counts[value - 1]! += 1;
  return counts;
}

describe('R-TB-FI Fishing on Catan setup (p. 9)', () => {
  it('FI1: lake in the inner area, 18 base land hexes, six numbered grounds, robber beside the board', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = tbCreate(PROFILE, { seed });
      const topology = topologyOf(state);
      const lake = state.board.layout.terrain.indexOf('lake');
      const coord = topology.hexes[lake]!;
      expect(Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(coord.q + coord.r))).toBeLessThanOrEqual(1);
      const land = state.board.layout.terrain.filter((terrain) => terrain !== 'lake').sort();
      expect(land).toEqual(BASE_TERRAIN_MULTISET.filter((terrain) => terrain !== 'desert').slice().sort());
      expect(state.board.layout.numbers[lake]).toBeNull();
      expect(state.board.layout.numbers.filter((value) => value !== null).sort((a, b) => a! - b!)).toEqual([...BASE_NUMBER_TOKENS]);
      expect(state.board.robber).toBe(-1);
      const slot = fish(state);
      expect(slot.grounds.map((ground) => ground.number).sort((a, b) => a - b)).toEqual([...GROUND_NUMBERS]);
      const seen = new Set<number>();
      for (const ground of slot.grounds) {
        for (const edge of ground.edges) {
          expect(topology.edges[edge]!.hexes).toHaveLength(1);
          expect(topology.edges[edge]!.vertices).toContain(ground.valley);
        }
        expect(topology.vertices[ground.valley]!.hexes).toHaveLength(2);
        for (const vertex of ground.vertices) {
          expect(seen.has(vertex)).toBe(false);
          seen.add(vertex);
        }
      }
      // The frame keeps grounds and harbours apart.
      const harborEdges = new Set(state.board.layout.harbors.map((harbor) => harbor.edge));
      for (const ground of slot.grounds) for (const edge of ground.edges) expect(harborEdges.has(edge)).toBe(false);
      expect(fishTotal(state)).toEqual([11, 10, 8, 1]);
    }
    expect(getProfile(PROFILE)).toMatchObject({ victoryTarget: 10, setupModes: ['variable'], enabled: true });
  });

  it('FI2: only a second settlement next to a ground or the lake draws one fish', () => {
    const state = tbCreate(PROFILE, { seed: 9 });
    const slot = fish(state);
    const ground = slot.grounds[0]!.vertices[1]!;
    // Round 1 on a ground vertex: no fish.
    const first = run(state, 'p1', { type: 'setup.placeBuilding', vertex: ground }).state;
    expect(fish(first).hands.p1).toEqual([]);
    // Round 2: forward to p1's second placement on the lake.
    let current = first;
    const topology = topologyOf(state);
    current = run(current, 'p1', { type: 'setup.placeRoad', edge: topology.vertices[ground]!.edges[0]! }).state;
    while (current.turn.setup && current.turn.setup.order[current.turn.setup.index] !== 0) {
      const seat = current.turn.setup.order[current.turn.setup.index]!;
      const actor = current.players[seat]!.id;
      const lakeVertices = new Set(verticesOfHex(topology, fish(current).lake));
      const groundVertices = new Set(fish(current).grounds.flatMap((item) => item.vertices));
      const vertex = topology.vertices.findIndex((_, index) => !lakeVertices.has(index) && !groundVertices.has(index) &&
        applyCommand(current, actor, { type: 'setup.placeBuilding', vertex: index }, seededRng(1)).ok);
      current = run(current, actor, { type: 'setup.placeBuilding', vertex }).state;
      const edge = topology.vertices[vertex]!.edges.find((candidate) =>
        applyCommand(current, actor, { type: 'setup.placeRoad', edge: candidate }, seededRng(1)).ok)!;
      current = run(current, actor, { type: 'setup.placeRoad', edge }).state;
    }
    const lakeVertex = verticesOfHex(topology, fish(current).lake).find((vertex) =>
      applyCommand(current, 'p1', { type: 'setup.placeBuilding', vertex }, seededRng(1)).ok)!;
    const placed = run(current, 'p1', { type: 'setup.placeBuilding', vertex: lakeVertex }, seededRng(4));
    expect(fish(placed.state).hands.p1).toHaveLength(1);
    const drawn = placed.events.find((event) => event.type === 'tb.fishDrawn')!;
    expect(drawn.params).toEqual({ playerId: 'p1', count: 1 });
    expect(drawn.private).toMatchObject({ to: ['p1'] });
  });
});

describe('R-TB-FI fish production (p. 10)', () => {
  it('FI3: a ground pays 1 token per settlement and 2 per city, active player first', () => {
    const state = bare();
    const ground = fish(state).grounds[0]!;
    placeBuilding(state, 'p2', ground.vertices[1]!, true);
    placeBuilding(state, 'p1', ground.vertices[2]!);
    forceTurn(state, 1, 'preroll'); // p2 rolls
    const rolled = run(state, 'p2', { type: 'turn.roll' }, scriptedRng([...dice(ground.number), 0, 0, 0]));
    const draws = rolled.events.filter((event) => event.type === 'tb.fishDrawn');
    expect(draws.map((event) => event.params)).toEqual([{ playerId: 'p2', count: 2 }, { playerId: 'p1', count: 1 }]);
    expect(fish(rolled.state).hands.p2).toHaveLength(2);
    expect(fish(rolled.state).hands.p1).toHaveLength(1);
  });

  it('FI4: the lake pays on 2, 3, 11 and 12 unless the robber stands on it; 7 pays no fish', () => {
    const state = bare();
    const slot = fish(state);
    const vertex = verticesOfHex(topologyOf(state), slot.lake)[0]!;
    placeBuilding(state, 'p1', vertex);
    for (const total of [2, 3, 11, 12]) {
      const rolled = run(state, 'p1', { type: 'turn.roll' }, scriptedRng([...dice(total), 0]));
      expect(fish(rolled.state).hands.p1, `total ${total}`).toHaveLength(1);
    }
    state.board.robber = slot.lake;
    expect(fish(run(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice(11))).state).hands.p1).toHaveLength(0);
    state.board.robber = -1;
    const seven = run(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice(7))).state;
    expect(fish(seven).hands.p1).toHaveLength(0);
    // The robber enters from beside the board on the 7.
    expect(seven.pending).toMatchObject({ kind: 'moveRobber' });
    expect(run(seven, 'p1', { type: 'pending.moveRobber', hex: slot.lake }).state.board.robber).toBe(slot.lake);
  });

  it('FI5: at 7 tokens a player may swap one token once, then stops; later players still draw', () => {
    const state = bare();
    const ground = fish(state).grounds[0]!;
    placeBuilding(state, 'p1', ground.vertices[1]!, true);
    placeBuilding(state, 'p2', ground.vertices[2]!);
    fish(state).hands.p1 = [1, 1, 1, 2, 2, 3, 3];
    fish(state).supply.fish[0] -= 3; fish(state).supply.fish[1] -= 2; fish(state).supply.fish[2] -= 2;
    const rolled = run(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice(ground.number))).state;
    expect(rolled.pending).toMatchObject({ kind: 'tradersBarbarians.fishSwap', responders: ['p1'] });
    expect(projectGame(rolled, 'p2').pending).toMatchObject({ data: {} });
    reject(rolled, 'p2', { type: 'tb.fishSwap', token: 1 }, 'E_NOT_ACTOR');
    reject(rolled, 'p1', { type: 'turn.end' }, 'E_PENDING_EFFECT');
    const swapped = run(rolled, 'p1', { type: 'tb.fishSwap', token: 1 }, scriptedRng([20, 0]));
    expect(fish(swapped.state).hands.p1).toHaveLength(7);
    expect(fish(swapped.state).discard).toEqual([1, 0, 0]);
    // p2 then draws normally and the frame is gone.
    expect(fish(swapped.state).hands.p2).toHaveLength(1);
    expect(swapped.state.pending).toBeNull();
    // Declining keeps the hand.
    const declined = run(rolled, 'p1', { type: 'tb.fishSwap', token: null }, scriptedRng([0]));
    expect(fish(declined.state).hands.p1).toEqual([1, 1, 1, 2, 2, 3, 3]);
  });

  it('FI6: drawing the old boot reveals it and raises the holder target to 11', () => {
    const state = bare();
    const ground = fish(state).grounds[0]!;
    placeBuilding(state, 'p1', ground.vertices[1]!);
    fish(state).supply = { fish: [0, 0, 0], boot: 1 };
    const rolled = run(state, 'p1', { type: 'turn.roll' }, scriptedRng([...dice(ground.number), 0]));
    expect(rolled.events.map((event) => event.type)).toContain('tb.bootDrawn');
    expect(fish(rolled.state).boot).toBe('p1');
    const view = projectGame(rolled.state, 'p2');
    expect(view.players[0]!.victoryTarget).toBe(11);
    expect((view.modules!.tradersBarbarians as Record<string, { boot: string }>)['tb-fishing']!.boot).toBe('p1');
    // 10 VP is not enough for the boot holder.
    rolled.state.players[0]!.bonusPoints = 9;
    forceTurn(rolled.state, 3, 'action');
    expect(run(rolled.state, 'p4', { type: 'turn.end' }).state.result).toBeNull();
  });

  it('FI7: refills the face-down supply from the discard pile when it runs out', () => {
    const state = bare();
    const ground = fish(state).grounds[0]!;
    placeBuilding(state, 'p1', ground.vertices[1]!);
    fish(state).supply = { fish: [0, 0, 0], boot: 0 };
    fish(state).boot = 'p4';
    fish(state).discard = [0, 2, 0];
    const rolled = run(state, 'p1', { type: 'turn.roll' }, scriptedRng([...dice(ground.number), 1]));
    expect(rolled.events.map((event) => event.type)).toContain('tb.fishRefilled');
    expect(fish(rolled.state).hands.p1).toEqual([2]);
    expect(fish(rolled.state).discard).toEqual([0, 0, 0]);
  });
});

describe('R-TB-FI old boot and fish actions (p. 10)', () => {
  it('FI8: the boot goes only to a player with the same or more public VP, on the holder turn', () => {
    const state = bare();
    forceTurn(state, 0, 'action');
    fish(state).boot = 'p1';
    fish(state).supply.boot = 0;
    state.players[0]!.bonusPoints = 4;
    state.players[1]!.bonusPoints = 3;
    state.players[2]!.bonusPoints = 4;
    state.players[2]!.devCards = [];
    state.players[1]!.devCards = ['victoryPoint', 'victoryPoint'];
    reject(state, 'p1', { type: 'tb.giveBoot', to: 'p2' }, 'E_TB_BOOT_TARGET');
    reject(state, 'p2', { type: 'tb.giveBoot', to: 'p3' }, 'E_NOT_YOUR_TURN');
    const given = run(state, 'p1', { type: 'tb.giveBoot', to: 'p3' }).state;
    expect(fish(given).boot).toBe('p3');
    forceTurn(given, 0, 'action');
    reject(given, 'p1', { type: 'tb.giveBoot', to: 'p3' }, 'E_TB_BOOT_NOT_HELD');
  });

  it('FI9: each action costs its fish; excess is lost; tokens must be held and cover the cost', () => {
    const state = bare();
    forceTurn(state, 0, 'action');
    fish(state).hands.p1 = [3, 3, 2, 1];
    reject(state, 'p1', { type: 'tb.spendFish', action: 'takeResource', tokens: [3, 3, 3] }, 'E_TB_FISH_NOT_HELD');
    reject(state, 'p1', { type: 'tb.spendFish', action: 'takeResource', tokens: [3], resource: 'ore' }, 'E_TB_FISH_SHORT');
    reject(state, 'p1', { type: 'tb.spendFish', action: 'removeRobber', tokens: [2] }, 'E_TB_NO_ROBBER');
    const took = run(state, 'p1', { type: 'tb.spendFish', action: 'takeResource', tokens: [3, 2], resource: 'ore' }).state;
    expect(took.players[0]!.resources.ore).toBe(1);
    expect(fish(took).hands.p1).toEqual([3, 1]);
    expect(fish(took).discard).toEqual([0, 1, 1]);
    took.board.robber = 4;
    const removed = run(took, 'p1', { type: 'tb.spendFish', action: 'removeRobber', tokens: [3] }).state;
    expect(removed.board.robber).toBe(-1);
  });

  it('FI10: stealing takes a random resource from the chosen player, shown only to the two', () => {
    const state = bare();
    forceTurn(state, 0, 'action');
    fish(state).hands.p1 = [3];
    setHand(state, 'p3', { wool: 1, ore: 1 });
    reject(state, 'p1', { type: 'tb.spendFish', action: 'steal', tokens: [3], victim: 'p2' }, 'E_NO_ELIGIBLE_VICTIM');
    const stole = run(state, 'p1', { type: 'tb.spendFish', action: 'steal', tokens: [3], victim: 'p3' }, scriptedRng([1]));
    expect(stole.state.players[0]!.resources.ore).toBe(1);
    const event = stole.events.find((candidate) => candidate.type === 'tb.fishStole')!;
    expect(event.params).toEqual({ playerId: 'p1', victim: 'p3' });
    expect(event.private).toEqual({ to: ['p1', 'p3'], params: { resource: 'ore' } });
  });

  it('FI11: 5 fish build a legal free road; 7 fish build a development card', () => {
    const state = bare();
    forceTurn(state, 0, 'action');
    const topology = topologyOf(state);
    placeBuilding(state, 'p1', 10);
    const edge = topology.vertices[10]!.edges[0]!;
    fish(state).hands.p1 = [3, 2, 3, 3, 1];
    const far = topology.edges.findIndex((_, index) => !topology.edges[index]!.vertices.includes(10) &&
      !topology.vertices[10]!.edges.some((candidate) => topology.edges[candidate]!.vertices.some((v) => topology.edges[index]!.vertices.includes(v))));
    reject(state, 'p1', { type: 'tb.spendFish', action: 'road', tokens: [3, 2], edge: far }, 'E_ILLEGAL_TARGET');
    const road = run(state, 'p1', { type: 'tb.spendFish', action: 'road', tokens: [3, 2], edge }).state;
    expect(road.board.roads[edge]).toEqual({ player: 'p1', ship: false });
    const deck = road.devDeck.length;
    const card = run(road, 'p1', { type: 'tb.spendFish', action: 'devCard', tokens: [3, 3, 1] }, scriptedRng([0]));
    expect(card.state.devDeck).toHaveLength(deck - 1);
    expect(card.state.players[0]!.newDevCards).toHaveLength(1);
    expect(card.events.find((event) => event.type === 'tb.fishDevCard')!.private).toMatchObject({ to: ['p1'] });
  });

  it('FI12: fish are not resources — no discard on a 7, not robbable, not tradeable', () => {
    const state = bare();
    fish(state).hands.p2 = [3, 3, 3, 3, 3, 3, 3];
    setHand(state, 'p2', { wool: 7 });
    const seven = run(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice(7))).state;
    // 7 resource cards: no discard although p2 also holds 7 fish tokens.
    expect(seven.pending).toMatchObject({ kind: 'moveRobber' });
    forceTurn(state, 0, 'action');
    reject(state, 'p1', { type: 'trade.offer', to: 'p2', give: {}, want: {}, wantGoods: { fish: 1 } }, 'E_INVALID_SELECTION');
  });

  it('FI13: other players see token counts, never values', () => {
    const state = bare();
    fish(state).hands.p1 = [3, 1];
    const mine = (projectGame(state, 'p1').modules!.tradersBarbarians as Record<string, Record<string, unknown>>)['tb-fishing']!;
    const theirs = (projectGame(state, 'p2').modules!.tradersBarbarians as Record<string, Record<string, unknown>>)['tb-fishing']!;
    expect(mine.mine).toEqual([3, 1]);
    expect(theirs.mine).toEqual([]);
    expect(theirs.tokenCounts).toMatchObject({ p1: 2 });
    expect(JSON.stringify(theirs)).not.toContain('"hands"');
    void placeRoad;
  });
});

describe('R-TB-FI clause fixtures (pp. 9–10)', () => {
  it('FI14: TB25 p.10 — fish actions and giving the boot are turn-time actions: rejected in the pre-roll window', () => {
    // Start: p1's pre-roll window, holding 7 fish and the boot. Command: tb.spendFish / tb.giveBoot.
    const state = bare();
    fish(state).hands.p1 = [3, 3, 1];
    fish(state).boot = 'p1';
    fish(state).supply.boot = 0;
    reject(state, 'p1', { type: 'tb.spendFish', action: 'takeResource', tokens: [3, 1], resource: 'ore' }, 'E_WRONG_PHASE');
    reject(state, 'p1', { type: 'tb.giveBoot', to: 'p2' }, 'E_WRONG_PHASE');
    // After the roll the same command is accepted.
    const rolled = run(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice(8))).state;
    expect(rolled.turn.phase).toBe('action');
    expect(run(rolled, 'p1', { type: 'tb.spendFish', action: 'takeResource', tokens: [3, 1], resource: 'ore' }).state.players[0]!.resources.ore).toBe(1);
  });

  it('FI15: TB25 p.10 — a removed robber re-enters the board by a Knight or by a 7', () => {
    // Start: the robber stands on hex 4; p1 pays 2 fish to remove it, then plays a Knight; a second game rolls a 7.
    const state = bare();
    forceTurn(state, 0, 'action');
    fish(state).hands.p1 = [2];
    state.board.robber = 4;
    state.players[0]!.devCards = ['knight'];
    const removed = run(state, 'p1', { type: 'tb.spendFish', action: 'removeRobber', tokens: [2] }).state;
    expect(removed.board.robber).toBe(-1);
    const hex = state.board.layout.terrain.findIndex((terrain, index) => terrain !== 'lake' && index !== 4);
    expect(run(removed, 'p1', { type: 'dev.playKnight', hex }).state.board.robber).toBe(hex);
    // A 7 also brings it back.
    const seven = bare();
    seven.board.robber = -1;
    const pending = run(seven, 'p1', { type: 'turn.roll' }, scriptedRng(dice(7))).state;
    expect(pending.pending).toMatchObject({ kind: 'moveRobber' });
    expect(run(pending, 'p1', { type: 'pending.moveRobber', hex }).state.board.robber).toBe(hex);
  });

  it('FI16: TB25 p.10 — giving the boot lowers the holder\'s own target, so the giver wins at once with 10 VP', () => {
    // Start: p1 (boot, target 11) has 10 public VP; p2 also has 10. Window: p1's action phase; command: tb.giveBoot.
    const state = bare();
    forceTurn(state, 0, 'action');
    fish(state).boot = 'p1';
    fish(state).supply.boot = 0;
    state.players[0]!.bonusPoints = 10;
    state.players[1]!.bonusPoints = 10;
    const given = run(state, 'p1', { type: 'tb.giveBoot', to: 'p2' });
    expect(fish(given.state).boot).toBe('p2');
    expect(given.state.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
  });

  it('FI17: TB25 p.10 — the replacement drawn by a swap may be the old boot (target +1, token not added)', () => {
    // Start: p1 holds 7 fish and is paid on a ground; only the boot remains face down.
    const state = bare();
    const ground = fish(state).grounds[0]!;
    placeBuilding(state, 'p1', ground.vertices[1]!);
    fish(state).hands.p1 = [1, 1, 1, 2, 2, 3, 3];
    fish(state).supply = { fish: [0, 0, 0], boot: 1 };
    const rolled = run(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice(ground.number))).state;
    expect(rolled.pending).toMatchObject({ kind: 'tradersBarbarians.fishSwap' });
    const swapped = run(rolled, 'p1', { type: 'tb.fishSwap', token: 3 }, scriptedRng([0]));
    expect(swapped.events.map((event) => event.type)).toContain('tb.bootDrawn');
    expect(fish(swapped.state).boot).toBe('p1');
    expect(fish(swapped.state).hands.p1).toHaveLength(6);
    expect(projectGame(swapped.state, 'p2').players[0]!.victoryTarget).toBe(11);
  });

  it('FI18: TB25 p.10 — drawing stops quietly when the supply and the discard pile are both empty', () => {
    // Start: a city on a ground (2 tokens) with nothing left to draw; the boot is already held.
    const state = bare();
    const ground = fish(state).grounds[0]!;
    placeBuilding(state, 'p1', ground.vertices[1]!, true);
    fish(state).supply = { fish: [0, 0, 0], boot: 0 };
    fish(state).boot = 'p4';
    fish(state).discard = [0, 0, 0];
    const rolled = run(state, 'p1', { type: 'turn.roll' }, scriptedRng(dice(ground.number)));
    expect(fish(rolled.state).hands.p1).toEqual([]);
    expect(rolled.events.map((event) => event.type)).not.toContain('tb.fishDrawn');
    expect(rolled.state.pending).toBeNull();
  });

  it('FI19: TB25 p.10 — 7 fish cannot buy a development card from an empty deck; the tokens are kept', () => {
    const state = bare();
    forceTurn(state, 0, 'action');
    fish(state).hands.p1 = [3, 3, 1];
    state.devDeck = [];
    reject(state, 'p1', { type: 'tb.spendFish', action: 'devCard', tokens: [3, 3, 1] }, 'E_DECK_EMPTY');
    expect(fish(state).hands.p1).toEqual([3, 3, 1]);
  });

  it('FI20: TB25 p.10 — stealing needs a victim with cards: an empty hand and oneself are refused', () => {
    const state = bare();
    forceTurn(state, 0, 'action');
    fish(state).hands.p1 = [3];
    reject(state, 'p1', { type: 'tb.spendFish', action: 'steal', tokens: [3], victim: 'p4' }, 'E_NO_ELIGIBLE_VICTIM');
    setHand(state, 'p1', { ore: 1 });
    reject(state, 'p1', { type: 'tb.spendFish', action: 'steal', tokens: [3], victim: 'p1' }, 'E_ILLEGAL_TARGET');
    expect(fish(state).hands.p1).toEqual([3]);
  });

  it('FI21: TB25 p.10 — a city that fills the hand to 7 mid-payout pauses for the swap, then drawing stops; later players still draw', () => {
    // Start: p1 holds 6 fish and a city on a ground (2 tokens due), p2 a settlement. Command: roll, then tb.fishSwap.
    const state = bare();
    const ground = fish(state).grounds[0]!;
    placeBuilding(state, 'p1', ground.vertices[1]!, true);
    placeBuilding(state, 'p2', ground.vertices[2]!);
    fish(state).hands.p1 = [1, 1, 1, 1, 1, 1];
    fish(state).supply.fish[0] -= 6;
    const rolled = run(state, 'p1', { type: 'turn.roll' }, scriptedRng([...dice(ground.number), 0]));
    expect(fish(rolled.state).hands.p1).toHaveLength(7);
    expect(rolled.state.pending).toMatchObject({ kind: 'tradersBarbarians.fishSwap', responders: ['p1'] });
    expect(fish(rolled.state).hands.p2).toHaveLength(0);
    const done = run(rolled.state, 'p1', { type: 'tb.fishSwap', token: null }, scriptedRng([0]));
    // The second token is not drawn; p2 is paid.
    expect(fish(done.state).hands.p1).toHaveLength(7);
    expect(fish(done.state).hands.p2).toHaveLength(1);
    expect(done.state.pending).toBeNull();
  });
});

describe('R-TB-FI simulated games', () => {
  for (const players of [3, 4]) {
    it(`a ${players}-player game finishes and conserves resources and fish`, () => {
      const state = simulateGame(players * 101, 9000, { players, profileId: PROFILE, mode: 'variable', bot: fishingBot });
      expect(state.result).toMatchObject({ reason: 'victory' });
      const winner = state.result!.playerId!;
      const target = fish(state).boot === winner ? 11 : 10;
      expect(scoreOf(state, winner, { includeHidden: true })).toBeGreaterThanOrEqual(target);
      for (const resource of ['lumber', 'brick', 'wool', 'grain', 'ore'] as const) expect(resourceTotal(state, resource)).toBe(19);
      expect(fishTotal(state)).toEqual([11, 10, 8, 1]);
      for (const hand of Object.values(fish(state).hands)) expect(hand.length).toBeLessThanOrEqual(7);
    }, SIMULATION_TIMEOUT);
  }
});

void ({} as ModulePending);
