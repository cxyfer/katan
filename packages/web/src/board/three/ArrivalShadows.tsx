import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { DataTexture, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { arrivalShadow, type ArrivalOptions } from './arrival.ts';
import { disposeWhenReleased } from './transforms.ts';

/** 落點陰影的位置、朝向與底面輪廓（世界單位，X 為棋子本地長軸）。 */
export interface ShadowFootprint {
  position: readonly [number, number, number];
  rotationY: number;
  size: readonly [number, number];
}

const SHADOW_Y = 0.012;
const BLOB_SIZE = 32;
const UP = new Vector3(0, 1, 0);

/** 邊緣柔化的橢圓陰影貼圖；以 DataTexture 產生，不依賴 Canvas。 */
function createBlobTexture() {
  const data = new Uint8Array(BLOB_SIZE * BLOB_SIZE * 4);
  for (let y = 0; y < BLOB_SIZE; y += 1) {
    for (let x = 0; x < BLOB_SIZE; x += 1) {
      const dx = (x + 0.5) / BLOB_SIZE * 2 - 1;
      const dy = (y + 0.5) / BLOB_SIZE * 2 - 1;
      const edge = Math.max(0, Math.min(1, (1 - Math.hypot(dx, dy)) / 0.6));
      const offset = (y * BLOB_SIZE + x) * 4;
      data.set([255, 255, 255, Math.round(255 * edge * edge * (3 - 2 * edge))], offset);
    }
  }
  const texture = new DataTexture(data, BLOB_SIZE, BLOB_SIZE);
  texture.needsUpdate = true;
  return texture;
}

export function ArrivalShadows({
  footprints, animationKey, durationMs, arrival, motionAllowed,
}: {
  footprints: readonly ShadowFootprint[];
  animationKey: string;
  durationMs: number;
  arrival: ArrivalOptions;
  motionAllowed: boolean;
}) {
  const meshRef = useRef<import('three').InstancedMesh | null>(null);
  const startRef = useRef(0);
  const { invalidate } = useThree();
  const geometry = useMemo(() => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const texture = useMemo(createBlobTexture, []);
  const material = useMemo(() => new MeshBasicMaterial({
    color: '#1d1408', map: texture, transparent: true, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, opacity: 0,
  }), [texture]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); texture.dispose(); }, [geometry, material, texture]);
  const scratch = useRef({ matrix: new Matrix4(), position: new Vector3(), rotation: new Quaternion(), scale: new Vector3() });
  const assignMesh = useCallback((mesh: import('three').InstancedMesh | null) => {
    const previous = meshRef.current;
    if (mesh === previous) return;
    meshRef.current = mesh;
    if (previous) disposeWhenReleased(previous, () => meshRef.current !== previous);
  }, []);

  const write = (progress: number) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { scale, opacity } = arrivalShadow(progress, arrival);
    material.opacity = opacity;
    mesh.visible = opacity > 0.001;
    const { matrix, position, rotation, scale: size } = scratch.current;
    footprints.forEach((footprint, index) => {
      position.set(footprint.position[0], footprint.position[1] + SHADOW_Y, footprint.position[2]);
      rotation.setFromAxisAngle(UP, footprint.rotationY);
      size.set(footprint.size[0] * scale, 1, footprint.size[1] * scale);
      mesh.setMatrixAt(index, matrix.compose(position, rotation, size));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };
  const progressNow = () => motionAllowed && durationMs > 0 ? (performance.now() - startRef.current) / durationMs : 1;

  // 與棋子同在繪製前起算，第一幀即呈現高空時的淡小陰影。
  useLayoutEffect(() => {
    startRef.current = performance.now();
  }, [animationKey]);

  useLayoutEffect(() => {
    write(progressNow());
    invalidate();
  }, [footprints, animationKey, motionAllowed, invalidate]);

  useFrame(() => {
    if (!motionAllowed) return;
    const progress = progressNow();
    write(progress);
    if (progress < 1) invalidate();
  });

  if (footprints.length === 0) return null;
  return <instancedMesh ref={assignMesh} args={[geometry, material, footprints.length]} renderOrder={1}
    castShadow={false} receiveShadow={false} dispose={null} />;
}
