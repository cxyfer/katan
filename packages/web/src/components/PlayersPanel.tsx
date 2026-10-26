import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { playerColorHex, seatDash } from '../board/terrain.ts';
import type { TableController } from '../state/useTable.ts';

/**
 * Seat order, scores and awards (docs/SPEC.md §8.1/§8.3).
 *
 * Only public values are shown: hand size and card counts, never another
 * player's resource identities or hidden victory points. `ownScore` is rendered
 * for the viewer alone.
 */
export function PlayersPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const { state } = controller;
  const view = state.game?.view;
  if (!view) return null;
  const selfId = state.session?.id ?? null;
  const awards = view.awards;
  const nameOf = (playerId: string | null) =>
    playerId ? (view.players.find((player) => player.id === playerId)?.nickname ?? playerId) : t('play.award.none');

  return (
    <section className="panel" aria-labelledby="players-heading" data-testid="players-panel">
      <h2 id="players-heading">{t('play.seats')}</h2>
      <ol className="seat-list" data-testid="seat-list">
        {view.players.map((player) => {
          const isTurn = view.turn.playerId === player.id;
          return (
            <li
              key={player.id}
              className={`seat${isTurn ? ' seat--turn' : ''}`}
              data-testid={`seat-${player.seat}`}
              data-turn={isTurn ? 'true' : 'false'}
            >
              <span
                className="seat__swatch"
                aria-hidden="true"
                style={{
                  backgroundColor: playerColorHex(player.color),
                  borderStyle: seatDash(player.seat) ? 'dashed' : 'solid',
                }}
              />
              <span className="seat__name">
                {player.nickname}
                {player.id === selfId ? ` (${t('app.you')})` : ''}
              </span>
              {isTurn && <span className="badge">{t('play.turnOwner')}</span>}
              <span className="seat__stats">
                {t('play.publicScore')}: {formatNumber(state.locale, player.publicScore)}
                {player.id === selfId && player.ownScore !== undefined
                  ? ` (${t('play.ownScore')}: ${formatNumber(state.locale, player.ownScore)})`
                  : ''}
                {' · '}
                {t('play.handSize')}: {formatNumber(state.locale, player.handSize)}
                {' · '}
                {t('play.devCardCount')}: {formatNumber(state.locale, player.devCardCount)}
                {' · '}
                {t('play.knightsPlayed')}: {formatNumber(state.locale, player.playedKnights)}
                {' · '}
                {t('play.longestRoadLength')}: {formatNumber(state.locale, player.longestRoadLength)}
              </span>
            </li>
          );
        })}
      </ol>
      <h3>{t('play.awards')}</h3>
      <ul className="award-list" data-testid="award-list">
        <li>
          {t('play.award.longestRoad')}: {nameOf(awards.longestRoad)}
        </li>
        <li>
          {t('play.award.largestArmy')}: {nameOf(awards.largestArmy)}
        </li>
      </ul>
      <p className="muted">
        {t('play.production')}: {formatNumber(state.locale, view.seq)} · {t('play.phase.' + view.turn.phase)}
      </p>
    </section>
  );
}
