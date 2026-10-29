import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Matrix4, OrthographicCamera } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
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
