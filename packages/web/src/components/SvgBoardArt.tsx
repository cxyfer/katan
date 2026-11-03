import { useMemo } from 'react';
import type { BoardGeometry, Point } from '../board/geometry.ts';
import { coastLoops, loopPath, offsetLoop, smoothLoop } from '../board/coastline.ts';
import { ResourceGlyph } from './GameArt.tsx';

/**
 * 2D 棋盤的原創圖像：海岸、地塊紋理、地形場景與棋子。
 * 只負責呈現，座標皆以地塊中心為原點、六角半徑 100 的 SVG 單位繪製。
 */

const TERRAINS = ['forest', 'hills', 'pasture', 'fields', 'mountains', 'desert', 'gold'] as const;

/** Mix a hex colour toward black (negative) or warm white (positive). */
export function shade(color: string, amount: number): string {
  const value = Number.parseInt(color.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const channels = [value >> 16, (value >> 8) & 255, value & 255];
  const target = amount < 0 ? [18, 22, 26] : [255, 246, 226];
  const mixed = channels.map((channel, index) => Math.round(channel + (target[index]! - channel) * Math.abs(amount)));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function boardArtIds(prefix: string) {
  return {
    light: `${prefix}-light`,
    token: `${prefix}-token`,
    sand: `${prefix}-sand`,
    robber: `${prefix}-robber`,
    texture: (terrain: string) => `${prefix}-tex-${terrain}`,
  };
}
export type BoardArtIds = ReturnType<typeof boardArtIds>;

/** Shared gradients and per-terrain texture patterns, declared once per board. */
export function BoardArtDefs({ ids }: { ids: BoardArtIds }) {
  return <defs>
    <radialGradient id={ids.light} cx=".42" cy=".36" r=".72">
      <stop offset="0" stopColor="#fff8e2" stopOpacity=".3" />
      <stop offset=".55" stopColor="#fff8e2" stopOpacity="0" />
      <stop offset="1" stopColor="#14201c" stopOpacity=".2" />
    </radialGradient>
    <radialGradient id={ids.token} cx=".4" cy=".35" r=".7">
      <stop offset="0" stopColor="#fffaea" />
      <stop offset=".7" stopColor="#f1e3be" />
      <stop offset="1" stopColor="#dcc493" />
    </radialGradient>
    <linearGradient id={ids.sand} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#f0dfb0" />
      <stop offset="1" stopColor="#dcc08a" />
    </linearGradient>
    <linearGradient id={ids.robber} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#5a5a66" />
      <stop offset=".55" stopColor="#2a2a33" />
      <stop offset="1" stopColor="#121217" />
    </linearGradient>
    <pattern id={ids.texture('forest')} width="22" height="22" patternUnits="userSpaceOnUse">
      <g fill="#1f3d27" opacity=".2"><circle cx="4" cy="5" r="2.2" /><circle cx="15" cy="13" r="2.6" /><circle cx="8" cy="18" r="1.6" /></g>
      <path d="M17 3l2 3M2 12l3 1" stroke="#d9e8b8" strokeWidth="1.2" opacity=".25" />
    </pattern>
    <pattern id={ids.texture('pasture')} width="18" height="16" patternUnits="userSpaceOnUse">
      <path d="M3 9l1.5-4L6 9M11 15l1.5-4 1.5 4" fill="none" stroke="#56803f" strokeWidth="1.2" opacity=".35" />
      <circle cx="14" cy="4" r="1.1" fill="#f5f0c8" opacity=".55" />
    </pattern>
    <pattern id={ids.texture('fields')} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
      <rect width="12" height="5" fill="#a87d2a" opacity=".16" />
      <path d="M0 8.5h12" stroke="#fff1b8" strokeWidth="1" opacity=".3" />
    </pattern>
    <pattern id={ids.texture('hills')} width="20" height="14" patternUnits="userSpaceOnUse">
      <path d="M2 4h7M12 11h6" stroke="#7d3e22" strokeWidth="1.4" strokeLinecap="round" opacity=".25" />
      <circle cx="15" cy="4" r="1.2" fill="#f4c9a2" opacity=".45" />
    </pattern>
    <pattern id={ids.texture('mountains')} width="20" height="18" patternUnits="userSpaceOnUse">
      <path d="M3 13l3-5 3 5ZM13 6l2.5-4 2.5 4Z" fill="#3f4a4c" opacity=".2" />
      <circle cx="10" cy="15" r="1.1" fill="#eef1ea" opacity=".45" />
    </pattern>
    <pattern id={ids.texture('desert')} width="28" height="12" patternUnits="userSpaceOnUse">
      <path d="M0 7q7-5 14 0t14 0" fill="none" stroke="#b99764" strokeWidth="1.2" opacity=".35" />
      <circle cx="21" cy="2.5" r=".9" fill="#a2865a" opacity=".4" />
    </pattern>
    <pattern id={ids.texture('gold')} width="16" height="16" patternUnits="userSpaceOnUse">
      <path d="M8 3l1.5 3.5L13 8l-3.5 1.5L8 13 6.5 9.5 3 8l3.5-1.5Z" fill="#fff0a8" opacity=".35" />
    </pattern>
  </defs>;
}

/** Bathymetric shallows, surf and a sand rim drawn from the topology's coastline. */
export function IslandShore({ geometry, ids }: { geometry: BoardGeometry; ids: BoardArtIds }) {
  const paths = useMemo(() => coastLoops(geometry.topology, geometry.land).map((loop) => {
    const ring = (offset: number) => loopPath(smoothLoop(offsetLoop(loop, offset), 3), geometry.scale);
    return {
      shallows: [ring(1.05), ring(0.82), ring(0.6)],
      swell: ring(0.47),
      surf: ring(0.36),
      sand: ring(0.29),
      wet: ring(0.22),
    };
  }), [geometry]);
  return <g aria-hidden="true" pointerEvents="none" className="board__shore">
    {paths.map((path, index) => <g key={index}>
      {path.shallows.map((d, depth) => <path key={depth} d={d} fill="#6fc4bb" opacity={[0.12, 0.16, 0.22][depth]} />)}
      <path d={path.swell} fill="none" stroke="#e6faf2" strokeWidth={2.2} strokeDasharray="18 12 4 12" strokeLinecap="round" opacity=".45" />
      <path d={path.surf} fill="#bfeee0" stroke="#f4fff9" strokeWidth={3} opacity=".85" />
      <path d={path.sand} fill={`url(#${ids.sand})`} stroke="#c9a970" strokeWidth={2} />
      <path d={path.wet} fill="none" stroke="#fff4d2" strokeWidth={1.5} strokeDasharray="2 7" strokeLinecap="round" opacity=".7" />
    </g>)}
  </g>;
}

/** Texture, light and a bevel highlight over the authoritative tile polygon. */
export function TileFinish({ terrain, points, cx, cy, ids }: { terrain: string; points: string; cx: number; cy: number; ids: BoardArtIds }) {
  const textured = (TERRAINS as readonly string[]).includes(terrain);
  return <g aria-hidden="true" pointerEvents="none">
    {textured && <polygon points={points} fill={`url(#${ids.texture(terrain)})`} />}
    <polygon points={points} fill={`url(#${ids.light})`} />
    <polygon points={points} fill="none" stroke="#fff8dc" strokeWidth={2.5} opacity=".35"
      transform={`translate(${cx} ${cy}) scale(.93) translate(${-cx} ${-cy})`} />
  </g>;
}

export function NumberToken({ x, y, number, pips, ids }: { x: number; y: number; number: number; pips: number; ids: BoardArtIds }) {
  const hot = number === 6 || number === 8;
  const spacing = 5.2;
  return <g transform={`translate(${x} ${y})`} aria-hidden="true">
    <ellipse cy="5" rx="27" ry="24" fill="#122019" opacity=".3" />
    <circle r="27" fill={`url(#${ids.token})`} stroke="#9d7c4c" strokeWidth="2.2" />
    <circle r="22.5" fill="none" stroke="#c7a874" strokeWidth="1" opacity=".75" />
    <text className={`board__number${hot ? ' board__number--hot' : ''}`} y="6" textAnchor="middle">{number}</text>
    <g className={`board__pips${hot ? ' board__pips--hot' : ''}`}>
      {Array.from({ length: pips }, (_, index) => <circle key={index} cx={(index - (pips - 1) / 2) * spacing} cy="15.5" r="1.9" />)}
    </g>
  </g>;
}

const HARBOR_TINT: Readonly<Record<string, string>> = {
  generic: '#2f6d84', lumber: '#3f6f3d', brick: '#a8502f', wool: '#7da34f', grain: '#c39130', ore: '#6d7d86',
};

/** A two-plank jetty from the coast corners out to a trading sign. */
export function HarborMarker({ from, to, center, type, label }: { from: Point; to: Point; center: Point; type: string; label: string }) {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  let nx = mx - center.x;
  let ny = my - center.y;
  const length = Math.hypot(nx, ny) || 1;
  nx /= length; ny /= length;
  // 徽章外緣（32 + 半徑 21 + 半個描邊 1.5）不超過 viewBox 的 0.55 格留白。
  const badge = { x: mx + nx * 32, y: my + ny * 32 };
  const pier = (corner: Point) => {
    const start = { x: corner.x + (mx - corner.x) * 0.22, y: corner.y + (my - corner.y) * 0.22 };
    const end = { x: badge.x + (start.x - badge.x) * 0.3, y: badge.y + (start.y - badge.y) * 0.3 };
    return `M${start.x.toFixed(1)} ${start.y.toFixed(1)}L${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  };
  const tint = HARBOR_TINT[type] ?? HARBOR_TINT.generic!;
  return <g aria-hidden="true">
    {[pier(from), pier(to)].map((d) => <g key={d}>
      <path d={d} stroke="#0f2a2c" strokeWidth={9} strokeLinecap="round" opacity=".25" transform="translate(0 3)" />
      <path d={d} stroke="#6b4a2c" strokeWidth={8} strokeLinecap="round" />
      <path d={d} stroke="#c79c62" strokeWidth={5} strokeDasharray="4 2" />
    </g>)}
    <g transform={`translate(${badge.x.toFixed(1)} ${badge.y.toFixed(1)})`}>
      <ellipse cy="4" rx="22" ry="20" fill="#0f2a2c" opacity=".3" />
      <circle r="21" fill="#f8f0d8" stroke={tint} strokeWidth="3" />
      <circle r="16.5" fill="none" stroke={tint} strokeWidth=".8" opacity=".45" />
      <text className="board__harbor" y={type === 'generic' ? 2 : -3} textAnchor="middle">{label}</text>
      {type !== 'generic' && <g transform="translate(-7.5 0)" color={tint}><ResourceGlyph resource={type} size={15} /></g>}
      {type === 'generic' && <path d="M-8 9q2-2.5 4 0t4 0 4 0 4 0" stroke={tint} strokeWidth="1.6" fill="none" strokeLinecap="round" />}
    </g>
  </g>;
}

export function SettlementPiece({ x, y, color }: { x: number; y: number; color: string }) {
  return <g transform={`translate(${x} ${y}) scale(1.12)`}>
    <ellipse cy="10" rx="16" ry="5" fill="#071d28" opacity=".45" />
    <path d="M-11 9V-3L-2-12 7-3v12Z" fill={color} stroke="#20180f" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M7-3l6-4v12l-6 4Z" fill={shade(color, -0.35)} stroke="#20180f" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M-2-12l6-4 9 9-6 4Z" fill={shade(color, -0.18)} stroke="#20180f" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M-9-3l7-7 7 7" fill="none" stroke={shade(color, 0.55)} strokeWidth="1.6" opacity=".8" />
    <rect x="-4.5" y="2" width="5" height="7" fill="#20180f" opacity=".75" />
  </g>;
}

export function CityPiece({ x, y, color }: { x: number; y: number; color: string }) {
  return <g transform={`translate(${x} ${y}) scale(1.12)`}>
    <ellipse cy="11" rx="23" ry="6" fill="#071d28" opacity=".45" />
    <path d="M-1 10V-2h13l6-4v12l-6 4Z" fill={shade(color, -0.3)} stroke="#20180f" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M-1 10V-2h13v12Z" fill={color} stroke="#20180f" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M-1-2l5-4h14l-6 4Z" fill={shade(color, -0.15)} stroke="#20180f" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M-17 10V-8l7-9 7 9v18Z" fill={color} stroke="#20180f" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M-3-8l5-4v20l-5 2Z" fill={shade(color, -0.35)} stroke="#20180f" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M-10-17l5-4 7 9-5 4Z" fill={shade(color, -0.18)} stroke="#20180f" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M-15-8l5-7 5 7" fill="none" stroke={shade(color, 0.55)} strokeWidth="1.6" opacity=".8" />
    <rect x="-12.5" y="1" width="5" height="9" fill="#20180f" opacity=".75" />
    <rect x="-11.5" y="-8" width="3" height="4" fill="#ffe6a6" opacity=".9" />
    <rect x="3" y="1" width="3.5" height="4" fill="#ffe6a6" opacity=".9" />
  </g>;
}

export function BoardBuilding({ x, y, city, color }: { x: number; y: number; city: boolean; color: string }) {
  return city ? <CityPiece x={x} y={y} color={color} /> : <SettlementPiece x={x} y={y} color={color} />;
}

/** The robber: a hooded wanderer whose shape never depends on colour. */
export function RobberPiece({ x, y, ids }: { x: number; y: number; ids: BoardArtIds }) {
  return <g transform={`translate(${x} ${y})`}>
    <ellipse cy="15" rx="17" ry="5" fill="#071d28" opacity=".5" />
    <path d="M-13 15q-2-14 4-24-5-5-4-11 2-11 13-11t13 11q1 6-4 11 6 10 4 24Z" fill={`url(#${ids.robber})`} stroke="#0b0b0f" strokeWidth="1.6" />
    <path d="M-6-21q6-6 12 0-1 7-6 8-5-1-6-8Z" fill="#0a0a0d" />
    <circle cx="-2.5" cy="-17" r="1.3" fill="#f2d48a" /><circle cx="2.5" cy="-17" r="1.3" fill="#f2d48a" />
    <path d="M-8-27q4-5 10-5" stroke="#8d8d9a" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity=".7" />
    <path d="M-9-6q9 4 18 0" stroke="#6c5a3a" strokeWidth="2.4" fill="none" />
  </g>;
}
