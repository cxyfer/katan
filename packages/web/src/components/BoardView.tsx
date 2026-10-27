import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
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
import { GameIcon, TerrainIllustration } from './GameArt.tsx';

const BOARD_SCALE = 100;
const BASE_TOPOLOGY = 'hex-r2';
/** Ambiguity threshold in screen pixels; divided by zoom to get user units. */
const AMBIGUITY_PX = 30;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 3;

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
  const boardRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cluster, setCluster] = useState<number[] | null>(null);
  const [diceRolling, setDiceRolling] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const lastDiceEventRef = useRef<number | null>(null);
  const diceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const topologyId = view?.board.topologyId ?? BASE_TOPOLOGY;
  const geometry: BoardGeometry = useMemo(() => buildGeometry(topologyId, BOARD_SCALE), [topologyId]);
  const topology = geometry.topology;
  const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] = geometry.viewBox.split(/\s+/).map(Number);
  const viewBoxCenter = {
    x: viewBoxX + viewBoxWidth / 2,
    y: viewBoxY + viewBoxHeight / 2,
  };
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

  useEffect(() => {
    const rolled = view?.events.slice().reverse().find((event) => event.type === 'turn.rolled');
    if (!rolled || rolled.seq === lastDiceEventRef.current) return;
    lastDiceEventRef.current = rolled.seq;
    setDiceRolling(true);
    if (diceTimerRef.current !== null) globalThis.clearTimeout(diceTimerRef.current);
    diceTimerRef.current = globalThis.setTimeout(() => {
      diceTimerRef.current = null;
      setDiceRolling(false);
    }, 900);
  }, [view?.events]);

  useEffect(() => () => {
    if (diceTimerRef.current !== null) globalThis.clearTimeout(diceTimerRef.current);
  }, []);

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

  const clampPan = useCallback(
    (next: Point, nextZoom = zoom): Point => {
      const maxX = geometry.width * Math.max(nextZoom - 1, 0) * 0.5;
      const maxY = geometry.height * Math.max(nextZoom - 1, 0) * 0.5;
      return {
        x: Math.max(-maxX, Math.min(maxX, next.x)),
        y: Math.max(-maxY, Math.min(maxY, next.y)),
      };
    },
    [geometry.height, geometry.width, zoom],
  );

  const setBoardZoom = useCallback(
    (nextZoom: number) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
      setZoom(clamped);
      setPan((current) => clampPan(current, clamped));
    },
    [clampPan],
  );

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
    if (!drag.moved) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const unitsPerPixel = rect && rect.width > 0 ? geometry.width / rect.width : 1;
    setPan(clampPan({ x: drag.panX + dx * unitsPerPixel, y: drag.panY + dy * unitsPerPixel }));
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) {
      // The gesture was a pan: the click that follows must not place a piece.
      suppressClickRef.current = true;
    }
  };

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    setBoardZoom(zoom * (event.deltaY < 0 ? 1.12 : 0.89));
  };

  const onBoardKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setBoardZoom(zoom * 1.25);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      setBoardZoom(zoom / 1.25);
    } else if (event.key === '0') {
      event.preventDefault();
      resetView();
    }
  };

  /**
   * Sizes the board so the whole map fits between its own top edge and the
   * bottom of the viewport. The control is labelled "Fit board", so it must
   * actually fit rather than only resetting pan and zoom (SPEC U-01: board
   * panning is deliberate, not accidental whole-page overflow).
   */
  const fitBoard = useCallback(() => {
    const node = boardRef.current;
    // Measure the SVG itself: the toolbar sits above it, so the container's top
    // would overstate the space actually available to the map.
    const svg = svgRef.current ?? node;
    if (!node || !svg) return;
    const top = svg.getBoundingClientRect().top;
    const viewport = globalThis.innerHeight || 0;
    const available = Math.max(240, Math.round(viewport - top - 16));
    node.style.setProperty('--board-available', `${available}px`);
  }, []);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    fitBoard();
  };

  // Keep the board fitted while the viewport changes (rotation, zoom, resize).
  useEffect(() => {
    if (!view) return;
    fitBoard();
    const onResize = () => fitBoard();
    globalThis.addEventListener('resize', onResize);
    return () => globalThis.removeEventListener('resize', onResize);
  }, [fitBoard, view]);

  if (!view) {
    return (
      <p className="muted" data-testid="board-missing">
        {t('app.loading')}
      </p>
    );
  }

  const board = view.board;
  const selectedIndex = state.selection.index;
  const setup = view.turn.setup;
  const setupActor = setup ? view.players.find((player) => player.seat === setup.seat) : undefined;
  const setupPiece = setup?.stage === 'building' ? t('play.build.settlement') : t('play.build.road');
  const setupMine = setupActor?.id === selfId;

  return (
    <div className="board" data-testid="board" data-zoom={zoom} ref={boardRef}>
      {setup && (
        <section className={`board__setup-guide${setupMine ? ' board__setup-guide--mine' : ''}`} data-testid="setup-guide" aria-live="polite">
          <div className="board__setup-title">
            <GameIcon name={setup.stage === 'building' ? 'home' : 'flag'} size={20} />
            <strong>{setupMine ? t('board.setupPlace', { piece: setupPiece }) : t('board.setupWaiting', { player: setupActor?.nickname ?? '—', piece: setupPiece })}</strong>
          </div>
          <span>{t('board.setupGuide', { round: setup.round })}</span>
          <span>{t('board.setupProgress', { remaining: setup.remaining })}</span>
          {setupMine && <p>{t('board.setupPickTarget')}</p>}
        </section>
      )}
      <div className="board__toolbar" role="group" aria-label={t('board.heading')}>
        <span className="board__heading"><GameIcon name="compass" size={18} />{t('board.heading')}</span>
        <button
          type="button"
          className="button button--ghost"
          data-testid="zoom-in"
          onClick={() => setBoardZoom(zoom * 1.25)}
        >
          {t('board.zoomIn')}
        </button>
        <button
          type="button"
          className="button button--ghost"
          data-testid="zoom-out"
          onClick={() => setBoardZoom(zoom / 1.25)}
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
        <span className="board__zoom-readout" data-testid="zoom-readout">{t('board.zoomLevel', { percent: Math.round(zoom * 100) })}</span>
        {view.turn.dice && (
          <span className={`board__dice${diceRolling ? ' board__dice--rolling' : ''}`} role="img" aria-label={`${t('play.dice')}: ${view.turn.dice.join(' + ')}`} data-testid="dice-roll-animation">
            {view.turn.dice.map((value, index) => <span className="board__die" key={index} aria-hidden="true">{value}</span>)}
            <span className="visually-hidden">{t('play.diceResult', { first: view.turn.dice[0], second: view.turn.dice[1], total: view.turn.dice[0] + view.turn.dice[1] })}</span>
          </span>
        )}
      </div>

      <svg
        ref={svgRef}
        className="board__svg"
        data-testid="board-svg"
        role="img"
        aria-label={t('a11y.boardRegion')}
         tabIndex={0}
        viewBox={geometry.viewBox}
        preserveAspectRatio="xMidYMid meet"
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
         onWheel={onWheel}
         onKeyDown={onBoardKeyDown}
      >
        <g transform={`translate(${viewBoxCenter.x + pan.x} ${viewBoxCenter.y + pan.y}) scale(${zoom}) translate(${-viewBoxCenter.x} ${-viewBoxCenter.y})`}>
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
                  <path
                    d={`M${vertex.x - 13} ${vertex.y + 9}v-17l7-7 7 7v7l9-6 9 6v10Z`}
                    fill={color}
                    stroke="#21343a"
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                ) : (
                  <path
                    d={`M${vertex.x - 10} ${vertex.y + 9}v-13l10-9 10 9v13Z`}
                    fill={color}
                    stroke="#21343a"
                    strokeWidth={2}
                    strokeLinejoin="round"
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
