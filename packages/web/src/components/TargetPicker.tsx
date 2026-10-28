import { useEffect, useId, useMemo, useRef } from 'react';
import type { BoardTopology, PublicBoardView } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { ambiguousWith, describeTarget, type TargetKind, type TargetOption } from '../board/targets.ts';
import type { BoardGeometry, Point } from '../board/geometry.ts';

/**
 * List-based target selection (docs/SPEC.md §8.2, U-02/U-04).
 *
 * This is the non-precision alternative to clicking the board: every legal
 * target is a real button with a textual board reference, reachable by keyboard
 * and by screen reader, and it is also what an ambiguous cluster falls back to.
 */
export function TargetPicker({
  geometry,
  board,
  topology,
  kind,
  targets,
  nameOf,
  onChoose,
  onCancel,
  ambiguousOnly,
  minDistance,
}: {
  geometry: BoardGeometry;
  board: PublicBoardView;
  topology: BoardTopology;
  kind: TargetKind;
  targets: readonly number[];
  nameOf: (playerId: string) => string;
  onChoose: (index: number) => void;
  onCancel?: () => void;
  ambiguousOnly?: number[];
  minDistance?: number;
}) {
  const t = useT();
  const locale = useLocale();
  const pickerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const restoreOnUnmountRef = useRef(true);
  const focusInsideRef = useRef(false);
  const headingId = useId();

  const options: TargetOption[] = useMemo(() => {
    const context = { locale, topology, board, nameOf };
    const indices = ambiguousOnly && ambiguousOnly.length > 0 ? ambiguousOnly : targets;
    return indices.map((index) => describeTarget(context, kind, index));
  }, [ambiguousOnly, board, kind, locale, nameOf, targets, topology]);

  const points = useMemo(() => {
    const map = new Map<number, Point>();
    if (kind === 'vertex') {
      for (const vertex of geometry.vertices) map.set(vertex.index, { x: vertex.x, y: vertex.y });
    } else if (kind === 'edge') {
      for (const edge of geometry.edges) {
        map.set(edge.index, { x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2 });
      }
    } else {
      for (const hex of geometry.hexes) map.set(hex.index, { x: hex.cx, y: hex.cy });
    }
    return map;
  }, [geometry, kind]);

  const note = ambiguousOnly && ambiguousOnly.length > 1 ? t('board.ambiguousHint') : null;

  const restorePreviousFocus = () => {
    const previous = previousFocusRef.current;
    if (previous?.isConnected) previous.focus();
  };

  useEffect(() => {
    const active = document.activeElement;
    previousFocusRef.current = active instanceof HTMLElement ? active : null;
    pickerRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      if (restoreOnUnmountRef.current && focusInsideRef.current) {
        restorePreviousFocus();
      }
    };
  }, []);

  const cancel = () => {
    restoreOnUnmountRef.current = false;
    restorePreviousFocus();
    onCancel?.();
  };

  return (
    <div
      ref={pickerRef}
      className="target-picker"
      data-testid="target-picker"
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      onFocusCapture={() => { focusInsideRef.current = true; }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) focusInsideRef.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !onCancel) return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }}
    >
      <h3 id={headingId}>{t('board.chooseTarget')}</h3>
      {note && <p className="muted">{note}</p>}
      <p className="muted">{t('board.targets', { count: options.length })}</p>
      <ul className="target-picker__list">
        {options.map((option) => {
          const cluster =
            minDistance === undefined
              ? null
              : ambiguousWith(option.index, targets, points, minDistance);
          return (
            <li key={`${option.kind}-${option.index}`}>
              <button
                type="button"
                className="button button--target"
                data-testid={`picker-${option.kind}-${option.index}`}
                onClick={() => {
                  restoreOnUnmountRef.current = false;
                  onChoose(option.index);
                }}
              >
                <span className="target-picker__label">{option.label}</span>
                <span className="target-picker__detail">{option.detail}</span>
                {cluster && cluster.length > 1 && (
                  <span className="target-picker__cluster">
                    {t('board.targets', { count: cluster.length })}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
