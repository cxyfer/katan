import { useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react';
import type { BoardTopology, PublicBoardView } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { ambiguousWith, describeTarget, type TargetKind, type TargetOption } from '../board/targets.ts';
import type { BoardGeometry, Point } from '../board/geometry.ts';

/** 工具列（相機按鈕）下緣與 popover 之間的間距；工具列高度改由實際矩形量測。 */
const TOOLBAR_GAP_PX = 4;
const TOOLBAR_SELECTOR = '.board__toolbar--side';
const EDGE_GAP_PX = 8;
const ANCHOR_OFFSET_PX = 14;

/**
 * 外部點擊關閉後，吞掉緊接著的那一次 click，避免它落在棋盤目標按鈕上
 * 又觸發選取、重新開啟 picker 或誤送指令。獨立於元件生命週期，因為 picker 此時已卸載。
 * 觸控 click 可能在 pointerup 之後的另一個 task 才派發；直到 click、下一次 pointerdown
 * 或一秒保底逾時才移除，避免漏掉關閉用的點擊，也不攔截下一次刻意操作。
 */
function swallowNextClick() {
  const remove = () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('pointerdown', remove, true);
    clearTimeout(timeout);
  };
  function onClick(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    remove();
  }
  const timeout = setTimeout(remove, 1000);
  document.addEventListener('click', onClick, true);
  document.addEventListener('pointerdown', remove, true);
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
  /** 觸發消歧目標的目前投影位置（視窗 CSS 像素）；有值時 popover 貼近該點。 */
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
      event.stopPropagation();
      onCancelRef.current?.();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [hasCancel]);

  const anchorX = anchor?.x;
  const anchorY = anchor?.y;
  // 依目標目前的投影定位；無錨點時放在工具列下方左側。尺寸或投影變動時重新夾限。
  useLayoutEffect(() => {
    const element = pickerRef.current;
    const parent = element?.offsetParent;
    if (!element || !parent) return;
    const anchored = anchorX !== undefined && anchorY !== undefined;
    const toolbar = parent.querySelector(TOOLBAR_SELECTOR);
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
    const place = () => {
      const bounds = parent.getBoundingClientRect();
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (bounds.width === 0 || bounds.height === 0) return;
      // 頂端下限取工具列實際下緣（窄螢幕會換成 2–3 列），而非固定常數；找不到工具列時只留邊距。
      const toolbarBottom = toolbar ? toolbar.getBoundingClientRect().bottom - bounds.top + TOOLBAR_GAP_PX : 0;
      const minTop = Math.max(EDGE_GAP_PX, toolbarBottom);
      // 預設放在點擊處右下；空間不足時改放左側／上方。
      const x = anchored ? anchorX - bounds.left : 0;
      const y = anchored ? anchorY - bounds.top : 0;
      const left = !anchored ? EDGE_GAP_PX
        : x + ANCHOR_OFFSET_PX + width <= bounds.width - EDGE_GAP_PX ? x + ANCHOR_OFFSET_PX : x - ANCHOR_OFFSET_PX - width;
      const top = !anchored ? minTop
        : y + ANCHOR_OFFSET_PX + height <= bounds.height - EDGE_GAP_PX ? y + ANCHOR_OFFSET_PX : y - ANCHOR_OFFSET_PX - height;
      element.style.left = `${clamp(left, EDGE_GAP_PX, bounds.width - width - EDGE_GAP_PX)}px`;
      element.style.top = `${clamp(top, minTop, bounds.height - height - EDGE_GAP_PX)}px`;
      element.style.right = 'auto';
    };
    place();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(parent);
    if (toolbar) observer?.observe(toolbar);
    observer?.observe(element);
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchorX, anchorY, options.length]);

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
