import { describe, expect, it } from 'vitest';
import { topologyOf } from '../src/analysis.ts';
import { verticesOfHex } from '../src/topology.ts';
import { registerRulesModule } from '../src/modules/registry.ts';
import { moduleStateOf, setModuleState } from '../src/modules/state.ts';
import { ckState } from '../src/modules/citiesKnights/state.ts';
import { registerFixtureProfile, requireProfile } from '../src/profiles.ts';
import type { GameState } from '../src/types.ts';
import { SCIENCE, SHIP, actCk, edgeBetween, eventsOf, giveCommodities, handCards, player, rollRng, setImprovement } from './ck-helpers.ts';
import { give, scriptedRng } from './helpers.ts';
import { corner, hex, settle, ship } from './seafarers-helpers.ts';
import { afterFirstAttack, emptySfckGame } from './sfck-helpers.ts';

interface Observations { calls: string[]; changes: number }
const observations = (state: GameState) => moduleStateOf<Observations>(state, 'sfck-hook-log')!;
for (const id of ['sfck-hook-before', 'sfck-hook-after']) {
  registerRulesModule({
    id,
    beforeProduction(state) { observations(state).calls.push(`before:${id}`); return 'continue'; },
    afterProduction(state) { observations(state).calls.push(`after:${id}`); },
    afterBoardChange(state) { if (id === 'sfck-hook-after') observations(state).changes += 1; },
  });
}
registerFixtureProfile('fixture-sfck-hooks', [4], {
  ...requireProfile('sf-ck-new-shores-2025'),
  id: 'fixture-sfck-hooks',
  ruleModules: ['sfck-hook-before', 'seafarersCitiesKnights', 'seafarers', 'citiesKnights', 'sfck-hook-after'],
});

function ready(phase: 'preroll' | 'action' = 'preroll'): GameState {
  const state = emptySfckGame(4, 0, phase);
  state.profileId = 'fixture-sfck-hooks';
  setModuleState<Observations>(state, 'sfck-hook-log', { calls: [], changes: 0 });
  return state;
}
const calls = ['before:sfck-hook-before', 'before:sfck-hook-after', 'after:sfck-hook-before', 'after:sfck-hook-after'];
const restore = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;

describe('SF+CK hook composition after integration', () => {
  it.each([false, true])('runs production once across all three modules (progress discard: %s)', (discard) => {
    const state = ready();
    const forest = state.board.layout.terrain.findIndex((terrain) => terrain === 'forest');
    const total = state.board.layout.numbers[forest]!;
    // 任一生產森林旁放一座城；不用依賴編號在不同地圖上的位置。
    settle(state, 'p2', verticesOfHex(topologyOf(state), forest)[0]!, true);
    setImprovement(state, 'p2', 'science', 5);
    player(state, 'p2').progressCards = discard ? ['alchemy', 'alchemy', 'crane', 'crane'] : [];
    state.progressDecks.science = ['mining'];
    const yellow = Math.min(6, total - 1);
    let result = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(yellow, total - yellow, SCIENCE));
    if (discard) {
      expect(observations(result.state).calls).toEqual(['before:sfck-hook-before']);
      expect(eventsOf(result, 'production.resolved')).toHaveLength(0);
      result = actCk(restore(result.state), 'p2', { type: 'progress.discard', cards: ['alchemy'] }, scriptedRng([]));
    }
    expect(observations(result.state)).toEqual({ calls, changes: 0 });
    expect(eventsOf(result, 'production.resolved')).toHaveLength(1);
    expect(eventsOf(result, 'ck.commoditiesProduced')).toHaveLength(1);
    expect(player(result.state, 'p2').commodities.paper).toBe(1);
    expect(result.state.pending).toBeNull();
  });

  it.each(['pirate', 'robber', 'frame'] as const)('resumes a barbarian pillage into a seven and %s exactly once', (target) => {
    const state = ready();
    settle(state, 'p1', 28, true);
    settle(state, 'p1', 15, true);
    ckState(state).barbarian = 6;
    const rolled = actCk(state, 'p1', { type: 'turn.roll' }, rollRng(3, 4, SHIP));
    expect(rolled.state.pending?.kind).toBe('citiesKnights.pillage');
    expect(observations(rolled.state)).toEqual({ calls: ['before:sfck-hook-before'], changes: 1 });
    const pillaged = actCk(restore(rolled.state), 'p1', { type: 'barbarians.pillage', vertex: 28 }, scriptedRng([]));
    expect(observations(pillaged.state)).toEqual({ calls, changes: 2 });
    expect(eventsOf(pillaged, 'robber.moveRequired')).toHaveLength(1);
    const next = restore(pillaged.state);
    const sea = hex(next, 2, 0);
    ship(next, 'p2', edgeBetween(next, 48, 47));
    settle(next, 'p2', corner(next, 1, -1, 0));
    giveCommodities(next, 'p2', { cloth: 1 });
    if (target === 'frame') next.board.pirate = sea;
    const moved = actCk(next, 'p1', { type: 'pending.moveRobber', hex: target === 'frame' ? null : target === 'pirate' ? sea : hex(next, 1, -1) }, scriptedRng([]));
    expect(observations(moved.state)).toEqual({ calls, changes: 3 });
    const done = target === 'frame' ? moved : actCk(restore(moved.state), 'p1', { type: 'pending.steal', victim: 'p2' }, scriptedRng([0]));
    expect(observations(done.state)).toEqual({ calls, changes: 3 });
    expect(done.state.pending).toBeNull();
  });

  it('notifies once for paid ships, moves, free ships and Diplomacy replacements', () => {
    const state = afterFirstAttack(ready('action'));
    settle(state, 'p1', 28);
    ship(state, 'p1', edgeBetween(state, 28, 11));
    give(state, 'p1', { lumber: 1, wool: 1 });
    const tip = edgeBetween(state, 11, 10);
    const built = actCk(state, 'p1', { type: 'build.ship', edge: tip });
    expect(observations(built.state).changes).toBe(1);
    built.state.windowId += 1;
    const moved = actCk(built.state, 'p1', { type: 'ship.move', from: tip, to: edgeBetween(state, 11, 6) });
    expect(observations(moved.state).changes).toBe(2);
    handCards(moved.state, 'p1', ['diplomacy']);
    const removed = actCk(moved.state, 'p1', { type: 'progress.play', card: 'diplomacy', edge: edgeBetween(state, 11, 6) });
    // 自己的 Diplomacy 移除與重放是同一個棋盤結算，不能在中途重算獎項。
    expect(observations(removed.state).changes).toBe(2);
    const replaced = actCk(removed.state, 'p1', { type: 'progress.diplomacyRoad', edge: tip });
    expect(observations(replaced.state).changes).toBe(3);
    const free = afterFirstAttack(ready('action'));
    settle(free, 'p1', 28);
    handCards(free, 'p1', ['roadBuilding']);
    const granted = actCk(free, 'p1', { type: 'progress.play', card: 'roadBuilding' });
    const first = actCk(granted.state, 'p1', { type: 'build.ship', edge: edgeBetween(free, 28, 11) });
    expect(observations(first.state).changes).toBe(1);
    const second = actCk(first.state, 'p1', { type: 'build.ship', edge: tip });
    expect(observations(second.state)).toEqual({ calls: [], changes: 2 });
    expect(second.state.pending).toBeNull();
  });
});
