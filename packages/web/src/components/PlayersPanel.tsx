import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { playerColorHex, seatDash } from '../board/terrain.ts';
import { botBadgeLabel, botLevelsOf } from '../state/bots.ts';
import { requiredActionFor } from '../state/pending.ts';
import { shownHandSize } from '../state/table.ts';
import { islandBonusPoints, seafarersView } from '../board/seafarers.ts';
import { activeStrength, citiesKnightsPoints, citiesKnightsView } from '../board/citiesKnights.ts';
import { GameIcon } from './GameArt.tsx';
import type { TableController } from '../state/useTable.ts';
import '../styles/scoreboard-hover.css';
import '../styles/bot-seats.css';

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

function TurnFlag({ floating }: { floating: boolean }) {
  const t = useT();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [overlay, setOverlay] = useState<{ host: HTMLElement; left: number; top: number; visible: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!floating) { setOverlay(null); return; }
    const anchor = anchorRef.current;
    const host = anchor?.closest<HTMLElement>('.game__table');
    const list = anchor?.closest<HTMLElement>('.seat-list');
    const panel = anchor?.closest<HTMLElement>('.players');
    if (!anchor || !host || !list || !panel) return;
    const measure = () => {
      const flag = anchor.getBoundingClientRect();
      const root = host.getBoundingClientRect();
      const clip = list.getBoundingClientRect();
      setOverlay({ host, left: flag.left - root.left, top: flag.top - root.top,
        visible: flag.top >= clip.top && flag.bottom <= clip.bottom });
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const node of [host, panel, list]) observer.observe(node);
    globalThis.addEventListener('resize', measure);
    globalThis.addEventListener('scroll', measure, true);
    return () => {
      observer.disconnect();
      globalThis.removeEventListener('resize', measure);
      globalThis.removeEventListener('scroll', measure, true);
    };
  }, [floating]);
  const contents = <><GameIcon name="flag" size={15} /><span className="visually-hidden">{t('play.turnOwner')}</span></>;
  return <>
    <span ref={anchorRef} className="seat__turn" data-testid={overlay ? undefined : 'seat-turn-flag'}
      title={t('play.turnOwner')} aria-hidden={overlay ? true : undefined}
      style={overlay ? { visibility: 'hidden' } : undefined}>{contents}</span>
    {overlay && createPortal(
      <span className="seat-turn-overlay" data-testid="seat-turn-flag" title={t('play.turnOwner')}
        hidden={!overlay.visible} style={{ left: overlay.left, top: overlay.top }}>{contents}</span>,
      overlay.host,
    )}
  </>;
}

/** 玩家列只使用公開投影；個人真實分數僅在本人座位呈現。 */
export function PlayersPanel({ controller, onExpand, collapseRequested = false, floatingTurnFlag = false }: {
  controller: TableController; onExpand?: () => void; collapseRequested?: boolean; floatingTurnFlag?: boolean;
}) {
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
  useEffect(() => {
    if (expanded) onExpand?.();
  }, [expanded, onExpand]);
  useEffect(() => {
    if (!collapseRequested) return;
    clearClose();
    pointerInside.current = false;
    focusInside.current = false;
    setPinned(false);
    setPreviewOpen(false);
    if (panelRef.current?.contains(document.activeElement)) {
      restoringFocus.current = true;
      toggleRef.current?.focus();
      restoringFocus.current = false;
    }
  }, [collapseRequested]);
  if (!view) return null;

  const selfId = state.session?.id ?? null;
  const action = requiredActionFor(state);
  const players = [...view.players].sort((left, right) => left.seat - right.seat);
  // 投影不含座位類型，電腦座位由房間成員判斷。
  const bots = botLevelsOf(state.room);
  const headingId = `players-heading-${id}`;
  const detailsIdForSeat = (seat: number) => `players-details-${id}-${seat}`;
  const detailsIds = players.map((player) => detailsIdForSeat(player.seat)).join(' ');

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
      // 觸控的相容性 mousedown 可能在 pointerup 後才觸發焦點。
      onMouseDown={() => { pointerFocus.current = true; focusInside.current = false; }}
      onMouseUp={() => { pointerFocus.current = false; }}
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
          hidden={!expanded}
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
        {players.map((player) => {
          const isTurn = view.turn.playerId === player.id;
          const isSelf = player.id === selfId;
          const total = isSelf ? (player.ownScore ?? player.publicScore) : player.publicScore;
          const buildings = view.board.buildings.filter((building) => building?.player === player.id);
          const settlements = buildings.filter((building) => !building!.city).length;
          const cities = buildings.filter((building) => building!.city).length;
          const hiddenVp = isSelf ? [...(player.devCards ?? []), ...(player.newDevCards ?? [])].filter((card) => card === 'victoryPoint').length : 0;
          const hiddenBonus = isSelf && player.ownScore !== undefined ? Math.max(0, player.ownScore - player.publicScore - hiddenVp) : 0;
          const scoreLabel = t(isSelf && player.ownScore !== undefined ? 'play.ownScore' : 'play.publicScore');
          const isBot = bots.has(player.id);
          const botLabel = isBot ? botBadgeLabel(t, bots.get(player.id)) : null;
          const compactLabel = `${player.nickname}${botLabel ? ` (${botLabel})` : ''}${isTurn ? `, ${t('play.turnOwner')}` : ''}`;
          const longestRoad = view.awards.longestRoad === player.id;
          const largestArmy = view.awards.largestArmy === player.id;
          // Seafarers: ships, Longest Trade Route and the per-island bonus.
          const sea = seafarersView(view);
          const ships = view.board.roads.filter((road) => road?.ship && road.player === player.id).length;
          const islandPoints = sea ? islandBonusPoints(view, player.id) : 0;
          const routeAward = t(sea ? 'sf.award.longestTradeRoute' : 'play.award.longestRoad');
          const number = (value: number) => formatNumber(state.locale, value);
          // Cities & Knights: no development cards or Largest Army; metropolises, defender points and knights instead.
          const ck = citiesKnightsView(view);
          const ckPoints = ck ? citiesKnightsPoints(view, player.id) : null;
          return (
            <li
              key={player.id}
              className={`seat${isTurn ? ' seat--turn' : ''}${isSelf ? ' seat--self' : ''}`}
              style={{ '--player-color': playerColorHex(player.color) } as CSSProperties}
              data-testid={`seat-${player.seat}`}
              data-board-seat={player.id}
              data-turn={isTurn ? 'true' : 'false'}
              data-self={isSelf ? 'true' : 'false'}
              data-bot={isBot ? 'true' : undefined}
              title={compactLabel}
            >
              <div className="seat__summary">
                <span className="seat__swatch" aria-hidden="true" style={{ backgroundColor: playerColorHex(player.color), borderStyle: seatDash(player.seat) ? 'dashed' : 'solid' }}>
                  {Array.from(player.nickname)[0]}
                  {/* 電腦標記固定放在頭像角落，避免徽章在展開時把名稱擠成兩行。 */}
                  {isBot && (
                    <span className="seat__bot-mark" data-testid={`seat-bot-mark-${player.seat}`}><GameIcon name="bot" size={9} /></span>
                  )}
                </span>
                {isBot && !expanded && <span className="visually-hidden">{`${player.nickname} (${botLabel})`}</span>}
                <span className="seat__identity" hidden={!expanded}>
                  <span className="seat__name" title={player.nickname}>{player.nickname}{isSelf ? ` (${t('app.you')})` : ''}</span>
                  {isBot && <span className="visually-hidden" data-testid={`seat-bot-${player.seat}`}>{` (${botLabel})`}</span>}
                </span>
                <span className={`seat__score${isSelf && player.ownScore !== undefined ? ' seat__own-score' : ''}`} title={scoreLabel}><GameIcon name="crown" size={15} /><span className="visually-hidden">{scoreLabel}: </span>{number(total)}</span>
              </div>
              <div className="players__details" id={detailsIdForSeat(player.seat)} hidden={!expanded}>
                <div className="players__stats" role="group" aria-label={t('table.playersBreakdown')}>
                  <ScoreMark icon="home" label={t('table.playersSettlements', { count: number(settlements) })} value={number(settlements)} />
                  <ScoreMark icon="city" label={t('table.playersCities', { count: number(cities) })} value={number(cities)} />
                  <ScoreMark icon="cards" label={t('play.handSize')} value={number(shownHandSize(state, player))} />
                  {ck
                    ? <ScoreMark icon="scroll" label={t('ck.score.progress')} value={number(ck.progressCounts[player.id] ?? 0)} testId={`players-progress-${player.seat}`} />
                    : <ScoreMark icon="book" label={t('play.devCardCount')} value={number(player.devCardCount)} />}
                  {sea && <ScoreMark icon="ship" label={t('sf.board.ship')} value={number(ships)} testId={`players-ships-${player.seat}`} />}
                  <ScoreMark icon="route" label={`${t('play.longestRoadLength')}${longestRoad ? ` · ${routeAward} (+2)` : ''}`}
                    value={number(player.longestRoadLength)} awarded={longestRoad} />
                  {ck && <ScoreMark icon="shield" label={t('ck.score.knights')} value={number(activeStrength(ck, player.id))} testId={`players-knights-${player.seat}`} />}
                  {!ck && <ScoreMark icon="shield" label={`${t('play.knightsPlayed')}${largestArmy ? ` · ${t('play.award.largestArmy')} (+2)` : ''}`}
                    value={number(player.playedKnights)} awarded={largestArmy} />}
                </div>
                <div className="players__bonuses">
                  {isSelf && <ScoreMark icon="crown" label={t('table.playersHiddenVp')} value={number(hiddenVp)} testId="players-hidden-vp" />}
                  {islandPoints > 0 && <ScoreMark icon="compass" testId={`players-islands-${player.seat}`}
                    label={`${t('sf.score.islands')} · ${t('sf.score.islandsValue', { count: number(sea!.islandBonus[player.id]?.length ?? 0), points: number(islandPoints) })}`}
                    value={number(islandPoints)} />}
                  {player.bonusPoints - islandPoints > 0 && <ScoreMark icon="flag" label={t('table.playersBonus')} value={number(player.bonusPoints - islandPoints)} />}
                  {ckPoints && ckPoints.metropolises > 0 && <ScoreMark icon="city" testId={`players-metropolis-${player.seat}`}
                    label={t('ck.score.metropolises', { points: number(ckPoints.metropolises) })} value={number(ckPoints.metropolises)} />}
                  {ckPoints && ckPoints.defenders > 0 && <ScoreMark icon="shield" testId={`players-defender-${player.seat}`}
                    label={t('ck.score.defender', { points: number(ckPoints.defenders) })} value={number(ckPoints.defenders)} />}
                  {ckPoints && ckPoints.progress > 0 && <ScoreMark icon="scroll" testId={`players-progress-vp-${player.seat}`}
                    label={t('ck.score.progressVp', { points: number(ckPoints.progress) })} value={number(ckPoints.progress)} />}
                  {hiddenBonus > 0 && <ScoreMark icon="sparkles" label={t('table.playersHiddenBonus')} value={number(hiddenBonus)} />}
                </div>
              </div>
              {isTurn && <TurnFlag floating={floatingTurnFlag} />}
            </li>
          );
        })}
      </ol>
      <p className="players__obligation" data-testid="turn-state" data-mine={action?.mine ? 'true' : 'false'}
        title={action ? t(action.messageId, action.params) : t('app.loading')}>
        <GameIcon name="flag" size={14} />
        <span className={expanded ? undefined : 'visually-hidden'}>{action ? t(action.messageId, action.params) : t('app.loading')}</span>
      </p>
      {view.turn.pairedActor === 2 && <p hidden={!expanded} className="badge players__paired-actor" data-testid="paired-actor">{t('play.pairedActor', { actor: 2 })}</p>}
    </section>
  );
}
