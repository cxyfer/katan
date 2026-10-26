import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { BoardView } from './BoardView.tsx';
import { StatusStrip } from './StatusStrip.tsx';
import type { TableController } from '../state/useTable.ts';

/**
 * Terminal view (docs/SPEC.md §4.7).
 *
 * `completed` and `abandoned` are shown distinctly; an abandoned game has no
 * fabricated winner. The final board stays inspectable, and only the score the
 * server chose to publish is rendered.
 */
export function ResultScreen({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const view = state.game?.view;
  const result = view?.result ?? null;
  const winner = result?.playerId
    ? view?.players.find((player) => player.id === result.playerId) ?? null
    : null;

  return (
    <div className="screen screen--result" id="main">
      <StatusStrip controller={controller} />
      <section className="card" aria-labelledby="result-heading" data-testid="result-screen">
        <h1 id="result-heading">{t('play.result')}</h1>
        {result?.reason === 'victory' && winner ? (
          <p className="result__winner" data-testid="result-winner">
            {t('play.resultWinner', { player: winner.nickname })}
          </p>
        ) : (
          <p className="result__winner" data-testid="result-no-winner">
            {t('play.resultAbandoned')} · {t('play.resultNoWinner')}
          </p>
        )}
        {result?.score !== undefined && (
          <p data-testid="result-score">
            {t('play.resultScore', {
              score: formatNumber(state.locale, result.score),
              target: formatNumber(state.locale, view?.victoryTarget ?? 0),
            })}
          </p>
        )}
        <p className="muted">
          {t('play.resultReason.' + (result?.reason ?? 'abandoned'))} ·{' '}
          {t('play.resultTarget', { target: formatNumber(state.locale, view?.victoryTarget ?? 0) })}
        </p>
        <button
          type="button"
          className="button button--primary"
          data-testid="back-to-lobby"
          onClick={() => void actions.leaveRoom()}
        >
          {t('play.resultBackToLobby')}
        </button>
      </section>

      <section aria-labelledby="final-board-heading" className="card">
        <h2 id="final-board-heading">{t('play.resultFinalBoard')}</h2>
        <BoardView controller={controller} />
      </section>
    </div>
  );
}
