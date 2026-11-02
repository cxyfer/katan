import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CommandRequest, ServerMessage } from '@catan/protocol';
import type { Offer } from '@catan/rules';
import type { SocketLike } from '../src/api/socket.ts';
import { App } from '../src/App.tsx';
import { offerTermsForViewer, tradeShortfall } from '../src/components/TradePanel.tsx';
import { autoDeclineTargets } from '../src/components/useAutoDeclineTrades.ts';
import { memoryStorage, type StorageLike } from '../src/state/session.ts';
import { initialTableState, tableReducer, type TableState } from '../src/state/table.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import { makeHints, makeIdentity, makeSnapshot, makeView } from '../src/test/fixtures.ts';

class TestSocket implements SocketLike {
  open = () => {};
  disconnect = () => {};
  message = (_data: string) => {};
  send() {}
  close() {}
  onOpen(handler: () => void) { this.open = handler; }
  onClose(handler: (info: { code: number; reason: string }) => void) {
    this.disconnect = () => handler({ code: 1006, reason: 'test disconnect' });
  }
  onMessage(handler: (data: string) => void) { this.message = handler; }
  onError() {}
  deliver(message: ServerMessage) { this.message(JSON.stringify(message)); }
}

beforeEach(() => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'board-surface') return { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900, toJSON() {} };
    return original.call(this);
  });
});

function renderApp(api: FakeApi, storage: StorageLike = memoryStorage()) {
  return render(
    <App services={{ api, storage, languages: ['en'], connectSocket: false }} />,
  );
}

async function openGame(api: FakeApi, tool?: 'trade' | 'exchange', storage?: StorageLike): Promise<void> {
  renderApp(api, storage);
  fireEvent.click(await screen.findByTestId('resume-g1'));
  await screen.findByTestId('board-svg');
  if (tool) fireEvent.click(screen.getByTestId(`tool-tab-${tool}`));
}

async function openGameWithSocket(api: FakeApi, sockets: TestSocket[], storage?: StorageLike): Promise<void> {
  render(
    <App
      services={{
        api,
        storage: storage ?? memoryStorage(),
        languages: ['en'],
        socketFactory: () => {
          const socket = new TestSocket();
          sockets.push(socket);
          return socket;
        },
      }}
    />,
  );
  act(() => sockets[0]!.open());
  fireEvent.click(await screen.findByTestId('resume-g1'));
  await screen.findByTestId('board-svg');
}

const ACCEPTED = {
  ok: true as const,
  data: { commandId: 'c', outcome: 'accepted' as const, revision: 13, events: [] },
};

function lastCommand(api: FakeApi): CommandRequest['command'] {
  const calls = api.callsOf('sendCommand');
  return (calls.at(-1)!.args[1] as CommandRequest).command;
}

const openOffer: Offer = {
  id: 'offer-1',
  revision: 1,
  from: 'p2',
  to: 'all',
  give: { wool: 1 },
  want: { ore: 1 },
  windowId: 1,
  status: 'open',
  responses: {},
  agreedWith: null,
  createdSeq: 3,
};

describe('structured trading', () => {
  it('creates an offer from the current terms and audience', async () => {
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ hints: makeHints() })) });
    api.setCommandResult(ACCEPTED);
    await openGame(api, 'trade');

    fireEvent.click(screen.getByTestId('give-add-lumber'));
    fireEvent.click(screen.getByTestId('want-add-brick'));
    fireEvent.change(screen.getByTestId('offer-to'), { target: { value: 'p2' } });
    fireEvent.click(screen.getByTestId('create-offer'));

    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({
      type: 'trade.offer',
      to: 'p2',
      give: { lumber: 1 },
      want: { brick: 1 },
    });
  });

  it('responds to somebody else’s offer with the exact displayed terms', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ hints: makeHints(), offers: [openOffer] })),
    });
    api.setCommandResult(ACCEPTED);
    await openGame(api, 'trade');

    const row = screen.getByTestId('offer-offer-1');
    expect(row.textContent).toContain('Offer from 小美');
    // 被提案方看到的是自己的付出與獲得，不是提案者的視角。
    expect(screen.getByTestId('offer-terms-offer-1').textContent)
      .toBe('You give: 1×Ore · You receive: 1×Wool');
    fireEvent.click(screen.getByTestId('consent-offer-1'));

    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({
      type: 'trade.respond',
      offerId: 'offer-1',
      response: 'consented',
    });
  });

  it('shows a direct offer’s terms as the recipient’s own', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ hints: makeHints(), offers: [{ ...openOffer, to: 'p1' }] })),
    });
    await openGame(api, 'trade');

    expect(screen.getByTestId('offer-terms-offer-1').textContent)
      .toBe('You give: 1×Ore · You receive: 1×Wool');
    expect(screen.getByTestId('decline-offer-1')).toBeTruthy();
    expect(screen.getByTestId('interested-offer-1')).toBeTruthy();
    expect(screen.getByTestId('consent-offer-1')).toBeTruthy();
    // 接受者只同意條件，交換仍由提案者確認（既有的流程邊界）。
    expect(screen.queryByTestId('settle-offer-1')).toBeNull();
  });

  it('names the proposer for a viewer who is not a party to a direct offer', async () => {
    const offer: Offer = { ...openOffer, from: 'p1', to: 'p2' };
    const api = createFakeApi({
      identity: makeIdentity({ id: 'p3', nickname: 'Bo' }),
      snapshot: makeSnapshot(makeView({ hints: makeHints(), offers: [offer] })),
    });
    await openGame(api, 'trade');

    expect(screen.getByTestId('offer-terms-offer-1').textContent)
      .toBe('Alex gives: 1×Wool · Alex receives: 1×Ore');
    // 未被指名的人不能對直送提案回應。
    for (const action of ['decline', 'interested', 'consent']) {
      expect(screen.queryByTestId(`${action}-offer-1`)).toBeNull();
    }
  });

  it('converts stored offer terms to the viewer’s own perspective', () => {
    const offer = { from: 'p2', to: 'p1', give: { wool: 2 }, want: { ore: 1 } };
    expect(offerTermsForViewer(offer, 'p2')).toEqual({ give: { wool: 2 }, want: { ore: 1 } });
    expect(offerTermsForViewer(offer, 'p1')).toEqual({ give: { ore: 1 }, want: { wool: 2 } });
    expect(offerTermsForViewer({ ...offer, to: 'all' }, 'p1')).toEqual({ give: { ore: 1 }, want: { wool: 2 } });
    expect(offerTermsForViewer({ ...offer, to: 'p3' }, 'p1')).toBeNull();
    expect(offerTermsForViewer(offer, null)).toBeNull();
  });

  it('lets the proposer withdraw or settle a consented table-wide offer', async () => {
    const consented: Offer = {
      ...openOffer,
      from: 'p1',
      responses: { p2: 'consented' },
    };
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ hints: makeHints(), offers: [consented] })),
    });
    api.setCommandResult(ACCEPTED);
    await openGame(api, 'trade');

    // 提案者看到的仍是自己的付出與獲得。
    expect(screen.getByTestId('offer-terms-offer-1').textContent)
      .toBe('You give: 1×Wool · You receive: 1×Ore');
    fireEvent.change(screen.getByTestId('counterparty-offer-1'), { target: { value: 'p2' } });
    fireEvent.click(screen.getByTestId('settle-offer-1'));

    // Settlement is irreversible, so it is confirmed against the exact terms.
    const dialog = await screen.findByTestId('settle-dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByTestId('settle-dialog-terms').textContent).toContain('Wool');
    expect(api.callsOf('sendCommand')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('cancel-settle'));
    expect(screen.queryByTestId('settle-dialog')).toBeNull();
    expect(api.callsOf('sendCommand')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('settle-offer-1'));
    fireEvent.click(await screen.findByTestId('confirm-settle'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({
      type: 'trade.settle',
      offerId: 'offer-1',
      counterparty: 'p2',
    });

    fireEvent.click(screen.getByTestId('withdraw-offer-1'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(2));
    expect(lastCommand(api)).toEqual({ type: 'trade.withdraw', offerId: 'offer-1' });
  });

  it('clears the drafted terms while keeping the audience', async () => {
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ hints: makeHints() })) });
    await openGame(api, 'trade');

    const clear = screen.getByTestId('clear-offer');
    expect(clear.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByTestId('give-add-lumber'));
    fireEvent.click(screen.getByTestId('want-add-ore'));
    fireEvent.change(screen.getByTestId('offer-to'), { target: { value: 'p2' } });
    expect(clear.getAttribute('aria-disabled')).toBeNull();
    clear.focus();
    fireEvent.click(clear);

    expect(screen.getByTestId('give-lumber').textContent).toBe('0');
    expect(screen.getByTestId('want-ore').textContent).toBe('0');
    expect((screen.getByTestId('offer-to') as HTMLSelectElement).value).toBe('p2');
    expect(clear.getAttribute('aria-disabled')).toBe('true');
    // 焦點留在按鈕上，鍵盤使用者不會被丟回頁首。
    expect(document.activeElement).toBe(clear);
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });

  it('caps what you give at your own hand and explains why', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    onTestFinished(() => { vi.useRealTimers(); });
    const view = makeView({ hints: makeHints() });
    view.players[0]!.resources = { lumber: 2, brick: 0, wool: 1, grain: 2, ore: 2 };
    const api = createFakeApi({ snapshot: makeSnapshot(view) });
    api.setCommandResult(ACCEPTED);
    await openGame(api, 'trade');

    expect(screen.getByTestId('give-owned-wool').textContent).toBe('Have 1');
    // 想要的一方沒有上限。
    for (let index = 0; index < 4; index++) fireEvent.click(screen.getByTestId('want-add-wool'));
    expect(screen.getByTestId('want-wool').textContent).toBe('4');
    expect(screen.queryByTestId('trade-hint-builder')).toBeNull();

    fireEvent.click(screen.getByTestId('give-add-wool'));
    const add = screen.getByTestId('give-add-wool');
    expect(add.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(add);
    expect(screen.getByTestId('give-wool').textContent).toBe('1');
    const hint = screen.getByTestId('trade-hint-builder');
    expect(hint.getAttribute('role')).toBe('alert');
    expect(hint.textContent).toContain('You only have 1 Wool');

    fireEvent.click(screen.getByTestId('give-add-brick'));
    expect(screen.getByTestId('give-brick').textContent).toBe('0');

    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByTestId('trade-hint-builder')).toBeNull();

    fireEvent.click(screen.getByTestId('create-offer'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({ type: 'trade.offer', to: 'all', give: { wool: 1 }, want: { wool: 4 } });
  });

  it('explains instead of consenting when your hand cannot cover the offer', async () => {
    const view = makeView({
      hints: makeHints(),
      offers: [{ ...openOffer, want: { ore: 3, grain: 1 } }],
    });
    const api = createFakeApi({ snapshot: makeSnapshot(view) });
    api.setCommandResult(ACCEPTED);
    await openGame(api, 'trade');

    const consent = screen.getByTestId('consent-offer-1');
    expect(consent.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(consent);
    const hint = screen.getByTestId('trade-hint-offer-1');
    expect(hint.getAttribute('role')).toBe('alert');
    expect(hint.textContent).toContain('1×Ore');
    expect(hint.textContent).not.toContain('Grain');
    expect(api.callsOf('sendCommand')).toHaveLength(0);

    // 拒絕與表達興趣不需要資源。
    fireEvent.click(screen.getByTestId('interested-offer-1'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({ type: 'trade.respond', offerId: 'offer-1', response: 'interested' });
  });

  it('explains instead of revising into terms the proposer cannot give', async () => {
    const view = makeView({
      hints: makeHints(),
      offers: [{ ...openOffer, from: 'p1', give: { wool: 1 }, want: { ore: 3 } }],
    });
    const api = createFakeApi({ snapshot: makeSnapshot(view) });
    api.setCommandResult(ACCEPTED);
    await openGame(api, 'trade');

    const revise = screen.getByTestId('revise-offer-1');
    expect(revise.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(revise);
    expect(screen.getByTestId('trade-hint-offer-1').textContent).toContain('1×Ore');
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });

  it('computes the shortfall against the visible hand only', () => {
    expect(tradeShortfall({ lumber: 1, ore: 0 }, { lumber: 3, ore: 1, wool: 0 })).toEqual({ lumber: 2, ore: 1 });
    expect(tradeShortfall({ lumber: 3 }, { lumber: 3 })).toBeNull();
    expect(tradeShortfall(undefined, { lumber: 3 })).toBeNull();
  });

  it('does not offer settlement before a counterparty consents', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ hints: makeHints(), offers: [{ ...openOffer, from: 'p1' }] })),
    });
    await openGame(api, 'trade');
    expect(screen.queryByTestId('settle-offer-1')).toBeNull();
  });
});

describe('automatic declines', () => {
  const AUTO_DECLINE_KEY = 'catan.trade.autoDecline';
  // p1 的手牌是每種 2 張，`want: { ore: 3 }` 必然付不出來。
  const unaffordable: Offer = { ...openOffer, want: { ore: 3 } };

  function stateWith(offers: Offer[], overrides: Partial<TableState> = {}): TableState {
    return {
      ...initialTableState('en'),
      session: makeIdentity({ id: 'p1' }),
      game: makeSnapshot(makeView({ hints: makeHints(), offers })),
      tradeAutoDecline: true,
      ...overrides,
    };
  }

  it('declines an open offer the viewer cannot cover when the option is on', async () => {
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ hints: makeHints(), offers: [unaffordable] })) });
    api.setCommandResult(ACCEPTED);
    await openGame(api, 'trade', memoryStorage({ [AUTO_DECLINE_KEY]: 'true' }));

    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({ type: 'trade.respond', offerId: 'offer-1', response: 'declined' });
    expect((screen.getByTestId('trade-auto-decline') as HTMLInputElement).checked).toBe(true);
  });

  it('leaves offers untouched while the option is off', async () => {
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ hints: makeHints(), offers: [unaffordable] })) });
    await openGame(api, 'trade');

    expect((screen.getByTestId('trade-auto-decline') as HTMLInputElement).checked).toBe(false);
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });

  it('remembers the choice in browser storage', async () => {
    const storage = memoryStorage();
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ hints: makeHints() })) });
    await openGame(api, 'trade', storage);

    fireEvent.click(screen.getByTestId('trade-auto-decline'));

    expect(storage.getItem(AUTO_DECLINE_KEY)).toBe('true');
    expect((screen.getByTestId('trade-auto-decline') as HTMLInputElement).checked).toBe(true);
  });

  it('targets only unaffordable offers that are addressed to an unanswered viewer', () => {
    const ids = (offers: Offer[], overrides: Partial<TableState> = {}) =>
      autoDeclineTargets(stateWith(offers, overrides)).map((offer) => offer.id);

    expect(ids([unaffordable])).toEqual(['offer-1']);
    // 付得出來的提案留給玩家自己決定。
    expect(ids([openOffer])).toEqual([]);
    // 自己提出的提案只能撤回，不能拒絕。
    expect(ids([{ ...unaffordable, from: 'p1' }])).toEqual([]);
    // 直送別人的提案與我無關。
    expect(ids([{ ...unaffordable, to: 'p2' }])).toEqual([]);
    // 已經表達過意願的提案，以玩家的明確回應為準。
    expect(ids([{ ...unaffordable, responses: { p1: 'interested' } }])).toEqual([]);
    // 偏好關閉、看不見手牌，或現在不能送指令時都不動作。
    expect(ids([unaffordable], { tradeAutoDecline: false })).toEqual([]);
    expect(ids([unaffordable], { session: makeIdentity({ id: 'p9' }) })).toEqual([]);
    expect(ids([unaffordable], { dicePresenting: true })).toEqual([]);
    expect(ids([unaffordable], { activeElsewhere: true })).toEqual([]);
    expect(ids([unaffordable], { connection: 'reconnecting' })).toEqual([]);
    expect(ids([unaffordable], {
      command: {
        commandId: 'c1',
        labelId: 'play.tradeDecline',
        command: { type: 'trade.respond' },
        status: 'submitting',
        error: null,
        baseRevision: 12,
        revision: null,
      },
    })).toEqual([]);
    // 上一輪視窗留下的提案不再代為回應。
    expect(ids([{ ...unaffordable, windowId: 0 }])).toEqual([]);
  });

  it('declines again after the proposer revises the terms', async () => {
    const sockets: TestSocket[] = [];
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ hints: makeHints(), offers: [unaffordable] })) });
    api.setCommandResult(ACCEPTED);
    await openGameWithSocket(api, sockets, memoryStorage({ [AUTO_DECLINE_KEY]: 'true' }));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));

    // 改版會清空回應，新的條款仍然付不出來 → 再拒絕一次。
    const revised = makeSnapshot(
      makeView({ hints: makeHints(), offers: [{ ...unaffordable, revision: 2, want: { grain: 3 } }] }),
      13,
    );
    revised.view.seq = 13;
    act(() => sockets[0]!.deliver({ type: 'snapshot', payload: revised }));

    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(2));
    expect(lastCommand(api)).toEqual({ type: 'trade.respond', offerId: 'offer-1', response: 'declined' });
  });

  it('retries after a stale receipt once the projection catches up', async () => {
    const sockets: TestSocket[] = [];
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ hints: makeHints(), offers: [unaffordable] })) });
    // 另一位收件者同時拒絕了同一個桌級提案：伺服器以過期回絕這一筆。
    api.setCommandResult({
      ok: true,
      data: {
        commandId: 'c1',
        outcome: 'rejected',
        revision: 13,
        error: { messageId: 'error.E_STALE_REVISION' },
        events: [],
      },
    });
    await openGameWithSocket(api, sockets, memoryStorage({ [AUTO_DECLINE_KEY]: 'true' }));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));

    api.setCommandResult(ACCEPTED);
    const fresh = makeSnapshot(makeView({ hints: makeHints(), offers: [unaffordable] }), 13);
    fresh.view.seq = 13;
    act(() => sockets[0]!.deliver({ type: 'snapshot', payload: fresh }));

    // 過期回執不能永久占位：投影更新後要再用新的 revision 重送。
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(2));
    expect(lastCommand(api)).toEqual({ type: 'trade.respond', offerId: 'offer-1', response: 'declined' });
    expect(api.callsOf('sendCommand')[1]!.args[1]).toMatchObject({ expectedRevision: 13 });
  });
});

describe('bank and harbour exchange', () => {
  it('shows the viewer’s own rate and submits the exchange', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(
        makeView({
          hints: makeHints({ bankRates: { lumber: 2, brick: 4, wool: 4, grain: 4, ore: 4 } }),
        }),
      ),
    });
    api.setCommandResult(ACCEPTED);
    await openGame(api, 'exchange');

    fireEvent.change(screen.getByTestId('bank-give'), { target: { value: 'lumber' } });
    fireEvent.change(screen.getByTestId('bank-receive'), { target: { value: 'ore' } });
    expect(screen.getByTestId('bank-rate').textContent).toContain('2:1');

    fireEvent.click(screen.getByTestId('bank-submit'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({ type: 'trade.bank', give: 'lumber', receive: 'ore' });
  });

  it('refuses an exchange of the same resource client-side', async () => {
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ hints: makeHints() })) });
    await openGame(api, 'exchange');
    fireEvent.change(screen.getByTestId('bank-give'), { target: { value: 'wool' } });
    fireEvent.change(screen.getByTestId('bank-receive'), { target: { value: 'wool' } });
    expect((screen.getByTestId('bank-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Choose two different resources.')).toBeTruthy();
  });
});

describe('separate trade and exchange tools', () => {
  it.each([1280, 390, 320])('keeps separate drafts and side-by-side term groups at viewport %s', async (width) => {
    const previousWidth = window.innerWidth;
    window.innerWidth = width;
    try {
      const api = createFakeApi({ snapshot: makeSnapshot(makeView({ hints: makeHints() })) });
      await openGame(api, 'trade');

      const trade = screen.getByTestId('trade-panel');
      const exchange = screen.getByTestId('exchange-panel');
      expect(within(trade).getByRole('heading', { level: 2, name: 'Trading' }).classList.contains('visually-hidden')).toBe(true);
      const terms = within(trade).getByTestId('trade-terms');
      expect(Array.from(terms.children)).toEqual([
        screen.getByTestId('trade-terms-give'),
        screen.getByTestId('trade-terms-want'),
      ]);
      expect(within(terms).getAllByRole('group')).toHaveLength(2);
      expect(within(trade).queryByTestId('bank-submit')).toBeNull();
      expect(within(exchange).queryByTestId('create-offer')).toBeNull();
      expect(screen.getByTestId('tool-panel-exchange').hidden).toBe(true);

      fireEvent.click(screen.getByTestId('give-add-wool'));
      fireEvent.click(screen.getByTestId('give-add-wool'));
      fireEvent.click(screen.getByTestId('want-add-grain'));
      fireEvent.change(screen.getByTestId('offer-to'), { target: { value: 'p2' } });
      fireEvent.click(screen.getByTestId('tool-tab-exchange'));
      expect(screen.getByTestId('tool-panel-trade').hidden).toBe(true);
      expect(screen.getByTestId('tool-panel-exchange').hidden).toBe(false);
      fireEvent.change(screen.getByTestId('bank-give'), { target: { value: 'ore' } });
      fireEvent.change(screen.getByTestId('bank-receive'), { target: { value: 'wool' } });
      fireEvent.click(screen.getByTestId('tool-close'));
      expect(document.activeElement).toBe(screen.getByTestId('tool-tab-exchange'));
      fireEvent.click(screen.getByTestId('tool-tab-exchange'));
      expect((screen.getByTestId('bank-give') as HTMLSelectElement).value).toBe('ore');
      expect((screen.getByTestId('bank-receive') as HTMLSelectElement).value).toBe('wool');

      fireEvent.change(screen.getByTestId('locale-switch-game'), { target: { value: 'zh-Hant' } });
      expect(screen.getByTestId('tool-tab-exchange').getAttribute('aria-label')).toBe('兌換');
      expect(screen.getByTestId('tool-tab-trade').getAttribute('aria-label')).toBe('交易');
      fireEvent.click(screen.getByTestId('tool-tab-trade'));
      expect(screen.getByTestId('give-wool').textContent).toBe('2');
      expect(screen.getByTestId('want-grain').textContent).toBe('1');
      expect((screen.getByTestId('offer-to') as HTMLSelectElement).value).toBe('p2');
      expect(screen.getByTestId('give-wool').getAttribute('aria-label')).toBe('你付出 羊毛');
      expect(api.callsOf('sendCommand')).toHaveLength(0);
    } finally {
      window.innerWidth = previousWidth;
    }
  });

  it('includes exchange in keyboard navigation and returns focus after Escape', async () => {
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ hints: makeHints() })) });
    await openGame(api);
    const trade = screen.getByTestId('tool-tab-trade');
    const exchange = screen.getByTestId('tool-tab-exchange');
    trade.focus();
    fireEvent.keyDown(trade, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(exchange);
    fireEvent.click(exchange);
    expect(screen.getByTestId('tool-panel-exchange').hidden).toBe(false);
    fireEvent.keyDown(screen.getByTestId('bank-give'), { key: 'Escape' });
    expect(exchange.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(exchange);
    fireEvent.keyDown(exchange, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('tool-tab-help'));
  });
});

describe('development cards and pending effects', () => {
  it('submits a monopoly with the chosen resource', async () => {
    const view = makeView({
      hints: makeHints({ canEndTurn: false }),
      phase: 'preroll',
    });
    view.players[0]!.devCards = ['monopoly'];
    const api = createFakeApi({ snapshot: makeSnapshot(view) });
    api.setCommandResult(ACCEPTED);
    await openGame(api);

    fireEvent.focus(screen.getByTestId('hand-panel'));
    fireEvent.click(screen.getByTestId('play-monopoly-0'));
    fireEvent.click(screen.getByTestId('choice-add-ore'));
    fireEvent.click(screen.getByTestId('choice-submit'));

    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({ type: 'dev.playMonopoly', resource: 'ore' });
  });

  it('arms a hex target when a knight is played', async () => {
    const view = makeView({ hints: makeHints({ canEndTurn: false }), phase: 'preroll' });
    view.players[0]!.devCards = ['knight'];
    const api = createFakeApi({ snapshot: makeSnapshot(view) });
    await openGame(api);

    fireEvent.focus(screen.getByTestId('hand-panel'));
    fireEvent.click(screen.getByTestId('play-knight-0'));
    const target = await screen.findByTestId('target-hex-0');
    expect(target.tagName).toBe('BUTTON');
  });

  it('plays year of plenty only after both resources are chosen, then takes them in order', async () => {
    const view = makeView({ hints: makeHints({ canEndTurn: false }), phase: 'preroll' });
    view.players[0]!.devCards = ['yearOfPlenty'];
    const api = createFakeApi({ snapshot: makeSnapshot(view) });
    api.setCommandResult(ACCEPTED);
    await openGame(api);

    fireEvent.focus(screen.getByTestId('hand-panel'));
    fireEvent.click(screen.getByTestId('play-yearOfPlenty-0'));
    expect(screen.getByTestId('required-action-prompt').dataset.choice).toBe('yearOfPlenty');
    fireEvent.click(screen.getByTestId('choice-add-ore'));
    fireEvent.click(screen.getByTestId('choice-add-ore'));
    expect(screen.getByTestId('choice-add-wool').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByTestId('choice-return-ore'));
    fireEvent.click(screen.getByTestId('choice-add-wool'));
    expect(api.callsOf('sendCommand')).toHaveLength(0);

    // 伺服器打出後進入領取步驟；客戶端依序送出已選好的兩張。
    const played = structuredClone(view);
    played.players[0]!.devCards = [];
    played.turn.devCardPlayed = true;
    played.pending = { kind: 'yearOfPlenty', actor: 'p1', remaining: 2 };
    api.setSnapshot(makeSnapshot(played, 13));
    fireEvent.click(screen.getByTestId('choice-submit'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(3), { timeout: 5000 });
    const commands = api.callsOf('sendCommand').map((call) => (call.args[1] as CommandRequest).command);
    expect(commands).toEqual([
      { type: 'dev.playYearOfPlenty' },
      { type: 'pending.takeResource', resource: 'wool' },
      { type: 'pending.takeResource', resource: 'ore' },
    ]);
  });

  it('offers a locked, bank-limited picker when year of plenty is already waiting', async () => {
    const view = makeView({
      hints: null,
      pending: { kind: 'yearOfPlenty', actor: 'p1', remaining: 1 },
    });
    view.bank = { lumber: 0, brick: 0, wool: 0, grain: 1, ore: 0 };
    const api = createFakeApi({ snapshot: makeSnapshot(view) });
    api.setCommandResult(ACCEPTED);
    await openGame(api);

    expect(screen.queryByTestId('choice-cancel')).toBeNull();
    expect(screen.getByTestId('choice-add-ore').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('choice-bank-grain').textContent).toBe('1');
    fireEvent.click(screen.getByTestId('choice-add-grain'));
    fireEvent.click(screen.getByTestId('choice-submit'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({ type: 'pending.takeResource', resource: 'grain' });
  });

  it('plays a card dragged out of the hand onto the table, and returns it when dropped back on the hand', async () => {
    const view = makeView({ hints: makeHints({ canEndTurn: false }), phase: 'preroll' });
    view.players[0]!.devCards = ['roadBuilding', 'monopoly'];
    const api = createFakeApi({ snapshot: makeSnapshot(view) });
    api.setCommandResult(ACCEPTED);
    await openGame(api);
    const pointer = (element: Element, type: string, clientY: number, buttons = type === 'pointerup' ? 0 : 1) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 50, clientY, button: 0, buttons });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' }, isPrimary: { value: true } });
      fireEvent(element, event);
    };
    const drag = (element: Element, to: number) => {
      pointer(element, 'pointerdown', 0);
      pointer(element, 'pointermove', -40);
      pointer(element, 'pointermove', to);
      return () => pointer(element, 'pointerup', to);
    };

    // 手牌上緣在 jsdom 為 0：只拖一點點（仍在手牌範圍）放開，卡片回到手上。
    const monopoly = screen.getByRole('button', { name: /Inspect Monopoly/ });
    const short = drag(monopoly, -10);
    expect(screen.getByTestId('card-drag').dataset.armed).toBeUndefined();
    short();
    expect(screen.queryByTestId('card-drag')).toBeNull();
    expect(screen.queryByTestId('devcard-choice')).toBeNull();

    // 判定線之上但只往上拖了一點（浮起的卡頂端本來就高過手牌）：不算打出。
    drag(monopoly, -30);
    expect(screen.getByTestId('card-drag').dataset.armed).toBeUndefined();
    pointer(monopoly, 'pointerup', -30);
    expect(screen.queryByTestId('devcard-choice')).toBeNull();

    // 在卡外放開滑鼠時收不到 pointerup：之後沒按鍵的移動不能自己拖起來。
    pointer(monopoly, 'pointerdown', 0);
    pointer(monopoly, 'pointermove', -200, 0);
    expect(screen.queryByTestId('card-drag')).toBeNull();

    // 先拖到桌面（已可使用）再拖回手牌放開，同樣取消。
    drag(monopoly, -200);
    expect(screen.getByTestId('card-drag').dataset.armed).toBe('true');
    pointer(monopoly, 'pointermove', -10);
    expect(screen.getByTestId('card-drag').dataset.armed).toBeUndefined();
    expect(screen.getByTestId('card-drag-hint').textContent).toBe('Drag onto the table to play');
    pointer(monopoly, 'pointerup', -10);
    expect(screen.queryByTestId('card-drag')).toBeNull();
    expect(screen.queryByTestId('devcard-choice')).toBeNull();

    const release = drag(monopoly, -200);
    expect(screen.getByTestId('card-drag').dataset.armed).toBe('true');
    expect(screen.getByTestId('card-drag-hint').textContent).toBe('Release to play Monopoly');
    release();
    expect(screen.queryByTestId('card-drag')).toBeNull();
    expect(screen.getByTestId('devcard-choice').dataset.card).toBe('monopoly');
    expect(api.callsOf('sendCommand')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('choice-cancel'));

    drag(screen.getByRole('button', { name: /Inspect Road building/ }), -200)();
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({ type: 'dev.playRoadBuilding' });
  });

  it('keeps year of plenty out of play while the bank is empty', async () => {
    const view = makeView({ hints: makeHints({ canEndTurn: false }), phase: 'preroll' });
    view.players[0]!.devCards = ['yearOfPlenty', 'knight'];
    view.bank = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    await openGame(createFakeApi({ snapshot: makeSnapshot(view) }));

    expect((screen.getByTestId('play-yearOfPlenty-0') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Inspect Year of plenty/ }).closest('li')!.dataset.draggable).toBeUndefined();
    expect(screen.getByRole('button', { name: /Inspect Knight/ }).closest('li')!.dataset.draggable).toBe('true');
  });

  it('stops the queued year of plenty picks when a take is rejected, leaving the picker usable', async () => {
    const view = makeView({ hints: null, pending: { kind: 'yearOfPlenty', actor: 'p1', remaining: 1 } });
    const api = createFakeApi({ snapshot: makeSnapshot(view) });
    api.setCommandResult({
      ok: true,
      data: { commandId: 'c1', outcome: 'rejected', revision: 12, error: { messageId: 'error.E_BANK_EMPTY' }, events: [] },
    });
    await openGame(api);

    fireEvent.click(screen.getByTestId('choice-add-grain'));
    fireEvent.click(screen.getByTestId('choice-submit'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    await waitFor(() => expect((screen.getByTestId('choice-submit') as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId('choice-submit').textContent).toBe('Take Grain');
  });

  it('drops an unfinished resource choice when the table switches games or leaves the room', () => {
    const base: TableState = {
      ...initialTableState('en'),
      game: makeSnapshot(makeView()),
      devCardChoice: { card: 'monopoly', queued: [] },
    };
    expect(tableReducer(base, { type: 'snapshot', snapshot: makeSnapshot(makeView(), 13) }).devCardChoice).not.toBeNull();
    expect(tableReducer(base, { type: 'snapshot', snapshot: { ...makeSnapshot(makeView()), gameId: 'g2' } }).devCardChoice).toBeNull();
    expect(tableReducer(base, { type: 'snapshot', snapshot: null }).devCardChoice).toBeNull();
    expect(tableReducer(base, { type: 'room', room: null }).devCardChoice).toBeNull();
  });

  it('submits exactly the required discard count', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(
        makeView({
          hints: null,
          pending: { kind: 'discard', required: { p1: 2 }, waitingFor: ['p1'] },
        }),
      ),
    });
    api.setCommandResult(ACCEPTED);
    await openGame(api);

    expect(screen.getByTestId('discard-submit').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('discard-add-wool'));
    fireEvent.click(screen.getByTestId('discard-add-grain'));
    expect(screen.getByTestId('discard-counts').textContent).toContain('2');
    fireEvent.click(screen.getByTestId('discard-submit'));

    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({ type: 'pending.discard', resources: ['wool', 'grain'] });
  });

  it('moves cards between the hand and the discard pile, capped by the hand and the quota', async () => {
    const view = makeView({
      hints: null,
      pending: { kind: 'discard', required: { p1: 4 }, waitingFor: ['p1'] },
    });
    view.players[0]!.resources = { lumber: 1, brick: 2, wool: 3, grain: 2, ore: 0 };
    const api = createFakeApi({ snapshot: makeSnapshot(view) });
    api.setCommandResult(ACCEPTED);
    await openGame(api);

    const left = (resource: string) => screen.getByTestId(`discard-left-${resource}`).textContent;
    const card = (resource: string) => screen.getByTestId(`discard-add-${resource}`);
    const counts = () => screen.getByTestId('discard-counts').textContent;
    const submit = () => screen.getByTestId('discard-submit') as HTMLButtonElement;

    // 五種資源一律列出：沒有的礦石也在，只是不能選。
    expect(left('ore')).toBe('0');
    expect(card('ore').getAttribute('aria-disabled')).toBe('true');
    expect(left('wool')).toBe('3');
    expect(counts()).toBe('0 / 4');
    expect(screen.getByTestId('discard-after').textContent).toBe('8 left after discarding');
    expect(submit().disabled).toBe(true);
    expect(submit().textContent).toBe('Pick 4 more');

    // 木材只有一張：移到棄牌區後手上變 0，再點也不會多選。
    fireEvent.click(card('lumber'));
    expect(left('lumber')).toBe('0');
    expect(card('lumber').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(card('lumber'));
    expect(counts()).toBe('1 / 4');
    expect(screen.getByTestId('discard-picked-lumber').textContent).toBe('×1');

    // 點棄牌區的那疊放回手牌；最後一張放回後焦點落回該資源的手牌。
    fireEvent.click(screen.getByTestId('discard-return-lumber'));
    expect(left('lumber')).toBe('1');
    expect(counts()).toBe('0 / 4');
    expect(screen.queryByTestId('discard-return-lumber')).toBeNull();
    expect(document.activeElement).toBe(card('lumber'));

    // 同一種資源疊成一疊；放回只退一張，這疊還在時焦點留在原處。
    fireEvent.click(card('brick'));
    fireEvent.click(card('brick'));
    expect(left('brick')).toBe('0');
    expect(screen.getByTestId('discard-picked-brick').textContent).toBe('×2');
    const brickStack = screen.getByTestId('discard-return-brick');
    expect(brickStack.getAttribute('aria-label')).toBe('2 Brick in the discard pile; take one back');
    brickStack.focus();
    fireEvent.click(brickStack);
    expect(left('brick')).toBe('1');
    expect(counts()).toBe('1 / 4');
    expect(screen.getByTestId('discard-picked-brick').textContent).toBe('×1');
    expect(document.activeElement).toBe(screen.getByTestId('discard-return-brick'));

    fireEvent.click(card('brick'));
    fireEvent.click(card('lumber'));
    fireEvent.click(card('wool'));
    expect(counts()).toBe('4 / 4');
    expect(screen.getByTestId('discard-after').textContent).toBe('4 left after discarding');
    // 選滿後其他資源也不能再加。
    expect(card('grain').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(card('grain'));
    expect(left('grain')).toBe('2');
    expect(submit().disabled).toBe(false);
    expect(submit().textContent).toBe('Discard 4');

    // 一疊放完時焦點移到右邊的下一疊（木材 → 磚塊）。
    fireEvent.click(screen.getByTestId('discard-return-lumber'));
    expect(document.activeElement).toBe(screen.getByTestId('discard-return-brick'));
    fireEvent.click(card('lumber'));

    // 「全部放回」清空棄牌區。
    fireEvent.click(screen.getByTestId('discard-reset'));
    expect(counts()).toBe('0 / 4');
    expect(left('wool')).toBe('3');
    for (const resource of ['wool', 'wool', 'brick', 'lumber']) fireEvent.click(card(resource));
    fireEvent.click(submit());

    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({
      type: 'pending.discard',
      resources: ['lumber', 'brick', 'wool', 'wool'],
    });
  });

  it('clears the picker and live announcement after I submit', async () => {
    const sockets: TestSocket[] = [];
    const pending = {
      kind: 'discard' as const,
      required: { p1: 2, p2: 3 },
      waitingFor: ['p1', 'p2'],
    };
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ hints: null, pending })),
    });
    api.setCommandResult(ACCEPTED);
    await openGameWithSocket(api, sockets);

    expect(screen.getByTestId('required-action-prompt').getAttribute('data-mine')).toBe('true');
    await waitFor(() => expect(screen.getByTestId('live-region').textContent).toContain('Discard'));

    fireEvent.click(screen.getByTestId('discard-add-wool'));
    fireEvent.click(screen.getByTestId('discard-add-grain'));
    fireEvent.click(screen.getByTestId('discard-submit'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));

    // p1 still appears in `required` (the effect's original set) but leaves
    // `waitingFor` once the authoritative snapshot reports the submission.
    const waiting = makeSnapshot(
      makeView({ hints: null, pending: { ...pending, waitingFor: ['p2'] } }),
      13,
    );
    waiting.view.seq = 13;
    act(() => sockets[0]!.deliver({ type: 'snapshot', payload: waiting }));

    await waitFor(() => {
      expect(screen.getByTestId('required-action-prompt').getAttribute('data-mine')).toBe('false');
    });
    const prompt = screen.getByTestId('required-action-prompt');
    expect(prompt.textContent).toContain('Waiting for other players to discard');
    expect(screen.getByTestId('prompt-waiting').textContent).toBe('Waiting for 小美 (3)');
    expect(screen.queryByTestId('prompt-waiting')).not.toBeNull();
    expect(screen.queryByTestId('discard-submit')).toBeNull();
    expect(screen.queryByTestId('discard-add-lumber')).toBeNull();
    expect(screen.getByTestId('live-region').textContent).toBe('');
  });

  it('lets the thief pick a victim from the engine’s candidate list', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(
        makeView({
          hints: null,
          pending: { kind: 'steal', actor: 'p1', hex: 4, candidates: ['p2'] },
        }),
      ),
    });
    api.setCommandResult(ACCEPTED);
    await openGame(api);

    fireEvent.click(await screen.findByTestId('steal-p2'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({ type: 'pending.steal', victim: 'p2' });
  });
});
