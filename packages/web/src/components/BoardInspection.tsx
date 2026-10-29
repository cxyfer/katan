import { useEffect, useId, useMemo, useRef, type RefObject } from 'react';
import type { PublicBoardView } from '@catan/rules';
import type { BoardGeometry } from '../board/geometry.ts';
import type { BoardViewportControls } from '../board/useBoardViewport.ts';
import type { ProjectedAnchor } from '../board/render-contract.ts';
import { inspectDescription, inspectionElements, type BoardInspection as Inspection } from '../board/inspection.ts';
import { useLocale, useT } from '../i18n/context.tsx';
import '../styles/board-inspection.css';

interface Props {
  geometry: BoardGeometry;
  board: PublicBoardView;
  renderer: 'svg' | 'r3f';
  controls: BoardViewportControls;
  nameOf: (id: string) => string;
  selected: Inspection | null;
  onInspect: (target: Inspection) => void;
  onClose: () => void;
  fallbackFocusRef: RefObject<HTMLElement | null>;
}

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
export function BoardInspectionLayer({ geometry, board, renderer, controls, nameOf, selected, onInspect, fallbackFocusRef }: Props) {
  const locale = useLocale();
  const t = useT();
  const elements = useMemo(() => inspectionElements(geometry, board, renderer), [geometry, board, renderer]);
  const context = { locale, board, topology: geometry.topology, nameOf };
  const rect = controls.viewport.rect;
  const hitSize = inspectionHitSize(elements.filter((element) => element.kind === 'hex')
    .map((element) => element.outline!.map(controls.projectPoint)));
  const halfHit = hitSize / 2;
  const layerRef = useRef<SVGSVGElement | null>(null);
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (focusedRef.current && !layerRef.current?.querySelector(`[data-testid="${focusedRef.current}"]`)) {
      focusedRef.current = null;
      fallbackFocusRef.current?.focus();
    }
  });
  const choose = (target: Inspection) => { if (!controls.consumeSuppressedClick()) onInspect(target); };
  const keyboard = (event: React.KeyboardEvent, target: Inspection) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation(); onInspect(target);
    }
  };
  return <svg ref={layerRef} className="board-inspect-layer" data-testid="board-inspect-layer" width={rect.width} height={rect.height}
    aria-label={t('board.inspectMap')} role="group">
    {elements.map((element) => {
      const anchor = controls.projectPoint(element.world);
      const outline = element.outline?.map(controls.projectPoint);
      if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || (!anchor.visible && !outline?.some((point) => point.visible))) return null;
      const option = inspectDescription(context, element);
      const active = selected?.kind === element.kind && selected.index === element.index;
      const shared = { role: 'button', tabIndex: 0, 'aria-label': `${t('board.inspect')}: ${option.title} ${option.detail}`,
        'aria-pressed': active, 'data-hit-size': hitSize, 'data-testid': `inspect-${element.kind}-${element.index}`,
        onFocus: () => { focusedRef.current = `inspect-${element.kind}-${element.index}`; },
        onClick: () => choose(element), onKeyDown: (event: React.KeyboardEvent) => keyboard(event, element),
        className: `board-inspect-hit${active ? ' board-inspect-hit--active' : ''}` };
      if (element.kind === 'hex' && outline) return <polygon key={`hex-${element.index}`} {...shared}
        points={outline.map((point) => `${point.x - rect.left},${point.y - rect.top}`).join(' ')} />;
      if (element.kind === 'edge' && outline) return <line key={`edge-${element.index}`} {...shared}
        x1={outline[0]!.x - rect.left} y1={outline[0]!.y - rect.top}
        x2={outline[1]!.x - rect.left} y2={outline[1]!.y - rect.top} strokeWidth={hitSize} style={{ strokeWidth: hitSize }} />;
      const top = element.top ? controls.projectPoint(element.top) : anchor;
      return <rect key={`${element.kind}-${element.index}`} {...shared} rx={10}
        x={Math.min(anchor.x, top.x) - rect.left - halfHit} y={Math.min(anchor.y, top.y) - rect.top - halfHit}
        width={Math.abs(anchor.x - top.x) + hitSize} height={Math.abs(anchor.y - top.y) + hitSize} />;
    })}
  </svg>;
}

export function BoardInspectionPanel({ geometry, board, renderer, nameOf, selected, onInspect, onClose, fallbackFocusRef }: Props) {
  const locale = useLocale();
  const t = useT();
  const id = useId();
  const context = { locale, board, topology: geometry.topology, nameOf };
  const elements = useMemo(() => inspectionElements(geometry, board, renderer), [geometry, board, renderer]);
  const description = selected ? inspectDescription(context, selected) : null;
  const close = () => { onClose(); fallbackFocusRef.current?.focus(); };
  return <section className="board-inspection" data-testid="board-inspection" aria-label={t('board.inspectMap')}>
    <details className="board-inspection__browser">
      <summary>{t('board.inspectMap')}</summary>
      <label htmlFor={id}>{t('board.inspectChoose')}</label>
      <select id={id} value="" onChange={(event) => {
        const [kind, index] = event.target.value.split(':');
        if (kind) onInspect({ kind: kind as Inspection['kind'], index: Number(index) });
      }}>
        <option value="" disabled>{t('board.inspectChoose')}</option>
        {elements.map((element) => <option key={`${element.kind}:${element.index}`} value={`${element.kind}:${element.index}`}>
          {inspectDescription(context, element).title}
        </option>)}
      </select>
    </details>
    {description && <div className="board-inspection__detail" data-testid="inspection-detail" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    }}>
      <div className="board-inspection__heading"><h3>{description.title}</h3>
        <button type="button" className="button button--ghost" onClick={close} aria-label={t('board.inspectClose')}>×</button></div>
      <div role="status" aria-live="polite" aria-atomic="true">
        <p>{description.detail}</p>
        <ul>{description.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
      </div>
      {description.relatedHexes.length > 0 && <div className="board-inspection__related" aria-label={t('board.inspectRelated')}>
        <span>{t('board.inspectRelated')}</span>
        {description.relatedHexes.map((index) => <button key={index} type="button" className="button button--ghost"
          onClick={() => onInspect({ kind: 'hex', index })}>{t('board.hex', { index })}</button>)}
      </div>}
    </div>}
  </section>;
}
