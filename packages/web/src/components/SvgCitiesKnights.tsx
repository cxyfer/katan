/**
 * Cities & Knights art, hand-written SVG: knights (three strengths, active or
 * inactive), city walls, the metropolis of each track, the barbarian ship and
 * track, the event and red dice, commodity emblems and progress-card faces.
 * Shapes never rely on colour alone: a knight's strength is its helmet crest
 * and pip count, its status is upright or lying down, and each track has its
 * own emblem.
 */

import type { ReactNode } from 'react';
import type { GameView } from '@catan/rules';
import { merchantSpot, TRACKS, type CitiesKnightsModuleView, type Commodity, type EventFace, type KnightLevel, type Track } from '../board/citiesKnights.ts';
import type { BoardGeometry } from '../board/geometry.ts';
import { playerColorHex, seatDash } from '../board/terrain.ts';
import { useT } from '../i18n/context.tsx';
import { CityPiece, shade } from './SvgBoardArt.tsx';
import { MerchantPiece } from './SvgProgressArt.tsx';

/** Track colours of the improvement chart: green science, yellow trade, blue politics. */
export const TRACK_COLOR: Readonly<Record<Track, string>> = { science: '#3f9a4e', trade: '#d8a81f', politics: '#3a6fb8' };

/** A knight token: a round shield with a helmet; lying flat when inactive. */
export function KnightPiece({ x, y, level, active, color, dash, ghost = false, testId }: {
  x: number; y: number; level: KnightLevel; active: boolean; color: string; dash?: string; ghost?: boolean; testId?: string;
}) {
  const dark = shade(color, -0.55);
  const face = active ? color : shade(color, -0.25);
  // Inactive knights are laid on their side, as on the physical table.
  const pose = active ? '' : ' rotate(-90) scale(.92)';
  return <g transform={`translate(${x} ${y}) scale(1.15)`} data-testid={testId} data-level={level} data-active={active ? 'true' : 'false'} opacity={ghost ? 0.75 : 1}>
    {!ghost && <ellipse cy="12" rx={active ? 15 : 19} ry="5" fill="#071d28" opacity=".45" />}
    <g transform={`translate(0 ${active ? 0 : 4})${pose}`}>
      <circle r="14" fill={face} stroke={dark} strokeWidth="2" />
      <circle r="11" fill="none" stroke={shade(color, 0.55)} strokeWidth="1.4" strokeDasharray={dash} opacity=".8" />
      {/* helmet */}
      <path d="M-7 6v-6q0-8 7-8t7 8v6Z" fill="#d8dde2" stroke="#2a3138" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M-5 0h10M0 0v5" stroke="#2a3138" strokeWidth="1.6" strokeLinecap="round" />
      {level >= 2 && <path d="M0-8q6-6 2-11" stroke={shade(color, -0.2)} strokeWidth="3" fill="none" strokeLinecap="round" />}
      {level >= 3 && <path d="M-6-9l2-5 2 3 2-4 2 4 2-3 2 5Z" fill="#f2c94c" stroke="#6b4a10" strokeWidth=".9" strokeLinejoin="round" />}
      {/* strength pips along the rim */}
      {Array.from({ length: level }, (_, index) => (
        <circle key={index} cx={(index - (level - 1) / 2) * 6} cy="10" r="1.9" fill="#fff6dd" stroke={dark} strokeWidth=".8" />
      ))}
    </g>
  </g>;
}

/** A crenellated stone ring under a city. */
export function WallRing({ x, y, color, testId }: { x: number; y: number; color: string; testId?: string }) {
  const teeth = Array.from({ length: 10 }, (_, index) => {
    const angle = (index / 10) * Math.PI * 2;
    return <rect key={index} x={Math.cos(angle) * 25 - 3} y={Math.sin(angle) * 12 + 8 - 3} width="6" height="5" fill="#b9b39f" stroke="#4a4436" strokeWidth=".9" />;
  });
  return <g transform={`translate(${x} ${y})`} data-testid={testId} aria-hidden="true">
    <ellipse cy="10" rx="27" ry="13" fill="#9f9884" stroke="#4a4436" strokeWidth="1.6" />
    <ellipse cy="9" rx="21" ry="9" fill="none" stroke={color} strokeWidth="2.6" />
    {teeth}
  </g>;
}

/** The emblem of a track: aqueduct (science), scales (trade), fortress (politics). */
export function TrackEmblem({ track, size = 14, color = '#fff6dd' }: { track: Track; size?: number; color?: string }) {
  const s = size / 14;
  return <g transform={`scale(${s})`} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {track === 'science' && <path d="M-7 5v-6h14v6M-7-1q3.5-5 7 0 3.5-5 7 0M-3.5 5v-3M3.5 5v-3M-8-3h16" />}
    {track === 'trade' && <path d="M0-7v12M-5 5h10M-7-4h14M-7-4l-2 5h4ZM7-4l-2 5h4Z" />}
    {track === 'politics' && <path d="M-6 6V-2h3v-3h2v3h2v-3h2v3h3v8ZM-1 6V2h2v4" />}
  </g>;
}

/** A metropolis: a tall tower with the track banner, standing behind its city. */
export function MetropolisTower({ x, y, track, color, testId }: { x: number; y: number; track: Track; color: string; testId?: string }) {
  const banner = TRACK_COLOR[track];
  return <g transform={`translate(${x + 16} ${y - 6})`} data-testid={testId} data-track={track}>
    <path d="M-6 12V-28h12v40Z" fill="#d9ceb1" stroke="#3b3324" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M-8-28h16v-5h-3v3h-3v-3h-4v3h-3v-3h-3Z" fill="#cfc3a3" stroke="#3b3324" strokeWidth="1.4" strokeLinejoin="round" />
    <rect x="-2" y="-20" width="4" height="6" fill="#20180f" opacity=".7" />
    <path d="M0-33v-10" stroke="#3b2a17" strokeWidth="1.6" />
    <path d="M0-43h15l-3 5 3 5H0Z" fill={banner} stroke={shade(banner, -0.5)} strokeWidth="1.2" strokeLinejoin="round" />
    <g transform="translate(6.5 -38)"><TrackEmblem track={track} size={7} /></g>
    <rect x="-6" y="2" width="12" height="4" fill={color} stroke="#3b3324" strokeWidth=".8" />
  </g>;
}

/** The barbarian longship. */
export function BarbarianShip({ size = 1 }: { size?: number }) {
  return <g transform={`scale(${size})`}>
    <path d="M-22 2h44l-6 9h-32Z" fill="#3a2a1e" stroke="#120b06" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M-22 2q-6-6-2-11M22 2q6-6 2-11" stroke="#3a2a1e" strokeWidth="3" fill="none" strokeLinecap="round" />
    <path d="M0 2v-24" stroke="#21170e" strokeWidth="2" />
    <path d="M-11-20h22v15h-22Z" fill="#b8382d" stroke="#4a120d" strokeWidth="1.2" />
    <path d="M-11-15h22M-11-10h22" stroke="#f0d9b5" strokeWidth="1.8" />
    {[-14, -7, 0, 7, 14].map((cx) => <circle key={cx} cx={cx} cy="5" r="2.2" fill="#c9a14a" stroke="#4b360f" strokeWidth=".8" />)}
  </g>;
}

/** The barbarian track: start, six sea spaces and the landing (attack) space. */
export function BarbarianTrack({ position, length, testId }: { position: number; length: number; testId?: string }) {
  const spaces = Array.from({ length: length + 1 }, (_, index) => index);
  const step = 34;
  const width = step * length + 40;
  return <svg viewBox={`-20 -30 ${width} 52`} className="ck-track" role="img" data-testid={testId} data-position={position} aria-hidden="true" focusable="false">
    <path d={`M-14 8H${width - 26}`} stroke="#2a6f7d" strokeWidth="18" strokeLinecap="round" opacity=".55" />
    {spaces.map((index) => {
      const last = index === length;
      return <g key={index} transform={`translate(${index * step} 8)`}>
        <circle r={last ? 11 : 8} fill={last ? '#7d1e18' : index < position ? '#16404a' : '#e8dcbc'} stroke="#2b2318" strokeWidth="1.4" />
        {last && <path d="M-6 4V-3h3v-3h2v3h2v-3h2v3h3v7Z" fill="#f0d9b5" />}
      </g>;
    })}
    <g transform={`translate(${Math.min(position, length) * step} -6)`}><BarbarianShip size={0.62} /></g>
  </svg>;
}

/** The event die: three ship faces and one city gate per track. */
export function EventDieFace({ face, size = 40, testId }: { face: EventFace; size?: number; testId?: string }) {
  const gate = face === 'ship' ? null : TRACK_COLOR[face];
  return <svg viewBox="-20 -20 40 40" width={size} height={size} className="ck-die ck-die--event" data-testid={testId} data-face={face} aria-hidden="true" focusable="false">
    <rect x="-18" y="-18" width="36" height="36" rx="7" fill="#f6efdc" stroke="#3a3127" strokeWidth="2" />
    {face === 'ship' ? <g transform="translate(0 2)"><BarbarianShip size={0.62} /></g> : <g>
      <path d="M-11 12V-4l11-9 11 9v16h-6V3a5 5 0 0 0-10 0v9Z" fill={gate!} stroke={shade(gate!, -0.55)} strokeWidth="1.6" strokeLinejoin="round" />
      <g transform="translate(0 -3)"><TrackEmblem track={face} size={9} /></g>
    </g>}
  </svg>;
}

const PIPS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  1: [[0, 0]],
  2: [[-7, -7], [7, 7]],
  3: [[-8, -8], [0, 0], [8, 8]],
  4: [[-8, -8], [8, -8], [-8, 8], [8, 8]],
  5: [[-8, -8], [8, -8], [0, 0], [-8, 8], [8, 8]],
  6: [[-8, -9], [8, -9], [-8, 0], [8, 0], [-8, 9], [8, 9]],
};

/** A die face in a given colour: the red production die, or the yellow one. */
export function PipDieFace({ value, tone, size = 40, testId }: { value: number; tone: 'red' | 'yellow'; size?: number; testId?: string }) {
  const fill = tone === 'red' ? '#c0392b' : '#f2cf3e';
  const pip = tone === 'red' ? '#fff6dd' : '#2b2318';
  return <svg viewBox="-20 -20 40 40" width={size} height={size} className={`ck-die ck-die--${tone}`} data-testid={testId} data-value={value} aria-hidden="true" focusable="false">
    <rect x="-18" y="-18" width="36" height="36" rx="7" fill={fill} stroke={shade(fill, -0.55)} strokeWidth="2" />
    {(PIPS[value] ?? []).map(([cx, cy], index) => <circle key={index} cx={cx} cy={cy} r="3.4" fill={pip} />)}
  </svg>;
}

/** Commodity emblem: a scroll of paper, a bolt of cloth, a coin. */
export function CommodityEmblem({ commodity, size = 20 }: { commodity: Commodity; size?: number }) {
  return <svg viewBox="-11 -11 22 22" width={size} height={size} className={`ck-commodity ck-commodity--${commodity}`} aria-hidden="true" focusable="false"><CommodityShape commodity={commodity} /></svg>;
}

function CommodityShape({ commodity }: { commodity: Commodity }) {
  let art: ReactNode;
  if (commodity === 'paper') {
    art = <><path d="M-8-7h13a3 3 0 0 1 0 6v8H-8a3 3 0 0 1 0-6Z" fill="#f4ead1" stroke="#6b5a35" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M-5-3h8M-5 0h8M-5 3h6" stroke="#8b7a55" strokeWidth="1.1" strokeLinecap="round" /></>;
  } else if (commodity === 'cloth') {
    art = <><path d="M-9-6h12l6 4v10H-3l-6-4Z" fill="#9c4f9e" stroke="#3e1d40" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M-9-6l6 4v10M-3-2h12" stroke="#3e1d40" strokeWidth="1.2" fill="none" />
      <path d="M-6-3l4 2.6M-6 0l4 2.6M-6 3l4 2.6" stroke="#e7c1e8" strokeWidth="1" /></>;
  } else {
    art = <><circle r="8.5" fill="#e3b341" stroke="#6b4a10" strokeWidth="1.5" />
      <circle r="5.5" fill="none" stroke="#9c6f16" strokeWidth="1.1" />
      <path d="M-2-3h4M0-3v6M-2 3h4" stroke="#6b4a10" strokeWidth="1.3" strokeLinecap="round" /></>;
  }
  return <g>{art}</g>;
}

/** A commodity card face for hands and the supply. */
export function CommodityCardArt({ commodity }: { commodity: Commodity }) {
  const tone = commodity === 'paper' ? '#3f9a4e' : commodity === 'cloth' ? '#d8a81f' : '#3a6fb8';
  return <svg viewBox="0 0 60 84" className="ck-card ck-card--commodity" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="58" height="82" rx="6" fill="#fbf4e2" stroke="#3a3127" strokeWidth="2" />
    <rect x="5" y="5" width="50" height="10" rx="3" fill={tone} />
    <svg x="8" y="24" width="44" height="44" viewBox="-11 -11 22 22" overflow="visible"><CommodityShape commodity={commodity} /></svg>
  </svg>;
}

/** A progress card: track-coloured header and emblem; the text comes from the catalog. */
export function ProgressCardArt({ track, victory = false }: { track: Track; victory?: boolean }) {
  const tone = TRACK_COLOR[track];
  return <svg viewBox="0 0 60 84" className="ck-card ck-card--progress" data-track={track} aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="58" height="82" rx="6" fill="#fbf4e2" stroke={shade(tone, -0.55)} strokeWidth="2" />
    <rect x="1" y="1" width="58" height="22" rx="6" fill={tone} />
    <g transform="translate(30 12)"><TrackEmblem track={track} size={13} /></g>
    {victory && <g transform="translate(30 56)"><circle r="13" fill="#f2c94c" stroke="#6b4a10" strokeWidth="1.6" /><text y="5" textAnchor="middle" fontSize="13" fontWeight="700" fill="#5a3505">1</text></g>}
  </svg>;
}

/** A city lying on its side: pillaged while no settlement piece was left. */
export function ToppledCity({ x, y, color }: { x: number; y: number; color: string }) {
  return <g transform={`translate(${x} ${y + 4}) rotate(-90) scale(.9)`}>
    <CityPiece x={0} y={0} color={color} />
  </g>;
}

interface LayerProps {
  geometry: BoardGeometry;
  view: GameView;
  ck: CitiesKnightsModuleView;
  nameResolver: (id: string) => string;
}

function ownerColor(view: GameView, playerId: string | null | undefined): { color: string; dash: string | undefined } {
  const player = view.players.find((candidate) => candidate.id === playerId);
  return { color: playerColorHex(player?.color ?? 'white'), dash: seatDash(player?.seat ?? 0) };
}

/** City walls, drawn under the buildings. */
export function SvgCitiesKnightsWalls({ geometry, view, ck, nameResolver }: LayerProps) {
  const t = useT();
  return <g data-testid="ck-walls">
    {ck.walls.map((wall) => {
      const vertex = geometry.vertices[wall.vertex];
      if (!vertex) return null;
      return <g key={`wall-${wall.vertex}`}>
        <WallRing x={vertex.x} y={vertex.y} color={ownerColor(view, wall.player).color} testId={`wall-${wall.vertex}`} />
        <title>{`${t('ck.board.wall')} · ${wall.player ? nameResolver(wall.player) : ''}`}</title>
      </g>;
    })}
  </g>;
}

/** Knights and metropolis towers, drawn over the buildings. */
export function SvgCitiesKnightsPieces({ geometry, view, ck, nameResolver }: LayerProps) {
  const t = useT();
  return <g data-testid="ck-pieces">
    {ck.knights.map((knight) => {
      const vertex = geometry.vertices[knight.vertex];
      if (!vertex) return null;
      const { color, dash } = ownerColor(view, knight.player);
      const status = t(knight.active ? 'ck.board.active' : 'ck.board.inactive');
      return <g key={`knight-${knight.vertex}`}>
        <KnightPiece x={vertex.x} y={vertex.y} level={knight.level} active={knight.active} color={color} dash={dash} testId={`knight-${knight.vertex}`} />
        <title>{`${t('ck.board.knight', { level: t(`ck.knight.${knight.level}`), status })} · ${nameResolver(knight.player)}`}</title>
      </g>;
    })}
    {TRACKS.map((track) => {
      const site = ck.metropolises[track];
      const vertex = site ? geometry.vertices[site.vertex] : undefined;
      if (!site || !vertex) return null;
      return <g key={`metropolis-${track}`}>
        <MetropolisTower x={vertex.x} y={vertex.y} track={track} color={ownerColor(view, site.player).color} testId={`metropolis-${track}`} />
        <title>{`${t('ck.board.metropolis', { track: t(`ck.track.${track}`) })} · ${nameResolver(site.player)}`}</title>
      </g>;
    })}
    {ck.merchant && geometry.hexes[ck.merchant.hex] && (() => {
      const { color, dash } = ownerColor(view, ck.merchant.player);
      return <g data-testid="merchant" data-hex={ck.merchant.hex} data-player={ck.merchant.player}>
        <MerchantPiece {...merchantSpot(geometry.hexes[ck.merchant.hex]!)} color={color} dash={dash} />
        <title>{t('ck.board.merchant', { player: nameResolver(ck.merchant.player) })}</title>
      </g>;
    })()}
  </g>;
}
