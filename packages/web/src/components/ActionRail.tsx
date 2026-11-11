import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/context.tsx';
import type { TableController } from '../state/useTable.ts';
import { actionGroupOf, deriveActions } from '../state/actions.ts';
import { blocksNewCommands } from '../state/commands.ts';
import { ActionBar } from './ActionBar.tsx';
import { GameIcon } from './GameArt.tsx';
import '../styles/action-rail.css';

/**
 * 收合時是分組的圖示塢，展開時同一批按鈕放大成卡片；切換不重新掛載動作，
 * 也不改動已選取的建造目標。
 */
export function ActionRail({ controller, onExpand, collapseRequested = false }: {
  controller: TableController; onExpand?: () => void; collapseRequested?: boolean;
}) {
  const t = useT();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<'none' | 'start' | 'end' | 'both'>('none');
  const consumeTouchClick = useRef(false);
  const togglePointerExpanded = useRef<boolean | null>(null);
  const dismissing = useRef(false);
  const expanded = !dismissed && (hovered || focused || pinned);
  const view = controller.state.game?.view;
  // 收合時在開關上標出可用的可選動作數（不含已在提示面板上的擲骰／結束回合），不必展開也知道能做什麼。
  const available = blocksNewCommands(controller.state.command)
    ? 0
    : deriveActions(controller.state, controller.state.session?.id ?? null)
      .filter((action) => action.enabled && actionGroupOf(action.id) !== 'turn').length;
  const toggleLabel = available > 0 ? t('table.actions.available', { count: available }) : t('table.actions');

  // 動作超出可用高度時標出可捲動的方向，讓淡出提示只出現在還有內容的那一端。
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      const before = content.scrollTop > 1;
      const after = content.scrollTop + content.clientHeight < content.scrollHeight - 1;
      setOverflow(before && after ? 'both' : before ? 'start' : after ? 'end' : 'none');
    };
    measure();
    content.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(content);
    for (const child of content.children) observer?.observe(child);
    return () => {
      content.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (expanded) onExpand?.();
  }, [expanded, onExpand]);
  useEffect(() => {
    if (!collapseRequested) return;
    setHovered(false);
    setFocused(false);
    setPinned(false);
    setDismissed(true);
    if (railRef.current?.contains(document.activeElement)) {
      dismissing.current = true;
      toggleRef.current?.focus();
      dismissing.current = false;
    }
  }, [collapseRequested]);

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"], dialog')) return;
      event.preventDefault();
      setDismissed(true);
      setPinned(false);
      dismissing.current = true;
      toggleRef.current?.focus();
      dismissing.current = false;
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [expanded]);

  return (
    <aside
      ref={railRef}
      className="action-rail"
      aria-label={t('table.actions')}
      data-testid="action-rail"
      data-expanded={expanded ? 'true' : 'false'}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return;
        setDismissed(false);
        setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => {
        if (!dismissing.current) setDismissed(false);
        setFocused(true);
      }}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setFocused(false);
        setDismissed(false);
      }}
      onPointerDownCapture={(event) => {
        consumeTouchClick.current = event.pointerType === 'touch' && !expanded &&
          event.target instanceof Element &&
          !!event.target.closest('.action-list__button');
      }}
      onPointerCancel={() => { consumeTouchClick.current = false; }}
      onClickCapture={(event) => {
        if (!consumeTouchClick.current) return;
        consumeTouchClick.current = false;
        event.preventDefault();
        event.stopPropagation();
        setPinned(true);
        setDismissed(false);
      }}
    >
      <button
        ref={toggleRef}
        type="button"
        className="action-rail__toggle"
        data-testid="action-rail-toggle"
        aria-label={expanded ? t('table.closePanel') : toggleLabel}
        title={expanded ? t('table.closePanel') : toggleLabel}
        aria-expanded={expanded}
        aria-controls="action-rail-content"
        onPointerDown={() => { togglePointerExpanded.current = expanded; }}
        onClick={() => {
          const close = togglePointerExpanded.current ?? expanded;
          togglePointerExpanded.current = null;
          setDismissed(close);
          setPinned(!close);
        }}
      >
        <span className="action-rail__title">{t('table.actions')}</span>
        {/* 展開時標題列順帶顯示目前階段，不再另佔一列。 */}
        <span className="action-rail__phase" data-testid="action-rail-phase">
          <span className="game__phase-dot" />
          {view ? t('play.phase.' + view.turn.phase) : t('app.loading')}
        </span>
        {available > 0 && <span className="action-rail__count" aria-hidden="true" data-testid="action-rail-count">{available}</span>}
        <GameIcon name="chevron-right" size={18} />
      </button>
      <div className="action-rail__content" id="action-rail-content" ref={contentRef} data-overflow={overflow}>
        <ActionBar controller={controller} />
      </div>
    </aside>
  );
}
