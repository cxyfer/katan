/** T&B 與 release hook 續接、觸發次數與模組順序的整合驗證。 */
import { describe, expect, it, vi } from 'vitest';
import { topologyOf } from '../src/analysis.ts';
import { getRulesModule, registerRulesModule } from '../src/modules/registry.ts';
import { moduleStateOf } from '../src/modules/state.ts';
import { activeParts } from '../src/modules/tradersBarbarians/index.ts';
import type { RollResult } from '../src/modules/types.ts';
import { registerFixtureProfile, requireProfile } from '../src/profiles.ts';
import { act, placeBuilding, scriptedRng, setHand } from './helpers.ts';
import { clearBoard, tbPlayable } from './tb-helpers.ts';

registerRulesModule({
  id: 'tb-hook-before',
  beforeProduction(state, roll, ctx) {
    ctx.kit.enqueuePending(state,
      { kind: 'fixtureTb.choose', module: 'tb-hook-before', responders: ['p2'], data: {} },
      { kind: 'fixtureTb.resume', module: 'tb-hook-before', responders: [], data: { roll } });
    return 'defer';
  },
  commands: {
    'fixtureTb.answer': (state, _actor, _command, ctx) => {
      ctx.kit.completePending(state, ctx.rng);
      return ctx.kit.accept(state);
    },
  },
  pendingCommands: ['fixtureTb.answer'],
  resumePending(state, frame, ctx) {
    ctx.kit.resolveRollOutcome(state, frame.data.roll as RollResult);
  },
});
registerFixtureProfile('fixture-tb-hooks', [4], {
  ...requireProfile('tb-fishing-2025'), id: 'fixture-tb-hooks',
  ruleModules: ['tb-hook-before', 'tradersBarbarians'],
});

describe('T&B hook integration', () => {
  it('resumes T&B production exactly once after an earlier module defers, including snapshot restoration', () => {
    const initial = tbPlayable('fixture-tb-hooks', { phase: 'preroll' });
    clearBoard(initial);
    for (const player of initial.players) setHand(initial, player.id, {});
    const fishing = moduleStateOf<Record<string, { lake: number; hands: Record<string, number[]> }>>(initial, 'tradersBarbarians')!['tb-fishing']!;
    fishing.hands.p1 = [];
    placeBuilding(initial, 'p1', topologyOf(initial).vertices.findIndex((vertex) => vertex.hexes.includes(fishing.lake)));
    const module = getRulesModule('tradersBarbarians')!;
    const before = vi.spyOn(module, 'beforeProduction');
    const after = vi.spyOn(module, 'afterProduction');
    try {
      const rolled = act(initial, 'p1', { type: 'turn.roll' }, scriptedRng([0, 1])).state;
      expect(before).not.toHaveBeenCalled();
      expect(after).not.toHaveBeenCalled();
      const restored = JSON.parse(JSON.stringify(rolled)) as typeof rolled;
      const finished = act(restored, 'p2', { type: 'fixtureTb.answer' } as never, scriptedRng([0]));
      expect(before).toHaveBeenCalledTimes(1);
      expect(after).toHaveBeenCalledTimes(1);
      expect(finished.events.filter((event) => event.type === 'production.resolved')).toHaveLength(1);
      expect(finished.events.filter((event) => event.type === 'tb.fishDrawn')).toHaveLength(1);
      expect(finished.state.pending).toBeNull();
      expect(finished.state.pendingQueue).toBeUndefined();
    } finally {
      before.mockRestore();
      after.mockRestore();
    }
  });

  for (const cause of ['seven', 'knight'] as const) {
    it(`notifies the T&B board-change hook once for a ${cause} move, before and after theft`, () => {
      const state = tbPlayable('tb-friendly-robber-2025', { phase: 'preroll', mode: 'fixed' });
      clearBoard(state);
      for (const player of state.players) setHand(state, player.id, {});
      state.players[1]!.bonusPoints = 3;
      const hex = state.board.layout.terrain.findIndex((terrain) => terrain !== 'desert');
      placeBuilding(state, 'p2', topologyOf(state).vertices.findIndex((vertex) => vertex.hexes.includes(hex)));
      setHand(state, 'p2', { ore: 1 });
      const changed = vi.spyOn(getRulesModule('tradersBarbarians')!, 'afterBoardChange');
      try {
        let moved;
        if (cause === 'seven') {
          const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3])).state;
          moved = act(rolled, 'p1', { type: 'pending.moveRobber', hex });
        } else {
          state.players[0]!.devCards = ['knight'];
          moved = act(state, 'p1', { type: 'dev.playKnight', hex });
        }
        expect(changed).toHaveBeenCalledTimes(1);
        expect(moved.state.pending?.kind).toBe('steal');
        const stolen = act(moved.state, 'p1', { type: 'pending.steal', victim: 'p2' }, scriptedRng([0]));
        expect(changed).toHaveBeenCalledTimes(1);
        expect(stolen.state.pending).toBeNull();
      } finally {
        changed.mockRestore();
      }
    });
  }

  it('keeps shared parts before the scenario and the combination layer before SF/C&K', () => {
    expect(requireProfile('tb-barbarian-attack-2025').ruleModules).toEqual(['tradersBarbarians']);
    expect(activeParts(requireProfile('tb-barbarian-attack-2025')).map((part) => part.id))
      .toEqual(['tb-coins', 'tb-barbarian-attack']);
    expect(requireProfile('sf-ck-new-shores-2025').ruleModules).toEqual(['seafarersCitiesKnights', 'seafarers', 'citiesKnights']);
  });
});
