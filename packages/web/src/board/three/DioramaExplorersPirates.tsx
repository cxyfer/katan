import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Material, Mesh, MeshStandardMaterial } from 'three';
import type { EpCargo } from '@catan/rules';
import type { BoardSceneProps } from '../render-contract.ts';
import { playerColorHex } from '../terrain.ts';
import { useDioramaGeometry } from './diorama-geometry.ts';
import { createPirateModel, createShipModel, SHIP_SCALE } from './diorama-ships.ts';
import {
  createCargoModel,
  createCouncilModel,
  createFogModel,
  createHarborFlagModel,
  createLairModel,
  createRegionModel,
  createShoalModel,
  createSpiceFarmModel,
  epShipPlacements,
  hexHeight,
  hexPoint,
} from './diorama-explorers.ts';
import { InstancedPrimitive } from './InstancedPrimitive.tsx';
import type { InstanceTransform, Vec3 } from './transforms.ts';
import { SEA_LEVEL } from '../sea.ts';

type Props = Pick<BoardSceneProps, 'geometry' | 'players' | 'active' | 'motionAllowed' | 'quality' | 'explorersPirates'> & {
  material: Material;
};

const FOG_LIFT_MS = 900;

function colorOf(players: Props['players'], playerId: string): string {
  return playerColorHex(players.find((player) => player.id === playerId)?.color ?? 'white');
}

function Piece({ factory, deps, position, rotationY = 0, scale = 1, material, castShadow }: {
  factory: () => import('three').BufferGeometry; deps: readonly unknown[]; position: Vec3; rotationY?: number; scale?: number;
  material: Material; castShadow: boolean;
}) {
  const model = useDioramaGeometry(factory, deps);
  return <mesh geometry={model} material={material} position={position} rotation={[0, rotationY, 0]} scale={scale}
    castShadow={castShadow} dispose={null} />;
}

function Cargo({ piece, color, position, rotationY = 0, material, castShadow }: {
  piece: EpCargo; color: string; position: Vec3; rotationY?: number; material: Material; castShadow: boolean;
}) {
  const tint = piece === 'settler' || piece === 'crew' ? color : '#ffffff';
  return <Piece factory={() => createCargoModel(piece, tint)} deps={[piece, tint]} position={position} rotationY={rotationY}
    scale={1.6} material={material} castShadow={castShadow} />;
}

/** The fog bank of a freshly explored hex rises and fades once. */
function FogLift({ position, material, motionAllowed, animationKey }: { position: Vec3; material: Material; motionAllowed: boolean; animationKey: string }) {
  const model = useDioramaGeometry(createFogModel, []);
  const faded = useMemo(() => {
    const clone = (material as MeshStandardMaterial).clone();
    clone.transparent = true;
    clone.depthWrite = false;
    return clone;
  }, [material]);
  useEffect(() => () => faded.dispose(), [faded]);
  const meshRef = useRef<Mesh | null>(null);
  const start = useRef<number | null>(null);
  const { invalidate } = useThree();
  useEffect(() => { start.current = null; invalidate(); }, [animationKey, invalidate]);
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (start.current === null) start.current = clock.elapsedTime;
    const progress = Math.min(1, ((clock.elapsedTime - start.current) * 1000) / FOG_LIFT_MS);
    faded.opacity = 1 - progress;
    mesh.position.y = position[1] + progress * 0.35;
    mesh.visible = progress < 1;
    if (progress < 1) invalidate();
  });
  if (!motionAllowed) return null;
  return <mesh ref={meshRef} geometry={model} material={faded} position={position} dispose={null} renderOrder={3} />;
}

/**
 * Explorers & Pirates on the 3D board: fog with region markers, ships with
 * their cargo, harbour flags, sites with crews and the pirate ship. Nothing
 * for other games.
 */
export function DioramaExplorersPirates(props: Props) {
  const { geometry, players, explorersPirates: ep, material, quality, active, motionAllowed } = props;
  const shadow = quality === 'standard';
  const fogModel = useDioramaGeometry(createFogModel, []);
  const parrotModel = useDioramaGeometry(() => createRegionModel('parrot'), []);
  const gooseModel = useDioramaGeometry(() => createRegionModel('goose'), []);
  const pirateModel = useDioramaGeometry(createPirateModel, []);
  const fog = useMemo(() => {
    const out: Record<'fog' | 'parrot' | 'goose', InstanceTransform[]> = { fog: [], parrot: [], goose: [] };
    for (const entry of ep?.fog ?? []) {
      const point = hexPoint(geometry, entry.hex, SEA_LEVEL + 0.02);
      if (!point) continue;
      out.fog.push({ position: point, rotationY: 0, scale: [1, 1, 1] });
      out[entry.region].push({ position: [point[0], point[1] + 0.2, point[2]], rotationY: 0.5, scale: [1.6, 1.6, 1.6] });
    }
    return out;
  }, [ep?.fog, geometry]);
  const ships = useMemo(() => (ep ? epShipPlacements(geometry, ep, SHIP_SCALE) : []), [ep, geometry]);
  if (!ep) return null;
  const lifts = (active?.events ?? []).filter((event) => event.type === 'ep.explored' && typeof event.params.hex === 'number');
  return <>
    {fog.fog.length > 0 && <InstancedPrimitive geometry={fogModel} material={material} instances={fog.fog} castShadow={false} />}
    {fog.parrot.length > 0 && <InstancedPrimitive geometry={parrotModel} material={material} instances={fog.parrot} castShadow={false} />}
    {fog.goose.length > 0 && <InstancedPrimitive geometry={gooseModel} material={material} instances={fog.goose} castShadow={false} />}
    {lifts.map((event) => {
      const point = hexPoint(geometry, event.params.hex as number, SEA_LEVEL + 0.02);
      return point ? <FogLift key={`${active!.id}-${event.seq}`} animationKey={`${active!.id}-${event.seq}`} position={point}
        material={material} motionAllowed={motionAllowed} /> : null;
    })}

    {ships.map((ship) => {
      const color = colorOf(players, ship.playerId);
      const seat = players.find((player) => player.id === ship.playerId)?.seat ?? 0;
      const along: Vec3 = [Math.cos(ship.rotationY), 0, -Math.sin(ship.rotationY)];
      return <group key={ship.id}>
        <Piece factory={() => createShipModel(color, seat)} deps={[color, seat]} position={ship.position} rotationY={ship.rotationY}
          scale={SHIP_SCALE} material={material} castShadow={shadow} />
        {ship.cargo.map((piece, index) => {
          const shift = (index - (ship.cargo.length - 1) / 2) * 0.16 + 0.06;
          const position: Vec3 = [ship.position[0] + along[0] * shift, ship.position[1] + 0.13, ship.position[2] + along[2] * shift];
          return <Cargo key={index} piece={piece} color={color} position={position} rotationY={ship.rotationY} material={material} castShadow={shadow} />;
        })}
      </group>;
    })}

    {ep.harbors.map((harbor) => {
      const vertex = geometry.vertices[harbor.vertex];
      if (!vertex) return null;
      const color = colorOf(players, harbor.player);
      const x = vertex.x / geometry.scale;
      const z = vertex.y / geometry.scale;
      return <group key={`harbor-${harbor.vertex}`}>
        <Piece factory={() => createHarborFlagModel(color)} deps={[color]} position={[x + 0.12, 0, z - 0.1]} scale={1.4} material={material} castShadow={shadow} />
        {harbor.cargo.map((piece, index) => (
          <Cargo key={index} piece={piece} color={color} position={[x - 0.14 + index * 0.12, 0, z + 0.16]} material={material} castShadow={shadow} />
        ))}
      </group>;
    })}

    {ep.sites.map((site) => {
      const y = hexHeight(geometry, site.hex);
      const center = hexPoint(geometry, site.hex, y);
      if (!center) return null;
      const [x, , z] = center;
      const crews = 'crews' in site ? site.crews : [];
      const crewRow = crews.map((player, index) => (
        <Cargo key={`crew-${index}`} piece="crew" color={colorOf(players, player)}
          position={[x - ((crews.length - 1) * 0.14) / 2 + index * 0.14, y, z - 0.34]} material={material} castShadow={shadow} />
      ));
      switch (site.kind) {
        case 'council':
          return <Piece key={`site-${site.hex}`} factory={createCouncilModel} deps={[]} position={[x, y, z]} rotationY={0.3} scale={1.2} material={material} castShadow={shadow} />;
        case 'lair':
          return <group key={`site-${site.hex}`}>
            {!site.captured && <Piece factory={createLairModel} deps={[]} position={[x + 0.4, y, z - 0.2]} scale={1.3} material={material} castShadow={shadow} />}
            {crewRow}
          </group>;
        case 'shoal':
          return <group key={`site-${site.hex}`}>
            <Piece factory={() => createShoalModel(site.number)} deps={[site.number]} position={[x, y + 0.01, z + 0.25]} scale={1.3} material={material} castShadow={false} />
            {site.fish && <Cargo piece="fish" color="#ffffff" position={[x, y + 0.02, z - 0.12]} material={material} castShadow={shadow} />}
          </group>;
        case 'spice':
          return <group key={`site-${site.hex}`}>
            <Piece factory={createSpiceFarmModel} deps={[]} position={[x, y, z]} scale={1.4} material={material} castShadow={shadow} />
            {crewRow}
          </group>;
      }
    })}

    {ep.pirate && (() => {
      const point = hexPoint(geometry, ep.pirate.hex, SEA_LEVEL + 0.01);
      if (!point) return null;
      const color = colorOf(players, ep.pirate.owner);
      return <group>
        <mesh geometry={pirateModel} material={material} position={point} rotation={[0, 0.4, 0]} castShadow={shadow} dispose={null} />
        <Piece factory={() => createHarborFlagModel(color)} deps={[color]} position={[point[0] + 0.3, point[1] + 0.05, point[2] - 0.2]} scale={1.2}
          material={material} castShadow={shadow} />
      </group>;
    })()}
  </>;
}
