/**
 * R-EP-VIS: Explorers & Pirates keeps no hidden board state. An unexplored
 * hex is plain sea in the layout plus a public `fog` entry naming its region;
 * its tile, number disc, shoal number, spice ability and lair number are
 * drawn from the public remaining inventory only when it is revealed, so no
 * projection (and not even the stored state) can leak them.
 */

import { describe, expect, it } from 'vitest';
import { epState } from '../src/modules/explorersPirates/state.ts';
import { projectEvent, projectGame } from '../src/project.ts';
import type { EpScenarioId } from '../src/explorers-pirates-boards.ts';
import { epView, simulateExplorersPirates } from './ep-sim.ts';

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
});
