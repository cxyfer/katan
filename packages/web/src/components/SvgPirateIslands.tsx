/**
 * The Pirate Islands（海盜巢穴）的 SVG 疊加物：海盜航道、beachhead marker、堡壘旁的 pirate lair 疊與
 * 船線下一個目標的提示環。建築與船本身由一般的建築與船畫（堡壘是玩家色的村落）；lair 數與
 * beachhead 的擁有者另外寫成標題文字，顏色之外還有文字可讀。
 */

import type { GameView } from '@katan/rules';
import type { BoardGeometry } from '../board/geometry.ts';
import { seafarersView } from '../board/seafarers.ts';
import { playerColorHex } from '../board/terrain.ts';
import { useT } from '../i18n/context.tsx';
import { shade } from './SvgBoardArt.tsx';

/** 堡壘旁的 pirate lair 疊：深色圓牌疊起，頂上骷髏，旁邊寫出剩餘枚數。 */
export function LairStack({ x, y, lairs, label, testId }: { x: number; y: number; lairs: number; label: string; testId?: string }) {
  return <g transform={`translate(${x} ${y})`} data-testid={testId} data-lairs={lairs} pointerEvents="none">
    <title>{label}</title>
    <ellipse cy="6" rx="21" ry="7" fill="#04161f" opacity=".4" />
    {Array.from({ length: lairs }, (_, index) => (
      <g key={index} transform={`translate(0 ${-index * 6})`}>
        <ellipse cy="2" rx="19" ry="7" fill="#1b1716" />
        <ellipse cy="-1" rx="19" ry="7" fill={index % 2 === 0 ? '#2a2523' : '#3c3634'} stroke="#c9a14a" strokeWidth="1.3" />
      </g>
    ))}
    <g transform={`translate(0 ${-lairs * 6 - 5})`}>
      <circle r="7.5" fill="#efe6cf" stroke="#2a2523" strokeWidth="1.2" />
      <circle cx="-2.6" cy="-1" r="1.6" fill="#2a2523" /><circle cx="2.6" cy="-1" r="1.6" fill="#2a2523" />
      <path d="M-2.4 3.6h4.8" stroke="#2a2523" strokeWidth="1.2" strokeLinecap="round" />
    </g>
    <text y={14} x={0} textAnchor="middle" fontSize="12" fontWeight="800" fill="#f7efd9" stroke="#20180f" strokeWidth="3" paintOrder="stroke">×{lairs}</text>
  </g>;
}

/** beachhead marker：頂點上的玩家色圓片，中間一面旗（顏色之外有旗形與標題文字）。 */
export function BeachheadMarker({ x, y, color, label, target, testId }: { x: number; y: number; color: string; label: string; target?: boolean; testId?: string }) {
  return <g transform={`translate(${x} ${y})`} data-testid={testId} data-target={target ? 'true' : undefined} pointerEvents="none">
    <title>{label}</title>
    {target && <circle r="24" fill="none" stroke="#ffd45c" strokeWidth="3.2" strokeDasharray="6 4" />}
    <ellipse cy="3" rx="15" ry="13" fill="#10242c" opacity=".35" />
    <circle r="14" fill={color} stroke={shade(color, -0.55)} strokeWidth="2.2" />
    <circle r="9" fill="#fff6dd" stroke={shade(color, -0.55)} strokeWidth="1.2" />
    <path d="M-2 7V-8" stroke="#3b2a17" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M-1.5 -8l8 3-8 3Z" fill={color} stroke={shade(color, -0.55)} strokeWidth="1" />
  </g>;
}

/** 收復後的堡壘：金色旗桿與玩家色的旗（海盜的巢穴標記已經移除）。 */
export function RecapturedBanner({ x, y, color, label, testId }: { x: number; y: number; color: string; label: string; testId?: string }) {
  return <g transform={`translate(${x} ${y})`} data-testid={testId} data-lairs={0} pointerEvents="none">
    <title>{label}</title>
    <ellipse cy="6" rx="16" ry="6" fill="#04161f" opacity=".4" />
    <circle r="15" fill="none" stroke="#ffd45c" strokeWidth="2.4" strokeDasharray="5 3" />
    <path d="M0 6V-22" stroke="#6b442c" strokeWidth="2.6" strokeLinecap="round" />
    <path d="M1-22h17v11h-17Z" fill={color} stroke={shade(color, -0.55)} strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M1-17h17" stroke="#ffd45c" strokeWidth="2" />
    <circle cy="-24" r="2.8" fill="#ffd45c" stroke="#6b442c" strokeWidth=".8" />
  </g>;
}

export function SvgPirateIslands({ geometry, view, nameResolver }: { geometry: BoardGeometry; view: GameView; nameResolver: (id: string) => string }) {
  const t = useT();
  const sea = seafarersView(view);
  const pirate = sea?.pirateIslands;
  if (!sea || !pirate) return null;
  const colorOf = (id: string) => playerColorHex(view.players.find((player) => player.id === id)?.color ?? 'white');
  const route = pirate.route.flatMap((hex) => {
    const cell = geometry.hexes[hex];
    return cell ? [`${cell.cx},${cell.cy + 4}`] : [];
  });
  // 巡弋順序：航道上相鄰兩格之間畫一個順時針的箭頭；海盜現在的位置加環，前方 6 格標出「較小的骰是幾」會停在哪。
  const cells = pirate.route.flatMap((hex) => {
    const cell = geometry.hexes[hex];
    return cell ? [{ hex, x: cell.cx, y: cell.cy + 4 }] : [];
  });
  // 海盜移出遊戲（全部堡壘收復）後不再畫航道。
  const removed = view.board.pirate === null;
  const at = removed ? -1 : cells.findIndex((cell) => cell.hex === view.board.pirate);
  return <g data-testid="pirate-islands-layer">
    {!removed && route.length > 1 && <polygon data-testid="pirate-route" data-hexes={route.length} points={route.join(' ')} fill="none" stroke="#f4e9c6" strokeOpacity=".5"
      strokeWidth="4" strokeDasharray="2 12" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none"><title>{t('sf.pirate.route')}</title></polygon>}
    {!removed && cells.length > 1 && cells.map((cell, index) => {
      const next = cells[(index + 1) % cells.length]!;
      const angle = (Math.atan2(next.y - cell.y, next.x - cell.x) * 180) / Math.PI;
      return <g key={`route-arrow-${cell.hex}`} data-testid={`pirate-route-arrow-${index}`} data-from={cell.hex} data-to={next.hex}
        transform={`translate(${(cell.x + next.x) / 2} ${(cell.y + next.y) / 2}) rotate(${angle})`} pointerEvents="none">
        <title>{t('sf.pirate.routeArrow')}</title>
        <path d="M-8 -6L7 0L-8 6L-4 0Z" fill="#f4e9c6" stroke="#20180f" strokeWidth="1.4" strokeLinejoin="round" />
      </g>;
    })}
    {at >= 0 && <g data-testid="pirate-position" data-hex={cells[at]!.hex} pointerEvents="none">
      <title>{t('sf.pirate.here')}</title>
      <circle cx={cells[at]!.x} cy={cells[at]!.y} r="30" fill="none" stroke="#ffd45c" strokeWidth="3" strokeDasharray="7 5" />
    </g>}
    {at >= 0 && Array.from({ length: 6 }, (_, offset) => {
      const cell = cells[(at + offset + 1) % cells.length]!;
      const steps = offset + 1;
      return <g key={`route-step-${steps}`} data-testid={`pirate-step-${steps}`} data-hex={cell.hex} transform={`translate(${cell.x} ${cell.y})`} pointerEvents="none">
        <title>{t('sf.pirate.step', { steps })}</title>
        <circle r="9" fill="#2a2523" fillOpacity=".78" stroke="#f4e9c6" strokeWidth="1.4" />
        <text y="4" textAnchor="middle" fontSize="12" fontWeight="800" fill="#f7efd9">{steps}</text>
      </g>;
    })}
    {pirate.beachheads.map((beachhead) => {
      const vertex = geometry.vertices[beachhead.vertex];
      if (!vertex) return null;
      const target = sea.lineTarget === beachhead.vertex;
      return <BeachheadMarker key={`beachhead-${beachhead.player}`} testId={`beachhead-${beachhead.vertex}`} x={vertex.x - 20} y={vertex.y + 14} color={colorOf(beachhead.player)} target={target}
        label={t(target ? 'sf.pirate.beachheadTarget' : 'sf.pirate.beachhead', { player: nameResolver(beachhead.player) })} />;
    })}
    {pirate.fortresses.map((fortress) => {
      const vertex = geometry.vertices[fortress.vertex];
      if (!vertex) return null;
      const target = sea.lineTarget === fortress.vertex;
      const label = fortress.lairs > 0
        ? t(target ? 'sf.pirate.fortressTarget' : 'sf.pirate.fortress', { player: nameResolver(fortress.player), count: fortress.lairs })
        : t('sf.pirate.recaptured', { player: nameResolver(fortress.player) });
      return <g key={`fortress-${fortress.player}`}>
        {target && <circle cx={vertex.x} cy={vertex.y} r="26" fill="none" stroke="#ffd45c" strokeWidth="3.2" strokeDasharray="6 4" pointerEvents="none" data-testid="line-target" />}
        {fortress.lairs > 0
          ? <LairStack testId={`fortress-${fortress.vertex}`} x={vertex.x + 24} y={vertex.y + 12} lairs={fortress.lairs} label={label} />
          : <RecapturedBanner testId={`fortress-${fortress.vertex}`} x={vertex.x + 24} y={vertex.y + 12} color={colorOf(fortress.player)} label={label} />}
      </g>;
    })}
  </g>;
}
