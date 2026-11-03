import { describe, expect, it } from 'vitest';
import { registerRulesModule } from '../src/modules/registry.ts';
import { moduleStateOf, setModuleState } from '../src/modules/state.ts';
import { ckState } from '../src/modules/citiesKnights/state.ts';
import { registerFixtureProfile, requireProfile } from '../src/profiles.ts';
import type { GameState } from '../src/types.ts';
import {
  SCIENCE, SHIP, actCk, emptyCkGame, eventsOf, hexWith, cornersOf,
  player, rollRng, setBuilding, setImprovement, spreadVertices,
} from './ck-helpers.ts';

interface Observations {
  calls: string[];
  boardChanges: number;
}
const observations = (state: GameState) => moduleStateOf<Observations>(state, 'ck-hook-log')!;
for (const id of ['ck-hook-before', 'ck-hook-after']) {
  registerRulesModule({
    id,
    beforeProduction(state) {
      observations(state).calls.push(`before:${id}`);
      return 'continue';
    },
    afterProduction(state) {
      observations(state).calls.push(`after:${id}`);
    },
    afterBoardChange(state) {
      if (id === 'ck-hook-after') observations(state).boardChanges += 1;
    },
  });
}
registerFixtureProfile('fixture-ck-hooks', [4], {
  ...requireProfile('ck-2025'),
  id: 'fixture-ck-hooks',
  ruleModules: ['ck-hook-before', 'citiesKnights', 'ck-hook-after'],
});

function ready(): GameState {
  const state = emptyCkGame(4, 0, 'preroll');
  state.profileId = 'fixture-ck-hooks';
  setModuleState<Observations>(state, 'ck-hook-log', { calls: [], boardChanges: 0 });
  return state;
}

const expectedCalls = [
  'before:ck-hook-before', 'before:ck-hook-after',
  'after:ck-hook-before', 'after:ck-hook-after',
];

describe('C&K integration with ordered hook continuations', () => {
  it.each([false, true])('runs production hooks once and pays commodities once (progress discard: %s)', (discard) => {
    const state = ready();
    const forest = hexWith(state, 'forest', 11);
    setBuilding(state, 'p2', cornersOf(state, forest)[0]!, true);
    setImprovement(state, 'p2', 'science', 5);
    player(state, 'p2').progressCards = discard ? ['alchemy', 'alchemy', 'crane', 'crane'] : [];
    state.progressDecks.science = ['mining'];
    let rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(5, 6, SCIENCE));
    if (discard) {
      expect(rolled.state.pending?.kind).toBe('citiesKnights.progressDiscard');
      expect(observations(rolled.state).calls).toEqual(['before:ck-hook-before']);
      expect(eventsOf(rolled, 'production.resolved')).toHaveLength(0);
      // 續接位置必須能從快照恢復，不能依賴上個指令的閉包。
      const restored = JSON.parse(JSON.stringify(rolled.state)) as GameState;
      rolled = actCk(restored, 'p2', { type: 'progress.discard', cards: ['alchemy'] });
    }
    expect(observations(rolled.state).calls).toEqual(expectedCalls);
    expect(observations(rolled.state).boardChanges).toBe(0);
    expect(player(rolled.state, 'p2').commodities.paper).toBe(1);
    expect(eventsOf(rolled, 'ck.commoditiesProduced')).toHaveLength(1);
    expect(eventsOf(rolled, 'production.resolved')).toHaveLength(1);
    expect(rolled.state.pending).toBeNull();
    expect(rolled.state.pendingQueue).toBeUndefined();
  });

  it('resumes a pillage into a seven once and reports each board change once', () => {
    const state = ready();
    const [first, second] = spreadVertices(state, 2);
    setBuilding(state, 'p1', first!, true);
    setBuilding(state, 'p1', second!, true);
    ckState(state).barbarian = 6;
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, SHIP));
    expect(rolled.state.pending?.kind).toBe('citiesKnights.pillage');
    expect(observations(rolled.state).calls).toEqual(['before:ck-hook-before']);
    expect(observations(rolled.state).boardChanges).toBe(1);

    const restored = JSON.parse(JSON.stringify(rolled.state)) as GameState;
    const pillaged = actCk(restored, 'p1', { type: 'barbarians.pillage', vertex: first! });
    expect(observations(pillaged.state).calls).toEqual(expectedCalls);
    expect(observations(pillaged.state).boardChanges).toBe(2);
    expect(eventsOf(pillaged, 'robber.moveRequired')).toHaveLength(1);
    expect(pillaged.state.pending?.kind).toBe('moveRobber');
    const target = hexWith(pillaged.state, 'forest');
    const moved = actCk(pillaged.state, 'p1', { type: 'pending.moveRobber', hex: target });
    expect(observations(moved.state).boardChanges).toBe(3);
    expect(observations(moved.state).calls).toEqual(expectedCalls);
    expect(moved.state.pending).toBeNull();
  });
});
