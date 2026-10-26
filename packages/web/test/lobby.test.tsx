import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RoomPolicy } from '@catan/protocol';
import { App } from '../src/App.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import {
  makeMember,
  makePolicy,
  makeRoom,
  makeSnapshot,
  makeView,
} from '../src/test/fixtures.ts';

function renderApp(api: FakeApi) {
  return render(
    <App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />,
  );
}

async function joinLobby(api: FakeApi): Promise<void> {
  renderApp(api);
  const code = await screen.findByTestId('join-code');
  fireEvent.change(code, { target: { value: 'ABC123' } });
  fireEvent.click(screen.getByTestId('join-room'));
  await screen.findByTestId('room-code');
}

async function joinPlayingRoom(api: FakeApi): Promise<void> {
  renderApp(api);
  const code = await screen.findByTestId('join-code');
  fireEvent.change(code, { target: { value: 'ABC123' } });
  fireEvent.click(screen.getByTestId('join-room'));
  await screen.findByTestId('board-svg');
}

describe('lobby', () => {
  it('shows the invite code, host and seat readiness, and blocks start with a reason', async () => {
    const api = createFakeApi({
      room: makeRoom({
        startBlockers: [{ messageId: 'lobby.notReady' }, { messageId: 'lobby.disconnected' }],
      }),
    });
    await joinLobby(api);

    expect(screen.getByTestId('room-code').textContent).toBe('ABC123');
    expect(screen.getByTestId('host-name').textContent).toContain('Alex');
    expect(screen.getByTestId('lobby-seats').querySelectorAll('li')).toHaveLength(2);

    const start = screen.getByTestId('start-game') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    const blockers = screen.getByTestId('start-blockers');
    expect(blockers.textContent).toContain('Not ready');
    expect(blockers.textContent).toContain('Disconnected');
    expect(start.getAttribute('aria-describedby')).toBe('start-blockers');
  });

  it('starts the game once the server reports no blockers', async () => {
    const api = createFakeApi({ room: makeRoom() });
    await joinLobby(api);
    expect(screen.queryByTestId('start-blockers')).toBeNull();
    fireEvent.click(screen.getByTestId('start-game'));
    await waitFor(() => expect(api.callsOf('startGame')).toHaveLength(1));
  });

  it('takes an open colour and toggles readiness', async () => {
    const api = createFakeApi({
      room: makeRoom({
        hostId: 'p2',
        members: [makeMember({ playerId: 'p2', nickname: '小美', host: true, ready: true })],
      }),
    });
    await joinLobby(api);

    expect(screen.queryByTestId('toggle-ready')).toBeNull();
    fireEvent.click(screen.getByTestId('seat-color-green'));
    await waitFor(() => expect(api.callsOf('takeSeat')).toHaveLength(1));
    expect(api.callsOf('takeSeat')[0]!.args[1]).toBe('green');
    expect(screen.getByText('Only the host can change settings or start the game.')).toBeTruthy();
  });

  it('toggles readiness for a seated viewer', async () => {
    const api = createFakeApi({ room: makeRoom() });
    await joinLobby(api);
    const toggle = screen.getByTestId('toggle-ready');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() => expect(api.callsOf('setReady')).toHaveLength(1));
    expect(api.callsOf('setReady')[0]!.args[1]).toBe(false);
  });

  it('lets the host save a policy edit before start', async () => {
    const api = createFakeApi({ room: makeRoom() });
    await joinLobby(api);

    const clock = screen.getByTestId('policy-clock');
    fireEvent.change(clock, { target: { value: '120' } });
    fireEvent.click(screen.getByTestId('save-policy'));

    await waitFor(() => expect(api.callsOf('proposePolicy')).toHaveLength(1));
    const policy = api.callsOf('proposePolicy')[0]!.args[1] as RoomPolicy;
    expect(policy.turnClockSeconds).toBe(120);
    expect(policy.disconnectGraceSeconds).toBe(300);
  });

  it('collects consent for a post-start policy proposal', async () => {
    const api = createFakeApi({
      room: makeRoom({
        status: 'playing',
        gameId: 'g1',
        pendingPolicy: {
          id: 'prop-1',
          baseRevision: 1,
          before: makePolicy(),
          after: makePolicy({ turnClockSeconds: 60 }),
          proposedBy: 'p2',
          consents: ['p2'],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      }),
      snapshot: makeSnapshot(makeView()),
    });
    await joinPlayingRoom(api);

    const proposal = await screen.findByTestId('policy-proposal');
    expect(screen.getByTestId('policy-consent-count').textContent).toContain('1 of 2 seats approved');
    expect(proposal.textContent).toContain('→ 60');
    fireEvent.click(screen.getByTestId('policy-approve'));
    await waitFor(() => expect(api.callsOf('respondPolicy')).toHaveLength(1));
    expect(api.callsOf('respondPolicy')[0]!.args[1]).toEqual({ proposalId: 'prop-1', approve: true });
  });

  it('shows an invite-code error instead of a dead screen', async () => {
    const api = createFakeApi({ room: null });
    renderApp(api);
    fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'NOPE' } });
    fireEvent.click(screen.getByTestId('join-room'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('does not exist');
  });
});
