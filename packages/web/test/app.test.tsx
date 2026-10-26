import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CommandRequest } from '@catan/protocol';
import { App } from '../src/App.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import { fixedBoard, makeHints, makeSnapshot, makeView } from '../src/test/fixtures.ts';

function renderApp(api: FakeApi, languages: readonly string[] = ['en']) {
  return render(
    <App
      services={{
        api,
        storage: memoryStorage(),
        languages,
        connectSocket: false,
      }}
    />,
  );
}

async function openGame(api: FakeApi): Promise<void> {
  renderApp(api);
  const resume = await screen.findByTestId('resume-g1');
  fireEvent.click(resume);
  await screen.findByTestId('board-svg');
}

const ACCEPTED = {
  ok: true as const,
  data: { commandId: 'c', outcome: 'accepted' as const, revision: 13, events: [] },
};

describe('entry and locale', () => {
  it('switching locale preserves the un-submitted nickname draft', async () => {
    const api = createFakeApi({ identity: null });
    renderApp(api);
    const input = (await screen.findByTestId('nickname-input')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '小美' } });
    expect(input.value).toBe('小美');

    fireEvent.change(screen.getByTestId('locale-switch'), { target: { value: 'zh-Hant' } });

    const afterSwitch = (await screen.findByTestId('nickname-input')) as HTMLInputElement;
    expect(afterSwitch.value).toBe('小美');
    expect(screen.getByText('進入牌桌')).toBeTruthy();
    expect(screen.getByText('繁體中文')).toBeTruthy();
  });

  it('starts in the language the browser prefers', async () => {
    const api = createFakeApi({ identity: null });
    renderApp(api, ['zh-TW', 'en']);
    await screen.findByTestId('nickname-input');
    expect(screen.getByText('進入牌桌')).toBeTruthy();
  });

  it('persists an explicit locale choice so a reload keeps it', async () => {
    const api = createFakeApi({ identity: null });
    const storage = memoryStorage();
    render(
      <App services={{ api, storage, languages: ['en'], connectSocket: false }} />,
    );
    await screen.findByTestId('nickname-input');
    fireEvent.change(screen.getByTestId('locale-switch'), { target: { value: 'zh-Hant' } });
    expect(storage.getItem('catan.locale')).toBe('zh-Hant');
  });
});

describe('board rendering', () => {
  it('renders 19 hexes, the robber and harbour tokens from the real fixed layout', async () => {
    const board = fixedBoard();
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ board })) });
    const { container } = render(
      <App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />,
    );
    fireEvent.click(await screen.findByTestId('resume-g1'));
    await screen.findByTestId('board-svg');

    expect(container.querySelectorAll('polygon[data-testid^="hex-"]')).toHaveLength(19);
    expect(screen.getByTestId('robber')).toBeTruthy();
    expect(screen.getByTestId(`hex-${board.robber}`).getAttribute('fill')).toBe('#e0cfa9');
    expect(container.querySelectorAll('[data-testid^="harbor-"]').length).toBe(board.harbors.length);
  });

  it('labels each terrain with a letter and a glyph, never colour alone', async () => {
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ board: fixedBoard() })) });
    const { container } = render(
      <App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />,
    );
    fireEvent.click(await screen.findByTestId('resume-g1'));
    await screen.findByTestId('board-svg');
    const terrainLabels = [...container.querySelectorAll('.board__terrain')].map(
      (node) => node.textContent ?? '',
    );
    expect(terrainLabels).toHaveLength(19);
    for (const label of terrainLabels) {
      expect(label).toMatch(/[A-Za-z]{1,2}/);
    }
  });
});

describe('action hints in the UI', () => {
  it('disables an action and shows the reason text next to it', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ hints: makeHints({ legalRoads: [], legalSettlements: [] }) })),
    });
    await openGame(api);

    const button = screen.getByTestId('action-build.road') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('data-enabled')).toBe('false');
    expect(screen.getByTestId('reason-build.road').textContent).toBe('No legal target is available.');
  });

  it('enables an action with a legal target and offers the candidate list', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ hints: makeHints({ legalRoads: [5, 9] }) })),
    });
    await openGame(api);

    fireEvent.click(screen.getByTestId('action-build.road'));
    expect(await screen.findByTestId('target-edge-5')).toBeTruthy();
    expect(screen.getByTestId('target-edge-9')).toBeTruthy();

    fireEvent.click(screen.getByTestId('open-target-picker'));
    const picker = await screen.findByTestId('target-picker');
    expect(picker.textContent).toContain('Path 5');
    expect(screen.getByTestId('picker-edge-9')).toBeTruthy();
  });
});

describe('keyboard target selection', () => {
  it('selects a legal target with the keyboard and submits it on confirm', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ hints: makeHints({ legalRoads: [5, 9] }) })),
    });
    await openGame(api);
    fireEvent.click(screen.getByTestId('action-build.road'));

    const target = await screen.findByTestId('target-edge-5');
    expect(target.getAttribute('tabindex')).toBe('0');
    expect(target.getAttribute('role')).toBe('button');
    expect(target.getAttribute('aria-label')).toContain('Path 5');

    target.focus();
    fireEvent.keyDown(target, { key: 'Enter' });

    const preview = await screen.findByTestId('selection-preview');
    expect(preview.textContent).toContain('Path 5');

    api.setCommandResult(ACCEPTED);
    fireEvent.click(screen.getByTestId('confirm-selection'));

    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    const request = api.callsOf('sendCommand')[0]!.args[1] as CommandRequest;
    expect(request.command).toEqual({ type: 'build.road', edge: 5 });
    expect(request.expectedRevision).toBe(12);
  });
});

describe('pan and zoom', () => {
  it('never commits a placement at the end of a pan gesture', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ hints: makeHints({ legalRoads: [5] }) })),
    });
    await openGame(api);
    fireEvent.click(screen.getByTestId('action-build.road'));
    const target = await screen.findByTestId('target-edge-5');
    const svg = screen.getByTestId('board-svg');

    fireEvent.mouseDown(svg, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(svg, { clientX: 80, clientY: 60 });
    fireEvent.mouseUp(svg, { clientX: 80, clientY: 60 });
    fireEvent.click(target);

    expect(screen.queryByTestId('selection-preview')).toBeNull();
    expect(api.callsOf('sendCommand')).toHaveLength(0);

    // A deliberate click afterwards still selects.
    fireEvent.click(target);
    expect(await screen.findByTestId('selection-preview')).toBeTruthy();
  });
});

describe('command outcome handling', () => {
  it('resolves an unknown outcome before offering a retry, then retries with a new id', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ hints: makeHints({ canEndTurn: true }) })),
    });
    await openGame(api);

    api.setCommandResult({
      ok: false,
      error: { code: 'E_NETWORK', messageId: 'error.E_NETWORK' },
    });
    fireEvent.click(screen.getByTestId('action-endTurn'));

    const status = await screen.findByTestId('command-status');
    expect(status.getAttribute('data-status')).toBe('unknown');
    expect(screen.getByTestId('command-resolve')).toBeTruthy();
    expect(screen.queryByTestId('command-retry')).toBeNull();

    // Resolving replays the same command id and finds a stale rejection.
    api.setCommandResult({
      ok: true,
      data: {
        commandId: 'x',
        outcome: 'rejected',
        revision: 15,
        error: { messageId: 'error.E_STALE_REVISION' },
        events: [],
      },
    });
    fireEvent.click(screen.getByTestId('command-resolve'));
    await waitFor(() =>
      expect(screen.getByTestId('command-status').getAttribute('data-status')).toBe('stale'),
    );
    expect(screen.getByTestId('command-refresh')).toBeTruthy();
    expect(screen.queryByTestId('command-retry')).toBeNull();

    const calls = api.callsOf('sendCommand');
    expect(calls).toHaveLength(2);
    expect((calls[1]!.args[1] as CommandRequest).commandId).toBe(
      (calls[0]!.args[1] as CommandRequest).commandId,
    );

    // Refresh makes the stale rejection retryable.
    fireEvent.click(screen.getByTestId('command-refresh'));
    const retry = await screen.findByTestId('command-retry');
    api.setCommandResult(ACCEPTED);
    fireEvent.click(retry);

    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(3));
    const retried = api.callsOf('sendCommand')[2]!.args[1] as CommandRequest;
    expect(retried.commandId).not.toBe((calls[0]!.args[1] as CommandRequest).commandId);
  });

  it('keeps a valid local selection when the server rejects the move', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ hints: makeHints({ legalRoads: [5] }) })),
    });
    await openGame(api);
    fireEvent.click(screen.getByTestId('action-build.road'));
    fireEvent.click(await screen.findByTestId('target-edge-5'));
    expect(await screen.findByTestId('selection-preview')).toBeTruthy();

    api.setCommandResult({
      ok: true,
      data: {
        commandId: 'x',
        outcome: 'rejected',
        revision: 12,
        error: { messageId: 'error.E_INSUFFICIENT_RESOURCES' },
        events: [],
      },
    });
    fireEvent.click(screen.getByTestId('confirm-selection'));

    await waitFor(() =>
      expect(screen.getByTestId('command-status').getAttribute('data-status')).toBe('rejected'),
    );
    expect(screen.getByTestId('selection-preview')).toBeTruthy();
    expect(screen.getByTestId('command-status').textContent).toContain('Your draft input was kept.');
  });
});

describe('mobile drawer', () => {
  it('never contains the required-action prompt or the status strip', async () => {
    const previous = window.innerWidth;
    window.innerWidth = 400;
    try {
      const api = createFakeApi({
        snapshot: makeSnapshot(
          makeView({
            hints: null,
            pending: { kind: 'discard', required: { p1: 4 }, waitingFor: ['p1'] },
          }),
        ),
      });
      await openGame(api);

      const prompt = screen.getByTestId('required-action-prompt');
      expect(prompt.getAttribute('data-mine')).toBe('true');

      fireEvent.click(screen.getByTestId('drawer-tab-chat'));
      const drawer = screen.getByTestId('mobile-drawer');
      const chat = await screen.findByTestId('chat-panel');

      expect(drawer.contains(chat)).toBe(true);
      expect(drawer.contains(prompt)).toBe(false);
      expect(drawer.contains(screen.getByTestId('status-strip'))).toBe(false);
      expect(prompt.hasAttribute('hidden')).toBe(false);
      expect(prompt.getAttribute('aria-hidden')).toBeNull();
      expect(screen.getByTestId('discard-submit')).toBeTruthy();

      // The drawer can be closed again without losing the prompt.
      fireEvent.click(screen.getByTestId('drawer-close'));
      expect(screen.getByTestId('required-action-prompt')).toBeTruthy();
    } finally {
      window.innerWidth = previous;
    }
  });
});

describe('chat integration', () => {
  it('shows sending then sent, and retries an unknown send with the same client id', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ hints: makeHints() })),
      room: null,
    });
    await openGame(api);

    api.setChatSendResult({
      ok: false,
      error: { code: 'E_NETWORK', messageId: 'error.E_NETWORK' },
    });
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'hello table' } });
    fireEvent.click(screen.getByTestId('chat-send'));

    await screen.findByTestId('chat-pending');
    await waitFor(() =>
      expect(screen.getByTestId('chat-pending').textContent).toContain('Outcome unknown'),
    );
    expect(screen.getByTestId('chat-pending').textContent).toContain('hello table');

    const first = api.callsOf('sendChat')[0]!.args[1] as { clientMessageId: string };
    api.setChatSendResult({
      ok: true,
      data: {
        id: 'm9',
        seq: 9,
        playerId: 'p1',
        nickname: 'Alex',
        seat: 0,
        color: 'red',
        text: 'hello table',
        createdAt: '2026-01-01T00:00:09.000Z',
        kind: 'player',
        clientMessageId: first.clientMessageId,
      },
    });
    fireEvent.click(screen.getByTestId(`chat-retry-${first.clientMessageId}`));

    await waitFor(() => expect(api.callsOf('sendChat')).toHaveLength(2));
    const second = api.callsOf('sendChat')[1]!.args[1] as { clientMessageId: string };
    expect(second.clientMessageId).toBe(first.clientMessageId);
  });

  it('renders user text verbatim and mutes a sender locally', async () => {
    const api = createFakeApi({
      snapshot: makeSnapshot(makeView({ hints: makeHints() })),
      chat: {
        messages: [
          {
            id: 'm1',
            seq: 1,
            playerId: 'p2',
            nickname: '小美',
            seat: 1,
            color: 'blue',
            text: '<img src=x onerror=alert(1)> & <b>bold</b>',
            createdAt: '2026-01-01T00:00:01.000Z',
            kind: 'player',
          },
        ],
        nextSeq: 2,
        hasMore: false,
      },
    });
    await openGame(api);
    await waitFor(() => expect(screen.getByTestId('chat-message-m1')).toBeTruthy());

    const message = screen.getByTestId('chat-message-m1');
    expect(message.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(message.querySelector('img')).toBeNull();
    expect(message.querySelector('b')).toBeNull();

    fireEvent.click(screen.getByTestId('mute-p2'));
    expect(screen.queryByTestId('chat-message-m1')).toBeNull();
  });
});
