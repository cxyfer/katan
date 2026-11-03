import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { Matrix4, Quaternion, Vector3, type BufferGeometry, type Material } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { arrivalPose, type ArrivalOptions } from './arrival.ts';
import { disposeWhenReleased, instanceMatrix, type InstanceTransform } from './transforms.ts';

const Y_AXIS = new Vector3(0, 1, 0);
const DEFAULT_ARRIVAL: ArrivalOptions = { height: 0.13 };

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
  arrival = DEFAULT_ARRIVAL,
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
  arrival?: ArrivalOptions;
}) {
  const meshRef = useRef<import('three').InstancedMesh | null>(null);
  const startRef = useRef(0);
  const scratchPosition = useRef(new Vector3());
  const scratchQuaternion = useRef(new Quaternion());
  const scratchScale = useRef(new Vector3());
  const scratchMatrix = useRef(new Matrix4());
  const scratchSpin = useRef(new Quaternion());
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
    const pose = animationKey && progress < 1 ? arrivalPose(progress, arrival) : null;
    for (let index = 0; index < instances.length; index += 1) {
      const matrix = scratchMatrix.current.copy(baseMatrices[index]!);
      if (pose) {
        const position = scratchPosition.current;
        const quaternion = scratchQuaternion.current;
        const scale = scratchScale.current;
        matrix.decompose(position, quaternion, scale);
        position.y += pose.lift;
        scale.set(scale.x * pose.scaleXZ, scale.y * pose.scaleY, scale.z * pose.scaleXZ);
        if (pose.spin) quaternion.premultiply(scratchSpin.current.setFromAxisAngle(Y_AXIS, pose.spin));
        matrix.compose(position, quaternion, scale);
      }
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };

  const animating = !!animationKey && motionAllowed;
  const progressNow = () => animating && durationMs > 0 ? (performance.now() - startRef.current) / durationMs : 1;

  // 在繪製前寫入起始姿態，避免新棋子先在落點閃現一幀才飛上天。
  useLayoutEffect(() => {
    if (animating) startRef.current = performance.now();
  }, [animationKey, animating]);

  useLayoutEffect(() => {
    write(progressNow());
    invalidate();
  }, [baseMatrices, instances, invalidate, animationKey, animating]);

  useFrame(() => {
    if (!animating) return;
    const progress = progressNow();
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
