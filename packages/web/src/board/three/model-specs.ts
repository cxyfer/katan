import type { PublicBoardView } from '@catan/rules';
import type { BoardGeometry } from '../geometry.ts';
import type { BoardIntent } from '../intent.ts';
import { confirmedPlacement } from '../effects.ts';
import type { BoardEffectGroup } from '../animation.ts';
import type { SceneSelection } from '../render-contract.ts';
import { geometryToWorld } from './bounds.ts';
import { horizontalRotation, type InstanceTransform, type Vec3 } from './transforms.ts';

export const ROAD_ARRIVAL_TRANSFORM_MS = 240;
export const BUILDING_ARRIVAL_TRANSFORM_MS = 290;

export interface TileInstance extends InstanceTransform {
  index: number;
  terrain: string;
}

export interface TerrainPiece extends InstanceTransform {
  kind: 'trunk' | 'canopy' | 'mountain' | 'mound' | 'field' | 'sheep' | 'wave';
  index: number;
  terrain: string;
}

export interface NumberToken extends InstanceTransform {
  index: number;
  value: number;
}

export interface RoadInstance extends InstanceTransform {
  index: number;
  playerId: string;
  seat: number;
  arriving: boolean;
  durationMs: number;
  length: number;
}

export interface BuildingPart extends InstanceTransform {
  vertex: number;
  playerId: string;
  material: 'player' | 'roof' | 'trim';
  part: 'body' | 'roof' | 'tower' | 'door' | 'seat-mark';
  arriving: boolean;
  durationMs: number;
}


const TERRAIN_LAYOUTS: Readonly<Record<string, readonly { x: number; z: number; s?: number }[]>> = {
  forest: [{ x: -0.27, z: -0.2, s: 1 }, { x: -0.04, z: -0.29, s: 0.86 }, { x: 0.22, z: -0.17, s: 0.94 }],
  hills: [{ x: -0.28, z: -0.12, s: 1 }, { x: 0.03, z: -0.24, s: 0.72 }, { x: 0.27, z: -0.02, s: 0.84 }],
  pasture: [{ x: -0.22, z: -0.2, s: 1 }, { x: 0.17, z: -0.27, s: 0.82 }],
  fields: [{ x: -0.24, z: -0.2 }, { x: -0.08, z: -0.24 }, { x: 0.08, z: -0.28 }, { x: 0.24, z: -0.32 }],
  mountains: [{ x: -0.25, z: -0.15, s: 1 }, { x: 0.16, z: -0.22, s: 0.68 }],
  desert: [{ x: -0.25, z: -0.18, s: 1 }, { x: 0.18, z: -0.28, s: 0.74 }],
  gold: [{ x: -0.18, z: -0.2, s: 0.92 }],
  sea: [{ x: -0.3, z: -0.2 }, { x: 0.12, z: -0.27 }],
};

/** Raised land tiles; sea hexes stay open water so the ocean shows through. */
export function tileInstances(geometry: BoardGeometry, board: PublicBoardView): TileInstance[] {
  return geometry.hexes.filter((hex) => geometry.land[hex.index] !== false).map((hex) => {
    const point = geometryToWorld(geometry, hex.cx, hex.cy);
    return {
      index: hex.index,
      terrain: board.terrain[hex.index] ?? 'sea',
      position: [point.x, 0, point.z],
      rotationY: 0,
      scale: [0.994, 1, 0.994],
    };
  });
}

export function terrainPieces(geometry: BoardGeometry, board: PublicBoardView): TerrainPiece[] {
  const pieces: TerrainPiece[] = [];
  for (const hex of geometry.hexes) {
    const terrain = board.terrain[hex.index] ?? 'sea';
    const center = geometryToWorld(geometry, hex.cx, hex.cy);
    const layout = TERRAIN_LAYOUTS[terrain] ?? [];
    for (const [variant, item] of layout.entries()) {
      const x = center.x + item.x;
      const z = center.z + item.z;
      const scale = item.s ?? 1;
      const rotationY = ((hex.index * 17 + variant * 11) % 6) * (Math.PI / 3);
      if (terrain === 'forest') {
        pieces.push({ kind: 'trunk', index: hex.index, terrain, position: [x, 0.002, z], rotationY, scale: [scale, scale, scale] });
        pieces.push({ kind: 'canopy', index: hex.index, terrain, position: [x, 0.12 * scale, z], rotationY, scale: [scale, scale, scale] });
      } else if (terrain === 'mountains') {
        pieces.push({ kind: 'mountain', index: hex.index, terrain, position: [x, 0.002, z], rotationY, scale: [scale, scale, scale] });
      } else if (terrain === 'fields') {
        pieces.push({ kind: 'field', index: hex.index, terrain, position: [x, 0.005, z], rotationY: variant % 2 ? 0.32 : -0.32, scale: [1, 1, 1] });
      } else if (terrain === 'pasture') {
        pieces.push({ kind: 'mound', index: hex.index, terrain, position: [x, 0.003, z], rotationY, scale: [0.2 * scale, 0.08 * scale, 0.16 * scale] });
        pieces.push({ kind: 'sheep', index: hex.index, terrain, position: [x, 0.075 * scale, z], rotationY, scale: [scale, scale, scale] });
      } else if (terrain === 'sea') {
        pieces.push({ kind: 'wave', index: hex.index, terrain, position: [x, 0.018, z], rotationY, scale: [scale, scale, scale] });
      } else {
        pieces.push({ kind: 'mound', index: hex.index, terrain, position: [x, 0.003, z], rotationY, scale: [0.25 * scale, (terrain === 'gold' ? 0.16 : 0.11) * scale, 0.19 * scale] });
      }
    }
  }
  return pieces;
}

export function numberTokens(geometry: BoardGeometry, board: PublicBoardView): NumberToken[] {
  return geometry.hexes.flatMap((hex) => {
    const value = board.numbers[hex.index];
    if (typeof value !== 'number') return [];
    const center = geometryToWorld(geometry, hex.cx, hex.cy);
    return [{
      index: hex.index,
      value,
      // The badge plane sits just above the token cylinder top to avoid
      // z-fighting while keeping the token body as a real volume.
      position: [center.x, 0, center.z] as Vec3,
      rotationY: 0,
      scale: [0.62, 1, 0.62] as Vec3,
    }];
  });
}

export function roadInstances(
  geometry: BoardGeometry,
  board: PublicBoardView,
  players: readonly { id: string; seat: number }[],
  active: BoardEffectGroup | null,
): RoadInstance[] {
  const out: RoadInstance[] = [];
  for (const edge of geometry.edges) {
    const road = board.roads[edge.index];
    if (!road) continue;
    const from = geometryToWorld(geometry, edge.x1, edge.y1);
    const to = geometryToWorld(geometry, edge.x2, edge.y2);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const rawLength = Math.hypot(dx, dz);
    const length = rawLength - 0.17;
    if (!(length > 0.01)) continue;
    const seat = players.find((player) => player.id === road.player)?.seat ?? 0;
    out.push({
      index: edge.index,
      playerId: road.player,
      seat,
      arriving: confirmedPlacement(active?.events ?? [], board, 'edge', edge.index),
      durationMs: ROAD_ARRIVAL_TRANSFORM_MS,
      length,
      // Equal-end setbacks keep the local +X centre at the topology midpoint.
      position: [(from.x + to.x) / 2, 0.025, (from.z + to.z) / 2],
      rotationY: horizontalRotation(dx, dz),
      scale: [length, 0.05, 0.09],
    });
  }
  return out;
}

export function buildingParts(
  geometry: BoardGeometry,
  board: PublicBoardView,
  players: readonly { id: string; seat: number }[],
  active: BoardEffectGroup | null,
): BuildingPart[] {
  const out: BuildingPart[] = [];
  for (const vertex of geometry.vertices) {
    const building = board.buildings[vertex.index];
    if (!building) continue;
    const seat = players.find((player) => player.id === building.player)?.seat ?? 0;
    const point = geometryToWorld(geometry, vertex.x, vertex.y);
    const arriving = confirmedPlacement(active?.events ?? [], board, 'vertex', vertex.index);
    const base = [point.x, 0.005, point.z] as const;
    const rotationY = ((vertex.index * 23) % 6) * (Math.PI / 6);
    const push = (part: BuildingPart['part'], material: BuildingPart['material'], offset: Vec3, scale: Vec3) => {
      out.push({
        vertex: vertex.index,
        playerId: building.player,
        material,
        part,
        arriving,
        durationMs: BUILDING_ARRIVAL_TRANSFORM_MS,
        position: [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]],
        rotationY,
        scale,
      });
    };
    if (building.city) {
      push('body', 'player', [0, 0.02, 0], [0.3, 0.045, 0.22]);
      push('body', 'player', [-0.06, 0.065, 0], [0.2, 0.17, 0.16]);
      push('roof', 'roof', [-0.06, 0.15, 0], [0.24, 0.12, 0.2]);
      push('tower', 'player', [0.11, 0.065, 0.025], [0.12, 0.23, 0.13]);
      push('roof', 'roof', [0.11, 0.18, 0.025], [0.16, 0.1, 0.17]);
      push('door', 'trim', [-0.09, 0.085, -0.082], [0.045, 0.08, 0.008]);
    } else {
      push('body', 'player', [0, 0.035, 0], [0.22, 0.04, 0.18]);
      push('body', 'player', [0, 0.075, 0], [0.16, 0.15, 0.14]);
      push('roof', 'roof', [0, 0.15, 0], [0.21, 0.13, 0.18]);
      push('door', 'trim', [0, 0.075, -0.072], [0.04, 0.075, 0.008]);
    }
    for (let mark = 0; mark <= seat % 6; mark++) {
      push('seat-mark', 'trim', [-0.075 + mark * 0.03, 0.052, building.city ? 0.114 : 0.095], [0.016, 0.022, 0.022]);
    }
  }
  return out;
}

export function legalGhostSelection(intent: BoardIntent | null, selection: SceneSelection | null): SceneSelection | null {
  if (!intent || !selection) return null;
  if (intent.kind !== selection.kind || !intent.targets.includes(selection.index)) return null;
  return selection;
}

export function redactedTooltipLabel(kind: string): string {
  return kind.replace(/[^a-z.-]/gi, '');
}
