import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  addResources,
  createPlayerStats,
  RESOURCES,
  sumResources,
  zeroResources,
  type GameStats as GameStatsData,
  type GameView,
  type PlayerStats,
  type PublicPlayerView,
  type ResourceCounts,
} from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatNumber, formatResourceMap } from '../i18n/format.ts';
import { playerColorHex, seatDash } from '../board/terrain.ts';
import type { BotLevel } from '@catan/protocol';
import { GameIcon } from './GameArt.tsx';
import { BotBadge } from './BotBadge.tsx';
import { DiceDistributionChart, ScoreTimelineChart } from './StatsCharts.tsx';
import '../styles/game-stats.css';

/**
 * 賽後結算數據（docs/SPEC.md §4.7）：仿世紀帝國 2 的結算畫面，以分頁表格
 * 比較每位玩家的經濟、發展卡、強盜與交易數據，並附分數走勢與骰子分布圖。
 * 伺服器只在對局結束後才送出 `view.stats`。
 */

const TABS = ['overview', 'economy', 'development', 'robber', 'trade', 'timeline'] as const;
type TabId = (typeof TABS)[number];

/** 一欄數據：數值決定排序與最高值標示，`detail` 提供各資源明細。 */
interface Column {
  id: string;
  label: string;
  value: (row: StatsRow) => number;
  detail?: (row: StatsRow) => Partial<Record<string, number>>;
}

interface Section {
  id: string;
  title?: string;
  columns: Column[];
}

export interface StatsRow {
  player: PublicPlayerView;
  stats: PlayerStats;
  finalScore: number;
  winner: boolean;
  settlements: number;
  cities: number;
  roads: number;
}

function sumCounts(counts: Partial<Record<string, number>>): number {
  return Object.values(counts).reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
}

function combine(...parts: ResourceCounts[]): ResourceCounts {
  const out = zeroResources();
  for (const part of parts) addResources(out, part);
  return out;
}

export function incomeOf(stats: PlayerStats): ResourceCounts {
  return combine(
    stats.produced,
    stats.startingResources,
    stats.yearOfPlenty,
    stats.monopolyGained,
    stats.stolen,
    stats.bankReceived,
    stats.tradeReceived,
  );
}

export function expenseOf(stats: PlayerStats): ResourceCounts {
  return combine(stats.spent, stats.discarded, stats.robbed, stats.monopolyLost, stats.bankGiven, stats.tradeGiven);
}

/** 依最終分數排名（同分依座位），獲勝者固定排第一。 */
export function buildStatsRows(view: GameView, stats: GameStatsData): StatsRow[] {
  const final = stats.timeline.at(-1);
  const rows = view.players.map((player, index): StatsRow => {
    let settlements = 0;
    let cities = 0;
    for (const building of view.board.buildings) {
      if (!building || building.player !== player.id) continue;
      if (building.city) cities += 1;
      else settlements += 1;
    }
    const roads = view.board.roads.filter((road) => road?.player === player.id).length;
    return {
      player,
      stats: stats.players[player.id] ?? createPlayerStats(),
      finalScore: final?.[index] ?? player.publicScore,
      winner: view.result?.playerId === player.id,
      settlements,
      cities,
      roads,
    };
  });
  return rows.sort(
    (a, b) => Number(b.winner) - Number(a.winner) || b.finalScore - a.finalScore || a.player.seat - b.player.seat,
  );
}

/** 一個資源明細欄：數值為總和，提示顯示各資源數量。 */
function resourceColumn(id: string, label: string, pick: (stats: PlayerStats) => ResourceCounts): Column {
  return {
    id,
    label,
    value: (row) => sumResources(pick(row.stats)),
    detail: (row) => pick(row.stats),
  };
}

function countColumn(id: string, label: string, pick: (row: StatsRow) => number): Column {
  return { id, label, value: pick };
}

function sectionsFor(tab: Exclude<TabId, 'timeline'>, t: (id: string) => string): Section[] {
  switch (tab) {
    case 'overview':
      return [
        {
          id: 'overview',
          columns: [
            countColumn('finalScore', t('stats.col.finalScore'), (row) => row.finalScore),
            countColumn('settlements', t('stats.col.settlements'), (row) => row.settlements),
            countColumn('cities', t('stats.col.cities'), (row) => row.cities),
            countColumn('roads', t('stats.col.roads'), (row) => row.roads),
            countColumn('longestRoad', t('stats.col.longestRoad'), (row) => row.player.longestRoadLength),
            countColumn('knights', t('stats.col.knights'), (row) => row.stats.devCardsPlayed.knight),
            countColumn('devCardsBought', t('stats.col.devCardsBought'), (row) => sumCounts(row.stats.devCardsBought)),
            resourceColumn('income', t('stats.col.income'), incomeOf),
            resourceColumn('expense', t('stats.col.expense'), expenseOf),
            countColumn('turns', t('stats.col.turns'), (row) => row.stats.turns),
          ],
        },
      ];
    case 'economy':
      return [
        {
          id: 'production',
          title: t('stats.section.production'),
          columns: [
            ...RESOURCES.map((resource) =>
              countColumn(`produced-${resource}`, t(`resource.${resource}`), (row) => row.stats.produced[resource]),
            ),
            countColumn('produced-total', t('stats.col.total'), (row) => sumCounts(row.stats.produced)),
          ],
        },
        {
          id: 'income',
          title: t('stats.section.income'),
          columns: [
            resourceColumn('produced', t('stats.col.produced'), (stats) => stats.produced),
            resourceColumn('starting', t('stats.col.starting'), (stats) => stats.startingResources),
            resourceColumn('yearOfPlenty', t('devCard.yearOfPlenty'), (stats) => stats.yearOfPlenty),
            resourceColumn('monopolyGained', t('devCard.monopoly'), (stats) => stats.monopolyGained),
            resourceColumn('stolen', t('stats.col.stolen'), (stats) => stats.stolen),
            resourceColumn('tradeIn', t('stats.col.tradeIn'), (stats) => combine(stats.bankReceived, stats.tradeReceived)),
            resourceColumn('incomeTotal', t('stats.col.total'), incomeOf),
          ],
        },
        {
          id: 'expense',
          title: t('stats.section.expense'),
          columns: [
            resourceColumn('spent', t('stats.col.built'), (stats) => stats.spent),
            resourceColumn('discarded', t('stats.col.discarded'), (stats) => stats.discarded),
            resourceColumn('robbed', t('stats.col.robbed'), (stats) => stats.robbed),
            resourceColumn('monopolyLost', t('stats.col.monopolyLost'), (stats) => stats.monopolyLost),
            resourceColumn('tradeOut', t('stats.col.tradeOut'), (stats) => combine(stats.bankGiven, stats.tradeGiven)),
            resourceColumn('expenseTotal', t('stats.col.total'), expenseOf),
          ],
        },
      ];
    case 'development':
      return [
        {
          id: 'devBought',
          title: t('stats.section.devBought'),
          columns: [
            countColumn('bought-knight', t('devCard.knight'), (row) => row.stats.devCardsBought.knight),
            countColumn('bought-victoryPoint', t('devCard.victoryPoint'), (row) => row.stats.devCardsBought.victoryPoint),
            countColumn('bought-roadBuilding', t('devCard.roadBuilding'), (row) => row.stats.devCardsBought.roadBuilding),
            countColumn('bought-yearOfPlenty', t('devCard.yearOfPlenty'), (row) => row.stats.devCardsBought.yearOfPlenty),
            countColumn('bought-monopoly', t('devCard.monopoly'), (row) => row.stats.devCardsBought.monopoly),
            countColumn('bought-total', t('stats.col.total'), (row) => sumCounts(row.stats.devCardsBought)),
          ],
        },
        {
          id: 'devPlayed',
          title: t('stats.section.devPlayed'),
          columns: [
            countColumn('played-knight', t('devCard.knight'), (row) => row.stats.devCardsPlayed.knight),
            countColumn('played-roadBuilding', t('devCard.roadBuilding'), (row) => row.stats.devCardsPlayed.roadBuilding),
            countColumn('played-yearOfPlenty', t('devCard.yearOfPlenty'), (row) => row.stats.devCardsPlayed.yearOfPlenty),
            countColumn('played-monopoly', t('devCard.monopoly'), (row) => row.stats.devCardsPlayed.monopoly),
            countColumn('played-total', t('stats.col.total'), (row) => sumCounts(row.stats.devCardsPlayed)),
            countColumn('freeRoads', t('stats.col.freeRoads'), (row) => row.stats.freeRoadsBuilt),
          ],
        },
      ];
    case 'robber':
      return [
        {
          id: 'robber',
          columns: [
            countColumn('rolls', t('stats.col.rolls'), (row) => row.stats.rolls),
            countColumn('sevens', t('stats.col.sevens'), (row) => row.stats.sevens),
            countColumn('robberMoves', t('stats.col.robberMoves'), (row) => row.stats.robberMoves),
            resourceColumn('stolen', t('stats.col.stolen'), (stats) => stats.stolen),
            resourceColumn('robbed', t('stats.col.robbed'), (stats) => stats.robbed),
            countColumn('blockedRolls', t('stats.col.blockedRolls'), (row) => row.stats.blockedRolls),
            resourceColumn('blockedResources', t('stats.col.blockedResources'), (stats) => stats.blockedResources),
            resourceColumn('starved', t('stats.col.starved'), (stats) => stats.starvedResources),
            resourceColumn('discarded', t('stats.col.discarded'), (stats) => stats.discarded),
            countColumn('peakHand', t('stats.col.peakHand'), (row) => row.stats.peakHand),
          ],
        },
      ];
    case 'trade':
      return [
        {
          id: 'trade',
          columns: [
            countColumn('bankTrades', t('stats.col.bankTrades'), (row) => row.stats.bankTrades),
            resourceColumn('bankGiven', t('stats.col.bankGiven'), (stats) => stats.bankGiven),
            resourceColumn('bankReceived', t('stats.col.bankReceived'), (stats) => stats.bankReceived),
            countColumn('playerTrades', t('stats.col.playerTrades'), (row) => row.stats.playerTrades),
            resourceColumn('tradeGiven', t('stats.col.tradeGiven'), (stats) => stats.tradeGiven),
            resourceColumn('tradeReceived', t('stats.col.tradeReceived'), (stats) => stats.tradeReceived),
          ],
        },
      ];
  }
}

/** `bots`：電腦座位的 playerId → 難度；省略時不標示（例如房間資料尚未載入）。 */
export function GameStatsPanel({ view, bots = new Map() }: {
  view: GameView;
  bots?: ReadonlyMap<string, BotLevel | null>;
}) {
  const t = useT();
  const stats = view.stats;
  const [tab, setTab] = useState<TabId>('overview');
  const baseId = useId();
  if (!stats) return null;
  const rows = buildStatsRows(view, stats);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.indexOf(tab);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = TABS[next]!;
    setTab(target);
    document.getElementById(`${baseId}-tab-${target}`)?.focus();
  };

  return (
    <section className="card game-stats" aria-labelledby={`${baseId}-heading`} data-testid="game-stats">
      <header className="game-stats__header">
        <h2 id={`${baseId}-heading`}>
          <GameIcon name="scroll" /> {t('stats.heading')}
        </h2>
        {!stats.complete && (
          <p className="game-stats__note" data-testid="stats-incomplete">
            {t('stats.incomplete')}
          </p>
        )}
      </header>
      <div className="game-stats__tabs" role="tablist" aria-label={t('stats.heading')}>
        {TABS.map((id) => (
          <button
            key={id}
            id={`${baseId}-tab-${id}`}
            type="button"
            role="tab"
            className="game-stats__tab"
            aria-selected={tab === id}
            aria-controls={`${baseId}-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            data-testid={`stats-tab-${id}`}
            onClick={() => setTab(id)}
            onKeyDown={onTabKey}
          >
            {t(`stats.tab.${id}`)}
          </button>
        ))}
      </div>
      {TABS.map((id) => (
        <div
          key={id}
          id={`${baseId}-panel-${id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${id}`}
          className="game-stats__panel"
          hidden={tab !== id}
          data-testid={`stats-panel-${id}`}
        >
          {tab === id &&
            (id === 'timeline' ? (
              <div className="game-stats__charts">
                <ScoreTimelineChart view={view} stats={stats} bots={bots} />
                <DiceDistributionChart dice={stats.dice} />
              </div>
            ) : (
              sectionsFor(id, t).map((section) => <StatsTable key={section.id} section={section} rows={rows} bots={bots} />)
            ))}
        </div>
      ))}
    </section>
  );
}

function StatsTable({ section, rows, bots }: {
  section: Section;
  rows: StatsRow[];
  bots: ReadonlyMap<string, BotLevel | null>;
}) {
  const t = useT();
  const locale = useLocale();
  const headingId = useId();
  const best = section.columns.map((column) => {
    const values = rows.map((row) => column.value(row));
    const max = Math.max(...values);
    // 全部相同（含全為 0）時不標示最高值
    return max > 0 && values.some((value) => value !== max) ? max : null;
  });
  return (
    <div className="game-stats__section">
      {section.title && (
        <h3 id={headingId} className="game-stats__section-title">
          {section.title}
        </h3>
      )}
      <div className="game-stats__scroll">
        <table
          className="table game-stats__table"
          aria-labelledby={section.title ? headingId : undefined}
          data-testid={`stats-table-${section.id}`}
        >
          <thead>
            <tr>
              <th scope="col" className="game-stats__player-col">
                {t('stats.player')}
              </th>
              {section.columns.map((column) => (
                <th key={column.id} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rank) => (
              <tr key={row.player.id} data-testid={`stats-row-${row.player.id}`} data-winner={row.winner || undefined}>
                <th scope="row" className="game-stats__player-col">
                  <span className="game-stats__player">
                    <span className="game-stats__rank" aria-label={t('stats.rank', { rank: rank + 1 })}>
                      {rank + 1}
                    </span>
                    <span
                      className="game-stats__swatch"
                      aria-hidden="true"
                      style={
                        {
                          '--player-color': playerColorHex(row.player.color),
                          borderStyle: seatDash(row.player.seat) ? 'dashed' : 'solid',
                        } as CSSProperties
                      }
                    />
                    <span className="game-stats__name">{row.player.nickname}</span>
                    {bots.has(row.player.id) && (
                      <BotBadge level={bots.get(row.player.id)} short testId={`stats-bot-${row.player.id}`} />
                    )}
                    {row.winner && (
                      <span className="game-stats__crown" title={t('stats.winner')}>
                        <GameIcon name="crown" size={16} />
                        <span className="visually-hidden">{t('stats.winner')}</span>
                      </span>
                    )}
                  </span>
                </th>
                {section.columns.map((column, index) => {
                  const value = column.value(row);
                  const isBest = best[index] !== null && value === best[index];
                  const detail = column.detail ? formatResourceMap(locale, column.detail(row)) : null;
                  return (
                    <td
                      key={column.id}
                      className={isBest ? 'game-stats__cell game-stats__cell--best' : 'game-stats__cell'}
                      data-testid={`stats-cell-${section.id}-${column.id}-${row.player.id}`}
                      title={detail && detail !== '—' ? detail : undefined}
                    >
                      {formatNumber(locale, value)}
                      {isBest && <span className="visually-hidden"> ({t('stats.best')})</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
