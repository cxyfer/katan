import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ClientMessage, PolicyProposalView } from '@catan/protocol';
import { createGameStats, type GameView } from '@catan/rules';
import { GameStatsPanel } from '../src/components/GameStats.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { ApiClient, type CreateRoomBody, type FetchLike } from '../src/api/client.ts';
import type { SocketLike } from '../src/api/socket.ts';
import { App } from '../src/App.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import {
  makeBotMember,
  makeConfig,
  makeEvent,
  makeIdentity,
  makeMember,
  makePolicy,
  makeProfile,
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
    await api.addBot('r1', { level: 'easy' });
    await api.addBot('r1', { level: 'standard', name: 'Robo' });
    await api.removeBot('r1', 'bot/1');
    expect(calls).toEqual([
      { url: '/api/rooms/r1/bots', method: 'POST', body: { level: 'easy' } },
      { url: '/api/rooms/r1/bots', method: 'POST', body: { level: 'standard', name: 'Robo' } },
      { url: '/api/rooms/r1/bots/bot%2F1', method: 'DELETE', body: undefined },
    ]);
  });
});

describe('create room', () => {
  it('never asks for bot seats and lets the room set them', async () => {
    const api = createFakeApi();
    renderApp(api);
    await screen.findByTestId('create-room');
    expect(screen.queryByTestId('room-bots')).toBeNull();
    expect(screen.queryByTestId('room-bot-level')).toBeNull();

    fireEvent.click(screen.getByTestId('create-room'));
    await waitFor(() => expect(api.callsOf('createRoom')).toHaveLength(1));
    const body = api.callsOf('createRoom')[0]!.args[0] as CreateRoomBody;
    expect('bots' in body).toBe(false);
    expect('botLevel' in body).toBe(false);

    // 空位上的「新增電腦」按鈕才是加入電腦的地方，剛進房時沒有任何電腦座位。
    await screen.findByTestId('room-code');
    expect(screen.getByTestId('add-bot')).toBeTruthy();
    expect(screen.queryByTestId('bot-badge-1')).toBeNull();
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

  it('keeps the lobby toolbar and adds a bot with the default name', async () => {
    const api = createFakeApi({ room: makeRoom({ members: [makeMember()] }) });
    await joinLobby(api);

    const toolbar = screen.getByTestId('lobby-bots');
    expect(within(toolbar).getByRole('heading').textContent).toContain('Bot opponents');
    fireEvent.change(within(toolbar).getByTestId('lobby-bot-level'), { target: { value: 'easy' } });
    fireEvent.click(within(toolbar).getByTestId('add-bot'));

    await waitFor(() => expect(api.callsOf('addBot')).toHaveLength(1));
    expect(api.callsOf('addBot')[0]!.args).toEqual(['r1', { level: 'easy' }]);
    expect((await screen.findByTestId('bot-badge-1')).textContent).toBe('Bot · Easy');
  });

  it('opens the name dialog from the small icon and adds with the custom name', async () => {
    const api = createFakeApi({ room: makeRoom({ members: [makeMember()] }) });
    await joinLobby(api);

    fireEvent.click(screen.getByTestId('add-bot-named'));
    const dialog = await screen.findByTestId('bot-dialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('Add a bot opponent');
    expect((within(dialog).getByTestId('bot-name') as HTMLInputElement).placeholder).toBe('Leave blank for a default name');
    fireEvent.change(within(dialog).getByTestId('bot-name'), { target: { value: 'Robo' } });
    fireEvent.click(within(dialog).getByTestId('confirm-add-bot'));

    await waitFor(() => expect(api.callsOf('addBot')).toHaveLength(1));
    expect(api.callsOf('addBot')[0]!.args).toEqual(['r1', { level: 'standard', name: 'Robo' }]);
    await waitFor(() => expect(screen.queryByTestId('bot-dialog')).toBeNull());
    expect(screen.getByTestId('member-1').textContent).toContain('Robo');
  });

  it('keeps the dialog open and shows why a bot was rejected', async () => {
    const api = createFakeApi({ room: makeRoom({ members: [makeMember()] }) });
    api.addBot = async () => ({
      ok: false,
      error: { code: 'E_BOT_NAME_TAKEN', messageId: 'error.E_BOT_NAME_TAKEN', params: { name: 'Alex' } },
    });
    await joinLobby(api);

    fireEvent.click(screen.getByTestId('add-bot-named'));
    fireEvent.change(await screen.findByTestId('bot-name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByTestId('confirm-add-bot'));

    expect((await screen.findByTestId('bot-error')).textContent).toContain(
      'Another seat already uses the name Alex.',
    );
    expect(screen.getByTestId('bot-dialog')).toBeTruthy();
  });

  it('disables both add controls when people fill every seat', async () => {
    const api = createFakeApi({
      room: makeRoom({
        capacity: 3,
        members: [
          makeMember(),
          makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', host: false }),
          makeMember({ playerId: 'p3', nickname: '小傑', seat: 2, color: 'orange', host: false }),
        ],
      }),
    });
    await joinLobby(api);
    expect((screen.getByTestId('add-bot') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('add-bot-named') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Every seat is taken.')).toBeTruthy();
  });

  it('disables adding a bot with a localized reason when the profile has expansion rules', async () => {
    const api = createFakeApi({
      profiles: [makeProfile({ id: 'sf-new-shores-2025', expansions: ['seafarers'], botSeats: false })],
      room: makeRoom({ profileId: 'sf-new-shores-2025', members: [makeMember()] }),
      identity: makeIdentity({ locale: 'zh-Hant' }),
    });
    await joinLobby(api, ['zh-TW']);

    const add = screen.getByTestId('add-bot') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.getAttribute('aria-describedby')).toBe('lobby-bots-unsupported');
    const named = screen.getByTestId('add-bot-named') as HTMLButtonElement;
    expect(named.disabled).toBe(true);
    expect(named.getAttribute('aria-describedby')).toBe('lobby-bots-unsupported');
    fireEvent.click(add);
    fireEvent.click(named);
    expect(api.callsOf('addBot')).toHaveLength(0);
    expect(screen.queryByTestId('bot-name')).toBeNull();
    expect(screen.getByTestId('lobby-bots-unsupported').textContent).toBe(
      '電腦對手只會玩基本遊戲，無法加入使用擴充規則的組合。',
    );
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
    expect(screen.queryByTestId('add-bot')).toBeNull();
    expect(screen.queryByTestId('remove-bot-bot1')).toBeNull();
  });

  it('keeps removal available while the server disables bots', async () => {
    const api = createFakeApi({
      config: makeConfig({ bots: { enabled: false, levels: [] } }),
      room: botRoom(),
    });
    await joinLobby(api);
    expect(screen.queryByTestId('add-bot')).toBeNull();
    expect(screen.getByTestId('remove-bot-bot1')).toBeTruthy();
  });

  it('renders the bot vocabulary in Traditional Chinese', async () => {
    // 已登入身分的語系優先於瀏覽器語言。
    const api = createFakeApi({
      identity: makeIdentity({ locale: 'zh-Hant' }),
      room: makeRoom({ members: [makeMember(), makeBotMember({ botLevel: 'easy' })] }),
    });
    await joinLobby(api, ['zh-TW']);
    expect(screen.getByRole('heading', { name: '電腦對手' })).toBeTruthy();
    expect(screen.getByLabelText('電腦難度')).toBeTruthy();
    expect(screen.getByRole('button', { name: '加入電腦' })).toBeTruthy();
    expect(screen.getByTestId('bot-badge-1').textContent).toBe('電腦・簡單');
    expect(screen.getByRole('button', { name: '移除電腦 Ada' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('add-bot-named'));
    expect(screen.getByRole('heading', { name: '新增電腦對手' })).toBeTruthy();
    expect(screen.getByLabelText('名稱')).toBeTruthy();
    expect(screen.getByRole('button', { name: '自訂名稱新增電腦' })).toBeTruthy();
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
    expect(within(botSeat).getByTestId('seat-bot-2').textContent).toBe(' (Bot · Easy)');
    expect(within(botSeat).getByTestId('seat-bot-2').className).toContain('visually-hidden');
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
    expect(screen.getByText('All original human players are needed to resume.')).toBeTruthy();
    expect(screen.queryByText('All original seats are needed to resume.')).toBeNull();
  });

  it('explains the human-only resume quorum in Traditional Chinese', async () => {
    const api = createFakeApi({
      identity: makeIdentity({ locale: 'zh-Hant' }),
      games: [
        makeResumable({
          players: [
            { playerId: 'p1', nickname: 'Alex', color: 'red' },
            { playerId: 'p2', nickname: 'Bo', color: 'orange' },
            { playerId: 'bot1', nickname: 'Ada', color: 'blue', bot: true },
          ],
        }),
      ],
    });
    renderApp(api, ['zh-Hant']);
    await screen.findByTestId('create-room');
    fireEvent.click(screen.getByRole('tab', { name: /繼續對局/ }));
    expect(screen.getByText('需要所有原真人玩家到齊才能繼續。')).toBeTruthy();
    expect(screen.queryByText('需要所有原座位到齊才能繼續。')).toBeNull();
  });

  it('keeps the all-seat resume notice for human-only games', async () => {
    const api = createFakeApi({ games: [makeResumable({ allSeatsNeeded: true })] });
    renderApp(api);
    await screen.findByTestId('create-room');
    fireEvent.click(screen.getByRole('tab', { name: /Resume/ }));
    expect(screen.getByText('All original seats are needed to resume.')).toBeTruthy();
    expect(screen.queryByText('All original human players are needed to resume.')).toBeNull();
  });
});

describe('bots outside the expanded players panel', () => {
  const tableRoom = (status: 'playing' | 'completed' = 'playing') =>
    makeRoom({
      status,
      gameId: 'g1',
      members: [
        makeMember(),
        makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', host: false }),
        makeBotMember({ playerId: 'p3', nickname: 'Bo', seat: 2, color: 'orange', botLevel: 'easy' }),
      ],
    });

  async function openTable(view: GameView, status: 'playing' | 'completed' = 'playing', locale: 'en' | 'zh-Hant' = 'en') {
    const api = createFakeApi({
      identity: makeIdentity({ locale }),
      room: tableRoom(status),
      snapshot: makeSnapshot(view),
    });
    renderApp(api, [locale === 'en' ? 'en' : 'zh-TW']);
    fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
    fireEvent.click(screen.getByTestId('join-room'));
  }

  it('marks a bot seat on the avatar in both players rail states', async () => {
    await openTable(makeView());
    await screen.findByTestId('board-svg');
    const botSeat = screen.getByTestId('seat-2');
    expect(within(botSeat).getByTestId('seat-bot-mark-2')).toBeTruthy();
    expect(within(botSeat).getByText('Bo (Bot · Easy)').className).toContain('visually-hidden');
    expect(screen.queryByTestId('seat-bot-mark-1')).toBeNull();
    // 展開後仍沿用角落標記，不在名稱旁插入徽章，避免名稱列換行。
    fireEvent.click(screen.getByTestId('players-toggle'));
    expect(within(botSeat).getByTestId('seat-bot-mark-2')).toBeTruthy();
    expect(botSeat.querySelector('.seat__identity .bot-badge')).toBeNull();
    expect(within(botSeat).getByTestId('seat-bot-2').className).toContain('visually-hidden');
  });

  it('names bots in the event log and in the waiting prompt', async () => {
    await openTable(
      makeView({
        turnPlayerId: 'p3',
        events: [makeEvent(11, 'turn.started', { playerId: 'p3', windowId: 1 })],
      }),
    );
    await screen.findByTestId('board-svg');
    await waitFor(() => expect(screen.getByTestId('event-list').textContent).toContain('Bo (bot)'));
    for (const element of screen.getAllByTestId('turn-state')) expect(element.textContent).toContain('Bo (bot)');
    expect(screen.getByTestId('event-list').textContent).not.toContain('小美 (bot)');
  });

  it('badges a bot winner and marks bots in the statistics', async () => {
    const view = makeView({ result: { playerId: 'p3', reason: 'victory', score: 10 } });
    view.stats = createGameStats(view.players.map((player) => ({ id: player.id }) as never), true);
    view.stats.timeline = [
      [2, 2, 2],
      [3, 4, 10],
    ];
    await openTable(view, 'completed', 'zh-Hant');
    const winner = await screen.findByTestId('result-winner');
    expect(within(winner).getByTestId('result-winner-bot').textContent).toBe('電腦・簡單');
    expect(screen.getByTestId('stats-bot-p3')).toBeTruthy();
    expect(screen.queryByTestId('stats-bot-p2')).toBeNull();
    fireEvent.click(screen.getByTestId('stats-tab-timeline'));
    const legend = screen.getByTestId('stats-timeline').querySelector('.stats-chart__legend')!;
    expect(legend.textContent).toContain('Bo（電腦）');
    expect(legend.textContent).not.toContain('小美（電腦）');
  });

  it('keeps plain names while the room is not loaded', () => {
    const view = makeView();
    view.stats = createGameStats(view.players.map((player) => ({ id: player.id }) as never), true);
    view.stats.timeline = [
      [2, 2, 2],
      [3, 4, 10],
    ];
    render(
      <LocaleProvider locale="en">
        <GameStatsPanel view={view} />
      </LocaleProvider>,
    );
    expect(screen.queryByTestId('stats-bot-p3')).toBeNull();
    fireEvent.click(screen.getByTestId('stats-tab-timeline'));
    expect(screen.getByTestId('stats-timeline').textContent).not.toContain('(bot)');
  });
});
