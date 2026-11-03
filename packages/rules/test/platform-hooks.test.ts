import { describe, expect, it } from 'vitest';
import { topologyOf } from '../src/analysis.ts';
import { registerRulesModule } from '../src/modules/registry.ts';
import { moduleStateOf, setModuleState } from '../src/modules/state.ts';
import type { RollResult } from '../src/modules/types.ts';
import { pendingFrames } from '../src/pending.ts';
import { registerFixtureProfile } from '../src/profiles.ts';
import type { GameState } from '../src/types.ts';
import { act, forceTurn, newGame, placeBuilding, runSetup, scriptedRng, setHand } from './helpers.ts';

interface HookLog {
  deferCount: number;
  calls: string[];
  draw?: number;
  boardChanges: number[];
}

const moduleIds = ['hook-first', 'hook-second', 'hook-last'];
const logOf = (state: GameState) => moduleStateOf<HookLog>(state, 'hook-log')!;

moduleIds.forEach((id, index) => registerRulesModule({
  id,
  beforeProduction(state, roll, ctx) {
    logOf(state).calls.push(`before:${id}`);
    if (index === 2) logOf(state).draw = ctx.rng.int(6);
    if (index >= logOf(state).deferCount) return 'continue';
    ctx.kit.enqueuePending(
      state,
      { kind: `${id}.choose`, module: id, responders: ['p2'], data: {} },
      { kind: `${id}.produce`, module: id, responders: [], data: { roll } },
    );
    return 'defer';
  },
  commands: {
    [`${id}.answer`]: (state, _actor, _command, ctx) => {
      ctx.kit.completePending(state, ctx.rng);
      return ctx.kit.accept(state);
    },
  },
  pendingCommands: [`${id}.answer`],
  resumePending(state, frame, ctx) {
    ctx.kit.resolveRollOutcome(state, frame.data.roll as RollResult);
  },
  afterProduction(state) {
    logOf(state).calls.push(`after:${id}`);
  },
}));

registerRulesModule({
  id: 'hook-board',
  afterBoardChange(state) {
    logOf(state)?.boardChanges.push(state.board.robber);
  },
  resumePending(state, _frame, ctx) {
    ctx.kit.emit(state, 'fixture.boardObserved', { changes: logOf(state).boardChanges.slice() });
  },
});
registerFixtureProfile('fixture-hook-chain', [4], { ruleModules: moduleIds });
registerFixtureProfile('fixture-hook-board', [4], { ruleModules: ['hook-board'] });

function ready(profileId: string): GameState {
  const state = runSetup(newGame({ profileId }).state);
  forceTurn(state, 0, 'preroll');
  setModuleState<HookLog>(state, 'hook-log', { deferCount: 0, calls: [], boardChanges: [] });
  for (const player of state.players) setHand(state, player.id, {});
  return state;
}

describe('pre-production hook continuations', () => {
  for (const total of [6, 7]) {
    it.each([0, 1, 2, 3])(`runs every hook once across %i deferrals on a ${total}`, (deferCount) => {
      const initial = ready('fixture-hook-chain');
      logOf(initial).deferCount = deferCount;
      let state = act(initial, 'p1', { type: 'turn.roll' }, scriptedRng([2, total - 4, 4])).state;
      for (let index = 0; index < deferCount; index++) {
        expect(state.pending?.kind).toBe(`${moduleIds[index]}.choose`);
        expect(state.log.some((event) => event.type === 'production.resolved')).toBe(false);
        expect(logOf(state).calls).toEqual(moduleIds.slice(0, index + 1).map((id) => `before:${id}`));
        // 續接必須能跨快照儲存／復原，不能依賴上一個指令留下的記憶體位置。
        state = JSON.parse(JSON.stringify(state)) as GameState;
        state = act(state, 'p2', { type: `${moduleIds[index]}.answer` } as never, scriptedRng([4])).state;
      }
      expect(logOf(state).calls).toEqual([
        ...moduleIds.map((id) => `before:${id}`),
        ...moduleIds.map((id) => `after:${id}`),
      ]);
      expect(logOf(state).draw).toBe(4);
      expect(state.log.filter((event) => event.type === 'production.resolved')).toHaveLength(total === 7 ? 0 : 1);
      expect(state.pending?.kind ?? null).toBe(total === 7 ? 'moveRobber' : null);
      expect(state.log.filter((event) => event.type === 'robber.moveRequired')).toHaveLength(total === 7 ? 1 : 0);
      expect(pendingFrames(state).some((frame) => frame.kind.includes('.'))).toBe(false);
      expect(state.pendingQueue).toBeUndefined();
    });
  }
});

describe('robber board-change hooks', () => {
  for (const cause of ['seven', 'knight'] as const) {
    it.each([false, true])(`reports a ${cause} move once before continuing (victim: %s)`, (hasVictim) => {
      const state = ready('fixture-hook-board');
      const hex = state.board.layout.terrain.findIndex((terrain, index) => terrain !== 'desert' && index !== state.board.robber);
      state.board.buildings.fill(null);
      if (hasVictim) {
        placeBuilding(state, 'p2', topologyOf(state).vertices.findIndex((vertex) => vertex.hexes.includes(hex)));
        setHand(state, 'p2', { ore: 1 });
      }
      let moved;
      if (cause === 'seven') {
        const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 3])).state;
        rolled.pendingQueue = [{ kind: 'hook-board.observe', module: 'hook-board', responders: [], data: {} }];
        moved = act(rolled, 'p1', { type: 'pending.moveRobber', hex });
      } else {
        state.players[0]!.devCards = ['knight'];
        moved = act(state, 'p1', { type: 'dev.playKnight', hex });
      }
      expect(logOf(moved.state).boardChanges).toEqual([hex]);
      expect(moved.state.pending?.kind ?? null).toBe(hasVictim ? 'steal' : null);
      if (hasVictim) moved = act(moved.state, 'p1', { type: 'pending.steal', victim: 'p2' }, scriptedRng([0]));
      expect(logOf(moved.state).boardChanges).toEqual([hex]);
      if (cause === 'seven') {
        expect(moved.events.find((event) => event.type === 'fixture.boardObserved')?.params).toEqual({ changes: [hex] });
      }
      expect(moved.state.pending).toBeNull();
    });
  }
});
