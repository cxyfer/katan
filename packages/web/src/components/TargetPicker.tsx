import { useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react';
import type { BoardTopology, PublicBoardView } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { ambiguousWith, describeTarget, type TargetKind, type TargetOption } from '../board/targets.ts';
import type { BoardGeometry, Point } from '../board/geometry.ts';

/** 工具列（相機按鈕）下緣與浮層邊界的保留空間，避免 popover 蓋住工具列。 */
const TOP_RESERVED_PX = 52;
const EDGE_GAP_PX = 8;
const ANCHOR_OFFSET_PX = 14;

/**
 * 外部點擊關閉後，吞掉緊接著的那一次 click，避免它落在棋盤目標按鈕上
 * 又觸發選取、重新開啟 picker 或誤送指令。獨立於元件生命週期，因為 picker 此時已卸載。
 * 拖曳（無 click）時於 pointerup 後的下一個工作階段自動移除。
 */
function swallowNextClick() {
  const remove = () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('pointerup', onEnd, true);
    document.removeEventListener('pointercancel', onEnd, true);
  };
  function onClick(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    remove();
  }
  function onEnd() {
    // click 會在 pointerup 之後同步派發；等其落空才移除。
    setTimeout(remove, 0);
  }
  document.addEventListener('click', onClick, true);
  document.addEventListener('pointerup', onEnd, true);
  document.addEventListener('pointercancel', onEnd, true);
}

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
  anchor,
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
  /** 觸發消歧的點擊位置（視窗 CSS 像素）；有值時 popover 貼近該點。 */
  anchor?: Point;
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
    pickerRef.current?.querySelector<HTMLButtonElement>('.target-picker__list button:not(:disabled)')?.focus();
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
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const hasCancel = !!onCancel;

  // 點 popover 以外的任何地方（含棋盤空白處）即關閉；開關按鈕自行處理，不在此重複切換。
  useEffect(() => {
    if (!hasCancel) return;
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (pickerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-target-picker-ignore]')) return;
      // 只有落在棋盤目標按鈕上才吞掉 click；工具列（縮放等）仍照常作用。
      if (target instanceof Element && target.closest('.board-target')) swallowNextClick();
      // 外部點擊不應把焦點拉回開啟前的元素（使用者已把焦點移到別處）。
      restoreOnUnmountRef.current = false;
      onCancelRef.current?.();
    };
    // 焦點不在 popover 內（例如在棋盤上）時，Escape 仍可關閉。
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onCancelRef.current?.();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [hasCancel]);

  // 依點擊位置定位並夾在父層可視範圍內，避開上方工具列；無錨點時使用 CSS 預設位置。
  useLayoutEffect(() => {
    const element = pickerRef.current;
    const parent = element?.offsetParent;
    if (!element || !parent || !anchor) return;
    const bounds = parent.getBoundingClientRect();
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (bounds.width === 0 || bounds.height === 0) return;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
    const x = anchor.x - bounds.left;
    const y = anchor.y - bounds.top;
    // 預設放在點擊處右下；空間不足時改放左側／上方。
    const left = x + ANCHOR_OFFSET_PX + width <= bounds.width - EDGE_GAP_PX ? x + ANCHOR_OFFSET_PX : x - ANCHOR_OFFSET_PX - width;
    const top = y + ANCHOR_OFFSET_PX + height <= bounds.height - EDGE_GAP_PX ? y + ANCHOR_OFFSET_PX : y - ANCHOR_OFFSET_PX - height;
    element.style.left = `${clamp(left, EDGE_GAP_PX, bounds.width - width - EDGE_GAP_PX)}px`;
    element.style.top = `${clamp(top, TOP_RESERVED_PX, bounds.height - height - EDGE_GAP_PX)}px`;
    element.style.right = 'auto';
  }, [anchor, options.length]);

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
      <div className="target-picker__header">
        <h3 id={headingId}>{t('board.chooseTarget')}</h3>
        <span className="target-picker__count muted">{t('board.targets', { count: options.length })}</span>
        {onCancel && (
          <button
            type="button"
            className="button button--ghost target-picker__close"
            data-testid="target-picker-close"
            aria-label={t('app.close')}
            title={t('app.close')}
            onClick={cancel}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      {note && <p className="muted target-picker__note">{note}</p>}
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
