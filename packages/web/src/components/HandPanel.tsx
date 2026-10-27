import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { RESOURCES, type Resource } from '@catan/rules';
import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { GameIcon, ResourceIcon } from './GameArt.tsx';
import { ResourceCardArt } from './ResourceCardArt.tsx';
import { DevCardPanel } from './DevCardPanel.tsx';
import type { TableController } from '../state/useTable.ts';

/** 手牌只呈現伺服器傳送給本人的資源；檢視卡片不送出遊戲命令。 */
export function HandPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const [inspected, setInspected] = useState<Resource | null>(null);
  const { state } = controller;
  const selfId = state.session?.id ?? null;
  const self = state.game?.view.players.find((player) => player.id === selfId) ?? null;
  const resources = self?.resources;
  const developmentCount = (self?.devCardCount ?? 0) + (self?.newDevCardCount ?? 0);
  const totalHandCards = (self?.handSize ?? 0) + developmentCount;

  useEffect(() => {
    if (inspected === null) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"], dialog')) return;
      setInspected(null);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [inspected]);

  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const handRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const hoverRef = useRef(false);
  const pinnedRef = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const close = () => {
    cancelClose();
    pinnedRef.current = false;
    hoverRef.current = false;
    setPinned(false);
    setExpanded(false);
    setInspected(null);
    toggleRef.current?.focus();
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      if (!hoverRef.current && !pinnedRef.current && !handRef.current?.contains(document.activeElement)) {
        setExpanded(false);
        setInspected(null);
      }
    }, 320);
  };
  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);

  return (
    <section className="panel hand" aria-labelledby="hand-heading" data-testid="hand-panel" ref={handRef}
      data-expanded={expanded} data-pinned={pinned}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
        hoverRef.current = true;
        cancelClose();
        setExpanded(true);
      }}
      onPointerLeave={() => { hoverRef.current = false; scheduleClose(); }}
      onFocusCapture={(event) => {
        cancelClose();
        if (event.target.closest('.hand__content')) setExpanded(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); }
      }}
    >
      <header className="hand__handle">
        <h2 id="hand-heading" className="visually-hidden">{t('play.hand')}</h2>
        <button type="button" className="button hand__toggle" ref={toggleRef} data-testid="hand-toggle"
          aria-expanded={expanded} aria-controls="hand-content"
          aria-label={t(expanded ? 'table.collapseHand' : 'table.expandHand')}
          onClick={() => { if (expanded) close(); else { cancelClose(); setExpanded(true); } }}>
          <GameIcon name="cards" size={18} /><span>{t('play.hand')}</span><span className="badge">{formatNumber(state.locale, totalHandCards)}</span>
          <span aria-hidden="true">{expanded ? '⌄' : '⌃'}</span>
        </button>
        <button type="button" className="button hand__pin" data-testid="hand-pin" aria-pressed={pinned}
          aria-label={t(pinned ? 'table.unpinHand' : 'table.pinHand')}
          onClick={() => {
            pinnedRef.current = !pinnedRef.current;
            setPinned(pinnedRef.current);
            if (pinnedRef.current) { cancelClose(); setExpanded(true); } else scheduleClose();
          }}><GameIcon name="anchor" size={16} /><span>{t(pinned ? 'table.unpinHand' : 'table.pinHand')}</span></button>
      </header>
      <div className="hand__content" id="hand-content" hidden={!expanded}>
      {totalHandCards === 0 && <p className="hand__empty muted">{t('play.handEmpty')}</p>}
      <p id="hand-hint" className="hand__hint muted">{t('table.handHint')}</p>
      <div className="hand__resources">
      <h3>{t('table.resources')}</h3>
      <ul className="resource-list">
        {RESOURCES.map((resource, index) => {
          const count = resources?.[resource];
          const countLabel = count === undefined ? '—' : formatNumber(state.locale, count);
          const isInspected = inspected === resource;
          return (
            <li
              key={resource}
              className={`resource-card resource-card--${resource}${count === 0 ? ' resource-card--empty' : ''}${count === undefined ? ' resource-card--missing' : ''}${isInspected ? ' resource-card--inspected' : ''}`}
              style={{ '--card-index': index, '--card-angle': `${(index - 2) * 6}deg` } as CSSProperties}
              data-testid={`resource-${resource}`}
            >
              <button
                type="button"
                className="resource-card__inspect"
                aria-label={t('table.resourceCard', { resource: t(`resource.${resource}`), count: countLabel })}
                aria-pressed={isInspected}
                aria-describedby={`hand-hint resource-use-${resource}`}
                onClick={() => setInspected((current) => current === resource ? null : resource)}
              >
                <span className="resource-card__corner"><ResourceIcon resource={resource} size={25} /></span>
                <span className="resource-card__art"><ResourceCardArt resource={resource} /></span>
                <span className="resource-list__label">{t(`resource.${resource}`)}</span>
                <span className="resource-list__count">{countLabel}</span>
                <span id={`resource-use-${resource}`} className="resource-card__use">{t(`table.resourceUse.${resource}`)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      </div>
      <div className="hand__development">
         <DevCardPanel controller={controller} embedded />
       </div>
      <p className="hand__summary muted">{t('play.handSize')}: {formatNumber(state.locale, totalHandCards)}</p>
      </div>
    </section>
  );
}
