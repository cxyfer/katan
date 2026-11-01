import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { GameStats, GameView } from '@catan/rules';
import type { BotLevel } from '@catan/protocol';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { playerColorHex, seatDash } from '../board/terrain.ts';

/**
 * 結算畫面的兩張圖：每回合勝利分數走勢（折線）與骰子點數分布（直條）。
 * 玩家顏色沿用棋盤上的身分色；因部分顏色在深色底上對比不足，另以座位虛線、
 * 圖例與終點名稱標示，數值也都能從資料表取得，不只靠顏色辨識。
 */

const WIDTH = 640;
const HEIGHT = 260;
const MARGIN = { top: 16, right: 112, bottom: 34, left: 36 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
/** 終點標籤與最後一個資料點的間距（viewBox 單位）。 */
const LABEL_GAP = 10;
const pct = (value: number, total: number) => `${(value / total) * 100}%`;

export function ScoreTimelineChart({ view, stats, bots = new Map() }: {
  view: GameView;
  stats: GameStats;
  /** 電腦座位；圖例、提示與資料表的名稱加上「（電腦）」。 */
  bots?: ReadonlyMap<string, BotLevel | null>;
}) {
  const t = useT();
  const nameOf = (player: { id: string; nickname: string }) =>
    bots.has(player.id) ? t('bot.playerName', { name: player.nickname }) : player.nickname;
  const locale = useLocale();
  const headingId = useId();
  const [focus, setFocus] = useState<number | null>(null);
  const samples = stats.timeline;
  const players = view.players;

  if (samples.length < 2) {
    return (
      <figure className="stats-chart" aria-labelledby={headingId}>
        <h3 id={headingId} className="game-stats__section-title">{t('stats.timeline.heading')}</h3>
        <p className="muted">{t('stats.timeline.empty')}</p>
      </figure>
    );
  }

  const maxScore = Math.max(view.victoryTarget, ...samples.flat());
  const yMax = Math.ceil(maxScore / 2) * 2;
  const x = (index: number) => MARGIN.left + (index / (samples.length - 1)) * PLOT_W;
  const y = (score: number) => MARGIN.top + PLOT_H - (score / yMax) * PLOT_H;
  const label = (index: number) =>
    index === samples.length - 1 ? t('stats.timeline.final') : t('stats.timeline.round', { round: index + 1 });
  const ticks = Array.from({ length: yMax / 2 + 1 }, (_, i) => i * 2);
  const xTicks = xTickIndices(samples.length);

  // 終點同分的玩家合併成一個標籤，避免文字重疊。
  const final = samples.at(-1)!;
  const endGroups = new Map<number, string[]>();
  players.forEach((player, index) => {
    const score = final[index] ?? 0;
    endGroups.set(score, [...(endGroups.get(score) ?? []), player.nickname]);
  });

  const nearest = (clientX: number, rect: DOMRect) => {
    const ratio = (clientX - rect.left) / rect.width;
    const svgX = ratio * WIDTH;
    const index = Math.round(((svgX - MARGIN.left) / PLOT_W) * (samples.length - 1));
    return Math.min(samples.length - 1, Math.max(0, index));
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    setFocus(nearest(event.clientX, event.currentTarget.getBoundingClientRect()));
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      setFocus((current) => Math.min(samples.length - 1, Math.max(0, (current ?? (step > 0 ? -1 : samples.length)) + step)));
    } else if (event.key === 'Escape') {
      setFocus(null);
    }
  };

  const focused = focus === null ? null : samples[focus]!;
  const tooltipRows = focused
    ? players
        .map((player, index) => ({ player, score: focused[index] ?? 0 }))
        .sort((a, b) => b.score - a.score || a.player.seat - b.player.seat)
    : [];

  return (
    <figure className="stats-chart" aria-labelledby={headingId} data-testid="stats-timeline">
      <h3 id={headingId} className="game-stats__section-title">{t('stats.timeline.heading')}</h3>
      <ul className="stats-chart__legend">
        {players.map((player) => (
          <li key={player.id}>
            <svg width="24" height="10" aria-hidden="true">
              <line x1="1" y1="5" x2="23" y2="5" stroke={playerColorHex(player.color)} strokeWidth="2" strokeLinecap="round" strokeDasharray={seatDash(player.seat) || undefined} />
            </svg>
            {nameOf(player)}
          </li>
        ))}
      </ul>
      <div className="stats-chart__frame">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="stats-chart__svg"
          role="img"
          tabIndex={0}
          aria-label={t('stats.timeline.summary', {
            rounds: formatNumber(locale, samples.length - 1),
            target: formatNumber(locale, view.victoryTarget),
          })}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setFocus(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setFocus(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="stats-chart__grid" x1={MARGIN.left} x2={MARGIN.left + PLOT_W} y1={y(tick)} y2={y(tick)} />
              <text className="stats-chart__axis" x={MARGIN.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                {formatNumber(locale, tick)}
              </text>
            </g>
          ))}
          <line className="stats-chart__target" x1={MARGIN.left} x2={MARGIN.left + PLOT_W} y1={y(view.victoryTarget)} y2={y(view.victoryTarget)} />
          {xTicks.map((index) => (
            <text key={index} className="stats-chart__axis" x={x(index)} y={HEIGHT - 12} textAnchor="middle">
              {index === samples.length - 1 ? t('stats.timeline.final') : formatNumber(locale, index + 1)}
            </text>
          ))}
          {players.map((player, seatIndex) => (
            <polyline
              key={player.id}
              fill="none"
              stroke={playerColorHex(player.color)}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={seatDash(player.seat) || undefined}
              points={samples.map((sample, index) => `${x(index)},${y(sample[seatIndex] ?? 0)}`).join(' ')}
            />
          ))}
          {players.map((player, seatIndex) => (
            <circle
              key={player.id}
              className="stats-chart__dot"
              cx={x(samples.length - 1)}
              cy={y(final[seatIndex] ?? 0)}
              r="4"
              fill={playerColorHex(player.color)}
            />
          ))}
          {focus !== null && (
            <g aria-hidden="true">
              <line className="stats-chart__crosshair" x1={x(focus)} x2={x(focus)} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} />
              {players.map((player, seatIndex) => (
                <circle
                  key={player.id}
                  className="stats-chart__dot"
                  cx={x(focus)}
                  cy={y(samples[focus]![seatIndex] ?? 0)}
                  r="4"
                  fill={playerColorHex(player.color)}
                />
              ))}
            </g>
          )}
        </svg>
        {/*
          終點標籤以 HTML 疊在右側邊界內，而非 SVG <text>：SVG 文字無法依實際字型截斷，
          長暱稱或多人同分合併時會畫出圖表外，壓到相鄰的骰子圖或超出卡片。
        */}
        {[...endGroups].map(([score, names]) => (
          <span
            key={score}
            className="stats-chart__end-label"
            data-testid={`stats-timeline-end-${score}`}
            aria-hidden="true"
            style={{
              left: pct(x(samples.length - 1) + LABEL_GAP, WIDTH),
              top: pct(y(score), HEIGHT),
              maxWidth: pct(MARGIN.right - LABEL_GAP, WIDTH),
            }}
          >
            {formatNumber(locale, score)} {names.join('、')}
          </span>
        ))}
        {focused && focus !== null && (
          <div
            className="stats-chart__tooltip"
            role="status"
            data-testid="stats-timeline-tooltip"
            style={{
              left: `${(x(focus) / WIDTH) * 100}%`,
              transform: focus > (samples.length - 1) / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
            }}
          >
            <p className="stats-chart__tooltip-title">{label(focus)}</p>
            <ul>
              {tooltipRows.map(({ player, score }) => (
                <li key={player.id}>
                  <svg width="14" height="8" aria-hidden="true">
                    <line x1="1" y1="4" x2="13" y2="4" stroke={playerColorHex(player.color)} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <strong>{formatNumber(locale, score)}</strong> <span>{nameOf(player)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <details className="stats-chart__data">
        <summary>{t('stats.chart.table')}</summary>
        <div className="game-stats__scroll">
          <table className="table game-stats__table" data-testid="stats-timeline-table">
            <thead>
              <tr>
                <th scope="col">{t('stats.timeline.axisRound')}</th>
                {players.map((player) => (
                  <th key={player.id} scope="col">{nameOf(player)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {samples.map((sample, index) => (
                <tr key={index}>
                  <th scope="row">{label(index)}</th>
                  {players.map((player, seatIndex) => (
                    <td key={player.id}>{formatNumber(locale, sample[seatIndex] ?? 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** 至多約 8 個 x 軸刻度，最後一個固定是「終局」。 */
function xTickIndices(count: number): number[] {
  const last = count - 1;
  const step = Math.max(1, Math.ceil(last / 8));
  const out: number[] = [];
  for (let index = 0; index < last; index += step) out.push(index);
  if (out.length > 0 && last - out.at(-1)! < step / 2) out.pop();
  out.push(last);
  return out;
}

const DICE_TOTALS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const DICE_W = 520;
const DICE_H = 220;
const DICE_MARGIN = { top: 22, right: 12, bottom: 30, left: 12 };

/** 兩顆骰子點數和的理論機率分子（以 36 為分母）。 */
export function diceWays(total: number): number {
  return 6 - Math.abs(7 - total);
}

function columnPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, height, width / 2);
  const bottom = y + height;
  if (height <= 0) return '';
  return `M${x},${bottom}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${bottom}Z`;
}

export function DiceDistributionChart({ dice }: { dice: number[] }) {
  const t = useT();
  const locale = useLocale();
  const headingId = useId();
  const rolls = DICE_TOTALS.reduce((sum, total) => sum + (dice[total] ?? 0), 0);
  const expected = (total: number) => (rolls * diceWays(total)) / 36;
  const yMax = Math.max(1, ...DICE_TOTALS.map((total) => Math.max(dice[total] ?? 0, expected(total))));
  const plotW = DICE_W - DICE_MARGIN.left - DICE_MARGIN.right;
  const plotH = DICE_H - DICE_MARGIN.top - DICE_MARGIN.bottom;
  const band = plotW / DICE_TOTALS.length;
  const barW = Math.min(24, band - 8);
  const baseline = DICE_MARGIN.top + plotH;
  const y = (value: number) => baseline - (value / yMax) * plotH;
  const format1 = (value: number) => formatNumber(locale, Math.round(value * 10) / 10);

  return (
    <figure className="stats-chart" aria-labelledby={headingId} data-testid="stats-dice">
      <h3 id={headingId} className="game-stats__section-title">{t('stats.dice.heading')}</h3>
      <p className="muted stats-chart__caption">{t('stats.dice.summary', { rolls: formatNumber(locale, rolls) })}</p>
      <ul className="stats-chart__legend">
        <li>
          <svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="2" className="stats-chart__bar" /></svg>
          {t('stats.dice.actual')}
        </li>
        <li>
          <svg width="24" height="10" aria-hidden="true"><line x1="1" y1="5" x2="23" y2="5" className="stats-chart__expected" /></svg>
          {t('stats.dice.expected')}
        </li>
      </ul>
      <svg viewBox={`0 0 ${DICE_W} ${DICE_H}`} className="stats-chart__svg" role="img" aria-label={t('stats.dice.heading')}>
        <line className="stats-chart__grid" x1={DICE_MARGIN.left} x2={DICE_W - DICE_MARGIN.right} y1={baseline} y2={baseline} />
        {DICE_TOTALS.map((total, index) => {
          const count = dice[total] ?? 0;
          const centre = DICE_MARGIN.left + band * index + band / 2;
          const top = y(count);
          const tip = t('stats.dice.bar', {
            total: formatNumber(locale, total),
            count: formatNumber(locale, count),
            expected: format1(expected(total)),
          });
          return (
            <g key={total} className="stats-chart__column" data-testid={`stats-dice-${total}`}>
              <title>{tip}</title>
              <rect x={centre - band / 2} y={DICE_MARGIN.top} width={band} height={plotH} fill="transparent" />
              <path className="stats-chart__bar" d={columnPath(centre - barW / 2, top, barW, baseline - top, 4)} />
              <line className="stats-chart__expected" x1={centre - barW / 2 - 4} x2={centre + barW / 2 + 4} y1={y(expected(total))} y2={y(expected(total))} />
              {count > 0 && (
                <text className="stats-chart__value" x={centre} y={Math.min(top, y(expected(total))) - 6} textAnchor="middle">
                  {formatNumber(locale, count)}
                </text>
              )}
              <text className="stats-chart__axis" x={centre} y={DICE_H - 10} textAnchor="middle">
                {formatNumber(locale, total)}
              </text>
            </g>
          );
        })}
      </svg>
      <details className="stats-chart__data">
        <summary>{t('stats.chart.table')}</summary>
        <div className="game-stats__scroll">
          <table className="table game-stats__table" data-testid="stats-dice-table">
            <thead>
              <tr>
                <th scope="col">{t('stats.dice.total')}</th>
                <th scope="col">{t('stats.dice.actual')}</th>
                <th scope="col">{t('stats.dice.expected')}</th>
              </tr>
            </thead>
            <tbody>
              {DICE_TOTALS.map((total) => (
                <tr key={total}>
                  <th scope="row">{formatNumber(locale, total)}</th>
                  <td>{formatNumber(locale, dice[total] ?? 0)}</td>
                  <td>{format1(expected(total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
