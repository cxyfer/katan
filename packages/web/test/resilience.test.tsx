import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { activeTurnKey, initialTableState, tableReducer } from '../src/state/table.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import { makeRoom, makeSnapshot, makeView } from '../src/test/fixtures.ts';

function renderApp(api: FakeApi) {
  return render(
    <App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />,
  );
}

async function openGame(api: FakeApi): Promise<void> {
  renderApp(api);
  fireEvent.click(await screen.findByTestId('resume-g1'));
  await screen.findByTestId('board-svg');
}

describe('persistence UX', () => {
  it('reports a pending save, then a failed save, and never claims success', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView()),
      saveResult: {
        ok: true,
        data: {
          requestId: 'r',
          gameId: 'g1',
          revision: 12,
          savedAt: '2026-01-02T00:00:00.000Z',
          outcome: 'failed',
          error: { messageId: 'error.E_NETWORK' },
        },
      },
    });
    await openGame(api);

    fireEvent.click(screen.getByTestId('save-and-leave'));
    await waitFor(() =>
      expect(screen.getByTestId('save-state').getAttribute('data-state')).toBe('failed'),
    );
    expect(screen.getByTestId('save-failed')).toBeTruthy();
    expect(api.callsOf('saveGame')).toHaveLength(1);
    // Still on the game screen: a failed save must not look like a success.
    expect(screen.getByTestId('board-svg')).toBeTruthy();
  });

  it('returns to the resume list only after an acknowledged save', async () => {
    const api = createFakeApi({ snapshot: makeSnapshot(makeView()) });
    await openGame(api);
    fireEvent.click(screen.getByTestId('save-and-leave'));
    await waitFor(() => expect(api.callsOf('saveGame')).toHaveLength(1));
    const saved = await screen.findByTestId('resume-list');
    expect(saved.textContent).toContain('Alex');
  });

  it('offers resume readiness while the table is suspended', async () => {
    const api = createFakeApi({
      room: makeRoom({ status: 'suspended', gameId: 'g1' }),
      snapshot: makeSnapshot(makeView()),
    });
    renderApp(api);
    fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
    fireEvent.click(screen.getByTestId('join-room'));
    await screen.findByTestId('board-svg');

    expect(screen.getByTestId('resume-bar')).toBeTruthy();
    fireEvent.click(screen.getByTestId('resume-ready'));
    await waitFor(() => expect(api.callsOf('resumeGame')).toHaveLength(1));
    expect(api.callsOf('resumeGame')[0]!.args[1]).toBe(true);
  });

  it('proposes a shared save/suspend without pretending it is agreed', async () => {
    const api = createFakeApi({ snapshot: makeSnapshot(makeView()) });
    await openGame(api);
    fireEvent.click(screen.getByTestId('suspend-propose'));
    await waitFor(() => expect(api.callsOf('suspendGame')).toHaveLength(1));
  });
});

describe('result screen', () => {
  it('announces a winner with the final score and keeps the board inspectable', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(
        makeView({ result: { playerId: 'p1', reason: 'victory', score: 10 } }),
      ),
    });
    await openGame(api);
    expect(await screen.findByTestId('result-winner')).toBeTruthy();
    expect(screen.getByTestId('result-winner').textContent).toContain('Alex');
    expect(screen.getByTestId('result-score').textContent).toContain('10');
    expect(screen.getByTestId('board-svg')).toBeTruthy();
    expect(screen.queryByTestId('required-action-prompt')).toBeNull();
  });

  it('shows an abandoned game as having no winner', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ result: { playerId: null, reason: 'abandoned' } })),
    });
    await openGame(api);
    expect(await screen.findByTestId('result-no-winner')).toBeTruthy();
    expect(screen.queryByTestId('result-winner')).toBeNull();
  });
});

describe('state-level resilience', () => {
  it('records a recovery-blocked condition without inventing a new game', () => {
    const state = initialTableState('en', 'Alex');
    const next = tableReducer(state, {
      type: 'fatal',
      error: { messageId: 'error.E_NETWORK' },
    });
    expect(next.fatal?.messageId).toBe('error.E_NETWORK');
    expect(next.screen).toBe(state.screen);
  });

  it('counts each turn instance separately even when the same player returns', () => {
    const start = initialTableState('en');
    const p1 = tableReducer(start, { type: 'snapshot', snapshot: makeSnapshot(makeView({ turnPlayerId: 'p1' }), 12) });
    expect(p1.turnGeneration).toBe(1);
    const duplicate = tableReducer(p1, { type: 'snapshot', snapshot: makeSnapshot(makeView({ turnPlayerId: 'p1' }), 13) });
    expect(duplicate.turnGeneration).toBe(1);
    const p2 = tableReducer(duplicate, { type: 'snapshot', snapshot: makeSnapshot(makeView({ turnPlayerId: 'p2' }), 13) });
    expect(p2.turnGeneration).toBe(2);
    const back = tableReducer(p2, { type: 'snapshot', snapshot: makeSnapshot(makeView({ turnPlayerId: 'p1' }), 14) });
    expect(back.turnGeneration).toBe(3);
    expect(activeTurnKey(back)).not.toBe(activeTurnKey(p1));
  });

  it('keeps a draft nickname across a locale change but resets nothing else', () => {
    const state = initialTableState('en', '');
    const typed = tableReducer(state, { type: 'draft-nickname', value: '小美' });
    const switched = tableReducer(typed, { type: 'locale', locale: 'zh-Hant' });
    expect(switched.draftNickname).toBe('小美');
    expect(switched.locale).toBe('zh-Hant');
  });

  it('merges streamed events in order and ignores replays', () => {
    const state = initialTableState('en', 'Alex');
    const withGame = tableReducer(state, { type: 'snapshot', snapshot: makeSnapshot(makeView()) });
    const streamed = tableReducer(withGame, {
      type: 'events',
      events: [
        { seq: 13, type: 'turn.rolled', params: { total: 7 } },
        { seq: 14, type: 'robber.moveRequired', params: {} },
      ],
    });
    expect(streamed.game?.view.events).toHaveLength(2);
    const replayed = tableReducer(streamed, {
      type: 'events',
      events: [{ seq: 13, type: 'turn.rolled', params: { total: 7 } }],
    });
    expect(replayed.game?.view.events).toHaveLength(2);
    expect(replayed.game?.revision).toBe(12);
    expect(replayed.game?.view.seq).toBe(12);
  });

  it('does not replace an authoritative projection with old revisions, sequences or generations (E04)', () => {
    const current = makeSnapshot({ ...makeView(), seq: 100 }, 3);
    let state = tableReducer(initialTableState('en'), { type: 'snapshot', snapshot: current });
    state = tableReducer(state, { type: 'game-sync', generation: 2, cause: 'reconnect' });
    for (const snapshot of [makeSnapshot({ ...makeView(), seq: 101 }, 2), makeSnapshot({ ...makeView(), seq: 99 }, 4)]) {
      expect(tableReducer(state, { type: 'snapshot', snapshot, generation: 2 })).toBe(state);
    }
    const otherGame = { ...makeSnapshot(), gameId: 'g2' };
    expect(tableReducer(state, { type: 'snapshot', snapshot: otherGame, generation: 1 })).toBe(state);
    expect(tableReducer(state, { type: 'snapshot', snapshot: otherGame, generation: 2 }).game?.gameId).toBe('g2');
  });

  it('sorts and deduplicates events without deriving revision from their seq or accepting another game', () => {
    const state = tableReducer(initialTableState('en'), { type: 'snapshot', snapshot: makeSnapshot({ ...makeView(), seq: 100 }, 3) });
    const events = [{ seq: 102, type: 'production.resolved', params: {} }, { seq: 101, type: 'turn.rolled', params: {} }, { seq: 102, type: 'production.resolved', params: {} }];
    expect(tableReducer(state, { type: 'events', events, gameId: 'other' })).toBe(state);
    const next = tableReducer(state, { type: 'events', events, gameId: 'g1', revision: 4 });
    expect(next.game?.view.events.map((event) => event.seq)).toEqual([101, 102]);
    expect(next.game?.revision).toBe(4);
    expect(next.game?.view.seq).toBe(100);
  });
});
