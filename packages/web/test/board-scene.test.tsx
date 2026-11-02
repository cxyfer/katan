import { Children, isValidElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildGeometry } from '../src/board/geometry.ts';
import type { BoardSceneProps } from '../src/board/render-contract.ts';
import { fixedBoard } from '../src/test/fixtures.ts';

const r3f = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

vi.mock('@react-three/fiber', () => ({
  Canvas: (props: Record<string, unknown>) => {
    r3f.props = props;
    return <div data-testid="mock-canvas" />;
  },
  useFrame: () => undefined,
  useThree: () => ({
    camera: {},
    gl: {},
    invalidate: () => undefined,
  }),
}));

import BoardScene3D, { BoardScene3D as NamedBoardScene3D } from '../src/board/three/BoardScene3D.tsx';
import { cameraElevation } from '../src/board/three/camera.ts';

const geometry = buildGeometry('hex-r2', 100);

function props(overrides: Partial<BoardSceneProps> = {}): BoardSceneProps {
  const view = fixedBoard();
  return {
    geometry,
    board: view,
    players: [
      { id: 'p1', seat: 0, color: 'red' },
      { id: 'p2', seat: 1, color: 'blue' },
    ],
    intent: null,
    selection: null,
    arrivals: [],
    viewport: {
      center: { x: 0, z: 0 },
      zoom: 1,
      rect: { left: 10, top: 20, width: 800, height: 500 },
    },
    quality: 'standard',
    motionAllowed: true,
    onProjection: vi.fn(),
    onReady: vi.fn(),
    onUnavailable: vi.fn(),
    ...overrides,
  };
}

describe('BoardScene3D boundary', () => {
  it('exports the frozen default component and uses demand-rendered fixed-quality Canvas settings', () => {
    expect(NamedBoardScene3D).toBe(BoardScene3D);
    const scene = props();
    render(<BoardScene3D {...scene} />);
    expect(screen.getByTestId('board-three').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('board-three').style.pointerEvents).toBe('none');
    expect(r3f.props).toMatchObject({
      frameloop: 'demand',
      orthographic: true,
      shadows: 'percentage',
      dpr: [1, 2],
      tabIndex: -1,
    });
    expect(r3f.props!.camera).toMatchObject({ near: expect.any(Number), far: expect.any(Number), zoom: 1 });
    expect(Children.toArray(r3f.props!.children as React.ReactNode).some((child) =>
      isValidElement(child) && (child.props as { attach?: string }).attach === 'fog')).toBe(false);
  });

  it('keeps the Canvas fallback inert instead of reporting unavailability during a healthy mount', () => {
    const scene = props();
    render(<BoardScene3D {...scene} />);
    render(r3f.props!.fallback as React.ReactNode);
    expect(scene.onUnavailable).not.toHaveBeenCalled();
    expect(screen.getByText('3D rendering unavailable')).toBeTruthy();
  });

  it('turns shadows off, caps DPR at 1, and reduces antialiasing in low quality', () => {
    render(<BoardScene3D {...props({ quality: 'low' })} />);
    expect(r3f.props).toMatchObject({
      shadows: false,
      dpr: [1, 1],
    });
    expect(r3f.props!.gl).toMatchObject({ antialias: false });
  });

  it('keeps the fixed desktop/portrait elevations and azimuth contract at the scene boundary', () => {
    expect(cameraElevation({ width: 900, height: 600 })).toBe(50);
    expect(cameraElevation({ width: 700, height: 500 })).toBe(60);
    expect(cameraElevation({ width: 900, height: 1200 })).toBe(60);
  });
});
