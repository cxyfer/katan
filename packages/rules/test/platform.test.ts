/**
 * Expansion platform: rules-module hooks, the pending queue and the layout
 * registry, exercised through a fixture module and fixture profile. No rule
 * here is a real expansion rule; the fixture only proves each hook is called
 * at its documented point.
 */

import { describe, expect, it } from 'vitest';
import { scoreOf, topologyOf } from '../src/analysis.ts';
import { actionHints, applyCommand, createGame } from '../src/engine.ts';
import { buildProfileLayout, registerLayoutBuilder } from '../src/layout-registry.ts';
import { registerRulesModule } from '../src/modules/registry.ts';
import { moduleStateOf, setModuleState } from '../src/modules/state.ts';
import type { RollResult, RulesModule } from '../src/modules/types.ts';
import { advancePending, enqueuePending, normalizePending, pendingFrames, pendingResponders } from '../src/pending.ts';
import { registerFixtureProfile } from '../src/profiles.ts';
import { projectGame } from '../src/project.ts';
import { seededRng } from '../src/rng.ts';
import { archipelagoLayout } from '../src/sample-boards.ts';
import { getTopology } from '../src/topology-registry.ts';
import type { GameState, ModulePending } from '../src/types.ts';
import {
  COLORS,
  act,
  expectRejected,
  forceTurn,
  newGame,
  placeBuilding,
  playableGame,
  playerIds,
  runSetup,
  scriptedRng,
  setHand,
} from './helpers.ts';

interface FixtureState {
  secret: string;
  rolls: number;
  boardChanges: number;
  produced: number;
}

const calls: string[] = [];

const fixtureModule: RulesModule = {
  id: 'fixture',
  initGame(state, ctx) {
    calls.push(`init:${ctx.profile.id}`);
    setModuleState<FixtureState>(state, 'fixture', { secret: 'hidden', rolls: 0, boardChanges: 0, produced: 0 });
  },
  setupBuilding: (_state, step) => (step.round === 2 ? 'city' : undefined),
  rollDice(_state, ctx) {
    const event = ctx.rng.int(6);
    const first = ctx.rng.int(6) + 1;
    const second = ctx.rng.int(6) + 1;
    return { dice: [first, second], total: first + second, extra: { event } };
  },
  beforeProduction(state, roll, ctx) {
    if (roll.extra?.event !== 0) return 'continue';
    ctx.kit.enqueuePending(
      state,
      { kind: 'fixture.choose', module: 'fixture', responders: ['p2', 'p3'], data: { secret: 42 } },
      { kind: 'fixture.produce', module: 'fixture', responders: [], data: { roll } },
    );
    return 'defer';
  },
  discardLimit: (_state, _player, base) => base + 2,
  modifyProduction(state, results) {
    moduleStateOf<FixtureState>(state, 'fixture')!.produced += results.length;
    return results;
  },
  afterProduction(state) {
    moduleStateOf<FixtureState>(state, 'fixture')!.rolls += 1;
  },
  afterBoardChange(state) {
    const slot = moduleStateOf<FixtureState>(state, 'fixture');
    if (slot) slot.boardChanges += 1;
  },
  commands: {
    'fixture.answer': (state, actorId, _command, ctx) => {
      const frame = state.pending;
      if (!frame || frame.kind !== 'fixture.choose') return ctx.kit.fail('E_PENDING_EFFECT');
      const pending = frame as ModulePending;
      if (pending.responders[0] !== actorId) return ctx.kit.fail('E_NOT_ACTOR');
      pending.responders.shift();
      ctx.kit.emit(state, 'fixture.answered', { playerId: actorId });
      if (pending.responders.length === 0) ctx.kit.completePending(state);
      return ctx.kit.accept(state);
    },
  },
  pendingCommands: ['fixture.answer'],
  resumePending(state, frame, ctx) {
    if (frame.kind === 'fixture.produce') ctx.kit.resolveRollOutcome(state, frame.data.roll as RollResult);
  },
  score: (_state, playerId) => (playerId === 'p1' ? 1 : 0),
  project: (state) => ({ rolls: moduleStateOf<FixtureState>(state, 'fixture')?.rolls ?? 0 }),
  projectPending: (_state, frame, viewerId) => ({
    kind: frame.kind,
    module: frame.module,
    responders: frame.responders.slice(),
    data: frame.responders.includes(viewerId) ? { secret: frame.data.secret } : {},
  }),
  actionHints: (_state, playerId) => ({ answer: playerId === 'p2' }),
};

registerRulesModule(fixtureModule);
registerLayoutBuilder('fixture-archipelago', () => archipelagoLayout(getTopology('sample-archipelago')));
registerFixtureProfile('fixture-platform', [3, 4], {
  ruleModules: ['fixture'],
  layoutId: 'fixture-archipelago',
  topologyId: 'sample-archipelago',
  setupModes: ['fixed'],
  ruleVersion: 'fixture-2025.1',
});

function fixtureGame(): GameState {
  return createGame({
    profileId: 'fixture-platform',
    players: playerIds(3).map((id, index) => ({ id, nickname: id, color: COLORS[index]! })),
    setupMode: 'fixed',
    rng: seededRng(5),
  });
}

/** A fixture game in p1's pre-roll window with a settlement on a numbered land hex. */
function readyToRoll(): { state: GameState; hex: number; number: number } {
  const state = runSetup(fixtureGame());
  forceTurn(state, 0, 'preroll');
  const topology = topologyOf(state);
  const hex = state.board.layout.terrain.findIndex((terrain) => terrain === 'fields');
  const vertex = topology.vertices.findIndex((info, index) => info.hexes.includes(hex) && !state.board.buildings[index]);
  placeBuilding(state, 'p1', vertex);
  return { state, hex, number: state.board.layout.numbers[hex]! };
}

describe('rules-module hooks', () => {
  it('never runs a hook or adds a field for base games', () => {
    const { state } = playableGame();
    const view = projectGame(state, 'p1', { hints: actionHints(state, 'p1') });
    expect(state.moduleState).toBeUndefined();
    expect('pendingQueue' in state).toBe(false);
    expect(view.modules).toBeUndefined();
    expect(view.hints!.modules).toBeUndefined();
    expect(view.pendingQueue).toEqual([]);
  });

  it('initialises module state and replaces the setup building', () => {
    calls.length = 0;
    const created = fixtureGame();
    expect(calls).toEqual(['init:fixture-platform']);
    expect(created.engineVersion).toBe('fixture-2025.1');
    expect(created.board.layout.topologyId).toBe('sample-archipelago');
    const state = runSetup(created);
    const buildings = state.board.buildings.filter((building) => building?.player === 'p1');
    expect(buildings.map((building) => building!.city).sort()).toEqual([false, true]);
    expect(moduleStateOf<FixtureState>(state, 'fixture')!.boardChanges).toBeGreaterThan(0);
  });

  it('adds module score, projection and hints without exposing module state', () => {
    const state = runSetup(fixtureGame());
    expect(scoreOf(state, 'p1', { includeHidden: false })).toBe(1 + 1 + 2);
    const view = projectGame(state, 'p2', { hints: actionHints(state, 'p2') });
    expect(view.modules).toEqual({ fixture: { rolls: 0 } });
    expect(view.hints!.modules).toEqual({ fixture: { answer: true } });
    expect(JSON.stringify(view)).not.toContain('hidden');
  });

  it('takes the roll from the module and resolves production immediately', () => {
    const { state, number } = readyToRoll();
    // Event die 3, then two dice summing to the settlement's number.
    const first = Math.min(6, number - 1);
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng([3, first - 1, number - first - 1]));
    expect(rolled.state.turn.dice).toEqual([first, number - first]);
    const event = rolled.events.find((candidate) => candidate.type === 'turn.rolled')!;
    expect(event.params).toMatchObject({ total: number, extra: { event: 3 } });
    expect(rolled.events.map((candidate) => candidate.type)).toContain('production.resolved');
    expect(rolled.state.pending).toBeNull();
    const slot = moduleStateOf<FixtureState>(rolled.state, 'fixture')!;
    expect(slot.rolls).toBe(1);
    expect(slot.produced).toBeGreaterThan(0);
  });

  it('defers production behind an ordered queue of frames with explicit responders', () => {
    const { state, number } = readyToRoll();
    const first = Math.min(6, number - 1);
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng([0, first - 1, number - first - 1])).state;
    expect(pendingFrames(rolled).map((frame) => frame.kind)).toEqual(['fixture.choose', 'fixture.produce']);
    expect(pendingResponders(rolled.pending!)).toEqual(['p2', 'p3']);
    expect(moduleStateOf<FixtureState>(rolled, 'fixture')!.rolls).toBe(0);

    // The queue blocks normal play; only the frame's own command is accepted.
    expectRejected(rolled, 'p1', { type: 'turn.end' }, 'E_PENDING_EFFECT');
    expectRejected(rolled, 'p3', { type: 'fixture.answer' } as never, 'E_NOT_ACTOR');

    // Data stays server-side unless the module shows it to a responder.
    expect(projectGame(rolled, 'p1').pending).toEqual({
      kind: 'fixture.choose', module: 'fixture', responders: ['p2', 'p3'], data: {},
    });
    expect(projectGame(rolled, 'p2').pending).toMatchObject({ data: { secret: 42 } });
    expect(projectGame(rolled, 'p1').pendingQueue).toEqual([
      { kind: 'fixture.produce', module: 'fixture', responders: [], data: {} },
    ]);

    const second = act(rolled, 'p2', { type: 'fixture.answer' } as never).state;
    expect(pendingResponders(second.pending!)).toEqual(['p3']);
    const done = act(second, 'p3', { type: 'fixture.answer' } as never);
    expect(done.events.map((event) => event.type)).toEqual(['fixture.answered', 'production.resolved']);
    expect(done.state.pending).toBeNull();
    expect('pendingQueue' in done.state).toBe(false);
    expect(moduleStateOf<FixtureState>(done.state, 'fixture')!.rolls).toBe(1);
    act(done.state, 'p1', { type: 'turn.end' });
  });

  it('lets a module raise the discard threshold', () => {
    const { state } = readyToRoll();
    setHand(state, 'p2', { lumber: 9 });
    setHand(state, 'p3', { lumber: 10 });
    const rolled = act(state, 'p1', { type: 'turn.roll' }, scriptedRng([2, 2, 3])).state;
    expect(rolled.turn.dice).toEqual([3, 4]);
    expect(rolled.pending).toMatchObject({ kind: 'discard', required: { p3: 5 } });
  });

  it('rejects module commands for profiles without the module', () => {
    const { state } = playableGame();
    expectRejected(state, 'p1', { type: 'fixture.answer' } as never, 'E_INVALID_COMMAND');
  });
});

describe('pending queue', () => {
  it('activates frames in order and drops the queue field when empty', () => {
    const { state } = playableGame();
    enqueuePending(
      state,
      { kind: 'yearOfPlenty', actor: 'p1', remaining: 1 },
      { kind: 'freeRoads', actor: 'p2', remaining: 1 },
      { kind: 'discard', required: { p3: 4, p4: 4 }, submitted: { p4: [] } },
    );
    expect(state.pending!.kind).toBe('yearOfPlenty');
    expect(state.pendingQueue!.map((frame) => frame.kind)).toEqual(['freeRoads', 'discard']);
    expect(advancePending(state)!.kind).toBe('freeRoads');
    const discard = advancePending(state)!;
    expect(pendingResponders(discard)).toEqual(['p3']);
    expect('pendingQueue' in state).toBe(false);
    expect(advancePending(state)).toBeNull();
  });

  it('finishes a base frame into the next queued one', () => {
    const { state } = playableGame({ phase: 'action' });
    enqueuePending(
      state,
      { kind: 'yearOfPlenty', actor: 'p1', remaining: 1 },
      { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false },
    );
    const next = act(state, 'p1', { type: 'pending.takeResource', resource: 'ore' }).state;
    expect(next.pending).toEqual({ kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false });
    expect('pendingQueue' in next).toBe(false);
  });

  it('loads snapshots written before the queue existed', () => {
    const { state } = newGame();
    const legacy = JSON.parse(JSON.stringify(runSetup(state))) as GameState;
    forceTurn(legacy, 0, 'action');
    legacy.pending = { kind: 'yearOfPlenty', actor: 'p1', remaining: 1 };
    delete legacy.pendingQueue;
    const view = projectGame(legacy, 'p2');
    expect(view.pending).toEqual({ kind: 'yearOfPlenty', actor: 'p1', remaining: 1 });
    expect(view.pendingQueue).toEqual([]);
    const outcome = applyCommand(legacy, 'p1', { type: 'pending.takeResource', resource: 'wool' }, seededRng(1));
    expect(outcome.ok).toBe(true);
  });

  it('normalises a queue left without an active frame', () => {
    const { state } = playableGame();
    state.pending = null;
    state.pendingQueue = [{ kind: 'freeRoads', actor: 'p1', remaining: 1 }];
    normalizePending(state);
    expect(state.pending).toEqual({ kind: 'freeRoads', actor: 'p1', remaining: 1 });
    expect('pendingQueue' in state).toBe(false);
  });

  it('clears the queue when a new action window opens', () => {
    const { state } = playableGame({ phase: 'action' });
    const ended = act(state, 'p1', { type: 'turn.end' }).state;
    expect(ended.pending).toBeNull();
    expect('pendingQueue' in ended).toBe(false);
  });
});

describe('layout registry', () => {
  it('builds base boards through the registered base builder', () => {
    const { state } = newGame({ mode: 'variable', seed: 4 });
    expect(state.board.layout.topologyId).toBe('hex-r2');
    const paired = newGame({ players: 5, profileId: 'base-paired-2025' }).state;
    expect(paired.board.layout.topologyId).toBe('hex-r56');
  });

  it('refuses a profile whose layout builder is missing or mismatched', () => {
    const missing = registerFixtureProfile('fixture-no-layout', [3], { layoutId: 'nope' });
    expect(() => buildProfileLayout(missing, { mode: 'fixed', playerCount: 3, rng: seededRng(1) }))
      .toThrow(/no registered layout builder/);
    registerLayoutBuilder('fixture-bad-layout', () => ({ ...archipelagoLayout(getTopology('sample-archipelago')), terrain: [] }));
    const bad = registerFixtureProfile('fixture-bad-layout', [3], { layoutId: 'fixture-bad-layout' });
    expect(() => buildProfileLayout(bad, { mode: 'fixed', playerCount: 3, rng: seededRng(1) }))
      .toThrow(/does not match topology/);
    expect(() => registerLayoutBuilder('base', () => { throw new Error('unused'); })).toThrow(/already registered/);
  });
});
