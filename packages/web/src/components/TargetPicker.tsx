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
 * 疊在棋盤下緣的 HUD：資源列、手牌扇形與浮動工具鈕。popover 放得下時停在它們上方，
 * 放不下才疊上去（z-index 高於 HUD，不會被蓋住）。
 */
const BOTTOM_HUD_SELECTOR = '.game__dock .resource-tally, .game__dock .hand, .game-tools';
/** 清單可捲動時，捲動位置距離邊界 1px 以內視為已到底，避免次像素誤差讓提示閃爍。 */
const SCROLL_EDGE_PX = 1;

/**
 * 外部點擊關閉後，吞掉緊接著的那一次 click，避免它落在棋盤目標按鈕上
 * 又觸發選取、重新開啟 picker 或誤送指令。獨立於元件生命週期，因為 picker 此時已卸載。
 * 觸控 click 可能延後派發；放開／取消後保留一秒，按住時最多保留十秒。
 * 下一次 pointerdown 或新的非修飾按鍵也會解除，避免攔截下一次刻意操作。
 */
function swallowNextClick() {
  let releaseTimeout: ReturnType<typeof setTimeout> | undefined;
  const remove = () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('pointerdown', remove, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('pointerup', onEnd, true);
    document.removeEventListener('pointercancel', onEnd, true);
    clearTimeout(releaseTimeout);
    clearTimeout(maxTimeout);
  };
  function onClick(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    remove();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    remove();
  }
  function onEnd() {
    clearTimeout(releaseTimeout);
    releaseTimeout = setTimeout(remove, 1000);
  }
  const maxTimeout = setTimeout(remove, 10000);
  document.addEventListener('click', onClick, true);
  document.addEventListener('pointerdown', remove, true);
  document.addEventListener('keydown', onKeyDown, true);
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
      if (event.target instanceof Element) {
        const dialog = event.target.closest('[role="dialog"], dialog');
        if (dialog && dialog !== pickerRef.current) return;
        if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      }
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
    const list = element.querySelector<HTMLElement>('.target-picker__list');
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
    // 清單超出可用高度時只捲動清單本身，並在被截斷的一側顯示提示。
    const updateScrollCue = () => {
      if (!list) return;
      const hidden = list.scrollHeight - list.clientHeight;
      element.toggleAttribute('data-more-above', list.scrollTop > SCROLL_EDGE_PX);
      element.toggleAttribute('data-more-below', hidden - list.scrollTop > SCROLL_EDGE_PX);
    };
    const place = () => {
      const bounds = parent.getBoundingClientRect();
      const width = element.offsetWidth;
      if (bounds.width === 0 || bounds.height === 0) return;
      // 預設放在點擊處右下；空間不足時改放左側／上方。
      const x = anchored ? anchorX - bounds.left : 0;
      const y = anchored ? anchorY - bounds.top : 0;
      const left = clamp(
        !anchored ? EDGE_GAP_PX
          : x + ANCHOR_OFFSET_PX + width <= bounds.width - EDGE_GAP_PX ? x + ANCHOR_OFFSET_PX : x - ANCHOR_OFFSET_PX - width,
        EDGE_GAP_PX,
        bounds.width - width - EDGE_GAP_PX,
      );
      const overlapsColumn = (rect: DOMRect) =>
        rect.width > 0 && rect.height > 0 && rect.left - bounds.left < left + width && rect.right - bounds.left > left;
      // 頂端下限取工具列實際下緣（窄螢幕會換成 2–3 列），而非固定常數；與工具列水平不重疊時只留邊距。
      const toolbarRect = toolbar?.getBoundingClientRect();
      const minTop = toolbarRect && overlapsColumn(toolbarRect)
        ? Math.max(EDGE_GAP_PX, toolbarRect.bottom - bounds.top + TOOLBAR_GAP_PX)
        : EDGE_GAP_PX;
      const parentBottom = bounds.height - EDGE_GAP_PX;
      // 先以整段可用高度量出 popover 的自然高度（仍受 CSS 上限約束）。
      element.style.setProperty('--target-picker-room', `${Math.max(0, parentBottom - minTop)}px`);
      const height = element.offsetHeight;
      // 同一欄位下緣若有 HUD（資源列、手牌、浮動工具），優先停在它上方。
      const stage = parent.closest('[data-board-stage]');
      const hudBottom = Math.min(
        parentBottom,
        ...Array.from(stage?.querySelectorAll(BOTTOM_HUD_SELECTOR) ?? [], (hud) => hud.getBoundingClientRect())
          .filter((rect) => overlapsColumn(rect) && rect.bottom - bounds.top > minTop)
          .map((rect) => rect.top - bounds.top - EDGE_GAP_PX),
      );
      // 無錨點時貼在工具列下方（高度已由 --target-picker-room 限制在可用範圍內）。有錨點時依序嘗試：
      // 點擊處下方且不碰 HUD、點擊處上方、點擊處下方疊在 HUD 上（HUD 不會蓋住 popover）；
      // 都放不下時夾在可用範圍內，清單自行捲動。
      const below = Math.max(minTop, y + ANCHOR_OFFSET_PX);
      const above = y - ANCHOR_OFFSET_PX - height;
      const top = !anchored ? minTop
        : below + height <= hudBottom ? below
        : above >= minTop ? above
        : clamp(below, minTop, parentBottom - height);
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      element.style.right = 'auto';
      updateScrollCue();
    };
    place();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(parent);
    if (toolbar) observer?.observe(toolbar);
    observer?.observe(element);
    window.addEventListener('resize', place);
    list?.addEventListener('scroll', updateScrollCue, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      list?.removeEventListener('scroll', updateScrollCue);
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
