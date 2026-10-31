import { useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  IcosahedronGeometry,
  MeshStandardMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import type { BoardSceneProps } from '../render-contract.ts';
import { geometryToWorld } from './bounds.ts';
import { ModelBuilder, sceneryRandom, useDioramaGeometry } from './diorama-geometry.ts';
import { InstancedPrimitive } from './InstancedPrimitive.tsx';
import { createHexTileSurfaces } from './model-geometry.ts';
import { tileInstances } from './model-specs.ts';
import { horizontalRotation } from './transforms.ts';

export const DIORAMA_TERRAIN_COLORS: Readonly<Record<string, string>> = {
  forest: '#64865a',
  hills: '#bc7950',
  pasture: '#a1bb70',
  fields: '#ccaa53',
  mountains: '#879793',
  desert: '#ddc38b',
  gold: '#ac995b',
  sea: '#559fa5',
};

export function createGroundModel(terrain: string): BufferGeometry {
  const { cap, wall } = createHexTileSurfaces();
  wall.dispose();
  const position = cap.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const base = new Color(DIORAMA_TERRAIN_COLORS[terrain] ?? DIORAMA_TERRAIN_COLORS.sea);
  for (let index = 0; index < position.count; index += 3) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const tone = 0.98 + Math.sin(x * 18.7 + z * 12.3) * 0.025;
    const tint = base.clone().multiplyScalar(tone);
    for (let vertex = index; vertex < Math.min(index + 3, position.count); vertex++) tint.toArray(colors, vertex * 3);
  }
  cap.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return cap;
}

function GroundTiles({ terrain, props, material }: {
  terrain: string;
  props: Pick<BoardSceneProps, 'geometry' | 'board' | 'quality'>;
  material: Material;
}) {
  const model = useDioramaGeometry(() => createGroundModel(terrain), [terrain]);
  const instances = useMemo(() => tileInstances(props.geometry, props.board).filter((tile) => tile.terrain === terrain),
    [props.geometry, props.board, terrain]);
  return <InstancedPrimitive geometry={model} material={material} instances={instances}
    castShadow={props.quality === 'standard'} />;
}

export function DioramaGround(props: Pick<BoardSceneProps, 'geometry' | 'board' | 'quality'> & { material: Material; wall: BufferGeometry; wallMaterial: Material }) {
  const instances = useMemo(() => tileInstances(props.geometry, props.board), [props.geometry, props.board]);
  const terrains = useMemo(() => [...new Set(instances.map((tile) => tile.terrain))], [instances]);
  return <>
    <InstancedPrimitive geometry={props.wall} material={props.wallMaterial} instances={instances}
      castShadow={props.quality === 'standard'} />
    {terrains.map((terrain) => <GroundTiles key={terrain} terrain={terrain} props={props} material={props.material} />)}
  </>;
}

/** Only boundary edges get a beach: internal construction lanes stay clear. */
export function createCoastModel(geometry: BoardSceneProps['geometry'], foam = false): BufferGeometry {
  const builder = new ModelBuilder();
  const random = sceneryRandom(84621);
  for (const edge of geometry.edges) {
    const topologyEdge = geometry.topology.edges[edge.index];
    if (!topologyEdge || topologyEdge.hexes.length !== 1) continue;
    const hex = geometry.hexes[topologyEdge.hexes[0]!]!;
    const a = geometryToWorld(geometry, edge.x1, edge.y1);
    const b = geometryToWorld(geometry, edge.x2, edge.y2);
    const center = geometryToWorld(geometry, hex.cx, hex.cy);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const sign = (mx - center.x) * dz + (mz - center.z) * -dx > 0 ? 1 : -1;
    const nx = dz / length * sign;
    const nz = -dx / length * sign;
    const rotationY = horizontalRotation(dx, dz);
    if (foam) {
      builder.add(new BoxGeometry(length + 0.07, 0.008, 0.18), '#85c5bd',
        [mx + nx * 0.21, -0.277, mz + nz * 0.21], [1, 1, 1], [0, rotationY, 0]);
      continue;
    }
    builder.add(new BoxGeometry(length + 0.03, 0.075, 0.16), '#dfc496',
      [mx + nx * 0.025, -0.10, mz + nz * 0.025], [1, 1, 1], [0, rotationY, 0]);
    builder.add(new BoxGeometry(length + 0.035, 0.13, 0.18), '#746d55',
      [mx + nx * 0.01, -0.204, mz + nz * 0.01], [1, 1, 1], [0, rotationY, 0]);
    for (let rock = 0; rock < 6; rock++) {
      const t = (rock + 0.5) / 6;
      const offset = 0.035 + random() * 0.085;
      const x = a.x + dx * t + nx * offset;
      const z = a.z + dz * t + nz * offset;
      const size = 0.075 + random() * 0.055;
      const color = ['#85836c', '#b4a17a', '#a49069', '#697665'][rock % 4]!;
      builder.add(new IcosahedronGeometry(1, 0), color, [x, -0.19, z],
        [size * 1.35, size, size], [random(), random() * 3, random()]);
    }
  }
  return builder.build();
}

function Coast({ geometry, material, quality }: Pick<BoardSceneProps, 'geometry' | 'quality'> & { material: Material }) {
  const coast = useDioramaGeometry(() => createCoastModel(geometry), [geometry]);
  const foam = useDioramaGeometry(() => createCoastModel(geometry, true), [geometry]);
  return <>
    <mesh geometry={coast} material={material} receiveShadow castShadow={quality === 'standard'} dispose={null} />
    <mesh geometry={foam} material={material} receiveShadow dispose={null} />
  </>;
}

function Ocean() {
  const material = useMemo(() => {
    const water = new MeshStandardMaterial({ color: '#4b9da7', roughness: 0.66, metalness: 0.05 });
    water.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vSeaPosition;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSeaPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
      shader.fragmentShader = `varying vec3 vSeaPosition;\n${shader.fragmentShader}`.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 sea = vSeaPosition.xz;
        float broad = sin(sea.x * .72 + sin(sea.y * .83)) * sin(sea.y * .64);
        float ripple = sin(sea.x * 17.0 + sin(sea.y * 11.0)) * sin(sea.y * 14.0 + sea.x * 3.0);
        float glint = pow(max(0.0, ripple), 16.0) * .075;
        diffuseColor.rgb *= .92 + broad * .055 + glint;
        `,
      );
    };
    return { material: water, references: 0 };
  }, []);
  const geometry = useDioramaGeometry(() => new PlaneGeometry(180, 180), []);
  useEffect(() => {
    material.references++;
    return () => {
      material.references--;
      queueMicrotask(() => { if (!material.references) material.material.dispose(); });
    };
  }, [material]);
  return <mesh geometry={geometry} material={material.material} rotation={[-Math.PI / 2, 0, 0]}
    position={[0, -0.285, 0]} receiveShadow dispose={null} />;
}

export function DioramaIsland(props: Pick<BoardSceneProps, 'geometry' | 'quality'> & { material: Material }) {
  return <>
    <Ocean />
    <Coast {...props} />
  </>;
}
