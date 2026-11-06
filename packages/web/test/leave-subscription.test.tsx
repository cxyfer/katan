import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ClientMessage, RoomView, ServerMessage } from '@catan/protocol';
import type { SocketLike } from '../src/api/socket.ts';
import { App } from '../src/App.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import { makeBotMember, makeMember, makeRoom, makeSnapshot, makeView } from '../src/test/fixtures.ts';

/** 離開牌桌之後不能再被推送拉回牌桌（SPEC §4.6、§4.8）。 */

beforeEach(() => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'board-surface') return { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900, toJSON() {} };
    return original.call(this);
  });
});

/** 記錄送出的訊息，並能模擬伺服器推送。 */
class PushSocket implements SocketLike {
  sent: ClientMessage[] = [];
  #open: (() => void) | null = null;
  #message: ((data: string) => void) | null = null;
  send(data: string) { this.sent.push(JSON.parse(data) as ClientMessage); }
  close() {}
  onOpen(handler: () => void) { this.#open = handler; }
  onClose() {}
  onMessage(handler: (data: string) => void) { this.#message = handler; }
  onError() {}
  open() { this.#open?.(); }
  push(message: ServerMessage) { this.#message?.(JSON.stringify(message)); }
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

async function enterTable(api: FakeApi): Promise<PushSocket> {
  const socket = new PushSocket();
  render(
    <App services={{ api, storage: memoryStorage(), languages: ['en'], socketFactory: () => socket }} />,
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

  it('clears the table and unsubscribes before the leave request returns', async () => {
    const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = api.leaveRoom.bind(api);
    api.leaveRoom = async (roomId: string) => {
      const result = await original(roomId);
      await gate;
      return result;
    };
    const socket = await enterTable(api);
    fireEvent.click(screen.getByTestId('leave-game'));
    fireEvent.click(screen.getByTestId('leave-keep'));
    await screen.findByTestId('resume-list');
    // 離開請求還沒回來，畫面與訂閱已經清掉，這段期間的推送一樣被忽略。
    expect(lastSubscribe(socket)).toEqual({ type: 'subscribe', payload: {} });
    await pushLate(socket, soloRoom());
    expectHome();
    release();
    await waitFor(() => expect(api.callsOf('leaveRoom')).toHaveLength(1));
    expectHome();
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

  it('does not unsubscribe while the table is still open', async () => {
    const api = createFakeApi({ room: soloRoom(), snapshot: makeSnapshot(makeView()) });
    const socket = await enterTable(api);
    expect(socket.subscribes().every((message) => message.type === 'subscribe' && message.payload.roomId === 'r1')).toBe(true);
  });
});
