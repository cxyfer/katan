import { useEffect, useMemo, useRef, type KeyboardEvent, type RefObject } from 'react';
import type { PublicBoardView, BoardTopology } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import type { CssRect, ProjectedTarget } from '../board/render-contract.ts';
import { describeTarget, type TargetKind } from '../board/targets.ts';

export const TARGET_HIT_SIZE_PX = 44;
export const TARGET_AMBIGUITY_PX = 30;

export interface BoardTargetOverlayProps {
  targets: readonly ProjectedTarget[];
  /** Projection surface in viewport CSS pixels; targets remain global until render. */
  rect: CssRect;
  board: PublicBoardView;
  topology: BoardTopology;
  nameOf: (playerId: string) => string;
  onSelect: (kind: TargetKind, index: number) => void;
  onAmbiguous?: (kind: TargetKind, clicked: number, cluster: readonly number[]) => void;
  onCancel?: () => void;
  consumeSuppressedClick?: () => boolean;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  renderer?: 'svg' | 'r3f';
  selection?: { kind: TargetKind; index: number } | null;
  /** Explorers & Pirates: unexplored hexes, described without revealing their contents. */
  fog?: ReadonlyMap<number, 'parrot' | 'goose'>;
}

function targetKey(kind: TargetKind, index: number): string {
  return `${kind}:${index}`;
}

function edgeIndicator(target: ProjectedTarget): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const endpoints = target.endpoints;
  if (!endpoints || !endpoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
    return { x1: 15, y1: TARGET_HIT_SIZE_PX / 2, x2: 29, y2: TARGET_HIT_SIZE_PX / 2 };
  }
  return {
    x1: TARGET_HIT_SIZE_PX / 2 + endpoints[0].x - target.x,
    y1: TARGET_HIT_SIZE_PX / 2 + endpoints[0].y - target.y,
    x2: TARGET_HIT_SIZE_PX / 2 + endpoints[1].x - target.x,
    y2: TARGET_HIT_SIZE_PX / 2 + endpoints[1].y - target.y,
  };
}

export function targetsWithinAmbiguity(
  clicked: ProjectedTarget,
  targets: readonly ProjectedTarget[],
  distancePx = TARGET_AMBIGUITY_PX,
): ProjectedTarget[] {
  return targets
    .filter((target) => target.visible && target.kind === clicked.kind &&
      Number.isFinite(target.x) && Number.isFinite(target.y) &&
      ((Math.abs(target.x - clicked.x) < TARGET_HIT_SIZE_PX &&
        Math.abs(target.y - clicked.y) < TARGET_HIT_SIZE_PX) ||
        Math.hypot(target.x - clicked.x, target.y - clicked.y) < distancePx))
    .sort((a, b) => a.index - b.index);
}

/** Real DOM buttons keep every target reachable while the projected decoration stays inert. */
export function BoardTargetOverlay({
  targets,
  rect,
  board,
  topology,
  nameOf,
  onSelect,
  onAmbiguous,
  onCancel,
  consumeSuppressedClick,
  fallbackFocusRef,
  renderer = 'r3f',
  selection = null,
  fog,
}: BoardTargetOverlayProps) {
  const t = useT();
  const locale = useLocale();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const focusedTargetRef = useRef<string | null>(null);
  const visibleTargets = useMemo(() => targets.filter((target) =>
    target.visible && Number.isFinite(target.x) && Number.isFinite(target.y)), [targets]);
  const currentKeys = useMemo(() => new Set(visibleTargets.map((target) =>
    targetKey(target.kind, target.index))), [visibleTargets]);

  useEffect(() => {
    const focused = focusedTargetRef.current;
    if (!focused || currentKeys.has(focused)) return;
    focusedTargetRef.current = null;
    const fallback = fallbackFocusRef?.current ?? overlayRef.current;
    fallback?.focus();
  }, [currentKeys, fallbackFocusRef]);

  const choose = (target: ProjectedTarget) => {
    if (consumeSuppressedClick?.()) return;
    const cluster = targetsWithinAmbiguity(target, visibleTargets);
    if (cluster.length > 1) {
      onAmbiguous?.(target.kind, target.index, cluster.map((candidate) => candidate.index));
      return;
    }
    onSelect(target.kind, target.index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, target: ProjectedTarget) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      event.stopPropagation();
      onSelect(target.kind, target.index);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel?.();
    }
  };

  return (
    <div
      ref={overlayRef}
      className="board-target-overlay"
      data-testid="board-target-overlay"
      data-renderer={renderer}
      role="group"
      aria-label={t('a11y.boardRegion')}
      tabIndex={-1}
    >
      {visibleTargets.map((target) => {
        const option = describeTarget({ locale, topology, board, nameOf, fog }, target.kind, target.index);
        const key = targetKey(target.kind, target.index);
        const selected = selection?.kind === target.kind && selection.index === target.index;
        const edge = target.kind === 'edge' ? edgeIndicator(target) : null;
        return (
          <button
            key={key}
            type="button"
            className={`board-target board-target--${target.kind}${selected ? ' board-target--selected' : ''}`}
            data-testid={`target-${target.kind}-${target.index}`}
            data-target-kind={target.kind}
            data-target-index={target.index}
            data-hit-size={TARGET_HIT_SIZE_PX}
            aria-pressed={selected}
            aria-label={`${t('board.legalTarget')}: ${option.label} ${option.detail}`}
            style={{
              left: target.x - rect.left,
              top: target.y - rect.top,
              width: TARGET_HIT_SIZE_PX,
              height: TARGET_HIT_SIZE_PX,
            }}
            onFocus={() => { focusedTargetRef.current = key; }}
            onClick={() => choose(target)}
            onKeyDown={(event) => onKeyDown(event, target)}
          >
            {edge && (
              <svg
                className="board-target__edge"
                data-testid={`target-edge-indicator-${target.index}`}
                data-edge-angle={Math.round(Math.atan2(edge.y2 - edge.y1, edge.x2 - edge.x1) * 180 / Math.PI)}
                viewBox={`0 0 ${TARGET_HIT_SIZE_PX} ${TARGET_HIT_SIZE_PX}`}
                aria-hidden="true"
                focusable="false"
              >
                <line className="board-target__edge-halo" x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} />
                <line className="board-target__edge-line" data-edge-stroke="" x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} />
                <circle className="board-target__edge-node" cx={TARGET_HIT_SIZE_PX / 2} cy={TARGET_HIT_SIZE_PX / 2} r="2.4" />
              </svg>
            )}
            <span className="visually-hidden">{option.label} {option.detail}</span>
          </button>
        );
      })}
    </div>
  );
}
