import type { Point } from './geometry.ts';

export interface ViewBox { x: number; y: number; width: number; height: number }
export interface ViewportRect { left: number; top: number; width: number; height: number }

export function parseViewBox(value: string): ViewBox {
  const [x, y, width, height] = value.trim().split(/[\s,]+/).map(Number);
  return { x: x!, y: y!, width: width!, height: height! };
}

/** 等價於 SVG viewBox 矩陣加上棋盤的 pan／zoom；screen 座標使用 CSS px。 */
export function boardViewport({
  viewBox, rect, zoom = 1, pan = { x: 0, y: 0 }, preserveAspectRatio = 'xMidYMid meet',
}: {
  viewBox: ViewBox;
  rect: ViewportRect;
  zoom?: number;
  pan?: Point;
  preserveAspectRatio?: string;
}) {
  if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0 || zoom <= 0) return null;
  let scaleX = rect.width / viewBox.width;
  let scaleY = rect.height / viewBox.height;
  let offsetX = 0;
  let offsetY = 0;
  if (preserveAspectRatio !== 'none') {
    const scale = preserveAspectRatio.includes('slice') ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    scaleX = scaleY = scale;
    const alignX = preserveAspectRatio.includes('xMin') ? 0 : preserveAspectRatio.includes('xMax') ? 1 : .5;
    const alignY = preserveAspectRatio.includes('YMin') ? 0 : preserveAspectRatio.includes('YMax') ? 1 : .5;
    offsetX = (rect.width - viewBox.width * scale) * alignX;
    offsetY = (rect.height - viewBox.height * scale) * alignY;
  }
  const center = { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 };
  const originX = rect.left + offsetX + (center.x + pan.x - zoom * center.x - viewBox.x) * scaleX;
  const originY = rect.top + offsetY + (center.y + pan.y - zoom * center.y - viewBox.y) * scaleY;
  return {
    worldToScreen: (point: Point): Point => ({ x: originX + point.x * scaleX * zoom, y: originY + point.y * scaleY * zoom }),
    screenToWorld: (point: Point): Point => ({ x: (point.x - originX) / (scaleX * zoom), y: (point.y - originY) / (scaleY * zoom) }),
    screenDeltaToPan: (delta: Point): Point => ({ x: delta.x / scaleX, y: delta.y / scaleY }),
  };
}
