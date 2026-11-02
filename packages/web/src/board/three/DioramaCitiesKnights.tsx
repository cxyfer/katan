import { useMemo } from 'react';
import type { Material } from 'three';
import { TRACKS, type KnightLevel, type Track } from '../citiesKnights.ts';
import type { BoardSceneProps } from '../render-contract.ts';
import { playerColorHex } from '../terrain.ts';
import { useDioramaGeometry } from './diorama-geometry.ts';
import { createKnightModel, createMetropolisModel, createToppledCityModel, createWallModel, KNIGHT_SCALE, METROPOLIS_OFFSET, vertexTransform } from './diorama-knights.ts';
import { InstancedPrimitive } from './InstancedPrimitive.tsx';
import type { InstanceTransform } from './transforms.ts';

type Props = Pick<BoardSceneProps, 'geometry' | 'board' | 'players' | 'quality' | 'citiesKnights'> & { material: Material };

function KnightBatch({ color, seat, level, active, instances, material, quality }: Pick<Props, 'material' | 'quality'> & {
  color: string; seat: number; level: KnightLevel; active: boolean; instances: InstanceTransform[];
}) {
  const model = useDioramaGeometry(() => createKnightModel(color, level, active, seat), [color, level, active, seat]);
  return <InstancedPrimitive geometry={model} material={material} instances={instances} castShadow={quality === 'standard'} />;
}

function WallBatch({ color, instances, material, quality }: Pick<Props, 'material' | 'quality'> & { color: string; instances: InstanceTransform[] }) {
  const model = useDioramaGeometry(() => createWallModel(color), [color]);
  return <InstancedPrimitive geometry={model} material={material} instances={instances} castShadow={quality === 'standard'} />;
}

function ToppledBatch({ color, seat, instances, material, quality }: Pick<Props, 'material' | 'quality'> & {
  color: string; seat: number; instances: InstanceTransform[];
}) {
  const model = useDioramaGeometry(() => createToppledCityModel(color, seat), [color, seat]);
  return <InstancedPrimitive geometry={model} material={material} instances={instances} castShadow={quality === 'standard'} />;
}

function Metropolis({ color, track, transform, material, quality }: Pick<Props, 'material' | 'quality'> & { color: string; track: Track; transform: InstanceTransform }) {
  const model = useDioramaGeometry(() => createMetropolisModel(color, track), [color, track]);
  return <mesh geometry={model} material={material} position={transform.position} castShadow={quality === 'standard'} dispose={null} />;
}

/** Knights, walls and metropolis keeps; nothing for games without the module. */
export function DioramaCitiesKnights({ geometry, board, players, quality, citiesKnights: ck, material }: Props) {
  const knights = useMemo(() => {
    const groups = new Map<string, { playerId: string; level: KnightLevel; active: boolean; items: InstanceTransform[] }>();
    for (const knight of ck?.knights ?? []) {
      const transform = vertexTransform(geometry, knight.vertex, [0, 0], KNIGHT_SCALE);
      if (!transform) continue;
      const key = `${knight.player}:${knight.level}:${knight.active}`;
      const group = groups.get(key) ?? { playerId: knight.player, level: knight.level, active: knight.active, items: [] };
      group.items.push(transform);
      groups.set(key, group);
    }
    return [...groups.entries()];
  }, [ck?.knights, geometry]);
  const walls = useMemo(() => {
    const byPlayer = new Map<string, InstanceTransform[]>();
    for (const wall of ck?.walls ?? []) {
      const transform = vertexTransform(geometry, wall.vertex);
      if (!transform || !wall.player) continue;
      byPlayer.set(wall.player, [...(byPlayer.get(wall.player) ?? []), transform]);
    }
    return [...byPlayer.entries()];
  }, [ck?.walls, geometry]);
  const toppled = useMemo(() => {
    const byPlayer = new Map<string, InstanceTransform[]>();
    for (const vertex of ck?.toppled ?? []) {
      const owner = board.buildings[vertex]?.player;
      const transform = vertexTransform(geometry, vertex);
      if (!owner || !transform) continue;
      byPlayer.set(owner, [...(byPlayer.get(owner) ?? []), transform]);
    }
    return [...byPlayer.entries()];
  }, [ck?.toppled, board, geometry]);
  if (!ck) return null;
  const colorOf = (playerId: string) => players.find((player) => player.id === playerId);
  return <>
    {knights.map(([key, group]) => {
      const owner = colorOf(group.playerId);
      return <KnightBatch key={key} color={playerColorHex(owner?.color ?? 'white')} seat={owner?.seat ?? 0}
        level={group.level} active={group.active} instances={group.items} material={material} quality={quality} />;
    })}
    {walls.map(([playerId, items]) => <WallBatch key={playerId} color={playerColorHex(colorOf(playerId)?.color ?? 'white')}
      instances={items} material={material} quality={quality} />)}
    {toppled.map(([playerId, items]) => {
      const owner = colorOf(playerId);
      return <ToppledBatch key={playerId} color={playerColorHex(owner?.color ?? 'white')} seat={owner?.seat ?? 0}
        instances={items} material={material} quality={quality} />;
    })}
    {TRACKS.map((track) => {
      const site = ck.metropolises[track];
      const transform = site ? vertexTransform(geometry, site.vertex, METROPOLIS_OFFSET) : null;
      if (!site || !transform) return null;
      return <Metropolis key={track} track={track} color={playerColorHex(colorOf(site.player)?.color ?? 'white')}
        transform={transform} material={material} quality={quality} />;
    })}
  </>;
}

/** Ghost of a knight (or a wall) on a candidate intersection. */
export function KnightGhost({ geometry, vertex, level, active, wall, material }: {
  geometry: Props['geometry']; vertex: number; level: KnightLevel; active: boolean; wall?: boolean; material: Material;
}) {
  const model = useDioramaGeometry(() => wall ? createWallModel('#ffffff') : createKnightModel('#ffffff', level, active, 0), [wall, level, active]);
  const transform = vertexTransform(geometry, vertex, [0, 0], wall ? 1 : KNIGHT_SCALE);
  if (!transform) return null;
  return <mesh geometry={model} material={material} position={transform.position} rotation={[0, transform.rotationY, 0]}
    scale={transform.scale} dispose={null} renderOrder={4} />;
}
