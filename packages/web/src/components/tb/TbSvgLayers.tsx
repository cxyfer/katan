import { useId } from 'react';
import type { GameView } from '@catan/rules';
import type { BoardGeometry, Point } from '../../board/geometry.ts';
import { pipsFor } from '../../board/terrain.ts';
import { useT } from '../../i18n/context.tsx';
import { tbPart } from './model.ts';

/**
 * SVG layers for Traders & Barbarians board features. `TbSvgUnder` draws
 * frame and terrain features beneath the pieces; `TbSvgOver` draws scenario
 * pieces above roads and buildings.
 */

interface FishingView {
  grounds: { valley: number; edges: [number, number]; vertices: [number, number, number]; number: number }[];
}

function unit(x: number, y: number): Point {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

/** Outward normal of a coastal edge, away from its land hex. */
function outward(geometry: BoardGeometry, edge: number): Point {
  const info = geometry.topology.edges[edge]!;
  const hex = geometry.hexes[info.hexes[0]!]!;
  const line = geometry.edges[edge]!;
  return unit((line.x1 + line.x2) / 2 - hex.cx, (line.y1 + line.y2) / 2 - hex.cy);
}

/** A fishing-ground tile: a chevron hugging two coastal edges, with its number. */
function FishingGround({ geometry, ground, waves }: { geometry: BoardGeometry; ground: FishingView['grounds'][number]; waves: string }) {
  const t = useT();
  const v = (index: number) => geometry.vertices[index]!;
  const [valley, a, b] = ground.vertices;
  const depth = geometry.scale * 0.42;
  const na = outward(geometry, ground.edges[0]);
  const nb = outward(geometry, ground.edges[1]);
  const mid = unit(na.x + nb.x, na.y + nb.y);
  const p = (point: Point, n: Point, d: number) => `${(point.x + n.x * d).toFixed(1)},${(point.y + n.y * d).toFixed(1)}`;
  // Edge 0 joins the valley to one peak; find which.
  const edge0 = geometry.topology.edges[ground.edges[0]]!.vertices;
  const [peakA, peakB] = edge0.includes(a) ? [v(a), v(b)] : [v(b), v(a)];
  const points = [p(peakA, na, 0), p(v(valley), mid, 0), p(peakB, nb, 0), p(peakB, nb, depth), p(v(valley), mid, depth * 1.2), p(peakA, na, depth)].join(' ');
  const badge = { x: v(valley).x + mid.x * depth * 0.9, y: v(valley).y + mid.y * depth * 0.9 };
  const pips = pipsFor(ground.number);
  return (
    <g data-testid={`tb-ground-${ground.valley}`} className="tb-ground">
      <polygon points={points} fill="#2f88ac" stroke="#d9f1f6" strokeWidth={2.5} strokeLinejoin="round" />
      <polygon points={points} fill={`url(#${waves})`} opacity={0.5} />
      <g transform={`translate(${badge.x.toFixed(1)} ${badge.y.toFixed(1)})`}>
        <circle r={17} fill="#e9f7fb" stroke="#1b5a73" strokeWidth={2} />
        <path d="M-9 4q5-6 11-3l5-3v7l-5-3q-6 3-11-2Z" fill="#1b5a73" opacity=".35" />
        <text y={5} textAnchor="middle" className="tb-ground__number">{ground.number}</text>
        {Array.from({ length: pips }, (_, index) => <circle key={index} cx={(index - (pips - 1) / 2) * 3.6} cy={11} r={1.2} fill="#1b5a73" />)}
      </g>
      <title>{t('tb.fishing.ground', { number: ground.number })}</title>
    </g>
  );
}

export function TbSvgUnder({ geometry, view }: { geometry: BoardGeometry; view: GameView }) {
  const waves = `tb-waves-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const fishing = tbPart<FishingView>(view, 'tb-fishing');
  if (!fishing) return null;
  return (
    <g className="tb-svg-under">
      <defs>
        <pattern id={waves} width="16" height="10" patternUnits="userSpaceOnUse">
          <path d="M0 6q4-4 8 0t8 0" fill="none" stroke="#bfe9f3" strokeWidth="1.5" />
        </pattern>
      </defs>
      {fishing.grounds.map((ground) => <FishingGround key={ground.valley} geometry={geometry} ground={ground} waves={waves} />)}
    </g>
  );
}

export function TbSvgOver({ geometry, view }: { geometry: BoardGeometry; view: GameView }) {
  void geometry;
  void view;
  return null;
}
