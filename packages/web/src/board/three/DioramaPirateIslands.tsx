/**
 * The Pirate Islands（海盜巢穴）的 3D 疊加物：堡壘旁的 pirate lair、beachhead 標記、
 * 船線目標環與海盜航道標記。建築與船本身由一般的建築與船實例畫（堡壘是玩家色的村落）。
 */

import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { Material } from 'three';
import type { BoardGeometry } from '../geometry.ts';
import type { PirateIslandsView } from '../seafarers.ts';
import { SEA_LEVEL } from '../sea.ts';
import { playerColorHex } from '../terrain.ts';
import { useDioramaGeometry } from './diorama-geometry.ts';
import { createBeachheadModel, createLairStackModel, createRouteMarkModel, createTargetRingModel, lairSpot, vertexSpot } from './diorama-pirate-islands.ts';
import { InstancedPrimitive } from './InstancedPrimitive.tsx';
import type { InstanceTransform } from './transforms.ts';

const UNIT: [number, number, number] = [1, 1, 1];

/** 證據用掛勾：場景實際畫出的堡壘 lair 數、beachhead 數與航道標記數（`data-lair-stacks` 等）。 */
function PirateProbe({ lairs, beachheads, route }: { lairs: string; beachheads: number; route: number }) {
  const canvas = useThree((state) => state.gl.domElement);
  useEffect(() => {
    canvas.dataset.lairStacks = lairs;
    canvas.dataset.beachheadMarkers = String(beachheads);
    canvas.dataset.routeMarkers = String(route);
    return () => { delete canvas.dataset.lairStacks; delete canvas.dataset.beachheadMarkers; delete canvas.dataset.routeMarkers; };
  }, [canvas, lairs, beachheads, route]);
  return null;
}

function LairStacks({ count, vertices, geometry, material }: { count: number; vertices: number[]; geometry: BoardGeometry; material: Material }) {
  const model = useDioramaGeometry(() => createLairStackModel(count), [count]);
  const instances = useMemo<InstanceTransform[]>(() => vertices.flatMap((vertex) => {
    const position = lairSpot(geometry, vertex);
    return position ? [{ position, rotationY: 0, scale: UNIT }] : [];
  }), [vertices, geometry]);
  return <InstancedPrimitive geometry={model} material={material} instances={instances} castShadow={false} />;
}

function Beachheads({ color, vertices, geometry, material }: { color: string; vertices: number[]; geometry: BoardGeometry; material: Material }) {
  const model = useDioramaGeometry(() => createBeachheadModel(color), [color]);
  const instances = useMemo<InstanceTransform[]>(() => vertices.flatMap((vertex) => {
    const position = vertexSpot(geometry, vertex);
    return position ? [{ position, rotationY: 0, scale: UNIT }] : [];
  }), [vertices, geometry]);
  return <InstancedPrimitive geometry={model} material={material} instances={instances} castShadow={false} />;
}

export function PirateIslandsLayer({ geometry, pirate, players, material, target }: {
  geometry: BoardGeometry; pirate: PirateIslandsView; players: readonly { id: string; color: string }[]; material: Material;
  /** 自己船線的下一個目標頂點（沒有則 null）。 */
  target: number | null;
}) {
  const ring = useDioramaGeometry(createTargetRingModel, []);
  const mark = useDioramaGeometry(createRouteMarkModel, []);
  const byLairs = [0, 1, 2, 3].map((count) => ({ count, vertices: pirate.fortresses.filter((fortress) => fortress.lairs === count).map((fortress) => fortress.vertex) }))
    .filter((group) => group.count > 0 && group.vertices.length > 0);
  const route = useMemo<InstanceTransform[]>(() => pirate.route.flatMap((hex) => {
    const cell = geometry.hexes[hex];
    return cell ? [{ position: [cell.cx / geometry.scale, SEA_LEVEL + 0.012, cell.cy / geometry.scale] as [number, number, number], rotationY: 0, scale: UNIT }] : [];
  }), [pirate.route, geometry]);
  const ringSpot = target === null ? null : vertexSpot(geometry, target);
  return <>
    <PirateProbe lairs={pirate.fortresses.map((fortress) => fortress.lairs).join(',')} beachheads={pirate.beachheads.filter((beachhead) => !!geometry.vertices[beachhead.vertex]).length} route={route.length} />
    {byLairs.map((group) => <LairStacks key={group.count} {...group} geometry={geometry} material={material} />)}
    {players.map((player) => {
      const vertices = pirate.beachheads.filter((beachhead) => beachhead.player === player.id).map((beachhead) => beachhead.vertex);
      return vertices.length ? <Beachheads key={player.id} color={playerColorHex(player.color as never)} vertices={vertices} geometry={geometry} material={material} /> : null;
    })}
    <InstancedPrimitive geometry={mark} material={material} instances={route} castShadow={false} />
    {ringSpot && <InstancedPrimitive geometry={ring} material={material} instances={[{ position: ringSpot, rotationY: 0, scale: UNIT }]} castShadow={false} />}
  </>;
}
