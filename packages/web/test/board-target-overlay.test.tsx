import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { BoardIntent } from '../src/board/intent.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import type { CssRect, ProjectedTarget, ProjectionSnapshot, RendererMode, SceneBounds } from '../src/board/render-contract.ts';
import { useBoardViewport } from '../src/board/useBoardViewport.ts';
import { BoardTargetOverlay, TARGET_HIT_SIZE_PX } from '../src/components/BoardTargetOverlay.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { makeView } from '../src/test/fixtures.ts';

const geometry = buildGeometry('hex-r2', 100);
const view = makeView();
const rect: CssRect = { left: 10, top: 20, width: 400, height: 300 };

function target(index: number, x: number, y = 100, visible = true): ProjectedTarget {
  return { kind: 'edge', index, x, y, visible };
}

function OverlayHarness({
  targets,
  onSelect = vi.fn(),
  onAmbiguous = vi.fn(),
  onCancel = vi.fn(),
  consumeSuppressedClick,
}: {
  targets: ProjectedTarget[];
  onSelect?: (kind: 'vertex' | 'edge' | 'hex', index: number) => void;
  onAmbiguous?: (kind: 'vertex' | 'edge' | 'hex', clicked: number, cluster: readonly number[]) => void;
  onCancel?: () => void;
  consumeSuppressedClick?: () => boolean;
}) {
  const fallback = useRef<HTMLButtonElement | null>(null);
  return <LocaleProvider locale="en">
    <button ref={fallback} type="button">Picker</button>
    <BoardTargetOverlay
      targets={targets}
      rect={rect}
      board={view.board}
      topology={geometry.topology}
      nameOf={(id) => id}
      fallbackFocusRef={fallback}
      onSelect={onSelect}
      onAmbiguous={onAmbiguous}
      onCancel={onCancel}
      {...(consumeSuppressedClick ? { consumeSuppressedClick } : {})}
    />
  </LocaleProvider>;
}

describe('BoardTargetOverlay', () => {
  it('renders 44px real buttons and routes intersecting candidates to the picker', () => {
    const onSelect = vi.fn();
    const onAmbiguous = vi.fn();
    render(<OverlayHarness targets={[target(1, 100), target(2, 110), target(3, 180)]}
      onSelect={onSelect} onAmbiguous={onAmbiguous} />);
    const first = screen.getByTestId('target-edge-1');
    expect(first.tagName).toBe('BUTTON');
    expect(first.getAttribute('data-hit-size')).toBe(String(TARGET_HIT_SIZE_PX));
    expect((first as HTMLElement).style.width).toBe('44px');
    expect((first as HTMLElement).style.height).toBe('44px');
    fireEvent.click(first);
    expect(onAmbiguous).toHaveBeenCalledWith('edge', 1, [1, 2]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId('target-edge-3')).toBeTruthy();
  });

  it('draws edge indicators in their projected endpoint direction while keeping the 44px hit box', () => {
    const diagonal: ProjectedTarget = {
      ...target(1, 100, 100),
      endpoints: [
        { x: 90, y: 90, visible: true },
        { x: 110, y: 110, visible: true },
      ],
    };
    const vertical: ProjectedTarget = {
      ...target(2, 160, 100),
      endpoints: [
        { x: 160, y: 80, visible: true },
        { x: 160, y: 120, visible: true },
      ],
    };
    render(<OverlayHarness targets={[diagonal, vertical]} />);

    const diagonalButton = screen.getByTestId('target-edge-1') as HTMLElement;
    const diagonalSvg = screen.getByTestId('target-edge-indicator-1');
    const diagonalLine = diagonalSvg.querySelector('[data-edge-stroke]')!;
    expect(diagonalButton.style.width).toBe('44px');
    expect(diagonalButton.style.height).toBe('44px');
    expect(diagonalSvg.getAttribute('data-edge-angle')).toBe('45');
    expect(diagonalLine.getAttribute('x1')).toBe('12');
    expect(diagonalLine.getAttribute('y1')).toBe('12');
    expect(diagonalLine.getAttribute('x2')).toBe('32');
    expect(diagonalLine.getAttribute('y2')).toBe('32');

    const verticalSvg = screen.getByTestId('target-edge-indicator-2');
    const verticalLine = verticalSvg.querySelector('[data-edge-stroke]')!;
    expect(verticalSvg.getAttribute('data-edge-angle')).toBe('90');
    expect(verticalLine.getAttribute('x1')).toBe('22');
    expect(verticalLine.getAttribute('y1')).toBe('2');
    expect(verticalLine.getAttribute('x2')).toBe('22');
    expect(verticalLine.getAttribute('y2')).toBe('42');
  });

  it('uses overlapping 44px rectangles as ambiguity and renders global targets in local coordinates', () => {
    const onSelect = vi.fn();
    const onAmbiguous = vi.fn();
    render(<OverlayHarness targets={[target(1, 100, 100), target(2, 142, 143)]}
      onSelect={onSelect} onAmbiguous={onAmbiguous} />);
    const first = screen.getByTestId('target-edge-1') as HTMLElement;
    expect(first.style.left).toBe('90px');
    expect(first.style.top).toBe('80px');
    fireEvent.click(first);
    expect(onAmbiguous).toHaveBeenCalledWith('edge', 1, [1, 2]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('exposes the bounded selection with aria-pressed without owning selection state', () => {
    render(<LocaleProvider locale="en">
      <BoardTargetOverlay targets={[target(1, 100)]} rect={rect} board={view.board}
        topology={geometry.topology} nameOf={(id) => id} onSelect={() => undefined}
        selection={{ kind: 'edge', index: 1 }} />
    </LocaleProvider>);
    expect(screen.getByTestId('target-edge-1').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('target-edge-1').className).toContain('board-target--selected');
  });

  it('lets keyboard and an explicit list choice bypass ambiguity and calls the existing callback once', () => {
    const onSelect = vi.fn();
    render(<OverlayHarness targets={[target(1, 100), target(2, 110)]} onSelect={onSelect} />);
    const first = screen.getByTestId('target-edge-1');
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith('edge', 1);
    fireEvent.keyDown(first, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(2);
    // TargetPicker remains parent-owned and uses this same onSelect callback.
    onSelect('edge', 2);
    expect(onSelect).toHaveBeenLastCalledWith('edge', 2);
  });

  it('consumes the one click following a drag/cancel/pinch without selecting', () => {
    const onSelect = vi.fn();
    const consume = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    render(<OverlayHarness targets={[target(1, 100)]} onSelect={onSelect}
      consumeSuppressedClick={consume} />);
    const button = screen.getByTestId('target-edge-1');
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith('edge', 1);
  });

  it('Escape cancels and newly invalid focused targets move focus to the declared fallback', () => {
    const onCancel = vi.fn();
    const rendered = render(<OverlayHarness targets={[target(1, 100, 100, false)]} onCancel={onCancel} />);
    expect(screen.queryByTestId('target-edge-1')).toBeNull();

    rendered.rerender(<OverlayHarness targets={[target(1, 100)]} onCancel={onCancel} />);
    const button = screen.getByTestId('target-edge-1');
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);

    rendered.rerender(<OverlayHarness targets={[]} onCancel={onCancel} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Picker' }));
  });
});

function HookHarness({
  projection = null,
  renderer = 'svg',
  sceneKey,
  showSurface = true,
}: {
  projection?: ProjectionSnapshot | null;
  renderer?: RendererMode;
  sceneKey?: string;
  showSurface?: boolean;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const bounds: SceneBounds = {
    min: { x: -4, y: -0.2, z: -3 },
    max: { x: 4, y: 0.8, z: 3 },
  };
  const controls = useBoardViewport({ geometry, bounds, projection, renderer, sceneKey, surfaceRef });
  const intent: BoardIntent = {
    kind: 'edge',
    commandType: 'build.road',
    labelId: 'play.build.road',
    targets: geometry.edges.slice(0, 3).map((edge) => edge.index),
    fromHints: true,
  };
  return <div data-board-stage="" data-testid="hook-stage">
    {showSurface && <div ref={surfaceRef} data-testid="gesture-surface" {...controls.surfaceProps} />}
    <output data-testid="viewport">{JSON.stringify(controls.viewport)}</output>
    <output data-testid="pan">{JSON.stringify(controls.pan)}</output>
    <output data-testid="gesture">{String(controls.gestureActive)}</output>
    <output data-testid="targets">{controls.projectedTargets(intent).length}</output>
    <button type="button" data-testid="zoom-3" onClick={() => controls.setZoom(3)}>3</button>
    <button type="button" data-testid="zoom-max" onClick={() => controls.setZoom(9)}>max</button>
    <button type="button" data-testid="zoom-min" onClick={() => controls.setZoom(0.1)}>min</button>
    <button type="button" data-testid="fit" onClick={controls.fit}>fit</button>
    <button type="button" data-testid="consume" onClick={(event) => {
      event.currentTarget.dataset.consumed = String(controls.consumeSuppressedClick());
    }}>consume</button>
  </div>;
}

function pointer(element: Element, type: string, id: number, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: id },
    pointerType: { value: 'touch' },
    clientX: { value: x },
    clientY: { value: y },
    button: { value: 0 },
  });
  fireEvent(element, event);
}

describe('useBoardViewport single gesture owner', () => {
  it('measures CSS rect, clamps 0.7–3 zoom, keeps fit center, and emits SVG pan', () => {
    render(<HookHarness />);
    const surface = screen.getByTestId('gesture-surface');
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 10, y: 20, left: 10, top: 20, width: 400, height: 300, right: 410, bottom: 320, toJSON() {},
    });
    fireEvent(window, new Event('resize'));
    expect(JSON.parse(screen.getByTestId('viewport').textContent!)).toMatchObject({
      center: { x: 0, z: 0 }, zoom: 1, rect: { left: 10, top: 20, width: 400, height: 300 },
    });
    expect(screen.getByTestId('targets').textContent).not.toBe('0');

    fireEvent.click(screen.getByTestId('zoom-max'));
    expect(JSON.parse(screen.getByTestId('viewport').textContent!).zoom).toBe(3);
    fireEvent.click(screen.getByTestId('zoom-min'));
    expect(JSON.parse(screen.getByTestId('viewport').textContent!).zoom).toBe(0.7);
    fireEvent.click(screen.getByTestId('zoom-3'));
    const pan = JSON.parse(screen.getByTestId('pan').textContent!);
    expect(pan.x).toBeCloseTo(0.015, 12);
    expect(pan.y).toBeCloseTo(0, 12);
    fireEvent.click(screen.getByTestId('fit'));
    expect(JSON.parse(screen.getByTestId('viewport').textContent!).zoom).toBe(1);
  });

  it('remeasures captured scroll and ancestor layout changes at the same surface size', async () => {
    render(<HookHarness />);
    const surface = screen.getByTestId('gesture-surface');
    let current = {
      x: 10, y: 20, left: 10, top: 20, width: 400, height: 300, right: 410, bottom: 320, toJSON() {},
    };
    vi.spyOn(surface, 'getBoundingClientRect').mockImplementation(() => current);
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('viewport').textContent!).rect.top).toBe(20));

    current = { ...current, y: 80, top: 80, bottom: 380 };
    fireEvent.scroll(document.body);
    await waitFor(() => expect(JSON.parse(screen.getByTestId('viewport').textContent!).rect.top).toBe(80));

    current = { ...current, x: 45, left: 45, right: 445 };
    act(() => screen.getByTestId('hook-stage').classList.add('layout-shifted'));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('viewport').textContent!).rect.left).toBe(45));
  });

  it('clears a positive measured rect when its surface disappears without a scene key change', async () => {
    const rendered = render(<HookHarness />);
    const surface = screen.getByTestId('gesture-surface');
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 10, y: 20, left: 10, top: 20, width: 400, height: 300, right: 410, bottom: 320, toJSON() {},
    });
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('viewport').textContent!).rect.width).toBe(400));

    rendered.rerender(<HookHarness showSurface={false} />);
    await waitFor(() => expect(JSON.parse(screen.getByTestId('viewport').textContent!).rect.width).toBe(0));
    expect(screen.getByTestId('targets').textContent).toBe('0');
  });

  it('suppresses the click after a >=6px drag and clears all pointer state on pointerup', () => {
    render(<HookHarness />);
    const surface = screen.getByTestId('gesture-surface');
    const capture = vi.fn();
    const release = vi.fn();
    Object.defineProperties(surface, {
      setPointerCapture: { configurable: true, value: capture },
      releasePointerCapture: { configurable: true, value: release },
    });
    pointer(surface, 'pointerdown', 1, 20, 20);
    pointer(surface, 'pointermove', 1, 25, 20);
    expect(capture).not.toHaveBeenCalled();
    pointer(surface, 'pointermove', 1, 27, 20);
    expect(capture).toHaveBeenCalledWith(1);
    expect(screen.getByTestId('gesture').textContent).toBe('true');
    pointer(surface, 'pointerup', 1, 27, 20);
    expect(screen.getByTestId('gesture').textContent).toBe('false');
    expect(release).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByTestId('consume'));
    expect(screen.getByTestId('consume').getAttribute('data-consumed')).toBe('true');
    fireEvent.click(screen.getByTestId('consume'));
    expect(screen.getByTestId('consume').getAttribute('data-consumed')).toBe('false');
  });

  it('publishes a resize-to-zero measured rect and invalidates projected targets', () => {
    render(<HookHarness />);
    const surface = screen.getByTestId('gesture-surface');
    const bounds = vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 10, y: 20, left: 10, top: 20, width: 400, height: 300, right: 410, bottom: 320, toJSON() {},
    });
    fireEvent(window, new Event('resize'));
    expect(screen.getByTestId('targets').textContent).not.toBe('0');
    bounds.mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, toJSON() {},
    });
    fireEvent(window, new Event('resize'));
    expect(JSON.parse(screen.getByTestId('viewport').textContent!).rect).toEqual({
      left: 0, top: 0, width: 0, height: 0,
    });
    expect(screen.getByTestId('targets').textContent).toBe('0');
  });

  it('remeasures when a live scene key makes the surface available after the first render', () => {
    const rendered = render(<HookHarness sceneKey="game:false" showSurface={false} />);
    expect(JSON.parse(screen.getByTestId('viewport').textContent!).rect.width).toBe(0);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'gesture-surface') return {
        x: 10, y: 20, left: 10, top: 20, width: 400, height: 300, right: 410, bottom: 320, toJSON() {},
      };
      return { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, toJSON() {} };
    });
    rendered.rerender(<HookHarness sceneKey="game:true" showSurface />);
    expect(JSON.parse(screen.getByTestId('viewport').textContent!).rect).toEqual({
      left: 10, top: 20, width: 400, height: 300,
    });
    expect(screen.getByTestId('targets').textContent).not.toBe('0');
  });

  it('inverts a slanted 3D projection on the board plane instead of using SVG pixel scale', () => {
    const projection: ProjectionSnapshot = {
      viewProjection: [
        0.2, 0.2, 0, 0,
        0, 0, 0, 0,
        0.1, -0.4, 0, 0,
        0, 0, 0, 1,
      ],
      rect,
      version: 1,
      clip: { near: -1, far: 1 },
    };
    render(<HookHarness projection={projection} renderer="r3f" />);
    const surface = screen.getByTestId('gesture-surface');
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width,
      bottom: rect.top + rect.height, toJSON() {},
    });
    fireEvent(window, new Event('resize'));
    fireEvent.click(screen.getByTestId('zoom-3'));
    pointer(surface, 'pointerdown', 7, 20, 20);
    pointer(surface, 'pointermove', 7, 30, 20);
    const viewport = JSON.parse(screen.getByTestId('viewport').textContent!);
    expect(viewport.center.x).toBeCloseTo(-0.2, 8);
    expect(viewport.center.z).toBeCloseTo(-0.1, 8);
  });

  it('invalidates r3f targets when the measured surface is zero or differs from the snapshot rect', () => {
    const liveProjection: ProjectionSnapshot = {
      viewProjection: [
        0.1, 0, 0, 0,
        0, 0.1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
      rect,
      version: 1,
      clip: { near: -1, far: 1 },
    };
    render(<HookHarness projection={liveProjection} renderer="r3f" />);
    const surface = screen.getByTestId('gesture-surface');
    const measured = vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width,
      bottom: rect.top + rect.height, toJSON() {},
    });
    fireEvent(window, new Event('resize'));
    expect(screen.getByTestId('targets').textContent).not.toBe('0');

    measured.mockReturnValue({
      ...rect, x: rect.left + 200, y: rect.top, left: rect.left + 200,
      right: rect.left + rect.width + 200, bottom: rect.top + rect.height, toJSON() {},
    });
    fireEvent(window, new Event('resize'));
    expect(screen.getByTestId('targets').textContent).toBe('0');

    measured.mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, toJSON() {},
    });
    fireEvent(window, new Event('resize'));
    expect(screen.getByTestId('targets').textContent).toBe('0');
  });

  it('marks a second finger as a pinch, keeps zoom clamped, and cancels without stale pointers', () => {
    render(<HookHarness />);
    const surface = screen.getByTestId('gesture-surface');
    Object.defineProperty(surface, 'setPointerCapture', { configurable: true, value: vi.fn() });
    pointer(surface, 'pointerdown', 1, 20, 20);
    pointer(surface, 'pointerdown', 2, 30, 20);
    pointer(surface, 'pointermove', 2, 90, 20);
    expect(JSON.parse(screen.getByTestId('viewport').textContent!).zoom).toBe(3);
    expect(screen.getByTestId('gesture').textContent).toBe('true');
    pointer(surface, 'pointercancel', 2, 90, 20);
    expect(screen.getByTestId('gesture').textContent).toBe('false');
    fireEvent.click(screen.getByTestId('consume'));
    expect(screen.getByTestId('consume').getAttribute('data-consumed')).toBe('true');
    fireEvent.click(screen.getByTestId('consume'));
    expect(screen.getByTestId('consume').getAttribute('data-consumed')).toBe('false');
  });

  it('handles lost capture and blur cleanup, while keyboard zoom and fit remain usable', () => {
    render(<HookHarness />);
    const surface = screen.getByTestId('gesture-surface');
    Object.defineProperty(surface, 'setPointerCapture', { configurable: true, value: vi.fn() });
    pointer(surface, 'pointerdown', 1, 10, 10);
    pointer(surface, 'pointermove', 1, 20, 10);
    fireEvent.lostPointerCapture(surface, { pointerId: 1 });
    expect(screen.getByTestId('gesture').textContent).toBe('false');
    fireEvent.click(screen.getByTestId('consume'));
    expect(screen.getByTestId('consume').getAttribute('data-consumed')).toBe('true');

    surface.focus();
    fireEvent.keyDown(surface, { key: '+' });
    expect(JSON.parse(screen.getByTestId('viewport').textContent!).zoom).toBe(1.25);
    fireEvent.keyDown(surface, { key: '0' });
    expect(JSON.parse(screen.getByTestId('viewport').textContent!).zoom).toBe(1);

    pointer(surface, 'pointerdown', 3, 10, 10);
    fireEvent.blur(surface, { relatedTarget: null });
    expect(screen.getByTestId('gesture').textContent).toBe('false');
  });
});
