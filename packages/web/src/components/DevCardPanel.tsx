import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n/context.tsx';
import { blocksNewCommands } from '../state/commands.ts';
import { followUpsHeld } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { GameIcon } from './GameArt.tsx';
import { DevCardArt } from './DevCardArt.tsx';
import '../styles/card-drag.css';

const PLAYABLE = new Set(['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly']);
const CARD_ICONS: Record<string, string> = { knight: 'shield', roadBuilding: 'route', yearOfPlenty: 'sparkles', monopoly: 'scales', victoryPoint: 'crown' };
/** 指標移動超過這個距離才算開始拖曳，避免點一下檢視時誤觸。 */
const DRAG_THRESHOLD = 10;
/** 卡片要拖離手牌上緣這麼遠才算放到桌面上。 */
const DROP_MARGIN = 24;

interface DragTrack {
  id: string;
  card: string;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  /** 指標高於這條線（拖曳開始時的手牌上緣）就會打出。 */
  dropLine: number;
  active: boolean;
}
interface DragView { id: string; card: string; x: number; y: number; armed: boolean }

/**
 * 發展卡：仿卡牌遊戲，把手上可用的卡拖離手牌、放到桌面中央就打出；點卡片放大檢視時
 * 另有「使用」按鈕，供鍵盤與輔助科技使用。新購卡與勝利點數卡只顯示狀態；
 * 伺服器仍是出牌規則的唯一權威。
 */
export function DevCardPanel({ controller, embedded = false, handStyle, handExpanded, onCardDrag }: {
  controller: TableController; embedded?: boolean; handStyle?: (index: number) => CSSProperties; handExpanded?: boolean;
  /** 拖曳開始／結束時通知手牌，讓扇形維持展開並略過滑動切換與拖曳後的點擊。 */
  onCardDrag?: (phase: 'start' | 'cancel' | 'drop') => void;
}) {
  const t = useT();
  const { state, actions } = controller;
  const [inspected, setInspected] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragView | null>(null);
  const trackRef = useRef<DragTrack | null>(null);
  useEffect(() => { if (handExpanded === false) setInspected(null); }, [handExpanded]);
  const selfId = state.session?.id ?? null;
  const view = state.game?.view ?? null;
  const self = view?.players.find((player) => player.id === selfId) ?? null;
  // 擲骰演出期間一律不可用，避免由是否待處理（七點）透露點數。
  const playable = !!view && !followUpsHeld(state) && view.turn.playerId === selfId && !view.turn.devCardPlayed && view.pending === null;
  const draggable = playable && !blocksNewCommands(state.command);
  const held = self?.devCards ?? [];
  const fresh = self?.newDevCards ?? [];

  const play = (card: string) => {
    setInspected(null);
    if (card === 'knight') {
      actions.selectTarget({ kind: 'hex', index: null, commandType: 'dev.playKnight', labelId: 'devCard.knight' });
      return;
    }
    // 壟斷與豐收之年先在畫面上方選資源，確認後才送出。
    if (card === 'monopoly' || card === 'yearOfPlenty') {
      actions.setDevCardChoice({ card, queued: [] });
      return;
    }
    void actions.submitCommand({ type: `dev.play${card[0]!.toUpperCase()}${card.slice(1)}` }, `devCard.${card}`);
  };

  const endDrag = (commit: boolean) => {
    const track = trackRef.current;
    trackRef.current = null;
    if (!track?.active) return;
    setDrag(null);
    const dropped = commit && draggable;
    onCardDrag?.(dropped ? 'drop' : 'cancel');
    if (dropped) play(track.card);
  };
  // 拖曳中按 Escape 取消，卡片回到手牌。
  useEffect(() => {
    if (!drag) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      endDrag(false);
    };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  });
  // 拖到一半失去出牌資格（例如回合結束）時直接取消。
  useEffect(() => { if (!draggable && trackRef.current) endDrag(false); }, [draggable]);

  const dragHandlers = (id: string, card: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      trackRef.current = {
        id, card, pointerId: event.pointerId, pointerType: event.pointerType, startX: event.clientX, startY: event.clientY,
        dropLine: 0, active: false,
      };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      const track = trackRef.current;
      if (!track || track.pointerId !== event.pointerId) return;
      if (!track.active) {
        const dx = event.clientX - track.startX;
        const dy = event.clientY - track.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        // 觸控時左右滑動是逐張檢視手牌，只有往上推才是拖曳出牌。
        if (track.pointerType === 'touch' && !(dy < 0 && Math.abs(dy) > Math.abs(dx))) {
          trackRef.current = null;
          return;
        }
        track.active = true;
        // 開始拖曳時才量手牌上緣：按下的那一刻扇形可能還在收合（觸控第一下才展開）。
        const hand = event.currentTarget.closest('.hand') ?? event.currentTarget;
        track.dropLine = hand.getBoundingClientRect().top - DROP_MARGIN;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setInspected(null);
        onCardDrag?.('start');
      }
      event.preventDefault();
      setDrag({ id: track.id, card: track.card, x: event.clientX, y: event.clientY, armed: event.clientY < track.dropLine });
    },
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      const track = trackRef.current;
      if (!track || track.pointerId !== event.pointerId) return;
      endDrag(event.clientY < track.dropLine);
    },
    onPointerCancel: () => endDrag(false),
    onLostPointerCapture: () => { if (trackRef.current?.active) endDrag(false); },
  });

  const cardView = (card: string, index: number, isNew: boolean) => {
    const id = `${isNew ? 'new' : 'held'}-${index}`;
    const canDrag = embedded && draggable && !isNew && PLAYABLE.has(card);
    // 牌面與資源牌同一套卡框：插畫、左上角徽記、名稱緞帶與效果說明；新購卡另加標籤。
    const face = <>
      <span className="development-card__art"><DevCardArt card={card} /></span>
      <span className="development-card__pip"><GameIcon name={CARD_ICONS[card] ?? 'book'} size={15} /></span>
      {isNew && <span className="development-card__tag" aria-hidden="true">{t('table.newCardTag')}</span>}
      <strong className="development-card__name">{t(`devCard.${card}`)}</strong>
      <span className="development-card__effect">{t(`devCard.effect.${card}`)}</span>
      <span className="development-card__state visually-hidden">{isNew ? t('play.newDevCards') : t('table.heldCards')}</span>
      {canDrag && <span className="visually-hidden">{t('devCard.dragHint')}</span>}
    </>;
    return <li onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInspected(null); }} key={`${card}-${index}`} style={handStyle?.(index + (isNew ? held.length : 0))}
      data-draggable={canDrag ? 'true' : undefined}
      className={`development-card development-card--${card}${embedded ? ' hand-fan__card' : ''}${isNew ? ' development-card--new' : ''}${inspected === id ? ' development-card--inspected' : ''}${drag?.id === id ? ' development-card--lifted' : ''}`}>
      {embedded ? <button type="button" className="development-card__inspect" aria-pressed={inspected === id}
        aria-label={`${t('table.inspectCard', { card: t(`devCard.${card}`) })} · ${isNew ? t('play.newDevCards') : t('table.heldCards')}`}
        onClick={() => setInspected((current) => current === id ? null : id)}
        {...(canDrag ? dragHandlers(id, card) : {})}>{face}</button> : face}
      {!isNew && PLAYABLE.has(card) && <button type="button" className="button development-card__play"
        data-testid={`play-${card}-${index}`} disabled={!playable} onClick={() => play(card)}>
        {t('play.playCard', { card: t(`devCard.${card}`) })}
      </button>}
    </li>;
  };

  // 拖曳中的卡與桌面中央的放置區掛在遊戲舞台上，才不會被手牌的 overflow 裁掉，全螢幕時也看得到。
  const stage = typeof document === 'undefined' ? null : document.querySelector('[data-board-stage]') ?? document.body;
  const dragLayer = drag && stage ? createPortal(<div className="card-drag" data-testid="card-drag" data-armed={drag.armed ? 'true' : undefined}>
    <div className="card-drag__zone" data-testid="card-drop-zone" aria-hidden="true">
      <GameIcon name={CARD_ICONS[drag.card] ?? 'book'} size={28} />
      <span>{t(drag.armed ? 'devCard.dropRelease' : 'devCard.dropHere', { card: t(`devCard.${drag.card}`) })}</span>
    </div>
    <div className={`card-drag__ghost development-card--${drag.card}`} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
      <span className="card-drag__art"><DevCardArt card={drag.card} /></span>
      <span className="card-drag__pip"><GameIcon name={CARD_ICONS[drag.card] ?? 'book'} size={14} /></span>
      <strong className="card-drag__name">{t(`devCard.${drag.card}`)}</strong>
    </div>
  </div>, stage) : null;

  return (
    <section className={embedded ? 'devcards devcards--hand' : 'panel devcards'} aria-labelledby="devcards-heading" data-testid="devcards-panel">
      <h2 id="devcards-heading" className={embedded ? 'visually-hidden' : undefined}>{t('play.devCards')}</h2>
      {held.length === 0 && fresh.length === 0 && <p className="muted">{t('play.devCardsEmpty')}</p>}
      <div className="development-lists" tabIndex={!embedded && held.length + fresh.length > 0 ? 0 : undefined}>
        {held.length > 0 && <ul className="card-list" aria-label={t('play.devCards')}>{held.map((card, index) => cardView(card, index, false))}</ul>}
        {fresh.length > 0 && <ul className="card-list" data-testid="new-devcards" aria-label={t('play.newDevCards')}>{fresh.map((card, index) => cardView(card, index, true))}</ul>}
      </div>
      {state.command?.status === 'unknown' && <p className="muted" data-testid="devcard-unknown">{t('command.retryUnavailable')}</p>}
      {dragLayer}
    </section>
  );
}
