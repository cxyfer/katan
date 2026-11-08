import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Offer } from '@catan/rules';
import type { RoomView } from '@catan/protocol';
import { App } from '../src/App.tsx';
import { boardIntent } from '../src/board/intent.ts';
import { ExchangePanel } from '../src/components/ExchangePanel.tsx';
import { TradePanel } from '../src/components/TradePanel.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { deriveActions } from '../src/state/actions.ts';
import { requiredActionAnnouncement, requiredActionFor } from '../src/state/pending.ts';
import { memoryStorage } from '../src/state/session.ts';
import { EMPTY_SELECTION, followUpsHeld, initialTableState, tableReducer, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import { makeHints, makeMember, makeResumable, makeRoom, makeSnapshot, makeView } from '../src/test/fixtures.ts';

/** 全桌保存並暫停（SPEC §4.8）時，牌桌不提示待辦動作、所有遊戲指令入口都停用（#142）。 */

const PAUSED_REASON = 'The game is paused until everyone is ready to continue.';

function duoRoom(status: RoomView['status']): RoomView {
  return makeRoom({
    status,
    gameId: 'g1',
    members: [makeMember(), makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', host: false, connected: false })],
    resumeReady: [],
  });
}

function stateWith(overrides: Partial<TableState> = {}): TableState {
  const base = initialTableState('en', 'Alex');
  return {
    ...base,
    bootstrapped: true,
    session: { id: 'p1', nickname: 'Alex', locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' },
    screen: 'game',
    room: duoRoom('suspended'),
    ...overrides,
  };
}

describe('required action on a suspended table', () => {
  it('owes nothing, whatever the paused game was waiting for', () => {
    const views = [
      makeView({ phase: 'preroll', hints: makeHints({ canRoll: true, canEndTurn: false }) }),
      makeView({ hints: makeHints({ canEndTurn: true }) }),
      makeView({ pending: { kind: 'discard', required: { p1: 2 }, waitingFor: ['p1'] } }),
      makeView({ pending: { kind: 'moveRobber', actor: 'p1', cause: 'seven' } }),
      makeView({ setup: { seat: 0, stage: 'building', round: 1, remaining: 8 } }),
      makeView({ turnPlayerId: 'p2' }),
    ];
    for (const view of views) {
      const action = requiredActionFor(stateWith({ game: makeSnapshot(view) }));
      expect(action).toMatchObject({ kind: 'suspended', mine: false, waitingFor: [], messageId: 'play.suspendedBar.title' });
      expect(requiredActionAnnouncement(action, (id) => id)).toBeNull();
    }
  });

  it('is unchanged while the room is playing', () => {
    const game = makeSnapshot(makeView({ phase: 'preroll', hints: makeHints({ canRoll: true, canEndTurn: false }) }));
    expect(requiredActionFor(stateWith({ game, room: duoRoom('playing') }))).toMatchObject({ kind: 'roll', mine: true });
  });

  it('still reports a finished game as nothing to do', () => {
    const game = makeSnapshot(makeView({ result: { playerId: 'p1', reason: 'victory', score: 10 } }));
    expect(requiredActionFor(stateWith({ game }))).toBeNull();
  });
});

describe('actions on a suspended table', () => {
  it('disables every action with the paused reason', () => {
    const game = makeSnapshot(makeView({
      hints: makeHints({ canEndTurn: true, legalRoads: [3], legalSettlements: [4], legalCities: [5] }),
    }));
    const playing = deriveActions(stateWith({ game, room: duoRoom('playing') }), 'p1');
    expect(playing.find((action) => action.id === 'endTurn')).toMatchObject({ enabled: true, reasonId: null });

    const paused = deriveActions(stateWith({ game }), 'p1');
    expect(paused.length).toBeGreaterThan(0);
    for (const action of paused) {
      expect(action).toMatchObject({ enabled: false, reasonId: 'play.disabled.suspended' });
    }
  });

  it('does not offer roll either', () => {
    const game = makeSnapshot(makeView({ phase: 'preroll', hints: makeHints({ canRoll: true, canEndTurn: false }) }));
    expect(deriveActions(stateWith({ game }), 'p1').find((action) => action.id === 'roll')).toMatchObject({
      enabled: false,
      reasonId: 'play.disabled.suspended',
    });
  });

  it('holds follow-ups and offers no board targets, even for an armed build', () => {
    const game = makeSnapshot(makeView({
      hints: makeHints({ legalRoads: [3] }),
      pending: { kind: 'moveRobber', actor: 'p1', cause: 'seven' },
    }));
    const paused = stateWith({ game });
    expect(followUpsHeld(paused)).toBe(true);
    expect(boardIntent(paused, 'p1')).toBeNull();
    const armed = stateWith({ game, selection: { ...EMPTY_SELECTION, kind: 'edge', commandType: 'build.road', labelId: 'play.build.road' } });
    expect(boardIntent(armed, 'p1')).toBeNull();
    expect(followUpsHeld(stateWith({ game, room: duoRoom('playing') }))).toBe(false);
    expect(boardIntent(stateWith({ game, room: duoRoom('playing') }), 'p1')).not.toBeNull();
  });

  it('drops a board selection when the room becomes suspended', () => {
    const game = makeSnapshot(makeView({ hints: makeHints({ legalRoads: [3] }) }));
    const selection = { ...EMPTY_SELECTION, kind: 'edge' as const, index: 3, commandType: 'build.road', labelId: 'play.build.road' };
    const playing = stateWith({ game, room: duoRoom('playing'), selection });
    expect(tableReducer(playing, { type: 'room', room: duoRoom('playing') }).selection).toBe(selection);
    expect(tableReducer(playing, { type: 'room', room: duoRoom('suspended') }).selection).toEqual(EMPTY_SELECTION);
  });
});

function controllerFor(state: TableState, submit = vi.fn()): TableController {
  return {
    state,
    dispatch: () => undefined,
    actions: { submitCommand: submit, setTradeAutoDecline: () => undefined } as unknown as TableController['actions'],
  };
}

describe('trade and exchange on a suspended table', () => {
  it('disables new offers and bank trades, with the reason', () => {
    const submit = vi.fn();
    const controller = controllerFor(stateWith({ game: makeSnapshot(makeView()) }), submit);
    render(
      <LocaleProvider locale="en">
        <TradePanel controller={controller} />
        <ExchangePanel controller={controller} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByTestId('give-add-lumber'));
    expect(screen.getByTestId('create-offer').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('bank-submit').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('trade-suspended').textContent).toBe(PAUSED_REASON);
    expect(screen.getByTestId('bank-suspended').textContent).toBe(PAUSED_REASON);
    fireEvent.click(screen.getByTestId('create-offer'));
    fireEvent.click(screen.getByTestId('bank-submit'));
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps them available while the room is playing', () => {
    const controller = controllerFor(stateWith({ game: makeSnapshot(makeView()), room: duoRoom('playing') }));
    render(
      <LocaleProvider locale="en">
        <TradePanel controller={controller} />
        <ExchangePanel controller={controller} />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('create-offer').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('bank-submit').hasAttribute('disabled')).toBe(false);
    expect(screen.queryByTestId('trade-suspended')).toBeNull();
    expect(screen.queryByTestId('bank-suspended')).toBeNull();
  });
});

describe('the table while suspended', () => {
  beforeEach(() => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'board-surface') return { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900, toJSON() {} };
      return original.call(this);
    });
  });

  async function enterTable(api: FakeApi): Promise<void> {
    render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
    fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
    fireEvent.click(screen.getByTestId('join-room'));
    await screen.findByTestId('board-svg', {}, { timeout: 8000 });
  }

  it('shows the resume banner instead of the turn prompt and disables the action bar', async () => {
    const api = createFakeApi({
      room: duoRoom('suspended'),
      snapshot: makeSnapshot(makeView({ phase: 'preroll', hints: makeHints({ canRoll: true, canEndTurn: false }) })),
    });
    await enterTable(api);
    expect(screen.getByTestId('resume-bar')).toBeTruthy();
    expect(screen.queryByTestId('required-action-prompt')).toBeNull();
    expect(screen.queryByTestId('prompt-roll')).toBeNull();
    expect(screen.getByTestId('action-roll').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('reason-roll').textContent).toBe(PAUSED_REASON);
    expect(screen.getByTestId('action-endTurn').hasAttribute('disabled')).toBe(true);
    for (const state of screen.getAllByTestId('turn-state')) {
      expect(state.getAttribute('data-mine')).toBe('false');
      expect(state.textContent).toContain('Game saved and paused');
    }
    expect(screen.queryAllByTestId(/^target-/)).toHaveLength(0);
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });

  /** 從首頁的可續玩清單開啟 g1（房間尚未載入，也沒有 WebSocket 推送）。 */
  async function resumeFromHome(api: FakeApi): Promise<void> {
    render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
    fireEvent.click(await screen.findByTestId('resume-g1'));
    await screen.findByTestId('board-svg', {}, { timeout: 8000 });
  }

  const staleOffer: Offer = {
    id: 'o1', revision: 1, from: 'p2', to: 'all', give: { lumber: 1 }, want: { brick: 1 },
    windowId: 1, status: 'open', responses: {}, agreedWith: null, createdSeq: 1,
  };

  it('holds a suspended game opened from the resume list before its room arrives', async () => {
    const api = createFakeApi({
      games: [makeResumable({ status: 'suspended' })],
      snapshot: makeSnapshot(makeView({ hints: makeHints({ canEndTurn: true, legalRoads: [3] }), offers: [staleOffer] })),
    });
    // 房間一直沒有回來：只靠清單已知的暫停狀態。
    vi.spyOn(api, 'getRoom').mockReturnValue(new Promise(() => undefined));
    await resumeFromHome(api);
    expect(screen.queryByTestId('required-action-prompt')).toBeNull();
    expect(screen.getByTestId('action-endTurn').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('reason-endTurn').textContent).toBe(PAUSED_REASON);
    expect(screen.queryAllByTestId(/^target-/)).toHaveLength(0);
    fireEvent.click(screen.getByTestId('tool-tab-trade'));
    expect(screen.getByTestId('create-offer').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('consent-o1'));
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toContain(PAUSED_REASON));
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });

  it('loads the room of a game opened from the resume list, so the resume banner shows without a push', async () => {
    const api = createFakeApi({
      games: [makeResumable({ status: 'suspended' })],
      room: duoRoom('suspended'),
      snapshot: makeSnapshot(makeView()),
    });
    await resumeFromHome(api);
    expect(await screen.findByTestId('resume-bar')).toBeTruthy();
    expect(api.callsOf('getRoom').map((call) => call.args)).toContainEqual(['r1']);
    expect(screen.getByTestId('action-endTurn').hasAttribute('disabled')).toBe(true);
  });

  it('keeps an interrupted game playable at once while its room is still loading', async () => {
    const api = createFakeApi({
      games: [makeResumable({ status: 'playing' })],
      snapshot: makeSnapshot(makeView({ hints: makeHints({ canEndTurn: true }) })),
    });
    vi.spyOn(api, 'getRoom').mockReturnValue(new Promise(() => undefined));
    await resumeFromHome(api);
    expect(screen.getByTestId('action-endTurn').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('prompt-end-turn')).toBeTruthy();
    fireEvent.click(screen.getByTestId('prompt-end-turn'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
  });

  it('refuses a command from a stale entry locally instead of sending it', async () => {
    // 暫停時伺服器會讓提案過期，但房間推送可能早於投影：殘留的提案按鈕不送出指令。
    const offer: Offer = {
      id: 'o1', revision: 1, from: 'p2', to: 'all', give: { lumber: 1 }, want: { brick: 1 },
      windowId: 1, status: 'open', responses: {}, agreedWith: null, createdSeq: 1,
    };
    const api = createFakeApi({
      room: duoRoom('suspended'),
      snapshot: makeSnapshot(makeView({ offers: [offer] })),
    });
    await enterTable(api);
    fireEvent.click(screen.getByTestId('tool-tab-trade'));
    fireEvent.click(await screen.findByTestId('consent-o1'));
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toContain(PAUSED_REASON));
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });
});
