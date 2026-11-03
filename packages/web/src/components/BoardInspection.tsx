import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { PublicBoardView } from '@catan/rules';
import type { BoardGeometry } from '../board/geometry.ts';
import type { BoardViewportControls } from '../board/useBoardViewport.ts';
import type { ProjectedAnchor } from '../board/render-contract.ts';
import { inspectDescription, inspectionElements, type BoardInspection as Inspection } from '../board/inspection.ts';
import { screenConvexHull } from '../board/harbor.ts';
import { useLocale, useT } from '../i18n/context.tsx';
import '../styles/board-inspection.css';

interface Props {
  geometry: BoardGeometry;
  board: PublicBoardView;
  renderer: 'svg' | 'r3f';
  controls: BoardViewportControls;
  nameOf: (id: string) => string;
  fallbackFocusRef: RefObject<HTMLElement | null>;
  /** Explorers & Pirates fog (hex → region), if any. */
  fog?: ReadonlyMap<number, 'parrot' | 'goose'>;
}

export const INSPECTION_DELAY_MS = 1000;

/** Keep dense fitted maps selectable without letting piece padding cover tile centers. */
export function inspectionHitSize(outlines: readonly (readonly ProjectedAnchor[])[]): number {
  const spans = outlines.flatMap((points) => {
    if (!points.length || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return [];
    const width = Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x));
    const height = Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y));
    return width > 0 && height > 0 ? [Math.min(width, height)] : [];
  });
  return spans.length ? Math.max(18, Math.min(44, Math.min(...spans) * 0.6)) : 44;
}

/** Inspection sits below legal targets; both use the same camera projection. */
export function BoardInspectionLayer({ geometry, board, renderer, controls, nameOf, fallbackFocusRef, fog }: Props) {
  const locale = useLocale();
  const t = useT();
  const elements = useMemo(() => inspectionElements(geometry, board, renderer), [geometry, board, renderer]);
  const context = { locale, board, topology: geometry.topology, nameOf, fog };
  const rect = controls.viewport.rect;
  const hitSize = inspectionHitSize(elements.filter((element) => element.kind === 'hex')
    .map((element) => element.outline!.map(controls.projectPoint)));
  const layerRef = useRef<SVGSVGElement | null>(null);
  const focusedRef = useRef<string | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerFocus = useRef(false);
  const [hovered, setHovered] = useState<{ target: Inspection; node: Element } | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const tooltipId = useId();
  const clearTimers = () => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    openTimer.current = closeTimer.current = null;
  };
  const dismiss = () => { clearTimers(); setHovered(null); };
  const scheduleClose = () => {
    clearTimers();
    closeTimer.current = setTimeout(() => setHovered(null), 160);
  };

  // 同時涵蓋檢視命中層與上方的合法操作目標，不改變選取或相機。
  useEffect(() => {
    const surface = layerRef.current?.parentElement;
    if (!surface) return;
    dismiss();
    const targetNode = (target: EventTarget | null) => target instanceof Element
      ? target.closest('[data-inspection-kind], [data-target-kind]') : null;
    const enter = (event: PointerEvent | FocusEvent) => {
      if (controls.gestureActive || ('pointerType' in event && (event.pointerType === 'touch' || event.buttons))) return;
      if (event.type === 'focusin' && pointerFocus.current) return;
      const node = targetNode(event.target);
      if (!node || node.contains(event.relatedTarget as Node | null)) return;
      const kind = node.getAttribute('data-inspection-kind') ?? node.getAttribute('data-target-kind');
      const index = Number(node.getAttribute('data-inspection-index') ?? node.getAttribute('data-target-index'));
      if (!kind || !Number.isInteger(index)) return;
      dismiss();
      openTimer.current = setTimeout(() => {
        if (node.isConnected) setHovered({ target: { kind: kind as Inspection['kind'], index }, node });
      }, INSPECTION_DELAY_MS);
    };
    const leave = (event: PointerEvent | FocusEvent) => {
      const node = targetNode(event.target);
      if (!node || node.contains(event.relatedTarget as Node | null)) return;
      if (event.type === 'focusout') dismiss();
      else scheduleClose();
    };
    const press = () => { pointerFocus.current = true; dismiss(); };
    const keyboard = (event: KeyboardEvent) => {
      pointerFocus.current = false;
      if (event.key === 'Escape') dismiss();
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !popupRef.current?.contains(event.target)) dismiss();
    };
    const leaveBoard = (event: FocusEvent | PointerEvent) => {
      if (event.target instanceof Node && !surface.contains(event.target) && !popupRef.current?.contains(event.target)) dismiss();
    };
    surface.addEventListener('pointerover', enter);
    surface.addEventListener('pointerout', leave);
    surface.addEventListener('focusin', enter);
    surface.addEventListener('focusout', leave);
    surface.addEventListener('pointerdown', press);
    surface.addEventListener('pointercancel', dismiss);
    surface.addEventListener('wheel', dismiss);
    document.addEventListener('keydown', keyboard);
    document.addEventListener('focusin', leaveBoard);
    document.addEventListener('pointerdown', leaveBoard);
    globalThis.addEventListener('resize', dismiss);
    globalThis.addEventListener('scroll', scroll, true);
    return () => {
      clearTimers();
      surface.removeEventListener('pointerover', enter);
      surface.removeEventListener('pointerout', leave);
      surface.removeEventListener('focusin', enter);
      surface.removeEventListener('focusout', leave);
      surface.removeEventListener('pointerdown', press);
      surface.removeEventListener('pointercancel', dismiss);
      surface.removeEventListener('wheel', dismiss);
      document.removeEventListener('keydown', keyboard);
      document.removeEventListener('focusin', leaveBoard);
      document.removeEventListener('pointerdown', leaveBoard);
      globalThis.removeEventListener('resize', dismiss);
      globalThis.removeEventListener('scroll', scroll, true);
    };
  }, [controls.viewport, controls.gestureActive]);

  useEffect(() => {
    if (!hovered || hovered.node.getAttribute('aria-hidden') === 'true') return;
    hovered.node.setAttribute('aria-describedby', tooltipId);
    return () => hovered.node.removeAttribute('aria-describedby');
  }, [hovered, tooltipId]);

  const description = hovered ? inspectDescription(context, hovered.target) : null;
  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!hovered || !popup) return;
    if (!hovered.node.isConnected) { dismiss(); return; }
    const anchor = hovered.node.getBoundingClientRect();
    const box = popup.getBoundingClientRect();
    let left = anchor.right + 12;
    let top = anchor.top + anchor.height / 2 - box.height / 2;
    if (left + box.width > innerWidth - 8) {
      left = anchor.left - box.width - 12;
      if (left < 8) {
        left = anchor.left + (anchor.width - box.width) / 2;
        top = anchor.bottom + 12 + box.height <= innerHeight - 8
          ? anchor.bottom + 12 : anchor.top - box.height - 12;
      }
    }
    setPosition({
      left: Math.max(8, Math.min(left, innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(top, innerHeight - box.height - 8)),
    });
  }, [hovered, board, locale]);
  useEffect(() => {
    if (hovered && !hovered.node.isConnected) dismiss();
    if (focusedRef.current && !layerRef.current?.querySelector(`[data-testid="${focusedRef.current}"]`)) {
      focusedRef.current = null;
      // A later focus move may have happened after the node was detached.
      const active = document.activeElement;
      if (!active || active === document.body || layerRef.current?.contains(active)) {
        fallbackFocusRef.current?.focus();
      }
    }
  });
  return <><svg ref={layerRef} className="board-inspect-layer" data-testid="board-inspect-layer" width={rect.width} height={rect.height}
    aria-label={t('board.inspectMap')} role="group" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) focusedRef.current = null;
    }}>
    {elements.map((element) => {
      const anchor = controls.projectPoint(element.world);
      const outline = element.outline?.map(controls.projectPoint);
      const hull = element.hull?.map(controls.projectPoint);
      const projected = outline ?? hull;
      if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || (!anchor.visible && !projected?.some((point) => point.visible))) return null;
      // A square around a vertex must end before its incident road midpoints.
      // 0.6 leaves space even when a road runs diagonally across the square.
      const incidentLengths = element.kind === 'vertex' ? geometry.topology.vertices[element.index]!.edges.flatMap((index) => {
        const edge = geometry.edges[index]!;
        const a = controls.projectPoint({ x: edge.x1 / geometry.scale, y: 0, z: edge.y1 / geometry.scale });
        const b = controls.projectPoint({ x: edge.x2 / geometry.scale, y: 0, z: edge.y2 / geometry.scale });
        const length = Math.hypot(a.x - b.x, a.y - b.y);
        return Number.isFinite(length) && length > 0 ? [length] : [];
      }) : [];
      const pieceHitSize = incidentLengths.length ? Math.min(hitSize, Math.min(...incidentLengths) * 0.6) : hitSize;
      const halfHit = pieceHitSize / 2;
      const option = inspectDescription(context, element);
      const pointerOnly = element.pointerOnly === true;
      const testId = `inspect-${element.kind}-${element.index}${pointerOnly ? '-footprint' : ''}`;
      const probe = element.probe ? controls.projectPoint(element.probe) : null;
      const probeAttribute = probe && Number.isFinite(probe.x) && Number.isFinite(probe.y)
        ? `${probe.x},${probe.y}` : undefined;
      const shared = {
        'data-inspection-kind': element.kind, 'data-inspection-index': element.index,
        'data-hit-size': pieceHitSize, 'data-testid': testId, className: 'board-inspect-hit',
        ...(pointerOnly
          ? { 'aria-hidden': 'true' as const, tabIndex: -1, 'data-harbor-probe': probeAttribute }
          : { role: 'img', tabIndex: 0, 'aria-label': `${option.title} ${option.detail}`,
              onFocus: () => { focusedRef.current = testId; } }),
      };
      const polygonTarget = (key: string, corners: readonly { x: number; y: number }[]) => (
        <polygon key={key} {...shared}
          points={corners.map((point) => `${point.x - rect.left},${point.y - rect.top}`).join(' ')} />
      );
      if (element.kind === 'harbor' && hull) {
        const corners = screenConvexHull(hull);
        return corners.length >= 3 ? polygonTarget(`harbor-${element.index}-footprint`, corners) : null;
      }
      if (element.kind === 'hex' && outline) return polygonTarget(`hex-${element.index}`, outline);
      if (element.kind === 'edge' && outline) return <line key={`edge-${element.index}`} {...shared}
        x1={outline[0]!.x - rect.left} y1={outline[0]!.y - rect.top}
        x2={outline[1]!.x - rect.left} y2={outline[1]!.y - rect.top} strokeWidth={hitSize} style={{ strokeWidth: hitSize }} />;
      const top = element.top ? controls.projectPoint(element.top) : anchor;
      return <rect key={`${element.kind}-${element.index}`} {...shared} rx={10}
        x={Math.min(anchor.x, top.x) - rect.left - halfHit} y={Math.min(anchor.y, top.y) - rect.top - halfHit}
        width={Math.abs(anchor.x - top.x) + pieceHitSize} height={Math.abs(anchor.y - top.y) + pieceHitSize} />;
    })}
  </svg>
    {hovered && description && createPortal(
      <div ref={popupRef} id={tooltipId} role="tooltip" className="board-inspection-tooltip" data-testid="inspection-detail"
        style={position} onPointerEnter={clearTimers} onPointerLeave={scheduleClose}>
        <h3>{description.title}</h3>
        <p>{description.detail}</p>
        <ul>{description.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
        {description.relatedHexes.length > 0 && <p>{t('board.inspectRelated')}: {description.relatedHexes.map((index) => t('board.hex', { index })).join(', ')}</p>}
      </div>, document.fullscreenElement ?? document.body,
    )}
  </>;
}
