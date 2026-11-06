import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApiResult, ClientMessage, LeaveRoomResult, RoomView, ServerMessage } from '@catan/protocol';
import type { SocketLike } from '../src/api/socket.ts';
import { App } from '../src/App.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import { makeBotMember, makeMember, makeRoom, makeSnapshot, makeView } from '../src/test/fixtures.ts';

/** 離開牌桌之後不能再被推送拉回牌桌（SPEC §4.6、§4.8）。 */

// 完整牌桌在高負載下渲染很慢，放寬 findBy／waitFor 的預設等待，避免偶發逾時。
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'board-surface') return { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900, toJSON() {} };
    return original.call(this);
  });
});

/**
 * 記錄送出的訊息，並能模擬伺服器推送。收到取消訂閱（空的 subscribe）時預設自動回 `unsubscribed`，
 * 與伺服器一致；測試可關掉 `autoAck`，改由 `ack()` 手動確認。
 */
class PushSocket implements SocketLike {
  sent: ClientMessage[] = [];
  autoAck = true;
  #room: string | null = null;
  #open: (() => void) | null = null;
  #message: ((data: string) => void) | null = null;
  send(data: string) {
    const message = JSON.parse(data) as ClientMessage;
    this.sent.push(message);
    if (message.type !== 'subscribe') return;
    if (message.payload.roomId) {
      this.#room = message.payload.roomId;
      return;
    }
    const previous = this.#room;
    this.#room = null;
    if (this.autoAck) setTimeout(() => this.ack(previous), 0);
  }
  close() {}
  onOpen(handler: () => void) { this.#open = handler; }
  onClose() {}
  onMessage(handler: (data: string) => void) { this.#message = handler; }
  onError() {}
  open() { this.#open?.(); }
  push(message: ServerMessage) { this.#message?.(JSON.stringify(message)); }
  // 確認內容多帶進房世代，與伺服器之後的欄位一致；以斷言略過協定型別的欄位差異。
  ack(roomId: string | null = 'r1') { this.push({ type: 'unsubscribed', payload: { roomId, entryEpoch: 1 } } as ServerMessage); }
  subscribes() { return this.sent.filter((message) => message.type === 'subscribe'); }
}

function soloRoom(overrides: Partial<RoomView> = {}): RoomView {
  return makeRoom({
    status: 'playing',
    gameId: 'g1',
    members: [makeMember(), makeBotMember({ playerId: 'p2', nickname: 'Ada', seat: 1, color: 'blue' })],
    ...overrides,
  });
}

function duoRoom(overrides: Partial<RoomView> = {}): RoomView {
  return makeRoom({
    status: 'playing',
    gameId: 'g1',
    members: [makeMember(), makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', host: false })],
    ...overrides,
  });
}

async function enterTable(
  api: FakeApi,
  leaveTimeoutMs?: number,
  configure: (socket: PushSocket) => void = () => {},
  unsubscribeTimeoutMs?: number,
): Promise<PushSocket> {
  const socket = new PushSocket();
  configure(socket);
  render(
    <App
      services={{
        api,
        storage: memoryStorage(),
        languages: ['en'],
        socketFactory: () => socket,
        ...(leaveTimeoutMs === undefined ? {} : { leaveTimeoutMs }),
        ...(unsubscribeTimeoutMs === undefined ? {} : { unsubscribeTimeoutMs }),
      }}
    />,
  );
  act(() => socket.open());
  fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
  fireEvent.click(screen.getByTestId('join-room'));
  await screen.findByTestId('board-svg', {}, { timeout: 8000 });
  await waitFor(() => expect(socket.subscribes()).toContainEqual({ type: 'subscribe', payload: { roomId: 'r1', gameId: 'g1' } }));
  return socket;
}

/** 伺服器在取消訂閱生效前仍推送同一房與同一局的訊息。 */
async function pushLate(socket: PushSocket, room: RoomView): Promise<void> {
  await act(async () => {
    socket.push({ type: 'room', payload: room });
    socket.push({ type: 'snapshot', payload: makeSnapshot(makeView(), 14) });
    socket.push({ type: 'presence', payload: { roomId: 'r1', members: room.members } });
    socket.push({ type: 'events', payload: { gameId: 'g1', revision: 14, events: [{ seq: 13, type: 'turn.ended', params: {} }] } });
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

function expectHome() {
  expect(screen.queryByTestId('board-svg')).toBeNull();
  expect(screen.getByTestId('resume-list')).toBeTruthy();
}

const lastSubscribe = (socket: PushSocket) => socket.subscribes().at(-1);

type LeaveResult = ApiResult<LeaveRoomResult>;

/** 讓 `/leave` 的回應等到 `release()` 才回來，可選擇回傳指定結果。 */
function holdLeave(api: FakeApi, result?: LeaveResult): () => void {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = api.leaveRoom.bind(api);
  api.leaveRoom = async (roomId: string) => {
    const fallback = await original(roomId);
    await gate;
    return result ?? fallback;
  };
  return release;
}

const NETWORK_FAILURE: LeaveResult = { ok: false, error: { code: 'E_NETWORK', messageId: 'error.E_NETWORK' } };

function expectStillAtTable() {
  expect(screen.getByTestId('board-svg')).toBeTruthy();
  expect(screen.queryByTestId('resume-list')).toBeNull();
}

describe('leaving the table', () => {
  it('save and leave against bots unsubscribes, leaves the room and ignores late pushes', async () => {
    const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
    const socket = await enterTable(api);
    fireEvent.click(screen.getByTestId('leave-game'));
    fireEvent.click(screen.getByTestId('leave-keep'));
    await screen.findByTestId('resume-list');

    expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} });
    await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
    expect(api.callsOf('leaveRoom')[0]!.args).toEqual(['r1']);

    await pushLate(socket, soloRoom());
    expectHome();
    // 重新整理的非同步回應也不能把房間拉回來。
    expect(screen.queryByTestId('result-screen')).toBeNull();
  });

  it('withdrawing unsubscribes, leaves the room and ignores late pushes', async () => {
    const api = createFakeApi({ room: duoRoom(), snapshot: makeSnapshot(makeView()) });
    const socket = await enterTable(api);
    fireEvent.click(screen.getByTestId('leave-game'));
    fireEvent.click(screen.getByTestId('leave-withdraw'));
    fireEvent.click(screen.getByTestId('leave-withdraw-confirm'));
    await screen.findByTestId('resume-list');

    expect(api.callsOf('withdrawGame')[0]!.args).toEqual(['g1', true]);
    expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} });
    await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
    expect(api.callsOf('leaveRoom')[0]!.args).toEqual(['r1']);

    await pushLate(socket, duoRoom({ members: [makeMember({ withdrawn: true }), makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', host: false })] }));
    expectHome();
  });

  it('stays on the table with a busy dialog until the leave request returns, then goes home', async () => {
    const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
    const release = holdLeave(api);
    const socket = await enterTable(api);
    fireEvent.click(screen.getByTestId('leave-game'));
    fireEvent.click(screen.getByTestId('leave-keep'));
    await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));

    // 已取消訂閱、已忽略該房的推送，但畫面還在牌桌，首頁（Resume）不可達。
    expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} });
    expectStillAtTable();
    expect(screen.getByTestId('leave-dialog')).toBeTruthy();
    expect((screen.getByTestId('leave-keep') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('leave-end') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('leave-cancel') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('leave-working').textContent).toContain('Working');
    // 忙碌期間 Escape 與關閉鈕都不會關掉對話框。
    fireEvent.keyDown(screen.getByTestId('leave-dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('leave-dialog')).toBeTruthy();
    // 這段期間的推送不會改寫畫面。
    await pushLate(socket, soloRoom());
    expectStillAtTable();
    expect(api.callsOf('leaveRoom')).toHaveLength(1);

    release();
    await screen.findByTestId('resume-list');
    expect(screen.queryByTestId('board-svg')).toBeNull();
    expect(api.callsOf('leaveRoom')).toHaveLength(1);
  });

  it('keeps the menu save button disabled and sends no second leave while leaving', async () => {
    const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
    const release = holdLeave(api);
    await enterTable(api);
    const menuSave = screen.getByTestId('save-and-leave') as HTMLButtonElement;
    fireEvent.click(menuSave);
    await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
    expect(menuSave.disabled).toBe(true);
    expect(screen.getByTestId('save-state').getAttribute('data-state')).toBe('pending');
    fireEvent.click(menuSave);
    expect(api.callsOf('saveGame')).toHaveLength(1);
    release();
    await screen.findByTestId('resume-list');
    expect(api.callsOf('leaveRoom')).toHaveLength(1);
  });

  it('still goes home, with an error toast, when the leave request fails after a save', async () => {
    const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
    holdLeave(api, NETWORK_FAILURE)();
    const socket = await enterTable(api);
    fireEvent.click(screen.getByTestId('leave-game'));
    fireEvent.click(screen.getByTestId('leave-keep'));
    await screen.findByTestId('resume-list');
    expect(api.callsOf('saveGame')).toHaveLength(1);
    expect(screen.getByTestId('toast').textContent).toBeTruthy();
    expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} });
    await pushLate(socket, soloRoom());
    expectHome();
  });

  it('withdrawing also waits for the leave request before going home', async () => {
    const api = createFakeApi({ room: duoRoom(), snapshot: makeSnapshot(makeView()) });
    const release = holdLeave(api);
    const socket = await enterTable(api);
    fireEvent.click(screen.getByTestId('leave-game'));
    fireEvent.click(screen.getByTestId('leave-withdraw'));
    fireEvent.click(screen.getByTestId('leave-withdraw-confirm'));
    await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
    expectStillAtTable();
    expect((screen.getByTestId('leave-withdraw-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('leave-working')).toBeTruthy();
    expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} });
    release();
    await screen.findByTestId('resume-list');
  });

  it('announces a host transfer caused by leaving', async () => {
    const api = createFakeApi({ room: duoRoom(), snapshot: makeSnapshot(makeView()) });
    api.leaveRoom = async () => ({ ok: true, data: { left: true as const, hostTransferredTo: '小美' } });
    await enterTable(api);
    fireEvent.click(screen.getByTestId('leave-game'));
    fireEvent.click(screen.getByTestId('leave-keep'));
    expect((await screen.findByTestId('toast')).textContent).toContain('Host role transferred to 小美.');
  });

  it('resuming the same game from home receives pushes again', async () => {
    const api = createFakeApi({ room: duoRoom(), snapshot: makeSnapshot(makeView()) });
    const socket = await enterTable(api);
    fireEvent.click(screen.getByTestId('leave-game'));
    fireEvent.click(screen.getByTestId('leave-keep'));
    await screen.findByTestId('resume-list');
    await pushLate(socket, duoRoom());
    expectHome();

    fireEvent.click(screen.getByTestId('resume-g1'));
    await screen.findByTestId('board-svg', {}, { timeout: 8000 });
    await waitFor(() => expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: { roomId: 'r1', gameId: 'g1' } }));
    // 重新進入後，伺服器推送的房間（含他人已退出）要能顯示。
    await act(async () => {
      socket.push({
        type: 'room',
        payload: duoRoom({ members: [makeMember(), makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', host: false, withdrawn: true })] }),
      });
    });
    expect(await screen.findByTestId('withdrawn-hint')).toBeTruthy();
  });

  it('rejoining the left room by its code receives pushes again', async () => {
    const api = createFakeApi({ room: duoRoom(), snapshot: makeSnapshot(makeView()) });
    const socket = await enterTable(api);
    fireEvent.click(screen.getByTestId('leave-game'));
    fireEvent.click(screen.getByTestId('leave-keep'));
    await screen.findByTestId('resume-list');
    await pushLate(socket, duoRoom());
    expectHome();

    fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
    fireEvent.click(screen.getByTestId('join-room'));
    await screen.findByTestId('board-svg', {}, { timeout: 8000 });
    await act(async () => {
      socket.push({
        type: 'room',
        payload: duoRoom({ members: [makeMember(), makeMember({ playerId: 'p2', nickname: '小美', seat: 1, color: 'blue', host: false, withdrawn: true })] }),
      });
    });
    expect(await screen.findByTestId('withdrawn-hint')).toBeTruthy();
  });

  it('the result screen leave also unsubscribes and is not pulled back by late pushes', async () => {
    const api = createFakeApi({
      room: duoRoom({ status: 'abandoned' }),
      snapshot: makeSnapshot(makeView({ result: { playerId: null, reason: 'abandoned' } }), 13),
    });
    const socket = await enterTable(api);
    fireEvent.click(await screen.findByTestId('back-to-lobby'));
    await screen.findByTestId('create-room');
    expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} });
    expect(api.callsOf('leaveRoom')[0]!.args).toEqual(['r1']);

    await pushLate(socket, duoRoom({ status: 'abandoned' }));
    expect(screen.queryByTestId('result-screen')).toBeNull();
    expect(screen.queryByTestId('board-svg')).toBeNull();
  });

  it('the result screen waits for the leave request, ignoring pushes meanwhile', async () => {
    const api = createFakeApi({
      room: duoRoom({ status: 'abandoned' }),
      snapshot: makeSnapshot(makeView({ result: { playerId: null, reason: 'abandoned' } }), 13),
    });
    const release = holdLeave(api);
    const socket = await enterTable(api);
    fireEvent.click(await screen.findByTestId('back-to-lobby'));
    await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
    expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} });
    // 離開請求還沒回來：仍在結果畫面，推送不改寫它（例如被拉去大廳）。
    await act(async () => {
      socket.push({ type: 'room', payload: duoRoom({ status: 'lobby', gameId: null }) });
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(screen.getByTestId('result-screen')).toBeTruthy();
    expect(screen.queryByTestId('room-code')).toBeNull();
    release();
    await screen.findByTestId('create-room');
    expect(screen.queryByTestId('result-screen')).toBeNull();
  });

  it('a failed leave from the result screen resubscribes, stays put and reports the error', async () => {
    const api = createFakeApi({
      room: duoRoom({ status: 'abandoned' }),
      snapshot: makeSnapshot(makeView({ result: { playerId: null, reason: 'abandoned' } }), 13),
    });
    holdLeave(api, NETWORK_FAILURE)();
    const socket = await enterTable(api);
    fireEvent.click(await screen.findByTestId('back-to-lobby'));
    await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
    expect((await screen.findByTestId('toast')).textContent).toBeTruthy();
    expect(screen.getByTestId('result-screen')).toBeTruthy();
    expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: { roomId: 'r1', gameId: 'g1' } });
    // 標記已移除，之後伺服器的推送恢復生效（這裡以房間回到 lobby 狀態為證）。
    await act(async () => {
      socket.push({ type: 'room', payload: duoRoom({ status: 'lobby', gameId: null }) });
    });
    expect(await screen.findByTestId('room-code')).toBeTruthy();
  });

  it('leaving a lobby waits for the leave request and, on failure, stays in the lobby subscribed', async () => {
    const api = createFakeApi({ room: makeRoom() });
    const release = holdLeave(api, NETWORK_FAILURE);
    const socket = new PushSocket();
    render(<App services={{ api, storage: memoryStorage(), languages: ['en'], socketFactory: () => socket }} />);
    act(() => socket.open());
    fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
    fireEvent.click(screen.getByTestId('join-room'));
    await screen.findByTestId('room-code');
    await waitFor(() => expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: { roomId: 'r1' } }));

    fireEvent.click(screen.getByTestId('leave-room'));
    await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
    expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} });
    expect(screen.getByTestId('room-code')).toBeTruthy();
    release();
    expect((await screen.findByTestId('toast')).textContent).toBeTruthy();
    expect(screen.getByTestId('room-code')).toBeTruthy();
    expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: { roomId: 'r1' } });
  });

  it('gives up waiting for a stuck leave request: goes home with a toast and stays operable', async () => {
    const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
    holdLeave(api); // 永不 release：伺服器沒有回應
    const socket = await enterTable(api, 50);
    fireEvent.click(screen.getByTestId('leave-game'));
    fireEvent.click(screen.getByTestId('leave-keep'));
    // （等待期間仍在牌桌的行為由上面的忙碌對話框測試以預設逾時驗證；這裡逾時很短，不在中間斷言。）
    await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
    // 逾時後走失敗路徑：存檔已成功，座位保留，回首頁並提示。
    await screen.findByTestId('resume-list');
    expect(screen.getByTestId('toast').textContent).toContain('slow to confirm that you left. Your seat is kept.');
    expect(screen.queryByTestId('leave-dialog')).toBeNull();
    expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} });
    await pushLate(socket, soloRoom());
    expectHome();
    // 首頁可操作：可以再次進入這一局。
    fireEvent.click(screen.getByTestId('resume-g1'));
    await screen.findByTestId('board-svg', {}, { timeout: 8000 });
  });

  it('ignores a leave response that arrives after the timeout', async () => {
    const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
    const release = holdLeave(api, { ok: true, data: { left: true, hostTransferredTo: '小美' } });
    await enterTable(api, 50);
    fireEvent.click(screen.getByTestId('leave-game'));
    fireEvent.click(screen.getByTestId('leave-keep'));
    await screen.findByTestId('resume-list');
    // 使用者已經重新進入同一局，遲到的回應不能再動畫面或宣告房主移轉。
    fireEvent.click(screen.getByTestId('resume-g1'));
    await screen.findByTestId('board-svg', {}, { timeout: 8000 });
    const listCalls = api.callsOf('listGames').length;
    release();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(screen.getByTestId('board-svg')).toBeTruthy();
    expect(screen.queryByTestId('resume-list')).toBeNull();
    expect(screen.queryByText(/Host role transferred/)).toBeNull();
    expect(api.callsOf('listGames')).toHaveLength(listCalls);
  });

  it('a stuck leave from the result screen times out, restores the subscription and stays put', async () => {
    const api = createFakeApi({
      room: duoRoom({ status: 'abandoned' }),
      snapshot: makeSnapshot(makeView({ result: { playerId: null, reason: 'abandoned' } }), 13),
    });
    const release = holdLeave(api, { ok: true, data: { left: true, hostTransferredTo: null } });
    const socket = await enterTable(api, 50);
    fireEvent.click(await screen.findByTestId('back-to-lobby'));
    expect((await screen.findByTestId('toast')).textContent).toContain('Leaving the room timed out');
    expect(screen.getByTestId('result-screen')).toBeTruthy();
    expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: { roomId: 'r1', gameId: 'g1' } });
    // 遲到的成功回應不會再把畫面帶走。
    release();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(screen.getByTestId('result-screen')).toBeTruthy();
    expect(screen.queryByTestId('create-room')).toBeNull();
    // 之後可以再按一次。
    fireEvent.click(screen.getByTestId('back-to-lobby'));
    await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(2));
  });

  it('repeated taps on the result screen leave send a single leave request', async () => {
    const api = createFakeApi({
      room: duoRoom({ status: 'abandoned' }),
      snapshot: makeSnapshot(makeView({ result: { playerId: null, reason: 'abandoned' } }), 13),
    });
    const release = holdLeave(api);
    await enterTable(api);
    const back = await screen.findByTestId('back-to-lobby');
    fireEvent.click(back);
    fireEvent.click(back);
    fireEvent.click(back);
    await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
    release();
    await screen.findByTestId('create-room');
    expect(api.callsOf('leaveRoom')).toHaveLength(1);
  });

  it('repeated taps on the lobby leave send a single leave request', async () => {
    const api = createFakeApi({ room: makeRoom() });
    const release = holdLeave(api);
    render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
    fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
    fireEvent.click(screen.getByTestId('join-room'));
    const leave = await screen.findByTestId('leave-room');
    fireEvent.click(leave);
    fireEvent.click(leave);
    await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
    release();
    await screen.findByTestId('create-room');
    expect(api.callsOf('leaveRoom')).toHaveLength(1);
  });

  describe('waiting for the unsubscribe acknowledgement', () => {
    const sleep = (ms = 40) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

    it('save and leave sends the leave request only after the acknowledgement', async () => {
      const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
      const socket = await enterTable(api, undefined, (pushSocket) => { pushSocket.autoAck = false; });
      fireEvent.click(screen.getByTestId('leave-game'));
      fireEvent.click(screen.getByTestId('leave-keep'));
      await waitFor(() => expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} }));
      await sleep();
      // 取消訂閱已送出，確認還沒到：API 不會被呼叫，畫面也還在牌桌。
      expect(api.callsOf('leaveRoom')).toHaveLength(0);
      expectStillAtTable();
      act(() => socket.ack('r1'));
      await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
      await screen.findByTestId('resume-list');
    });

    it('withdrawing sends the leave request only after the acknowledgement', async () => {
      const api = createFakeApi({ room: duoRoom(), snapshot: makeSnapshot(makeView()) });
      const socket = await enterTable(api, undefined, (pushSocket) => { pushSocket.autoAck = false; });
      fireEvent.click(screen.getByTestId('leave-game'));
      fireEvent.click(screen.getByTestId('leave-withdraw'));
      fireEvent.click(screen.getByTestId('leave-withdraw-confirm'));
      await waitFor(() => expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} }));
      await sleep();
      expect(api.callsOf('withdrawGame')).toHaveLength(1);
      expect(api.callsOf('leaveRoom')).toHaveLength(0);
      act(() => socket.ack('r1'));
      await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
      await screen.findByTestId('resume-list');
    });

    it('leaving from the result screen sends the leave request only after the acknowledgement', async () => {
      const api = createFakeApi({
        room: duoRoom({ status: 'abandoned' }),
        snapshot: makeSnapshot(makeView({ result: { playerId: null, reason: 'abandoned' } }), 13),
      });
      const socket = await enterTable(api, undefined, (pushSocket) => { pushSocket.autoAck = false; });
      fireEvent.click(await screen.findByTestId('back-to-lobby'));
      await waitFor(() => expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} }));
      await sleep();
      expect(api.callsOf('leaveRoom')).toHaveLength(0);
      expect(screen.getByTestId('result-screen')).toBeTruthy();
      act(() => socket.ack('r1'));
      await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
      await screen.findByTestId('create-room');
    });

    it('leaving a lobby sends the leave request only after the acknowledgement', async () => {
      const api = createFakeApi({ room: makeRoom() });
      const socket = new PushSocket();
      socket.autoAck = false;
      render(<App services={{ api, storage: memoryStorage(), languages: ['en'], socketFactory: () => socket }} />);
      act(() => socket.open());
      fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
      fireEvent.click(screen.getByTestId('join-room'));
      await screen.findByTestId('room-code');
      await waitFor(() => expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: { roomId: 'r1' } }));
      fireEvent.click(screen.getByTestId('leave-room'));
      await waitFor(() => expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} }));
      await sleep();
      expect(api.callsOf('leaveRoom')).toHaveLength(0);
      act(() => socket.ack('r1'));
      await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
      await screen.findByTestId('create-room');
    });

    it('still sends the leave request when the acknowledgement times out', async () => {
      const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
      const socket = await enterTable(api, undefined, (pushSocket) => { pushSocket.autoAck = false; }, 60);
      fireEvent.click(screen.getByTestId('leave-game'));
      fireEvent.click(screen.getByTestId('leave-keep'));
      await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
      expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} });
      await screen.findByTestId('resume-list');
    });

    it('sends the leave request straight away when there is no socket connection', async () => {
      const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
      render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
      fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
      fireEvent.click(screen.getByTestId('join-room'));
      await screen.findByTestId('board-svg', {}, { timeout: 8000 });
      fireEvent.click(screen.getByTestId('leave-game'));
      fireEvent.click(screen.getByTestId('leave-keep'));
      await screen.findByTestId('resume-list');
      expect(api.callsOf('leaveRoom')).toHaveLength(1);
    });
  });

  describe('when the server still sees the player in the room (left: false)', () => {
    const IGNORED: LeaveResult = { ok: true, data: { left: false, hostTransferredTo: null } };

    it('a room leave stays put, restores the subscription and explains why', async () => {
      const api = createFakeApi({
        room: duoRoom({ status: 'abandoned' }),
        snapshot: makeSnapshot(makeView({ result: { playerId: null, reason: 'abandoned' } }), 13),
      });
      api.leaveRoom = async (roomId: string) => {
        api.calls.push({ method: 'leaveRoom', args: [roomId] });
        return IGNORED;
      };
      const socket = await enterTable(api);
      fireEvent.click(await screen.findByTestId('back-to-lobby'));
      expect((await screen.findByTestId('toast')).textContent).toContain('still sees you in this room');
      expect(screen.getByTestId('result-screen')).toBeTruthy();
      expect(screen.queryByTestId('create-room')).toBeNull();
      expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: { roomId: 'r1', gameId: 'g1' } });
      // 標記已移除：伺服器的推送再次生效。
      await act(async () => {
        socket.push({ type: 'room', payload: duoRoom({ status: 'lobby', gameId: null }) });
      });
      expect(await screen.findByTestId('room-code')).toBeTruthy();
    });

    it('a lobby leave stays in the lobby', async () => {
      const api = createFakeApi({ room: makeRoom() });
      api.leaveRoom = async (roomId: string) => {
        api.calls.push({ method: 'leaveRoom', args: [roomId] });
        return IGNORED;
      };
      const socket = new PushSocket();
      render(<App services={{ api, storage: memoryStorage(), languages: ['en'], socketFactory: () => socket }} />);
      act(() => socket.open());
      fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
      fireEvent.click(screen.getByTestId('join-room'));
      await screen.findByTestId('room-code');
      fireEvent.click(screen.getByTestId('leave-room'));
      expect((await screen.findByTestId('toast')).textContent).toContain('still sees you in this room');
      expect(screen.getByTestId('room-code')).toBeTruthy();
      await waitFor(() => expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: { roomId: 'r1' } }));
    });

    it('save and leave still goes home, with a toast that another connection is using the seat', async () => {
      const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
      api.leaveRoom = async (roomId: string) => {
        api.calls.push({ method: 'leaveRoom', args: [roomId] });
        return IGNORED;
      };
      const socket = await enterTable(api);
      fireEvent.click(screen.getByTestId('leave-game'));
      fireEvent.click(screen.getByTestId('leave-keep'));
      await screen.findByTestId('resume-list');
      expect(screen.getByTestId('toast').textContent).toContain('still in use by another connection');
      expect(api.callsOf('saveGame')).toHaveLength(1);
      expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} });
      await pushLate(socket, soloRoom());
      expectHome();
    });

    it('withdrawing still goes home with the same toast', async () => {
      const api = createFakeApi({ room: duoRoom(), snapshot: makeSnapshot(makeView()) });
      api.leaveRoom = async (roomId: string) => {
        api.calls.push({ method: 'leaveRoom', args: [roomId] });
        return IGNORED;
      };
      await enterTable(api);
      fireEvent.click(screen.getByTestId('leave-game'));
      fireEvent.click(screen.getByTestId('leave-withdraw'));
      fireEvent.click(screen.getByTestId('leave-withdraw-confirm'));
      await screen.findByTestId('resume-list');
      expect(screen.getByTestId('toast').textContent).toContain('still in use by another connection');
    });

    it('does not announce a host transfer for an ignored leave', async () => {
      const api = createFakeApi({ room: duoRoom(), snapshot: makeSnapshot(makeView()) });
      api.leaveRoom = async () => ({ ok: true, data: { left: false, hostTransferredTo: '小美' } });
      await enterTable(api);
      fireEvent.click(screen.getByTestId('leave-game'));
      fireEvent.click(screen.getByTestId('leave-keep'));
      await screen.findByTestId('resume-list');
      expect(screen.queryByText(/Host role transferred/)).toBeNull();
    });
  });

  it('does not unsubscribe while the table is still open', async () => {
    const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
    const socket = await enterTable(api);
    expect(socket.subscribes().every((message) => message.type === 'subscribe' && message.payload.roomId === 'r1')).toBe(true);
  });
});
