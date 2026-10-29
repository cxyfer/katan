import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { playerColorHex, seatDash } from '../board/terrain.ts';
import { GameIcon } from './GameArt.tsx';
import type { TableController } from '../state/useTable.ts';
import '../styles/scoreboard-hover.css';

/** 玩家列只使用公開投影；個人真實分數僅在本人座位呈現。 */
export function PlayersPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const { state } = controller;
  const view = state.game?.view;
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const expanded = pinned || previewOpen;
  const panelRef = useRef<HTMLElement>(null);
  const pointerInside = useRef(false);
  const focusInside = useRef(false);
  const pointerFocus = useRef(false);
  const restoringFocus = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    clearClose();
    closeTimer.current = setTimeout(() => {
      if (!pointerInside.current && !focusInside.current) setPreviewOpen(false);
    }, 320);
  };
  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) {
        clearClose();
        setPreviewOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => {
      clearClose();
      document.removeEventListener('pointerdown', dismissOutside);
    };
  }, []);
  const id = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  if (!view) return null;

  const selfId = state.session?.id ?? null;
  const nameOf = (playerId: string | null) => playerId
    ? (view.players.find((player) => player.id === playerId)?.nickname ?? playerId)
    : t('play.award.none');
  const headingId = `players-heading-${id}`;
  const awardsId = `players-awards-${id}`;
  const detailsIdForSeat = (seat: number) => `players-details-${id}-${seat}`;
  const detailsIds = [...view.players.map((player) => detailsIdForSeat(player.seat)), awardsId].join(' ');

  return (
    <section
      ref={panelRef}
      className="panel players"
      aria-labelledby={headingId}
      data-testid="players-panel"
      data-expanded={expanded ? 'true' : 'false'}
      data-pinned={pinned ? 'true' : 'false'}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return;
        pointerInside.current = true;
        clearClose();
        setPreviewOpen(true);
      }}
      onPointerLeave={() => {
        pointerInside.current = false;
        scheduleClose();
      }}
      onPointerDown={() => { pointerFocus.current = true; focusInside.current = false; }}
      onPointerUp={() => { pointerFocus.current = false; }}
      onPointerCancel={() => { pointerFocus.current = false; }}
      onFocus={() => {
        focusInside.current = !pointerFocus.current;
        clearClose();
        if (!restoringFocus.current && !pointerFocus.current) setPreviewOpen(true);
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        focusInside.current = false;
        pointerFocus.current = false;
        scheduleClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded) {
          event.preventDefault();
          clearClose();
          setPinned(false);
          setPreviewOpen(false);
          restoringFocus.current = true;
          toggleRef.current?.focus();
          restoringFocus.current = false;
        }
      }}
    >
      <header className="players__header">
        <h2 id={headingId} className="players__heading"><GameIcon name="users" size={17} />{t('play.seats')}<span className="players__target">{t('play.resultTarget', { target: formatNumber(state.locale, view.victoryTarget) })}</span></h2>
        <button
          ref={toggleRef}
          className="players__toggle"
          type="button"
          data-testid="players-toggle"
          aria-expanded={expanded}
          aria-controls={detailsIds}
          aria-label={t(expanded ? 'table.collapsePlayers' : 'table.expandPlayers')}
          onClick={() => {
            clearClose();
            if (expanded) setPinned(false);
            setPreviewOpen(!expanded);
          }}
        >
          <GameIcon name="chevron-right" size={17} />
        </button>
        <button
          className="players__pin"
          type="button"
          data-testid="players-pin"
          aria-pressed={pinned}
          aria-controls={detailsIds}
          aria-label={t(pinned ? 'table.playersUnpin' : 'table.playersPin')}
          title={t(pinned ? 'table.playersUnpin' : 'table.playersPin')}
          onClick={() => {
            clearClose();
            setPinned(!pinned);
            if (!pinned || pointerInside.current || focusInside.current) setPreviewOpen(true);
            else scheduleClose();
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 3 9 3-3 6 2 4-6-2-6 3 2-6 2-8ZM11 14l-7 7" /></svg>
        </button>
      </header>
      <ol className="seat-list" data-testid="seat-list">
        {view.players.map((player) => {
          const isTurn = view.turn.playerId === player.id;
          const isSelf = player.id === selfId;
          const total = isSelf ? (player.ownScore ?? player.publicScore) : player.publicScore;
          const buildings = view.board.buildings.filter((building) => building?.player === player.id);
          const settlements = buildings.filter((building) => !building!.city).length;
          const cities = buildings.filter((building) => building!.city).length;
          const hiddenVp = isSelf ? [...(player.devCards ?? []), ...(player.newDevCards ?? [])].filter((card) => card === 'victoryPoint').length : 0;
          const hiddenBonus = isSelf && player.ownScore !== undefined ? Math.max(0, player.ownScore - player.publicScore - hiddenVp) : 0;
          const scoreLabel = t(isSelf && player.ownScore !== undefined ? 'play.ownScore' : 'play.publicScore');
          const compactLabel = `${player.nickname}${isTurn ? `, ${t('play.turnOwner')}` : ''}`;
          return (
            <li
              key={player.id}
              className={`seat${isTurn ? ' seat--turn' : ''}${isSelf ? ' seat--self' : ''}`}
              style={{ '--player-color': playerColorHex(player.color) } as CSSProperties}
              data-testid={`seat-${player.seat}`}
              data-board-seat={player.id}
              data-turn={isTurn ? 'true' : 'false'}
              data-self={isSelf ? 'true' : 'false'}
              title={compactLabel}
            >
              <span className="seat__swatch" aria-hidden="true" style={{ backgroundColor: playerColorHex(player.color), borderStyle: seatDash(player.seat) ? 'dashed' : 'solid' }}>{Array.from(player.nickname)[0]}</span>
              <span className="seat__identity"><span className="seat__name">{player.nickname}{isSelf ? ` (${t('app.you')})` : ''}</span>{isTurn && <span className="badge">{t('play.turnOwner')}</span>}</span>
              <span className="seat__score" title={scoreLabel}><GameIcon name="crown" size={15} /><span className="visually-hidden">{scoreLabel}: </span>{formatNumber(state.locale, total)}</span>
              <div className="players__details" id={detailsIdForSeat(player.seat)} hidden={!expanded}>
                <dl className="players__breakdown" aria-label={t('table.playersBreakdown')}>
                  <div><dt>{t('table.playersSettlements', { count: formatNumber(state.locale, settlements) })}</dt><dd>{formatNumber(state.locale, settlements)}</dd></div>
                  <div><dt>{t('table.playersCities', { count: formatNumber(state.locale, cities) })}</dt><dd>{formatNumber(state.locale, cities * 2)}</dd></div>
                  <div><dt>{t('play.award.longestRoad')}</dt><dd>{formatNumber(state.locale, view.awards.longestRoad === player.id ? 2 : 0)}</dd></div>
                  <div><dt>{t('play.award.largestArmy')}</dt><dd>{formatNumber(state.locale, view.awards.largestArmy === player.id ? 2 : 0)}</dd></div>
                  {player.bonusPoints > 0 && <div><dt>{t('table.playersBonus')}</dt><dd>{formatNumber(state.locale, player.bonusPoints)}</dd></div>}
                  {isSelf && <div data-testid="players-hidden-vp"><dt>{t('table.playersHiddenVp')}</dt><dd>{formatNumber(state.locale, hiddenVp)}</dd></div>}
                  {hiddenBonus > 0 && <div><dt>{t('table.playersHiddenBonus')}</dt><dd>{formatNumber(state.locale, hiddenBonus)}</dd></div>}
                  <div className="players__breakdown-total"><dt>{scoreLabel}</dt><dd>{formatNumber(state.locale, total)}</dd></div>
                </dl>
                <span className="seat__inventory">
                  <span title={t('play.handSize')}><GameIcon name="cards" size={14} /><span className="visually-hidden">{t('play.handSize')}: </span>{formatNumber(state.locale, player.handSize)}</span>
                  <span title={t('play.devCardCount')}><GameIcon name="book" size={14} /><span className="visually-hidden">{t('play.devCardCount')}: </span>{formatNumber(state.locale, player.devCardCount)}</span>
                  {isSelf && player.ownScore !== undefined && <span className="seat__own-score" title={t('play.ownScore')}><GameIcon name="shield" size={14} /><span className="visually-hidden">{t('play.ownScore')}: </span>{formatNumber(state.locale, player.ownScore)}</span>}
                </span>
                <span className="seat__details">
                  <span title={t('play.knightsPlayed')}><GameIcon name="shield" size={13} /><span className="visually-hidden">{t('play.knightsPlayed')}: </span>{formatNumber(state.locale, player.playedKnights)}</span>
                  <span title={t('play.longestRoadLength')}><GameIcon name="trade" size={13} /><span className="visually-hidden">{t('play.longestRoadLength')}: </span>{formatNumber(state.locale, player.longestRoadLength)}</span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {view.turn.pairedActor === 2 && <p className="badge players__paired-actor" data-testid="paired-actor">{t('play.pairedActor', { actor: 2 })}</p>}
      <div className="players__awards" id={awardsId} hidden={!expanded}>
        <details open={expanded}>
          <summary><GameIcon name="crown" size={14} /> {t('play.awards')} · {t('play.phase.' + view.turn.phase)}</summary>
          <ul className="award-list" data-testid="award-list">
            <li>{t('play.award.longestRoad')}: {nameOf(view.awards.longestRoad)}</li>
            <li>{t('play.award.largestArmy')}: {nameOf(view.awards.largestArmy)}</li>
          </ul>
          <p className="muted">{t('play.production')}: {formatNumber(state.locale, view.seq)} · {t('play.phase.' + view.turn.phase)}</p>
        </details>
      </div>
    </section>
  );
}
