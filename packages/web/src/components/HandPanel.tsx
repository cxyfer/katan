import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { RESOURCES, type Resource } from '@catan/rules';
import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { ResourceIcon } from './GameArt.tsx';
import { ResourceCardArt } from './ResourceCardArt.tsx';
import { DevCardPanel } from './DevCardPanel.tsx';
import type { TableController } from '../state/useTable.ts';
import '../styles/hand-fan.css';

/** 每種資源合併為一張計數卡；只讀取本人投影，檢視不送出遊戲命令。 */
export function handCardStyle(index: number, count: number): CSSProperties {
  const position = count <= 1 ? 0 : (index / (count - 1)) * 2 - 1;
  return { '--hand-position': position, '--hand-angle': `${position * 16}deg`, '--hand-arc': `${position * position * 24}px`, '--card-index': index } as CSSProperties;
}

export function HandPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const { state } = controller;
  const self = state.game?.view.players.find((player) => player.id === state.session?.id) ?? null;
  const resources = self?.resources;
  const totalHandCards = (self?.handSize ?? 0) + (self?.devCardCount ?? 0) + (self?.newDevCardCount ?? 0);
  const visibleCount = RESOURCES.length + (self?.devCards?.length ?? 0) + (self?.newDevCards?.length ?? 0);
  const [inspected, setInspected] = useState<Resource | null>(null);
  const [expanded, setExpanded] = useState(false);
  const handRef = useRef<HTMLElement>(null);
  const hoverRef = useRef(false);
  const touchOpenRef = useRef(false);
  const suppressClickRef = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const collapse = () => {
    cancelClose();
    touchOpenRef.current = false;
    hoverRef.current = false;
    // 先移回卡組本身，再收合；下一次 Tab 可重新展開第一張卡。
    handRef.current?.focus();
    setExpanded(false);
    setInspected(null);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      if (!hoverRef.current && !touchOpenRef.current && !handRef.current?.contains(document.activeElement)) {
        setExpanded(false);
        setInspected(null);
      }
    }, 320);
  };
  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !handRef.current?.contains(event.target)) {
        touchOpenRef.current = false;
        setExpanded(false);
        setInspected(null);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [expanded]);

  return (
    <section className="hand hand-fan" aria-labelledby="hand-heading" aria-describedby="hand-hint" data-testid="hand-panel"
      ref={handRef} tabIndex={0} data-expanded={expanded}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
        hoverRef.current = true;
        cancelClose();
        setExpanded(true);
      }}
      onPointerLeave={() => { hoverRef.current = false; scheduleClose(); }}
      onPointerDownCapture={(event) => {
        if (event.pointerType !== 'touch') return;
        touchOpenRef.current = true;
        if (!expanded) {
          suppressClickRef.current = true;
          setExpanded(true);
        }
      }}
      onPointerCancelCapture={() => { suppressClickRef.current = false; }}
      onClickCapture={(event) => {
        if (suppressClickRef.current || !expanded) {
          suppressClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
          setExpanded(true);
        }
      }}
      onFocusCapture={() => { cancelClose(); setExpanded(true); }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          touchOpenRef.current = false;
          scheduleClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); collapse(); }
        if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
          event.preventDefault();
          setExpanded(true);
          handRef.current?.querySelector<HTMLButtonElement>('.resource-card__inspect')?.focus();
        }
      }}
    >
      <h2 id="hand-heading" className="visually-hidden">{t('play.hand')} · {t('play.handSize')}: {formatNumber(state.locale, totalHandCards)}</h2>
      <p id="hand-hint" className="visually-hidden">{t('table.handFanHint')}</p>
      <div className="hand__content" id="hand-content">
        {totalHandCards === 0 && <p className="hand__empty muted">{t('play.handEmpty')}</p>}
        <ul className="resource-list" aria-label={t('table.resources')}>
          {RESOURCES.map((resource, index) => {
            const count = resources?.[resource];
            const countLabel = count === undefined ? '—' : formatNumber(state.locale, count);
            const isInspected = inspected === resource;
            return (
              <li key={resource} className={`hand-fan__card resource-card resource-card--${resource}${count === 0 ? ' resource-card--empty' : ''}${count === undefined ? ' resource-card--missing' : ''}${isInspected ? ' resource-card--inspected' : ''}`}
                style={handCardStyle(index, visibleCount)} data-testid={`resource-${resource}`}>
                <button type="button" className="resource-card__inspect"
                  aria-label={t('table.resourceCard', { resource: t(`resource.${resource}`), count: countLabel })}
                  aria-pressed={isInspected} aria-describedby={`hand-hint resource-use-${resource}`}
                  onClick={() => setInspected((current) => current === resource ? null : resource)}>
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
        <DevCardPanel controller={controller} embedded handExpanded={expanded} handStyle={(index) => handCardStyle(index, visibleCount)} />
        <button type="button" className="hand-fan__close" onClick={collapse} tabIndex={expanded ? 0 : -1}
          aria-label={t('table.collapseHand')}>⌄</button>
      </div>
    </section>
  );
}
