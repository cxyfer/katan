import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DoubleSide,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  OrthographicCamera,
  Quaternion,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { BoardSceneProps, CssRect, ProjectionSnapshot } from '../render-contract.ts';
import { BOARD_MODEL_METRICS, sceneBounds } from './bounds.ts';
import { applySceneCamera, fitSceneCamera } from './camera.ts';
import { BOARD_ATLAS_URL, HARBOR_ATLAS_CELLS, NUMBER_ATLAS_CELLS, harborAtlasKey } from './atlas.ts';
import {
  buildingParts,
  harborInstances,
  legalGhostSelection,
  numberTokens,
  roadInstances,
  terrainPieces,
  tileInstances,
} from './model-specs.ts';
import { disposeWhenReleased, instanceMatrix, type InstanceTransform } from './transforms.ts';
import { atlasGeometryKey, boardSceneResources, type BoardSceneResources } from './resources.ts';

type SceneProps = Pick<BoardSceneProps,
  'geometry' | 'board' | 'players' | 'intent' | 'selection' | 'active' | 'viewport' | 'quality' |
  'motionAllowed' | 'onProjection' | 'onReady' | 'onUnavailable'>;

function useLeasedResources(): BoardSceneResources {
  const resources = boardSceneResources();
  useEffect(() => {
    resources.acquire();
    return () => resources.release();
  }, [resources]);
  return resources;
}

function useBoardAtlas(onUnavailable: (reason: string) => void): Texture | null {
  const { gl } = useThree();
  const [texture, setTexture] = useState<Texture | null>(null);
  const failureRef = useRef(onUnavailable);
  failureRef.current = onUnavailable;

  useEffect(() => {
    let active = true;
    let loaded: Texture | null = null;
    const loader = new TextureLoader();
    try {
      loader.load(
        BOARD_ATLAS_URL,
        (next) => {
          if (!active) {
            next.dispose();
            return;
          }
          next.colorSpace = SRGBColorSpace;
          next.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy());
          next.generateMipmaps = false;
          next.minFilter = LinearFilter;
          next.magFilter = LinearFilter;
          loaded = next;
          setTexture(next);
        },
        undefined,
        () => failureRef.current('texture'),
      );
    } catch {
      failureRef.current('texture');
    }
    return () => {
      active = false;
      loaded?.dispose();
      loaded = null;
    };
  }, [gl]);
  return texture;
}

function groupBy<T, K>(values: readonly T[], keyOf: (value: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = grouped.get(key);
    if (group) group.push(value);
    else grouped.set(key, [value]);
  }
  return grouped;
}

function InstancedPrimitive({
  geometry,
  material,
  instances,
  castShadow = true,
  receiveShadow = true,
  renderOrder = 0,
  animationKey = null,
  durationMs = 0,
  motionAllowed = true,
}: {
  geometry: BufferGeometry;
  material: Material | Material[];
  instances: readonly InstanceTransform[];
  castShadow?: boolean;
  receiveShadow?: boolean;
  renderOrder?: number;
  animationKey?: string | null;
  durationMs?: number;
  motionAllowed?: boolean;
}) {
  const meshRef = useRef<import('three').InstancedMesh | null>(null);
  const startRef = useRef(0);
  const scratchPosition = useRef(new Vector3());
  const scratchQuaternion = useRef(new Quaternion());
  const scratchScale = useRef(new Vector3());
  const scratchMatrix = useRef(new Matrix4());
  const { invalidate } = useThree();
  const baseMatrices = useMemo(() => instances.map(instanceMatrix), [instances]);
  const assignMesh = useCallback((mesh: import('three').InstancedMesh | null) => {
    const previous = meshRef.current;
    if (mesh === previous) return;
    meshRef.current = mesh;
    if (previous) disposeWhenReleased(previous, () => meshRef.current !== previous);
  }, []);

  const write = (progress: number) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const eased = 1 - Math.pow(1 - Math.max(0, Math.min(1, progress)), 3);
    for (let index = 0; index < instances.length; index += 1) {
      const matrix = scratchMatrix.current.copy(baseMatrices[index]!);
      if (animationKey && progress < 1) {
        const position = scratchPosition.current;
        const quaternion = scratchQuaternion.current;
        const scale = scratchScale.current;
        matrix.decompose(position, quaternion, scale);
        position.y += (1 - eased) * 0.13;
        scale.y *= 0.82 + eased * 0.18;
        matrix.compose(position, quaternion, scale);
      }
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };

  useLayoutEffect(() => {
    write(1);
    invalidate();
  }, [baseMatrices, instances, invalidate]);

  useEffect(() => {
    if (!animationKey || !motionAllowed) {
      write(1);
      invalidate();
      return;
    }
    startRef.current = performance.now();
    invalidate();
  }, [animationKey, invalidate, motionAllowed]);

  useFrame(() => {
    if (!animationKey || !motionAllowed) return;
    const progress = durationMs > 0 ? (performance.now() - startRef.current) / durationMs : 1;
    write(progress);
    if (progress < 1) invalidate();
  });

  if (instances.length === 0) return null;
  return (
    <instancedMesh
      ref={assignMesh}
      args={[geometry, material, instances.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      renderOrder={renderOrder}
      dispose={null}
    />
  );
}

function AtlasMesh({
  texture,
  geometry,
  instances,
  animationKey,
  motionAllowed,
}: {
  texture: Texture | null;
  geometry: BufferGeometry;
  instances: readonly InstanceTransform[];
  animationKey?: string | null;
  motionAllowed?: boolean;
}) {
  if (!texture || instances.length === 0) return null;
  return <InstancedMaterialAtlas texture={texture} geometry={geometry} instances={instances}
    animationKey={animationKey ?? null} motionAllowed={motionAllowed ?? true} />;
}

function InstancedMaterialAtlas({
  texture,
  geometry,
  instances,
  animationKey,
  motionAllowed,
}: {
  texture: Texture;
  geometry: BufferGeometry;
  instances: readonly InstanceTransform[];
  animationKey: string | null;
  motionAllowed: boolean;
}) {
  const material = useMemo(() => new MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.02,
    side: DoubleSide,
    toneMapped: false,
    depthWrite: false,
  }), [texture]);
  useEffect(() => () => material.dispose(), [material]);
  return <InstancedPrimitive geometry={geometry} material={material} instances={instances}
    castShadow={false} receiveShadow={false} animationKey={animationKey} motionAllowed={motionAllowed} />;
}

function Lights({ quality }: { quality: 'standard' | 'low' }) {
  const shadows = quality === 'standard';
  return (
    <>
      <ambientLight intensity={0.72} color="#fff3d4" />
      <hemisphereLight args={['#e9f4ff', '#725132', 0.62]} />
      <directionalLight
        castShadow={shadows}
        position={[-7, 12, 6]}
        intensity={2.1}
        color="#fff1cf"
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-bias={-0.0004}
      />
    </>
  );
}

function Tiles({ props, resources }: { props: SceneProps; resources: BoardSceneResources }) {
  const instances = useMemo(() => tileInstances(props.geometry, props.board), [props.board, props.geometry]);
  const byTerrain = useMemo(() => groupBy(instances, (instance) => instance.terrain), [instances]);
  return (
    <>
      <InstancedPrimitive
        geometry={resources.geometries.tileWall}
        material={resources.materials.tileSide}
        instances={instances}
        castShadow={props.quality === 'standard'}
      />
      {[...byTerrain.entries()].map(([terrain, tiles]) => (
        <InstancedPrimitive
          key={terrain}
          geometry={resources.geometries.tileCap}
          material={resources.materials.tileTop[terrain] ?? resources.materials.tileSide}
          instances={tiles}
          castShadow={props.quality === 'standard'}
        />
      ))}
    </>
  );
}

function Terrains({ props, resources }: { props: SceneProps; resources: BoardSceneResources }) {
  const pieces = useMemo(() => terrainPieces(props.geometry, props.board), [props.board, props.geometry]);
  const grouped = useMemo(() => groupBy(pieces, (piece) => piece.kind), [pieces]);
  const geometryFor = {
    trunk: resources.geometries.treeTrunk,
    canopy: resources.geometries.treeCanopy,
    mountain: resources.geometries.mountain,
    mound: resources.geometries.mound,
    field: resources.geometries.field,
    sheep: resources.geometries.sheep,
    wave: resources.geometries.wave,
  };
  const materialFor = {
    trunk: resources.materials.forestTrunk,
    canopy: resources.materials.forestCanopy,
    mountain: resources.materials.mountain,
    mound: resources.materials.dirt,
    field: resources.materials.field,
    sheep: resources.materials.sheep,
    wave: resources.materials.wave,
  };
  return [...grouped.entries()].map(([kind, items]) => (
    <InstancedPrimitive
      key={kind}
      geometry={geometryFor[kind]}
      material={materialFor[kind]}
      instances={items}
      castShadow={props.quality === 'standard'}
    />
  ));
}

function NumberBadges({ props, resources, texture }: { props: SceneProps; resources: BoardSceneResources; texture: Texture | null }) {
  const tokens = useMemo(() => numberTokens(props.geometry, props.board), [props.board, props.geometry]);
  const bodies = tokens.map((token) => ({ ...token, scale: [1, 1, 1] as const }));
  const labels = tokens.map((token) => ({
    ...token,
    position: [token.position[0], 0.058, token.position[2]] as const,
  }));
  return (
    <>
      <InstancedPrimitive geometry={resources.geometries.token} material={resources.materials.token}
        instances={bodies} castShadow={props.quality === 'standard'} />
      {Object.entries(NUMBER_ATLAS_CELLS).map(([value, cell]) => (
        <AtlasMesh
          key={value}
          texture={texture}
          geometry={resources.geometries.atlas[atlasGeometryKey(cell)]!}
          instances={labels.filter((token) => token.value === Number(value))}
        />
      ))}
    </>
  );
}

function Harbors({ props, resources, texture }: { props: SceneProps; resources: BoardSceneResources; texture: Texture | null }) {
  const harbors = useMemo(() => harborInstances(props.geometry, props.board), [props.board, props.geometry]);
  const bodies = harbors.map((harbor) => ({
    position: [harbor.position[0], 0.018, harbor.position[2]] as const,
    rotationY: harbor.rotationY,
    scale: [0.56, 0.055, 0.24] as const,
  }));
  return (
    <>
      <InstancedPrimitive geometry={resources.geometries.box} material={resources.materials.harbor}
        instances={bodies} castShadow={props.quality === 'standard'} />
      {Object.keys(HARBOR_ATLAS_CELLS).map((type) => {
        const cell = HARBOR_ATLAS_CELLS[type]!;
        return <AtlasMesh key={type} texture={texture}
          geometry={resources.geometries.atlas[atlasGeometryKey(cell)]!}
          instances={harbors.filter((harbor) => harborAtlasKey(harbor.type) === type).map((harbor) => ({
            position: [harbor.position[0], 0.049, harbor.position[2]] as const,
            rotationY: harbor.rotationY,
            scale: [0.52, 1, 0.22] as const,
          }))} />;
      })}
    </>
  );
}

function offsetAlongRoad(position: readonly [number, number, number], rotationY: number, amount: number): readonly [number, number, number] {
  return [
    position[0] + Math.cos(rotationY) * amount,
    position[1] + 0.03,
    position[2] - Math.sin(rotationY) * amount,
  ];
}

function Roads({ props, resources }: { props: SceneProps; resources: BoardSceneResources }) {
  const roads = useMemo(() => roadInstances(props.geometry, props.board, props.players, props.active),
    [props.active, props.board, props.geometry, props.players]);
  const grouped = useMemo(() => groupBy(roads, (road) => `${road.playerId}:${road.arriving ? 'arriving' : 'steady'}`), [roads]);
  const markers = roads.flatMap((road) => {
    const count = 1 + road.seat % 6;
    return Array.from({ length: count }, (_, index) => ({
      position: offsetAlongRoad(road.position, road.rotationY,
        count === 1 ? 0 : -road.length * 0.24 + index * (road.length * 0.48 / (count - 1))),
      rotationY: road.rotationY,
      scale: [0.045, 0.012, 0.055] as const,
    }));
  });
  return (
    <>
      {[...grouped.values()].map((items) => {
        const first = items[0]!;
        const player = props.players.find((candidate) => candidate.id === first.playerId);
        return <InstancedPrimitive key={`${first.playerId}:${first.arriving}`}
          geometry={resources.geometries.box}
          material={resources.materials.player[player?.color ?? 'white'] ?? resources.materials.player.white!}
          instances={items}
          castShadow={props.quality === 'standard'}
          animationKey={first.arriving ? props.active?.id ?? null : null}
          durationMs={first.durationMs}
          motionAllowed={props.motionAllowed} />;
      })}
      <InstancedPrimitive geometry={resources.geometries.box} material={resources.materials.trim}
        instances={markers} castShadow={false} />
    </>
  );
}

function Buildings({ props, resources }: { props: SceneProps; resources: BoardSceneResources }) {
  const parts = useMemo(() => buildingParts(props.geometry, props.board, props.players, props.active),
    [props.active, props.board, props.geometry, props.players]);
  const grouped = useMemo(() => groupBy(parts, (part) =>
    `${part.playerId}:${part.material}:${part.part === 'roof' ? 'roof' : 'box'}:${part.arriving ? 'arriving' : 'steady'}`), [parts]);
  return [...grouped.values()].map((items) => {
    const first = items[0]!;
    const player = props.players.find((candidate) => candidate.id === first.playerId);
    const material = first.material === 'roof' ? resources.materials.roof
      : first.material === 'trim' ? resources.materials.trim
        : resources.materials.player[player?.color ?? 'white'] ?? resources.materials.player.white!;
    return <InstancedPrimitive key={`${first.playerId}:${first.material}:${first.part}:${first.arriving}`}
      geometry={first.part === 'roof' ? resources.geometries.roof : resources.geometries.box}
      material={material}
      instances={items}
      castShadow={props.quality === 'standard'}
      animationKey={first.arriving ? props.active?.id ?? null : null}
      durationMs={first.durationMs}
      motionAllowed={props.motionAllowed} />;
  });
}

function Robber({ props, resources }: { props: SceneProps; resources: BoardSceneResources }) {
  const hex = props.geometry.hexes[props.board.robber];
  if (!hex) return null;
  const x = hex.cx / props.geometry.scale;
  const z = hex.cy / props.geometry.scale - 0.08;
  const castShadow = props.quality === 'standard';
  return (
    <group position={[x, BOARD_MODEL_METRICS.robberOriginY, z]} rotation={[0, Math.PI / 7, 0]} dispose={null}>
      <mesh geometry={resources.geometries.robberCloak} material={resources.materials.robber} castShadow={castShadow} dispose={null} />
      <mesh geometry={resources.geometries.robberHead} material={resources.materials.robber} castShadow={castShadow} dispose={null} />
      <mesh geometry={resources.geometries.robberHood} material={resources.materials.robber} castShadow={castShadow} dispose={null} />
      <mesh position={[0, 0.39, -0.091]} material={resources.materials.robberFace} dispose={null}>
        <sphereGeometry args={[0.045, 6, 4]} />
      </mesh>
    </group>
  );
}

function SelectionGhost({ props, resources }: { props: SceneProps; resources: BoardSceneResources }) {
  const selection = legalGhostSelection(props.intent, props.selection);
  if (!selection || !props.intent) return null;
  const player = props.players.find((candidate) => candidate.id === selection.playerId);
  const material = resources.materials.ghost[player?.color ?? 'white'] ?? resources.materials.ghost.white!;
  if (selection.kind === 'vertex') {
    const vertex = props.geometry.vertices[selection.index];
    if (!vertex) return null;
    const city = props.intent.commandType === 'build.city';
    return (
      <group position={[vertex.x / props.geometry.scale, 0, vertex.y / props.geometry.scale]} dispose={null}>
        <mesh geometry={resources.geometries.box}
          position={[0, city ? 0.125 : 0.12, 0]}
          scale={city ? [0.3, 0.25, 0.22] : [0.2, 0.24, 0.17]}
          material={material} dispose={null} renderOrder={4} />
        <mesh geometry={resources.geometries.roof} position={[0, city ? 0.25 : 0.24, 0]}
          scale={city ? [0.34, 0.14, 0.24] : [0.23, 0.12, 0.19]}
          material={resources.materials.ghostRoof} dispose={null} renderOrder={4} />
        {city && <mesh geometry={resources.geometries.box} position={[0.11, 0.12, 0]}
          scale={[0.13, 0.28, 0.14]} material={material} dispose={null} renderOrder={4} />}
        {city && <mesh geometry={resources.geometries.roof} position={[0.11, 0.26, 0]}
          scale={[0.17, 0.11, 0.18]} material={resources.materials.ghostRoof}
          dispose={null} renderOrder={4} />}
      </group>
    );
  }
  if (selection.kind === 'edge') {
    const edge = props.geometry.edges[selection.index];
    if (!edge) return null;
    const road = roadInstances(props.geometry, {
      ...props.board,
      roads: props.board.roads.map((item, index) => index === selection.index ? { player: selection.playerId, ship: false } : item),
    }, props.players, null).find((candidate) => candidate.index === selection.index);
    if (!road) return null;
    return <mesh geometry={resources.geometries.box} position={road.position} rotation={[0, road.rotationY, 0]}
      scale={[road.length, 0.052, 0.1]} material={material} dispose={null} renderOrder={4} />;
  }
  const hex = props.geometry.hexes[selection.index];
  if (!hex) return null;
  return (
    <group position={[hex.cx / props.geometry.scale, 0.025, hex.cy / props.geometry.scale]} dispose={null}>
      <mesh geometry={resources.geometries.tileCap} scale={[0.8, 0.8, 0.8]}
        material={material} dispose={null} renderOrder={4} />
      <mesh geometry={resources.geometries.tileWall} scale={[0.8, 0.8, 0.8]}
        material={material} dispose={null} renderOrder={4} />
    </group>
  );
}

function CameraRig({ props }: { props: SceneProps }) {
  const { camera, invalidate } = useThree();
  const bounds = useMemo(() => sceneBounds(props.geometry, props.board), [props.board, props.geometry]);
  useLayoutEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return;
    if (![props.viewport.rect.width, props.viewport.rect.height].every(Number.isFinite) ||
        props.viewport.rect.width <= 0 || props.viewport.rect.height <= 0) return;
    const fit = fitSceneCamera(bounds, props.viewport.rect);
    applySceneCamera(camera, fit, props.viewport);
    invalidate();
  }, [bounds, camera, invalidate, props.viewport]);
  return null;
}

function rectFromCanvas(canvas: HTMLCanvasElement, fallback: CssRect): CssRect {
  const rect = canvas.getBoundingClientRect();
  if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
    return fallback;
  }
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function ProjectionBridge({ props }: { props: SceneProps }) {
  const { camera, gl, invalidate } = useThree();
  const versionRef = useRef(0);
  const lastRef = useRef<{ matrix: number[]; rect: CssRect } | null>(null);
  useLayoutEffect(() => {
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const viewProjection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const matrix = viewProjection.toArray();
    const rect = rectFromCanvas(gl.domElement, props.viewport.rect);
    const previous = lastRef.current;
    if (previous && previous.matrix.length === matrix.length && previous.matrix.every((value, index) => Math.abs(value - matrix[index]!) < 1e-10) &&
        previous.rect.left === rect.left && previous.rect.top === rect.top && previous.rect.width === rect.width && previous.rect.height === rect.height) return;
    lastRef.current = { matrix, rect };
    versionRef.current += 1;
    const snapshot: ProjectionSnapshot = {
      viewProjection: matrix,
      rect,
      version: versionRef.current,
      // Projection helper clips normalized device coordinates.
      clip: { near: -1, far: 1 },
    };
    props.onProjection(snapshot);
  }, [camera, gl, props]);

  useEffect(() => {
    const canvas = gl.domElement;
    const onResize = () => invalidate();
    globalThis.addEventListener('resize', onResize);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    observer?.observe(canvas);
    return () => {
      globalThis.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, [gl, invalidate]);
  return null;
}

function RendererSignals({ onUnavailable }: { onUnavailable: (reason: string) => void }) {
  const { gl } = useThree();
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;
  useEffect(() => {
    const canvas = gl.domElement;
    const onContextLost = (event: Event) => {
      event.preventDefault();
      unavailableRef.current('webgl-context-lost');
    };
    canvas.addEventListener('webglcontextlost', onContextLost, false);
    const previousShaderError = gl.debug.onShaderError;
    gl.debug.checkShaderErrors = true;
    gl.debug.onShaderError = (...args) => {
      previousShaderError?.(...args);
      unavailableRef.current('shader');
    };
    return () => {
      canvas.removeEventListener('webglcontextlost', onContextLost, false);
      gl.debug.onShaderError = previousShaderError;
    };
  }, [gl]);
  return null;
}

function ReadyBridge({ ready, onReady }: { ready: boolean; onReady: () => void }) {
  const { gl, invalidate } = useThree();
  const announcedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  useFrame(() => {
    if (!ready || announcedRef.current) return;
    if (gl.info.render.frame <= 0) {
      invalidate();
      return;
    }
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (announcedRef.current) return;
      announcedRef.current = true;
      onReady();
    });
  });
  useEffect(() => {
    invalidate();
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [invalidate, ready]);
  return null;
}

function AtlasLayerContent({ props }: { props: SceneProps }) {
  const resources = useLeasedResources();
  const texture = useBoardAtlas(props.onUnavailable);
  return (
    <>
      <Lights quality={props.quality} />
      <CameraRig props={props} />
      <ProjectionBridge props={props} />
      <RendererSignals onUnavailable={props.onUnavailable} />
      <Tiles props={props} resources={resources} />
      <Terrains props={props} resources={resources} />
      <NumberBadges props={props} resources={resources} texture={texture} />
      <Harbors props={props} resources={resources} texture={texture} />
      <Roads props={props} resources={resources} />
      <Buildings props={props} resources={resources} />
      <Robber props={props} resources={resources} />
      <SelectionGhost props={props} resources={resources} />
      <ReadyBridge ready={texture !== null && props.viewport.rect.width > 0 && props.viewport.rect.height > 0}
        onReady={props.onReady} />
    </>
  );
}

export function SceneContent(props: SceneProps) {
  return <AtlasLayerContent props={props} />;
}
