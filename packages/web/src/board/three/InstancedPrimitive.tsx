import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Matrix4, Quaternion, Vector3, type BufferGeometry, type Material } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { disposeWhenReleased, instanceMatrix, type InstanceTransform } from './transforms.ts';

export function InstancedPrimitive({
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
