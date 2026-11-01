import { useId } from 'react';
import type { GameView } from '@catan/rules';
import type { BoardGeometry, Point } from '../../board/geometry.ts';
import { pipsFor, playerColorHex } from '../../board/terrain.ts';
import { riverCourse } from '../../board/tb-rivers.ts';
import { useT } from '../../i18n/context.tsx';
import { tbPart } from './model.ts';

/**
 * SVG layers for Traders & Barbarians board features. `TbSvgUnder` draws
 * frame and terrain features beneath the pieces; `TbSvgOver` draws scenario
 * pieces above roads and buildings.
 */

interface FishingView {
  grounds: { valley: number; edges: [number, number]; vertices: [number, number, number]; number: number }[];
  lake: number;
  lakeNumbers: number[];
}

/** A small number disc (lake numbers, a hex's second number). */
export function SmallNumber({ x, y, number }: { x: number; y: number; number: number }) {
  const pips = pipsFor(number);
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} aria-hidden="true">
      <circle r={15} fill="#f6ecd2" stroke="#9d7c4c" strokeWidth={1.8} />
      <text y={5} textAnchor="middle" className="tb-ground__number">{number}</text>
      {Array.from({ length: pips }, (_, index) => <circle key={index} cx={(index - (pips - 1) / 2) * 3.4} cy={10} r={1.1} fill="#5b4630" />)}
    </g>
  );
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

interface RiversView { paths: { hexes: number[]; sites: number[] }[] }

interface TradersSvgView {
  sites: { id: string; hex: number; plaza: number }[];
  xEdges: number[];
  barbarians: number[];
  wagons: Record<string, { vertex: number; level: number; cargo: string | null }>;
}

/** Interior dirt paths to each plaza and the X markers on the commodity hexes' frame sides. */
function TradersPaths({ geometry, traders }: { geometry: BoardGeometry; traders: TradersSvgView }) {
  const t = useT();
  return (
    <g className="tb-traders-paths" pointerEvents="none">
      {geometry.topology.edges.map((edge, index) => edge.interior ? (
        <line key={`path-${index}`} x1={geometry.edges[index]!.x1} y1={geometry.edges[index]!.y1} x2={geometry.edges[index]!.x2} y2={geometry.edges[index]!.y2}
          stroke="#e8d3a6" strokeWidth={9} strokeLinecap="round" opacity={0.9} />
      ) : null)}
      {traders.sites.map((site) => {
        const plaza = geometry.vertices[site.plaza]!;
        return <g key={`plaza-${site.id}`} data-testid={`tb-plaza-${site.id}`}>
          <circle cx={plaza.x} cy={plaza.y} r={14} fill="#f3e3bb" stroke="#8a6a3a" strokeWidth={2} />
          <title>{`${t(`tb.term.${site.id}`)} · ${t('tb.traders.plaza')}`}</title>
        </g>;
      })}
      {traders.xEdges.map((edge) => {
        const line = geometry.edges[edge]!;
        const x = (line.x1 + line.x2) / 2;
        const y = (line.y1 + line.y2) / 2;
        return <g key={`x-${edge}`} data-testid={`tb-x-${edge}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
          <circle r={10} fill="#9e1b1b" stroke="#f3e3bb" strokeWidth={2} />
          <path d="M-4.5-4.5l9 9M4.5-4.5l-9 9" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
        </g>;
      })}
    </g>
  );
}

/** A river from its spring through each crossed edge to its mouth, bending around number tokens. */
function River({ geometry, path }: { geometry: BoardGeometry; path: RiversView['paths'][number] }) {
  const t = useT();
  const k = geometry.scale;
  const f = (point: { x: number; y: number }) => `${(point.x * k).toFixed(1)} ${(point.y * k).toFixed(1)}`;
  const segments = riverCourse(geometry.topology, path);
  const d = segments.map((segment, index) =>
    `${index === 0 ? `M${f(segment.from)} ` : ''}C${f(segment.c1)} ${f(segment.c2)} ${f(segment.to)}`).join(' ');
  return (
    <g className="tb-river" data-testid={`tb-river-${path.hexes[0]}`} pointerEvents="none">
      <path d={d} fill="none" stroke="#2a6f97" strokeWidth={k * 0.2} strokeLinecap="round" opacity={0.55} />
      <path d={d} fill="none" stroke="#5fb8dc" strokeWidth={k * 0.12} strokeLinecap="round" />
      <path d={d} fill="none" stroke="#d6f3fa" strokeWidth={2} strokeDasharray="6 10" strokeLinecap="round" opacity={0.8} />
      <title>{t('tb.rivers.title')}</title>
    </g>
  );
}

/** A bridge: a wooden arch along its edge in the owner's colour. */
export function TbBridge({ x1, y1, x2, y2, color }: { x1: number; y1: number; x2: number; y2: number; color: string }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const inset = 0.1;
  const ax = x1 + dx * inset;
  const ay = y1 + dy * inset;
  const bx = x2 - dx * inset;
  const by = y2 - dy * inset;
  const lift = 12;
  return (
    <g aria-hidden="true">
      <path d={`M${ax} ${ay} Q${(x1 + x2) / 2 + nx * lift} ${(y1 + y2) / 2 + ny * lift} ${bx} ${by}`} fill="none" stroke="#20180f" strokeWidth={15} strokeLinecap="round" />
      <path d={`M${ax} ${ay} Q${(x1 + x2) / 2 + nx * lift} ${(y1 + y2) / 2 + ny * lift} ${bx} ${by}`} fill="none" stroke="#8a6a48" strokeWidth={11} strokeLinecap="round" />
      <path d={`M${ax} ${ay} Q${(x1 + x2) / 2 + nx * lift} ${(y1 + y2) / 2 + ny * lift} ${bx} ${by}`} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeDasharray="5 4" />
    </g>
  );
}

export function TbSvgUnder({ geometry, view }: { geometry: BoardGeometry; view: GameView }) {
  const waves = `tb-waves-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const fishing = tbPart<FishingView>(view, 'tb-fishing');
  const rivers = tbPart<RiversView>(view, 'tb-rivers');
  const extras = view.board.extraNumbers ?? [];
  const traders = tbPart<TradersSvgView>(view, 'tb-traders-barbarians');
  if (!fishing && !rivers && !traders && extras.length === 0) return null;
  return (
    <g className="tb-svg-under">
      {traders && <TradersPaths geometry={geometry} traders={traders} />}
      {rivers?.paths.map((path) => <River key={path.hexes[0]} geometry={geometry} path={path} />)}
      {extras.map((extra) => {
        const hex = geometry.hexes[extra.hex];
        return hex ? <SmallNumber key={`extra-${extra.hex}-${extra.number}`} x={hex.cx + 44} y={hex.cy - 30} number={extra.number} /> : null;
      })}
      {fishing && <g>
      {fishing && <defs>
        <pattern id={waves} width="16" height="10" patternUnits="userSpaceOnUse">
          <path d="M0 6q4-4 8 0t8 0" fill="none" stroke="#bfe9f3" strokeWidth="1.5" />
        </pattern>
      </defs>}
      {fishing.grounds.map((ground) => <FishingGround key={ground.valley} geometry={geometry} ground={ground} waves={waves} />)}
      {geometry.hexes[fishing.lake] && fishing.lakeNumbers.map((number, index) => {
        const hex = geometry.hexes[fishing.lake]!;
        const dx = (index % 2 ? 1 : -1) * 30;
        const dy = (index < 2 ? -1 : 1) * 24 + 8;
        return <SmallNumber key={number} x={hex.cx + dx} y={hex.cy + dy} number={number} />;
      })}
      </g>}
    </g>
  );
}

interface TrainsView { starts: { vertex: number; edge: number }[]; wagons: { edge: number; train: number }[]; betweenWagons: number[] }

/** A wagon centred on an edge, facing along it. */
export function SvgWagon({ geometry, edge, color = '#9aa3a6', label }: { geometry: BoardGeometry; edge: number; color?: string; label?: string }) {
  const line = geometry.edges[edge];
  if (!line) return null;
  const x = (line.x1 + line.x2) / 2;
  const y = (line.y1 + line.y2) / 2;
  const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180 / Math.PI;
  const upright = angle > 90 || angle < -90 ? angle + 180 : angle;
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${upright.toFixed(1)})`} className="tb-wagon">
      <ellipse cy={9} rx={19} ry={5} fill="#10242c" opacity={0.35} />
      <path d="M-16 2h32v-9q-16-11-32 0Z" fill={color} stroke="#2e2a24" strokeWidth={2} />
      <rect x={-18} y={1} width={36} height={6} rx={2} fill="#7b5230" stroke="#2e2a24" strokeWidth={1.6} />
      <circle cx={-10} cy={9} r={4.5} fill="#4c3626" stroke="#e6d3b0" strokeWidth={1.4} />
      <circle cx={10} cy={9} r={4.5} fill="#4c3626" stroke="#e6d3b0" strokeWidth={1.4} />
      {label && <title>{label}</title>}
    </g>
  );
}

interface BarbariansView {
  castleEdges: number[];
  coastal: number[];
  barbarians: Record<string, number>;
  conquered: number[];
  conqueredBuildings: number[];
  knights: { player: string; edge: number }[];
  orientations: Record<string, 'slash' | 'backslash' | 'vertical'>;
}

const ORIENTATION_COLOR = { slash: '#7b3fa0', backslash: '#2e8b57', vertical: '#8a5a2b' } as const;

/** A barbarian figure (grey raider with horns). */
function SvgBarbarian({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} className="tb-barbarian" aria-hidden="true">
      <ellipse cy={13} rx={9} ry={3} fill="#10242c" opacity={0.35} />
      <path d="M-7 13v-10q0-7 7-7t7 7v10Z" fill="#8a8f93" stroke="#2e2a24" strokeWidth={1.6} />
      <circle cy={-9} r={5.5} fill="#9aa0a4" stroke="#2e2a24" strokeWidth={1.6} />
      <path d="M-5-12l-4-5M5-12l4-5" stroke="#efe8d6" strokeWidth={2.2} strokeLinecap="round" />
    </g>
  );
}

/** A knight on an edge in the owner's colour. */
function SvgKnight({ geometry, edge, color, label }: { geometry: BoardGeometry; edge: number; color: string; label: string }) {
  const line = geometry.edges[edge];
  if (!line) return null;
  const x = (line.x1 + line.x2) / 2;
  const y = (line.y1 + line.y2) / 2;
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} className="tb-knight" data-testid={`tb-knight-${edge}`}>
      <ellipse cy={12} rx={10} ry={3.5} fill="#10242c" opacity={0.4} />
      <path d="M-8 12v-9q0-8 8-8t8 8v9Z" fill={color} stroke="#20180f" strokeWidth={2} />
      <circle cy={-9} r={6} fill="#c9cdd0" stroke="#20180f" strokeWidth={1.8} />
      <path d="M-4-9h8" stroke="#20180f" strokeWidth={1.6} />
      <path d="M10-18v24M10-18l7 3-7 3" stroke="#20180f" strokeWidth={1.6} fill={color} />
      <title>{label}</title>
    </g>
  );
}

function BarbarianLayer({ geometry, view, ba }: { geometry: BoardGeometry; view: GameView; ba: BarbariansView }) {
  const t = useT();
  const conquered = new Set(ba.conquered);
  return (
    <g className="tb-ba">
      {ba.castleEdges.map((edge) => {
        const line = geometry.edges[edge]!;
        const orientation = ba.orientations[edge] ?? 'vertical';
        return <circle key={`castle-${edge}`} cx={(line.x1 + line.x2) / 2} cy={(line.y1 + line.y2) / 2} r={5}
          fill={ORIENTATION_COLOR[orientation]} stroke="#f7ecd0" strokeWidth={1.5} aria-hidden="true" />;
      })}
      {ba.coastal.map((hex) => {
        const count = ba.barbarians[hex] ?? 0;
        const center = geometry.hexes[hex]!;
        return (
          <g key={`barbarians-${hex}`} data-testid={`tb-barbarians-${hex}`} data-count={count}>
            {conquered.has(hex) && <polygon points={center.points} fill="#1d1b1a" opacity={0.42} pointerEvents="none" />}
            {Array.from({ length: count }, (_, index) => (
              <SvgBarbarian key={index} x={center.cx - 44 + index * 17} y={center.cy - 40 + (index % 2) * 6} />
            ))}
            {count > 0 && <title>{t('tb.ba.barbarian', { count })}</title>}
          </g>
        );
      })}
      {ba.conqueredBuildings.map((vertex) => {
        const point = geometry.vertices[vertex];
        return point ? <g key={`conquered-${vertex}`} aria-hidden="true">
          <circle cx={point.x} cy={point.y} r={18} fill="none" stroke="#1d1b1a" strokeWidth={4} opacity={0.8} />
          <path d={`M${point.x - 12} ${point.y - 12}l24 24`} stroke="#1d1b1a" strokeWidth={4} opacity={0.8} />
        </g> : null;
      })}
      {ba.knights.map((knight) => {
        const owner = view.players.find((player) => player.id === knight.player);
        return <SvgKnight key={`knight-${knight.edge}`} geometry={geometry} edge={knight.edge}
          color={playerColorHex(owner?.color ?? 'white')} label={`${t('tb.ba.knight')} · ${owner?.nickname ?? knight.player}`} />;
      })}
    </g>
  );
}

const CARGO_TINT: Record<string, string> = { marble: '#f1eee6', sand: '#e6c27a', glass: '#6fb6d8', tools: '#8a8f93' };

function TradersLayer({ geometry, view, traders }: { geometry: BoardGeometry; view: GameView; traders: TradersSvgView }) {
  const t = useT();
  const byVertex = new Map<number, string[]>();
  for (const [id, wagon] of Object.entries(traders.wagons)) {
    if (wagon.vertex >= 0) byVertex.set(wagon.vertex, [...(byVertex.get(wagon.vertex) ?? []), id]);
  }
  return (
    <g className="tb-traders">
      {traders.barbarians.map((edge) => {
        const line = geometry.edges[edge];
        return line ? <g key={`barbarian-${edge}`} data-testid={`tb-edge-barbarian-${edge}`}>
          <SvgBarbarian x={(line.x1 + line.x2) / 2} y={(line.y1 + line.y2) / 2 - 6} />
          <title>{t('tb.traders.barbarian', { edge })}</title>
        </g> : null;
      })}
      {[...byVertex].map(([vertex, owners]) => owners.map((owner, index) => {
        const point = geometry.vertices[vertex]!;
        const player = view.players.find((candidate) => candidate.id === owner);
        const wagon = traders.wagons[owner]!;
        const x = point.x + 16 + index * 10;
        const y = point.y + 14 + index * 6;
        return <g key={`wagon-${owner}`} data-testid={`tb-player-wagon-${owner}`} transform={`translate(${x} ${y})`}>
          <ellipse cy={10} rx={15} ry={4} fill="#10242c" opacity={0.35} />
          <path d="M-13 3h26v-7q-13-9-26 0Z" fill={playerColorHex(player?.color ?? 'white')} stroke="#20180f" strokeWidth={1.8} />
          <rect x={-14} y={2} width={28} height={5} rx={2} fill="#7b5230" stroke="#20180f" strokeWidth={1.4} />
          <circle cx={-8} cy={9} r={3.6} fill="#3b2a1c" /><circle cx={8} cy={9} r={3.6} fill="#3b2a1c" />
          {wagon.cargo && <rect x={-5} y={-12} width={10} height={9} rx={2} fill={CARGO_TINT[wagon.cargo] ?? '#ccc'} stroke="#20180f" strokeWidth={1.2} />}
          <title>{`${t('tb.traders.title')} · ${player?.nickname ?? owner}`}</title>
        </g>;
      }))}
    </g>
  );
}

export function TbSvgOver({ geometry, view }: { geometry: BoardGeometry; view: GameView }) {
  const t = useT();
  const trains = tbPart<TrainsView>(view, 'tb-merchant-trains');
  const ba = tbPart<BarbariansView>(view, 'tb-barbarian-attack');
  const traders = tbPart<TradersSvgView>(view, 'tb-traders-barbarians');
  if (ba) return <BarbarianLayer geometry={geometry} view={view} ba={ba} />;
  if (traders) return <TradersLayer geometry={geometry} view={view} traders={traders} />;
  if (!trains) return null;
  const used = new Set(trains.wagons.map((wagon) => wagon.edge));
  return (
    <g className="tb-svg-over">
      {trains.starts.filter((start) => !used.has(start.edge)).map((start) => {
        const line = geometry.edges[start.edge]!;
        const from = geometry.vertices[start.vertex]!;
        const far = line.a === start.vertex ? { x: line.x2, y: line.y2 } : { x: line.x1, y: line.y1 };
        const tip = { x: from.x + (far.x - from.x) * 0.55, y: from.y + (far.y - from.y) * 0.55 };
        return <g key={start.edge} data-testid={`tb-train-start-${start.edge}`} aria-hidden="true">
          <line x1={from.x} y1={from.y} x2={tip.x} y2={tip.y} stroke="#f7ecd0" strokeWidth={5} strokeDasharray="4 5" strokeLinecap="round" />
          <circle cx={tip.x} cy={tip.y} r={5} fill="#f7ecd0" stroke="#5b4630" strokeWidth={1.5} />
        </g>;
      })}
      {trains.betweenWagons.map((vertex) => {
        const point = geometry.vertices[vertex];
        return point ? <circle key={`between-${vertex}`} cx={point.x} cy={point.y} r={20} fill="none" stroke="#f2c94c" strokeWidth={3} strokeDasharray="4 4" aria-hidden="true" /> : null;
      })}
      {trains.wagons.map((wagon) => <SvgWagon key={wagon.edge} geometry={geometry} edge={wagon.edge} label={t('tb.trains.wagon')} />)}
    </g>
  );
}
