import type { PublicPlayerView, PublicBoardView } from '@catan/rules';
import type { BoardGeometry } from './geometry.ts';
import type { BoardIntent } from './intent.ts';
import type { BoardEffectGroup } from './animation.ts';
import type { TargetKind } from './targets.ts';

export type RendererMode = 'auto' | 'svg' | 'r3f';
export type QualityMode = 'standard' | 'low';
export interface CssRect { left: number; top: number; width: number; height: number }
export interface WorldPoint { x: number; y: number; z: number }
export interface SceneBounds {
  min: WorldPoint;
  max: WorldPoint;
  /** Complete model-envelope corners used to avoid fitting empty AABB corners. */
  fitPoints?: readonly WorldPoint[];
}
export interface BoardViewportState {
  center: { x: number; z: number };
  zoom: number;
  /** Camera orbit around the board; omitted callers keep the initial 20° view. */
  azimuthDeg?: number;
  /** User-selected viewing elevation; omitted callers use the responsive default. */
  elevationDeg?: number;
  rect: CssRect;
}
export interface ProjectionSnapshot {
  /** Column-major camera projectionMatrix * matrixWorldInverse. */
  viewProjection: readonly number[];
  /** Orthographic camera zoom used to produce this matrix, independent of pending UI state. */
  cameraZoom?: number;
  rect: CssRect;
  version: number;
  clip: { near: number; far: number };
}
export interface ProjectedAnchor {
  x: number;
  y: number;
  visible: boolean;
}
export interface ProjectedTarget extends ProjectedAnchor {
  kind: TargetKind;
  index: number;
  endpoints?: readonly [ProjectedAnchor, ProjectedAnchor];
}
export interface SceneSelection { kind: TargetKind; index: number; playerId: string }
export interface BoardSceneInput {
  geometry: BoardGeometry;
  board: PublicBoardView;
  players: readonly { id: string; seat: number; color: PublicPlayerView['color'] }[];
  intent: BoardIntent | null;
  selection: SceneSelection | null;
  active: BoardEffectGroup | null;
  viewport: BoardViewportState;
  quality: QualityMode;
  motionAllowed: boolean;
}
export interface BoardSceneProps extends BoardSceneInput {
  onProjection: (projection: ProjectionSnapshot) => void;
  onReady: () => void;
  onUnavailable: (reason: string) => void;
}
export interface BoardEffectAnchors {
  stage: CssRect;
  seats: ReadonlyMap<string, CssRect>;
  aggregate: CssRect | null;
  targets: readonly ProjectedTarget[];
}

export function rendererMode(value: string | null): RendererMode {
  return value === 'svg' || value === 'r3f' ? value : 'auto';
}

export function qualityMode(value: string | null): QualityMode {
  return value === 'low' ? 'low' : 'standard';
}
