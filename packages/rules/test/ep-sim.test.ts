/**
 * Whole simulated Explorers & Pirates games for 3 and 4 players and every
 * mission set: each finishes with a winner at the target, conserves the
 * resource cards, the 148 coins and the 6 fish hauls, keeps the piece limits,
 * and exercises its mission.
 */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { epScenario, type EpScenarioId } from '../src/explorers-pirates-boards.ts';
import { COIN_SUPPLY, EP_PIECES, fishOut, harborsOf, piecesInPlay, plainSettlements } from '../src/modules/explorersPirates/core.ts';
import { epState } from '../src/modules/explorersPirates/state.ts';
import { getProfile } from '../src/profiles.ts';
import { RESOURCES, type GameState } from '../src/types.ts';
import { simulateExplorersPirates } from './ep-sim.ts';

function checkSupplies(state: GameState): void {
  const slot = epState(state);
  const bank = getProfile(state.profileId)!.bankPerResource;
  for (const resource of RESOURCES) {
    const total = state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0);
    expect(total, resource).toBe(bank);
  }
  const coins = slot.goldSupply + Object.values(slot.gold).reduce((sum, value) => sum + value, 0);
  expect(coins).toBe(COIN_SUPPLY);
  if (epScenario(slot.scenario).missions.includes('fish')) expect(slot.fishSupply + fishOut(slot)).toBe(6);
  const topo = topologyOf(state);
  for (const player of state.players) {
    expect(harborsOf(slot, player.id).length).toBeLessThanOrEqual(EP_PIECES.harbors);
    expect(plainSettlements(state, player.id)).toBeLessThanOrEqual(EP_PIECES.settlements);
    expect(slot.ships.filter((ship) => ship.player === player.id).length).toBeLessThanOrEqual(EP_PIECES.ships);
    expect(piecesInPlay(state, player.id, 'settler')).toBeLessThanOrEqual(EP_PIECES.settlers);
    expect(piecesInPlay(state, player.id, 'crew')).toBeLessThanOrEqual(EP_PIECES.crews);
  }
  for (const edge of new Set(slot.ships.map((ship) => ship.edge))) {
    expect(slot.ships.filter((ship) => ship.edge === edge).length).toBeLessThanOrEqual(2);
  }
  // No building or road touches an unexplored hex.
  const fog = new Set(slot.fog.map((entry) => entry.hex));
  state.board.buildings.forEach((building, vertex) => {
    if (building) expect(topo.vertices[vertex]!.hexes.some((cell) => fog.has(cell))).toBe(false);
  });
  if (slot.pirate) expect(state.board.layout.terrain[slot.pirate.hex]).toBe('sea');
}

const MISSION_EVENTS: Record<EpScenarioId, string[]> = {
  'land-ho': ['ep.explored', 'ep.settlementFounded', 'ep.shipBuilt', 'ep.settlerBuilt', 'ep.noPirate'],
  'pirate-lairs': ['ep.explored', 'ep.crewLanded', 'ep.lairCaptured', 'ep.pirateMoved', 'ep.chaseRolled'],
  fish: ['ep.fishRolled', 'ep.fishLoaded', 'ep.delivered', 'ep.lairCaptured'],
  spices: ['ep.fishLoaded', 'ep.spiceLoaded', 'ep.delivered', 'ep.crewLanded'],
  'explorers-pirates': ['ep.lairCaptured', 'ep.fishLoaded', 'ep.spiceLoaded', 'ep.delivered', 'ep.tributePaid'],
};

describe('simulated Explorers & Pirates games', () => {
  for (const scenario of Object.keys(MISSION_EVENTS) as EpScenarioId[]) {
    for (const players of [3, 4] as const) {
      it(`${scenario}, ${players} players: a winner at ${epScenario(scenario).victoryTarget} VP and conserved supplies`, () => {
        const run = simulateExplorersPirates(scenario, players, 4, 6000);
        const { state } = run;
        expect(state.result?.reason).toBe('victory');
        const winner = state.result!.playerId!;
        expect(scoreOf(state, winner, { includeHidden: true })).toBeGreaterThanOrEqual(epScenario(scenario).victoryTarget);
        checkSupplies(state);
        for (const type of MISSION_EVENTS[scenario]) expect(run.events[type] ?? 0, type).toBeGreaterThan(0);
      }, 120_000);
    }
  }
});
