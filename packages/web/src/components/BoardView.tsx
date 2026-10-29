import { Component, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n/context.tsx';
import { buildGeometry } from '../board/geometry.ts';
import { boardIntent } from '../board/intent.ts';
import type { TargetKind } from '../board/targets.ts';
import { parseViewBox } from '../board/viewport.ts';
import { targetsFromGeometry } from '../board/projection.ts';
import { useBoardAnimation } from '../board/useBoardAnimation.ts';
import { MAX_CAMERA_ELEVATION, MIN_CAMERA_ELEVATION, useBoardViewport } from '../board/useBoardViewport.ts';
import { rendererMode, qualityMode, type RendererMode, type ProjectionSnapshot, type BoardEffectAnchors, type CssRect } from '../board/render-contract.ts';
import { sceneBounds } from '../board/three/bounds.ts';
import { nameOf } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { TargetPicker } from './TargetPicker.tsx';
import { BoardTargetOverlay } from './BoardTargetOverlay.tsx';
import { BoardEffects } from './BoardEffects.tsx';
import { DicePresentation } from './DicePresentation.tsx';
import { Legend } from './Legend.tsx';
import { GameIcon } from './GameArt.tsx';
import { SvgBoard } from './SvgBoard.tsx';
import { BoardInspectionLayer, BoardInspectionPanel } from './BoardInspection.tsx';
import { inspectionElements, type BoardInspection } from '../board/inspection.ts';
import '../styles/board-camera-controls.css';

class SceneBoundary extends Component<{ children: ReactNode; onUnavailable: (reason: string) => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch() { this.props.onUnavailable('scene-error'); }
  override render() { return this.state.failed ? null : this.props.children; }
}

function cssRect(element: Element): CssRect {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}

/** One controller, selection, gesture surface and event cursor across renderers. */
export function BoardView({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const view = state.game?.view ?? null;
  const boardRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inspection, setInspection] = useState<BoardInspection | null>(null);
  const [cluster, setCluster] = useState<number[] | null>(null);
  const [requested, setRequested] = useState<RendererMode>(() => {
    const query = new URLSearchParams(globalThis.location.search);
    return rendererMode(query.get('renderer'));
  });
  const [quality, setQuality] = useState(() => qualityMode(new URLSearchParams(globalThis.location.search).get('quality')));
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [projection, setProjection] = useState<ProjectionSnapshot | null>(null);
  const [effective, setEffective] = useState<'svg' | 'r3f'>('svg');
  const Scene = useMemo(() => lazy(() => import('../board/three/BoardScene3D.tsx')), [attempt]);
  const animation = useBoardAnimation(state.game, state.gameSync, state.connection === 'online',
    !!view?.pending || !!view?.turn.setup || view?.turn.phase === 'preroll');
  const geometry = useMemo(() => buildGeometry(view?.board.topologyId ?? 'hex-r2'), [view?.board.topologyId]);
  const bounds = useMemo(() => sceneBounds(geometry), [geometry]);
  const controls = useBoardViewport({ geometry, surfaceRef, bounds, projection, renderer: effective,
    sceneKey: `${state.game?.gameId ?? 'none'}:${!!view}` });
  const { zoom } = controls.viewport;
  const selfId = state.session?.id ?? null;
  const nameResolver = useMemo(() => nameOf(state), [state]);
  const intent = useMemo(() => boardIntent(state, selfId), [state, selfId]);
  const targets = useMemo(() => controls.projectedTargets(intent), [controls.projectedTargets, intent]);
  const hexTargets = useMemo(() => controls.projectedTargets({ kind: 'hex', commandType: '', labelId: '', fromHints: false, targets: geometry.hexes.map((hex) => hex.index) }), [controls.projectedTargets, geometry]);
  const viewBox = useMemo(() => parseViewBox(geometry.viewBox), [geometry]);
  const viewBoxCenter = { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 };
  const [anchors, setAnchors] = useState<BoardEffectAnchors | null>(null);
  const stage = boardRef.current?.closest<HTMLElement>('[data-board-stage]') ?? boardRef.current;

  useLayoutEffect(() => {
    if (!stage || !animation.active) return;
    const measure = () => {
      const seats = new Map<string, CssRect>();
      stage.querySelectorAll<HTMLElement>('[data-board-seat]').forEach((node) => {
        if (node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden') {
          seats.set(node.dataset.boardSeat!, cssRect(node));
        }
      });
      const aggregate = boardRef.current?.querySelector('[data-board-aggregate]');
      setAnchors({ stage: cssRect(stage), seats, aggregate: aggregate ? cssRect(aggregate) : null, targets: hexTargets });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    stage.querySelectorAll('[data-board-seat], [data-board-aggregate]').forEach((node) => observer.observe(node));
    globalThis.addEventListener('resize', measure);
    globalThis.addEventListener('scroll', measure, true);
    return () => { observer.disconnect(); globalThis.removeEventListener('resize', measure); globalThis.removeEventListener('scroll', measure, true); };
  }, [stage, animation.active, hexTargets]);

  useLayoutEffect(() => {
    const next = requested !== 'svg' && !failure && ready && !controls.gestureActive ? 'r3f' : 'svg';
    // A pending pointer keeps its projection until pointerup/cancel.
    if (controls.gestureActive && !failure && requested !== 'svg') return;
    if (next !== effective) { animation.resetPresentation(); setEffective(next); }
  }, [requested, failure, ready, controls.gestureActive, effective, animation.resetPresentation]);

  const unavailable = useCallback((reason: string) => {
    animation.resetPresentation();
    setFailure(reason);
    setReady(false);
    setEffective('svg');
    setProjection(null);
  }, [animation.resetPresentation]);
  const sceneReady = useCallback(() => setReady(true), []);
  const changeRenderer = (mode: RendererMode) => {
    animation.resetPresentation();
    setRequested(mode); setReady(false); setFailure(null); setEffective('svg'); setProjection(null); setAttempt((value) => value + 1);
  };
  const inspect = useCallback((target: BoardInspection) => {
    if (!view) return;
    const element = inspectionElements(geometry, view.board, effective)
      .find((candidate) => candidate.kind === target.kind && candidate.index === target.index);
    const anchor = element ?? (target.kind === 'harbor' ? null :
      targetsFromGeometry(geometry, target.kind, [target.index])[0]);
    if (!anchor) return;
    setInspection(target);
    controls.focus(anchor.world);
  }, [controls.focus, effective, geometry, view]);
  useEffect(() => { setInspection(null); }, [state.game?.gameId, geometry.topologyId]);

  const selectTarget = useCallback((kind: TargetKind, index: number) => {
    if (!intent || kind !== intent.kind || !intent.targets.includes(index)) return;
    setCluster(null); setPickerOpen(false);
    inspect({ kind, index });
    actions.selectTarget({ kind, index, commandType: intent.commandType, labelId: intent.labelId });
  }, [actions, intent, inspect]);
  const focusedRoll = animation.activeDice;
  useEffect(() => { if (!intent) { setPickerOpen(false); setCluster(null); } }, [intent]);

  if (!view) return <p className="muted" data-testid="board-missing">{t('app.loading')}</p>;
  const board = view.board;
  const topology = geometry.topology;
  const setup = view.turn.setup;
  const setupActor = setup ? view.players.find((player) => player.seat === setup.seat) : undefined;
  const setupPiece = setup?.stage === 'building' ? t('play.build.settlement') : t('play.build.road');
  const setupMine = setupActor?.id === selfId;
  const selection = intent && state.connection === 'online' && selfId && state.selection.kind === intent.kind && state.selection.index !== null && intent.targets.includes(state.selection.index)
    ? { kind: intent.kind, index: state.selection.index, playerId: selfId } : null;

  return (
    <div className="board" data-testid="board" data-zoom={zoom} data-camera-azimuth={controls.viewport.azimuthDeg}
      data-camera-elevation={controls.viewport.elevationDeg} ref={boardRef}
      data-requested-renderer={requested} data-effective-renderer={effective} data-quality={quality}
      data-renderer-status={failure ? 'failed' : requested === 'svg' ? 'idle' : effective === 'r3f' ? 'ready' : 'loading'} data-fallback-reason={failure ?? undefined}>
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
        <span className="board__heading" data-board-aggregate=""><GameIcon name="compass" size={18} />{t('board.heading')}</span>
        <button
          type="button"
          className="button button--ghost"
          data-testid="zoom-in"
          onClick={() => controls.setZoom(zoom * 1.25)}
        >
          {t('board.zoomIn')}
        </button>
        <button
          type="button"
          className="button button--ghost"
          data-testid="zoom-out"
          onClick={() => controls.setZoom(zoom / 1.25)}
        >
          {t('board.zoomOut')}
        </button>
        {effective === 'r3f' && <>
          <button type="button" className="button button--ghost" data-testid="rotate-left"
            aria-keyshortcuts="[" title={t('board.rotateLeftHint')} disabled={controls.gestureActive}
            onClick={() => controls.rotate(-30)}>{t('board.rotateLeft')}</button>
          <button type="button" className="button button--ghost" data-testid="rotate-right"
            aria-keyshortcuts="]" title={t('board.rotateRightHint')} disabled={controls.gestureActive}
            onClick={() => controls.rotate(30)}>{t('board.rotateRight')}</button>
          <label className="board-camera-angle">
            <span>{t('board.viewingAngle')}</span>
            <input type="range" min={MIN_CAMERA_ELEVATION} max={MAX_CAMERA_ELEVATION} step={1}
              data-testid="camera-elevation" value={controls.viewport.elevationDeg}
              aria-label={t('board.viewingAngle')} aria-valuetext={t('board.viewingAngleDegrees', { degrees: Math.round(controls.viewport.elevationDeg ?? 50) })}
              disabled={controls.gestureActive} onChange={(event) => controls.setElevation(Number(event.target.value))} />
            <output>{Math.round(controls.viewport.elevationDeg ?? 50)}°</output>
          </label>
        </>}
        <button
          type="button"
          className="button button--ghost"
          data-testid="reset-view"
          onClick={() => { controls.fit(); setInspection(null); }}
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
          <span className="board__dice" data-presenting={focusedRoll ? 'true' : undefined} aria-hidden={focusedRoll ? true : undefined} role="img" aria-label={`${t('play.dice')}: ${view.turn.dice.join(' + ')}`} data-testid="dice-roll-animation">
            {view.turn.dice.map((value, index) => <span className="board__die" key={index} aria-hidden="true">{value}</span>)}
            <span className="visually-hidden">{t('play.diceResult', { first: view.turn.dice[0], second: view.turn.dice[1], total: view.turn.dice[0] + view.turn.dice[1] })}</span>
          </span>
        )}
        <details className="board__display-settings">
          <summary>{t('board.rendererSettings')}</summary>
          <label>{t('board.renderer')}<select data-testid="renderer-select" value={requested} onChange={(event) => changeRenderer(rendererMode(event.target.value))}>
            <option value="svg">{t('board.rendererSvg')}</option><option value="r3f">{t('board.renderer3d')}</option><option value="auto">{t('board.rendererAuto')}</option>
          </select></label>
          <label>{t('board.quality')}<select data-testid="quality-select" value={quality} onChange={(event) => setQuality(qualityMode(event.target.value))}>
            <option value="standard">{t('board.qualityStandard')}</option><option value="low">{t('board.qualityLow')}</option>
          </select></label>
          <p role="status" data-testid="renderer-status">{failure ? t('board.rendererFailed') : requested === 'svg' ? t('board.rendererSvg') : effective === 'r3f' ? t('board.rendererReady') : t('board.rendererLoading')}</p>
          {failure && <button type="button" data-testid="renderer-retry" onClick={() => changeRenderer(requested)}>{t('board.rendererRetry')}</button>}
        </details>
      </div>

      {effective === 'r3f' && <p className="board-camera-hint" data-testid="camera-gesture-hint">{t('board.cameraGestureHint')}</p>}

      {focusedRoll && createPortal(
        <DicePresentation key={focusedRoll.id} dice={focusedRoll.dice} />,
        document.fullscreenElement ?? document.body,
      )}
      <div ref={surfaceRef} className="board__surface" data-testid="board-surface" role="region"
        aria-label={t(effective === 'r3f' ? 'a11y.boardRegion3d' : 'a11y.boardRegion')} tabIndex={0} {...controls.surfaceProps}>
        {requested !== 'svg' && !failure && <div className="board__scene" aria-hidden="true" style={{ opacity: effective === 'r3f' ? 1 : 0 }}>
          <SceneBoundary key={attempt} onUnavailable={unavailable}><Suspense fallback={null}>
            <Scene geometry={geometry} board={board} players={view.players.map(({ id, seat, color }) => ({ id, seat, color }))}
              intent={intent} selection={selection} active={animation.active} viewport={controls.viewport} quality={quality}
              motionAllowed={animation.active !== null} onProjection={setProjection} onReady={sceneReady} onUnavailable={unavailable} />
          </Suspense></SceneBoundary>
        </div>}
        {effective === 'svg' && <SvgBoard svgRef={svgRef} geometry={geometry} view={view} active={animation.active}
          selection={selection ? state.selection : { ...state.selection, index: null }} selfId={selfId} intent={intent}
          pan={controls.pan} zoom={zoom} viewBoxCenter={viewBoxCenter} nameResolver={nameResolver} />}
        <BoardInspectionLayer geometry={geometry} board={board} renderer={effective} controls={controls}
          nameOf={nameResolver} selected={inspection} onInspect={inspect} onClose={() => setInspection(null)} fallbackFocusRef={surfaceRef} />
        <BoardTargetOverlay targets={targets} rect={controls.viewport.rect} selection={selection} board={board} topology={topology} nameOf={nameResolver}
          renderer={effective} onSelect={selectTarget} consumeSuppressedClick={controls.consumeSuppressedClick}
          fallbackFocusRef={surfaceRef} onCancel={actions.cancelSelection}
          onAmbiguous={(_kind, _index, candidates) => { setCluster([...candidates]); setPickerOpen(true); }} />
      </div>
      {stage && animation.active && anchors && createPortal(<BoardEffects group={animation.active} geometry={geometry} view={view} anchors={anchors} />, stage)}
      <BoardInspectionPanel geometry={geometry} board={board} renderer={effective} controls={controls}
        nameOf={nameResolver} selected={inspection} onInspect={inspect} onClose={() => setInspection(null)} fallbackFocusRef={surfaceRef} />
      <Legend />
      {pickerOpen && intent && <TargetPicker geometry={geometry} board={board} topology={topology} kind={intent.kind}
        targets={intent.targets} nameOf={nameResolver} {...(cluster ? { ambiguousOnly: cluster } : {})}
        onCancel={() => { setPickerOpen(false); setCluster(null); }}
        onChoose={(index) => selectTarget(intent.kind, index)} />}
    </div>
  );
}
