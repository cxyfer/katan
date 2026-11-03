/**
 * R-EP-VIS: Explorers & Pirates keeps no hidden board state. An unexplored
 * hex is plain sea in the layout plus a public `fog` entry naming its region;
 * its tile, number disc, shoal number, spice ability and lair number are
 * drawn from the public remaining inventory only when it is revealed, so no
 * projection (and not even the stored state) can leak them.
 */

import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/engine.ts';
import { epScenario, type EpRegion, type EpScenarioId, type EpTile } from '../src/explorers-pirates-boards.ts';
import { LAIR_TOKENS } from '../src/modules/explorersPirates/core.ts';
import { epState, type SpiceAbility } from '../src/modules/explorersPirates/state.ts';
import { projectEvent, projectGame } from '../src/project.ts';
import type { GameState } from '../src/types.ts';
import { epGame } from './ep-helpers.ts';
import { epBotStep, epView, simulateExplorersPirates } from './ep-sim.ts';
import { scriptedRng } from './helpers.ts';
import { seededRng } from '../src/rng.ts';
import type { GameEvent } from '../src/types.ts';

/** Plays the fixture bot and keeps every event (the stored log keeps only the last 200). */
function playLogged(scenario: EpScenarioId, players: 3 | 4, seed: number, maxSteps: number): { state: GameState; events: GameEvent[] } {
  const rng = seededRng(seed * 7919 + players);
  let { state } = epGame(scenario, players, seed);
  const events: GameEvent[] = [];
  const memo = { turnNo: 0 };
  for (let step = 0; step < maxSteps && !state.result; step++) {
    const before = state.seq;
    const next = epBotStep(state, rng, step, memo)?.state;
    if (!next) throw new Error(`stuck at step ${step}`);
    events.push(...next.log.filter((event) => event.seq > before));
    state = next;
  }
  return { state, events };
}

const SCENARIOS: EpScenarioId[] = ['land-ho', 'pirate-lairs', 'fish', 'spices', 'explorers-pirates'];

describe('R-EP-VIS projections', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario}: unexplored hexes carry no identity and the module view is the same for every seat`, () => {
      const { state } = simulateExplorersPirates(scenario, 4, 9, 300);
      const slot = epState(state);
      expect(slot.fog.length).toBeGreaterThan(0);
      for (const entry of slot.fog) {
        expect(state.board.layout.terrain[entry.hex]).toBe('sea');
        expect(state.board.layout.numbers[entry.hex]).toBeNull();
        expect(slot.sites.some((site) => site.hex === entry.hex)).toBe(false);
        expect(Object.keys(entry).sort()).toEqual(['hex', 'region']);
      }
      const views = state.players.map((player) => epView(state, player.id));
      for (const view of views) expect(view).toEqual(views[0]);
      // Other hands stay hidden in the base projection.
      const p1 = projectGame(state, 'p1');
      expect(p1.players.find((player) => player.id === 'p2')!.resources).toBeUndefined();
    });
  }

  it('the stolen card is private to the thief and the victim', () => {
    const { state } = simulateExplorersPirates('pirate-lairs', 4, 4, 2000);
    const thefts = state.log.filter((event) => event.type === 'ep.pirateStole' && event.params.card === true);
    expect(thefts.length).toBeGreaterThan(0);
    for (const event of thefts) {
      const { playerId, victim } = event.params as { playerId: string; victim: string };
      const bystander = state.players.find((player) => player.id !== playerId && player.id !== victim)!.id;
      expect(projectEvent(event, bystander).params).not.toHaveProperty('resource');
      expect(projectEvent(event, playerId).params).toHaveProperty('resource');
      expect(projectEvent(event, victim).params).toHaveProperty('resource');
    }
  });

  it('the drawn identity of a hex appears in no event before its ep.explored, for any seat', () => {
    const { state, events } = playLogged('explorers-pirates', 4, 5, 3000);
    const exploredAt = new Map<number, number>();
    for (const event of events) {
      if (event.type === 'ep.explored') exploredAt.set(event.params.hex as number, event.seq);
    }
    expect(exploredAt.size).toBeGreaterThan(0);
    const secret = ['tile', 'number', 'shoal', 'ability', 'bonus'];
    for (const event of events) {
      for (const seat of state.players) {
        const params = projectEvent(event, seat.id).params as Record<string, unknown>;
        if (typeof params.hex !== 'number') continue;
        const revealed = exploredAt.get(params.hex);
        if (revealed !== undefined && event.seq >= revealed) continue;
        for (const key of secret) {
          // A lair number is drawn at capture time, after the gold field is explored.
          expect(params, `${event.type} #${event.seq} leaks ${key} of hex ${params.hex}`).not.toHaveProperty(key);
        }
      }
    }
    // Fog still on the board was never named by any event.
    for (const entry of epState(state).fog) expect(exploredAt.has(entry.hex)).toBe(false);
  }, 30_000);
});

/** A multiset as a sorted list, for order-free comparison. */
function sorted<T>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => String(a).localeCompare(String(b)));
}

function tileList(tiles: Partial<Record<EpTile, number>>): EpTile[] {
  return sorted(Object.entries(tiles).flatMap(([tile, count]) => Array.from({ length: count ?? 0 }, () => tile as EpTile)));
}

/** Removes one copy of `value` (it must be there). */
function take<T>(values: T[], value: T): void {
  const at = values.indexOf(value);
  expect(at, `drew ${String(value)} that the public pool did not hold`).toBeGreaterThanOrEqual(0);
  values.splice(at, 1);
}

describe('R-EP-VIS reveal pools (condition a: public composition; condition b: recorded draws)', () => {
  for (const scenario of ['pirate-lairs', 'fish', 'spices', 'explorers-pirates'] as const) {
    it(`${scenario}: each pool equals the printed region list minus the draws named by public events`, () => {
      const { state, events } = playLogged(scenario, 3, 11, 4000);
      const spec = epScenario(epState(state).scenario);
      const expected = {} as Record<EpRegion, { tiles: EpTile[]; discs: number[]; shoals: number[]; abilities: SpiceAbility[] }>;
      for (const region of ['parrot', 'goose'] as const) {
        const printed = spec.regions[region];
        expected[region] = {
          tiles: tileList(printed.tiles),
          discs: printed.discs.slice(),
          shoals: printed.shoals.slice(),
          abilities: (printed.tiles.spice ?? 0) > 0 ? ['swift', 'fastGold', 'pirateBonus'] : [],
        };
      }
      // Lair numbers exist only where the printed regions hold gold fields.
      const lairs: number[] = (spec.regions.parrot.tiles.gold ?? 0) + (spec.regions.goose.tiles.gold ?? 0) > 0 ? [...LAIR_TOKENS] : [];
      let reveals = 0;
      // Only what a bystander sees is used.
      for (const raw of events) {
        const event = projectEvent(raw, 'p3');
        const params = event.params as Record<string, unknown>;
        if (event.type === 'ep.explored') {
          reveals += 1;
          const pool = expected[params.region as EpRegion];
          take(pool.tiles, params.tile as EpTile);
          if (typeof params.number === 'number') take(pool.discs, params.number);
          if (typeof params.shoal === 'number') take(pool.shoals, params.shoal);
          if (typeof params.ability === 'string') take(pool.abilities, params.ability as SpiceAbility);
        }
        if (event.type === 'ep.lairCaptured' && typeof params.number === 'number') take(lairs, params.number);
      }
      expect(reveals).toBeGreaterThan(0);
      const slot = epState(state);
      for (const region of ['parrot', 'goose'] as const) {
        const pool = slot.pools[region];
        expect(tileList(pool.tiles), region).toEqual(sorted(expected[region].tiles));
        expect(sorted(pool.discs), region).toEqual(sorted(expected[region].discs));
        expect(sorted(pool.shoals), region).toEqual(sorted(expected[region].shoals));
        expect(sorted(pool.abilities), region).toEqual(sorted(expected[region].abilities));
        // One face-down tile per unexplored hex of the region.
        expect(expected[region].tiles.length).toBe(slot.fog.filter((entry) => entry.region === region).length);
      }
      expect(sorted(slot.lairTokens)).toEqual(sorted(lairs));
      // The projection carries counts only, the same for every seat.
      const view = epView(state, 'p1') as unknown as { regionsLeft: Record<EpRegion, number>; lairTokensLeft: number; pools?: unknown; lairTokens?: unknown };
      expect(view.regionsLeft).toEqual({ parrot: expected.parrot.tiles.length, goose: expected.goose.tiles.length });
      expect(view.lairTokensLeft).toBe(lairs.length);
      expect(view).not.toHaveProperty('pools');
      expect(view).not.toHaveProperty('lairTokens');
    });
  }

  it('every reveal is stored in the snapshot and its event; a restored game never draws again', () => {
    const { state, events } = playLogged('explorers-pirates', 3, 7, 500);
    expect(state.result).toBeNull();
    const slot = epState(state);
    const shown: Partial<Record<EpTile, string>> = { gold: 'gold', spice: 'desert', shoal: 'sea', sea: 'sea' };
    let checked = 0;
    for (const event of events) {
      if (event.type !== 'ep.explored') continue;
      const { hex, tile, number, shoal, ability } = event.params as { hex: number; tile: EpTile; number?: number; shoal?: number; ability?: SpiceAbility };
      expect(state.board.layout.terrain[hex]).toBe(shown[tile] ?? tile);
      if (number !== undefined) expect(state.board.layout.numbers[hex]).toBe(number);
      const site = slot.sites.find((entry) => entry.hex === hex);
      if (shoal !== undefined) expect(site).toMatchObject({ kind: 'shoal', number: shoal });
      if (ability !== undefined) expect(site).toMatchObject({ kind: 'spice', ability });
      if (tile === 'gold') expect(site).toMatchObject({ kind: 'lair' });
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    // Restore through JSON, then apply a command that draws nothing with an rng that throws on use.
    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    expect(restored).toEqual(state);
    // Put the restored game in an Action phase so the Movement phase can start (no draw involved).
    Object.assign(restored.turn, { phase: 'action' });
    restored.pending = null;
    restored.windowId += 1;
    const actor = restored.players[restored.turn.seat]!.id;
    const moved = applyCommand(restored, actor, { type: 'ep.startMovement' } as never, scriptedRng([]));
    expect(moved.ok ? 'ok' : moved.error.code).toBe('ok');
    if (!moved.ok) return;
    expect(moved.state.board.layout).toEqual(state.board.layout);
    expect(epState(moved.state).sites).toEqual(slot.sites);
    expect(epState(moved.state).pools).toEqual(slot.pools);
    expect(epState(moved.state).fog).toEqual(slot.fog);
    expect(restored.board.layout).toEqual(state.board.layout);
  });
});

