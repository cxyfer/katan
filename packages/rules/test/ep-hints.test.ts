/**
 * Issue #114: the base build hints (`legalRoads`, `legalSettlements`,
 * `legalCities`) list only targets `applyCommand` accepts. E&P splits the base
 * action phase into its Action and Movement phases and has no cities, so the
 * hints share the command's module veto, which also carries the E&P piece
 * limits. Every case runs on all five profiles. Base profiles keep listing
 * targets past their piece supply (the bots rely on it); only module vetoes
 * narrow the base hints.
 */

import { describe, expect, it } from 'vitest';
import { topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, type Command } from '../src/engine.ts';
import type { EpScenarioId } from '../src/explorers-pirates-boards.ts';
import { getProfile } from '../src/profiles.ts';
import { seededRng } from '../src/rng.ts';
import type { GameState, Resource } from '../src/types.ts';
import { EP_PROFILE, epState, run, type AnyCommand } from './ep-helpers.ts';
import { epHints, epPlayable } from './ep-sim.ts';
import { placeRoad } from './helpers.ts';

const SCENARIOS = Object.keys(EP_PROFILE) as EpScenarioId[];
const CASES = SCENARIOS.map((scenario) => [EP_PROFILE[scenario], scenario] as const);
const PLENTY: Record<Resource, number> = { lumber: 20, brick: 20, wool: 20, grain: 20, ore: 20 };

/** A playable E&P board, first player in the Action phase with a full hand (no pirate in the way). */
function board(scenario: EpScenarioId): GameState {
  const state = epPlayable(scenario, 4, 1);
  epState(state).pirate = null;
  state.players[0]!.resources = { ...PLENTY };
  return state;
}

function outcome(state: GameState, actor: string, command: AnyCommand): string {
  const result = applyCommand(state, actor, command as Command, seededRng(1));
  return result.ok ? 'ok' : result.error.code;
}

/** The refusal (or `ok`) for every target the hints list, keyed by command. */
function verdicts(state: GameState, actor: string): Record<string, string[]> {
  const hints = actionHints(state, actor);
  return {
    'build.road': hints.legalRoads.map((edge) => outcome(state, actor, { type: 'build.road', edge })),
    'build.settlement': hints.legalSettlements.map((vertex) => outcome(state, actor, { type: 'build.settlement', vertex })),
    'build.city': hints.legalCities.map((vertex) => outcome(state, actor, { type: 'build.city', vertex })),
  };
}

function allAccepted(state: GameState, actor: string): void {
  for (const [type, results] of Object.entries(verdicts(state, actor))) {
    expect(results.filter((result) => result !== 'ok'), type).toEqual([]);
  }
}

/** Builds roads from the hints until a settlement site is reachable. */
function withSettlementSite(scenario: EpScenarioId): GameState {
  let state = board(scenario);
  const actor = state.players[0]!.id;
  for (let built = 0; built < 8 && actionHints(state, actor).legalSettlements.length === 0; built++) {
    const edge = actionHints(state, actor).legalRoads[0];
    if (edge === undefined) break;
    state = run(state, actor, { type: 'build.road', edge }).state;
  }
  return state;
}

function movement(state: GameState): GameState {
  return run(state, state.players[0]!.id, { type: 'ep.startMovement' }).state;
}

describe('#114 E&P build hints match the engine', () => {
  it.each(CASES)('%s: in the Action phase every listed road and settlement is accepted, and no city is listed', (_profile, scenario) => {
    for (const state of [board(scenario), withSettlementSite(scenario)]) {
      const actor = state.players[0]!.id;
      const hints = actionHints(state, actor);
      expect(hints.legalRoads.length).toBeGreaterThan(0);
      expect(hints.legalCities).toEqual([]);
      allAccepted(state, actor);
    }
  });

  it.each(CASES)('%s: a reachable settlement site is listed and accepted', (_profile, scenario) => {
    const state = withSettlementSite(scenario);
    const actor = state.players[0]!.id;
    expect(actionHints(state, actor).legalSettlements.length).toBeGreaterThan(0);
    allAccepted(state, actor);
  });

  it.each(CASES)('%s: the Movement phase lists no road, settlement or city', (_profile, scenario) => {
    for (const before of [board(scenario), withSettlementSite(scenario)]) {
      const actor = before.players[0]!.id;
      // 修正前：提示仍列出 Action 階段的目標，而引擎回 E_EP_MOVEMENT_PHASE。
      const roads = actionHints(before, actor).legalRoads;
      const state = movement(before);
      expect(epHints(state, actor).phase).toBe('movement');
      expect(outcome(state, actor, { type: 'build.road', edge: roads[0]! })).toBe('E_EP_MOVEMENT_PHASE');
      const hints = actionHints(state, actor);
      expect({ roads: hints.legalRoads, settlements: hints.legalSettlements, cities: hints.legalCities })
        .toEqual({ roads: [], settlements: [], cities: [] });
    }
  });

  it.each(CASES)('%s: once a ship has moved the build hints stay empty', (_profile, scenario) => {
    const state = movement(withSettlementSite(scenario));
    const actor = state.players[0]!.id;
    const ship = epHints(state, actor).ships.find((entry) => entry.steps.length > 0)!;
    const moved = run(state, actor, { type: 'ep.moveShip', ship: ship.id, edge: ship.steps[0]!.edge }).state;
    const hints = actionHints(moved, actor);
    expect([...hints.legalRoads, ...hints.legalSettlements, ...hints.legalCities]).toEqual([]);
  });

  it.each(CASES)('%s: with all road pieces placed no road is listed', (profile, scenario) => {
    const state = board(scenario);
    const actor = state.players[0]!.id;
    const limit = getProfile(profile)!.pieces.roads;
    // 在已列出的道路之外補滿自己的道路，讓列出的目標仍然相連但棋子已用完。
    const listed = new Set(actionHints(state, actor).legalRoads);
    const topo = topologyOf(state);
    const own = () => state.board.roads.filter((road) => road?.player === actor && !road.ship).length;
    for (let edge = 0; edge < topo.edges.length && own() < limit; edge++) {
      if (!state.board.roads[edge] && !listed.has(edge)) placeRoad(state, actor, edge);
    }
    expect(own()).toBe(limit);
    expect(actionHints(state, actor).legalRoads).toEqual([]);
    allAccepted(state, actor);
  });
});
