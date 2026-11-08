import { describe, expect, it } from 'vitest';
import { actionHints, createGame, projectGame, seededRng } from '@catan/rules';
import { SHIP_BEAM, SHIP_LANE, shipLanes, shipSlots, type EpView } from '../src/board/explorersPirates.ts';
import { buildGeometry, type BoardGeometry } from '../src/board/geometry.ts';
import { CAMERA_AZIMUTH_DEG, DESKTOP_ELEVATION_DEG, NARROW_ELEVATION_DEG } from '../src/board/three/camera.ts';
import { EP_SHIP_LANE_3D, EP_SHIP_STAGGER_3D, epShipPlacements, type EpShipPlacement } from '../src/board/three/diorama-explorers.ts';
import { SHIP_SCALE, shipTransform } from '../src/board/three/diorama-ships.ts';

const pairs = <T>(items: T[]) => items.flatMap((a, i) => items.slice(i + 1).map((b) => [a, b] as const));

function viewWith(ships: { id: string; edge: number }[]): EpView {
  return { ships: ships.map((ship) => ({ ...ship, player: 'p1', cargo: [] })) } as unknown as EpView;
}

describe('ship lanes on a shared path', () => {
  it('keeps one ship on its spot and two SVG ships where they always sat', () => {
    expect(shipLanes(1)).toEqual([{ across: 0, along: 0 }]);
    expect(shipLanes(1, { lane: 0.3, stagger: 0.1, shore: 1 })).toEqual([{ across: 0, along: 0 }]);
    expect(shipLanes(2)).toEqual([{ across: -SHIP_LANE / 2, along: 0 }, { across: SHIP_LANE / 2, along: 0 }]);
  });

  it.each([1, 2, 3, 4])('gives %i SVG ships their own lanes, clear of each other and within half a hex side', (count) => {
    const lanes = shipLanes(count);
    expect(lanes).toHaveLength(count);
    // 兩兩間距大於船身寬度：平行的船身不會互相重疊。
    for (const [a, b] of pairs(lanes)) expect(Math.abs(a.across - b.across)).toBeGreaterThan(SHIP_BEAM);
    // 依 slot 由負向正排列，置中於路徑，整組（含船身寬）不超出路徑兩側各半個邊長；SVG 不沿龍骨錯開。
    expect(lanes.map((lane) => lane.across)).toEqual(lanes.map((lane) => lane.across).sort((a, b) => a - b));
    expect(lanes.reduce((sum, lane) => sum + lane.across, 0)).toBeCloseTo(0);
    for (const lane of lanes) {
      expect(Math.abs(lane.across) + SHIP_BEAM / 2).toBeLessThanOrEqual(0.5);
      expect(lane.along).toBe(0);
    }
  });

  it('staggers neighbouring lanes along the keel, keeping each hull inside the path', () => {
    const lanes = shipLanes(4, { lane: EP_SHIP_LANE_3D, stagger: EP_SHIP_STAGGER_3D });
    expect(lanes.map((lane) => lane.along)).toEqual([-EP_SHIP_STAGGER_3D, EP_SHIP_STAGGER_3D, -EP_SHIP_STAGGER_3D, EP_SHIP_STAGGER_3D]);
    // 3D 船身長 0.4 × SHIP_SCALE；錯開後仍不越過路徑兩端。
    for (const lane of lanes) expect(Math.abs(lane.along) + (0.4 * SHIP_SCALE) / 2).toBeLessThanOrEqual(0.5);
  });

  it('keeps the landmost lane of a coastal group on the anchor and grows the group out to sea', () => {
    for (const count of [2, 3, 4]) {
      const seaward = shipLanes(count, { lane: EP_SHIP_LANE_3D, shore: 1 });
      expect(Math.min(...seaward.map((lane) => lane.across))).toBeCloseTo(0);
      expect(Math.max(...seaward.map((lane) => lane.across))).toBeCloseTo((count - 1) * EP_SHIP_LANE_3D);
      const landward = shipLanes(count, { lane: EP_SHIP_LANE_3D, shore: -1 });
      expect(landward.map((lane) => lane.across)).toEqual(seaward.map((lane) => 0 - lane.across).reverse());
    }
  });

  it('keeps a crowded path within the four-ship spread', () => {
    const lanes = shipLanes(6).map((lane) => lane.across);
    expect(Math.max(...lanes) - Math.min(...lanes)).toBeCloseTo(3 * SHIP_LANE);
    for (const [a, b] of pairs(lanes)) expect(Math.abs(a - b)).toBeGreaterThan(0);
  });

  it('assigns lanes by ship id, whatever order the ships arrive in', () => {
    const ships = [{ id: 's10', edge: 7 }, { id: 's2', edge: 7 }, { id: 's5', edge: 3 }, { id: 's9', edge: 7 }];
    const expected = new Map([['s2', { slot: 0, of: 3 }], ['s9', { slot: 1, of: 3 }], ['s10', { slot: 2, of: 3 }], ['s5', { slot: 0, of: 1 }]]);
    expect(shipSlots(viewWith(ships))).toEqual(expected);
    expect(shipSlots(viewWith(ships.slice().reverse()))).toEqual(expected);
    expect(shipSlots(null).size).toBe(0);
  });
});

// ---------------------------------------------------------------- 3D, default camera

type Vec = [number, number, number];
type P2 = [number, number];

/** 預設正交相機（同 `fitOrthographicCamera`）：世界座標 → 畫面座標，與沿視線的深度。 */
function defaultCamera(elevationDeg: number) {
  const az = (CAMERA_AZIMUTH_DEG * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const forward: Vec = [-Math.sin(az) * Math.cos(el), -Math.sin(el), -Math.cos(az) * Math.cos(el)];
  const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a: Vec): Vec => a.map((value) => value / Math.hypot(...a)) as Vec;
  const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const right = unit(cross(forward, [0, 1, 0]));
  const up = unit(cross(right, forward));
  return { project: (point: Vec): P2 => [dot(point, right), dot(point, up)], depth: (point: Vec) => dot(point, forward) };
}

function convexHull(points: P2[]): P2[] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: P2[]) => list.reduce<P2[]>((hull, point) => {
    while (hull.length >= 2 && turn(hull.at(-2)!, hull.at(-1)!, point) <= 0) hull.pop();
    hull.push(point);
    return hull;
  }, []);
  return [...half(sorted).slice(0, -1), ...half(sorted.slice().reverse()).slice(0, -1)];
}

function insidePolygon(polygon: P2[], point: P2): boolean {
  return polygon.every((a, index) => {
    const b = polygon[(index + 1) % polygon.length]!;
    return (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) >= 0;
  });
}

/** Local boxes of a ship (×SHIP_SCALE): the hull with its deck cargo, and the square sail (an occluder only). */
interface Box { x: [number, number]; y: [number, number]; z: [number, number] }
const s = SHIP_SCALE;
const BODY: Box = { x: [-0.2 * s, 0.2 * s], y: [0, 0.25], z: [-0.065 * s, 0.065 * s] };
const SAIL: Box = { x: [-0.006 * s, 0.006 * s], y: [0.185 * s, 0.355 * s], z: [-0.095 * s, 0.095 * s] };

function toWorld(ship: EpShipPlacement, [x, y, z]: Vec): Vec {
  const keel = [Math.cos(ship.rotationY), -Math.sin(ship.rotationY)];
  const across = [Math.sin(ship.rotationY), Math.cos(ship.rotationY)];
  return [ship.position[0] + keel[0]! * x + across[0]! * z, ship.position[1] + y, ship.position[2] + keel[1]! * x + across[1]! * z];
}

const corners = (box: Box): Vec[] => box.x.flatMap((x) => box.y.flatMap((y) => box.z.map((z) => [x, y, z] as Vec)));

function grid(box: Box, steps = [10, 4, 4]): Vec[] {
  const out: Vec[] = [];
  const at = (range: [number, number], i: number, n: number) => range[0] + ((range[1] - range[0]) * i) / n;
  for (let i = 0; i <= steps[0]!; i++) for (let j = 0; j <= steps[1]!; j++) for (let k = 0; k <= steps[2]!; k++) {
    out.push([at(box.x, i, steps[0]!), at(box.y, j, steps[1]!), at(box.z, k, steps[2]!)]);
  }
  return out;
}

/** Share of each ship's hull and cargo that no ship nearer the camera covers on screen. */
function visibleShares(ships: EpShipPlacement[], elevationDeg: number): number[] {
  const camera = defaultCamera(elevationDeg);
  const prints = ships.map((ship) => [BODY, SAIL].map((box) => convexHull(corners(box).map((corner) => camera.project(toWorld(ship, corner))))));
  const depth = ships.map((ship) => camera.depth(toWorld(ship, [0, 0.12, 0])));
  return ships.map((ship, index) => {
    const samples = grid(BODY).map((point) => camera.project(toWorld(ship, point)));
    const hidden = samples.filter((point) => ships.some((_, other) => other !== index && depth[other]! < depth[index]!
      && prints[other]!.some((polygon) => insidePolygon(polygon, point)))).length;
    return 1 - hidden / samples.length;
  });
}

describe('3D ships on a crowded path', () => {
  const PLAYERS = ['p1', 'p2', 'p3', 'p4'].map((id, seat) => ({ id, nickname: id, color: (['red', 'blue', 'orange', 'white'] as const)[seat]! }));
  const state = createGame({ profileId: 'ep-land-ho-2025', players: PLAYERS, setupMode: 'fixed', rng: seededRng(4) });
  const view = projectGame(state, 'p1', { hints: actionHints(state, 'p1') });
  const base = view.modules!.explorersPirates as EpView;
  const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);

  /** A sea route of each heading (three edge directions) at open sea and on a coast, plus edge 6 from #113. */
  function sampleEdges(board: BoardGeometry): { edge: number; coast: boolean }[] {
    const seen = new Map<string, number>();
    board.topology.edges.forEach((info, edge) => {
      const sea = info.hexes.filter((hex) => board.land[hex] === false).length;
      if (info.hexes.length !== 2 || sea === 0) return;
      const line = board.edges[edge]!;
      const heading = Math.round(((Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180) / Math.PI + 360) % 180);
      const key = `${heading}-${sea === 1 ? 'coast' : 'sea'}`;
      if (!seen.has(key)) seen.set(key, edge);
    });
    expect(seen.size).toBe(6);
    return [...new Set([6, ...seen.values()])].map((edge) => ({ edge, coast: board.topology.edges[edge]!.hexes.some((hex) => board.land[hex] !== false) }));
  }

  function placed(edge: number, count: number): EpShipPlacement[] {
    const ships = Array.from({ length: count }, (_, index) => ({ id: `s${index + 1}`, player: PLAYERS[index]!.id, edge, cargo: ['settler' as const, 'crew' as const] }));
    return epShipPlacements(geometry, { ...base, ships }, SHIP_SCALE);
  }

  it('starts from the issue board: edge 6 is a coast between a forest and the sea', () => {
    expect(base.ships.find((ship) => ship.id === 's1')?.edge).toBe(6);
    expect(geometry.topology.edges[6]!.hexes.map((hex) => geometry.land[hex])).toEqual([true, false]);
  });

  it.each([2, 3, 4])('shows most of the hull and cargo of each of %i ships at the default camera, on every heading', (count) => {
    for (const { edge } of sampleEdges(geometry)) {
      const ships = placed(edge, count);
      expect(ships).toHaveLength(count);
      for (const elevation of [DESKTOP_ELEVATION_DEG, NARROW_ELEVATION_DEG]) {
        const shares = visibleShares(ships, elevation);
        for (const share of shares) expect(share, `edge ${edge}, ${elevation}°: ${shares.map((v) => v.toFixed(2)).join(' ')}`).toBeGreaterThan(0.75);
      }
      // 船身在水平面上也不相交：相鄰航道間距大於 3D 船寬。
      for (const [a, b] of pairs(ships)) expect(Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2])).toBeGreaterThan(0.13 * SHIP_SCALE);
    }
  });

  it.each([2, 3, 4])('keeps %i ships on a coast out at sea, no nearer the beach than a lone ship', (count) => {
    for (const { edge, coast } of sampleEdges(geometry)) {
      if (!coast) continue;
      const info = geometry.topology.edges[edge]!;
      const line = geometry.edges[edge]!;
      const mid = [(line.x1 + line.x2) / 200, (line.y1 + line.y2) / 200] as const;
      const sea = geometry.hexes[info.hexes.find((hex) => geometry.land[hex] === false)!]!;
      const out = [sea.cx / 100 - mid[0], sea.cy / 100 - mid[1]];
      const length = Math.hypot(out[0]!, out[1]!);
      const seaward = (point: readonly number[]) => ((point[0]! - mid[0]) * out[0]! + (point[2]! - mid[1]) * out[1]!) / length;
      const lone = seaward(shipTransform(geometry, edge)!.position);
      expect(lone).toBeGreaterThan(0.1);
      const depths = placed(edge, count).map((ship) => seaward(ship.position));
      expect(Math.min(...depths), `edge ${edge}: ${depths.map((v) => v.toFixed(2)).join(' ')}`).toBeCloseTo(lone);
      expect(Math.max(...depths)).toBeCloseTo(lone + (count - 1) * EP_SHIP_LANE_3D);
    }
  });
});
