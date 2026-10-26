import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { playerColorHex, seatDash } from '../board/terrain.ts';
import { GameIcon } from './GameArt.tsx';
import type { TableController } from '../state/useTable.ts';

/** 玩家卡只使用公開投影；個人真實分數僅在本人卡片呈現。 */
export function PlayersPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const { state } = controller;
  const view = state.game?.view;
  if (!view) return null;
  const selfId = state.session?.id ?? null;
  const nameOf = (playerId: string | null) => playerId
    ? (view.players.find((player) => player.id === playerId)?.nickname ?? playerId)
    : t('play.award.none');

  return (
    <section className="panel players" aria-labelledby="players-heading" data-testid="players-panel">
      <h2 id="players-heading"><GameIcon name="users" size={17} />{t('play.seats')}<span className="players__target">{t('play.resultTarget', { target: formatNumber(state.locale, view.victoryTarget) })}</span></h2>
      <ol className="seat-list" data-testid="seat-list">
        {view.players.map((player) => {
          const isTurn = view.turn.playerId === player.id;
          return (
            <li key={player.id} className={`seat${isTurn ? ' seat--turn' : ''}`} data-testid={`seat-${player.seat}`} data-turn={isTurn ? 'true' : 'false'}>
              <span className="seat__swatch" aria-hidden="true" style={{ backgroundColor: playerColorHex(player.color), borderStyle: seatDash(player.seat) ? 'dashed' : 'solid' }}>{Array.from(player.nickname)[0]}</span>
              <span className="seat__identity"><span className="seat__name">{player.nickname}{player.id === selfId ? ` (${t('app.you')})` : ''}</span>{isTurn && <span className="badge">{t('play.turnOwner')}</span>}</span>
              <span className="seat__score"><GameIcon name="crown" size={15} /><span className="visually-hidden">{t('play.publicScore')}: </span>{formatNumber(state.locale, player.publicScore)}</span>
              <span className="seat__stats">
                {t('play.handSize')}: {formatNumber(state.locale, player.handSize)} · {t('play.devCardCount')}: {formatNumber(state.locale, player.devCardCount)}
                {player.id === selfId && player.ownScore !== undefined && <span>{t('play.ownScore')}: {formatNumber(state.locale, player.ownScore)}</span>}
              </span>
              <span className="seat__details">{t('play.knightsPlayed')}: {formatNumber(state.locale, player.playedKnights)} · {t('play.longestRoadLength')}: {formatNumber(state.locale, player.longestRoadLength)}</span>
            </li>
          );
        })}
      </ol>
      {view.turn.pairedActor === 2 && <p className="badge" data-testid="paired-actor">{t('play.pairedActor', { actor: 2 })}</p>}
      <details className="players__awards"><summary><GameIcon name="crown" size={14} /> {t('play.awards')} · {t('play.phase.' + view.turn.phase)}</summary>
        <ul className="award-list" data-testid="award-list">
          <li>{t('play.award.longestRoad')}: {nameOf(view.awards.longestRoad)}</li>
          <li>{t('play.award.largestArmy')}: {nameOf(view.awards.largestArmy)}</li>
        </ul>
        <p className="muted">{t('play.production')}: {formatNumber(state.locale, view.seq)} · {t('play.phase.' + view.turn.phase)}</p>
      </details>
    </section>
  );
}
