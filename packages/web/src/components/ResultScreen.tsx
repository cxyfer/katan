import { useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { BoardView } from './BoardView.tsx';
import { StatusStrip } from './StatusStrip.tsx';
import { GameIcon, IslandIllustration } from './GameArt.tsx';
import { GameStatsPanel } from './GameStats.tsx';
import { BotBadge } from './BotBadge.tsx';
import { botLevelsOf } from '../state/bots.ts';
import type { TableController } from '../state/useTable.ts';
import '../styles/result-layout.css';

/**
 * Terminal view (docs/SPEC.md §4.7).
 *
 * `completed` and `abandoned` are shown distinctly; an abandoned game has no
 * fabricated winner. The final board stays inspectable, and only the score the
 * server chose to publish is rendered. Post-game statistics appear only once
 * the server includes them with the terminal view.
 */
export function ResultScreen({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const view = state.game?.view;
  const result = view?.result ?? null;
  // 共同勝利（布匹耗盡）：`playerIds` 列出全部勝者；其他終局只有 `playerId`。
  const winnerIds = result?.playerIds ?? (result?.playerId ? [result.playerId] : []);
  const winners = winnerIds.flatMap((id) => view?.players.find((player) => player.id === id) ?? []);
  const winner = winners.length === 1 ? winners[0]! : null;
  const shared = winners.length > 1;
  // 布匹耗盡的終局不是靠目標分，所以不顯示目標分（單一或共同勝者都一樣）。
  const clothEnd = result?.cause === 'clothExhausted';
  // 卡坦奇觀的終局（完成奇觀，或 10 分且層數最高）也不是靠「達到目標分」，所以同樣不顯示目標分。
  const wonderEnd = result?.cause === 'wonderComplete' || result?.cause === 'wonderLead';
  const noTarget = clothEnd || wonderEnd;
  // 電腦座位由房間成員推得；房間尚未載入時不標示。
  const bots = botLevelsOf(state.room);

  return (
    <div className="screen screen--result" id="main">
      <StatusStrip controller={controller} />
      <section className="card result-hero" aria-labelledby="result-heading" data-testid="result-screen">
        <div>
        <span className="result-hero__emblem"><GameIcon name={result?.reason === 'victory' ? 'crown' : 'anchor'} size={42} /></span>
        <h1 id="result-heading">{t('play.result')}</h1>
        {result?.reason === 'victory' && shared ? (
          <p className="result__winner" data-testid="result-winners" data-shared="true">
            {t('play.resultWinners', { players: winners.map((entry) => entry.nickname) })}
          </p>
        ) : result?.reason === 'victory' && winner ? (
          <p className="result__winner" data-testid="result-winner">
            {t('play.resultWinner', { player: winner.nickname })}
            {bots.has(winner.id) && <> <BotBadge level={bots.get(winner.id)} testId="result-winner-bot" /></>}
          </p>
        ) : (
          <p className="result__winner" data-testid="result-no-winner">
            {t('play.resultAbandoned')} · {t('play.resultNoWinner')}
          </p>
        )}
        {result?.score !== undefined && clothEnd && (
          <p data-testid="result-score">{t('play.resultScoreShared', { score: formatNumber(state.locale, result.score) })}</p>
        )}
        {result?.score !== undefined && wonderEnd && (
          <p data-testid="result-score">{t('play.resultScoreWonder', { score: formatNumber(state.locale, result.score) })}</p>
        )}
        {result?.score !== undefined && !noTarget && (
          <p data-testid="result-score">
            {t('play.resultScore', {
              score: formatNumber(state.locale, result.score),
              target: formatNumber(state.locale, view?.victoryTarget ?? 0),
            })}
          </p>
        )}
        <p className="muted" data-testid="result-reason" data-cause={result?.cause ?? 'target'}>
          {noTarget ? t(`play.resultReason.${result!.cause}`) : <>
            {t('play.resultReason.' + (result?.reason ?? 'abandoned'))} ·{' '}
            {t('play.resultTarget', { target: formatNumber(state.locale, view?.victoryTarget ?? 0) })}
          </>}
        </p>
        <button
          type="button"
          className="button button--primary"
          data-testid="back-to-lobby"
          onClick={() => void actions.leaveRoom()}
        >
          {t('play.resultBackToLobby')}
        </button>
        </div>
        <IslandIllustration />
      </section>

      {view?.stats && <GameStatsPanel view={view} bots={bots} />}

      <section aria-labelledby="final-board-heading" className="card result-board">
        <h2 id="final-board-heading">{t('play.resultFinalBoard')}</h2>
        <BoardView controller={controller} />
      </section>
    </div>
  );
}
