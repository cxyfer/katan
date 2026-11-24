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

/** Two stacked victory-point tokens tucked under a settlement (the island bonus, +2 in New Shores, +1 in New World). */
export function IslandBonusToken({ x, y, color, testId, points = 2 }: { x: number; y: number; color: string; testId?: string; points?: number }) {
  return <g transform={`translate(${x} ${y})`} data-testid={testId} aria-hidden="true">
    <ellipse cx="0" cy="5" rx="11" ry="4" fill="#5d3a12" />
    <ellipse cx="0" cy="2" rx="11" ry="4" fill="#d9a534" stroke="#6b4512" strokeWidth="1.2" />
    <ellipse cx="0" cy="-1" rx="11" ry="4" fill="#f2c95a" stroke="#6b4512" strokeWidth="1.2" />
    <text x="0" y="1.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#5a3505">{`+${points}`}</text>
    <circle cx="9" cy="-4" r="2.6" fill={color} stroke="#20180f" strokeWidth="1" />
  </g>;
}

/**
 * 世外部落的禮物：邊上的 VP 標記（金幣 +1）、面朝下的發展牌（牌背）、面朝上的港口
 * （比率與資源色）。標記畫在邊中點，略往框的方向推出，不蓋住陸地格上的圖示。
 */
export function GiftMarker({ x, y, kind, harbor, color, ratio, letter, testId }: {
  x: number; y: number; kind: 'vp' | 'devcard' | 'port'; harbor?: string; color?: string; ratio?: string; letter?: string; testId?: string;
}) {
  return <g transform={`translate(${x} ${y}) scale(1.35)`} data-testid={testId} data-gift-kind={kind} data-gift-harbor={harbor} pointerEvents="none">
    {kind === 'vp' && <>
      <ellipse cx="0" cy="3" rx="12" ry="4.5" fill="#5d3a12" opacity=".7" />
      <ellipse cx="0" cy="0" rx="12" ry="4.5" fill="#f2c95a" stroke="#6b4512" strokeWidth="1.3" />
      <text x="0" y="3" textAnchor="middle" fontSize="9" fontWeight="800" fill="#5a3505">+1</text>
    </>}
    {kind === 'devcard' && <>
      <rect x="-9" y="-12" width="18" height="24" rx="2.5" fill="#2e5b8c" stroke="#0e2a47" strokeWidth="1.4" />
      <rect x="-6" y="-9" width="12" height="18" rx="1.5" fill="none" stroke="#9dc3ea" strokeWidth="1" />
      <text x="0" y="4" textAnchor="middle" fontSize="12" fontWeight="800" fill="#d8ebff">?</text>
    </>}
    {kind === 'port' && <>
      <ellipse cx="0" cy="3" rx="14" ry="13" fill="#0f2a2c" opacity=".3" />
      <circle cx="0" cy="0" r="13" fill="#f8f0d8" stroke={color ?? '#2f6d84'} strokeWidth="2.6" strokeDasharray="5 2" />
      <text x="0" y="-1" textAnchor="middle" fontSize="8" fontWeight="800" fill="#20180f">{ratio}</text>
      {letter && <text x="0" y="8" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#20180f">{letter}</text>}
    </>}
  </g>;
}

/**
 * 布匹產地的部落（village）圓片：頂點上的數字圓片加一小疊布匹與已建立關係的玩家色點。
 * `up` 為真時布匹疊在圓片上方（部落在小島的上頂點），否則在下方；布匹數同時寫成文字，
 * 色點與標題文字讓顏色之外還有名字可讀。
 */
export function TribeMarker({ x, y, number, cloth, up, linked, label, testId }: {
  x: number; y: number; number: number; cloth: number; up: boolean;
  linked: { id: string; color: string; name: string }[]; label: string; testId?: string;
}) {
  const side = up ? -1 : 1;
  const hot = number === 6 || number === 8;
  const bolts = Math.min(cloth, 5);
  const width = 9;
  const start = -((bolts - 1) * width) / 2;
  return <g transform={`translate(${x} ${y})`} data-testid={testId} data-tribe-number={number} data-tribe-cloth={cloth}
    data-tribe-linked={linked.map((entry) => entry.name).join(',')} pointerEvents="none">
    <title>{label}</title>
    <ellipse cy="3" rx="19" ry="16" fill="#122019" opacity=".3" />
    <circle r="17" fill="#f7efd9" stroke={cloth > 0 ? '#9d7c4c' : '#a33a2e'} strokeWidth="2.4" strokeDasharray={cloth > 0 ? undefined : '3 2'} />
    {/* 小屋：屋頂與牆，部落的標誌。 */}
    <path d="M-7 -9.5 L0 -15.5 L7 -9.5 Z" fill="#8a5a32" stroke="#4a2f17" strokeWidth="1" />
    <text y="7.5" textAnchor="middle" fontSize="15" fontWeight="800" fill={hot ? '#b3261e' : '#20180f'}>{number}</text>
    {/* 布匹：一枚一捲，最多畫五捲，數字另外寫出。 */}
    <g transform={`translate(0 ${side * 29})`}>
      {Array.from({ length: bolts }, (_, index) => (
        <g key={index} transform={`translate(${start + index * width} 0)`}>
          <rect x="-3.6" y="-5.5" width="7.2" height="11" rx="2.2" fill="#e9d8b0" stroke="#7a5a28" strokeWidth="1" />
          <rect x="-3.6" y="-1.5" width="7.2" height="3" fill="#b8472f" />
        </g>
      ))}
      <text y={side * 15 + (up ? 0 : 4)} textAnchor="middle" fontSize="11" fontWeight="800" fill="#20180f" stroke="#f7efd9" strokeWidth="2.6" paintOrder="stroke">×{cloth}</text>
    </g>
    {/* 已建立關係的玩家：玩家色的小圓點排在圓片另一側。 */}
    {linked.map((entry, index) => (
      <circle key={entry.id} cx={(index - (linked.length - 1) / 2) * 11} cy={-side * 25} r="4.4" fill={entry.color} stroke="#20180f" strokeWidth="1.2" data-testid={testId ? `${testId}-link-${index}` : undefined} />
    ))}
  </g>;
}

/**
 * 卡坦奇觀的地圖標記（交叉點）：Great Wall 是棕色方塊、Great Bridge 是紫色方塊、設置禁設點 X 是紅色叉。
 * 形狀與文字標題不只靠顏色區分；標記不擋點擊（`pointerEvents: none`）。
 */
export function WonderMarker({ x, y, kind, label, testId }: { x: number; y: number; kind: 'greatWall' | 'greatBridge' | 'x'; label: string; testId?: string }) {
  return <g transform={`translate(${x} ${y})`} data-testid={testId} data-wonder-marker={kind} pointerEvents="none">
    <title>{label}</title>
    {kind === 'x' ? <>
      <circle r="9" fill="#fff4f0" opacity=".85" stroke="#8c1d12" strokeWidth="1.2" />
      <path d="M-5.5 -5.5 L5.5 5.5 M5.5 -5.5 L-5.5 5.5" stroke="#c2281a" strokeWidth="3.2" strokeLinecap="round" />
    </> : <>
      <rect x="-9" y="-9" width="18" height="18" rx="2.5" fill={kind === 'greatWall' ? '#8a5a32' : '#7a4fb0'} stroke="#20180f" strokeWidth="1.6" />
      {kind === 'greatWall'
        ? <path d="M-9 -3 H9 M-9 3 H9 M-3 -9 V-3 M3 -3 V3 M-3 3 V9" stroke="#e8c79a" strokeWidth="1.2" />
        : <path d="M-6 3 Q0 -6 6 3 M-6 6 H6" stroke="#e8d8ff" strokeWidth="1.6" fill="none" />}
    </>}
  </g>;
}
