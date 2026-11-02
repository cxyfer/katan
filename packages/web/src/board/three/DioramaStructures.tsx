import { useMemo } from 'react';
import type { BufferGeometry, Material } from 'three';
import { placementArrival } from '../effects.ts';
import type { BoardSceneProps } from '../render-contract.ts';
import { playerColorHex } from '../terrain.ts';
import { ArrivalShadows } from './ArrivalShadows.tsx';
import { geometryToWorld } from './bounds.ts';
import { useDioramaGeometry } from './diorama-geometry.ts';
import {
  createHarborModel,
  createRoadModel,
  createSettlementModel,
  dioramaHarborInstances,
} from './diorama-structures.ts';
import { InstancedPrimitive } from './InstancedPrimitive.tsx';
import type { ArrivalOptions } from './arrival.ts';
import {
  BUILDING_ARRIVAL,
  BUILDING_ARRIVAL_TRANSFORM_MS,
  ROAD_ARRIVAL,
  ROAD_ARRIVAL_TRANSFORM_MS,
  roadInstances,
} from './model-specs.ts';
import type { InstanceTransform } from './transforms.ts';

type PieceProps = Pick<BoardSceneProps, 'geometry' | 'board' | 'players' | 'arrivals' | 'motionAllowed' | 'quality'> & {
  material: Material;
};

interface PieceInstance extends InstanceTransform {
  playerId: string;
  city: boolean;
  arrivalKey: string | null;
  /** 落點陰影的底面輪廓（世界單位）。 */
  footprint: readonly [number, number];
}

// 陰影邊緣柔化，輪廓略大於模型底座（村莊 0.25×0.22、城市 0.41×0.35、道路寬約 0.12）。
const SETTLEMENT_FOOTPRINT = [0.36, 0.32] as const;
const CITY_FOOTPRINT = [0.54, 0.46] as const;
const ROAD_SHADOW_WIDTH = 0.2;

function AnimatedPieces({
  model, instances, material, quality, motionAllowed, duration, arrival,
}: {
  model: BufferGeometry;
  instances: readonly PieceInstance[];
  material: Material;
  quality: BoardSceneProps['quality'];
  motionAllowed: boolean;
  duration: number;
  arrival: ArrivalOptions;
}) {
  // 靜止棋子一批；每組落下演出各自一批，才能依各自抵達時間起算。
  const groups = useMemo(() => {
    const grouped = new Map<string | null, PieceInstance[]>([[null, []]]);
    for (const item of instances) {
      const items = grouped.get(item.arrivalKey) ?? [];
      items.push(item);
      grouped.set(item.arrivalKey, items);
    }
    return [...grouped.entries()];
  }, [instances]);
  return groups.map(([key, items]) => <group key={key ?? 'rest'}>
    <InstancedPrimitive geometry={model} material={material} instances={items}
      castShadow={quality === 'standard'} animationKey={key}
      durationMs={duration} motionAllowed={motionAllowed} arrival={arrival} />
    {key !== null && <ArrivalShadows animationKey={key} durationMs={duration} arrival={arrival} motionAllowed={motionAllowed}
      footprints={items.map((item) => ({ position: item.position, rotationY: item.rotationY ?? 0, size: item.footprint }))} />}
  </group>);
}

function PlayerBuildings({
  color, city, seat, instances, ...props
}: Omit<PieceProps, 'geometry' | 'board' | 'players' | 'arrivals'> & {
  color: string;
  city: boolean;
  seat: number;
  instances: readonly PieceInstance[];
}) {
  const model = useDioramaGeometry(() => createSettlementModel(color, city, seat), [color, city, seat]);
  return <AnimatedPieces {...props} model={model} instances={instances} duration={BUILDING_ARRIVAL_TRANSFORM_MS} arrival={BUILDING_ARRIVAL} />;
}

export function DioramaBuildings({ geometry, board, players, arrivals, ...props }: PieceProps) {
  const instances = useMemo<PieceInstance[]>(() => geometry.vertices.flatMap((vertex) => {
    const building = board.buildings[vertex.index];
    if (!building) return [];
    const point = geometryToWorld(geometry, vertex.x, vertex.y);
    return [{
      playerId: building.player,
      city: building.city,
      arrivalKey: placementArrival(arrivals, board, 'vertex', vertex.index)?.id ?? null,
      footprint: building.city ? CITY_FOOTPRINT : SETTLEMENT_FOOTPRINT,
      position: [point.x, 0.005, point.z],
      rotationY: ((vertex.index * 23) % 6) * (Math.PI / 6),
      scale: [1, 1, 1],
    }];
  }), [board, geometry, arrivals]);
  return players.flatMap((player) => [false, true].map((city) => {
    const items = instances.filter((item) => item.playerId === player.id && item.city === city);
    return items.length ? <PlayerBuildings {...props} key={`${player.id}:${city}`}
      color={playerColorHex(player.color)} city={city} seat={player.seat} instances={items} /> : null;
  }));
}

function PlayerRoads({ color, seat, instances, ...props }: Omit<PieceProps, 'geometry' | 'board' | 'players' | 'arrivals'> & {
  color: string;
  seat: number;
  instances: readonly PieceInstance[];
}) {
  const model = useDioramaGeometry(() => createRoadModel(color, seat), [color, seat]);
  return <AnimatedPieces {...props} model={model} instances={instances} duration={ROAD_ARRIVAL_TRANSFORM_MS} arrival={ROAD_ARRIVAL} />;
}

export function DioramaRoads({ geometry, board, players, arrivals, ...props }: PieceProps) {
  const instances = useMemo<PieceInstance[]>(() => roadInstances(geometry, board, players, arrivals).map((road) => ({
    ...road,
    city: false,
    footprint: [road.length + 0.04, ROAD_SHADOW_WIDTH] as const,
    // Existing road specs shorten by .17; this miniature uses a .20 total setback.
    scale: [Math.max(0.01, road.length - 0.03), 1, 1],
  })), [board, geometry, players, arrivals]);
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
