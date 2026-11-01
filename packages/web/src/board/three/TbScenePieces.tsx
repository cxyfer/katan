import { useMemo } from 'react';
import { BoxGeometry, CylinderGeometry, type Material } from 'three';
import type { PublicBoardView } from '@catan/rules';
import type { BoardGeometry } from '../geometry.ts';
import { ModelBuilder, useDioramaGeometry } from './diorama-geometry.ts';
import { InstancedPrimitive } from './InstancedPrimitive.tsx';
import type { InstanceTransform, Vec3 } from './transforms.ts';

/**
 * 3D pieces of the Traders & Barbarians scenarios, built procedurally from
 * the module projection (`GameView.modules.tradersBarbarians`). Every piece
 * is merged into one static mesh per change of the scenario state.
 */

export type TbModules = Record<string, unknown> | undefined;

interface Ground { valley: number; edges: [number, number]; vertices: [number, number, number]; number: number }

function part<T>(modules: TbModules, id: string): T | null {
  const slot = (modules?.tradersBarbarians as Record<string, unknown> | undefined)?.[id];
  return slot && typeof slot === 'object' ? (slot as T) : null;
}

export interface TbPieceContext {
  geometry: BoardGeometry;
  board: PublicBoardView;
  players: readonly { id: string; seat: number; color: string }[];
  modules: TbModules;
}

/** World position of a topology vertex (tile top at y = 0). */
export function vertexWorld(geometry: BoardGeometry, vertex: number): { x: number; z: number } {
  const point = geometry.vertices[vertex]!;
  return { x: point.x / geometry.scale, z: point.y / geometry.scale };
}

/** Unit vector from a coastal edge's land hex out to sea. */
export function edgeOutward(geometry: BoardGeometry, edge: number): { x: number; z: number } {
  const info = geometry.topology.edges[edge]!;
  const hex = geometry.topology.hexes[info.hexes[0]!]!;
  const dx = info.x - hex.x;
  const dz = info.y - hex.y;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

/** A flat plank between two world points (roads, bridges, chevron arms). */
export function plank(b: ModelBuilder, color: string, a: { x: number; z: number }, c: { x: number; z: number }, width: number, height: number, y: number) {
  const length = Math.hypot(c.x - a.x, c.z - a.z);
  b.add(new BoxGeometry(length, height, width), color, [(a.x + c.x) / 2, y, (a.z + c.z) / 2], [1, 1, 1],
    [0, -Math.atan2(c.z - a.z, c.x - a.x), 0]);
}

function fishingGrounds(b: ModelBuilder, context: TbPieceContext): boolean {
  const fishing = part<{ grounds: Ground[] }>(context.modules, 'tb-fishing');
  if (!fishing) return false;
  const depth = 0.42;
  for (const ground of fishing.grounds) {
    for (const edge of ground.edges) {
      const [a, c] = context.geometry.topology.edges[edge]!.vertices;
      const out = edgeOutward(context.geometry, edge);
      const pa = vertexWorld(context.geometry, a);
      const pc = vertexWorld(context.geometry, c);
      const shift = (point: { x: number; z: number }) => ({ x: point.x + out.x * depth / 2, z: point.z + out.z * depth / 2 });
      plank(b, '#2f88ac', shift(pa), shift(pc), depth, 0.05, -0.05);
      plank(b, '#bfe9f3', { x: pa.x + out.x * depth, z: pa.z + out.z * depth }, { x: pc.x + out.x * depth, z: pc.z + out.z * depth }, 0.03, 0.06, -0.03);
    }
    // Rocks marking the ground's tip.
    const valley = vertexWorld(context.geometry, ground.valley);
    b.add(new CylinderGeometry(0.05, 0.07, 0.06, 6), '#6f7a78', [valley.x, -0.01, valley.z]);
  }
  return true;
}

/** Extra number badges: fishing grounds and the lake (drawn by the badge layer). */
export function tbNumberTokens(geometry: BoardGeometry, modules: TbModules): { index: number; value: number; position: Vec3; rotationY: number; scale: Vec3 }[] {
  const out: { index: number; value: number; position: Vec3; rotationY: number; scale: Vec3 }[] = [];
  const fishing = part<{ grounds: Ground[]; lake: number; lakeNumbers: number[] }>(modules, 'tb-fishing');
  if (fishing) {
    for (const ground of fishing.grounds) {
      const valley = vertexWorld(geometry, ground.valley);
      const a = edgeOutward(geometry, ground.edges[0]);
      const c = edgeOutward(geometry, ground.edges[1]);
      const length = Math.hypot(a.x + c.x, a.z + c.z) || 1;
      const reach = 0.42;
      out.push({ index: -1, value: ground.number, position: [valley.x + (a.x + c.x) / length * reach, 0, valley.z + (a.z + c.z) / length * reach], rotationY: 0, scale: [0.5, 1, 0.5] });
    }
    const hex = geometry.hexes[fishing.lake];
    if (hex) {
      const offsets: [number, number][] = [[-0.3, -0.24], [0.3, -0.24], [-0.3, 0.24], [0.3, 0.24]];
      fishing.lakeNumbers.forEach((value, index) => {
        const [dx, dz] = offsets[index]!;
        out.push({ index: fishing.lake, value, position: [hex.cx / geometry.scale + dx, 0, hex.cy / geometry.scale + dz], rotationY: 0, scale: [0.42, 1, 0.42] });
      });
    }
  }
  return out;
}

/** Builders per scenario part; each returns false when its part is absent. */
const BUILDERS: readonly ((b: ModelBuilder, context: TbPieceContext) => boolean)[] = [fishingGrounds];

const IDENTITY: readonly InstanceTransform[] = [{ position: [0, 0, 0], rotationY: 0, scale: [1, 1, 1] }];

function PiecesMesh({ context, material, quality }: { context: TbPieceContext; material: Material; quality: 'standard' | 'low' }) {
  const model = useDioramaGeometry(() => {
    const builder = new ModelBuilder();
    let any = false;
    for (const build of BUILDERS) any = build(builder, context) || any;
    // An empty model still needs one primitive; hide it under the sea.
    if (!any) builder.add(new BoxGeometry(0.001, 0.001, 0.001), '#000000', [0, -5, 0]);
    return builder.build();
  }, [context]);
  return <InstancedPrimitive geometry={model} material={material} instances={IDENTITY} castShadow={quality === 'standard'} />;
}

export function TbScenePieces({ geometry, board, players, modules, quality, material }: {
  geometry: BoardGeometry;
  board: PublicBoardView;
  players: readonly { id: string; seat: number; color: string }[];
  modules: TbModules;
  quality: 'standard' | 'low';
  material: Material;
}) {
  // Rebuild only when the scenario state, pieces or seats change, not on every
  // render (the players array is recreated by the caller).
  const modulesKey = JSON.stringify(modules?.tradersBarbarians ?? null);
  const playersKey = players.map((player) => `${player.id}:${player.seat}:${player.color}`).join('|');
  const roadsKey = JSON.stringify(board.roads);
  const context = useMemo(() => ({ geometry, board, players, modules }), [geometry, modulesKey, playersKey, roadsKey]);
  if (!modules?.tradersBarbarians) return null;
  return <PiecesMesh context={context} material={material} quality={quality} />;
}
