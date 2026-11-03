import { useEffect, useMemo } from 'react';
import {
  Color,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector2,
  type BufferGeometry,
  type Material,
} from 'three';
import type { BoardSceneProps } from '../render-contract.ts';
import { PaintedMesh, useDioramaGeometry, valueNoise } from './diorama-geometry.ts';
import { createBeachModel, createShoreField, createShoreScatterModel, SEA_LEVEL, SHORE_DISTANCE_RANGE } from './diorama-coast.ts';
import { InstancedPrimitive } from './InstancedPrimitive.tsx';
import { tileInstances } from './model-specs.ts';
import type { Vec3 } from './transforms.ts';

export const DIORAMA_TERRAIN_COLORS: Readonly<Record<string, string>> = {
  forest: '#5a8150',
  hills: '#bf7c50',
  pasture: '#a3c06f',
  fields: '#d4ad55',
  mountains: '#8e9891',
  desert: '#e0c690',
  gold: '#ac995b',
  sea: '#559fa5',
  // Traders & Barbarians hexes
  lake: '#6f9f63',
  swamp: '#8a8752',
  oasis: '#dcc28c',
  castle: '#7ea85f',
  quarry: '#c58a62',
  glassworks: '#5f8c4f',
  keep: '#86ad66',
};

/** Shadow, mid and highlight tones blended by noise on each tile top. */
const GROUND_PAINT: Readonly<Record<string, readonly [string, string, string]>> = {
  forest: ['#3f6340', '#5a8150', '#7c9b5d'],
  hills: ['#a3613d', '#bf7c50', '#d49b6d'],
  pasture: ['#86a659', '#a3c06f', '#c0d48a'],
  fields: ['#b88e3d', '#d4ad55', '#e7ca76'],
  mountains: ['#717c77', '#8e9891', '#acb2a5'],
  desert: ['#ccad77', '#e0c690', '#f0deb2'],
  gold: ['#8f7b43', '#ac995b', '#cdb46a'],
  sea: ['#3f8a92', '#559fa5', '#7cbcbc'],
  lake: ['#557f4a', '#6f9f63', '#93bd7e'],
  swamp: ['#6b6a3c', '#8a8752', '#a9a56b'],
  oasis: ['#c9ad78', '#dcc28c', '#efdcae'],
  castle: ['#628a49', '#7ea85f', '#9fc47c'],
  quarry: ['#a56c48', '#c58a62', '#dcaa84'],
  glassworks: ['#4a7240', '#5f8c4f', '#7fa86a'],
  keep: ['#6a9050', '#86ad66', '#a7c784'],
};

/** Packed dirt around the number token, tinted per terrain. */
const WELL_PAINT: Readonly<Record<string, string>> = {
  forest: '#8a8a5e', hills: '#d6a47c', pasture: '#c4c88c', fields: '#e2c98a',
  mountains: '#b4b2a0', desert: '#efe0b8', gold: '#c8b67c', sea: '#8cc6c2',
  lake: '#a7c38f', swamp: '#b0aa75', oasis: '#efe0b8', castle: '#c8c2a8', quarry: '#e3d6c4', glassworks: '#b8a77e', keep: '#c8c2a8',
};

const TILE_TOP_RADIUS = 0.982;
const GROUND_SUBDIVISIONS = 10;
const CORNER_ANGLES = [30, 90, 150, 210, 270, 330].map((degrees) => (degrees * Math.PI) / 180);

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Normalized distance to the pointy-top hex rim: 0 at the centre, 1 on an edge. */
function hexRadius(x: number, z: number): number {
  const apothem = TILE_TOP_RADIUS * Math.sqrt(3) / 2;
  return Math.max(Math.abs(x), Math.abs(x * 0.5 + z * 0.866), Math.abs(x * 0.5 - z * 0.866)) / apothem;
}

/** A finely triangulated flat tile top whose vertex paint carries the terrain texture. */
export function createGroundModel(terrain: string): BufferGeometry {
  const [shadow, mid, light] = (GROUND_PAINT[terrain] ?? GROUND_PAINT.sea!).map((paint) => new Color(paint));
  const well = new Color(WELL_PAINT[terrain] ?? WELL_PAINT.sea!);
  const seed = [...terrain].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7) >>> 0;
  const broad = valueNoise(seed);
  const fine = valueNoise(seed + 97);
  const paint = (x: number, z: number): Color => {
    const patches = broad(x * 2.6 + 11, z * 2.6 + 5);
    const speckle = fine(x * 9, z * 9);
    const color = shadow.clone().lerp(mid, smoothstep(0.22, 0.62, patches));
    color.lerp(light, smoothstep(0.62, 0.92, patches * 0.55 + speckle * 0.45) * 0.85);
    if (terrain === 'fields') {
      // Ploughed furrows read as alternating bands of ripe and green-gold grain.
      color.lerp(shadow, (Math.sin((x * 0.5 + z * 0.866) * 30) * 0.5 + 0.5) * 0.22);
    } else if (terrain === 'desert') {
      color.lerp(light, Math.max(0, Math.sin(x * 15 + broad(x * 1.5, z * 1.5) * 6)) * 0.35);
    } else if (terrain === 'pasture' || terrain === 'forest') {
      color.lerp(light, smoothstep(0.78, 0.95, speckle) * 0.4);
    }
    const radius = Math.hypot(x, z);
    color.lerp(well, (1 - smoothstep(0.25, 0.36, radius)) * 0.55);
    // A soft darkened rim separates neighbouring tiles without a hard outline.
    color.multiplyScalar(1 - smoothstep(0.82, 1, hexRadius(x, z)) * 0.2);
    return color;
  };
  const mesh = new PaintedMesh();
  const n = GROUND_SUBDIVISIONS;
  for (let sector = 0; sector < 6; sector++) {
    const b = CORNER_ANGLES[sector]!;
    const c = CORNER_ANGLES[(sector + 1) % 6]!;
    const point = (i: number, j: number): Vec3 => [
      (Math.cos(b) * i + Math.cos(c) * j) * TILE_TOP_RADIUS / n, 0,
      (Math.sin(b) * i + Math.sin(c) * j) * TILE_TOP_RADIUS / n,
    ];
    const triangle = (p: Vec3, q: Vec3, r: Vec3) => {
      // Corners advance counter-clockwise in XZ, so (p, r, q) faces +Y.
      mesh.shaded(p, r, q, [paint(p[0], p[2]), paint(r[0], r[2]), paint(q[0], q[2])]);
    };
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        triangle(point(i, j), point(i + 1, j), point(i, j + 1));
        if (j < n - i - 1) triangle(point(i + 1, j), point(i + 1, j + 1), point(i, j + 1));
      }
    }
  }
  const geometry = mesh.geometry();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function GroundTiles({ terrain, props, material }: {
  terrain: string;
  props: Pick<BoardSceneProps, 'geometry' | 'board' | 'quality'>;
  material: Material;
}) {
  const model = useDioramaGeometry(() => createGroundModel(terrain), [terrain]);
  // Turning by whole sixths keeps the hexagon but varies the painted pattern per tile.
  const instances = useMemo(() => tileInstances(props.geometry, props.board).filter((tile) => tile.terrain === terrain)
    .map((tile) => ({ ...tile, rotationY: ((tile.index * 5) % 6) * Math.PI / 3 })),
  [props.geometry, props.board, terrain]);
  return <InstancedPrimitive geometry={model} material={material} instances={instances}
    castShadow={false} />;
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

function Coast({ geometry, material, quality }: Pick<BoardSceneProps, 'geometry' | 'quality'> & { material: Material }) {
  const beach = useDioramaGeometry(() => createBeachModel(geometry), [geometry]);
  const scatter = useDioramaGeometry(() => createShoreScatterModel(geometry), [geometry]);
  return <>
    <mesh geometry={beach} material={material} receiveShadow dispose={null} />
    <mesh geometry={scatter} material={material} receiveShadow castShadow={quality === 'standard'} dispose={null} />
  </>;
}

const SEA_SHALLOW = '#7fd3c6';
const SEA_MID = '#3c9cad';
const SEA_DEEP = '#1d5f7e';
const SEA_FOAM = '#f4fbf4';

function Ocean({ geometry }: Pick<BoardSceneProps, 'geometry'>) {
  const ocean = useMemo(() => {
    const field = createShoreField(geometry);
    const water = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.38, metalness: 0.05 });
    const uniforms = {
      uShore: { value: field.texture },
      uShoreMin: { value: new Vector2(field.min.x, field.min.y) },
      uShoreSize: { value: new Vector2(field.max.x - field.min.x, field.max.y - field.min.y) },
      uShallow: { value: new Color(SEA_SHALLOW) },
      uMid: { value: new Color(SEA_MID) },
      uDeep: { value: new Color(SEA_DEEP) },
      uFoam: { value: new Color(SEA_FOAM) },
    };
    water.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = `varying vec3 vSeaPosition;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSeaPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
      shader.fragmentShader = `varying vec3 vSeaPosition;
        uniform sampler2D uShore;
        uniform vec2 uShoreMin;
        uniform vec2 uShoreSize;
        uniform vec3 uShallow;
        uniform vec3 uMid;
        uniform vec3 uDeep;
        uniform vec3 uFoam;
        ${shader.fragmentShader}`.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 sea = vSeaPosition.xz;
        vec2 shoreUv = clamp((sea - uShoreMin) / uShoreSize, 0.0, 1.0);
        float shore = texture2D(uShore, shoreUv).r * ${SHORE_DISTANCE_RANGE.toFixed(1)};
        float far = length(sea);
        float broad = sin(sea.x * .72 + sin(sea.y * .83)) * sin(sea.y * .64);
        float ripple = sin(sea.x * 17.0 + sin(sea.y * 11.0)) * sin(sea.y * 14.0 + sea.x * 3.0);
        vec3 water = mix(uShallow, uMid, smoothstep(0.02, 0.9, shore + broad * 0.06));
        water = mix(water, uDeep, smoothstep(1.4, 2.9, shore) * 0.7 + smoothstep(6.0, 14.0, far) * 0.3);
        // Surf hugs the sand; a second broken line of foam rolls in behind it.
        float surf = 1.0 - smoothstep(0.0, 0.05 + ripple * 0.008, shore);
        float swell = (1.0 - smoothstep(0.0, 0.035, abs(shore - 0.16 - broad * 0.025))) * smoothstep(0.1, 0.6, ripple * 0.5 + 0.5);
        water = mix(water, uFoam, clamp(surf * 0.85 + swell * 0.35, 0.0, 1.0));
        float glint = pow(max(0.0, ripple), 24.0) * .05 * smoothstep(0.3, 1.5, shore);
        diffuseColor.rgb = water * (0.97 + broad * 0.03) + glint;
        `,
      );
    };
    water.customProgramCacheKey = () => 'katan-ocean-shore';
    return { material: water, texture: field.texture, references: 0 };
  }, [geometry]);
  const plane = useDioramaGeometry(() => new PlaneGeometry(180, 180), []);
  useEffect(() => {
    ocean.references++;
    return () => {
      ocean.references--;
      queueMicrotask(() => {
        if (ocean.references) return;
        ocean.material.dispose();
        ocean.texture.dispose();
      });
    };
  }, [ocean]);
  return <mesh geometry={plane} material={ocean.material} rotation={[-Math.PI / 2, 0, 0]}
    position={[0, SEA_LEVEL, 0]} receiveShadow dispose={null} />;
}

export function DioramaIsland(props: Pick<BoardSceneProps, 'geometry' | 'quality'> & { material: Material }) {
  return <>
    <Ocean geometry={props.geometry} />
    <Coast {...props} />
  </>;
}
