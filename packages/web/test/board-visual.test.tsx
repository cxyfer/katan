import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSnapshot, ServerMessage } from '@catan/protocol';
import type { SocketLike } from '../src/api/socket.ts';
import { App } from '../src/App.tsx';
import { buildGeometry, distance } from '../src/board/geometry.ts';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import { makeEvent, makeHints, makeSnapshot, makeView } from '../src/test/fixtures.ts';

beforeEach(() => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'board-surface' || this.dataset.testid === 'game-stage') return { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900, toJSON() {} };
    return original.call(this);
  });
});

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

function rolled(seq: number, dice: [number, number] = [3, 4], gameId = 'g1') {
  const view = makeView({ events: [makeEvent(seq, 'turn.rolled', { dice, total: dice[0] + dice[1] })] });
  view.seq = seq;
  view.turn.dice = dice;
  return { ...makeSnapshot(view, seq - 8), gameId };
}

async function open(api: FakeApi, sockets?: TestSocket[]) {
  render(<App services={{ api, storage: memoryStorage(), languages: ['en'],
    ...(sockets ? { socketFactory: () => { const socket = new TestSocket(); sockets.push(socket); return socket; } } : { connectSocket: false }) }} />);
  if (sockets) act(() => sockets[0]!.open());
  fireEvent.click(await screen.findByTestId('resume-g1'));
  await screen.findByTestId('board-svg');
}

function pointer(element: Element, type: string, id: number, x: number, y: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' }, clientX: { value: x }, clientY: { value: y } });
  fireEvent(element, event);
}
afterEach(() => vi.useRealTimers());

describe('authoritative transport animation (E01–E06, E08–E10)', () => {
  it('plays normal socket snapshots once while duplicate / old data and UI changes preserve progress', async () => {
    const sockets: TestSocket[] = [];
    const api = createFakeApi({ snapshot: rolled(12) });
    await open(api, sockets);
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    vi.useFakeTimers();
    const next = rolled(13, [6, 6]);
    act(() => sockets[0]!.deliver({ type: 'snapshot', payload: next }));
    expect(screen.getByTestId('dice-focus').parentElement).toBe(document.body);
    expect(screen.getByTestId('dice-roll-animation').getAttribute('aria-hidden')).toBe('true');
    const panel = screen.getByTestId('dice-focus').querySelector('.dice-focus__panel');
    expect(screen.getByTestId('dice-focus').getAttribute('data-phase')).toBe('rolling');
    expect(screen.getByTestId('dice-focus').textContent).not.toContain('6 + 6 = 12');
    act(() => vi.advanceTimersByTime(400));
    act(() => {
      sockets[0]!.deliver({ type: 'snapshot', payload: next });
      sockets[0]!.deliver({ type: 'snapshot', payload: rolled(12, [1, 1]) });
    });
    fireEvent.change(screen.getByTestId('locale-switch-game'), { target: { value: 'zh-Hant' } });
    fireEvent.click(screen.getByTestId('hand-toggle'));
    fireEvent.click(screen.getByTestId('zoom-in'));
    fireEvent(window, new Event('resize'));
    expect(screen.getByTestId('dice-focus').querySelector('.dice-focus__panel')).toBe(panel);
    act(() => vi.advanceTimersByTime(1100));
    expect(screen.getByTestId('dice-focus').textContent).toContain('6 + 6 = 12');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    expect(screen.getByTestId('dice-roll-animation').textContent).toContain('6');
    expect(screen.getByTestId('dice-roll-animation').getAttribute('aria-hidden')).toBeNull();
    act(() => sockets[0]!.deliver({ type: 'snapshot', payload: next }));
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  }, 15000);

  it('rebases actual reconnect and gap refetches, then plays subsequent normal snapshots', async () => {
    const sockets: TestSocket[] = [];
    const api = createFakeApi({ snapshot: rolled(12) });
    await open(api, sockets);
    vi.useFakeTimers();
    act(() => sockets[0]!.deliver({ type: 'snapshot', payload: rolled(13) }));
    api.setSnapshot(rolled(50, [6, 6]));
    act(() => sockets[0]!.disconnect());
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    await act(async () => sockets[1]!.open());
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    expect(screen.getByTestId('dice-roll-animation').textContent).toContain('6');
    act(() => sockets[1]!.deliver({ type: 'snapshot', payload: rolled(51) }));
    expect(screen.getByTestId('dice-focus')).toBeTruthy();
    api.setSnapshot(rolled(70, [2, 2]));
    await act(async () => sockets[1]!.deliver({ type: 'events', payload: {
      gameId: 'g1', revision: 62, events: [makeEvent(70, 'turn.rolled', { dice: [2, 2] })],
    } }));
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    expect(screen.getByTestId('dice-roll-animation').textContent).toContain('2');
    act(() => sockets[1]!.deliver({ type: 'snapshot', payload: rolled(71) }));
    expect(screen.getByTestId('dice-focus')).toBeTruthy();
    expect(api.callsOf('getGame')).toHaveLength(3);
  });

  it('keeps the latest socket board when an older command-refresh HTTP response arrives late', async () => {
    const sockets: TestSocket[] = [];
    const api = createFakeApi({ snapshot: rolled(12) });
    await open(api, sockets);
    let resolve: (value: { ok: true; data: GameSnapshot }) => void = () => {};
    const pending = new Promise<{ ok: true; data: GameSnapshot }>((done) => { resolve = done; });
    const refresh = vi.spyOn(api, 'getGame').mockReturnValueOnce(pending);
    fireEvent.click(screen.getByTestId('action-endTurn'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    act(() => sockets[0]!.deliver({ type: 'snapshot', payload: rolled(14, [6, 6]) }));
    // A missing seq 13 rebases rather than guessing what happened.
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    await act(async () => resolve({ ok: true, data: rolled(13, [1, 1]) }));
    expect(screen.getByTestId('dice-roll-animation').textContent).toContain('6');
    expect(screen.queryByTestId('dice-focus')).toBeNull();
  });

  it('uses confirmed projection for aggregate production and placement, and cancels the entire overlay on recovery', async () => {
    const sockets: TestSocket[] = [];
    await open(createFakeApi({ snapshot: rolled(12) }), sockets);
    vi.useFakeTimers();
    const produced = rolled(14, [3, 3]);
    produced.view.events = [makeEvent(13, 'turn.rolled', { dice: [3, 3], total: 6 }), makeEvent(14, 'production.resolved', { total: 6, grants: { p1: { lumber: 3 } } })];
    act(() => sockets[0]!.deliver({ type: 'snapshot', payload: produced }));
    expect(screen.queryByTestId('production-flight')).toBeNull();
    expect(screen.getByTestId('production-fallback').textContent).toContain('+3');
    expect(screen.getByTestId('dice-roll-animation').className).not.toContain('rolling');
    act(() => vi.advanceTimersByTime(800));
    expect(screen.queryByTestId('board-effects')).toBeNull();
    const built = rolled(15);
    built.view.events = [makeEvent(15, 'build.city', { playerId: 'p1', vertex: 0 })];
    built.view.board.buildings[0] = { player: 'p1', city: true };
    act(() => sockets[0]!.deliver({ type: 'snapshot', payload: built }));
    expect(screen.getByTestId('building-0').querySelector('.board__building-drop')).toBeTruthy();
    act(() => sockets[0]!.disconnect());
    expect(screen.queryByTestId('board-effects')).toBeNull();
    expect(screen.getByTestId('building-0').querySelector('.board__building-drop')).toBeNull();
    expect(screen.getByTestId('building-0')).toBeTruthy();
  });

  it('interrupts presentation for a new mandatory prompt while its control remains available', async () => {
    const sockets: TestSocket[] = [];
    await open(createFakeApi({ snapshot: rolled(12) }), sockets);
    act(() => sockets[0]!.deliver({ type: 'snapshot', payload: rolled(13) }));
    expect(screen.getByTestId('dice-focus')).toBeTruthy();
    const required = rolled(14);
    required.view.pending = { kind: 'moveRobber', actor: 'p1', cause: 'roll' };
    act(() => sockets[0]!.deliver({ type: 'snapshot', payload: required }));
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    expect(screen.getByTestId('required-action-prompt')).toBeTruthy();
    expect(screen.getAllByTestId(/^target-hex-/).length).toBeGreaterThan(0);
  });
});

describe('CSS target selection and gestures (I02–I05)', () => {
  const geometry = buildGeometry('hex-r2');
  const first = geometry.edges[0]!;
  const mid = (edge: typeof first) => ({ x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2 });
  const second = geometry.edges.slice(1).sort((a, b) => distance(mid(a), mid(first)) - distance(mid(b), mid(first)))[0]!;

  async function board() {
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ hints: makeHints({ legalRoads: [first.index, second.index] }) })) });
    await open(api);
    fireEvent.click(screen.getByTestId('action-build.road'));
    const svg = screen.getByTestId('board-surface');
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 20, left: 10, top: 20, width: 300, height: 800, right: 310, bottom: 820, toJSON() {} });
    fireEvent(window, new Event('resize'));
    return { api, svg };
  }

  it('opens the CSS-pixel ambiguous group and lets the textual picker choose once, without reopening', async () => {
    const { api } = await board();
    fireEvent.click(screen.getByTestId(`target-edge-${first.index}`));
    expect(screen.getByTestId('target-picker').textContent).toContain('Several legal targets');
    fireEvent.click(screen.getByTestId(`picker-edge-${second.index}`));
    expect(screen.queryByTestId('target-picker')).toBeNull();
    expect(screen.getByTestId('selection-preview').textContent).toContain(`Path ${second.index}`);
    expect(screen.getByTestId('board-preview-ghost').getAttribute('aria-hidden')).toBe('true');
    expect(api.callsOf('sendCommand')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('confirm-selection'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(api.callsOf('sendCommand')[0]!.args[1]).toMatchObject({ command: { type: 'build.road', edge: second.index } });
  });

  it('remeasures after resize, preserves zoom, and keeps keyboard / cancel / fit behavior', async () => {
    const { api, svg } = await board();
    fireEvent.click(screen.getByTestId('zoom-in'));
    fireEvent(window, new Event('resize'));
    expect(screen.getByTestId('board').getAttribute('data-zoom')).toBe('1.25');
    fireEvent.keyDown(screen.getByTestId(`target-edge-${first.index}`), { key: 'Enter' });
    expect(screen.getByTestId('selection-preview').textContent).toContain(`Path ${first.index}`);
    fireEvent.click(screen.getByTestId('cancel-selection'));
    expect(screen.queryByTestId('selection-preview')).toBeNull();
    expect(screen.queryByTestId('board-preview-ghost')).toBeNull();
    expect(api.callsOf('sendCommand')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('action-build.road'));
    vi.mocked(svg.getBoundingClientRect).mockReturnValue({ x: 10, y: 20, left: 10, top: 20, width: 1400, height: 1000, right: 1410, bottom: 1020, toJSON() {} });
    fireEvent.keyDown(screen.getByTestId(`target-edge-${first.index}`), { key: 'Enter' });
    expect(screen.queryByTestId('target-picker')).toBeNull();
    expect(screen.getByTestId('selection-preview')).toBeTruthy();
    fireEvent.click(screen.getByTestId('reset-view'));
    expect(screen.getByTestId('board').getAttribute('data-zoom')).toBe('1');
  });

  it('cancels touch pinch / drag without selecting and allows the following deliberate click', async () => {
    const { api, svg } = await board();
    pointer(svg, 'pointerdown', 1, 20, 30);
    pointer(svg, 'pointerdown', 2, 120, 30);
    pointer(svg, 'pointermove', 2, 220, 30);
    expect(screen.getByTestId('board').getAttribute('data-zoom')).toBe('2');
    pointer(svg, 'pointercancel', 2, 220, 30);
    fireEvent.click(screen.getByTestId(`target-edge-${first.index}`));
    expect(screen.queryByTestId('selection-preview')).toBeNull();
    expect(screen.queryByTestId('target-picker')).toBeNull();
    fireEvent.keyDown(screen.getByTestId(`target-edge-${first.index}`), { key: 'Enter' });
    expect(screen.queryByTestId('target-picker')).toBeNull();
    expect(screen.getByTestId('selection-preview')).toBeTruthy();
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });

  it('captures pointers only after a gesture moves, so native target clicks retain their target', async () => {
    const { svg } = await board();
    const capture = vi.fn();
    Object.defineProperty(svg, 'setPointerCapture', { value: capture, configurable: true });
    const target = screen.getByTestId(`target-edge-${first.index}`);
    pointer(target, 'pointerdown', 1, 20, 30);
    expect(capture).not.toHaveBeenCalled();
    pointer(target, 'pointerup', 1, 20, 30);
    fireEvent.click(target);
    expect(screen.getByTestId('target-picker')).toBeTruthy();
    pointer(svg, 'pointerdown', 1, 20, 30);
    pointer(svg, 'pointermove', 1, 80, 90);
    expect(capture).toHaveBeenCalledWith(1);
    pointer(svg, 'pointercancel', 1, 80, 90);
    fireEvent.click(target);
    expect(screen.queryByTestId('selection-preview')).toBeNull();
  });
});
