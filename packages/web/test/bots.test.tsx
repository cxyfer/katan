import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ClientMessage, PolicyProposalView } from '@catan/protocol';
import { ApiClient, type CreateRoomBody, type FetchLike } from '../src/api/client.ts';
import type { SocketLike } from '../src/api/socket.ts';
import { App } from '../src/App.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import {
  makeBotMember,
  makeConfig,
  makeIdentity,
  makeMember,
  makePolicy,
  makeResumable,
  makeRoom,
  makeRoomSummary,
  makeSnapshot,
  makeView,
} from '../src/test/fixtures.ts';

/** 電腦對手的前端行為（規格 §8）：建房捷徑、大廳增減、徽章與 i18n。 */

beforeEach(() => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'board-surface') return { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900, toJSON() {} };
    return original.call(this);
  });
});

function renderApp(api: FakeApi, languages: readonly string[] = ['en']) {
  return render(<App services={{ api, storage: memoryStorage(), languages, connectSocket: false }} />);
}

async function joinLobby(api: FakeApi, languages?: readonly string[]): Promise<void> {
  renderApp(api, languages);
  fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
  fireEvent.click(screen.getByTestId('join-room'));
  await screen.findByTestId('room-code');
}

function select(testId: string): HTMLSelectElement {
  return screen.getByTestId(testId) as HTMLSelectElement;
}

function optionValues(element: HTMLSelectElement): string[] {
  return [...element.options].map((option) => option.value);
}

const botRoom = () =>
  makeRoom({
    members: [makeMember(), makeBotMember({ playerId: 'bot1', nickname: 'Ada', seat: 1, color: 'blue' })],
  });

describe('API client', () => {
  it('adds and removes bots with the documented requests', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true, data: makeRoom() }) };
    };
    const api = new ApiClient(fetchImpl);
    await api.addBot('r1', 'easy');
    await api.removeBot('r1', 'bot/1');
    expect(calls).toEqual([
      { url: '/api/rooms/r1/bots', method: 'POST', body: { level: 'easy' } },
      { url: '/api/rooms/r1/bots/bot%2F1', method: 'DELETE', body: undefined },
    ]);
  });
});

describe('create room with bots', () => {
  it('offers zero to capacity − 1 bots and sends the chosen count and level', async () => {
    const api = createFakeApi();
    renderApp(api);
    await screen.findByTestId('create-room');

    const bots = select('room-bots');
    expect(optionValues(bots)).toEqual(['0', '1', '2']);
    expect(bots.options[0]!.textContent).toBe('None');
    // 沒有電腦時難度無意義，保持停用但不改變版面。
    expect(select('room-bot-level').disabled).toBe(true);

    fireEvent.change(bots, { target: { value: '2' } });
    expect(select('room-bot-level').disabled).toBe(false);
    fireEvent.change(select('room-bot-level'), { target: { value: 'easy' } });
    expect(screen.getByText(/Bots take open seats/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('create-room'));

    await waitFor(() => expect(api.callsOf('createRoom')).toHaveLength(1));
    expect(api.callsOf('createRoom')[0]!.args[0]).toMatchObject({ capacity: 3, bots: 2, botLevel: 'easy' });
    // 建房後直接進大廳，兩個電腦座位帶著所選難度。
    await screen.findByTestId('room-code');
    expect(screen.getByTestId('bot-badge-1').textContent).toBe('Bot · Easy');
    expect(screen.getByTestId('bot-badge-2').textContent).toBe('Bot · Easy');
  });

  it('clamps the bot count when the capacity shrinks', async () => {
    const api = createFakeApi();
    renderApp(api);
    await screen.findByTestId('create-room');

    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '4' } });
    fireEvent.change(select('room-bots'), { target: { value: '3' } });
    expect(select('room-bots').value).toBe('3');

    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '3' } });
    expect(optionValues(select('room-bots'))).toEqual(['0', '1', '2']);
    expect(select('room-bots').value).toBe('2');
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '4' } });
    expect(select('room-bots').value).toBe('2');
  });

  it('hides the bot fields and omits them from the request when the server disables bots', async () => {
    const api = createFakeApi({ config: makeConfig({ bots: { enabled: false, levels: [] } }) });
    renderApp(api);
    await screen.findByTestId('create-room');
    expect(screen.queryByTestId('room-bots')).toBeNull();
    expect(screen.queryByTestId('room-bot-level')).toBeNull();

    fireEvent.click(screen.getByTestId('create-room'));
    await waitFor(() => expect(api.callsOf('createRoom')).toHaveLength(1));
    const body = api.callsOf('createRoom')[0]!.args[0] as CreateRoomBody;
    expect('bots' in body).toBe(false);
    expect('botLevel' in body).toBe(false);
  });

  it('omits the bot fields when no bot is requested', async () => {
    const api = createFakeApi();
    renderApp(api);
    fireEvent.click(await screen.findByTestId('create-room'));
    await waitFor(() => expect(api.callsOf('createRoom')).toHaveLength(1));
    expect('bots' in (api.callsOf('createRoom')[0]!.args[0] as CreateRoomBody)).toBe(false);
  });
});

describe('lobby bot seats', () => {
  it('shows a bot seat with its difficulty and without readiness or connection noise', async () => {
    const api = createFakeApi({ room: botRoom() });
    await joinLobby(api);

    const seat = screen.getByTestId('member-1');
    expect(seat.dataset.bot).toBe('true');
    expect(within(seat).getByTestId('bot-badge-1').textContent).toBe('Bot · Standard');
    expect(seat.textContent).not.toContain('Ready');
    expect(seat.textContent).not.toContain('Connected');
    // 人類座位維持原本的準備與連線標籤。
    expect(screen.getByTestId('member-0').textContent).toContain('Ready');
    expect(screen.getByTestId('member-0').dataset.bot).toBeUndefined();
  });

  it('lets the host add a bot at the chosen difficulty', async () => {
    const api = createFakeApi({ room: makeRoom({ members: [makeMember()] }) });
    await joinLobby(api);

    const toolbar = screen.getByTestId('lobby-bots');
    expect(within(toolbar).getByRole('heading').textContent).toContain('Bot opponents');
    fireEvent.change(select('lobby-bot-level'), { target: { value: 'easy' } });
    fireEvent.click(screen.getByTestId('add-bot'));

    await waitFor(() => expect(api.callsOf('addBot')).toHaveLength(1));
    expect(api.callsOf('addBot')[0]!.args).toEqual(['r1', 'easy']);
    expect((await screen.findByTestId('bot-badge-1')).textContent).toBe('Bot · Easy');
    expect(screen.getByTestId('lobby-seats').querySelectorAll('li')).toHaveLength(2);
  });

  it('disables adding a bot when every seat is taken', async () => {
    const api = createFakeApi({
      room: makeRoom({
        capacity: 3,
        members: [
          makeMember(),
          makeBotMember({ playerId: 'bot1', seat: 1, color: 'blue' }),
          makeBotMember({ playerId: 'bot2', nickname: 'Bram', seat: 2, color: 'orange' }),
        ],
      }),
    });
    await joinLobby(api);

    const add = screen.getByTestId('add-bot') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.getAttribute('aria-describedby')).toBe('lobby-bots-full');
    expect(screen.getByText('Every seat is taken.')).toBeTruthy();
  });

  it('lets the host remove a bot by name', async () => {
    const api = createFakeApi({ room: botRoom() });
    await joinLobby(api);

    const remove = screen.getByRole('button', { name: 'Remove bot Ada' });
    fireEvent.click(remove);
    await waitFor(() => expect(api.callsOf('removeBot')).toHaveLength(1));
    expect(api.callsOf('removeBot')[0]!.args).toEqual(['r1', 'bot1']);
    await waitFor(() => expect(screen.queryByTestId('bot-badge-1')).toBeNull());
    expect(screen.getByTestId('lobby-seats').querySelectorAll('li')).toHaveLength(1);
  });

  it('shows the removal error through the usual notice', async () => {
    const api = createFakeApi({ room: botRoom() });
    api.removeBot = async () => ({ ok: false, error: { code: 'E_ROOM_STARTED', messageId: 'error.E_ROOM_STARTED' } });
    await joinLobby(api);
    fireEvent.click(screen.getByTestId('remove-bot-bot1'));
    expect((await screen.findAllByText('The game has started, so room settings are locked.')).length).toBeGreaterThan(0);
  });

  it('shows badges but no bot controls to a guest', async () => {
    const api = createFakeApi({
      room: makeRoom({
        hostId: 'p2',
        members: [
          makeMember({ host: false }),
          makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', host: true }),
          makeBotMember({ playerId: 'bot1', seat: 2, color: 'orange' }),
        ],
      }),
    });
    await joinLobby(api);

    expect(screen.getByTestId('bot-badge-2')).toBeTruthy();
    expect(screen.queryByTestId('lobby-bots')).toBeNull();
    expect(screen.queryByTestId('remove-bot-bot1')).toBeNull();
  });

  it('keeps removal available while adding is disabled by the server', async () => {
    const api = createFakeApi({
      config: makeConfig({ bots: { enabled: false, levels: [] } }),
      room: botRoom(),
    });
    await joinLobby(api);
    expect(screen.queryByTestId('lobby-bots')).toBeNull();
    expect(screen.getByTestId('remove-bot-bot1')).toBeTruthy();
  });

  it('renders the bot vocabulary in Traditional Chinese', async () => {
    // 已登入身分的語系優先於瀏覽器語言。
    const api = createFakeApi({
      identity: makeIdentity({ locale: 'zh-Hant' }),
      room: makeRoom({ members: [makeMember(), makeBotMember({ botLevel: 'easy' })] }),
    });
    await joinLobby(api, ['zh-TW']);
    expect(screen.getByTestId('bot-badge-1').textContent).toBe('電腦・簡單');
    expect(screen.getByTestId('add-bot').textContent).toContain('加入電腦');
    expect(screen.getByRole('button', { name: '移除電腦 Ada' })).toBeTruthy();
  });
});

describe('policy consent with bot seats', () => {
  it('counts only human seats', async () => {
    const proposal: PolicyProposalView = {
      id: 'prop-1',
      baseRevision: 1,
      before: makePolicy(),
      after: makePolicy({ turnClockSeconds: 60 }),
      proposedBy: 'p2',
      consents: ['p2'],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const api = createFakeApi({
      room: makeRoom({
        status: 'playing',
        gameId: 'g1',
        pendingPolicy: proposal,
        members: [
          makeMember(),
          makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', host: false }),
          makeBotMember({ playerId: 'p3', nickname: 'Bo', seat: 2, color: 'orange' }),
        ],
      }),
      snapshot: makeSnapshot(makeView()),
    });
    renderApp(api);
    fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
    fireEvent.click(screen.getByTestId('join-room'));
    const count = await screen.findByTestId('policy-consent-count');
    expect(count.textContent).toContain('1 of 2 seats approved');
    expect(count.textContent).toContain('Bot seats do not vote.');
  });
});

describe('bots at the table', () => {
  it('marks bot seats in the players panel', async () => {
    const api = createFakeApi({
      room: makeRoom({
        status: 'playing',
        gameId: 'g1',
        members: [
          makeMember(),
          makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', host: false }),
          makeBotMember({ playerId: 'p3', nickname: 'Bo', seat: 2, color: 'orange', botLevel: 'easy' }),
        ],
      }),
      snapshot: makeSnapshot(makeView()),
    });
    renderApp(api);
    fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
    fireEvent.click(screen.getByTestId('join-room'));
    await screen.findByTestId('board-svg');

    fireEvent.click(screen.getByTestId('players-toggle'));
    const botSeat = screen.getByTestId('seat-2');
    expect(botSeat.dataset.bot).toBe('true');
    expect(botSeat.getAttribute('title')).toContain('Bo (Bot · Easy)');
    expect(within(botSeat).getByTestId('seat-bot-2').textContent).toBe('Bot');
    expect(screen.getByTestId('seat-1').dataset.bot).toBeUndefined();
    expect(screen.queryByTestId('seat-bot-1')).toBeNull();
  });

  it('subscribes a resumed game to its room so the server sees the seat', async () => {
    class RecordingSocket implements SocketLike {
      sent: ClientMessage[] = [];
      open = () => {};
      send(data: string) { this.sent.push(JSON.parse(data) as ClientMessage); }
      close() {}
      onOpen(handler: () => void) { this.open = handler; }
      onClose() {}
      onMessage() {}
      onError() {}
    }
    const sockets: RecordingSocket[] = [];
    const api = createFakeApi({ snapshot: makeSnapshot(makeView()) });
    render(
      <App
        services={{
          api,
          storage: memoryStorage(),
          languages: ['en'],
          socketFactory: () => {
            const socket = new RecordingSocket();
            sockets.push(socket);
            return socket;
          },
        }}
      />,
    );
    act(() => sockets[0]!.open());
    fireEvent.click(await screen.findByTestId('resume-g1'));
    await screen.findByTestId('board-svg');
    await waitFor(() =>
      expect(sockets[0]!.sent).toContainEqual({ type: 'subscribe', payload: { roomId: 'r1', gameId: 'g1' } }),
    );
  });
});

describe('home lists', () => {
  it('shows how many seats of a public room are bots', async () => {
    const api = createFakeApi({ rooms: [makeRoomSummary({ botCount: 2, playerCount: 3 })] });
    renderApp(api);
    await screen.findByTestId('create-room');
    fireEvent.click(screen.getByRole('tab', { name: /Public rooms/ }));
    expect((await screen.findByTestId('room-bots-r2')).textContent).toContain('2 bot(s)');
  });

  it('marks bot players in the resume list', async () => {
    const api = createFakeApi({
      games: [
        makeResumable({
          players: [
            { playerId: 'p1', nickname: 'Alex', color: 'red' },
            { playerId: 'bot1', nickname: 'Ada', color: 'blue', bot: true },
          ],
        }),
      ],
    });
    renderApp(api);
    await screen.findByTestId('create-room');
    fireEvent.click(screen.getByRole('tab', { name: /Resume/ }));
    expect(screen.getByTestId('resume-list').textContent).toContain('Alex、Ada (bot)');
  });
});
