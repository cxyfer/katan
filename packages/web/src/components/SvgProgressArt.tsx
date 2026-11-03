/**
 * Progress-card faces and the merchant piece, hand-written SVG. Every card
 * has the colour and emblem of its deck plus its own glyph, so two cards of
 * one deck are told apart without reading; nothing is traced from official
 * artwork and the card text comes from the catalog.
 */

import type { ReactNode } from 'react';
import { PROGRESS_TRACK, VP_PROGRESS, type Track } from '../board/citiesKnights.ts';
import { shade } from './SvgBoardArt.tsx';
import { TRACK_COLOR, TrackEmblem } from './SvgCitiesKnights.tsx';

const INK = '#3a3127';

/** A line-drawn glyph for each card, in a 24×24 box centred on the origin. */
const GLYPHS: Readonly<Record<string, ReactNode>> = {
  alchemy: <><path d="M-3-9h6M-2-9v6l-6 10a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-10v-6" /><path d="M-5 4h10" /><circle cx="1" cy="7" r="1" /></>,
  crane: <><path d="M-8 10V-9h14M-8-5l4-4M6-9v6" /><path d="M6-3a2 2 0 1 1-2 2" /><path d="M-11 10h7" /></>,
  engineering: <path d="M-10 9V-2h3v-3h3v3h3v-3h3v3h3v-3h3V9ZM-2 9V4h4v5" />,
  invention: <><circle r="4" /><path d="M0-10v3M0 7v3M-10 0h3M7 0h3M-7-7l2 2M5 5l2 2M7-7l-2 2M-5 5l-2 2" /></>,
  irrigation: <><path d="M-10 8h20M-10 3q5-3 10 0t10 0" /><path d="M0-10q-4 5-4 7a4 4 0 0 0 8 0q0-2-4-7Z" /></>,
  medicine: <><circle r="9" /><path d="M-2-6h4v4h4v4h-4v4h-4v-4h-4v-4h4Z" /></>,
  mining: <><path d="M-8 9 6-5" /><path d="M-1-9q8 1 10 9-5-6-10-9Z" /><path d="M-10 9h6" /></>,
  printing: <><path d="M-8-9h16v6H-8ZM-10-3h20v8h-20Z" /><path d="M-6 5v5h12V5M-4 1h8" /></>,
  roadBuilding: <><path d="M-10 6 0-1M0-1l10-7" strokeWidth="3" /><path d="M-8 9h4M4-10h4" /></>,
  smithing: <><path d="M-9 5h18l-3 4H-6Z" /><path d="M-5 5V2h10v3" /><path d="M2-9l5 5M-1-6l6-6 3 3-6 6Z" /></>,
  commercialHarbor: <><path d="M0-10v16M-8 0q0 8 8 8t8-8M-4-6h8" /><path d="M-11 2l3-2 3 2M5 2l3-2 3 2" /></>,
  guildDues: <><path d="M-6-6h12l4 12a3 3 0 0 1-3 4H-7a3 3 0 0 1-3-4Z" /><path d="M-4-9h8M-2 0h4M0-2v8" /></>,
  merchant: <><circle cy="-6" r="3" /><path d="M-8-9h16M-5 10l2-11h6l2 11Z" /><path d="M5 2h4v5H5" /></>,
  merchantFleet: <><path d="M-10 4h20l-4 5H-6Z" /><path d="M-2 4V-10M-2-9l7 9h-7M-3-7l-6 7h6" /></>,
  resourceMonopoly: <><path d="M0-3v12M-4 9h8M-3-3q3-6 3-8 0 2 3 8Z" /><path d="M-11-6l5 3M11-6l-5 3M-11 4l5-2M11 4l-5-2" /></>,
  tradeMonopoly: <><circle cy="2" r="5" /><path d="M-2 2h4" /><path d="M-11-8l6 5M11-8l-6 5M0-11v5" /></>,
  constitution: <><path d="M-8-10h13a3 3 0 0 1 0 6v13H-8a3 3 0 0 1 0-6Z" /><path d="M-5-4h7M-5-1h7M-5 2h5" /><circle cx="3" cy="7" r="2.5" /></>,
  diplomacy: <><path d="M-10 6 10-6" strokeWidth="3" /><path d="M-4-4l8 8M4-4l-8 8" /></>,
  encouragement: <><path d="M-9-2h3l8-6v16l-8-6h-3Z" /><path d="M5-4q3 4 0 8M8-7q6 7 0 14" /></>,
  espionage: <><path d="M-11 0q11-11 22 0-11 11-22 0Z" /><circle r="3.5" /></>,
  intrigue: <><path d="M-10-5q10-4 20 0-1 9-6 9-4 0-4-3 0 3-4 3-5 0-6-9Z" /><path d="M-6-1h3M3-1h3" /></>,
  sabotage: <><circle r="8" /><path d="M0-8v16M-8 0h16M-6-6l2 2M6 6l-2-2" /><path d="M-3 3 5-5" strokeWidth="3" /></>,
  taxation: <><path d="M0-9v17M-8 8h16M-9-5h18M-9-5l-2 6h5ZM9-5l-2 6h5Z" /><circle cy="-9" r="1.5" /></>,
  treason: <><path d="M-8 8 5-5M3-7l5-1-1 5M-10 6l4 4M-7 3l4 4" /></>,
  wedding: <><circle cx="-3" cy="2" r="5" /><circle cx="4" cy="2" r="5" /><path d="M2-8l2-3 2 3" /></>,
};

/** The glyph of a progress card, drawn in `color`. */
export function ProgressGlyph({ card, size = 24, color = INK }: { card: string; size?: number; color?: string }) {
  return <g transform={`scale(${size / 24})`} fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {GLYPHS[card] ?? <circle r="6" />}
  </g>;
}

/**
 * A progress card face: deck-coloured header with the deck emblem, the card
 * glyph on a tinted medallion, and a gold point disc on the two VP cards.
 */
export function ProgressCardFace({ card, dimmed = false }: { card: string; dimmed?: boolean }) {
  const track: Track = PROGRESS_TRACK[card] ?? 'science';
  const tone = TRACK_COLOR[track];
  const victory = VP_PROGRESS.has(card);
  return <svg viewBox="0 0 60 84" className="ck-card ck-card--progress" data-track={track} data-card={card}
    data-dimmed={dimmed ? 'true' : undefined} aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="58" height="82" rx="6" fill="#fbf4e2" stroke={shade(tone, -0.55)} strokeWidth="2" />
    <rect x="1" y="1" width="58" height="22" rx="6" fill={tone} />
    <rect x="1" y="17" width="58" height="6" fill={tone} />
    <g transform="translate(30 12)"><TrackEmblem track={track} size={13} /></g>
    <circle cx="30" cy="50" r="19" fill={shade(tone, 0.72)} stroke={shade(tone, -0.2)} strokeWidth="1.4" />
    <g transform="translate(30 50)"><ProgressGlyph card={card} size={26} color={shade(tone, -0.6)} /></g>
    {victory && <g transform="translate(47 72)"><circle r="8" fill="#f2c94c" stroke="#6b4a10" strokeWidth="1.4" />
      <text y="4" textAnchor="middle" fontSize="11" fontWeight="700" fill="#5a3505">1</text></g>}
    {dimmed && <rect x="1" y="1" width="58" height="82" rx="6" fill="#1b1712" opacity=".35" />}
  </svg>;
}

/**
 * The merchant: a cloaked trader with a wide hat and a pack, on a round base
 * in the owner's colour; the base carries a coin with the single point.
 */
export function MerchantPiece({ x, y, color, dash, ghost = false, testId }: {
  x: number; y: number; color: string; dash?: string; ghost?: boolean; testId?: string;
}) {
  const dark = shade(color, -0.55);
  return <g transform={`translate(${x} ${y})`} data-testid={testId} opacity={ghost ? 0.75 : 1} aria-hidden="true">
    {!ghost && <ellipse cy="13" rx="15" ry="5" fill="#071d28" opacity=".45" />}
    <ellipse cy="10" rx="13" ry="5.5" fill={shade(color, -0.25)} stroke={dark} strokeWidth="1.6" strokeDasharray={dash} />
    <path d="M-7 10-4-6h8l3 16Z" fill={color} stroke={dark} strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M4-2h6v8H3" fill="#b07a45" stroke="#4b2e14" strokeWidth="1.3" strokeLinejoin="round" />
    <circle cy="-10" r="4.5" fill="#f0d2b0" stroke="#5a3a20" strokeWidth="1.3" />
    <path d="M-9-12h18M-5-12q0-6 5-6t5 6" fill="#5b3a22" stroke="#2c1a0c" strokeWidth="1.4" strokeLinejoin="round" />
    <g transform="translate(-10 7)"><circle r="4.2" fill="#e3b341" stroke="#6b4a10" strokeWidth="1.1" />
      <text y="2.6" textAnchor="middle" fontSize="7" fontWeight="700" fill="#5a3505">1</text></g>
  </g>;
}
