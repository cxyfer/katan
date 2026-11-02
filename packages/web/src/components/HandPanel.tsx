import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { CARD_KINDS, RESOURCES, type CardKind } from '@catan/rules';
import { citiesKnightsView } from '../board/citiesKnights.ts';
import { CardKindArt, CardKindGlyph } from './CardKindArt.tsx';
import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { GameIcon } from './GameArt.tsx';
import { DevCardPanel } from './DevCardPanel.tsx';
import { HandGainOverlay } from './HandGainOverlay.tsx';
import { useHandGains } from './useHandGains.ts';
import { shownHand, shownHandSize } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import '../styles/hand-fan.css';

const CARD_FACES = '.hand-card__face, .development-card__inspect';
/** 不同種類的牌之間多留的間距（以一張牌的步距為單位）。 */
const GROUP_GAP = 0.6;

/** 依群組排出扇形位置：同種牌相鄰、群組間留空；張數少時扇形自動收窄。 */
export function handFanStyles(groups: readonly number[]): CSSProperties[] {
  const slots: number[] = [];
  let slot = 0;
  for (const size of groups) {
    if (size <= 0) continue;
    for (let card = 0; card < size; card += 1) slots.push(slot++);
    slot += GROUP_GAP;
  }
  const span = slots.at(-1) ?? 0;
  const tilt = Math.min(16, span * 2.4);
  const arc = Math.min(24, span * 3);
  return slots.map((value, index) => {
    const position = span === 0 ? 0 : (value / span) * 2 - 1;
    return { '--hand-position': position, '--hand-span': span, '--hand-angle': `${position * tilt}deg`,
      '--hand-arc': `${position * position * arc}px`, '--card-index': index } as CSSProperties;
  });
}

export function HandPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const { state } = controller;
  const self = state.game?.view.players.find((player) => player.id === state.session?.id) ?? null;
  // 擲骰演出期間顯示擲骰前的數量，點數揭曉前不從手牌透露結果。
  // Cities & Knights: commodities are hand cards next to the resources.
  const commodities = citiesKnightsView(state.game?.view) ? self?.commodities : undefined;
  const kinds: readonly CardKind[] = commodities ? CARD_KINDS : RESOURCES;
  const resources: Partial<Record<CardKind, number>> | undefined = commodities ? { ...shownHand(state), ...commodities } : shownHand(state);
  const resourceCards = self ? shownHandSize(state, self) : 0;
  const totalHandCards = resourceCards + (self?.devCardCount ?? 0) + (self?.newDevCardCount ?? 0);
  // 沒有牌可看時，收合的 deck 不再提供展開入口，避免玩家誤以為展開後是一片空白。
  const canExpand = totalHandCards > 0;
  // 仿實體手牌：只列出持有的資源，每一張都是獨立的卡。
  const held = kinds.flatMap((resource) => Array.from({ length: resources?.[resource] ?? 0 }, (_, copy) => ({ resource, copy })));
  const heldDev = self?.devCards?.length ?? 0;
  const fanStyles = handFanStyles([...kinds.map((resource) => resources?.[resource] ?? 0), heldDev, self?.newDevCards?.length ?? 0]);
  const [inspected, setInspected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const fanExpanded = expanded && canExpand;
  const handRef = useRef<HTMLElement>(null);
  const tallyRef = useRef<HTMLUListElement>(null);
  const gains = useHandGains(state.game, state.gameSync, state.session?.id ?? null, state.connection === 'online', state.gameSyncPending,
    state.dicePresenting);
  const hoverRef = useRef(false);
  const touchOpenRef = useRef(false);
  const suppressClickRef = useRef(false);
  const swipeStartRef = useRef<number | null>(null);
  const focusedCardRef = useRef(0);
  const focusInsideRef = useRef(false);
  const tallyMemory = useRef<Record<string, { label: string; bumped: boolean }>>({});
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const inspectAdjacent = (direction: number) => {
    const faces = handRef.current?.querySelectorAll<HTMLButtonElement>(CARD_FACES);
    if (!faces?.length) return;
    const next = (focusedCardRef.current + direction + faces.length) % faces.length;
    setInspected(null);
    faces[next]?.focus();
  };
  const inspectEdge = (last: boolean) => {
    const faces = handRef.current?.querySelectorAll<HTMLButtonElement>(CARD_FACES);
    if (!faces?.length) return;
    setInspected(null);
    faces[last ? faces.length - 1 : 0]?.focus();
  };
  // 只在數字實際變動後播放跳動提示；首次掛載與無關的重新渲染都不觸發。
  const tallyBumped = (key: string, label: string) => {
    const previous = tallyMemory.current[key];
    if (!previous) tallyMemory.current[key] = { label, bumped: false };
    else if (previous.label !== label) tallyMemory.current[key] = { label, bumped: true };
    return tallyMemory.current[key]!.bumped;
  };
  const collapse = () => {
    cancelClose();
    touchOpenRef.current = false;
    hoverRef.current = false;
    // 先移回卡組本身，再收合；下一次 Tab 可重新展開第一張卡。
    if (canExpand) handRef.current?.focus();
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
  // 手牌中途清空（例如全部打出或丟棄）時，收合已展開的 deck 並清除殘留的互動狀態。
  useEffect(() => {
    if (canExpand) return;
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    hoverRef.current = false;
    touchOpenRef.current = false;
    suppressClickRef.current = false;
    swipeStartRef.current = null;
    focusInsideRef.current = false;
    setExpanded(false);
    setInspected(null);
  }, [canExpand]);
  const heldKey = held.map(({ resource, copy }) => `${resource}-${copy}`).join(' ');
  useLayoutEffect(() => {
    // 牌數減少時，被檢視或持有焦點的那張牌可能已卸載：清掉殘留的檢視狀態，並把焦點留在手牌內。
    if (inspected && !heldKey.split(' ').includes(inspected)) setInspected(null);
    const active = document.activeElement;
    if (focusInsideRef.current && (!active || active === document.body)) {
      const faces = handRef.current?.querySelectorAll<HTMLButtonElement>(CARD_FACES);
      if (faces?.length) faces[Math.min(focusedCardRef.current, faces.length - 1)]?.focus();
      // 空手牌仍保留程式化焦點（tabIndex -1），最後一張牌卸載時焦點不會掉回 body。
      else handRef.current?.focus();
    }
  }, [heldKey, canExpand]);
  useEffect(() => {
    if (!fanExpanded) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !handRef.current?.contains(event.target)) {
        touchOpenRef.current = false;
        setExpanded(false);
        setInspected(null);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [fanExpanded]);

  return (
    <><section className="hand hand-fan" aria-labelledby="hand-heading" aria-describedby={canExpand ? 'hand-hint' : undefined}
      data-testid="hand-panel" ref={handRef} tabIndex={canExpand ? 0 : -1} data-expanded={fanExpanded}
      data-empty={canExpand ? undefined : 'true'}
      onPointerEnter={(event) => {
        if (!canExpand) return;
        if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
        hoverRef.current = true;
        cancelClose();
        setExpanded(true);
      }}
      onPointerLeave={() => { if (!canExpand) return; hoverRef.current = false; scheduleClose(); }}
      onPointerDownCapture={(event) => {
        if (!canExpand) {
          suppressClickRef.current = false;
          swipeStartRef.current = null;
          return;
        }
        suppressClickRef.current = false;
        if (event.pointerType !== 'touch') return;
        touchOpenRef.current = true;
        swipeStartRef.current = event.target instanceof Element && event.target.closest(CARD_FACES) ? event.clientX : null;
        if (!expanded) {
          suppressClickRef.current = true;
          setExpanded(true);
        }
      }}
      onPointerUpCapture={(event) => {
        if (!canExpand) return;
        const start = swipeStartRef.current;
        swipeStartRef.current = null;
        if (event.pointerType === 'touch' && start !== null && Math.abs(event.clientX - start) > 32) {
          event.preventDefault();
          suppressClickRef.current = true;
          inspectAdjacent(event.clientX < start ? 1 : -1);
        }
      }}
      onPointerCancelCapture={() => { suppressClickRef.current = false; swipeStartRef.current = null; }}
      onClickCapture={(event) => {
        if (!canExpand) return;
        if (suppressClickRef.current || !expanded) {
          suppressClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
          setExpanded(true);
        }
      }}
      onFocusCapture={(event) => {
        if (!canExpand) return;
        focusInsideRef.current = true;
        cancelClose();
        // 焦點移到另一張牌時，先前放大檢視的資源牌回到扇形中。
        if (!event.target.closest('.hand-card--inspected')) setInspected(null);
        setExpanded(true);
        const face = event.target.closest('.hand-fan__card')?.querySelector(CARD_FACES);
        if (face) {
          const faces = Array.from(event.currentTarget.querySelectorAll(CARD_FACES));
          focusedCardRef.current = faces.indexOf(face);
        }
      }}
      onBlurCapture={(event) => {
        if (!canExpand) return;
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          focusInsideRef.current = false;
          touchOpenRef.current = false;
          scheduleClose();
        }
      }}
      onKeyDown={(event) => {
        if (!canExpand || event.defaultPrevented) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); collapse(); }
        // 同種資源只佔一個 Tab 停駐點；方向鍵與 Home／End 逐張瀏覽整副手牌。
        if (event.target instanceof Element && event.target.matches(CARD_FACES)) {
          const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
          if (step !== undefined) { event.preventDefault(); inspectAdjacent(step); }
          if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); inspectEdge(event.key === 'End'); }
        }
        if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
          event.preventDefault();
          setExpanded(true);
          handRef.current?.querySelector<HTMLButtonElement>(CARD_FACES)?.focus();
        }
      }}
    >
      <h2 id="hand-heading" className="visually-hidden">{t('play.hand')} · {t('play.handSize')}: {formatNumber(state.locale, totalHandCards)}</h2>
      {canExpand && <p id="hand-hint" className="visually-hidden">{t('table.handFanHint')}</p>}
      <div className="hand__content" id="hand-content">
        {totalHandCards === 0 && <p className="hand__empty muted">{t('play.handEmpty')}</p>}
        <ul className="hand-card-list" aria-label={t('table.resources')}>
          {held.map(({ resource, copy }, index) => {
            const id = `${resource}-${copy}`;
            const isInspected = inspected === id;
            return (
              <li key={id} className={`hand-fan__card hand-card hand-card--${resource}${isInspected ? ' hand-card--inspected' : ''}`}
                style={fanStyles[index]} data-testid={`resource-card-${resource}-${copy}`} data-resource={resource}>
                <button type="button" className="hand-card__face" tabIndex={copy === 0 ? undefined : -1}
                  aria-label={t('table.resourceCard', { resource: t(`resource.${resource}`), index: formatNumber(state.locale, copy + 1), count: formatNumber(state.locale, resources?.[resource] ?? 0) })}
                  aria-pressed={isInspected} aria-describedby={`hand-card-use-${id}`}
                  onClick={() => setInspected((current) => current === id ? null : id)}>
                  <span className="hand-card__art"><CardKindArt card={resource} /></span>
                  <span className="hand-card__pip"><CardKindGlyph card={resource} size={17} /></span>
                  <span className="hand-card__name">{t(`resource.${resource}`)}</span>
                  <span id={`hand-card-use-${id}`} className="hand-card__use">{t(`table.resourceUse.${resource}`)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <DevCardPanel controller={controller} embedded handExpanded={fanExpanded} handStyle={(index) => fanStyles[held.length + index] ?? {}} />
        {fanExpanded && <button type="button" className="hand-fan__close" onClick={collapse}
          aria-label={t('table.collapseHand')}>⌄</button>}
      </div>
    </section>
      <ul className="resource-tally" ref={tallyRef} aria-label={t('table.resourceTally')} data-testid="resource-tally">
        {kinds.map((resource) => {
          const count = resources?.[resource];
          const label = count === undefined ? '—' : formatNumber(state.locale, count);
          return (
            <li key={resource} className={`resource-tally__item resource-tally__item--${resource}${count ? '' : ' resource-tally__item--empty'}`}
              data-testid={`resource-${resource}`}>
              <span className="resource-tally__icon"><CardKindGlyph card={resource} size={16} /></span>
              <span className="visually-hidden">{t(`resource.${resource}`)}</span>
              {/* 以數量為 key，數字變動時重新掛載才會重播跳動提示。 */}
              <span key={label} className={`resource-tally__count${tallyBumped(resource, label) ? ' resource-tally__count--bump' : ''}`}>{label}</span>
            </li>
          );
        })}
        <li className="resource-tally__item resource-tally__item--total" data-testid="resource-tally-total">
          <span className="resource-tally__icon"><GameIcon name="cards" size={15} /></span>
          <span className="visually-hidden">{t('play.handSize')}</span>
          {(() => {
            const label = formatNumber(state.locale, totalHandCards);
            return <span key={label} className={`resource-tally__count${tallyBumped('total', label) ? ' resource-tally__count--bump' : ''}`}>{label}</span>;
          })()}
        </li>
      </ul>
      <HandGainOverlay gains={gains} anchorRef={tallyRef} />
    </>
  );
}
