import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { Material } from 'three';
import type { BoardSceneProps } from '../render-contract.ts';
import { playerColorHex } from '../terrain.ts';
import { geometryToWorld } from './bounds.ts';
import { useDioramaGeometry } from './diorama-geometry.ts';
import { createFogModel, hexPoint } from './diorama-explorers.ts';
import { FogLift } from './DioramaExplorersPirates.tsx';
import { createClothStackModel, createGiftModel, createIslandTokenModel, createLinkPinModel, createPirateModel, createShipModel, createTribePostModel, giftTransform, pirateTransform, SHIP_SCALE, shipInstances, shipTransform, tribeSpot } from './diorama-ships.ts';
import type { ClothView, TribeGiftView } from '../seafarers.ts';
import { InstancedPrimitive } from './InstancedPrimitive.tsx';
import { SEA_LEVEL } from '../sea.ts';
import { ROAD_ARRIVAL_TRANSFORM_MS } from './model-specs.ts';

type Props = Pick<BoardSceneProps, 'geometry' | 'board' | 'players' | 'arrivals' | 'motionAllowed' | 'quality' | 'seafarers' | 'active'> & {
  material: Material;
};

function PlayerShips({ color, seat, items, material, quality, motionAllowed }: Omit<Props, 'geometry' | 'board' | 'players' | 'seafarers' | 'active'> & {
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

const GIFT_TINT: Readonly<Record<string, string>> = {
  generic: '#2f6d84', lumber: '#3f6f3d', brick: '#a8502f', wool: '#7da34f', grain: '#c39130', ore: '#6d7d86',
};

/** 世外部落的禮物：同種的合成一組實例（港口依資源各一組）。 */
function Gifts({ gifts, geometry, material }: Pick<Props, 'geometry' | 'material'> & { gifts: readonly TribeGiftView[] }) {
  const groups = useMemo(() => {
    const out = new Map<string, { kind: TribeGiftView['kind']; harbor?: string; edges: number[] }>();
    for (const gift of gifts) {
      const key = gift.kind === 'port' ? `port:${gift.harbor}` : gift.kind;
      const group = out.get(key) ?? { kind: gift.kind, ...(gift.harbor ? { harbor: gift.harbor } : {}), edges: [] };
      group.edges.push(gift.edge);
      out.set(key, group);
    }
    return [...out.entries()];
  }, [gifts]);
  return <>{groups.map(([key, group]) => <GiftGroup key={key} {...group} geometry={geometry} material={material} />)}</>;
}

function GiftGroup({ kind, harbor, edges, geometry, material }: Pick<Props, 'geometry' | 'material'> & { kind: TribeGiftView['kind']; harbor?: string; edges: number[] }) {
  const model = useDioramaGeometry(() => createGiftModel(kind, harbor ? GIFT_TINT[harbor] : undefined), [kind, harbor]);
  const instances = useMemo(() => edges.flatMap((edge) => {
    const transform = giftTransform(geometry, edge);
    return transform ? [{ position: transform.position, rotationY: transform.rotationY, scale: [1.5, 1.5, 1.5] as [number, number, number] }] : [];
  }), [edges, geometry]);
  return <InstancedPrimitive geometry={model} material={material} instances={instances} castShadow={false} />;
}

/** 證據用掛勾：把場景實際畫出的禮物數寫到 canvas 的 `data-gift-markers`。 */
function GiftProbe({ count }: { count: number }) {
  const canvas = useThree((state) => state.gl.domElement);
  useEffect(() => {
    canvas.dataset.giftMarkers = String(count);
    return () => { delete canvas.dataset.giftMarkers; };
  }, [canvas, count]);
  return null;
}

/**
 * 證據用掛勾（無副作用）：把場景實際畫出的島嶼獎勵標記數寫到 canvas 的
 * `data-island-tokens`，瀏覽器證據腳本以此斷言 3D 場景有標記。
 */
function IslandTokenProbe({ count }: { count: number }) {
  const canvas = useThree((state) => state.gl.domElement);
  useEffect(() => {
    canvas.dataset.islandTokens = String(count);
    return () => { delete canvas.dataset.islandTokens; };
  }, [canvas, count]);
  return null;
}

/** 證據用掛勾：場景實際畫出的未翻開空格數（`data-fog-hexes`），瀏覽器證據腳本以此斷言 3D 有迷霧。 */
function FogProbe({ count }: { count: number }) {
  const canvas = useThree((state) => state.gl.domElement);
  useEffect(() => {
    canvas.dataset.fogHexes = String(count);
    return () => { delete canvas.dataset.fogHexes; };
  }, [canvas, count]);
  return null;
}

/** 證據用掛勾：把場景實際畫出的部落數與各部落布匹寫到 canvas 的 `data-tribe-markers`、`data-tribe-cloth`。 */
function TribeProbe({ cloth, count }: { cloth: readonly number[]; count: number }) {
  const canvas = useThree((state) => state.gl.domElement);
  const key = cloth.join(',');
  useEffect(() => {
    canvas.dataset.tribeMarkers = String(count);
    canvas.dataset.tribeCloth = key;
    return () => { delete canvas.dataset.tribeMarkers; delete canvas.dataset.tribeCloth; };
  }, [canvas, count, key]);
  return null;
}

/**
 * 布匹產地的部落：水中木樁（圓片由 `NumberBadges` 畫）、旁邊一疊布匹（數量 = 剩餘布匹，最多畫 5 捲）
 * 與已建立關係的玩家色木樁。
 */
function Tribes({ cloth, geometry, material, players }: Pick<Props, 'geometry' | 'material' | 'players'> & { cloth: ClothView }) {
  const post = useDioramaGeometry(createTribePostModel, []);
  const spots = useMemo(() => cloth.tribes.map((tribe) => tribeSpot(geometry, tribe.vertex)), [cloth, geometry]);
  const postInstances = spots.flatMap((spot) => spot ? [{ position: [spot.x, 0, spot.z] as [number, number, number], rotationY: 0, scale: [1, 1, 1] as [number, number, number] }] : []);
  const counts = [...new Set(cloth.tribes.map((tribe) => Math.min(5, tribe.cloth)))];
  return <>
    <InstancedPrimitive geometry={post} material={material} instances={postInstances} castShadow={false} />
    {counts.map((count) => <ClothStacks key={count} count={count} material={material}
      instances={cloth.tribes.flatMap((tribe, index) => {
        const spot = spots[index];
        return spot && Math.min(5, tribe.cloth) === count
          ? [{ position: [spot.x + spot.outX * 0.42, SEA_LEVEL + 0.01, spot.z + spot.outZ * 0.42] as [number, number, number], rotationY: Math.atan2(-spot.outZ, spot.outX), scale: [1.7, 1.7, 1.7] as [number, number, number] }]
          : [];
      })} />)}
    {players.map((player) => {
      const pins = cloth.tribes.flatMap((_tribe, index) => {
        const spot = spots[index];
        const linked = cloth.links[player.id] ?? [];
        if (!spot || !linked.includes(index)) return [];
        const slot = players.filter((candidate) => (cloth.links[candidate.id] ?? []).includes(index)).findIndex((candidate) => candidate.id === player.id);
        const side = (slot - 1) * 0.16;
        return [{ position: [spot.x - spot.outZ * side - spot.outX * 0.28, SEA_LEVEL + 0.01, spot.z + spot.outX * side - spot.outZ * 0.28] as [number, number, number], rotationY: 0, scale: [1.7, 1.7, 1.7] as [number, number, number] }];
      });
      return pins.length ? <LinkPins key={player.id} color={playerColorHex(player.color)} instances={pins} material={material} /> : null;
    })}
  </>;
}

function ClothStacks({ count, instances, material }: Pick<Props, 'material'> & { count: number; instances: { position: [number, number, number]; rotationY: number; scale: [number, number, number] }[] }) {
  const model = useDioramaGeometry(() => createClothStackModel(count), [count]);
  return <InstancedPrimitive geometry={model} material={material} instances={instances} castShadow={false} />;
}

function LinkPins({ color, instances, material }: Pick<Props, 'material'> & { color: string; instances: { position: [number, number, number]; rotationY: number; scale: [number, number, number] }[] }) {
  const model = useDioramaGeometry(() => createLinkPinModel(color), [color]);
  return <InstancedPrimitive geometry={model} material={material} instances={instances} castShadow={false} />;
}

/** Ships, the pirate, island-bonus tokens and the fog of unexplored hexes; nothing for base games. */
export function DioramaSeafarers(props: Props) {
  const { geometry, board, players, seafarers, material, quality } = props;
  const ships = useMemo(() => shipInstances(geometry, board, props.arrivals), [geometry, board, props.arrivals]);
  const pirateModel = useDioramaGeometry(createPirateModel, []);
  const fogModel = useDioramaGeometry(createFogModel, []);
  const fog = useMemo(() => (seafarers?.fog ?? []).flatMap((index) => {
    const point = hexPoint(geometry, index, SEA_LEVEL + 0.02);
    return point ? [{ position: point, rotationY: 0, scale: [1, 1, 1] as [number, number, number] }] : [];
  }), [seafarers?.fog, geometry]);
  if (!seafarers) return null;
  const lifts = (props.active?.events ?? []).filter((event) => event.type === 'fog.revealed' && typeof event.params.hex === 'number');
  const pirate = pirateTransform(geometry, board);
  const tokenCount = seafarers.islandClaims.filter((claim) => !!geometry.vertices[claim.vertex]).length;
  return <>
    <IslandTokenProbe count={tokenCount} />
    <FogProbe count={fog.length} />
    {fog.length > 0 && <InstancedPrimitive geometry={fogModel} material={material} instances={fog} castShadow={false} />}
    {lifts.map((event) => {
      const point = hexPoint(geometry, event.params.hex as number, SEA_LEVEL + 0.02);
      return point ? <FogLift key={`${props.active!.id}-${event.seq}`} animationKey={`${props.active!.id}-${event.seq}`} position={point}
        material={material} motionAllowed={props.motionAllowed} /> : null;
    })}
    {seafarers.cloth && <>
      <Tribes cloth={seafarers.cloth} geometry={geometry} material={material} players={players} />
      <TribeProbe cloth={seafarers.cloth.tribes.map((tribe) => tribe.cloth)} count={seafarers.cloth.tribes.filter((tribe) => !!tribeSpot(geometry, tribe.vertex)).length} />
    </>}
    {seafarers.tribe && <>
      <Gifts gifts={seafarers.tribe.gifts} geometry={geometry} material={material} />
      <GiftProbe count={seafarers.tribe.gifts.filter((gift) => !!giftTransform(geometry, gift.edge)).length} />
    </>}
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
