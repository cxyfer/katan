import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AbandonProposalView, RoomView, SuspendProposalView } from '@catan/protocol';
import { ApiClient, type FetchLike } from '../src/api/client.ts';
import { App } from '../src/App.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import {
  makeBotMember,
  makeIdentity,
  makeMember,
  makePolicy,
  makeResumable,
  makeRoom,
  makeSnapshot,
  makeView,
} from '../src/test/fixtures.ts';

/** 離開、退出與結束對局的前端行為（SPEC §4.6、§4.8）。 */

beforeEach(() => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'board-surface') return { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900, toJSON() {} };
    return original.call(this);
  });
});

const HUMAN = { host: false } as const;

/** 只有自己與一個電腦的桌。 */
function soloRoom(overrides: Partial<RoomView> = {}): RoomView {
  return makeRoom({
    status: 'playing',
    gameId: 'g1',
    members: [makeMember(), makeBotMember({ playerId: 'p2', nickname: 'Ada', seat: 1, color: 'blue' })],
    ...overrides,
  });
}

/** 自己（p1）與另一位真人（p2，預設在線）。 */
function duoRoom(overrides: Partial<RoomView> = {}, other: Partial<ReturnType<typeof makeMember>> = {}): RoomView {
  return makeRoom({
    status: 'playing',
    gameId: 'g1',
    members: [
      makeMember(),
      makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', ...HUMAN, ...other }),
    ],
    ...overrides,
  });
}

function pendingAbandon(overrides: Partial<AbandonProposalView> = {}): AbandonProposalView {
  return {
    id: 'ab1',
    proposedBy: 'p2',
    consents: ['p2'],
    absent: ['p3'],
    createdAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

/** 三位真人：自己、p2（在線）、p3（離線，缺席）。 */
function trioRoom(overrides: Partial<RoomView> = {}): RoomView {
  return makeRoom({
    status: 'playing',
    gameId: 'g1',
    members: [
      makeMember(),
      makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', ...HUMAN }),
      makeMember({ playerId: 'p3', nickname: 'Bo', seat: 2, color: 'orange', connected: false, ...HUMAN }),
    ],
    ...overrides,
  });
}

/** 四位真人：自己、p2 與 p4（在線）、p3（離線，缺席）；自己不是最後一票。 */
function quadRoom(overrides: Partial<RoomView> = {}): RoomView {
  const base = trioRoom();
  return makeRoom({
    ...base,
    members: [...base.members, makeMember({ playerId: 'p4', nickname: 'Cy', seat: 3, color: 'white', ...HUMAN })],
    ...overrides,
  });
}

/** 按「同意結束」只會進入行內確認；回傳確認區塊。 */
function startApprove(): HTMLElement {
  fireEvent.click(screen.getByTestId('abandon-approve'));
  return screen.getByTestId('abandon-approve-step');
}

function renderApp(api: FakeApi, languages: readonly string[] = ['en']) {
  return render(<App services={{ api, storage: memoryStorage(), languages, connectSocket: false }} />);
}

/** 以房間代碼進入進行中的對局（會載入房間資料）。 */
async function enterTable(api: FakeApi, languages?: readonly string[]): Promise<void> {
  renderApp(api, languages);
  fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
  fireEvent.click(screen.getByTestId('join-room'));
  // 完整牌桌（含 SVG 棋盤）在高負載下渲染較慢，放寬等待時間以免偶發逾時。
  await screen.findByTestId('board-svg', {}, { timeout: 8000 });
}

function openLeaveDialog(): HTMLElement {
  fireEvent.click(screen.getByTestId('leave-game'));
  return screen.getByTestId('leave-dialog');
}

const abandonedSnapshot = () =>
  makeSnapshot(makeView({ result: { playerId: null, reason: 'abandoned' } }), 13);

describe('API client', () => {
  it('sends the documented abandon and withdraw requests', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { abandoned: false } }) };
    };
    const api = new ApiClient(fetchImpl);
    await api.abandonGame('g/1');
    await api.abandonGame('g1', { proposalId: 'ab1', approve: false });
    await api.withdrawGame('g1', true);
    await api.withdrawGame('g1', false);
    await api.suspendGame('g1');
    await api.suspendGame('g1', { proposalId: 'sus1', approve: true });
    await api.resumeGame('g1', false);
    expect(calls).toEqual([
      { url: '/api/games/g%2F1/abandon', method: 'POST', body: {} },
      { url: '/api/games/g1/abandon', method: 'POST', body: { proposalId: 'ab1', approve: false } },
      { url: '/api/games/g1/withdraw', method: 'POST', body: { withdrawn: true } },
      { url: '/api/games/g1/withdraw', method: 'POST', body: { withdrawn: false } },
      { url: '/api/games/g1/suspend', method: 'POST', body: {} },
      { url: '/api/games/g1/suspend', method: 'POST', body: { proposalId: 'sus1', approve: true } },
      { url: '/api/games/g1/resume', method: 'POST', body: { ready: false } },
    ]);
  });

  it('sends the entry epoch in the leave body only when one is given', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { left: true, hostTransferredTo: null } }) };
    };
    const api = new ApiClient(fetchImpl);
    await api.leaveRoom('r/1');
    await api.leaveRoom('r1', { entryEpoch: 4 });
    expect(calls).toEqual([
      { url: '/api/rooms/r%2F1/leave', method: 'POST', body: undefined },
      { url: '/api/rooms/r1/leave', method: 'POST', body: { entryEpoch: 4 } },
    ]);
  });
});

describe('leave entry', () => {
  it('is the only way to leave from the table, visible in the status strip', async () => {
    await enterTable(createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) }));
    const button = screen.getByTestId('leave-game');
    expect(button.closest('[data-testid="status-strip"]')).toBeTruthy();
    expect(button.getAttribute('aria-label')).toBe('Leave this game');
    expect(button.closest('details')).toBeNull();
    // 舊的右下角牌桌選單已併入離開對話框，牌桌上不再有第二個保存或暫停入口。
    expect(screen.queryByTestId('table-menu')).toBeNull();
    expect(screen.queryByTestId('save-and-leave')).toBeNull();
    expect(screen.queryByTestId('suspend-propose')).toBeNull();
  });

  it('reminds that the seat is bound to this browser', async () => {
    await enterTable(createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) }));
    openLeaveDialog();
    expect(screen.getByTestId('leave-identity').textContent).toContain('this browser');
  });

  it('is not offered on the result screen', async () => {
    const api = createFakeApi({ room: soloRoom({ status: 'abandoned' }), snapshot: abandonedSnapshot() });
    await enterTable(api);
    expect(await screen.findByTestId('result-no-winner')).toBeTruthy();
    expect(screen.queryByTestId('leave-game')).toBeNull();
  });

  it('returns focus to the leave button when the dialog is cancelled', async () => {
    await enterTable(createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) }));
    const button = screen.getByTestId('leave-game');
    button.focus();
    openLeaveDialog();
    fireEvent.click(screen.getByTestId('leave-cancel'));
    expect(screen.queryByTestId('leave-dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('only offers saving while the room has not loaded yet', async () => {
    const api = createFakeApi({ snapshot: makeSnapshot(makeView()) });
    renderApp(api);
    fireEvent.click(await screen.findByTestId('resume-g1'));
    await screen.findByTestId('board-svg', {}, { timeout: 8000 });
    openLeaveDialog();
    expect(screen.getByTestId('leave-keep')).toBeTruthy();
    expect(screen.queryByTestId('leave-withdraw')).toBeNull();
    expect(screen.queryByTestId('leave-end')).toBeNull();
  });
});

describe('leaving a table with only computer players', () => {
  it('keeps the game: saves and returns to the resume list', async () => {
    const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    const dialog = openLeaveDialog();
    expect(dialog.textContent).toContain('Keep the game');
    fireEvent.click(screen.getByTestId('leave-keep'));
    await waitFor(() => expect(api.callsOf('saveGame')).toHaveLength(1));
    expect(await screen.findByTestId('resume-list')).toBeTruthy();
    expect(api.callsOf('abandonGame')).toHaveLength(0);
    expect(api.callsOf('withdrawGame')).toHaveLength(0);
  });

  it('asks again before ending, and the second step explains it is final', async () => {
    const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    openLeaveDialog();
    fireEvent.click(screen.getByTestId('leave-end'));
    // 第一步只切換內容，還沒有送出任何請求。
    expect(api.callsOf('abandonGame')).toHaveLength(0);
    const confirm = screen.getByTestId('leave-confirm-end');
    expect(confirm.textContent).toContain('no winner');
    expect(confirm.textContent).toContain('cannot be continued');
    // 返回後仍可選擇保留。
    fireEvent.click(screen.getByTestId('leave-back'));
    expect(screen.getByTestId('leave-keep')).toBeTruthy();
  });

  it('ends the game and shows the result screen', async () => {
    const api = createFakeApi({
      room: soloRoom(),
      snapshot: makeSnapshot(makeView()),
      abandonResult: { ok: true, data: { proposalId: 'ab1', abandoned: true } },
    });
    await enterTable(api);
    openLeaveDialog();
    fireEvent.click(screen.getByTestId('leave-end'));
    // 伺服器端此時已結束對局，重新抓取會得到終局的房間與投影。
    api.setRoom(soloRoom({ status: 'abandoned' }));
    api.setSnapshot(abandonedSnapshot());
    fireEvent.click(screen.getByTestId('leave-end-confirm'));

    expect(await screen.findByTestId('result-no-winner')).toBeTruthy();
    expect(api.callsOf('abandonGame')).toHaveLength(1);
    expect(api.callsOf('abandonGame')[0]!.args).toEqual(['g1', undefined]);
    expect(screen.getByTestId('result-screen').textContent).toContain('Ended without a winner');
    expect(screen.queryByTestId('leave-dialog')).toBeNull();
    // 已結束的對局不再列在可恢復清單的請求結果裡。
    expect(api.callsOf('listGames').length).toBeGreaterThan(1);
  });

  it('disables ending, with the reason, when the room does not allow abandonment', async () => {
    const api = createFakeApi({
      room: soloRoom({ policy: makePolicy({ allowAbandonment: false }) }),
      snapshot: makeSnapshot(makeView()),
    });
    await enterTable(api);
    openLeaveDialog();
    const end = screen.getByTestId('leave-end') as HTMLButtonElement;
    expect(end.disabled).toBe(true);
    expect(screen.getByTestId('leave-end-disabled').textContent).toContain('does not allow ending a game without a winner');
    expect(end.getAttribute('aria-describedby')).toBe('leave-end-help');
    fireEvent.click(end);
    expect(api.callsOf('abandonGame')).toHaveLength(0);
    // 保留對局不受影響。
    expect((screen.getByTestId('leave-keep') as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps the dialog open and reports the error when the server refuses to end the game', async () => {
    const api = createFakeApi({
      room: soloRoom(),
      snapshot: makeSnapshot(makeView()),
      abandonResult: { ok: false, error: { code: 'E_ABANDON_DISABLED', messageId: 'error.E_ABANDON_DISABLED' } },
    });
    await enterTable(api);
    openLeaveDialog();
    fireEvent.click(screen.getByTestId('leave-end'));
    fireEvent.click(screen.getByTestId('leave-end-confirm'));
    await waitFor(() => expect(api.callsOf('abandonGame')).toHaveLength(1));
    expect((await screen.findByTestId('toast')).textContent).toContain('has disabled ending an interrupted game');
    expect(screen.getByTestId('leave-dialog')).toBeTruthy();
    expect((screen.getByTestId('leave-end-confirm') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a failed save inside the dialog and stays on the table', async () => {
    const api = createFakeApi({
      room: soloRoom(),
      snapshot: makeSnapshot(makeView()),
      saveResult: {
        ok: true,
        data: { requestId: 'r', gameId: 'g1', revision: 12, savedAt: '2026-01-02T00:00:00.000Z', outcome: 'failed', error: { messageId: 'error.E_NETWORK' } },
      },
    });
    await enterTable(api);
    openLeaveDialog();
    fireEvent.click(screen.getByTestId('leave-keep'));
    expect(await screen.findByTestId('leave-save-failed')).toBeTruthy();
    expect(screen.getByTestId('board-svg')).toBeTruthy();
  });
});

describe('leaving a table with other people', () => {
  it('explains save and leave and keeps it as the primary action', async () => {
    const api = createFakeApi({ room: duoRoom(), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    const dialog = openLeaveDialog();
    expect(dialog.textContent).toContain('Save and leave');
    expect(dialog.textContent).toContain('until it is your turn');
    expect(screen.queryByTestId('leave-end')).toBeNull();
    fireEvent.click(screen.getByTestId('leave-keep'));
    await waitFor(() => expect(api.callsOf('saveGame')).toHaveLength(1));
    expect(await screen.findByTestId('resume-list')).toBeTruthy();
    expect(api.callsOf('withdrawGame')).toHaveLength(0);
  });

  it('withdraws after a second confirmation and returns home', async () => {
    const api = createFakeApi({ room: duoRoom(), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    openLeaveDialog();
    fireEvent.click(screen.getByTestId('leave-withdraw'));
    expect(api.callsOf('withdrawGame')).toHaveLength(0);
    const confirm = screen.getByTestId('leave-confirm-withdraw');
    expect(confirm.textContent).toContain('not be able to act until you come back');
    expect(confirm.textContent).toContain('If everyone withdraws');
    fireEvent.click(screen.getByTestId('leave-withdraw-confirm'));
    await waitFor(() => expect(api.callsOf('withdrawGame')).toHaveLength(1));
    expect(api.callsOf('withdrawGame')[0]!.args).toEqual(['g1', true]);
    expect(await screen.findByTestId('resume-list')).toBeTruthy();
  });

  it('does not promise that everyone withdrawing ends the game when abandonment is disabled', async () => {
    const api = createFakeApi({
      room: duoRoom({ policy: makePolicy({ allowAbandonment: false }) }),
      snapshot: makeSnapshot(makeView()),
    });
    await enterTable(api);
    openLeaveDialog();
    fireEvent.click(screen.getByTestId('leave-withdraw'));
    expect(screen.getByTestId('leave-confirm-withdraw').textContent).not.toContain('If everyone withdraws');
  });

  it('goes to the result screen when the withdrawal ends the game', async () => {
    const api = createFakeApi({
      room: duoRoom({}, { withdrawn: true }),
      snapshot: makeSnapshot(makeView()),
      withdrawResult: { ok: true, data: { withdrawn: true, abandoned: true } },
    });
    await enterTable(api);
    openLeaveDialog();
    fireEvent.click(screen.getByTestId('leave-withdraw'));
    api.setRoom(duoRoom({ status: 'abandoned' }, { withdrawn: true }));
    api.setSnapshot(abandonedSnapshot());
    fireEvent.click(screen.getByTestId('leave-withdraw-confirm'));
    expect(await screen.findByTestId('result-no-winner')).toBeTruthy();
  });

  it('keeps the dialog open when withdrawing fails', async () => {
    const api = createFakeApi({
      room: duoRoom(),
      snapshot: makeSnapshot(makeView()),
      withdrawResult: { ok: false, error: { code: 'E_GAME_OVER', messageId: 'error.E_GAME_OVER' } },
    });
    await enterTable(api);
    openLeaveDialog();
    fireEvent.click(screen.getByTestId('leave-withdraw'));
    fireEvent.click(screen.getByTestId('leave-withdraw-confirm'));
    expect((await screen.findByTestId('toast')).textContent).toContain('The game is over.');
    expect(screen.getByTestId('leave-dialog')).toBeTruthy();
  });

  it('offers a proposal that names the absent players only when somebody is absent', async () => {
    const present = createFakeApi({ room: duoRoom(), snapshot: makeSnapshot(makeView()) });
    await enterTable(present);
    openLeaveDialog();
    expect(screen.queryByTestId('leave-propose-end')).toBeNull();
  });

  it('proposes ending the game for an absent player and shows the vote afterwards', async () => {
    const api = createFakeApi({ room: trioRoom(), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    openLeaveDialog();
    expect(screen.getByTestId('leave-propose-end').textContent).toContain('Propose ending the game (no winner)');
    expect(screen.getByRole('dialog').textContent).toContain('Absent or withdrawn: Bo');
    fireEvent.click(screen.getByTestId('leave-propose-end'));
    const confirm = screen.getByTestId('leave-confirm-end');
    expect(confirm.textContent).toContain('Bo');
    expect(confirm.textContent).toContain('no winner');
    api.setRoom(trioRoom({ pendingAbandon: pendingAbandon({ proposedBy: 'p1', consents: ['p1'] }) }));
    fireEvent.click(screen.getByTestId('leave-end-confirm'));
    await waitFor(() => expect(api.callsOf('abandonGame')).toHaveLength(1));
    expect(api.callsOf('abandonGame')[0]!.args).toEqual(['g1', undefined]);
    // 提案送出後對話框關閉，橫幅顯示等待其他人同意。
    await waitFor(() => expect(screen.queryByTestId('leave-dialog')).toBeNull());
    expect(screen.getByTestId('abandon-proposal')).toBeTruthy();
    expect(screen.getByTestId('abandon-waiting').textContent).toContain('You agreed.');
    expect(screen.getByTestId('abandon-waiting').textContent).toContain('小美');
  });

  it('does not offer a proposal when the room disallows abandonment', async () => {
    const api = createFakeApi({
      room: trioRoom({ policy: makePolicy({ allowAbandonment: false }) }),
      snapshot: makeSnapshot(makeView()),
    });
    await enterTable(api);
    openLeaveDialog();
    expect(screen.queryByTestId('leave-propose-end')).toBeNull();
  });

  it('lets a withdrawn player return from the dialog', async () => {
    const api = createFakeApi({
      room: makeRoom({
        status: 'playing',
        gameId: 'g1',
        members: [makeMember({ withdrawn: true }), makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', ...HUMAN })],
      }),
      snapshot: makeSnapshot(makeView()),
    });
    await enterTable(api);
    openLeaveDialog();
    expect(screen.queryByTestId('leave-withdraw')).toBeNull();
    fireEvent.click(screen.getByTestId('leave-return'));
    await waitFor(() => expect(api.callsOf('withdrawGame')).toHaveLength(1));
    expect(api.callsOf('withdrawGame')[0]!.args).toEqual(['g1', false]);
    await waitFor(() => expect(screen.queryByTestId('leave-dialog')).toBeNull());
  });

  it('renders the dialog in Traditional Chinese', async () => {
    await enterTable(createFakeApi({ room: duoRoom(), snapshot: makeSnapshot(makeView()) }), ['zh-TW']);
    fireEvent.change(screen.getByTestId('locale-switch-game'), { target: { value: 'zh-Hant' } });
    const dialog = openLeaveDialog();
    expect(dialog.textContent).toContain('保存並離開');
    expect(dialog.textContent).toContain('退出對局（投降）');
    expect(screen.getByTestId('leave-game').getAttribute('aria-label')).toBe('離開這場對局');
  });
});

describe('abandonment vote banner', () => {
  it('names the proposer and the absent players, and approving only asks for confirmation first', async () => {
    const api = createFakeApi({ room: trioRoom({ pendingAbandon: pendingAbandon() }), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    const banner = screen.getByTestId('abandon-proposal');
    expect(within(banner).getByTestId('abandon-summary').textContent).toContain('小美 proposed ending this saved game with no winner');
    expect(within(banner).getByTestId('abandon-summary').textContent).toContain('Absent or withdrawn: Bo');
    const step = startApprove();
    // 第一下不送出，投票按鈕換成確認區塊。
    expect(api.callsOf('abandonGame')).toHaveLength(0);
    expect(screen.queryByTestId('abandon-approve')).toBeNull();
    expect(screen.queryByTestId('abandon-reject')).toBeNull();
    expect(document.activeElement).toBe(step);
    fireEvent.click(screen.getByTestId('abandon-approve-confirm'));
    await waitFor(() => expect(api.callsOf('abandonGame')).toHaveLength(1));
    expect(api.callsOf('abandonGame')[0]!.args).toEqual(['g1', { proposalId: 'ab1', approve: true }]);
  });

  it('warns that the viewer’s agreement ends the game at once when it is the last vote', async () => {
    const api = createFakeApi({ room: trioRoom({ pendingAbandon: pendingAbandon() }), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    startApprove();
    const warning = screen.getByTestId('abandon-approve-warning').textContent!;
    expect(warning).toContain('Your agreement ends the game at once');
    expect(warning).toContain('no winner');
    expect(warning).toContain('cannot be continued');
  });

  it('explains the conditional ending when others have not agreed yet', async () => {
    const api = createFakeApi({ room: quadRoom({ pendingAbandon: pendingAbandon() }), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    startApprove();
    const warning = screen.getByTestId('abandon-approve-warning').textContent!;
    expect(warning).toContain('If everyone else has agreed too, the game ends at once with no winner');
    expect(warning).not.toContain('Your agreement ends the game at once');
  });

  it('goes back from the confirmation without sending and restores focus to the approve button', async () => {
    const api = createFakeApi({ room: trioRoom({ pendingAbandon: pendingAbandon() }), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    startApprove();
    fireEvent.click(screen.getByTestId('abandon-approve-back'));
    expect(api.callsOf('abandonGame')).toHaveLength(0);
    expect(screen.queryByTestId('abandon-approve-step')).toBeNull();
    expect(screen.getByTestId('abandon-reject')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('abandon-approve')));
  });

  it('closes the confirmation with Escape without sending', async () => {
    const api = createFakeApi({ room: trioRoom({ pendingAbandon: pendingAbandon() }), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    const step = startApprove();
    fireEvent.keyDown(step, { key: 'Escape' });
    expect(screen.queryByTestId('abandon-approve-step')).toBeNull();
    expect(api.callsOf('abandonGame')).toHaveLength(0);
    expect(screen.getByTestId('abandon-approve')).toBeTruthy();
  });

  it('lets a voter decline', async () => {
    const api = createFakeApi({ room: trioRoom({ pendingAbandon: pendingAbandon() }), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    fireEvent.click(screen.getByTestId('abandon-reject'));
    await waitFor(() => expect(api.callsOf('abandonGame')).toHaveLength(1));
    expect(api.callsOf('abandonGame')[0]!.args).toEqual(['g1', { proposalId: 'ab1', approve: false }]);
  });

  it('shows the result when the last vote ends the game', async () => {
    const api = createFakeApi({
      room: trioRoom({ pendingAbandon: pendingAbandon() }),
      snapshot: makeSnapshot(makeView()),
      abandonResult: { ok: true, data: { abandoned: true } },
    });
    await enterTable(api);
    api.setRoom(trioRoom({ status: 'abandoned' }));
    api.setSnapshot(abandonedSnapshot());
    startApprove();
    fireEvent.click(screen.getByTestId('abandon-approve-confirm'));
    expect(await screen.findByTestId('result-no-winner')).toBeTruthy();
  });

  it('treats a missing proposal as a cancelled vote: refetches the room and says so', async () => {
    const api = createFakeApi({
      room: trioRoom({ pendingAbandon: pendingAbandon() }),
      snapshot: makeSnapshot(makeView()),
      abandonResult: { ok: false, error: { code: 'E_NO_PROPOSAL', messageId: 'error.E_NO_PROPOSAL' } },
    });
    await enterTable(api);
    const roomFetches = api.callsOf('getRoom').length;
    // 提案在伺服器端已被取消（例如有人撤回退出）。
    api.setRoom(trioRoom());
    startApprove();
    fireEvent.click(screen.getByTestId('abandon-approve-confirm'));
    expect((await screen.findByTestId('toast')).textContent).toContain('The vote to end the game was cancelled.');
    await waitFor(() => expect(screen.queryByTestId('abandon-proposal')).toBeNull());
    expect(api.callsOf('getRoom').length).toBeGreaterThan(roomFetches);
  });

  it('shows who is still to agree instead of vote buttons once the viewer has agreed', async () => {
    const api = createFakeApi({
      room: trioRoom({ pendingAbandon: pendingAbandon({ proposedBy: 'p1', consents: ['p1'] }) }),
      snapshot: makeSnapshot(makeView()),
    });
    await enterTable(api);
    expect(screen.queryByTestId('abandon-approve')).toBeNull();
    const waiting = screen.getByTestId('abandon-waiting').textContent;
    expect(waiting).toContain('You agreed.');
    expect(waiting).toContain('Waiting for 小美 to agree.');
  });

  it('does not ask a withdrawn player to vote', async () => {
    const api = createFakeApi({
      room: makeRoom({
        status: 'playing',
        gameId: 'g1',
        members: [
          makeMember({ withdrawn: true }),
          makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', ...HUMAN }),
        ],
        pendingAbandon: pendingAbandon({ consents: ['p2'], absent: ['p1'] }),
      }),
      snapshot: makeSnapshot(makeView()),
    });
    await enterTable(api);
    expect(screen.getByTestId('abandon-proposal')).toBeTruthy();
    expect(screen.queryByTestId('abandon-approve')).toBeNull();
  });

  it('renders the vote in Traditional Chinese', async () => {
    const api = createFakeApi({ room: trioRoom({ pendingAbandon: pendingAbandon() }), snapshot: makeSnapshot(makeView()) });
    await enterTable(api, ['zh-TW']);
    fireEvent.change(screen.getByTestId('locale-switch-game'), { target: { value: 'zh-Hant' } });
    expect(screen.getByTestId('abandon-approve').textContent).toBe('同意結束');
    expect(screen.getByTestId('abandon-reject').textContent).toBe('拒絕');
    expect(screen.getByTestId('abandon-summary').textContent).toContain('缺席或已退出：Bo');
    startApprove();
    expect(screen.getByTestId('abandon-approve-warning').textContent).toContain('你的同意會立即結束對局');
    expect(screen.getByTestId('abandon-approve-confirm').textContent).toBe('確認結束');
  });
});

describe('withdrawn seats', () => {
  it('lets the withdrawn viewer take the withdrawal back from the banner', async () => {
    const api = createFakeApi({
      room: makeRoom({
        status: 'playing',
        gameId: 'g1',
        members: [makeMember({ withdrawn: true }), makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', ...HUMAN })],
      }),
      snapshot: makeSnapshot(makeView()),
    });
    await enterTable(api);
    const banner = screen.getByTestId('withdrawn-banner');
    expect(banner.textContent).toContain('You have withdrawn');
    // 撤回後伺服器端的座位不再是退出狀態。
    api.setRoom(duoRoom());
    fireEvent.click(screen.getByTestId('retract-withdrawal'));
    await waitFor(() => expect(api.callsOf('withdrawGame')).toHaveLength(1));
    expect(api.callsOf('withdrawGame')[0]!.args).toEqual(['g1', false]);
    await waitFor(() => expect(screen.queryByTestId('withdrawn-banner')).toBeNull());
  });

  it('tells the others who withdrew and offers to propose ending through the confirmation step', async () => {
    const api = createFakeApi({ room: duoRoom({}, { withdrawn: true }), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    const hint = screen.getByTestId('withdrawn-hint');
    expect(hint.textContent).toContain('小美 withdrew. The game waits whenever it is their turn.');
    fireEvent.click(screen.getByTestId('abandon-propose'));
    // 不直接送出：先開啟確認步驟並點名。
    expect(api.callsOf('abandonGame')).toHaveLength(0);
    expect(screen.getByTestId('leave-confirm-end').textContent).toContain('小美');
    fireEvent.click(screen.getByTestId('leave-end-confirm'));
    await waitFor(() => expect(api.callsOf('abandonGame')).toHaveLength(1));
  });

  it('hides the hint when the room disallows abandonment or nobody withdrew', async () => {
    const disabled = createFakeApi({
      room: duoRoom({ policy: makePolicy({ allowAbandonment: false }) }, { withdrawn: true }),
      snapshot: makeSnapshot(makeView()),
    });
    await enterTable(disabled);
    expect(screen.queryByTestId('withdrawn-hint')).toBeNull();
  });

  it('marks a withdrawn seat in the players panel, collapsed and expanded', async () => {
    const api = createFakeApi({ room: duoRoom({}, { withdrawn: true }), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    const seat = screen.getByTestId('seat-1');
    expect(seat.dataset.withdrawn).toBe('true');
    expect(seat.getAttribute('title')).toContain('(Withdrawn)');
    expect(within(seat).getByTestId('seat-withdrawn-mark-1')).toBeTruthy();
    expect(seat.textContent).toContain('小美 (Withdrawn)');
    fireEvent.click(screen.getByTestId('players-toggle'));
    expect(within(screen.getByTestId('seat-1')).getByTestId('seat-withdrawn-1').textContent).toBe('Withdrawn');
    expect(screen.getByTestId('seat-0').dataset.withdrawn).toBeUndefined();
    expect(screen.queryByTestId('seat-withdrawn-0')).toBeNull();
  });
});

function pendingSuspend(overrides: Partial<SuspendProposalView> = {}): SuspendProposalView {
  return { id: 'sus1', proposedBy: 'p2', consents: ['p2'], createdAt: '2026-01-02T00:00:00.000Z', ...overrides };
}

describe('saving and pausing the table for everyone (SPEC §4.8)', () => {
  it('is not offered at a table with only computer players', async () => {
    await enterTable(createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) }));
    openLeaveDialog();
    expect(screen.queryByTestId('leave-suspend')).toBeNull();
  });

  it('proposes from the leave dialog, stays at the table and shows the wait', async () => {
    const api = createFakeApi({ room: duoRoom(), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    openLeaveDialog();
    // 伺服器記下提案後，重新抓到的房間檢視帶著這個提案。
    api.setRoom(duoRoom({ pendingSuspend: pendingSuspend({ proposedBy: 'p1', consents: ['p1'] }) }));
    fireEvent.click(screen.getByTestId('leave-suspend'));
    await waitFor(() => expect(screen.queryByTestId('leave-dialog')).toBeNull());
    expect(api.callsOf('suspendGame')[0]!.args).toEqual(['g1', undefined]);
    expect(api.callsOf('saveGame')).toHaveLength(0);
    expect(api.callsOf('leaveRoom')).toHaveLength(0);
    expect((await screen.findByTestId('suspend-waiting')).textContent).toBe('You agreed. Waiting for 小美 to agree.');
    expect(screen.queryByTestId('suspend-approve')).toBeNull();
    expect(screen.getByTestId('board-svg')).toBeTruthy();

    // 已有提案時，對話框不再提供第二次提議。
    openLeaveDialog();
    expect(screen.queryByTestId('leave-suspend')).toBeNull();
    fireEvent.click(screen.getByTestId('leave-cancel'));

    api.setRoom(duoRoom());
    fireEvent.click(screen.getByTestId('suspend-withdraw'));
    await waitFor(() => expect(screen.queryByTestId('suspend-proposal')).toBeNull());
    expect(api.callsOf('suspendGame')[1]!.args).toEqual(['g1', { proposalId: 'sus1', approve: false }]);
  });

  it('keeps the table on screen when the proposal suspends the game at once', async () => {
    // 回歸：回應是 `{ proposalId, suspended }` 而不是 RoomView；曾被當成房間寫入而讓牌桌整個黑掉。
    const api = createFakeApi({
      room: duoRoom(),
      snapshot: makeSnapshot(makeView()),
      suspendResult: { ok: true, data: { proposalId: 'sus1', suspended: true } },
    });
    await enterTable(api);
    openLeaveDialog();
    api.setRoom(duoRoom({ status: 'suspended', resumeReady: [] }));
    fireEvent.click(screen.getByTestId('leave-suspend'));
    expect(await screen.findByTestId('resume-bar')).toBeTruthy();
    expect(screen.getByTestId('board-svg')).toBeTruthy();
    expect(screen.getByTestId('leave-game')).toBeTruthy();
  });

  it('lets the other players agree or decline from the table banner', async () => {
    const api = createFakeApi({ room: trioRoom({ pendingSuspend: pendingSuspend() }), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    expect(screen.getByTestId('suspend-summary').textContent).toContain('小美 proposed saving and pausing');
    fireEvent.click(screen.getByTestId('suspend-approve'));
    await waitFor(() => expect(api.callsOf('suspendGame')).toHaveLength(1));
    expect(api.callsOf('suspendGame')[0]!.args).toEqual(['g1', { proposalId: 'sus1', approve: true }]);
    fireEvent.click(screen.getByTestId('suspend-reject'));
    await waitFor(() => expect(api.callsOf('suspendGame')).toHaveLength(2));
    expect(api.callsOf('suspendGame')[1]!.args).toEqual(['g1', { proposalId: 'sus1', approve: false }]);
  });

  it('names everyone who still has to agree, including absent players', async () => {
    const api = createFakeApi({
      room: trioRoom({ pendingSuspend: pendingSuspend({ consents: ['p2', 'p1'] }) }),
      snapshot: makeSnapshot(makeView()),
    });
    await enterTable(api);
    expect(screen.getByTestId('suspend-waiting').textContent).toBe('You agreed. Waiting for Bo to agree.');
    // 不是提案者：沒有撤回提案的按鈕。
    expect(screen.queryByTestId('suspend-withdraw')).toBeNull();
  });

  it('reports a proposal that is already gone', async () => {
    const api = createFakeApi({
      room: trioRoom({ pendingSuspend: pendingSuspend() }),
      snapshot: makeSnapshot(makeView()),
      suspendResult: { ok: false, error: { code: 'E_NO_PROPOSAL', messageId: 'error.E_NO_PROPOSAL' } },
    });
    await enterTable(api);
    api.setRoom(trioRoom());
    fireEvent.click(screen.getByTestId('suspend-approve'));
    expect((await screen.findByTestId('toast')).textContent).toContain('proposal to save and pause was cancelled');
    await waitFor(() => expect(screen.queryByTestId('suspend-proposal')).toBeNull());
  });

  it('collects readiness to resume and can take it back', async () => {
    const api = createFakeApi({ room: duoRoom({ status: 'suspended', resumeReady: [] }), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    expect(screen.getByTestId('resume-bar').textContent).toContain('Game saved and paused');
    api.setRoom(duoRoom({ status: 'suspended', resumeReady: ['p1'] }));
    fireEvent.click(screen.getByTestId('resume-ready'));
    expect((await screen.findByTestId('resume-waiting')).textContent).toBe('You are ready. Waiting for 小美.');
    expect(api.callsOf('resumeGame')[0]!.args).toEqual(['g1', true]);

    api.setRoom(duoRoom({ status: 'suspended', resumeReady: [] }));
    fireEvent.click(screen.getByTestId('resume-not-ready'));
    await screen.findByTestId('resume-ready');
    expect(api.callsOf('resumeGame')[1]!.args).toEqual(['g1', false]);
  });

  it('offers readiness again when everyone is ready but the table is still paused', async () => {
    // 例如服務重啟留下的準備紀錄：自己已準備、沒有在等任何人，再送一次準備讓伺服器重新判斷。
    const api = createFakeApi({ room: duoRoom({ status: 'suspended', resumeReady: ['p1', 'p2'] }), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    expect(screen.queryByTestId('resume-not-ready')).toBeNull();
    expect(screen.queryByTestId('resume-waiting')).toBeNull();
    fireEvent.click(screen.getByTestId('resume-ready'));
    await waitFor(() => expect(api.callsOf('resumeGame')).toHaveLength(1));
    expect(api.callsOf('resumeGame')[0]!.args).toEqual(['g1', true]);
  });

  it('leaves a paused table without offering another pause', async () => {
    const api = createFakeApi({ room: duoRoom({ status: 'suspended', resumeReady: [] }), snapshot: makeSnapshot(makeView()) });
    await enterTable(api);
    const dialog = openLeaveDialog();
    expect(dialog.textContent).toContain('saved and paused, so you can leave safely');
    expect(dialog.textContent).toContain('the game stays paused');
    expect(screen.queryByTestId('leave-suspend')).toBeNull();
    fireEvent.click(screen.getByTestId('leave-keep'));
    await waitFor(() => expect(api.callsOf('saveGame')).toHaveLength(1));
    expect(await screen.findByTestId('resume-list')).toBeTruthy();
  });

  it('is written in Traditional Chinese', async () => {
    const api = createFakeApi({
      identity: makeIdentity({ locale: 'zh-Hant' }),
      room: duoRoom(),
      snapshot: makeSnapshot(makeView()),
    });
    await enterTable(api, ['zh-Hant']);
    openLeaveDialog();
    expect(screen.getByTestId('leave-suspend').textContent).toBe('提議全桌保存並暫停');
  });
});

describe('resume list', () => {
  it('marks a game whose seat is withdrawn', async () => {
    const api = createFakeApi({
      games: [
        makeResumable({ gameId: 'g1', withdrawn: true }),
        makeResumable({ gameId: 'g2', roomId: 'r2' }),
      ],
    });
    renderApp(api);
    expect((await screen.findByTestId('resume-withdrawn-g1')).textContent).toBe('Withdrawn');
    expect(screen.queryByTestId('resume-withdrawn-g2')).toBeNull();
  });

  it('shows the mark in Traditional Chinese', async () => {
    renderApp(createFakeApi({ identity: makeIdentity({ locale: 'zh-Hant' }), games: [makeResumable({ withdrawn: true })] }));
    expect((await screen.findByTestId('resume-withdrawn-g1')).textContent).toBe('已退出');
  });
});
