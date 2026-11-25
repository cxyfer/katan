import { getProfile } from '@katan/rules';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n/context.tsx';
import { islandWording } from '../i18n/islandWording.ts';
import { formatNumber } from '../i18n/format.ts';
import { playerColorHex, resourceLetter, seatDash } from '../board/terrain.ts';
import { botBadgeLabel, botLevelsOf } from '../state/bots.ts';
import { requiredActionFor } from '../state/pending.ts';
import { epView } from '../board/explorersPirates.ts';
import { shownCitiesKnights, shownExplorersPirates, shownSeafarers, shownTradersBarbarians, shownHandSize } from '../state/table.ts';
import { clothPoints, harborRatio, islandBonusPoints, seafarersHints, seafarersView } from '../board/seafarers.ts';
import { activeStrength, citiesKnightsPoints, citiesKnightsView } from '../board/citiesKnights.ts';
import { GameIcon } from './GameArt.tsx';
import type { TableController } from '../state/useTable.ts';
import '../styles/scoreboard-hover.css';
import '../styles/bot-seats.css';
import '../styles/leave.css';

function ScoreMark({ icon, label, value, awarded = false, testId, detail }: {
  icon: string; label: string; value: string; awarded?: boolean; testId?: string;
  /** 看得見的補充小字（觸控裝置看不到 title／aria-label，例如島嶼獎勵的島號）。 */
  detail?: string;
}) {
  return <span className={`score-mark${awarded ? ' score-mark--medal' : ''}${detail ? ' score-mark--detail' : ''}`} role="img"
    aria-label={`${label}: ${value}`} title={`${label}: ${value}`} data-testid={testId}>
    <span className="score-mark__icon"><GameIcon name={icon} size={14} /></span>
    <span className="score-mark__value" aria-hidden="true">{value}</span>
    {awarded && <span className="score-mark__points" aria-hidden="true">+2</span>}
    {detail && <span className="score-mark__detail" aria-hidden="true">{detail}</span>}
  </span>;
}

/** 被圍住的船線：此刻能移就說可以移；不能移就依原因說明（時機、海盜、遠端接著自己的船、沒有合法落點）。 */
function stuckMessage(line: { backtrack: boolean; backtrackBlocked: string | null }): string {
  if (line.backtrack) return 'sf.pirate.stuck';
  switch (line.backtrackBlocked) {
    case 'builtThisTurn': return 'sf.pirate.stuckBuilt';
    case 'pirate': return 'sf.pirate.stuckPirate';
    case 'attached': return 'sf.pirate.stuckAttached';
    case 'noTarget': return 'sf.pirate.stuckNoTarget';
    default: return 'sf.pirate.stuckWait';
  }
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
  const view = shownCitiesKnights(state) ?? shownTradersBarbarians(state) ?? shownExplorersPirates(state) ?? shownSeafarers(state) ?? state.game?.view;
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
  // 已明確退出的真人（SPEC §4.6）；電腦恆不退出。
  const withdrawnIds = new Set(
    (state.room?.members ?? []).filter((member) => member.withdrawn === true && !member.bot).map((member) => member.playerId),
  );
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
        <h2 id={headingId} className="players__heading"><GameIcon name="users" size={17} />{t('play.seats')}<span className="players__target">{seafarersView(view)?.wonders ? t('play.resultTarget.wonders', { target: formatNumber(state.locale, view.victoryTarget) }) : seafarersView(view)?.pirateIslands ? t('play.resultTarget.pirate', { target: formatNumber(state.locale, view.victoryTarget) }) : t('play.resultTarget', { target: formatNumber(state.locale, view.victoryTarget) })}</span></h2>
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
          // 海盜巢穴：未收復的堡壘不算村落（它不計分，所以聚落數與總分才對得上）。
          const lockedFortresses = (seafarersView(view)?.pirateIslands?.fortresses ?? []).filter((fortress) => fortress.player === player.id && fortress.lairs > 0).length;
          const settlements = buildings.filter((building) => !building!.city).length - lockedFortresses;
          const cities = buildings.filter((building) => building!.city).length;
          const hiddenVp = isSelf ? [...(player.devCards ?? []), ...(player.newDevCards ?? [])].filter((card) => card === 'victoryPoint').length : 0;
          const hiddenBonus = isSelf && player.ownScore !== undefined ? Math.max(0, player.ownScore - player.publicScore - hiddenVp) : 0;
          const scoreLabel = t(isSelf && player.ownScore !== undefined ? 'play.ownScore' : 'play.publicScore');
          const isBot = bots.has(player.id);
          const botLabel = isBot ? botBadgeLabel(t, bots.get(player.id)) : null;
          const isWithdrawn = withdrawnIds.has(player.id);
          const compactLabel = `${player.nickname}${botLabel ? ` (${botLabel})` : ''}${isWithdrawn ? ` (${t('play.withdrawn')})` : ''}${isTurn ? `, ${t('play.turnOwner')}` : ''}`;
          const longestRoad = view.awards.longestRoad === player.id;
          const largestArmy = view.awards.largestArmy === player.id;
          // Seafarers: ships, Longest Trade Route and the per-island bonus.
          const sea = seafarersView(view);
          const ships = view.board.roads.filter((road) => road?.ship && road.player === player.id).length;
          const wording = islandWording(getProfile(view.profileId)?.scenario);
          const islandPoints = sea ? islandBonusPoints(view, player.id, getProfile(view.profileId)?.islandBonus?.points) : 0;
          const routeAward = t(sea ? 'sf.award.longestTradeRoute' : 'play.award.longestRoad');
          // Explorers & Pirates: gold, ships, harbour settlements and mission points (no development cards or awards).
          const ep = epView(view);
          const epPlayer = ep?.players[player.id];
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
              data-withdrawn={isWithdrawn ? 'true' : undefined}
              title={compactLabel}
            >
              <div className="seat__summary">
                <span className="seat__swatch" aria-hidden="true" style={{ backgroundColor: playerColorHex(player.color), borderStyle: seatDash(player.seat) ? 'dashed' : 'solid' }}>
                  {Array.from(player.nickname)[0]}
                  {/* 電腦標記固定放在頭像角落，避免徽章在展開時把名稱擠成兩行。 */}
                  {isBot && (
                    <span className="seat__bot-mark" data-testid={`seat-bot-mark-${player.seat}`}><GameIcon name="bot" size={9} /></span>
                  )}
                  {isWithdrawn && (
                    <span className="seat__withdrawn-mark" data-testid={`seat-withdrawn-mark-${player.seat}`}><GameIcon name="exit" size={9} /></span>
                  )}
                </span>
                {isBot && !expanded && <span className="visually-hidden">{`${player.nickname} (${botLabel})`}</span>}
                {isWithdrawn && !expanded && <span className="visually-hidden">{`${player.nickname} (${t('play.withdrawn')})`}</span>}
                <span className="seat__identity" hidden={!expanded}>
                  <span className="seat__name" title={player.nickname}>{player.nickname}{isSelf ? ` (${t('app.you')})` : ''}</span>
                  {isBot && <span className="visually-hidden" data-testid={`seat-bot-${player.seat}`}>{` (${botLabel})`}</span>}
                </span>
                <span className={`seat__score${isSelf && player.ownScore !== undefined ? ' seat__own-score' : ''}`} title={scoreLabel}><GameIcon name="crown" size={15} /><span className="visually-hidden">{scoreLabel}: </span>{number(total)}</span>
              </div>
              <div className="players__details" id={detailsIdForSeat(player.seat)} hidden={!expanded}>
                {isWithdrawn && <p className="badge seat__withdrawn" data-testid={`seat-withdrawn-${player.seat}`}>
                  <GameIcon name="exit" size={12} />{t('play.withdrawn')}
                </p>}
                <div className="players__stats" role="group" aria-label={t('table.playersBreakdown')}>
                  <ScoreMark icon="home" label={t('table.playersSettlements', { count: number(settlements) })} value={number(settlements)} />
                  <ScoreMark icon="city" label={t('table.playersCities', { count: number(cities) })} value={number(cities)} />
                  <ScoreMark icon="cards" label={t('play.handSize')} value={number(shownHandSize(state, player))} />
                  {ck
                    ? <ScoreMark icon="scroll" label={t('ck.score.progress')} value={number(ck.progressCounts[player.id] ?? 0)} testId={`players-progress-${player.seat}`} />
                    : !ep && <ScoreMark icon="book" label={t('play.devCardCount')} value={number(player.devCardCount)} />}
                  {sea && <ScoreMark icon="ship" label={t('sf.board.ship')} value={number(ships)} testId={`players-ships-${player.seat}`} />}
                  {sea?.pirateIslands && (() => {
                    const fortress = sea.pirateIslands!.fortresses.find((entry) => entry.player === player.id);
                    const line = sea.pirateIslands!.lines[player.id];
                    return <>
                      {fortress && <ScoreMark icon="shield" testId={`players-fortress-${player.seat}`}
                        label={t('sf.score.fortress')}
                        value={fortress.lairs > 0 ? `×${number(fortress.lairs)}` : t('sf.score.fortressRecaptured')} />}
                      {line && <ScoreMark icon="route" testId={`players-ship-line-${player.seat}`}
                        label={t('sf.score.shipLine', { count: number(line.edges.length), next: t(`sf.pirate.next.${line.next}`) })}
                        value={number(line.edges.length)} />}
                    </>;
                  })()}
                  {ep && epPlayer && <>
                    <ScoreMark icon="ship" label={t('ep.piece.ship')} value={number(ep.ships.filter((ship) => ship.player === player.id).length)} testId={`players-ep-ships-${player.seat}`} />
                    <ScoreMark icon="sparkles" label={t('ep.score.gold', { gold: number(epPlayer.gold) })} value={number(epPlayer.gold)} testId={`players-ep-gold-${player.seat}`} />
                  </>}
                  {sea?.cloth && <ScoreMark icon="scroll" testId={`players-cloth-${player.seat}`}
                    label={t('sf.score.clothValue', { count: number(sea.cloth.cloth[player.id] ?? 0), points: number(clothPoints(sea.cloth.cloth[player.id] ?? 0)) })}
                    value={number(sea.cloth.cloth[player.id] ?? 0)} detail={`${number(clothPoints(sea.cloth.cloth[player.id] ?? 0))}`} />}
                  {!ep && !sea?.cloth && !sea?.pirateIslands && <ScoreMark icon="route" label={`${t('play.longestRoadLength')}${longestRoad ? ` · ${routeAward} (+2)` : ''}`}
                    value={number(player.longestRoadLength)} awarded={longestRoad} testId={`players-route-${player.seat}`} />}
                  {ck && <ScoreMark icon="shield" label={t('ck.score.knights')} value={number(activeStrength(ck, player.id))} testId={`players-knights-${player.seat}`} />}
                  {!ck && !ep && !sea?.pirateIslands && <ScoreMark icon="shield" label={`${t('play.knightsPlayed')}${largestArmy ? ` · ${t('play.award.largestArmy')} (+2)` : ''}`}
                    value={number(player.playedKnights)} awarded={largestArmy} />}
                </div>
                <div className="players__bonuses">
                  {isSelf && <ScoreMark icon="crown" label={t('table.playersHiddenVp')} value={number(hiddenVp)} testId="players-hidden-vp" />}
                  {islandPoints > 0 && <ScoreMark icon="compass" testId={`players-islands-${player.seat}`}
                    label={`${t(wording ? `sf.score.islands.${wording}` : 'sf.score.islands')} · ${t(wording ? `sf.score.islandsValue.${wording}` : 'sf.score.islandsValue', { count: number(sea!.islandBonus[player.id]?.length ?? 0), points: number(islandPoints) })} (${t(`sf.score.islandId${(sea!.islandBonus[player.id]?.length ?? 0) === 1 ? '' : 's'}${wording === 'desert' ? '.desert' : ''}`, { ids: (sea!.islandBonus[player.id] ?? []).map(number).join(', ') })})`}
                    value={number(islandPoints)}
                    detail={wording ? t(`sf.score.islandId${(sea!.islandBonus[player.id]?.length ?? 0) === 1 ? '' : 's'}${wording === 'desert' ? '.desert' : ''}`, { ids: (sea!.islandBonus[player.id] ?? []).map(number).join(', ') }) : undefined} />}
                  {sea?.wonders && <ScoreMark icon="crown" testId={`players-wonder-${player.seat}`}
                    label={sea.wonders.owned[player.id] ? t(`sf.wonder.${sea.wonders.owned[player.id]}`) : t('sf.wonder.none')}
                    value={sea.wonders.owned[player.id] ? `${number(sea.wonders.levels[player.id] ?? 0)}/4` : '–'} />}
                  {sea?.tribe && (sea.tribe.vp[player.id] ?? 0) > 0 && <ScoreMark icon="crown" testId={`players-tribe-vp-${player.seat}`}
                    label={t('sf.score.tribeVp')} value={number(sea.tribe.vp[player.id] ?? 0)} />}
                  {sea?.tribe && (sea.tribe.held[player.id]?.length ?? 0) > 0 && <ScoreMark icon="anchor" testId={`players-tribe-held-${player.seat}`}
                    label={t('sf.score.tribeHeld', { ports: (sea.tribe.held[player.id] ?? []).map((type) => t(type === 'generic' ? 'sf.gift.port.generic' : 'sf.gift.port.resource', { resource: t(`resource.${type}`) })).join(' · ') })}
                    value={number(sea.tribe.held[player.id]?.length ?? 0)}
                    detail={(sea.tribe.held[player.id] ?? []).map((type) => `${harborRatio(type)}${type === 'generic' ? '' : resourceLetter(type)}`).join(' ')} />}
                  {epPlayer && epPlayer.harborPoints > 0 && <ScoreMark icon="anchor" testId={`players-ep-harbors-${player.seat}`}
                    label={t('ep.score.harbors', { points: number(epPlayer.harborPoints) })} value={number(epPlayer.harborPoints)} />}
                  {epPlayer && (['lairs', 'fish', 'spices'] as const).filter((mission) => ep!.missions.includes(mission)).map((mission) => (
                    <ScoreMark key={mission} icon={mission === 'lairs' ? 'shield' : mission === 'fish' ? 'anchor' : 'scales'} testId={`players-ep-${mission}-${player.seat}`}
                      label={t(`ep.score.${mission}`, { points: number(epPlayer.missionPoints[mission] ?? 0) })} value={number(epPlayer.missionPoints[mission] ?? 0)} />
                  ))}
                  {player.bonusPoints - islandPoints - (sea?.tribe?.vp[player.id] ?? 0) > 0 && <ScoreMark icon="flag" label={t('table.playersBonus')} value={number(player.bonusPoints - islandPoints - (sea?.tribe?.vp[player.id] ?? 0))} />}
                  {ckPoints && ckPoints.metropolises > 0 && <ScoreMark icon="city" testId={`players-metropolis-${player.seat}`}
                    label={t('ck.score.metropolises', { points: number(ckPoints.metropolises) })} value={number(ckPoints.metropolises)} />}
                  {ckPoints && ckPoints.defenders > 0 && <ScoreMark icon="shield" testId={`players-defender-${player.seat}`}
                    label={t('ck.score.defender', { points: number(ckPoints.defenders) })} value={number(ckPoints.defenders)} />}
                  {ckPoints && ckPoints.progress > 0 && <ScoreMark icon="scroll" testId={`players-progress-vp-${player.seat}`}
                    label={t('ck.score.progressVp', { points: number(ckPoints.progress) })} value={number(ckPoints.progress)} />}
                  {ckPoints?.merchant && <ScoreMark icon="trade" testId={`players-merchant-${player.seat}`}
                    label={t('ck.score.merchant', { points: number(ckPoints.merchant) })} value={number(ckPoints.merchant)} />}
                  {hiddenBonus > 0 && <ScoreMark icon="sparkles" label={t('table.playersHiddenBonus')} value={number(hiddenBonus)} />}
                </div>
              </div>
              {isTurn && <TurnFlag floating={floatingTurnFlag} />}
            </li>
          );
        })}
      </ol>
      {seafarersView(view)?.cloth && (() => {
        const cloth = seafarersView(view)!.cloth!;
        const empty = cloth.tribes.filter((tribe) => tribe.cloth <= 0).length;
        return <p className="players__cloth" data-testid="cloth-status" data-empty-tribes={empty} data-supply={cloth.supply} hidden={!expanded}>
          <GameIcon name="scroll" size={14} />
          <span>{t('sf.cloth.supply')}: {formatNumber(state.locale, cloth.supply)} · {t('sf.cloth.exhausted', { count: formatNumber(state.locale, empty) })}</span>
        </p>;
      })()}
      {seafarersHints(view)?.pirateLine?.stuck && <p className="players__cloth" data-testid="line-stuck" data-backtrack={seafarersHints(view)!.pirateLine!.backtrack ? 'true' : 'false'} hidden={!expanded}>
        <GameIcon name="ship" size={14} />
        <span>{t(stuckMessage(seafarersHints(view)!.pirateLine!))}</span>
      </p>}
      {seafarersHints(view)?.pirateLine && (() => {
        const line = seafarersHints(view)!.pirateLine!;
        const own = seafarersView(view)?.pirateIslands?.warships[selfId ?? ''] ?? [];
        return <p className="players__cloth" data-testid="warship-status" data-warships={own.length} data-attack={line.attackOnEnd ? 'true' : 'false'} hidden={!expanded}>
          <GameIcon name="shield" size={14} />
          <span>{t('sf.warship.status', { count: formatNumber(state.locale, own.length), line: formatNumber(state.locale, line.lineWarships) })}{line.attackOnEnd ? ` ${t('sf.warship.attackOnEnd')}` : ''}</span>
        </p>;
      })()}
      <p className="players__obligation" data-testid="turn-state" data-mine={action?.mine ? 'true' : 'false'}
        title={action ? t(action.messageId, action.params) : t('app.loading')}>
        <GameIcon name="flag" size={14} />
        <span className={expanded ? undefined : 'visually-hidden'}>{action ? t(action.messageId, action.params) : t('app.loading')}</span>
      </p>
      {view.turn.pairedActor === 2 && <p hidden={!expanded} className="badge players__paired-actor" data-testid="paired-actor">{t('play.pairedActor', { actor: 2 })}</p>}
    </section>
  );
}
