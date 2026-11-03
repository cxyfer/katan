/**
 * Seafarers pieces for the SVG board: player ships, the pirate ship and the
 * island-bonus token. Original hand-written shapes; the ship's silhouette is
 * shared by every colour so colour is never the only cue (the hull carries the
 * seat's dash pattern on its sail stripe).
 */

import type { BoardGeometry, Point } from '../board/geometry.ts';
import { shade } from './SvgBoardArt.tsx';

/** Angle of an edge in degrees, folded so a ship never sails upside down. */
export function edgeAngle(edge: { x1: number; y1: number; x2: number; y2: number }): number {
  let angle = (Math.atan2(edge.y2 - edge.y1, edge.x2 - edge.x1) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

export function edgeMidpoint(edge: { x1: number; y1: number; x2: number; y2: number }): Point {
  return { x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2 };
}

/** A small cog with one square sail, drawn along the edge it occupies. */
export function ShipPiece({ x, y, angle, color, dash, ghost = false, testId }: {
  x: number; y: number; angle: number; color: string; dash?: string; ghost?: boolean; testId?: string;
}) {
  const dark = shade(color, -0.55);
  return <g transform={`translate(${x} ${y}) rotate(${angle})`} data-testid={testId} opacity={ghost ? 0.75 : 1}>
    {!ghost && <ellipse cy="9" rx="27" ry="6" fill="#06222e" opacity=".35" />}
    {/* hull */}
    <path d="M-26 0h52l-8 10h-36Z" fill={color} stroke={dark} strokeWidth="2" strokeLinejoin="round" />
    <path d="M-20 4h40" stroke={shade(color, 0.55)} strokeWidth="1.6" strokeDasharray={dash} opacity=".8" />
    {/* mast and sail */}
    <path d="M0 0v-26" stroke="#3b2a17" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M-12-23q12-4 24 0v14q-12-4-24 0Z" fill="#fff6dd" stroke={dark} strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M-12-16q12-4 24 0" stroke={color} strokeWidth="3" fill="none" />
    <path d="M0-26l9 3-9 3" fill={color} stroke={dark} strokeWidth="1" />
  </g>;
}

/** The pirate: a dark three-masted ship whose silhouette differs from player ships. */
export function PirateShip({ x, y, ghost = false }: { x: number; y: number; ghost?: boolean }) {
  return <g transform={`translate(${x} ${y})`} data-testid={ghost ? undefined : 'pirate'} opacity={ghost ? 0.75 : 1}>
    {!ghost && <ellipse cy="14" rx="34" ry="7" fill="#04161f" opacity=".45" />}
    <path d="M-34 2h68l-10 13h-50Z" fill="#2a2523" stroke="#0b0908" strokeWidth="2" strokeLinejoin="round" />
    <path d="M-28 7h56" stroke="#c9a14a" strokeWidth="1.6" strokeDasharray="3 4" />
    <path d="M-12 2v-30M8 2v-36M24 2v-20" stroke="#21170e" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M-22-25q10-3 20 0v16q-10-3-20 0Z" fill="#3c3634" stroke="#0b0908" strokeWidth="1.4" />
    <path d="M-2-32q10-3 20 0v20q-10-3-20 0Z" fill="#3c3634" stroke="#0b0908" strokeWidth="1.4" />
    <path d="M17-17q7-2 14 0v11q-7-2-14 0Z" fill="#3c3634" stroke="#0b0908" strokeWidth="1.4" />
    {/* skull mark on the main sail */}
    <circle cx="8" cy="-23" r="4.2" fill="#efe6cf" />
    <path d="M4-16l8-4M4-20l8 4" stroke="#efe6cf" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="6.6" cy="-23.6" r="1" fill="#2a2523" /><circle cx="9.4" cy="-23.6" r="1" fill="#2a2523" />
    <path d="M8-36l10 3-10 3" fill="#0b0908" />
  </g>;
}

/** Where the pirate waits while it is on the frame: outside the right edge of the map. */
export function pirateFrameSpot(geometry: BoardGeometry): Point {
  const [x, y, width, height] = geometry.viewBox.split(' ').map(Number) as [number, number, number, number];
  return { x: x + width - 0.32 * geometry.scale, y: y + height / 2 };
}

/** Two stacked victory-point tokens tucked under a settlement (+2 island bonus). */
export function IslandBonusToken({ x, y, color, testId }: { x: number; y: number; color: string; testId?: string }) {
  return <g transform={`translate(${x} ${y})`} data-testid={testId} aria-hidden="true">
    <ellipse cx="0" cy="5" rx="11" ry="4" fill="#5d3a12" />
    <ellipse cx="0" cy="2" rx="11" ry="4" fill="#d9a534" stroke="#6b4512" strokeWidth="1.2" />
    <ellipse cx="0" cy="-1" rx="11" ry="4" fill="#f2c95a" stroke="#6b4512" strokeWidth="1.2" />
    <text x="0" y="1.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#5a3505">+2</text>
    <circle cx="9" cy="-4" r="2.6" fill={color} stroke="#20180f" strokeWidth="1" />
  </g>;
}
