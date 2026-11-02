import { useMemo } from 'react';
import type { BufferGeometry, Material } from 'three';
import { confirmedPlacement } from '../effects.ts';
import type { BoardSceneProps } from '../render-contract.ts';
import { playerColorHex } from '../terrain.ts';
import { geometryToWorld } from './bounds.ts';
import { useDioramaGeometry } from './diorama-geometry.ts';
import {
  createHarborModel,
  createRoadModel,
  createSettlementModel,
  dioramaHarborInstances,
} from './diorama-structures.ts';
import { InstancedPrimitive } from './InstancedPrimitive.tsx';
import { BUILDING_ARRIVAL_TRANSFORM_MS, ROAD_ARRIVAL_TRANSFORM_MS, roadInstances } from './model-specs.ts';
import type { InstanceTransform } from './transforms.ts';

type PieceProps = Pick<BoardSceneProps, 'geometry' | 'board' | 'players' | 'active' | 'motionAllowed' | 'quality' | 'citiesKnights'> & {
  material: Material;
};

interface PieceInstance extends InstanceTransform {
  playerId: string;
  city: boolean;
  arriving: boolean;
}

function AnimatedPieces({
  model, instances, material, quality, active, motionAllowed, duration,
}: {
  model: BufferGeometry;
  instances: readonly PieceInstance[];
  material: Material;
  quality: BoardSceneProps['quality'];
  active: BoardSceneProps['active'];
  motionAllowed: boolean;
  duration: number;
}) {
  const groups = useMemo(() => [
    { arriving: false, items: instances.filter((item) => !item.arriving) },
    { arriving: true, items: instances.filter((item) => item.arriving) },
  ], [instances]);
  return groups.map(({ arriving, items }) => <InstancedPrimitive
    key={String(arriving)} geometry={model} material={material} instances={items}
    castShadow={quality === 'standard'} animationKey={arriving ? active?.id ?? null : null}
    durationMs={duration} motionAllowed={motionAllowed} />);
}

function PlayerBuildings({
  color, city, seat, instances, ...props
}: Omit<PieceProps, 'geometry' | 'board' | 'players'> & {
  color: string;
  city: boolean;
  seat: number;
  instances: readonly PieceInstance[];
}) {
  const model = useDioramaGeometry(() => createSettlementModel(color, city, seat), [color, city, seat]);
  return <AnimatedPieces {...props} model={model} instances={instances} duration={BUILDING_ARRIVAL_TRANSFORM_MS} />;
}

export function DioramaBuildings({ geometry, board, players, citiesKnights, ...props }: PieceProps) {
  const instances = useMemo<PieceInstance[]>(() => geometry.vertices.flatMap((vertex) => {
    const building = board.buildings[vertex.index];
    // A toppled city lies on its side instead (DioramaCitiesKnights).
    if (!building || citiesKnights?.toppled.includes(vertex.index)) return [];
    const point = geometryToWorld(geometry, vertex.x, vertex.y);
    return [{
      playerId: building.player,
      city: building.city,
      arriving: confirmedPlacement(props.active?.events ?? [], board, 'vertex', vertex.index),
      position: [point.x, 0.005, point.z],
      rotationY: ((vertex.index * 23) % 6) * (Math.PI / 6),
      scale: [1, 1, 1],
    }];
  }), [board, geometry, props.active, citiesKnights?.toppled]);
  return players.flatMap((player) => [false, true].map((city) => {
    const items = instances.filter((item) => item.playerId === player.id && item.city === city);
    return items.length ? <PlayerBuildings {...props} key={`${player.id}:${city}`}
      color={playerColorHex(player.color)} city={city} seat={player.seat} instances={items} /> : null;
  }));
}

function PlayerRoads({ color, seat, instances, ...props }: Omit<PieceProps, 'geometry' | 'board' | 'players'> & {
  color: string;
  seat: number;
  instances: readonly PieceInstance[];
}) {
  const model = useDioramaGeometry(() => createRoadModel(color, seat), [color, seat]);
  return <AnimatedPieces {...props} model={model} instances={instances} duration={ROAD_ARRIVAL_TRANSFORM_MS} />;
}

export function DioramaRoads({ geometry, board, players, ...props }: PieceProps) {
  const instances = useMemo<PieceInstance[]>(() => roadInstances(geometry, board, players, props.active).map((road) => ({
    ...road,
    city: false,
    // Existing road specs shorten by .17; this miniature uses a .20 total setback.
    scale: [Math.max(0.01, road.length - 0.03), 1, 1],
  })), [board, geometry, players, props.active]);
  return players.map((player) => {
    const items = instances.filter((item) => item.playerId === player.id);
    return items.length ? <PlayerRoads {...props} key={player.id} color={playerColorHex(player.color)}
      seat={player.seat} instances={items} /> : null;
  });
}

function HarborBatch({ type, instances, material, quality }: Pick<BoardSceneProps, 'quality'> & {
  type: string;
  instances: readonly InstanceTransform[];
  material: Material;
}) {
  const model = useDioramaGeometry(() => createHarborModel(type), [type]);
  return <InstancedPrimitive geometry={model} material={material} instances={instances} castShadow={quality === 'standard'} />;
}

export function DioramaHarbors({ geometry, board, material, quality }: Pick<BoardSceneProps, 'geometry' | 'board' | 'quality'> & {
  material: Material;
}) {
  // Each trade gets its own cargo, so harbors batch by type.
  const batches = useMemo(() => {
    const grouped = new Map<string, InstanceTransform[]>();
    for (const harbor of dioramaHarborInstances(geometry, board)) {
      const items = grouped.get(harbor.type) ?? [];
      items.push(harbor);
      grouped.set(harbor.type, items);
    }
    return [...grouped.entries()];
  }, [geometry, board]);
  return batches.map(([type, instances]) => <HarborBatch key={type} type={type} instances={instances} material={material} quality={quality} />);
}
