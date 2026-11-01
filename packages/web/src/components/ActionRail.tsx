import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/context.tsx';
import type { TableController } from '../state/useTable.ts';
import { ActionBar } from './ActionBar.tsx';
import { TbPanel } from './tb/TbPanel.tsx';
import { GameIcon } from './GameArt.tsx';
import '../styles/action-rail.css';

/** 水平揭開既有操作，不重新掛載動作或改動已選取的建造目標。 */
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
  const consumeTouchClick = useRef(false);
  const togglePointerExpanded = useRef<boolean | null>(null);
  const dismissing = useRef(false);
  const expanded = !dismissed && (hovered || focused || pinned);
  const view = controller.state.game?.view;

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
      aria-label={t('table.build')}
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
        aria-label={expanded ? t('table.closePanel') : t('table.build')}
        title={expanded ? t('table.closePanel') : t('table.build')}
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
        <span>{t('table.build')}</span>
        <GameIcon name="chevron-right" size={18} />
      </button>
      <div className="action-rail__content" id="action-rail-content">
        <div className="action-rail__phase game__phase">
          <span className="game__phase-dot" />
          <span>{view ? t('play.phase.' + view.turn.phase) : t('app.loading')}</span>
          <GameIcon name="flag" size={15} />
        </div>
        <ActionBar controller={controller} />
        <TbPanel controller={controller} />
      </div>
    </aside>
  );
}
