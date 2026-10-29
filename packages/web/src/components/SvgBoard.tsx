import type { ComponentProps, Ref } from 'react';
import type { GameView } from '@catan/rules';
import type { BoardEffectGroup } from '../board/animation.ts';
import type { BoardGeometry, Point } from '../board/geometry.ts';
import type { BoardIntent } from '../board/intent.ts';
import type { TableState } from '../state/table.ts';
import { useT } from '../i18n/context.tsx';
import { pipsFor, playerColorHex, resourceLetter, seatDash, terrainFill, terrainLetter, terrainSymbol } from '../board/terrain.ts';
import { confirmedPlacement } from '../board/effects.ts';
import { BuildingPiece, TerrainIllustration } from './GameArt.tsx';

interface SvgBoardProps extends Omit<ComponentProps<'svg'>, 'viewBox' | 'points'> {
  svgRef: Ref<SVGSVGElement>;
  geometry: BoardGeometry;
  view: GameView;
  active: BoardEffectGroup | null;
  selection: TableState['selection'];
  selfId: string | null;
  intent: BoardIntent | null;
  pan: Point;
  zoom: number;
  viewBoxCenter: Point;
  nameResolver: (id: string) => string;
}

export function SvgBoard({ svgRef, geometry, view, active, selection, selfId, intent, pan, zoom, viewBoxCenter, nameResolver, ...svgProps }: SvgBoardProps) {
  const t = useT();
  const board = view.board;
  return (
    <svg {...svgProps} ref={svgRef} className="board__svg" data-testid="board-svg" role="img" aria-label={t('a11y.boardRegion')} viewBox={geometry.viewBox} preserveAspectRatio="xMidYMid meet">
        <g transform={`translate(${viewBoxCenter.x + pan.x} ${viewBoxCenter.y + pan.y}) scale(${zoom}) translate(${-viewBoxCenter.x} ${-viewBoxCenter.y})`}>
          <g aria-hidden="true" pointerEvents="none">
            {geometry.hexes.map((hex) => <polygon key={hex.index} points={hex.points} className="board__tile-base" transform="translate(0 10)" />)}
          </g>
          {geometry.hexes.map((hex) => {
            const terrain = board.terrain[hex.index] ?? 'sea';
            const number = board.numbers[hex.index];
            const pips = pipsFor(number ?? null);
            return (
              <g key={`hex-${hex.index}`}>
                <polygon
                  className="board__tile-top"
                  data-testid={`hex-${hex.index}`}
                  points={hex.points}
                  fill={terrainFill(terrain)}
                  stroke="#ede1b7"
                  strokeWidth={3}
                  strokeLinejoin="round"
                />
                <TerrainIllustration terrain={terrain} x={hex.cx} y={hex.cy - 14} scale={.95} />
                <text
                  className="board__terrain"
                  x={hex.cx - 53}
                  y={hex.cy + 35}
                  textAnchor="middle"
                  aria-hidden="true"
                >
                  {terrainSymbol(terrain)}
                  {terrainLetter(terrain)}
                </text>
                {number !== null && number !== undefined && (
                  <>
                    <circle cx={hex.cx} cy={hex.cy + 34} r={25} fill="#f4e8c9" stroke="#b49b68" strokeWidth={2} />
                    <text
                      className={`board__number${number === 6 || number === 8 ? ' board__number--hot' : ''}`}
                      x={hex.cx}
                      y={hex.cy + 40}
                      textAnchor="middle"
                      aria-hidden="true"
                    >
                      {number}
                    </text>
                    <text
                      className={`board__pips${number === 6 || number === 8 ? ' board__pips--hot' : ''}`}
                      x={hex.cx}
                      y={hex.cy + 53}
                      textAnchor="middle"
                      aria-hidden="true"
                    >
                      {'•'.repeat(pips)}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {board.harbors.map((harbor) => {
            const edge = geometry.edges[harbor.edge];
            if (!edge) return null;
            const cx = (edge.x1 + edge.x2) / 2;
            const cy = (edge.y1 + edge.y2) / 2;
            const label =
              harbor.type === 'generic' ? '3:1' : `2:1${resourceLetter(harbor.type)}`;
            return (
              <g key={`harbor-${harbor.edge}`} data-testid={`harbor-${harbor.edge}`}>
                <circle cx={cx} cy={cy} r={13} fill="#f7f3e3" stroke="#1b1b1b" strokeWidth={1.5} />
                <text className="board__harbor" x={cx} y={cy + 4} textAnchor="middle" aria-hidden="true">
                  {label}
                </text>
              </g>
            );
          })}

          {geometry.edges.map((edge) => {
            const road = board.roads[edge.index];
            if (!road) return null;
            const player = view.players.find((candidate) => candidate.id === road.player);
            const arriving = confirmedPlacement(active?.events ?? [], board, 'edge', edge.index);
            return (
              <g key={`road-${edge.index}`}>
              <line x1={edge.x1} y1={edge.y1 + 3} x2={edge.x2} y2={edge.y2 + 3} stroke="#10242c" strokeWidth={11} strokeLinecap="round" opacity={.7} aria-hidden="true" />
              <line
                data-testid={`road-${edge.index}`}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={playerColorHex(player?.color ?? 'white')}
                strokeWidth={7}
                strokeDasharray={seatDash(player?.seat ?? 0)}
                strokeLinecap="round"
              >
                <title>{`${t('board.road')} · ${nameResolver(road.player)}`}</title>
              </line>
              {arriving && <line key={active?.id} className="board__road-reveal" x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} pathLength={1} stroke={playerColorHex(player?.color ?? 'white')} strokeWidth={10} strokeLinecap="round" aria-hidden="true" pointerEvents="none" />}
              </g>
            );
          })}

          {geometry.vertices.map((vertex) => {
            const building = board.buildings[vertex.index];
            if (!building) return null;
            const player = view.players.find((candidate) => candidate.id === building.player);
            const color = playerColorHex(player?.color ?? 'white');
            const label = building.city ? t('board.city') : t('board.settlement');
            const arriving = confirmedPlacement(active?.events ?? [], board, 'vertex', vertex.index);
            return (
              <g key={`building-${vertex.index}`} data-testid={`building-${vertex.index}`}>
                <g key={arriving ? active!.id : 'rest'} className={arriving ? 'board__building-drop' : undefined}>
                  <BuildingPiece x={vertex.x} y={vertex.y} city={building.city} color={color} />
                </g>
                <title>{`${label} · ${nameResolver(building.player)}`}</title>
              </g>
            );
          })}

          {geometry.hexes[board.robber] && (
            <g data-testid="robber" aria-hidden="true">
              <circle
                cx={geometry.hexes[board.robber]!.cx}
                cy={geometry.hexes[board.robber]!.cy + 2}
                r={17}
                fill="#141414"
                stroke="#f5f5f5"
                strokeWidth={2}
              />
              <text
                className="board__robber"
                x={geometry.hexes[board.robber]!.cx}
                y={geometry.hexes[board.robber]!.cy + 7}
                textAnchor="middle"
              >
                R
              </text>
            </g>
          )}
          {selection.index !== null && intent && selection.kind === intent.kind && intent.targets.includes(selection.index) && (
            <g className="board__preview-ghost" data-testid="board-preview-ghost" aria-hidden="true" pointerEvents="none">
              {intent.kind === 'vertex' && geometry.vertices[selection.index] && <BuildingPiece x={geometry.vertices[selection.index]!.x} y={geometry.vertices[selection.index]!.y} city={intent.commandType === 'build.city'} color={playerColorHex(view.players.find((player) => player.id === selfId)?.color ?? 'white')} />}
              {intent.kind === 'edge' && geometry.edges[selection.index] && <line x1={geometry.edges[selection.index]!.x1} y1={geometry.edges[selection.index]!.y1} x2={geometry.edges[selection.index]!.x2} y2={geometry.edges[selection.index]!.y2} stroke={playerColorHex(view.players.find((player) => player.id === selfId)?.color ?? 'white')} strokeWidth={10} strokeDasharray="8 5" strokeLinecap="round" />}
              {intent.kind === 'hex' && geometry.hexes[selection.index] && <circle cx={geometry.hexes[selection.index]!.cx} cy={geometry.hexes[selection.index]!.cy} r={20} fill="#24353a" stroke="#fff1bd" strokeDasharray="4 4" />}
            </g>
          )}
        </g>
      </svg>
  );
}
