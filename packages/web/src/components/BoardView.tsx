import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useLocale, useT } from '../i18n/context.tsx';
import { buildGeometry, type BoardGeometry, type Point } from '../board/geometry.ts';
import { boardIntent, type BoardIntent } from '../board/intent.ts';
import { ambiguousWith, describeTarget, type TargetKind } from '../board/targets.ts';
import {
  pipsFor,
  playerColorHex,
  resourceLetter,
  seatDash,
  terrainFill,
  terrainLetter,
  terrainSymbol,
} from '../board/terrain.ts';
import { nameOf } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { TargetPicker } from './TargetPicker.tsx';
import { Legend } from './Legend.tsx';

const BOARD_SCALE = 100;
const BASE_TOPOLOGY = 'hex-r2';
/** Ambiguity threshold in screen pixels; divided by zoom to get user units. */
const AMBIGUITY_PX = 30;

interface DragState {
  startX: number;
  startY: number;
  panX: number;
  panY: number;
  moved: boolean;
}

/**
 * SVG board rendered from `GameView.board` (docs/SPEC.md §8.1/§8.2).
 *
 * Two behaviours are load-bearing and tested:
 * - pan/zoom never commits a placement (a drag marks the next click as
 *   suppressed);
 * - nearby legal targets are resolved through a candidate list instead of
 *   guessing which one the pointer meant.
 */
export function BoardView({ controller }: { controller: TableController }) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const view = state.game?.view ?? null;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cluster, setCluster] = useState<number[] | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  const topologyId = view?.board.topologyId ?? BASE_TOPOLOGY;
  const geometry: BoardGeometry = useMemo(() => buildGeometry(topologyId, BOARD_SCALE), [topologyId]);
  const topology = geometry.topology;
  const selfId = state.session?.id ?? null;
  const nameResolver = useMemo(() => nameOf(state), [state]);
  const intent: BoardIntent | null = useMemo(
    () => boardIntent(state, selfId),
    [state, selfId],
  );

  const points = useMemo(() => {
    const map = new Map<number, Point>();
    if (!intent) return map;
    if (intent.kind === 'vertex') {
      for (const vertex of geometry.vertices) map.set(vertex.index, { x: vertex.x, y: vertex.y });
    } else if (intent.kind === 'edge') {
      for (const edge of geometry.edges) {
        map.set(edge.index, { x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2 });
      }
    } else {
      for (const hex of geometry.hexes) map.set(hex.index, { x: hex.cx, y: hex.cy });
    }
    return map;
  }, [geometry, intent]);

  const minDistance = AMBIGUITY_PX / Math.max(zoom, 0.2);

  const choose = useCallback(
    (kind: TargetKind, index: number) => {
      if (!intent) return;
      const near = ambiguousWith(index, intent.targets, points, minDistance);
      if (near && near.length > 1) {
        setCluster(near);
        setPickerOpen(true);
        return;
      }
      setCluster(null);
      actions.selectTarget({
        kind,
        index,
        commandType: intent.commandType,
        labelId: intent.labelId,
      });
    },
    [actions, intent, minDistance, points],
  );

  const handleTargetClick = useCallback(
    (kind: TargetKind, index: number) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      choose(kind, index);
    },
    [choose],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<SVGElement>, kind: TargetKind, index: number) => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        choose(kind, index);
      }
    },
    [choose],
  );

  // --- pan/zoom -----------------------------------------------------------

  const onPointerDown = (event: ReactMouseEvent<SVGSVGElement>) => {
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    };
  };

  const onPointerMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) setPan({ x: drag.panX + dx, y: drag.panY + dy });
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) {
      // The gesture was a pan: the click that follows must not place a piece.
      suppressClickRef.current = true;
    }
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  if (!view) {
    return (
      <p className="muted" data-testid="board-missing">
        {t('app.loading')}
      </p>
    );
  }

  const board = view.board;
  const selectedIndex = state.selection.index;

  return (
    <div className="board" data-testid="board">
      <div className="board__toolbar" role="group" aria-label={t('board.heading')}>
        <button
          type="button"
          className="button button--ghost"
          data-testid="zoom-in"
          onClick={() => setZoom((value) => Math.min(3, value * 1.25))}
        >
          {t('board.zoomIn')}
        </button>
        <button
          type="button"
          className="button button--ghost"
          data-testid="zoom-out"
          onClick={() => setZoom((value) => Math.max(0.25, value / 1.25))}
        >
          {t('board.zoomOut')}
        </button>
        <button
          type="button"
          className="button button--ghost"
          data-testid="reset-view"
          onClick={resetView}
        >
          {t('board.fitBoard')}
        </button>
        {intent && (
          <button
            type="button"
            className="button"
            data-testid="open-target-picker"
            aria-expanded={pickerOpen}
            onClick={() => {
              setCluster(null);
              setPickerOpen((open) => !open);
            }}
          >
            {t('board.listTargets')}
          </button>
        )}
      </div>

      <svg
        className="board__svg"
        data-testid="board-svg"
        role="img"
        aria-label={t('a11y.boardRegion')}
        viewBox={geometry.viewBox}
        preserveAspectRatio="xMidYMid meet"
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {geometry.hexes.map((hex) => {
            const terrain = board.terrain[hex.index] ?? 'sea';
            const number = board.numbers[hex.index];
            const pips = pipsFor(number ?? null);
            return (
              <g key={`hex-${hex.index}`}>
                <polygon
                  data-testid={`hex-${hex.index}`}
                  points={hex.points}
                  fill={terrainFill(terrain)}
                  stroke="#1b1b1b"
                  strokeWidth={1}
                />
                <text
                  className="board__terrain"
                  x={hex.cx}
                  y={hex.cy - 16}
                  textAnchor="middle"
                  aria-hidden="true"
                >
                  {terrainSymbol(terrain)}
                  {terrainLetter(terrain)}
                </text>
                {number !== null && number !== undefined && (
                  <>
                    <text
                      className="board__number"
                      x={hex.cx}
                      y={hex.cy + 10}
                      textAnchor="middle"
                      aria-hidden="true"
                    >
                      {number}
                    </text>
                    <text
                      className="board__pips"
                      x={hex.cx}
                      y={hex.cy + 26}
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
            return (
              <line
                key={`road-${edge.index}`}
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
            );
          })}

          {geometry.vertices.map((vertex) => {
            const building = board.buildings[vertex.index];
            if (!building) return null;
            const player = view.players.find((candidate) => candidate.id === building.player);
            const color = playerColorHex(player?.color ?? 'white');
            const label = building.city ? t('board.city') : t('board.settlement');
            return (
              <g key={`building-${vertex.index}`} data-testid={`building-${vertex.index}`}>
                {building.city ? (
                  <polygon
                    points={`${vertex.x},${vertex.y - 12} ${vertex.x + 11},${vertex.y + 8} ${vertex.x - 11},${vertex.y + 8}`}
                    fill={color}
                    stroke="#111"
                    strokeWidth={2}
                  />
                ) : (
                  <rect
                    x={vertex.x - 8}
                    y={vertex.y - 8}
                    width={16}
                    height={16}
                    fill={color}
                    stroke="#111"
                    strokeWidth={2}
                  />
                )}
                <title>{`${label} · ${nameResolver(building.player)}`}</title>
              </g>
            );
          })}

          {intent &&
            intent.targets.map((index) => {
              const point = points.get(index);
              if (!point) return null;
              const option = describeTarget(
                { locale, topology, board, nameOf: nameResolver },
                intent.kind,
                index,
              );
              const selected = selectedIndex === index;
              return (
                <circle
                  key={`target-${intent.kind}-${index}`}
                  className={`board__target${selected ? ' board__target--selected' : ''}`}
                  data-testid={`target-${intent.kind}-${index}`}
                  data-target-kind={intent.kind}
                  data-target-index={index}
                  role="button"
                  tabIndex={0}
                  aria-label={`${t('board.legalTarget')}: ${option.label} ${option.detail}`}
                  cx={point.x}
                  cy={point.y}
                  r={intent.kind === 'hex' ? 30 : 12}
                  onClick={() => handleTargetClick(intent.kind, index)}
                  onKeyDown={(event) => handleKeyDown(event, intent.kind, index)}
                >
                  <title>{`${option.label} — ${option.detail}`}</title>
                </circle>
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
        </g>
      </svg>

      <Legend />

      {pickerOpen && intent && (
        <TargetPicker
          geometry={geometry}
          board={board}
          topology={topology}
          kind={intent.kind}
          targets={intent.targets}
          nameOf={nameResolver}
          minDistance={minDistance}
          {...(cluster ? { ambiguousOnly: cluster } : {})}
          onChoose={(index) => {
            setPickerOpen(false);
            setCluster(null);
            choose(intent.kind, index);
          }}
        />
      )}
    </div>
  );
}
