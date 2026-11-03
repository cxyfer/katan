import { useMemo } from 'react';
import type { Material } from 'three';
import type { BoardSceneProps } from '../render-contract.ts';
import { playerColorHex } from '../terrain.ts';
import { geometryToWorld } from './bounds.ts';
import { useDioramaGeometry } from './diorama-geometry.ts';
import { createIslandTokenModel, createPirateModel, createShipModel, pirateTransform, SHIP_SCALE, shipInstances, shipTransform } from './diorama-ships.ts';
import { InstancedPrimitive } from './InstancedPrimitive.tsx';
import { SEA_LEVEL } from '../sea.ts';
import { ROAD_ARRIVAL_TRANSFORM_MS } from './model-specs.ts';

type Props = Pick<BoardSceneProps, 'geometry' | 'board' | 'players' | 'arrivals' | 'motionAllowed' | 'quality' | 'seafarers'> & {
  material: Material;
};

function PlayerShips({ color, seat, items, material, quality, motionAllowed }: Omit<Props, 'geometry' | 'board' | 'players' | 'seafarers'> & {
  color: string; seat: number; items: ReturnType<typeof shipInstances>;
}) {
  const model = useDioramaGeometry(() => createShipModel(color, seat), [color, seat]);
  const groups = useMemo(() => {
    const grouped = new Map<string | null, typeof items>();
    for (const item of items) {
      const group = grouped.get(item.arrivalKey) ?? [];
      group.push(item);
      grouped.set(item.arrivalKey, group);
    }
    return [...grouped.entries()];
  }, [items]);
  return groups.map(([key, group]) => <InstancedPrimitive key={key ?? 'rest'} geometry={model} material={material}
    instances={group} castShadow={quality === 'standard'} animationKey={key}
    durationMs={ROAD_ARRIVAL_TRANSFORM_MS} motionAllowed={motionAllowed} />);
}

function IslandTokens({ color, vertices, geometry, material }: Pick<Props, 'geometry' | 'material'> & { color: string; vertices: number[] }) {
  const model = useDioramaGeometry(() => createIslandTokenModel(color), [color]);
  const instances = vertices.flatMap((index) => {
    const vertex = geometry.vertices[index];
    if (!vertex) return [];
    const point = geometryToWorld(geometry, vertex.x, vertex.y);
    return [{ position: [point.x + 0.16, 0.005, point.z + 0.15] as [number, number, number], rotationY: 0, scale: [1.6, 1.6, 1.6] as [number, number, number] }];
  });
  return <InstancedPrimitive geometry={model} material={material} instances={instances} />;
}

/** Ships, the pirate and island-bonus tokens; nothing for base games. */
export function DioramaSeafarers(props: Props) {
  const { geometry, board, players, seafarers, material, quality } = props;
  const ships = useMemo(() => shipInstances(geometry, board, props.arrivals), [geometry, board, props.arrivals]);
  const pirateModel = useDioramaGeometry(createPirateModel, []);
  if (!seafarers) return null;
  const pirate = pirateTransform(geometry, board);
  return <>
    {players.map((player) => {
      const items = ships.filter((ship) => ship.playerId === player.id);
      return items.length ? <PlayerShips key={player.id} {...props} color={playerColorHex(player.color)} seat={player.seat} items={items} /> : null;
    })}
    <mesh position={pirate.position} rotation={[0, pirate.onFrame ? Math.PI / 2 : 0.4, 0]} geometry={pirateModel}
      material={material} castShadow={quality === 'standard'} dispose={null} />
    {players.map((player) => {
      const vertices = seafarers.islandClaims.filter((claim) => claim.player === player.id).map((claim) => claim.vertex);
      return vertices.length ? <IslandTokens key={player.id} color={playerColorHex(player.color)} vertices={vertices} geometry={geometry} material={material} /> : null;
    })}
  </>;
}

/** Ghost of a ship on a candidate path. */
export function ShipGhost({ geometry, edge, material }: { geometry: Props['geometry']; edge: number; material: Material }) {
  const model = useDioramaGeometry(() => createShipModel('#ffffff', 0), []);
  const transform = shipTransform(geometry, edge);
  if (!transform) return null;
  return <mesh geometry={model} material={material} position={transform.position} rotation={[0, transform.rotationY, 0]} scale={SHIP_SCALE} dispose={null} renderOrder={4} />;
}

/** Ghost of the pirate on a candidate sea hex. */
export function PirateGhost({ geometry, hex, material }: { geometry: Props['geometry']; hex: number; material: Material }) {
  const model = useDioramaGeometry(createPirateModel, []);
  const cell = geometry.hexes[hex];
  if (!cell) return null;
  const transform = { position: [cell.cx / geometry.scale, SEA_LEVEL + 0.01, cell.cy / geometry.scale] as [number, number, number] };
  return <mesh geometry={model} material={material} position={transform.position} rotation={[0, 0.4, 0]} dispose={null} renderOrder={4} />;
}
