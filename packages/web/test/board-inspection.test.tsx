import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Matrix4, OrthographicCamera } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { BoardInspectionLayer, BoardInspectionPanel } from '../src/components/BoardInspection.tsx';
import type { ProjectionSnapshot } from '../src/board/render-contract.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import { inspectDescription, inspectionElements } from '../src/board/inspection.ts';
import { projectWorldPoint } from '../src/board/projection.ts';
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
    const onInspect = vi.fn();
    const props = () => ({ geometry, board, renderer, controls: result.current, nameOf: () => 'Public owner',
      selected: null, onInspect, onClose: vi.fn(), fallbackFocusRef: surfaceRef });
    const rendered = render(<><BoardInspectionLayer {...props()} /><BoardInspectionPanel {...props()} /></>);
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
    fireEvent.keyDown(building, { key: 'Enter' });
    expect(onInspect).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'vertex', index: 4 }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'vertex:4' } });
    expect(onInspect).toHaveBeenCalledTimes(2);
    act(() => result.current.setZoom(3));
    project();
    rendered.rerender(<><BoardInspectionLayer {...props()} /><BoardInspectionPanel {...props()} /></>);
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
      nameOf: () => 'Public owner', selected: null, onInspect: vi.fn(), onClose: vi.fn(), fallbackFocusRef: surfaceRef };
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

  it.each(['svg', 'r3f'] as const)('moves the actual %s viewport to a coastal element, enlarges it and restores full fit', (renderer) => {
    const bounds = sceneBounds(geometry);
    const surface = document.createElement('div');
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 50, left: 20, top: 50,
      width: 1100, height: 700, right: 1120, bottom: 750, toJSON() {} });
    const { result } = renderHook(() => useBoardViewport({ geometry, bounds, renderer, surfaceRef: { current: surface } }));
    const initial = result.current.viewport;
    const target = inspectionElements(geometry, fixedBoard(), renderer).find((item) => item.kind === 'harbor')!;
    act(() => result.current.focus(target.world));
    expect(result.current.viewport.zoom).toBe(2.2);
    expect(result.current.viewport.center).toEqual({ x: target.world.x, z: target.world.z });
    if (renderer === 'svg') {
      const projected = result.current.projectPoint(target.world);
      expect(projected.x).toBeCloseTo(570, 5);
      expect(projected.y).toBeCloseTo(400, 5);
    } else {
      const before = new OrthographicCamera();
      const after = new OrthographicCamera();
      const fit = fitSceneCamera(bounds, initial.rect, initial.azimuthDeg, initial.elevationDeg);
      applySceneCamera(before, fit, initial);
      applySceneCamera(after, fit, result.current.viewport);
      expect(after.position.toArray()).not.toEqual(before.position.toArray());
      expect(after.zoom).toBe(2.2);
      act(() => { result.current.rotate(30); result.current.setElevation(35); });
      expect(result.current.viewport.center).toEqual({ x: target.world.x, z: target.world.z });
      const matrix = new Matrix4().multiplyMatrices(after.projectionMatrix, after.matrixWorldInverse).toArray();
      expect(projectWorldPoint({ matrix, point: target.world, rect: initial.rect }).visible).toBe(true);
    }
    act(() => result.current.fit());
    expect(result.current.viewport).toEqual(initial);
  });

  it('opens inspection through pointer and keyboard without commands, preserves build confirmation and clears inspection on fit', async () => {
    const board = fixedBoard();
    board.buildings[0] = { player: 'p2', city: true };
    board.roads[5] = { player: 'p2', ship: false };
    const api = createFakeApi({ snapshot: makeSnapshot(makeView({ board, hints: makeHints({ legalRoads: [8] }) })) });
    render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
    fireEvent.click(await screen.findByTestId('resume-g1'));
    fireEvent.click(await screen.findByTestId('inspect-hex-0'));
    expect(screen.getByTestId('board').getAttribute('data-zoom')).toBe('2.2');
    expect(screen.getByTestId('inspection-detail').textContent).toContain('Roll chance');
    expect(api.callsOf('sendCommand')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('reset-view'));
    expect(screen.queryByTestId('inspection-detail')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('inspect-vertex-0'), { key: 'Enter' });
    expect(screen.getByTestId('inspection-detail').textContent).toContain('Building value: 2');
    expect(screen.getByTestId('inspection-detail').textContent).toContain('小美');
    fireEvent.click(screen.getByTestId('reset-view'));
    fireEvent.click(screen.getByTestId('action-build.road'));
    fireEvent.click(await screen.findByTestId('target-edge-8'));
    await screen.findByTestId('selection-preview');
    expect(document.activeElement).toBe(screen.getByTestId('preview-heading'));
    expect(screen.getByTestId('inspection-detail')).toBeTruthy();
    expect(api.callsOf('sendCommand')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('reset-view'));
    expect(screen.getByTestId('board').getAttribute('data-zoom')).toBe('1');
  });

  it('suppresses inspection after a drag and lets the next deliberate click inspect normally', async () => {
    render(<App services={{ api: createFakeApi(), storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
    fireEvent.click(await screen.findByTestId('resume-g1'));
    const surface = await screen.findByTestId('board-surface');
    fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(surface, { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 250, clientY: 220 });
    fireEvent.pointerUp(surface, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 250, clientY: 220 });
    fireEvent.click(screen.getByTestId('inspect-hex-0'));
    expect(screen.queryByTestId('inspection-detail')).toBeNull();
    fireEvent.click(screen.getByTestId('inspect-hex-0'));
    await waitFor(() => expect(screen.getByTestId('inspection-detail')).toBeTruthy());
  });
});
