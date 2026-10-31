import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CommandRequest } from '@catan/protocol';
import type { Offer } from '@catan/rules';
import { App } from '../src/App.tsx';
import { offerTermsForViewer, tradeShortfall } from '../src/components/TradePanel.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import { makeHints, makeIdentity, makeSnapshot, makeView } from '../src/test/fixtures.ts';

beforeEach(() => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'board-surface') return { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900, toJSON() {} };
    return original.call(this);
  });
});

function renderApp(api: FakeApi) {
  return render(
    <App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />,
  );
}

async function openGame(api: FakeApi, tool?: 'trade' | 'exchange'): Promise<void> {
  renderApp(api);
  fireEvent.click(await screen.findByTestId('resume-g1'));
  await screen.findByTestId('board-svg');
  if (tool) fireEvent.click(screen.getByTestId(`tool-tab-${tool}`));
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
    expect(screen.queryByTestId('consent-offer-1')).toBeNull();
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

    fireEvent.change(screen.getByTestId('monopoly-resource'), { target: { value: 'ore' } });
    fireEvent.focus(screen.getByTestId('hand-panel'));
    fireEvent.click(screen.getByTestId('play-monopoly-0'));

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
