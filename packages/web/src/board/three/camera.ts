import type { OrthographicCamera } from 'three';
import { fitOrthographicCamera, type OrthographicCameraFit } from '../camera-fit.ts';
import type { BoardViewportState, CssRect, SceneBounds } from '../render-contract.ts';

export const CAMERA_ASPECT_BREAKPOINT = 720;
export const DESKTOP_ELEVATION_DEG = 50;
export const NARROW_ELEVATION_DEG = 60;
export const CAMERA_AZIMUTH_DEG = 20;

export function cameraElevation(rect: Pick<CssRect, 'width' | 'height'>): number {
  const aspect = rect.height > 0 ? rect.width / rect.height : 1;
  return rect.width < CAMERA_ASPECT_BREAKPOINT || aspect < 0.85
    ? NARROW_ELEVATION_DEG
    : DESKTOP_ELEVATION_DEG;
}

export function fitSceneCamera(bounds: SceneBounds, rect: CssRect, azimuthDeg = CAMERA_AZIMUTH_DEG): OrthographicCameraFit {
  return fitOrthographicCamera(bounds, rect, {
    elevationDeg: cameraElevation(rect),
    azimuthDeg,
    margin: 0.08,
  });
}

/** Shift the fitted camera to the user's viewport center while preserving fit. */
export function applySceneCamera(
  camera: OrthographicCamera,
  fit: OrthographicCameraFit,
  viewport: BoardViewportState,
): void {
  const centerX = viewport.center.x;
  const centerZ = viewport.center.z;
  const offsetX = centerX - fit.target.x;
  const offsetZ = centerZ - fit.target.z;
  camera.position.set(
    fit.position.x + offsetX,
    fit.position.y,
    fit.position.z + offsetZ,
  );
  camera.up.set(...fit.up);
  camera.left = fit.frustum.left;
  camera.right = fit.frustum.right;
  camera.top = fit.frustum.top;
  camera.bottom = fit.frustum.bottom;
  camera.near = fit.frustum.near;
  camera.far = fit.frustum.far;
  camera.zoom = Math.max(0.7, Math.min(3, viewport.zoom));
  camera.lookAt(centerX, fit.target.y, centerZ);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}
