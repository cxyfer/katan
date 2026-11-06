import { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@catan/protocol';
import type { SocketLike } from '../src/api/socket.ts';
import type { BoardEffectAnchors, BoardSceneProps } from '../src/board/render-contract.ts';
import { boardEffectGroup } from '../src/board/animation.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import { BoardEffects } from '../src/components/BoardEffects.tsx';
import { TOUCH_POINTER_QUERY } from '../src/components/useIsMobile.ts';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { App } from '../src/App.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import { makeEvent, makeHints, makeSnapshot, makeView } from '../src/test/fixtures.ts';

const sceneMock = vi.hoisted(() => ({
  props: null as BoardSceneProps | null,
  unavailable: null as string | null,
}));

vi.mock('../src/board/three/BoardScene3D.tsx', () => ({
  default: (props: BoardSceneProps) => {
    sceneMock.props = props;
    useEffect(() => {
      if (sceneMock.unavailable) {
        props.onUnavailable(sceneMock.unavailable);
        return;
      }
      props.onProjection({
        viewProjection: [1 / 500, 0, 0, 0, 0, 1, 0, 0, 0, 1 / 400, 0, 0, 0, 0, 0, 1],
        rect: props.viewport.rect,
        version: 1,
        clip: { near: -1, far: 1 },
      });
      props.onReady();
    }, [props.onProjection, props.onReady, props.onUnavailable, props.viewport.rect]);
    return <div data-testid="board-scene-mock" aria-hidden="true" />;
  },
}));

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

function rolled(seq: number, dice: [number, number] = [3, 4]) {
  const view = makeView({
    hints: makeHints({ legalRoads: [5] }),
    events: [makeEvent(seq, 'turn.rolled', { dice, total: dice[0] + dice[1] })],
  });
  view.seq = seq;
  view.turn.dice = dice;
  return makeSnapshot(view, seq - 8);
}

function renderApp(api: FakeApi, socket?: TestSocket) {
  return render(<App services={{
    api,
    storage: memoryStorage(),
    languages: ['en'],
    ...(socket ? { socketFactory: () => socket } : { connectSocket: false }),
  }} />);
}

async function openGame(api: FakeApi, socket?: TestSocket) {
  renderApp(api, socket);
  if (socket) act(() => socket.open());
  fireEvent.click(await screen.findByTestId('resume-g1'));
  await screen.findByTestId('board-svg');
}

function installRects() {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'board-surface' || this.dataset.boardStage !== undefined) {
      return { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900, toJSON() {} };
    }
    if (this.dataset.boardAggregate !== undefined) {
      return { x: 800, y: 20, left: 800, top: 20, width: 120, height: 40, right: 920, bottom: 60, toJSON() {} };
    }
    const player = this.dataset.boardSeat;
    if (player) {
      const seat = Number(player.slice(1)) || 0;
      return { x: 20, y: 120 + seat * 80, left: 20, top: 120 + seat * 80, width: 160, height: 56, right: 180, bottom: 176 + seat * 80, toJSON() {} };
    }
    return original.call(this);
  });
  const originalClientRects = HTMLElement.prototype.getClientRects;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.boardSeat !== undefined) {
      return [this.getBoundingClientRect()] as unknown as DOMRectList;
    }
    return originalClientRects.call(this);
  });
}

beforeEach(() => {
  sceneMock.props = null;
  sceneMock.unavailable = null;
  // Start on the compatibility renderer so these tests exercise explicit switches.
  history.replaceState(null, '', '/?renderer=svg');
  installRects();
});

describe('renderer lifecycle and presentation cursor', () => {
  it('keeps an orbit drag on a legal target from selecting it and accepts the next deliberate tap', async () => {
    const api = createFakeApi({ snapshot: rolled(12) });
    await openGame(api);
    fireEvent.change(screen.getByTestId('renderer-select'), { target: { value: 'r3f' } });
    await waitFor(() => expect(screen.getByTestId('board').getAttribute('data-effective-renderer')).toBe('r3f'));
    fireEvent.click(screen.getByTestId('action-build.road'));
    const target = await screen.findByTestId('target-edge-5');
    const pointer = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' },
        button: { value: 0 }, clientX: { value: x }, clientY: { value: y } });
      fireEvent(target, event);
    };
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 120, 116);
    pointer('pointerup', 120, 116);
    fireEvent.click(target);
    expect(sceneMock.props!.viewport.azimuthDeg).toBe(13);
    expect(sceneMock.props!.viewport.elevationDeg).toBe(54);
    expect(screen.queryByTestId('selection-preview')).toBeNull();
    expect(api.callsOf('sendCommand')).toHaveLength(0);
    pointer('pointerdown', 120, 116);
    pointer('pointerup', 120, 116);
    fireEvent.click(target);
    expect(await screen.findByTestId('selection-preview')).toBeTruthy();
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });

  it('exposes camera rotation only in 3D, preserves game selection, and restores the initial view', async () => {
    const api = createFakeApi({ snapshot: rolled(12) });
    await openGame(api);
    for (const testId of ['zoom-in', 'zoom-out', 'reset-view']) {
      const button = screen.getByTestId(testId);
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'));
      expect(button.textContent).toBe('');
    }
    expect(screen.queryByTestId('rotate-left')).toBeNull();
    fireEvent.change(screen.getByTestId('renderer-select'), { target: { value: 'r3f' } });
    await waitFor(() => expect(screen.getByTestId('board').getAttribute('data-effective-renderer')).toBe('r3f'));
    fireEvent.click(screen.getByTestId('action-build.road'));
    fireEvent.click(await screen.findByTestId('target-edge-5'));
    await screen.findByTestId('selection-preview');
    fireEvent.click(screen.getByTestId('board-display-settings'));
    fireEvent.change(screen.getByRole('slider', { name: 'Viewing angle' }), { target: { value: '75' } });
    expect(sceneMock.props!.viewport.elevationDeg).toBe(75);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate right' }));
    expect(sceneMock.props!.viewport.azimuthDeg).toBe(50);
    fireEvent.keyDown(screen.getByTestId('board-surface'), { key: '[' });
    expect(sceneMock.props!.viewport.azimuthDeg).toBe(20);
    fireEvent.keyDown(screen.getByTestId('board-surface'), { key: '[' });
    expect(sceneMock.props!.viewport.azimuthDeg).toBe(350);
    fireEvent.click(screen.getByTestId('reset-view'));
    expect(sceneMock.props!.viewport.azimuthDeg).toBe(20);
    expect(sceneMock.props!.viewport.elevationDeg).toBe(50);
    expect(screen.getByTestId('selection-preview')).toBeTruthy();
    expect(screen.getAllByTestId('target-edge-5')).toHaveLength(1);
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });

  it('leaves zoom and rotation to finger gestures on touch screens, keeping reset, targets and settings', async () => {
    const stub = globalThis.matchMedia;
    vi.spyOn(globalThis, 'matchMedia').mockImplementation((query: string) =>
      query === TOUCH_POINTER_QUERY ? { ...stub(query), matches: true } : stub(query));
    const api = createFakeApi({ snapshot: rolled(12) });
    await openGame(api);
    const cameraButtons = ['zoom-in', 'zoom-out', 'rotate-left', 'rotate-right'];
    for (const testId of cameraButtons) expect(screen.queryByTestId(testId)).toBeNull();
    expect(screen.getByTestId('reset-view')).toBeTruthy();
    expect(screen.getByTestId('board-display-settings')).toBeTruthy();

    fireEvent.change(screen.getByTestId('renderer-select'), { target: { value: 'r3f' } });
    await waitFor(() => expect(screen.getByTestId('board').getAttribute('data-effective-renderer')).toBe('r3f'));
    for (const testId of cameraButtons) expect(screen.queryByTestId(testId)).toBeNull();
    fireEvent.click(screen.getByTestId('action-build.road'));
    expect(await screen.findByTestId('open-target-picker')).toBeTruthy();
    expect(screen.getByTestId('camera-gesture-hint').textContent).toBe('Drag one finger to rotate and tilt · Pinch to zoom · Drag two fingers to pan');

    const surface = screen.getByTestId('board-surface');
    const pointer = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'touch' },
        button: { value: 0 }, clientX: { value: x }, clientY: { value: y } });
      fireEvent(surface, event);
    };
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 160, 100);
    pointer('pointerup', 160, 100);
    expect(sceneMock.props!.viewport.azimuthDeg).not.toBe(20);
    fireEvent.click(screen.getByTestId('reset-view'));
    expect(sceneMock.props!.viewport.azimuthDeg).toBe(20);
  });

  it('L01 cancels the active presentation on a renderer switch and plays only the next authoritative event', async () => {
    const socket = new TestSocket();
    const api = createFakeApi({ snapshot: rolled(12) });
    await openGame(api, socket);
    act(() => socket.deliver({ type: 'snapshot', payload: rolled(13, [6, 6]) }));
    expect(await screen.findByTestId('dice-focus')).toBeTruthy();

    fireEvent.change(screen.getByTestId('renderer-select'), { target: { value: 'r3f' } });
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    await screen.findByTestId('board-scene-mock');
    await waitFor(() => expect(screen.getByTestId('board').getAttribute('data-effective-renderer')).toBe('r3f'));
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    expect(api.callsOf('sendCommand')).toHaveLength(0);

    act(() => socket.deliver({ type: 'snapshot', payload: rolled(14, [2, 2]) }));
    expect((await screen.findByTestId('dice-focus')).getAttribute('data-phase')).toBe('rolling');
    expect(screen.getByTestId('dice-announcement').textContent).toBe('');
  });

  it('L02 context-unavailable callback clears presentation without losing the selected target or replaying on retry', async () => {
    const socket = new TestSocket();
    const api = createFakeApi({ snapshot: rolled(12) });
    await openGame(api, socket);
    fireEvent.change(screen.getByTestId('renderer-select'), { target: { value: 'r3f' } });
    await screen.findByTestId('board-scene-mock');
    await waitFor(() => expect(screen.getByTestId('board').getAttribute('data-effective-renderer')).toBe('r3f'));

    fireEvent.click(screen.getByTestId('action-build.road'));
    const target = await screen.findByTestId('target-edge-5');
    target.focus();
    fireEvent.click(target);
    await screen.findByTestId('selection-preview');
    const selectedFocus = document.activeElement;
    expect(selectedFocus).toBe(screen.getByTestId('preview-heading'));
    act(() => socket.deliver({ type: 'snapshot', payload: rolled(13) }));
    expect(await screen.findByTestId('dice-focus')).toBeTruthy();

    act(() => sceneMock.props!.onUnavailable('webgl-context-lost'));
    await waitFor(() => expect(screen.getByTestId('board').getAttribute('data-renderer-status')).toBe('failed'));
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    expect(screen.queryByTestId('board-effects')).toBeNull();
    expect(screen.getByTestId('selection-preview')).toBeTruthy();
    expect(screen.getByTestId('target-edge-5').getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(selectedFocus);

    fireEvent.click(screen.getByTestId('renderer-retry'));
    await waitFor(() => expect(screen.getByTestId('board').getAttribute('data-effective-renderer')).toBe('r3f'));
    expect(screen.queryByTestId('dice-focus')).toBeNull();
    expect(screen.getByTestId('selection-preview')).toBeTruthy();
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });
});

describe('stage-local effects', () => {
  const geometry = buildGeometry('hex-r2');
  const stage = { left: 0, top: 0, width: 800, height: 600 };
  const aggregate = { left: 100, top: 100, width: 100, height: 40 };

  function productionView() {
    const view = makeView();
    const source = view.board.numbers.findIndex((number, index) => number === 6 && index !== view.board.robber);
    view.board.numbers[source] = 6;
    return { view, source };
  }

  it('E07 derives aggregate/seat travel and production source entirely from measured global CSS anchors', () => {
    const { view, source } = productionView();
    const anchors: BoardEffectAnchors = {
      stage,
      seats: new Map([['p1', { left: 500, top: 300, width: 100, height: 40 }]]),
      aggregate,
      targets: [{ kind: 'hex', index: source, x: 550, y: 250, visible: true }],
    };
    const group = boardEffectGroup('g1', [makeEvent(1, 'production.resolved', { total: 6, grants: { p1: { lumber: 3 } } })]);
    const { container } = render(<LocaleProvider locale="en"><BoardEffects group={group} geometry={geometry} view={view} anchors={anchors} /></LocaleProvider>);
    const flight = container.querySelector('[data-testid="production-flight"]') as SVGGElement;
    expect(flight.style.getPropertyValue('--flight-x')).toBe('434px');
    expect(flight.style.getPropertyValue('--flight-y')).toBe('200px');
    expect(container.querySelector('[data-testid="production-source"]')?.getAttribute('cx')).toBe('550');
    expect(container.querySelector('[data-testid="production-aggregate"]')?.getAttribute('data-anchor')).toBe('dom');
    expect(container.querySelector('[data-testid="board-effects"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('E07 falls back to complete aggregate text without flights when aggregate or seat geometry is unavailable', () => {
    const { view } = productionView();
    const group = boardEffectGroup('g1', [makeEvent(1, 'production.resolved', { total: 6, grants: { p1: { lumber: 3 } } })]);
    const { container } = render(<LocaleProvider locale="en"><BoardEffects group={group} geometry={geometry} view={view} anchors={{
      stage, seats: new Map(), aggregate: null, targets: [],
    }} /></LocaleProvider>);
    expect(container.querySelectorAll('[data-testid="production-flight"]')).toHaveLength(0);
    expect(container.querySelector('[data-testid="production-aggregate"]')?.getAttribute('data-anchor')).toBe('text-fallback');
    expect(container.querySelector('[data-testid="production-fallback"]')?.textContent).toContain('Alex L+3');
  });

  it('E07 never invents a flight for an off-stage seat and keeps hidden effects non-interactive', () => {
    const { view } = productionView();
    const group = boardEffectGroup('g1', [makeEvent(1, 'production.resolved', { total: 6, grants: { p1: { lumber: 3 } } })]);
    const { container } = render(<LocaleProvider locale="en"><BoardEffects group={group} geometry={geometry} view={view} anchors={{
      stage, seats: new Map([['p1', { left: 900, top: 300, width: 100, height: 40 }]]),
      aggregate, targets: [],
    }} /></LocaleProvider>);
    expect(container.querySelectorAll('[data-testid="production-flight"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="production-receipt"]')).toHaveLength(0);
    expect(container.querySelector('[data-testid="production-fallback"]')).toBeTruthy();
    expect(container.querySelectorAll('[tabindex],button,a')).toHaveLength(0);
  });

  it('E07 never draws a flight, receipt, source or DOM aggregate anchor outside the viewport', () => {
    const { view, source } = productionView();
    const group = boardEffectGroup('g1', [makeEvent(1, 'production.resolved', { total: 6, grants: { p1: { lumber: 3 } } })]);
    const tallStage = { left: 0, top: 0, width: 800, height: 1200 };
    const { container } = render(<LocaleProvider locale="en"><BoardEffects group={group} geometry={geometry} view={view} anchors={{
      stage: tallStage,
      seats: new Map([['p1', { left: 500, top: 900, width: 100, height: 40 }]]),
      aggregate: { left: 100, top: 100, width: 100, height: 40 },
      targets: [{ kind: 'hex', index: source, x: 550, y: 900, visible: true }],
    }} /></LocaleProvider>);
    expect(container.querySelectorAll('[data-testid="production-flight"], [data-testid="production-receipt"], [data-testid="production-source"]')).toHaveLength(0);
    expect(container.querySelector('[data-testid="production-aggregate"]')?.getAttribute('data-anchor')).toBe('dom');
    expect(container.querySelector('[data-testid="production-fallback"]')).toBeTruthy();
  });

  it('E07 keeps aggregate text when its center is below the viewport in a partially visible stage', () => {
    const { view, source } = productionView();
    const group = boardEffectGroup('g1', [makeEvent(1, 'production.resolved', { total: 6, grants: { p1: { lumber: 3 } } })]);
    const { container } = render(<LocaleProvider locale="en"><BoardEffects group={group} geometry={geometry} view={view} anchors={{
      stage: { left: 0, top: 500, width: 800, height: 600 },
      seats: new Map([['p1', { left: 500, top: 520, width: 100, height: 40 }]]),
      aggregate: { left: 100, top: 900, width: 100, height: 40 },
      targets: [{ kind: 'hex', index: source, x: 550, y: 520, visible: true }],
    }} /></LocaleProvider>);
    expect(container.querySelectorAll('[data-testid="production-flight"]')).toHaveLength(0);
    expect(container.querySelector('[data-testid="production-aggregate"]')?.getAttribute('data-anchor')).toBe('text-fallback');
    expect(container.querySelector('[data-testid="production-source"]')).toBeTruthy();
  });

  it('E05 keeps one neutral theft card back for every private resource while requiring two measured seats', () => {
    const view = makeView();
    const anchors: BoardEffectAnchors = {
      stage,
      seats: new Map([
        ['p1', { left: 500, top: 300, width: 100, height: 40 }],
        ['p2', { left: 200, top: 200, width: 100, height: 40 }],
      ]),
      aggregate: null,
      targets: [],
    };
    const markup: string[] = [];
    for (const resource of ['ore', 'grain', undefined]) {
      const group = boardEffectGroup('g1', [makeEvent(1, 'robber.stole', { playerId: 'p1', victim: 'p2', ...(resource ? { resource } : {}) })]);
      const rendered = render(<LocaleProvider locale="en"><BoardEffects group={group} geometry={geometry} view={view} anchors={anchors} /></LocaleProvider>);
      const theft = rendered.container.querySelector('[data-testid="neutral-theft"]');
      expect(theft).toBeTruthy();
      expect(rendered.container.textContent).toBe('');
      expect(rendered.container.innerHTML).not.toMatch(/ore|grain|aria-label|title/);
      markup.push(rendered.container.innerHTML);
      rendered.unmount();
    }
    expect(new Set(markup).size).toBe(1);
  });
});
