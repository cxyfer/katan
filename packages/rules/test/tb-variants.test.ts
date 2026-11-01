/**
 * R-TB-FR / R-TB-HB: The Friendly Robber and Harbors of Catan (TB25 p. 4) on
 * the base board. Each case names its start state, actor/window, command,
 * expected result and source clause.
 */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { legalRobberHexes } from '../src/engine.ts';
import { getProfile } from '../src/profiles.ts';
import { projectGame } from '../src/project.ts';
import { seededRng } from '../src/rng.ts';
import { verticesOfHex } from '../src/topology.ts';
import type { GameState } from '../src/types.ts';
import { act, expectRejected, forceTurn, placeBuilding, setHand } from './helpers.ts';
import { clearBoard, resourceTotal, tbPlayable } from './tb-helpers.ts';
import { simulateGame } from './simulate.ts';

const FRIENDLY = 'tb-friendly-robber-2025';
const HARBORS = 'tb-harbors-2025';

function moveRobberPending(state: GameState, actor = 'p1'): void {
  state.pending = { kind: 'moveRobber', actor, cause: 'seven', pirate: false };
}

function ownersOf(state: GameState, hex: number): Set<string> {
  return new Set(verticesOfHex(topologyOf(state), hex).map((vertex) => state.board.buildings[vertex]?.player).filter((id): id is string => !!id));
}

/** A hex with a building of `owner`, other than the robber's. */
function hexOf(state: GameState, owner: string): number {
  return state.board.layout.terrain.findIndex((_, hex) => hex !== state.board.robber && ownersOf(state, hex).has(owner));
}

/** A hex whose corners hold exactly the given buildings' owners. */
function hexWithOwners(state: GameState, owners: string[]): number {
  const topology = topologyOf(state);
  return state.board.layout.terrain.findIndex((_, hex) => {
    const found = new Set(verticesOfHex(topology, hex).map((vertex) => state.board.buildings[vertex]?.player).filter(Boolean));
    return found.size === owners.length && owners.every((owner) => found.has(owner));
  });
}

describe('R-TB-FR The Friendly Robber (TB25 p. 4)', () => {
  it('FR1: keeps the robber off hexes of players with only 2 VP after setup', () => {
    // Start: setup done, every player has 2 VP; p1 resolves a 7.
    const state = tbPlayable(FRIENDLY, { mode: 'fixed' });
    moveRobberPending(state);
    const guarded = hexOf(state, 'p2');
    expect(guarded).toBeGreaterThanOrEqual(0);
    expectRejected(state, 'p1', { type: 'pending.moveRobber', hex: guarded }, 'E_ILLEGAL_TARGET');
    const empty = hexWithOwners(state, []);
    expect(legalRobberHexes(state, 'p1')).toContain(empty);
    expect(legalRobberHexes(state, 'p1')).not.toContain(guarded);
    const moved = act(state, 'p1', { type: 'pending.moveRobber', hex: empty }).state;
    expect(moved.board.robber).toBe(empty);
    expect(moved.pending).toBeNull();
  });

  it('FR2: allows a hex whose players all have more than 2 VP and robs only them', () => {
    const state = tbPlayable(FRIENDLY, { mode: 'fixed' });
    const target = hexOf(state, 'p2');
    const owners = ownersOf(state, target);
    for (const player of state.players) {
      if (owners.has(player.id)) player.bonusPoints = 1; // 3 public VP
      setHand(state, player.id, player.id === 'p2' ? { ore: 2 } : {});
    }
    moveRobberPending(state);
    const moved = act(state, 'p1', { type: 'pending.moveRobber', hex: target }).state;
    expect(moved.pending).toMatchObject({ kind: 'steal', candidates: ['p2'] });
    // Lowering one owner back to 2 VP closes the hex again.
    const other = [...owners].find((id) => id !== 'p2');
    if (other) {
      state.players.find((player) => player.id === other)!.bonusPoints = 0;
      expectRejected(state, 'p1', { type: 'pending.moveRobber', hex: target }, 'E_ILLEGAL_TARGET');
    }
  });

  it('FR3: with no valid hex the robber goes to the desert and robs only players above 2 VP', () => {
    const state = tbPlayable(FRIENDLY, { mode: 'fixed' });
    clearBoard(state);
    const topology = topologyOf(state);
    const desert = state.board.layout.terrain.indexOf('desert');
    // p1 (2 public VP) touches every non-desert hex.
    const uncovered = new Set(state.board.layout.terrain.map((_, hex) => hex).filter((hex) => hex !== desert));
    let placed = 0;
    for (let vertex = 0; vertex < topology.vertices.length && uncovered.size > 0; vertex++) {
      const hexes = topology.vertices[vertex]!.hexes.filter((hex) => uncovered.has(hex));
      if (hexes.length === 0 || topology.vertices[vertex]!.hexes.includes(desert)) continue;
      placeBuilding(state, 'p1', vertex);
      placed += 1;
      for (const hex of hexes) uncovered.delete(hex);
    }
    expect(uncovered.size).toBe(0);
    state.players[0]!.bonusPoints = 2 - placed;
    // p3 has 3 VP and a settlement on the desert; p4 has 2 VP there too.
    const desertCorners = verticesOfHex(topology, desert).filter((vertex) => !state.board.buildings[vertex]);
    placeBuilding(state, 'p3', desertCorners[0]!);
    state.players[2]!.bonusPoints = 2;
    placeBuilding(state, 'p4', desertCorners.at(-1)!);
    state.players[3]!.bonusPoints = 1;
    setHand(state, 'p3', { grain: 1 });
    setHand(state, 'p4', { grain: 1 });
    expect(scoreOf(state, 'p1', { includeHidden: false })).toBe(2);
    expect(state.board.robber).toBe(desert);
    moveRobberPending(state);
    expect(legalRobberHexes(state, 'p1')).toEqual([desert]);
    const moved = act(state, 'p1', { type: 'pending.moveRobber', hex: desert }).state;
    expect(moved.pending).toMatchObject({ kind: 'steal', candidates: ['p3'] });
  });

  it('FR4: a Knight obeys the same restriction', () => {
    const state = tbPlayable(FRIENDLY, { mode: 'fixed' });
    state.players[0]!.devCards = ['knight'];
    const guarded = hexOf(state, 'p3');
    expectRejected(state, 'p1', { type: 'dev.playKnight', hex: guarded }, 'E_ILLEGAL_TARGET');
    const empty = hexWithOwners(state, []);
    expect(act(state, 'p1', { type: 'dev.playKnight', hex: empty }).state.board.robber).toBe(empty);
  });

  it('FR5: hidden Victory Point cards do not lift the protection', () => {
    const state = tbPlayable(FRIENDLY, { mode: 'fixed' });
    state.players[1]!.devCards = ['victoryPoint'];
    moveRobberPending(state);
    expectRejected(state, 'p1', { type: 'pending.moveRobber', hex: hexOf(state, 'p2') }, 'E_ILLEGAL_TARGET');
  });
});

function harborVertices(state: GameState): number[][] {
  const topology = topologyOf(state);
  return state.board.layout.harbors.map((harbor) => [...topology.edges[harbor.edge]!.vertices]);
}

function strongest(state: GameState): unknown {
  return (projectGame(state, 'p1').modules as Record<string, Record<string, { holder: string | null }>>)
    .tradersBarbarians!.harbors!.holder;
}

describe('R-TB-HB Harbors of Catan (TB25 p. 4)', () => {
  it('HB1: the first player with 3 VP on ports takes Strongest Ports (2 VP); victory needs 11', () => {
    expect(getProfile(HARBORS)!.victoryTarget).toBe(11);
    const state = tbPlayable(HARBORS, { mode: 'fixed' });
    clearBoard(state);
    const ports = harborVertices(state);
    placeBuilding(state, 'p1', ports[0]![0]!);
    placeBuilding(state, 'p1', ports[3]![0]!);
    setHand(state, 'p1', { grain: 2, ore: 3 });
    const built = act(state, 'p1', { type: 'build.city', vertex: ports[0]![0]! });
    expect(built.events.map((event) => event.type)).toContain('tb.strongestPorts');
    expect(strongest(built.state)).toBe('p1');
    // city 2 + settlement 1 + Strongest Ports 2
    expect(scoreOf(built.state, 'p1', { includeHidden: false })).toBe(5);

    const almost = built.state;
    almost.players[0]!.bonusPoints = 5; // 10 VP: not enough with the variant
    forceTurn(almost, 3, 'action');
    const next = act(almost, 'p4', { type: 'turn.end' }).state;
    expect(next.result).toBeNull();
    next.players[0]!.bonusPoints = 6;
    forceTurn(next, 3, 'action');
    expect(act(next, 'p4', { type: 'turn.end' }).state.result).toMatchObject({ playerId: 'p1', reason: 'victory' });
  });

  it('HB2: a tie keeps the holder; strictly more ports VP takes the tile', () => {
    const state = tbPlayable(HARBORS, { mode: 'fixed' });
    clearBoard(state);
    const ports = harborVertices(state);
    placeBuilding(state, 'p1', ports[0]![0]!, true);
    placeBuilding(state, 'p1', ports[2]![0]!);
    setHand(state, 'p1', { grain: 2, ore: 3 });
    const first = act(state, 'p1', { type: 'build.city', vertex: ports[2]![0]! }).state; // p1: 4
    expect(strongest(first)).toBe('p1');
    placeBuilding(first, 'p2', ports[4]![0]!, true);
    placeBuilding(first, 'p2', ports[6]![0]!);
    forceTurn(first, 1, 'action');
    setHand(first, 'p2', { grain: 2, ore: 3 });
    const tie = act(first, 'p2', { type: 'build.city', vertex: ports[6]![0]! }).state; // p2: 4
    expect(strongest(tie)).toBe('p1');
    placeBuilding(tie, 'p2', ports[8]![0]!);
    setHand(tie, 'p2', { grain: 2, ore: 3 });
    const ahead = act(tie, 'p2', { type: 'build.city', vertex: ports[8]![0]! }).state; // p2: 6
    expect(strongest(ahead)).toBe('p2');
    expect(scoreOf(ahead, 'p2', { includeHidden: false })).toBe(6 + 2);
  });

  it('HB3: setup alone cannot reach 3 VP on ports', () => {
    const state = tbPlayable(HARBORS, { mode: 'variable', seed: 3 });
    expect(strongest(state)).toBeNull();
  });
});

describe('R-TB variant games', () => {
  for (const profileId of [FRIENDLY, HARBORS, 'tb-friendly-robber-harbors-2025']) {
    for (const players of [3, 4]) {
      it(`${profileId}: a simulated ${players}-player game finishes and conserves resources`, () => {
        const state = simulateGame(players * 11 + profileId.length, 8000, { players, profileId, mode: 'variable' });
        expect(state.result).toMatchObject({ reason: 'victory' });
        const winner = state.result!.playerId!;
        expect(scoreOf(state, winner, { includeHidden: true })).toBeGreaterThanOrEqual(getProfile(profileId)!.victoryTarget);
        for (const resource of ['lumber', 'brick', 'wool', 'grain', 'ore'] as const) {
          expect(resourceTotal(state, resource)).toBe(19);
        }
      });
    }
  }
});

void seededRng;
