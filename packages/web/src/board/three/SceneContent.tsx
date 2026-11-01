import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CanvasTexture,
  DoubleSide,
  ImageLoader,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshBasicMaterial,
  OrthographicCamera,
  SRGBColorSpace,
  Texture,
  type BufferGeometry,
} from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { BoardSceneProps, CssRect, ProjectionSnapshot } from '../render-contract.ts';
import { BOARD_MODEL_METRICS, sceneBounds } from './bounds.ts';
import { applySceneCamera, fitSceneCamera } from './camera.ts';
import { BOARD_ATLAS_URL, HARBOR_ATLAS_CELLS, NUMBER_ATLAS_CELLS, harborAtlasKey } from './atlas.ts';
import {
  legalGhostSelection,
  numberTokens,
  roadInstances,
} from './model-specs.ts';
import { type InstanceTransform } from './transforms.ts';
import { InstancedPrimitive } from './InstancedPrimitive.tsx';
import { DioramaGround, DioramaIsland } from './DioramaIsland.tsx';
import { DioramaTerrain } from './DioramaTerrain.tsx';
import { DioramaBuildings, DioramaRoads, DioramaHarbors } from './DioramaStructures.tsx';
import { createRoadModel, createSettlementModel, harborLabelInstances } from './diorama-structures.ts';
import { useDioramaGeometry } from './diorama-geometry.ts';
import { createRobberModel } from './diorama-robber.ts';
import { TbScenePieces, tbNumberTokens } from './TbScenePieces.tsx';
import { atlasGeometryKey, boardSceneResources, type BoardSceneResources } from './resources.ts';

type SceneProps = Pick<BoardSceneProps,
  'geometry' | 'board' | 'players' | 'intent' | 'selection' | 'active' | 'viewport' | 'quality' | 'modules' |
  'motionAllowed' | 'onProjection' | 'onReady' | 'onUnavailable'>;

function useLeasedResources(): BoardSceneResources {
  const resources = boardSceneResources();
  useEffect(() => {
    resources.acquire();
    return () => resources.release();
  }, [resources]);
  return resources;
}

/** The atlas SVG is 1024px; rasterize it larger so zoomed-in labels stay sharp. */
const ATLAS_RASTER_SIZE = 2048;

function useBoardAtlas(onUnavailable: (reason: string) => void): Texture | null {
  const { gl } = useThree();
  const [texture, setTexture] = useState<Texture | null>(null);
  const failureRef = useRef(onUnavailable);
  failureRef.current = onUnavailable;

  useEffect(() => {
    let active = true;
    let loaded: Texture | null = null;
    const loader = new ImageLoader();
    try {
      loader.load(
        BOARD_ATLAS_URL,
        (image) => {
          if (!active) return;
          const canvas = document.createElement('canvas');
          canvas.width = ATLAS_RASTER_SIZE;
          canvas.height = ATLAS_RASTER_SIZE;
          const context = canvas.getContext('2d');
          if (!context) {
            failureRef.current('texture');
            return;
          }
          context.drawImage(image, 0, 0, ATLAS_RASTER_SIZE, ATLAS_RASTER_SIZE);
          const next = new CanvasTexture(canvas);
          next.colorSpace = SRGBColorSpace;
          next.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
          // Mipmaps keep small, zoomed-out labels from shimmering.
          next.generateMipmaps = true;
          next.minFilter = LinearMipmapLinearFilter;
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
      <ambientLight intensity={0.26} color="#fff3dc" />
      <hemisphereLight args={['#e3f1f4', '#a48a64', 1.2]} />
      {/* A cool rim from behind lifts silhouettes off the warm key light. */}
      <directionalLight position={[6, 5, -8]} intensity={0.55} color="#bcd9ec" />
      <directionalLight
        castShadow={shadows}
        position={[-5, 10, 6]}
        intensity={3.05}
        color="#ffe9c6"
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-bias={-0.00015}
        shadow-normalBias={0.015}
        shadow-radius={3}
      />
    </>
  );
}

function NumberBadges({ props, resources, texture }: { props: SceneProps; resources: BoardSceneResources; texture: Texture | null }) {
  const tokens = useMemo(() => [...numberTokens(props.geometry, props.board), ...tbNumberTokens(props.geometry, props.modules)],
    [props.board, props.geometry, props.modules]);
  const bodies = tokens.map((token) => ({ ...token, scale: [1, 1, 1] as const }));
  const labels = tokens.map((token) => ({
    ...token,
    position: [token.position[0], 0.058, token.position[2]] as const,
    rotationY: (props.viewport.azimuthDeg ?? 20) * Math.PI / 180,
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

function HarborLabels({ props, resources, texture }: { props: SceneProps; resources: BoardSceneResources; texture: Texture | null }) {
  const labels = useMemo(() => harborLabelInstances(props.geometry, props.board), [props.geometry, props.board]);
  return Object.keys(HARBOR_ATLAS_CELLS).map((type) => {
    const cell = HARBOR_ATLAS_CELLS[type]!;
    return <AtlasMesh key={type} texture={texture}
      geometry={resources.geometries.atlas[atlasGeometryKey(cell)]!}
      instances={labels.filter((harbor) => harborAtlasKey(harbor.type) === type).map((label) => ({
        ...label,
        rotationY: label.rotationY + (Math.cos(label.rotationY - (props.viewport.azimuthDeg ?? 20) * Math.PI / 180) < 0 ? Math.PI : 0),
      }))} />;
  });
}

function Robber({ props, resources }: { props: SceneProps; resources: BoardSceneResources }) {
  const model = useDioramaGeometry(createRobberModel, []);
  const hex = props.geometry.hexes[props.board.robber];
  if (!hex) return null;
  const x = hex.cx / props.geometry.scale;
  const z = hex.cy / props.geometry.scale;
  const castShadow = props.quality === 'standard';
  return (
    <mesh position={[x, BOARD_MODEL_METRICS.robberOriginY, z]}
      rotation={[0, (props.viewport.azimuthDeg ?? 20) * Math.PI / 180, 0]}
      geometry={model} material={resources.materials.diorama} castShadow={castShadow} dispose={null} />
  );
}

function BuildingGhost({ city, seat, position, rotationY, material }: {
  city: boolean; seat: number; position: readonly [number, number, number]; rotationY: number; material: import('three').Material;
}) {
  const model = useDioramaGeometry(() => createSettlementModel('#ffffff', city, seat), [city, seat]);
  return <mesh geometry={model} material={material} position={position} rotation={[0, rotationY, 0]} dispose={null} renderOrder={4} />;
}

function RoadGhost({ position, rotationY, length, material }: {
  position: readonly [number, number, number]; rotationY: number; length: number; material: import('three').Material;
}) {
  const model = useDioramaGeometry(() => createRoadModel('#ffffff', 0), []);
  return <mesh geometry={model} material={material} position={position} rotation={[0, rotationY, 0]}
    scale={[Math.max(0.01, length - 0.03), 1, 1]} dispose={null} renderOrder={4} />;
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
    return <BuildingGhost city={city} seat={player?.seat ?? 0} material={material}
      position={[vertex.x / props.geometry.scale, 0.005, vertex.y / props.geometry.scale]}
      rotationY={((vertex.index * 23) % 6) * (Math.PI / 6)} />;
  }
  if (selection.kind === 'edge') {
    const edge = props.geometry.edges[selection.index];
    if (!edge) return null;
    const road = roadInstances(props.geometry, {
      ...props.board,
      roads: props.board.roads.map((item, index) => index === selection.index ? { player: selection.playerId, ship: false } : item),
    }, props.players, null).find((candidate) => candidate.index === selection.index);
    if (!road) return null;
    return <RoadGhost position={road.position} rotationY={road.rotationY} length={road.length} material={material} />;
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
    const fit = fitSceneCamera(bounds, props.viewport.rect, props.viewport.azimuthDeg, props.viewport.elevationDeg);
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
  const lastRef = useRef<{ matrix: number[]; rect: CssRect; cameraZoom: number } | null>(null);
  useLayoutEffect(() => {
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const viewProjection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const matrix = viewProjection.toArray();
    const rect = rectFromCanvas(gl.domElement, props.viewport.rect);
    const cameraZoom = camera instanceof OrthographicCamera ? camera.zoom : 1;
    const previous = lastRef.current;
    if (previous && previous.cameraZoom === cameraZoom && previous.matrix.length === matrix.length && previous.matrix.every((value, index) => Math.abs(value - matrix[index]!) < 1e-10) &&
        previous.rect.left === rect.left && previous.rect.top === rect.top && previous.rect.width === rect.width && previous.rect.height === rect.height) return;
    lastRef.current = { matrix, rect, cameraZoom };
    versionRef.current += 1;
    const snapshot: ProjectionSnapshot = {
      viewProjection: matrix,
      cameraZoom,
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
      <DioramaIsland geometry={props.geometry} quality={props.quality} material={resources.materials.diorama} />
      <DioramaGround geometry={props.geometry} board={props.board} quality={props.quality}
        material={resources.materials.diorama} wall={resources.geometries.tileWall} wallMaterial={resources.materials.tileSide} />
      <DioramaTerrain geometry={props.geometry} board={props.board} quality={props.quality} material={resources.materials.diorama} />
      <NumberBadges props={props} resources={resources} texture={texture} />
      <DioramaHarbors geometry={props.geometry} board={props.board} quality={props.quality} material={resources.materials.diorama} />
      <HarborLabels props={props} resources={resources} texture={texture} />
      <DioramaRoads {...props} material={resources.materials.diorama} />
      <DioramaBuildings {...props} material={resources.materials.diorama} />
      <TbScenePieces geometry={props.geometry} board={props.board} players={props.players} modules={props.modules}
        quality={props.quality} material={resources.materials.diorama} />
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
