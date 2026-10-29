import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { playerColorHex, seatDash } from '../board/terrain.ts';
import { GameIcon } from './GameArt.tsx';
import type { TableController } from '../state/useTable.ts';
import '../styles/scoreboard-hover.css';

function ScoreMark({ icon, label, value, awarded = false, testId }: {
  icon: string; label: string; value: string; awarded?: boolean; testId?: string;
}) {
  return <span className={`score-mark${awarded ? ' score-mark--medal' : ''}`} role="img"
    aria-label={`${label}: ${value}`} title={`${label}: ${value}`} data-testid={testId}>
    <span className="score-mark__icon"><GameIcon name={icon} size={14} /></span>
    <span className="score-mark__value" aria-hidden="true">{value}</span>
    {awarded && <span className="score-mark__points" aria-hidden="true">+2</span>}
  </span>;
}

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
  const headingId = `players-heading-${id}`;
  const detailsIdForSeat = (seat: number) => `players-details-${id}-${seat}`;
  const detailsIds = view.players.map((player) => detailsIdForSeat(player.seat)).join(' ');

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
          const longestRoad = view.awards.longestRoad === player.id;
          const largestArmy = view.awards.largestArmy === player.id;
          const number = (value: number) => formatNumber(state.locale, value);
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
              <span className="seat__identity">
                <span className="seat__name" title={player.nickname}>{player.nickname}{isSelf ? ` (${t('app.you')})` : ''}</span>
                {isTurn && <span className="seat__turn" title={t('play.turnOwner')}><GameIcon name="flag" size={12} /><span className="visually-hidden">{t('play.turnOwner')}</span></span>}
              </span>
              <span className={`seat__score${isSelf && player.ownScore !== undefined ? ' seat__own-score' : ''}`} title={scoreLabel}><GameIcon name="crown" size={15} /><span className="visually-hidden">{scoreLabel}: </span>{number(total)}</span>
              <div className="players__details" id={detailsIdForSeat(player.seat)} hidden={!expanded}>
                <div className="players__stats" role="group" aria-label={t('table.playersBreakdown')}>
                  <ScoreMark icon="home" label={t('table.playersSettlements', { count: number(settlements) })} value={number(settlements)} />
                  <ScoreMark icon="city" label={t('table.playersCities', { count: number(cities) })} value={number(cities)} />
                  <ScoreMark icon="cards" label={t('play.handSize')} value={number(player.handSize)} />
                  <ScoreMark icon="book" label={t('play.devCardCount')} value={number(player.devCardCount)} />
                  <ScoreMark icon="route" label={`${t('play.longestRoadLength')}${longestRoad ? ` · ${t('play.award.longestRoad')} (+2)` : ''}`}
                    value={number(player.longestRoadLength)} awarded={longestRoad} />
                  <ScoreMark icon="shield" label={`${t('play.knightsPlayed')}${largestArmy ? ` · ${t('play.award.largestArmy')} (+2)` : ''}`}
                    value={number(player.playedKnights)} awarded={largestArmy} />
                </div>
                <div className="players__bonuses">
                  {isSelf && <ScoreMark icon="crown" label={t('table.playersHiddenVp')} value={number(hiddenVp)} testId="players-hidden-vp" />}
                  {player.bonusPoints > 0 && <ScoreMark icon="flag" label={t('table.playersBonus')} value={number(player.bonusPoints)} />}
                  {hiddenBonus > 0 && <ScoreMark icon="sparkles" label={t('table.playersHiddenBonus')} value={number(hiddenBonus)} />}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {view.turn.pairedActor === 2 && <p className="badge players__paired-actor" data-testid="paired-actor">{t('play.pairedActor', { actor: 2 })}</p>}
    </section>
  );
}
