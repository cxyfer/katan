import { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardSceneProps } from '../src/board/render-contract.ts';
import type { CommandRequest } from '@catan/protocol';
import { App } from '../src/App.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import { makeHints, makeSnapshot, makeView } from '../src/test/fixtures.ts';

const sceneMock = vi.hoisted(() => ({
  mounts: 0,
  props: null as BoardSceneProps | null,
  unavailable: null as string | null,
  autoReady: true,
}));

vi.mock('../src/board/three/BoardScene3D.tsx', () => {
  return {
    default: (props: BoardSceneProps) => {
      sceneMock.mounts += 1;
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
        if (sceneMock.autoReady) props.onReady();
      }, [props.onProjection, props.onReady, props.onUnavailable, props.viewport.rect]);
      return <div data-testid="board-scene-mock" aria-hidden="true" />;
    },
  };
});

function renderApp(api: FakeApi) {
  return render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
}

async function openGame(api: FakeApi) {
  renderApp(api);
  fireEvent.click(await screen.findByTestId('resume-g1'));
  await screen.findByTestId('board-svg');
}

beforeEach(() => {
  sceneMock.props = null;
  sceneMock.unavailable = null;
  sceneMock.mounts = 0;
  sceneMock.autoReady = true;
  // Most boundary cases start on SVG and explicitly request the 3D transition.
  history.replaceState(null, '', '/?renderer=svg');
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'board-surface') {
      return { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900, toJSON() {} };
    }
    if (this.dataset.boardStage !== undefined) {
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
});

describe('renderer fallback boundary', { timeout: 15_000 }, () => {
  it('defaults / to auto, waits for 3D readiness, and preserves the controller through fallback', async () => {
    history.replaceState(null, '', '/');
    sceneMock.autoReady = false;
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ hints: makeHints({ legalRoads: [5] }) })) });
    await openGame(api);
    const board = screen.getByTestId('board');
    expect(board.getAttribute('data-requested-renderer')).toBe('auto');
    expect(board.getAttribute('data-effective-renderer')).toBe('svg');
    expect(board.getAttribute('data-renderer-status')).toBe('loading');
    expect(screen.getByTestId('renderer-select')).toHaveProperty('value', 'auto');
    await screen.findByTestId('board-scene-mock');
    act(() => sceneMock.props!.onReady());
    await waitFor(() => expect(board.getAttribute('data-effective-renderer')).toBe('r3f'));
    expect(board.getAttribute('data-renderer-status')).toBe('ready');
    expect(screen.queryByTestId('board-svg')).toBeNull();

    fireEvent.click(screen.getByTestId('action-build.road'));
    fireEvent.click(await screen.findByTestId('target-edge-5'));
    await screen.findByTestId('selection-preview');
    const focus = document.activeElement;
    act(() => sceneMock.props!.onUnavailable('webgl-context-lost'));
    await waitFor(() => expect(board.getAttribute('data-renderer-status')).toBe('failed'));
    expect(board.getAttribute('data-requested-renderer')).toBe('auto');
    expect(board.getAttribute('data-effective-renderer')).toBe('svg');
    expect(screen.getByTestId('board-svg')).toBeTruthy();
    expect(screen.getAllByTestId('target-edge-5')).toHaveLength(1);
    expect(screen.getByTestId('target-edge-5').getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(focus);
    expect(api.callsOf('sendCommand')).toHaveLength(0);

    api.setCommandResult({ ok: true, data: { commandId: 'display-fallback', outcome: 'accepted', revision: 13, events: [] } });
    fireEvent.click(screen.getByTestId('confirm-selection'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    const request = api.callsOf('sendCommand')[0]!.args[1] as CommandRequest;
    expect(request.command).toEqual({ type: 'build.road', edge: 5 });
    expect(request.expectedRevision).toBe(12);
  });

  it('normalizes an unknown renderer query to auto and waits for loading to become ready', async () => {
    history.replaceState(null, '', '/?renderer=not-a-renderer&quality=cinematic');
    await openGame(createFakeApi());
    const board = screen.getByTestId('board');
    expect(board.getAttribute('data-requested-renderer')).toBe('auto');
    expect(board.getAttribute('data-quality')).toBe('standard');
    expect(board.getAttribute('data-renderer-status')).toBe('loading');
    expect(screen.getByTestId('renderer-select')).toHaveProperty('value', 'auto');
    expect(screen.getByTestId('quality-select')).toHaveProperty('value', 'standard');
    await screen.findByTestId('board-scene-mock', {}, { timeout: 5_000 });
    await waitFor(() => expect(board.getAttribute('data-effective-renderer')).toBe('r3f'));
    expect(board.getAttribute('data-renderer-status')).toBe('ready');
  });

  it('keeps an explicit SVG request on the compatibility surface without mounting the scene', async () => {
    history.replaceState(null, '', '/?renderer=svg');
    await openGame(createFakeApi());
    expect(screen.getByTestId('board').getAttribute('data-requested-renderer')).toBe('svg');
    expect(screen.getByTestId('board').getAttribute('data-effective-renderer')).toBe('svg');
    expect(screen.getByTestId('board').getAttribute('data-renderer-status')).toBe('idle');
    expect(sceneMock.mounts).toBe(0);
    expect(screen.queryByTestId('board-scene-mock')).toBeNull();
  });

  it('loads r3f on request, reports effective WebGL replacement only after onReady, and forwards low quality', async () => {
    await openGame(createFakeApi());
    const board = screen.getByTestId('board');
    expect(board.getAttribute('data-renderer-status')).toBe('idle');
    expect(board.getAttribute('data-effective-renderer')).toBe('svg');

    fireEvent.change(screen.getByTestId('renderer-select'), { target: { value: 'r3f' } });
    expect(board.getAttribute('data-requested-renderer')).toBe('r3f');
    expect(board.getAttribute('data-renderer-status')).toBe('loading');
    await screen.findByTestId('board-scene-mock');
    await waitFor(() => expect(board.getAttribute('data-effective-renderer')).toBe('r3f'));
    expect(board.getAttribute('data-renderer-status')).toBe('ready');
    expect(sceneMock.props?.quality).toBe('standard');

    fireEvent.change(screen.getByTestId('quality-select'), { target: { value: 'low' } });
    await waitFor(() => expect(board.getAttribute('data-quality')).toBe('low'));
    expect(sceneMock.props?.quality).toBe('low');
  });

  it('CB-01 returns to SVG on the mocked onUnavailable callback while preserving selection, focus and command ownership', async () => {
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ hints: makeHints({ legalRoads: [5] }) })) });
    await openGame(api);
    fireEvent.click(screen.getByTestId('action-build.road'));
    const target = await screen.findByTestId('target-edge-5');
    target.focus();
    fireEvent.click(target);
    await screen.findByTestId('selection-preview');
    const selectedFocus = document.activeElement;
    expect(selectedFocus).toBe(screen.getByTestId('preview-heading'));

    fireEvent.change(screen.getByTestId('renderer-select'), { target: { value: 'r3f' } });
    await screen.findByTestId('board-scene-mock', {}, { timeout: 5_000 });
    await waitFor(() => expect(screen.getByTestId('board').getAttribute('data-effective-renderer')).toBe('r3f'));
    act(() => sceneMock.props!.onUnavailable('webgl-context-lost'));

    const board = screen.getByTestId('board');
    await waitFor(() => expect(board.getAttribute('data-renderer-status')).toBe('failed'));
    expect(board.getAttribute('data-effective-renderer')).toBe('svg');
    expect(board.getAttribute('data-fallback-reason')).toBe('webgl-context-lost');
    expect(screen.queryByTestId('board-scene-mock')).toBeNull();
    expect(screen.getByTestId('board-svg')).toBeTruthy();
    expect(screen.getByTestId('selection-preview')).toBeTruthy();
    expect(screen.getByTestId('target-edge-5').getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(selectedFocus);
    expect(screen.getByTestId('renderer-retry')).toBeTruthy();
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });

  it('CB-02 keeps the failed SVG view until an explicit retry, then reloads only after onReady', async () => {
    await openGame(createFakeApi());
    fireEvent.change(screen.getByTestId('renderer-select'), { target: { value: 'r3f' } });
    await screen.findByTestId('board-scene-mock');
    await waitFor(() => expect(screen.getByTestId('board').getAttribute('data-effective-renderer')).toBe('r3f'));
    act(() => sceneMock.props!.onUnavailable('scene-error'));
    await waitFor(() => expect(screen.getByTestId('board').getAttribute('data-renderer-status')).toBe('failed'));

    fireEvent.click(screen.getByTestId('zoom-in'));
    expect(screen.getByTestId('board').getAttribute('data-effective-renderer')).toBe('svg');
    expect(screen.getByTestId('board').getAttribute('data-fallback-reason')).toBe('scene-error');

    fireEvent.click(screen.getByTestId('renderer-retry'));
    expect(screen.getByTestId('board').getAttribute('data-renderer-status')).toBe('loading');
    expect(screen.getByTestId('board').getAttribute('data-effective-renderer')).toBe('svg');
    await waitFor(() => expect(screen.getByTestId('board').getAttribute('data-effective-renderer')).toBe('r3f'));
    expect(screen.getByTestId('board').getAttribute('data-fallback-reason')).toBeNull();
  });
});
