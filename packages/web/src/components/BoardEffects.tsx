import type { CSSProperties } from 'react';
import type { GameView } from '@catan/rules';
import type { BoardEffectGroup } from '../board/animation.ts';
import type { BoardGeometry } from '../board/geometry.ts';
import { MAX_FLIGHT_ICONS, neutralThefts, productionGrants } from '../board/effects.ts';
import { parseViewBox } from '../board/viewport.ts';
import { resourceLetter } from '../board/terrain.ts';
import { useT } from '../i18n/context.tsx';
import { TerrainIllustration } from './GameArt.tsx';

/** 單一 SVG 座標系的短暫演出；不持有或更動權威盤面。 */
export function BoardEffects({ group, geometry, view }: { group: BoardEffectGroup | null; geometry: BoardGeometry; view: GameView }) {
  const t = useT();
  if (!group) return null;
  const bounds = parseViewBox(geometry.viewBox);
  const grants = productionGrants(group.events).filter((grant) => view.players.some((player) => player.id === grant.playerId));
  const thefts = neutralThefts(group.events).filter((theft) => view.players.some((p) => p.id === theft.playerId) && view.players.some((p) => p.id === theft.victim));
  const seatPoint = (id: string) => ({
    x: bounds.x + 92,
    y: bounds.y + bounds.height * (.22 + .55 * (view.players.findIndex((p) => p.id === id) + .5) / view.players.length),
  });
  const origin = { x: bounds.x + bounds.width - 110, y: bounds.y + bounds.height * .46 };
  const total = group.events.find((event) => event.type === 'production.resolved')?.params.total;
  const flights = grants.slice(0, MAX_FLIGHT_ICONS);
  const neutral = thefts.slice(0, MAX_FLIGHT_ICONS - flights.length);
  return <g key={group.id} className="board-effects" data-testid="board-effects" aria-hidden="true" pointerEvents="none">
    {grants.length > 0 && <>
      {geometry.hexes.filter((hex) => view.board.numbers[hex.index] === total && hex.index !== view.board.robber).map((hex) =>
        <polygon key={hex.index} className="board-effects__source" points={hex.points} />)}
      <g className="board-effects__aggregate" transform={`translate(${origin.x} ${origin.y})`}>
        <rect x={-95} y={-17} width={190} height={29} rx={8} />
        <text textAnchor="middle" y={2}>{t('board.productionAggregate')}</text>
      </g>
      {view.players.filter((player) => grants.some((grant) => grant.playerId === player.id)).map((player) => {
        const point = seatPoint(player.id);
        return <g key={player.id} className="board-effects__receipt" transform={`translate(${point.x} ${point.y})`}>
          <rect x={-80} y={-14} width={160} height={28} rx={7} />
          <text textAnchor="middle" y={4} fontSize={10}>{player.seat + 1} · {grants.filter((grant) => grant.playerId === player.id).map((grant) => `${resourceLetter(grant.resource)} +${grant.amount}`).join(' ')}</text>
        </g>;
      })}
      {flights.map((grant, index) => {
        const point = seatPoint(grant.playerId);
        const offset = (index % 5 - 2) * 17;
        return <g key={`${grant.playerId}:${grant.resource}`} transform={`translate(${origin.x + offset} ${origin.y})`}>
          <g className="board-effects__flight" data-testid="production-flight" data-amount={grant.amount}
            style={{ '--flight-x': `${point.x - origin.x - offset}px`, '--flight-y': `${point.y - origin.y}px` } as CSSProperties}>
            <rect x={-16} y={-21} width={32} height={42} rx={5} />
            <TerrainIllustration terrain={grant.resource} scale={.2} y={-2} />
            <text textAnchor="middle" y={15}>+{grant.amount}</text>
          </g>
        </g>;
      })}
    </>}
    {neutral.map((theft) => {
      const from = seatPoint(theft.victim), to = seatPoint(theft.playerId);
      return <g key={theft.seq} transform={`translate(${from.x} ${from.y})`}>
        <g className="board-effects__theft" data-testid="neutral-theft" style={{ '--flight-x': `${to.x - from.x}px`, '--flight-y': `${to.y - from.y}px` } as CSSProperties}>
          <rect x={-13} y={-18} width={26} height={36} rx={4} /><path d="m0-10 7 10-7 10-7-10Z" />
        </g>
      </g>;
    })}
  </g>;
}
