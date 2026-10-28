import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

export type Vec3 = readonly [number, number, number];

export interface InstanceTransform {
  position: Vec3;
  rotationY: number;
  scale: Vec3;
}

export function instanceMatrix(transform: InstanceTransform): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion().setFromEuler(new Euler(0, transform.rotationY, 0, 'YXZ')),
    new Vector3(...transform.scale),
  );
}

/** A +X local road points from topology endpoint a toward endpoint b. */
export function horizontalRotation(dx: number, dz: number): number {
  return -Math.atan2(dz, dx);
}

export function finiteTransform(transform: InstanceTransform): boolean {
  return [...transform.position, ...transform.scale, transform.rotationY].every(Number.isFinite) &&
    transform.scale.every((value) => value > 0);
}

/**
 * Dispose renderer-owned GPU buffers only after a replacement or unmount.
 * The deferred check prevents StrictMode's synchronous release/setup cycle
 * from disposing an object that has been reattached to the same ref.
 */
export function disposeWhenReleased(
  owned: { dispose(): void },
  isReleased: () => boolean,
): void {
  queueMicrotask(() => {
    if (isReleased()) owned.dispose();
  });
}
