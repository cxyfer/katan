import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { Matrix4, OrthographicCamera, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { BoardInspectionLayer, INSPECTION_DELAY_MS } from '../src/components/BoardInspection.tsx';
import type { BoardViewportState, ProjectionSnapshot, WorldPoint } from '../src/board/render-contract.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import { HARBOR_STRUCTURE, harborHitOutline, harborLabelPoint, harborPlacement } from '../src/board/harbor.ts';
import { inspectDescription, inspectionElements } from '../src/board/inspection.ts';
import { sceneBounds } from '../src/board/three/bounds.ts';
import { applySceneCamera, fitSceneCamera } from '../src/board/three/camera.ts';
import { useBoardViewport } from '../src/board/useBoardViewport.ts';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi } from '../src/test/fake-api.ts';
import { fixedBoard, makeHints, makeSnapshot, makeView } from '../src/test/fixtures.ts';

beforeEach(() => {
  history.replaceState(null, '', '/?renderer=svg');
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'board-surface') return { x: 20, y: 50, left: 20, top: 50,
      width: 1100, height: 700, right: 1120, bottom: 750, toJSON() {} };
    return original.call(this);
  });
});

const geometry = buildGeometry('hex-r2');
afterEach(() => vi.useRealTimers());

function polygonContains(polygon: readonly { x: number; y: number }[], point: { x: number; y: number }): boolean {
  let contained = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) contained = !contained;
  }
  return contained;
}

describe('public map inspection', () => {
  it.each(['svg', 'r3f'] as const)('keeps fitted mobile %s tile centers clear of piece padding and retains keyboard access', (renderer) => {
    const bounds = sceneBounds(geometry);
    const rect = { left: 0, top: 0, width: 390, height: 220 };
    const surface = document.createElement('div');
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ ...rect, x: 0, y: 0,
      right: rect.width, bottom: rect.height, toJSON() {} });
    const surfaceRef = { current: surface };
    const { result, rerender } = renderHook(({ projection }: { projection: ProjectionSnapshot | null }) =>
      useBoardViewport({ geometry, bounds, renderer, surfaceRef, projection }),
    { initialProps: { projection: null as ProjectionSnapshot | null } });
    const project = () => {
      if (renderer !== 'r3f') return;
      const camera = new OrthographicCamera();
      applySceneCamera(camera, fitSceneCamera(bounds, rect, result.current.viewport.azimuthDeg,
        result.current.viewport.elevationDeg), result.current.viewport);
      rerender({ projection: { viewProjection: new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).toArray(),
        rect, version: 1, clip: { near: -1, far: 1 } } });
    };
    project();
    const board = fixedBoard();
    board.buildings[4] = { player: 'p2', city: false };
    board.buildings[0] = { player: 'p2', city: false };
    board.roads[0] = { player: 'p2', ship: false };
    const edge = geometry.topology.vertices[4]!.edges[0]!;
    board.roads[edge] = { player: 'p2', ship: false };
    const props = () => ({ geometry, board, renderer, controls: result.current, nameOf: () => 'Public owner',
      fallbackFocusRef: surfaceRef });
    const rendered = render(<div><BoardInspectionLayer {...props()} /></div>);
    const building = screen.getByTestId('inspect-vertex-4');
    const center = result.current.projectPoint(inspectionElements(geometry, board, renderer).find((item) => item.kind === 'hex' && item.index === 0)!.world);
    const left = Number(building.getAttribute('x')), top = Number(building.getAttribute('y'));
    const width = Number(building.getAttribute('width')), height = Number(building.getAttribute('height'));
    expect(center.x >= left && center.x <= left + width && center.y >= top && center.y <= top + height).toBe(false);
    expect(Number(building.getAttribute('data-hit-size'))).toBeLessThan(44);
    if (renderer === 'svg') {
      for (const vertex of [0, 4]) {
        const hit = screen.getByTestId(`inspect-vertex-${vertex}`);
        const x = Number(hit.getAttribute('x')), y = Number(hit.getAttribute('y'));
        const w = Number(hit.getAttribute('width')), h = Number(hit.getAttribute('height'));
        for (const adjacent of geometry.topology.vertices[vertex]!.edges) {
          const roadGeometry = geometry.edges[adjacent]!;
          const midpoint = result.current.projectPoint({ x: (roadGeometry.x1 + roadGeometry.x2) / 2 / geometry.scale,
            y: 0, z: (roadGeometry.y1 + roadGeometry.y2) / 2 / geometry.scale });
          expect(midpoint.x >= x && midpoint.x <= x + w && midpoint.y >= y && midpoint.y <= y + h,
            `vertex ${vertex} must not cover the midpoint of road ${adjacent}`).toBe(false);
        }
      }
    }
    const road = screen.getByTestId(`inspect-edge-${edge}`);
    expect(Number(road.getAttribute('stroke-width'))).toBeLessThan(44);
    expect(road.style.strokeWidth).toBe(road.getAttribute('stroke-width'));
    expect(building.getAttribute('tabindex')).toBe('0');
    expect(building.getAttribute('aria-label')).toContain('Public owner');
    const harbor = screen.getByTestId(`inspect-harbor-${board.harbors[0]!.edge}`);
    if (renderer === 'r3f') {
      expect(harbor.tagName.toLowerCase()).toBe('polygon');
      expect(harbor.getAttribute('points')?.trim().split(/\s+/)).toHaveLength(5);
    } else {
      expect(harbor.tagName.toLowerCase()).toBe('rect');
      expect(harbor.getAttribute('points')).toBeNull();
    }
    act(() => result.current.setZoom(3));
    project();
    rendered.rerender(<div><BoardInspectionLayer {...props()} /></div>);
    const enlarged = screen.getAllByTestId('board-inspect-layer')[0]!.querySelector('[data-hit-size="44"]');
    expect(enlarged).not.toBeNull();
  });

  it.each([false, true])('restores a removed inspection target only while it owns focus (leave layer: %s)', (leaveLayer) => {
    const board = fixedBoard();
    board.buildings[0] = { player: 'p2', city: false };
    const surfaceRef = { current: document.createElement('div') };
    surfaceRef.current.tabIndex = 0;
    const focusFallback = vi.spyOn(surfaceRef.current, 'focus');
    vi.spyOn(surfaceRef.current, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0,
      width: 1100, height: 700, right: 1100, bottom: 700, toJSON() {} });
    const { result } = renderHook(() => useBoardViewport({ geometry, renderer: 'svg', surfaceRef }));
    const props = { geometry, board, renderer: 'svg' as const, controls: result.current,
      nameOf: () => 'Public owner', fallbackFocusRef: surfaceRef };
    const content = (currentBoard: typeof board) => <><BoardInspectionLayer {...props} board={currentBoard} />
      <button type="button" data-testid="outside-inspection">Hand card</button></>;
    const rendered = render(content(board));
    const target = screen.getByTestId('inspect-vertex-0');
    target.focus();
    expect(document.activeElement).toBe(target);
    if (leaveLayer) screen.getByTestId('outside-inspection').focus();
    const updated = { ...board, buildings: board.buildings.map(() => null) };
    rendered.rerender(content(updated));
    if (leaveLayer) {
      expect(document.activeElement).toBe(screen.getByTestId('outside-inspection'));
      expect(focusFallback).not.toHaveBeenCalled();
    } else {
      expect(focusFallback).toHaveBeenCalledTimes(1);
    }
  });

  it('describes terrain probability, robber, building score, road owner and harbour access from public board data', () => {
    const board = fixedBoard();
    const productive = board.numbers.findIndex((number) => number === 6);
    board.robber = productive;
    const vertex = geometry.topology.vertices.findIndex((item) => item.hexes.includes(productive));
    board.buildings[vertex] = { player: 'p2', city: true };
    board.roads[5] = { player: 'p2', ship: false };
    const context = { locale: 'en' as const, board, topology: geometry.topology, nameOf: () => 'Public name' };
    const tile = inspectDescription(context, { kind: 'hex', index: productive });
    expect(tile.lines.join(' ')).toContain('5/36 (13.9%)');
    expect(tile.lines.join(' ')).toContain('production blocked');
    expect(tile.lines.join(' ')).toContain('Public name');
    expect(inspectDescription(context, { kind: 'vertex', index: vertex }).lines).toContain('Building value: 2 victory points');
    expect(inspectDescription(context, { kind: 'edge', index: 5 }).lines).toContain('Owner: Public name');
    const harbor = inspectDescription(context, { kind: 'harbor', index: board.harbors[0]!.edge });
    expect(harbor.lines.join(' ')).toContain('either endpoint');
    expect(harbor.relatedHexes.length).toBeGreaterThan(0);
    const elements = inspectionElements(geometry, board, 'r3f');
    expect(elements.some((item) => item.kind === 'vertex' && item.index === vertex)).toBe(true);
    const dock = elements.find((item) => item.kind === 'harbor')!;
    expect(dock.world).not.toEqual(inspectionElements(geometry, board, 'svg').find((item) => item.kind === 'harbor')!.world);
  });

  it('gives a 3D harbour one hover polygon over the pier, plaque and moored boat', () => {
    const board = fixedBoard();
    const edge = board.harbors[0]!.edge;
    const placement = harborPlacement(geometry, edge)!;
    const label = harborLabelPoint(placement);
    // Local +X/+Z follow the diorama instance: +Z is outward, +X carries the
    // boat. Keep this independent of the tangent helper used by the hit area.
    const modelPoint = (x: number, z: number, y: number): WorldPoint => ({
      x: placement.midpoint.x + Math.cos(placement.rotationY) * x + Math.sin(placement.rotationY) * z,
      y,
      z: placement.midpoint.z - Math.sin(placement.rotationY) * x + Math.cos(placement.rotationY) * z,
    });
    const dockEnd = modelPoint(0, 0.58, 0.15);
    const deckLeft = modelPoint(-0.35, 0.3, 0.19);
    const deckRight = modelPoint(0.35, 0.3, 0.19);
    const boat = modelPoint(0.32, 0.63, 0.05);
    const boatOuter = modelPoint(0.4, 0.63, 0.05);
    const r3f = inspectionElements(geometry, board, 'r3f').find((item) => item.kind === 'harbor' && item.index === edge)!;
    const svg = inspectionElements(geometry, board, 'svg').find((item) => item.kind === 'harbor' && item.index === edge)!;
    expect(svg.outline).toBeUndefined();
    expect(r3f.world).toEqual(label);
    expect(r3f.outline).toHaveLength(5);
    expect(new Set(r3f.outline!.map((point) => point.y))).toEqual(new Set([HARBOR_STRUCTURE.hitHeight]));
    expect(harborHitOutline(geometry, edge)).toEqual(r3f.outline);

    const bounds = sceneBounds(geometry);
    const rect = { left: 20, top: 50, width: 1100, height: 700 };
    const viewport: BoardViewportState = {
      center: { x: (bounds.min.x + bounds.max.x) / 2, z: (bounds.min.z + bounds.max.z) / 2 },
      zoom: 1,
      rect,
    };
    const camera = new OrthographicCamera();
    applySceneCamera(camera, fitSceneCamera(bounds, rect), viewport);
    const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const project = (point: WorldPoint) => {
      const projected = new Vector3(point.x, point.y, point.z).applyMatrix4(matrix);
      return { x: rect.left + (projected.x + 1) * 0.5 * rect.width,
        y: rect.top + (1 - projected.y) * 0.5 * rect.height };
    };
    const polygon = r3f.outline!.map(project);
    for (const point of [label, dockEnd, deckLeft, deckRight, boat, boatOuter]) {
      expect(polygonContains(polygon, project(point))).toBe(true);
    }
  });

  async function open() {
    const board = fixedBoard();
    board.buildings[0] = { player: 'p2', city: true };
    board.roads[5] = { player: 'p2', ship: false };
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ board, hints: makeHints({ legalRoads: [8] }) })) });
    const rendered = render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
    fireEvent.click(await screen.findByTestId('resume-g1'));
    await screen.findByTestId('inspect-hex-0');
    vi.useFakeTimers();
    return { api, ...rendered };
  }

  it('waits exactly one second before describing an element without changing the viewport or sending a command', async () => {
    const { api } = await open();
    expect(INSPECTION_DELAY_MS).toBe(1000);
    const target = screen.getByTestId('inspect-hex-0');
    expect(screen.queryByTestId('board-inspection')).toBeNull();
    fireEvent.click(target);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByTestId('board').getAttribute('data-zoom')).toBe('1');
    fireEvent.pointerOver(target, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(INSPECTION_DELAY_MS - 1));
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('tooltip').textContent).toContain('Roll chance');
    expect(target.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
    expect(screen.getByTestId('board').getAttribute('data-zoom')).toBe('1');
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });

  it('cancels short hovers, restarts the delay on a different element, and ignores touch', async () => {
    await open();
    const tile = screen.getByTestId('inspect-hex-0');
    const building = screen.getByTestId('inspect-vertex-0');
    fireEvent.pointerOver(tile, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(800));
    fireEvent.pointerOut(tile, { relatedTarget: building });
    fireEvent.pointerOver(building, { pointerType: 'mouse', relatedTarget: tile });
    act(() => vi.advanceTimersByTime(800));
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip').textContent).toContain('Building value: 2');
    fireEvent.pointerOut(building);
    act(() => vi.advanceTimersByTime(161));
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerOver(tile, { pointerType: 'touch' });
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('keeps the tooltip open while reading it, dismisses on Escape, and supports delayed keyboard focus', async () => {
    await open();
    const building = screen.getByTestId('inspect-vertex-0');
    act(() => building.focus());
    act(() => vi.advanceTimersByTime(INSPECTION_DELAY_MS));
    const popup = screen.getByRole('tooltip');
    expect(popup.textContent).toContain('小美');
    expect(document.activeElement).toBe(building);
    fireEvent.pointerOut(building, { relatedTarget: popup });
    fireEvent.pointerOver(popup, { pointerType: 'mouse', relatedTarget: building });
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('tooltip')).toBe(popup);
    fireEvent.keyDown(building, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(building.hasAttribute('aria-describedby')).toBe(false);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => screen.getByTestId('board-surface').focus());
    act(() => building.focus());
    act(() => vi.advanceTimersByTime(INSPECTION_DELAY_MS));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    act(() => screen.getByTestId('board-surface').focus());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('cancels pending inspection on drag, camera changes and unmount', async () => {
    const { unmount } = await open();
    const target = screen.getByTestId('inspect-hex-0');
    const surface = screen.getByTestId('board-surface');
    fireEvent.pointerOver(target, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(800));
    fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(surface, { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 250, clientY: 220 });
    fireEvent.pointerUp(surface, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 250, clientY: 220 });
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerOver(target, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(INSPECTION_DELAY_MS));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.click(screen.getByTestId('zoom-in'));
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerOver(target, { pointerType: 'mouse' });
    unmount();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it.each(['mouse', 'touch'])('does not open a tooltip from %s tap focus', async (pointerType) => {
    await open();
    const target = screen.getByTestId('inspect-hex-0');
    fireEvent.pointerDown(target, { pointerId: 1, pointerType, button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(target, { pointerId: 1, pointerType, button: 0, clientX: 200, clientY: 200 });
    act(() => target.focus());
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByTestId('board').getAttribute('data-zoom')).toBe('1');
    fireEvent.keyDown(target, { key: 'Tab' });
    act(() => screen.getByTestId('board-surface').focus());
    act(() => target.focus());
    act(() => vi.advanceTimersByTime(INSPECTION_DELAY_MS));
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('cancels hover information when keyboard users move to controls outside the board', async () => {
    await open();
    const target = screen.getByTestId('inspect-hex-0');
    fireEvent.pointerOver(target, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(800));
    act(() => screen.getByTestId('action-rail-toggle').focus());
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerOver(target, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(INSPECTION_DELAY_MS));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    act(() => screen.getByTestId('zoom-in').focus());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('inspects legal targets on hover while retaining explicit build confirmation and the current zoom', async () => {
    const { api } = await open();
    fireEvent.click(screen.getByTestId('zoom-out'));
    fireEvent.click(screen.getByTestId('action-build.road'));
    const target = screen.getByTestId('target-edge-8');
    fireEvent.pointerOver(target, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(INSPECTION_DELAY_MS));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.pointerDown(target, { pointerType: 'mouse', button: 0 });
    fireEvent.click(target);
    expect(screen.getByTestId('selection-preview')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId('preview-heading'));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByTestId('board').getAttribute('data-zoom')).toBe('0.8');
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });
});
