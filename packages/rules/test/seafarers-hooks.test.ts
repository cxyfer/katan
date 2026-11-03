import { describe, expect, it } from 'vitest';
import { registerRulesModule } from '../src/modules/registry.ts';
import { moduleStateOf, setModuleState } from '../src/modules/state.ts';
import { registerFixtureProfile } from '../src/profiles.ts';
import { act, scriptedRng, setHand } from './helpers.ts';
import { corner, emptySeafarersGame, hex, settle, ship, side } from './seafarers-helpers.ts';

interface Observations {
  changes: { robber: number; pirate: number | null }[];
}

registerRulesModule({
  id: 'sf-hook-board',
  afterBoardChange(state) {
    moduleStateOf<Observations>(state, 'sf-hook-board')!.changes.push({
      robber: state.board.robber,
      pirate: state.board.pirate,
    });
  },
  resumePending(state, _frame, ctx) {
    ctx.kit.emit(state, 'fixture.banditObserved', {
      changes: moduleStateOf<Observations>(state, 'sf-hook-board')!.changes.slice(),
    });
  },
});
registerFixtureProfile('fixture-sf-hooks', [4], { ruleModules: ['seafarers', 'sf-hook-board'] });

describe('Seafarers bandit board-change hooks', () => {
  for (const cause of ['seven', 'knight'] as const) {
    for (const target of ['robber', 'pirate', 'frame'] as const) {
      it.each([false, true])(`${cause} notifies once when moving ${target} before continuing (victim: %s)`, (hasVictim) => {
        const state = emptySeafarersGame(4, 0, 'preroll');
        state.profileId = 'fixture-sf-hooks';
        setModuleState<Observations>(state, 'sf-hook-board', { changes: [] });
        const destination = target === 'robber' ? hex(state, 1, 0) : target === 'pirate' ? hex(state, 2, 0) : null;
        if (target === 'frame') state.board.pirate = hex(state, 2, 0);
        if (hasVictim) {
          settle(state, 'p2', corner(state, 1, 0, 0));
          ship(state, 'p2', side(state, 2, 0, 2));
          setHand(state, 'p2', { ore: 1 });
        }
        const expected = [{
          robber: target === 'robber' ? destination : state.board.robber,
          pirate: target === 'robber' ? state.board.pirate : destination,
        }];
        let moved;
        if (cause === 'seven') {
          const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3])).state;
          expect(moduleStateOf<Observations>(rolled, 'sf-hook-board')!.changes).toEqual([]);
          rolled.pendingQueue = [{ kind: 'sf-hook-board.observe', module: 'sf-hook-board', responders: [], data: {} }];
          moved = act(rolled, 'p1', { type: 'pending.moveRobber', hex: destination });
        } else {
          state.players[0]!.devCards = ['knight'];
          moved = act(state, 'p1', { type: 'dev.playKnight', hex: destination });
        }
        expect(moduleStateOf<Observations>(moved.state, 'sf-hook-board')!.changes).toEqual(expected);
        const canSteal = hasVictim && target !== 'frame';
        expect(moved.state.pending?.kind ?? null).toBe(canSteal ? 'steal' : null);
        if (canSteal) moved = act(moved.state, 'p1', { type: 'pending.steal', victim: 'p2' }, scriptedRng([0]));
        expect(moduleStateOf<Observations>(moved.state, 'sf-hook-board')!.changes).toEqual(expected);
        if (cause === 'seven') {
          expect(moved.events.find((event) => event.type === 'fixture.banditObserved')?.params).toEqual({ changes: expected });
        }
        expect(moved.state.pending).toBeNull();
      });
    }
  }
});
