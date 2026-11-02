import { memo, useId, useMemo, type ComponentProps, type Ref } from 'react';
import type { GameView } from '@catan/rules';
import type { BoardEffectGroup } from '../board/animation.ts';
import { landHexOfEdge, type BoardGeometry, type Point } from '../board/geometry.ts';
import type { BoardIntent } from '../board/intent.ts';
import type { TableState } from '../state/table.ts';
import { useT } from '../i18n/context.tsx';
import { pipsFor, playerColorHex, resourceLetter, seatDash, terrainFill, terrainLetter, terrainSymbol } from '../board/terrain.ts';
import { confirmedPlacement } from '../board/effects.ts';
import { BoardArtDefs, BoardBuilding, boardArtIds, type BoardArtIds, HarborMarker, IslandShore, NumberToken, RobberPiece, shade, TileFinish } from './SvgBoardArt.tsx';
import { TerrainEmblem } from './TerrainArt.tsx';
import { edgeAngle, edgeMidpoint, IslandBonusToken, PirateShip, pirateFrameSpot, ShipPiece } from './SvgSeafarers.tsx';
import { isShipCommand, seafarersView } from '../board/seafarers.ts';
import { SvgExplorersPiratesLayer } from './SvgExplorersPirates.tsx';

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

/** 圖示在上、數字牌在下，與實體版面相同。 */
const TOKEN_DROP = 32;

/** 有數字牌時強盜站在數字牌右側，不遮住點數；地形標記在左側。 */
function robberSpot(hex: { cx: number; cy: number }, numbered: boolean): Point {
  return numbered ? { x: hex.cx + 46, y: hex.cy + TOKEN_DROP - 4 } : { x: hex.cx, y: hex.cy + TOKEN_DROP - 6 };
}

/** 道路兩端內縮，讓路口的村莊與城市保持完整可見。 */
function inset(edge: { x1: number; y1: number; x2: number; y2: number }, amount = 0.12) {
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  return { x1: edge.x1 + dx * amount, y1: edge.y1 + dy * amount, x2: edge.x2 - dx * amount, y2: edge.y2 - dy * amount };
}

/**
 * 海岸、地塊、圖示與數字牌只隨版圖改變；拖曳或縮放時 SvgBoard 每個影格都會重繪，
 * 這一層以 memo 跳過。
 */
const StaticTiles = memo(function StaticTiles({ geometry, terrain, numbers, ids }: {
  geometry: BoardGeometry;
  terrain: GameView['board']['terrain'];
  numbers: GameView['board']['numbers'];
  ids: BoardArtIds;
}) {
  const land = geometry.hexes.filter((hex) => geometry.land[hex.index] !== false);
  const sea = geometry.hexes.filter((hex) => geometry.land[hex.index] === false);
  return <>
    {/* Sea hexes of a scenario map are open water under the shoreline. */}
    {sea.map((hex) => <SeaHex key={`hex-${hex.index}`} hex={hex} number={numbers[hex.index]} ids={ids} />)}
    <IslandShore geometry={geometry} ids={ids} />
    <g aria-hidden="true" pointerEvents="none">
      {land.map((hex) => <polygon key={hex.index} points={hex.points} className="board__tile-base" transform="translate(0 9)" />)}
    </g>
    {land.map((hex) => {
      const kind = terrain[hex.index] ?? 'sea';
      const number = numbers[hex.index];
      const fill = terrainFill(kind);
      return (
        <g key={`hex-${hex.index}`}>
          <polygon
            className="board__tile-top"
            data-testid={`hex-${hex.index}`}
            points={hex.points}
            fill={fill}
            stroke={shade(fill, -0.42)}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          <TileFinish terrain={kind} points={hex.points} cx={hex.cx} cy={hex.cy} ids={ids} />
          <TerrainEmblem terrain={kind} x={hex.cx} y={hex.cy - 4} />
          <g aria-hidden="true" pointerEvents="none">
            <rect x={hex.cx - 65} y={hex.cy + 25} width={30} height={15} rx={7.5} fill="#fff8e4" opacity=".55" />
            <text className="board__terrain" x={hex.cx - 50} y={hex.cy + 36.5} textAnchor="middle">
              {terrainSymbol(kind)}
              {terrainLetter(kind)}
            </text>
          </g>
          {number !== null && number !== undefined && (
            <NumberToken x={hex.cx} y={hex.cy + TOKEN_DROP} number={number} pips={pipsFor(number)} ids={ids} />
          )}
        </g>
      );
    })}
  </>;
});

/** A sea hex: a faint water cell that keeps the hex addressable on the board. */
function SeaHex({ hex, number, ids }: { hex: BoardGeometry['hexes'][number]; number: number | null | undefined; ids: BoardArtIds }) {
  return <g>
    <polygon className="board__tile-sea" data-testid={`hex-${hex.index}`} points={hex.points}
      fill="#9fd9d4" fillOpacity={0.12} stroke="#e8fbf6" strokeOpacity={0.35} strokeWidth={2} strokeDasharray="6 8" strokeLinejoin="round" />
    {number !== null && number !== undefined && (
      <NumberToken x={hex.cx} y={hex.cy + TOKEN_DROP} number={number} pips={pipsFor(number)} ids={ids} />
    )}
  </g>;
}

export function SvgBoard({ svgRef, geometry, view, active, selection, selfId, intent, pan, zoom, viewBoxCenter, nameResolver, ...svgProps }: SvgBoardProps) {
  const t = useT();
  const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ids = useMemo(() => boardArtIds(`board-art-${prefix}`), [prefix]);
  const board = view.board;
  const selfColor = playerColorHex(view.players.find((player) => player.id === selfId)?.color ?? 'white');
  return (
    <svg {...svgProps} ref={svgRef} className="board__svg" data-testid="board-svg" role="img" aria-label={t('a11y.boardRegion')} viewBox={geometry.viewBox} preserveAspectRatio="xMidYMid meet">
        <g transform={`translate(${viewBoxCenter.x + pan.x} ${viewBoxCenter.y + pan.y}) scale(${zoom}) translate(${-viewBoxCenter.x} ${-viewBoxCenter.y})`}>
          <StaticTiles geometry={geometry} terrain={board.terrain} numbers={board.numbers} ids={ids} />

          {board.harbors.map((harbor) => {
            const edge = geometry.edges[harbor.edge];
            const land = landHexOfEdge(geometry, harbor.edge);
            const hex = land === undefined ? undefined : geometry.hexes[land];
            if (!edge || !hex) return null;
            const label = harbor.type === 'generic' ? '3:1' : '2:1';
            const name = harbor.type === 'generic' ? t('board.harborGeneric')
              : t('board.harborResource', { resource: `${t(`resource.${harbor.type}`)} (${resourceLetter(harbor.type)})` });
            return (
              <g key={`harbor-${harbor.edge}`} data-testid={`harbor-${harbor.edge}`}>
                <HarborMarker from={{ x: edge.x1, y: edge.y1 }} to={{ x: edge.x2, y: edge.y2 }}
                  center={{ x: hex.cx, y: hex.cy }} type={harbor.type} label={label} />
                <title>{name}</title>
              </g>
            );
          })}

          {geometry.edges.map((edge) => {
            const road = board.roads[edge.index];
            if (!road) return null;
            const player = view.players.find((candidate) => candidate.id === road.player);
            const color = playerColorHex(player?.color ?? 'white');
            const arriving = confirmedPlacement(active?.events ?? [], board, 'edge', edge.index);
            if (road.ship) {
              const mid = edgeMidpoint(edge);
              return (
                <g key={`ship-${edge.index}`} data-testid={`ship-${edge.index}`} className={arriving ? 'board__building-drop' : undefined}>
                  <ShipPiece x={mid.x} y={mid.y} angle={edgeAngle(edge)} color={color} dash={seatDash(player?.seat ?? 0)} />
                  <title>{`${t('sf.board.ship')} · ${nameResolver(road.player)}`}</title>
                </g>
              );
            }
            const line = inset(edge);
            return (
              <g key={`road-${edge.index}`}>
              <line {...line} transform="translate(0 3)" stroke="#10242c" strokeWidth={13} strokeLinecap="round" opacity={.4} aria-hidden="true" />
              <line {...line} stroke="#20180f" strokeWidth={11} strokeLinecap="round" aria-hidden="true" />
              <line
                data-testid={`road-${edge.index}`}
                {...line}
                stroke={color}
                strokeWidth={7}
                strokeDasharray={seatDash(player?.seat ?? 0)}
                strokeLinecap="round"
              >
                <title>{`${t('board.road')} · ${nameResolver(road.player)}`}</title>
              </line>
              <line {...line} transform="translate(0 -1.6)" stroke={shade(color, 0.6)} strokeWidth={1.6} strokeLinecap="round"
                strokeDasharray={seatDash(player?.seat ?? 0)} opacity={.55} aria-hidden="true" pointerEvents="none" />
              {arriving && <line key={active?.id} className="board__road-reveal" {...line} pathLength={1} stroke={color} strokeWidth={10} strokeLinecap="round" aria-hidden="true" pointerEvents="none" />}
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
                  <BoardBuilding x={vertex.x} y={vertex.y} city={building.city} color={color} />
                </g>
                <title>{`${label} · ${nameResolver(building.player)}`}</title>
              </g>
            );
          })}

          <SvgExplorersPiratesLayer geometry={geometry} view={view} active={active} nameResolver={nameResolver} />
          {seafarersView(view)?.islandClaims.map((claim) => {
            const vertex = geometry.vertices[claim.vertex];
            const owner = view.players.find((candidate) => candidate.id === claim.player);
            if (!vertex) return null;
            return <IslandBonusToken key={`island-${claim.player}-${claim.island}`} testId={`island-bonus-${claim.vertex}`}
              x={vertex.x + 17} y={vertex.y + 16} color={playerColorHex(owner?.color ?? 'white')} />;
          })}
          {seafarersView(view) && (() => {
            const hex = board.pirate === null ? null : geometry.hexes[board.pirate];
            const spot = hex ? { x: hex.cx, y: hex.cy + 4 } : pirateFrameSpot(geometry);
            return <g data-testid={hex ? 'pirate-hex' : 'pirate-frame'}>
              <PirateShip x={spot.x} y={spot.y} />
              <title>{hex ? t('sf.board.pirate') : t('sf.board.pirateFrame')}</title>
            </g>;
          })()}
          {geometry.hexes[board.robber] && (
            <g data-testid="robber" aria-hidden="true">
              <RobberPiece {...robberSpot(geometry.hexes[board.robber]!, board.numbers[board.robber] != null)} ids={ids} />
            </g>
          )}
          {selection.index !== null && intent && selection.kind === intent.kind && intent.targets.includes(selection.index) && (
            <g className="board__preview-ghost" data-testid="board-preview-ghost" aria-hidden="true" pointerEvents="none">
              {intent.kind === 'vertex' && geometry.vertices[selection.index] && <BoardBuilding x={geometry.vertices[selection.index]!.x} y={geometry.vertices[selection.index]!.y} city={intent.commandType === 'build.city'} color={selfColor} />}
              {intent.kind === 'edge' && geometry.edges[selection.index] && (isShipCommand(intent.commandType)
                ? <ShipPiece {...edgeMidpoint(geometry.edges[selection.index]!)} angle={edgeAngle(geometry.edges[selection.index]!)} color={selfColor} ghost />
                : <line {...inset(geometry.edges[selection.index]!)} stroke={selfColor} strokeWidth={10} strokeDasharray="8 5" strokeLinecap="round" />)}
              {intent.kind === 'hex' && geometry.hexes[selection.index] && (geometry.land[selection.index] === false
                ? <PirateShip x={geometry.hexes[selection.index]!.cx} y={geometry.hexes[selection.index]!.cy + 4} ghost />
                : <RobberPiece {...robberSpot(geometry.hexes[selection.index]!, board.numbers[selection.index] != null)} ids={ids} />)}
            </g>
          )}
        </g>
        {/* 定義放在相機群組之後：第一個 <g> 永遠是平移縮放的容器。 */}
        <BoardArtDefs ids={ids} />
      </svg>
  );
}
