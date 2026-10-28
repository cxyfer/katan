import type { CSSProperties } from 'react';
import type { GameView } from '@catan/rules';
import type { BoardEffectGroup } from '../board/animation.ts';
import type { BoardGeometry } from '../board/geometry.ts';
import { MAX_FLIGHT_ICONS, neutralThefts, productionGrants } from '../board/effects.ts';
import type { BoardEffectAnchors, CssRect, ProjectedAnchor } from '../board/render-contract.ts';
import { resourceLetter } from '../board/terrain.ts';
import { useT } from '../i18n/context.tsx';
import { TerrainIllustration } from './GameArt.tsx';

interface Point { x: number; y: number }

export interface BoardEffectsProps {
  group: BoardEffectGroup | null;
  geometry: BoardGeometry;
  view: GameView;
  /** Stage-local effects never invent a destination when current DOM geometry is absent. */
  anchors?: BoardEffectAnchors | null;
}

function center(rect: CssRect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function local(anchor: Pick<ProjectedAnchor, 'x' | 'y'>, stage: CssRect): Point {
  return { x: anchor.x - stage.left, y: anchor.y - stage.top };
}

function finiteRect(rect: CssRect | null | undefined): rect is CssRect {
  return !!rect && [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}

function pointIn(rect: CssRect, point: Point): boolean {
  return point.x >= rect.left && point.x <= rect.left + rect.width &&
    point.y >= rect.top && point.y <= rect.top + rect.height;
}

function stageOnScreen(stage: CssRect): boolean {
  if (!finiteRect(stage)) return false;
  const width = globalThis.innerWidth;
  const height = globalThis.innerHeight;
  if (!(width > 0 && height > 0)) return true;
  return stage.left < width && stage.left + stage.width > 0 &&
    stage.top < height && stage.top + stage.height > 0;
}

function pointOnScreen(rect: CssRect, stage: CssRect): Point | null {
  if (!finiteRect(rect) || !pointIn(stage, center(rect))) return null;
  const width = globalThis.innerWidth;
  const height = globalThis.innerHeight;
  const point = center(rect);
  if (width > 0 && height > 0 && !pointIn({ left: 0, top: 0, width, height }, point)) return null;
  return point;
}

/**
 * Authoritative effects are rendered above the board in stage coordinates.
 * Flights exist only at measured visible DOM anchors; the textual allocation
 * survives when a seat, aggregate destination, or the stage is unavailable.
 */
export function BoardEffects({ group, geometry, view, anchors = null }: BoardEffectsProps) {
  const t = useT();
  if (!group) return null;

  const stage = finiteRect(anchors?.stage) && stageOnScreen(anchors.stage) ? anchors.stage : null;
  const seatPoint = (id: string): Point | null => {
    const rect = anchors?.seats.get(id);
    if (!stage || !finiteRect(rect)) return null;
    const point = pointOnScreen(rect, stage);
    return point ? local(point, stage) : null;
  };
  const grants = productionGrants(group.events)
    .filter((grant) => view.players.some((player) => player.id === grant.playerId));
  const thefts = neutralThefts(group.events).filter((theft) =>
    view.players.some((player) => player.id === theft.playerId) &&
    view.players.some((player) => player.id === theft.victim));
  const total = group.events.find((event) => event.type === 'production.resolved')?.params.total;
  const activeStage = stage ?? anchors?.stage;
  if (!finiteRect(activeStage)) return null;

  const aggregateVisible = anchors?.aggregate && pointOnScreen(anchors.aggregate, activeStage);
  const aggregateRect = aggregateVisible ? anchors.aggregate : null;
  const origin = aggregateRect ? local(center(aggregateRect), activeStage) : null;
  const productionFlights = origin
    ? grants.flatMap((grant) => {
        const destination = seatPoint(grant.playerId);
        return destination ? [{ grant, destination }] : [];
      }).slice(0, MAX_FLIGHT_ICONS)
    : [];
  const theftFlights = thefts.flatMap((theft) => {
    const from = seatPoint(theft.victim);
    const to = seatPoint(theft.playerId);
    return from && to ? [{ theft, from, to }] : [];
  }).slice(0, Math.max(0, MAX_FLIGHT_ICONS - productionFlights.length));
  const fallbackGrants = !origin || grants.some((grant) => !seatPoint(grant.playerId));
  const sources = grants.length > 0 && typeof total === 'number'
    ? anchors?.targets.filter((target) => target.visible && target.kind === 'hex' &&
        pointOnScreen({ left: target.x, top: target.y, width: 1, height: 1 }, activeStage) &&
        geometry.hexes.some((hex) => hex.index === target.index) &&
        view.board.numbers[target.index] === total && target.index !== view.board.robber)
    : [];
  const aggregatePoint = origin ?? { x: 18, y: 25 };
  const aggregateText = grants.length > 0
    ? `${t('board.productionAggregate')} · ${grants.map((grant) => {
        const player = view.players.find((candidate) => candidate.id === grant.playerId);
        return `${player?.seat !== undefined ? player.seat + 1 : '?'} ${resourceLetter(grant.resource)}+${grant.amount}`;
      }).join(' ')}`
    : t('board.productionAggregate');

  return <svg
    key={group.id}
    className="board-3d-effects board-effects"
    data-testid="board-effects"
    aria-hidden="true"
    pointerEvents="none"
    width="100%"
    height="100%"
    viewBox={`0 0 ${activeStage.width} ${activeStage.height}`}
    preserveAspectRatio="none"
  >
    {(sources?.length ?? 0) > 0 && sources?.map((target) => {
      const point = local(target, activeStage);
      return <circle key={`${target.kind}:${target.index}`} className="board-effects__source"
        data-testid="production-source" cx={point.x} cy={point.y} r={24} />;
    })}
    {grants.length > 0 && <g
      className="board-effects__aggregate"
      data-testid="production-aggregate"
      data-anchor={origin ? 'dom' : 'text-fallback'}
      transform={`translate(${aggregatePoint.x} ${aggregatePoint.y})`}
    >
      <rect x={-112} y={-17} width={224} height={34} rx={8} />
      <text textAnchor="middle" y={4}>{aggregateText}</text>
    </g>}
    {view.players.filter((player) => grants.some((grant) => grant.playerId === player.id)).map((player) => {
      const point = seatPoint(player.id);
      if (!point) return null;
      const playerGrants = grants.filter((grant) => grant.playerId === player.id);
      return <g key={`${player.id}:receipt`} className="board-effects__receipt"
        data-testid="production-receipt" transform={`translate(${point.x} ${point.y})`}>
        <rect x={-80} y={-14} width={160} height={28} rx={7} />
        <text textAnchor="middle" y={4} fontSize={10}>{player.seat + 1} · {playerGrants.map((grant) => `${resourceLetter(grant.resource)} +${grant.amount}`).join(' ')}</text>
      </g>;
    })}
    {productionFlights.map(({ grant, destination }, index) => {
      const offset = (index % 5 - 2) * 17;
      return <g key={`${grant.playerId}:${grant.resource}:flight`} transform={`translate(${origin!.x + offset} ${origin!.y})`}>
        <g className="board-effects__flight" data-testid="production-flight" data-amount={grant.amount}
          style={{ '--flight-x': `${destination.x - origin!.x - offset}px`, '--flight-y': `${destination.y - origin!.y}px` } as CSSProperties}>
          <rect x={-16} y={-21} width={32} height={42} rx={5} />
          <TerrainIllustration terrain={grant.resource} scale={.2} y={-2} />
          <text textAnchor="middle" y={15}>+{grant.amount}</text>
        </g>
      </g>;
    })}
    {theftFlights.map(({ theft, from, to }) => <g key={theft.seq} transform={`translate(${from.x} ${from.y})`}>
      <g className="board-effects__theft" data-testid="neutral-theft"
        style={{ '--flight-x': `${to.x - from.x}px`, '--flight-y': `${to.y - from.y}px` } as CSSProperties}>
        <rect x={-13} y={-18} width={26} height={36} rx={4} /><path d="m0-10 7 10-7 10-7-10Z" />
      </g>
    </g>)}
    {fallbackGrants && <text className="board-effects__fallback" data-testid="production-fallback" x={12} y={52}>
      {grants.map((grant) => {
        const player = view.players.find((candidate) => candidate.id === grant.playerId);
        return `${player?.nickname ?? grant.playerId} ${resourceLetter(grant.resource)}+${grant.amount}`;
      }).join(' · ')}
    </text>}
  </svg>;
}
