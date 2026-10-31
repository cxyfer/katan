import { describe, expect, it } from 'vitest';
import { deriveActions } from '../src/state/actions.ts';
import { requiredActionFor, requiredActionAnnouncement } from '../src/state/pending.ts';
import { initialTableState, type TableState } from '../src/state/table.ts';
import { beginCommand } from '../src/state/commands.ts';
import { makeSnapshot, makeView, makeHints, fixedBoard } from '../src/test/fixtures.ts';

function stateWith(overrides: Partial<TableState> = {}): TableState {
  const base = initialTableState('en', 'Alex');
  return {
    ...base,
    bootstrapped: true,
    session: { id: 'p1', nickname: 'Alex', locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' },
    screen: 'game',
    ...overrides,
  };
}

describe('action availability', () => {
  it('holds every action behind the rolling reason until the dice presentation ends', () => {
    const game = makeSnapshot(makeView({ hints: makeHints({ legalRoads: [3], canEndTurn: true }) }));
    const rolling = deriveActions(stateWith({ game, dicePresenting: true }), 'p1');
    expect(rolling.find((action) => action.id === 'endTurn')).toMatchObject({
      enabled: false,
      reasonId: 'play.disabled.rolling',
    });
    expect(rolling.find((action) => action.id === 'build.road')).toMatchObject({
      enabled: false,
      reasonId: 'play.disabled.rolling',
    });
    // 由擲骰後投影推得的原因（沒有目標、資源不足、待處理）也先蓋掉，避免透露點數。
    expect(rolling.find((action) => action.id === 'build.settlement')?.reasonId).toBe('play.disabled.rolling');
    const seven = makeSnapshot(makeView({
      hints: makeHints(),
      pending: { kind: 'discard', required: { p1: 1 }, waitingFor: ['p1'] },
    }));
    const sevenActions = deriveActions(stateWith({ game: seven, dicePresenting: true }), 'p1');
    expect(new Set(sevenActions.map((action) => action.reasonId))).toEqual(new Set(['play.disabled.rolling']));
    expect(requiredActionFor(stateWith({ game: seven, dicePresenting: true }))).toMatchObject({ kind: 'rolling', mine: false });
    expect(requiredActionFor(stateWith({ game: seven }))).toMatchObject({ kind: 'discard', mine: true });

    const settled = deriveActions(stateWith({ game, dicePresenting: false }), 'p1');
    expect(settled.find((action) => action.id === 'endTurn')).toMatchObject({ enabled: true, reasonId: null });
    expect(settled.find((action) => action.id === 'build.road')).toMatchObject({ enabled: true, reasonId: null });
  });

  it('enables roll only in the preroll phase for the turn owner', () => {
    const state = stateWith({
      game: makeSnapshot(makeView({ hints: makeHints({ canRoll: true, canEndTurn: false }), phase: 'preroll' })),
    });
    const roll = deriveActions(state, 'p1').find((action) => action.id === 'roll')!;
    expect(roll.enabled).toBe(true);
    expect(roll.reasonId).toBeNull();

    // Hints are per-viewer: the engine only sets `canRoll` for the actor.
    const waiting = stateWith({
      game: makeSnapshot(
        makeView({ hints: makeHints({ canRoll: false, canEndTurn: false }), phase: 'preroll', turnPlayerId: 'p2' }),
      ),
    });
    const otherRoll = deriveActions(waiting, 'p1').find((action) => action.id === 'roll')!;
    expect(otherRoll.enabled).toBe(false);
    expect(otherRoll.reasonId).toBe('play.disabled.notYourTurn');
  });

  it('disables a build with no legal target and says so', () => {
    const state = stateWith({
      game: makeSnapshot(makeView({ hints: makeHints({ legalRoads: [], legalSettlements: [4] }) })),
    });
    const actions = deriveActions(state, 'p1');
    expect(actions.find((action) => action.id === 'build.road')).toMatchObject({
      enabled: false,
      reasonId: 'play.disabled.noTargets',
      targetCount: 0,
    });
    expect(actions.find((action) => action.id === 'build.settlement')).toMatchObject({
      enabled: true,
      reasonId: null,
      targetCount: 1,
    });
  });

  it('reports insufficient inventory rather than a bare disabled button', () => {
    const state = stateWith({
      game: makeSnapshot(
        makeView({
          hints: makeHints({ legalSettlements: [4] }),
          players: [
            {
              ...makeView().players[0]!,
              resources: { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 },
            },
            ...makeView().players.slice(1),
          ],
        }),
      ),
    });
    const settlement = deriveActions(state, 'p1').find(
      (action) => action.id === 'build.settlement',
    )!;
    expect(settlement.enabled).toBe(false);
    expect(settlement.reasonId).toBe('play.disabled.inventory');
  });

  it('reports timing when the phase does not allow building', () => {
    const state = stateWith({
      game: makeSnapshot(
        makeView({ hints: makeHints({ legalRoads: [1], canEndTurn: false }), phase: 'preroll' }),
      ),
    });
    const road = deriveActions(state, 'p1').find((action) => action.id === 'build.road')!;
    expect(road.enabled).toBe(false);
    expect(road.reasonId).toBe('play.disabled.timing');
  });

  it('reports not-your-turn ahead of timing for another player', () => {
    const state = stateWith({
      game: makeSnapshot(
        makeView({ hints: makeHints({ legalRoads: [1] }), turnPlayerId: 'p2' }),
      ),
    });
    const road = deriveActions(state, 'p1').find((action) => action.id === 'build.road')!;
    expect(road.enabled).toBe(false);
    expect(road.reasonId).toBe('play.disabled.notYourTurn');
  });

  it('reports connectivity ahead of every other reason and disables everything', () => {
    const state = stateWith({
      connection: 'offline',
      game: makeSnapshot(makeView({ hints: makeHints({ canEndTurn: true, legalRoads: [1] }) })),
    });
    for (const action of deriveActions(state, 'p1')) {
      expect(action.enabled).toBe(false);
      expect(action.reasonId).toBe('play.disabled.connectivity');
    }
  });

  it('blocks new commands while an outcome is unknown', () => {
    const state = stateWith({
      game: makeSnapshot(makeView({ hints: makeHints({ canEndTurn: true, legalRoads: [1] }) })),
      command: { ...beginCommand({ kind: 'begin', commandId: 'c1', labelId: 'x', command: { type: 'turn.end' }, baseRevision: 1 }), status: 'unknown' },
    });
    for (const action of deriveActions(state, 'p1')) {
      expect(action.enabled).toBe(false);
    }
  });
});

describe('required action derivation', () => {
  it('distinguishes my turn from waiting for somebody else', () => {
    const mine = stateWith({
      game: makeSnapshot(makeView({ hints: makeHints({ canRoll: true, canEndTurn: false }), phase: 'preroll' })),
    });
    expect(requiredActionFor(mine)).toMatchObject({ kind: 'roll', mine: true });

    const theirs = stateWith({
      game: makeSnapshot(
        makeView({ hints: makeHints({ canRoll: false, canEndTurn: false }), phase: 'preroll', turnPlayerId: 'p2' }),
      ),
    });
    expect(requiredActionFor(theirs)).toMatchObject({ kind: 'roll', mine: false, waitingFor: ['p2'] });
  });

  it('marks a discard as mine only while the engine still waits for me', () => {
    const board = fixedBoard();
    const pending = { kind: 'discard' as const, required: { p1: 4, p2: 3 }, waitingFor: ['p1', 'p2'] };
    const mine = stateWith({
      game: makeSnapshot(makeView({ board, pending, hints: null })),
    });
    expect(requiredActionFor(mine)).toMatchObject({
      kind: 'discard',
      mine: true,
      params: { count: 4 },
      waitingFor: [],
    });

    // p1 already submitted: `required` still lists p1, but the outstanding
    // wait list does not. The prompt must switch to waiting for p2 instead of
    // asking p1 to discard again (docs/SPEC.md §4.4).
    const submitted = stateWith({
      game: makeSnapshot(
        makeView({ board, pending: { ...pending, waitingFor: ['p2'] }, hints: null }),
      ),
    });
    const submittedAction = requiredActionFor(submitted);
    expect(submittedAction).toMatchObject({
      kind: 'discard',
      mine: false,
      messageId: 'play.pending.discardWaiting',
      waitingFor: ['p2'],
    });
    expect(requiredActionAnnouncement(submittedAction, (id) => id)).toBeNull();

    const notMine = stateWith({
      game: makeSnapshot(
        makeView({ board, pending: { ...pending, required: { p2: 3 }, waitingFor: ['p2'] }, hints: null }),
      ),
    });
    expect(requiredActionFor(notMine)).toMatchObject({ kind: 'discard', mine: false });
  });

  it('produces a translated live-region announcement only for my own obligations', () => {
    const action = requiredActionFor(
      stateWith({
        game: makeSnapshot(makeView({ hints: makeHints({ canRoll: true, canEndTurn: false }), phase: 'preroll' })),
      }),
    );
    const announcement = requiredActionAnnouncement(action, (id, params) =>
      params ? `${id}:${JSON.stringify(params)}` : id,
    );
    expect(announcement?.messageId).toBe('a11y.requiredAction');
    expect(announcement?.params.action).toContain('play.roll');

    expect(requiredActionAnnouncement(null, (id) => id)).toBeNull();
    const theirs = requiredActionFor(
      stateWith({
        game: makeSnapshot(makeView({ hints: makeHints({ canRoll: false }), phase: 'preroll', turnPlayerId: 'p2' })),
      }),
    );
    expect(requiredActionAnnouncement(theirs, (id) => id)).toBeNull();
  });
});
