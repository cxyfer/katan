import { useMemo, type ReactNode } from 'react';
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
  const paths = useMemo(() => coastLoops(geometry.topology).map((loop) => {
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

function Pine({ x, y, s = 1, tone = 0 }: { x: number; y: number; s?: number; tone?: number }) {
  const dark = ['#24513b', '#2c5a3f', '#1f4734'][tone % 3]!;
  const light = ['#3f7a4f', '#4a8656', '#36704a'][tone % 3]!;
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cy="2" rx="12" ry="3.5" fill="#173022" opacity=".28" />
    <rect x="-2" y="-8" width="4" height="10" fill="#6d4b31" />
    <path d="M0-44-13-18h6l-10 13h34L7-18h6Z" fill={dark} />
    <path d="M0-44v39h17L7-18h6Z" fill={light} opacity=".55" />
    <path d="M0-44l-7 14M0-30l-9 15" stroke="#7fb27a" strokeWidth="1.4" opacity=".55" fill="none" />
  </g>;
}

function Broadleaf({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cy="2" rx="12" ry="3.5" fill="#173022" opacity=".28" />
    <path d="M-1.5 1v-16h3V1Z" fill="#7a5638" />
    <circle cx="-7" cy="-20" r="9" fill="#5d8d4a" /><circle cx="6" cy="-22" r="10" fill="#6c9a50" />
    <circle cx="0" cy="-30" r="9" fill="#7aa85a" /><circle cx="-3" cy="-31" r="3.5" fill="#b8d58a" opacity=".55" />
  </g>;
}

function Peak({ x, y, w, h, snow = true }: { x: number; y: number; w: number; h: number; snow?: boolean }) {
  const half = w / 2;
  const cap = h * 0.36;
  return <g transform={`translate(${x} ${y})`}>
    <path d={`M${-half} 0L0 ${-h}L${half} 0Z`} fill="#8b979a" />
    <path d={`M0 ${-h}L${half} 0H${half * 0.15}Z`} fill="#5e6c72" />
    <path d={`M0 ${-h}L${-half * 0.35} ${-h * 0.45}L${-half * 0.55} 0`} fill="none" stroke="#b1bcbb" strokeWidth="1.5" opacity=".6" />
    {snow && <path d={`M0 ${-h}L${-half * cap / h} ${-h + cap}l${half * 0.16} ${-cap * 0.22}l${half * 0.14} ${cap * 0.3}l${half * 0.16} ${-cap * 0.34}L${half * cap / h} ${-h + cap}Z`} fill="#f7f6ee" />}
    {snow && <path d={`M0 ${-h}L${half * cap / h} ${-h + cap}l${-half * 0.12} ${-cap * 0.3}Z`} fill="#d5dedf" />}
  </g>;
}

function Rock({ x, y, s = 1, fill = '#9aa19b' }: { x: number; y: number; s?: number; fill?: string }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-7 2-5-4 0-6 6-3 7 2Z" fill={fill} /><path d="M0-6 6-3 7 2H1Z" fill="#000" opacity=".18" />
  </g>;
}

function Mound({ x, y, w, h, colors, grass = true }: { x: number; y: number; w: number; h: number; colors: readonly [string, string, string]; grass?: boolean }) {
  const half = w / 2;
  return <g transform={`translate(${x} ${y})`}>
    <path d={`M${-half} 0C${-half * 0.7} ${-h * 1.2} ${half * 0.7} ${-h * 1.2} ${half} 0Z`} fill={colors[0]} />
    <path d={`M${-half * 0.9} ${-h * 0.25}C${-half * 0.4} ${-h * 0.4} ${half * 0.4} ${-h * 0.4} ${half * 0.9} ${-h * 0.25}`} fill="none" stroke={colors[1]} strokeWidth="2.4" />
    <path d={`M${-half * 0.72} ${-h * 0.55}C${-half * 0.3} ${-h * 0.7} ${half * 0.3} ${-h * 0.7} ${half * 0.72} ${-h * 0.55}`} fill="none" stroke={colors[2]} strokeWidth="2" />
    <path d={`M${half * 0.1} ${-h * 0.88}C${half * 0.6} ${-h * 0.7} ${half * 0.86} ${-h * 0.3} ${half} 0H${half * 0.35}Z`} fill="#000" opacity=".14" />
    {grass && <path d={`M${-half * 0.42} ${-h * 0.78}C${-half * 0.15} ${-h * 0.95} ${half * 0.2} ${-h * 0.95} ${half * 0.4} ${-h * 0.8}C${half * 0.1} ${-h * 0.86} ${-half * 0.15} ${-h * 0.86} ${-half * 0.42} ${-h * 0.78}Z`} fill="#93a95e" />}
  </g>;
}

function Sheep({ x, y, s = 1, flip = false }: { x: number; y: number; s?: number; flip?: boolean }) {
  return <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
    <ellipse cy="2" rx="11" ry="2.8" fill="#2e4a24" opacity=".25" />
    <path d="M-6 0v-5M5 0v-5" stroke="#4b4239" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M-10-7q-3-5 2-7 1-5 7-4 4-4 9 0 5 0 4 5 2 5-3 7H-8q-4 0-2-1Z" fill="#f6f1df" stroke="#d5cfb6" strokeWidth="1" />
    <ellipse cx="11" cy="-10" rx="3.8" ry="4.6" fill="#4d463e" />
    <path d="M10-14l5-2" stroke="#4d463e" strokeWidth="2" strokeLinecap="round" />
    <circle cx="12.4" cy="-11" r=".9" fill="#f8f2df" />
  </g>;
}

function WheatRow({ x, y, length, s = 1 }: { x: number; y: number; length: number; s?: number }) {
  const ears = Math.max(2, Math.round(length / 9));
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d={`M${-length / 2} 2H${length / 2}`} stroke="#a77f2c" strokeWidth="3" strokeLinecap="round" opacity=".55" />
    {Array.from({ length: ears }, (_, index) => {
      const ex = -length / 2 + (index + 0.5) * length / ears;
      const lean = index % 2 ? 2 : -1.5;
      return <g key={index} transform={`translate(${ex} 0) rotate(${lean * 3})`}>
        <path d="M0 1v-13" stroke="#b58d34" strokeWidth="1.2" />
        <path d="M0-19q3.2 3 0 8-3.2-5 0-8Z" fill="#f2d27a" stroke="#c69a3c" strokeWidth=".8" />
      </g>;
    })}
  </g>;
}

function Sheaf({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cy="1" rx="10" ry="3" fill="#5a4214" opacity=".25" />
    <path d="M-8 0l4-20h8l4 20Z" fill="#e7c46a" stroke="#b48a33" strokeWidth="1" />
    <path d="M-5-20q5-9 10 0" fill="#f3d888" stroke="#b48a33" strokeWidth="1" />
    <path d="M-6-9h12" stroke="#8a6326" strokeWidth="2.4" />
  </g>;
}

function Cactus({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`} strokeLinecap="round" fill="none">
    <ellipse cy="1" rx="8" ry="2.5" fill="#7a5f33" opacity=".25" />
    <path d="M0 0v-28M0-12h-7v-9M0-17h6v-7" stroke="#4f7b52" strokeWidth="5.5" />
    <path d="M-1.4 0v-27M-8.4-12v-8" stroke="#86ad78" strokeWidth="1.5" opacity=".8" />
  </g>;
}

function Butte({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const half = w / 2;
  return <g transform={`translate(${x} ${y})`}>
    <path d={`M${-half} 0L${-half * 0.78} ${-h}H${half * 0.78}L${half} 0Z`} fill="#d29a6a" />
    <path d={`M${-half * 0.93} ${-h * 0.35}H${half * 0.93}M${-half * 0.86} ${-h * 0.68}H${half * 0.86}`} stroke="#b97a4c" strokeWidth="2.2" />
    <path d={`M${half * 0.2} ${-h}H${half * 0.78}L${half} 0H${half * 0.32}Z`} fill="#000" opacity=".15" />
    <path d={`M${-half * 0.78} ${-h}H${half * 0.78}`} stroke="#ecc596" strokeWidth="2.4" />
  </g>;
}

function Kiln({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <ellipse cy="1" rx="13" ry="3.5" fill="#4a2414" opacity=".25" />
    <path d="M-11 0v-9q0-11 11-11t11 11V0Z" fill="#b8694a" stroke="#7c3f28" strokeWidth="1.2" />
    <path d="M-4 0v-6q4-5 8 0V0Z" fill="#3a2419" />
    <path d="M4-24h5v9h-5Z" fill="#7a4a35" />
    <circle cx="8" cy="-29" r="3.5" fill="#eee8dd" opacity=".85" /><circle cx="11" cy="-35" r="2.6" fill="#f5f1e9" opacity=".7" />
  </g>;
}

function BrickStack({ x, y }: { x: number; y: number }) {
  const brick = (bx: number, by: number, key: string) => <g key={key}>
    <rect x={bx} y={by} width="9" height="5" fill="#cf8463" stroke="#8c4a32" strokeWidth=".9" />
    <rect x={bx} y={by} width="9" height="1.6" fill="#eab08e" />
  </g>;
  return <g transform={`translate(${x} ${y})`}>
    <ellipse cx="0" cy="1" rx="16" ry="3.5" fill="#4a2414" opacity=".25" />
    {[0, 1, 2].flatMap((row) => Array.from({ length: 3 - row }, (_, col) => brick(-13.5 + row * 4.5 + col * 9, -5 - row * 5, `${row}-${col}`)))}
  </g>;
}

function Bones({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`} stroke="#f4ead2" strokeLinecap="round" fill="none">
    <path d="M-10 0h18" strokeWidth="2.6" />
    {[-7, -3, 1, 5].map((rx) => <path key={rx} d={`M${rx} 0q-2-5 1-7M${rx} 0q-2 5 1 7`} strokeWidth="1.4" />)}
  </g>;
}

/**
 * Each terrain's scene sits around the central number token: tall features stay
 * in the back half, small details flank the token, lanes and corners stay clear.
 */
export function TerrainScene({ terrain, x, y }: { terrain: string; x: number; y: number }) {
  let art: ReactNode;
  switch (terrain) {
    case 'forest':
      art = <>
        <Pine x={-30} y={-40} s={.8} tone={1} /><Pine x={30} y={-42} s={.86} tone={2} /><Pine x={0} y={-52} s={1} />
        <Pine x={-52} y={-4} s={.66} tone={2} /><Broadleaf x={50} y={2} s={.72} />
        <Pine x={-38} y={42} s={.6} tone={1} /><Pine x={40} y={44} s={.56} />
      </>;
      break;
    case 'mountains':
    case 'gold':
      art = <>
        <Peak x={-26} y={-30} w={56} h={46} /><Peak x={26} y={-30} w={52} h={40} /><Peak x={0} y={-30} w={66} h={58} />
        <Peak x={-50} y={10} w={30} h={22} snow={false} /><Peak x={52} y={14} w={26} h={18} snow={false} />
        <Rock x={-30} y={44} s={1.1} /><Rock x={34} y={46} s={.9} fill="#8a918b" /><Rock x={-12} y={56} s={.7} />
        {terrain === 'gold' && <><Rock x={22} y={36} s={1.2} fill="#d9b44d" /><Rock x={-46} y={30} s={.9} fill="#e7c868" /></>}
      </>;
      break;
    case 'hills':
      art = <>
        <Mound x={18} y={-32} w={84} h={40} colors={['#c27650', '#a85d3c', '#d79a72']} />
        <Mound x={-34} y={-26} w={58} h={28} colors={['#b5694a', '#9a5236', '#d08a64']} />
        <Kiln x={-46} y={22} /><BrickStack x={46} y={24} />
        <Rock x={-24} y={52} s={.8} fill="#c98a66" /><Rock x={22} y={56} s={.7} fill="#b9745a" />
      </>;
      break;
    case 'fields':
      art = <>
        <WheatRow x={0} y={-58} length={44} /><WheatRow x={0} y={-38} length={76} /><WheatRow x={-46} y={-14} length={30} />
        <WheatRow x={46} y={-14} length={30} /><WheatRow x={-44} y={24} length={34} s={.9} /><WheatRow x={44} y={24} length={34} s={.9} />
        <Sheaf x={-20} y={54} s={.9} /><Sheaf x={20} y={54} s={.9} />
      </>;
      break;
    case 'pasture':
      art = <>
        <path d="M-62-22q30-34 62-22 30-18 62 22Z" fill="#8fb565" opacity=".8" />
        <path d="M-50-36v-10m22 6v-10m22 7v-10m22 9v-10m22 11v-10" stroke="#8e7655" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M-52-42q24-8 46-3t44 2" stroke="#b39871" strokeWidth="2" fill="none" />
        <Sheep x={-24} y={-48} s={.82} /><Sheep x={28} y={-46} s={.78} flip />
        <Sheep x={-48} y={14} s={.9} /><Sheep x={46} y={20} s={.86} flip /><Sheep x={-8} y={52} s={.74} flip />
        {[-30, 24, 34].map((fx, index) => <circle key={fx} cx={fx} cy={index ? 48 : 40} r={2.4} fill={index % 2 ? '#f0e3a4' : '#e8a8a2'} />)}
      </>;
      break;
    case 'desert':
      art = <>
        <path d="M-66-14q30-34 64-12 30-30 66 12Z" fill="#e9cf98" />
        <path d="M-58-18q26-16 52-6m16-4q24-14 46 6" stroke="#f7e6bd" strokeWidth="2.4" fill="none" />
        <Butte x={-28} y={-34} w={42} h={30} /><Cactus x={34} y={-28} s={1} /><Cactus x={52} y={18} s={.72} />
        <Bones x={-44} y={36} /><Rock x={20} y={50} s={.9} fill="#c4a87a" /><Rock x={-12} y={56} s={.6} fill="#b89b6c" />
      </>;
      break;
    default:
      art = <path d="M-40-10q10-8 20 0t20 0 20 0 20 0M-40 10q10-8 20 0t20 0 20 0 20 0" fill="none" stroke="#bfe6df" strokeWidth="2.5" />;
  }
  return <g transform={`translate(${x} ${y})`} className="board__scene" aria-hidden="true" pointerEvents="none">{art}</g>;
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
  const badge = { x: mx + nx * 46, y: my + ny * 46 };
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
