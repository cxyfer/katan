import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CommandRequest } from '@catan/protocol';
import type { Offer } from '@catan/rules';
import { App } from '../src/App.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import { makeHints, makeSnapshot, makeView } from '../src/test/fixtures.ts';

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

async function openGame(api: FakeApi): Promise<void> {
  renderApp(api);
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
    await openGame(api);

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
    await openGame(api);

    const row = screen.getByTestId('offer-offer-1');
    expect(row.textContent).toContain('Offer from 小美');
    expect(row.textContent).toContain('Wool');
    fireEvent.click(screen.getByTestId('consent-offer-1'));

    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({
      type: 'trade.respond',
      offerId: 'offer-1',
      response: 'consented',
    });
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
    await openGame(api);

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

  it('does not offer settlement before a counterparty consents', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ hints: makeHints(), offers: [{ ...openOffer, from: 'p1' }] })),
    });
    await openGame(api);
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
    await openGame(api);

    fireEvent.change(screen.getByTestId('bank-give'), { target: { value: 'lumber' } });
    fireEvent.change(screen.getByTestId('bank-receive'), { target: { value: 'ore' } });
    expect(screen.getByTestId('bank-rate').textContent).toContain('2:1');

    fireEvent.click(screen.getByTestId('bank-submit'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(lastCommand(api)).toEqual({ type: 'trade.bank', give: 'lumber', receive: 'ore' });
  });

  it('refuses an exchange of the same resource client-side', async () => {
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ hints: makeHints() })) });
    await openGame(api);
    fireEvent.change(screen.getByTestId('bank-give'), { target: { value: 'wool' } });
    fireEvent.change(screen.getByTestId('bank-receive'), { target: { value: 'wool' } });
    expect((screen.getByTestId('bank-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Choose two different resources.')).toBeTruthy();
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
