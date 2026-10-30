import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createGameStats, type GameStats, type GameView } from '@catan/rules';
import { GameStatsPanel, buildStatsRows } from '../src/components/GameStats.tsx';
import { diceWays } from '../src/components/StatsCharts.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { makeView } from '../src/test/fixtures.ts';

function statsFixture(view: GameView): GameStats {
  const stats = createGameStats(
    view.players.map((player) => ({ id: player.id }) as never),
    true,
  );
  stats.turns = 3;
  stats.dice[6] = 2;
  stats.dice[7] = 1;
  stats.timeline = [
    [2, 2, 2],
    [3, 2, 4],
    [10, 3, 5],
  ];
  const p1 = stats.players['p1']!;
  p1.produced = { lumber: 3, brick: 1, wool: 0, grain: 2, ore: 0 };
  p1.devCardsBought.knight = 2;
  p1.devCardsBought.victoryPoint = 1;
  p1.devCardsPlayed.knight = 2;
  const p2 = stats.players['p2']!;
  p2.blockedRolls = 2;
  p2.blockedResources.ore = 3;
  p2.robbed.wool = 1;
  return stats;
}

function renderPanel(locale: 'en' | 'zh-Hant' = 'en', complete = true) {
  const view = makeView({ result: { playerId: 'p1', reason: 'victory', score: 10 } });
  view.stats = statsFixture(view);
  view.stats.complete = complete;
  render(
    <LocaleProvider locale={locale}>
      <GameStatsPanel view={view} />
    </LocaleProvider>,
  );
  return view;
}

describe('post-game statistics', () => {
  it('ranks the winner first and uses the final timeline sample as the score', () => {
    const view = makeView({ result: { playerId: 'p1', reason: 'victory', score: 10 } });
    const rows = buildStatsRows(view, statsFixture(view));
    expect(rows.map((row) => row.player.id)).toEqual(['p1', 'p3', 'p2']);
    expect(rows.map((row) => row.finalScore)).toEqual([10, 5, 3]);
  });

  it('shows an overview table and marks the column leader', () => {
    renderPanel();
    const table = screen.getByTestId('stats-table-overview');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getByText('Alex')).toBeTruthy();
    expect(within(rows[1]!).getByText('Winner')).toBeTruthy();
    const knights = screen.getByTestId('stats-cell-overview-knights-p1');
    expect(knights.textContent).toContain('2');
    expect(knights.className).toContain('game-stats__cell--best');
    // 全部為 0 的欄位不標示最高值。
    expect(screen.getByTestId('stats-cell-overview-turns-p1').className).not.toContain('--best');
  });

  it('switches tabs with clicks and arrow keys', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('stats-tab-robber'));
    expect(screen.getByTestId('stats-panel-robber').hidden).toBe(false);
    expect(screen.getByTestId('stats-panel-overview').hidden).toBe(true);
    expect(screen.getByTestId('stats-cell-robber-blockedRolls-p2').textContent).toBe('2 (highest)');
    expect(screen.getByTestId('stats-cell-robber-blockedResources-p2').getAttribute('title')).toContain('Ore');

    fireEvent.keyDown(screen.getByTestId('stats-tab-robber'), { key: 'ArrowRight' });
    expect(screen.getByTestId('stats-tab-trade').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByTestId('stats-tab-trade'));
  });

  it('lists drawn development cards by type', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('stats-tab-development'));
    expect(screen.getByTestId('stats-cell-devBought-bought-knight-p1').textContent).toContain('2');
    expect(screen.getByTestId('stats-cell-devBought-bought-victoryPoint-p1').textContent).toContain('1');
    expect(screen.getByTestId('stats-cell-devBought-bought-total-p1').textContent).toContain('3');
  });

  it('draws the score timeline and dice distribution with data tables', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('stats-tab-timeline'));
    const timeline = screen.getByTestId('stats-timeline');
    expect(within(timeline).getAllByRole('row')).toHaveLength(4);
    const chart = within(timeline).getByRole('img');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    const tooltip = screen.getByTestId('stats-timeline-tooltip');
    expect(tooltip.textContent).toContain('Round 1');
    fireEvent.keyDown(chart, { key: 'Escape' });
    expect(screen.queryByTestId('stats-timeline-tooltip')).toBeNull();

    expect(screen.getByTestId('stats-dice-7').textContent).toContain('1');
    expect(within(screen.getByTestId('stats-dice-table')).getAllByRole('row')).toHaveLength(12);
  });

  it('flags statistics that started mid-game, in Traditional Chinese', () => {
    renderPanel('zh-Hant', false);
    expect(screen.getByTestId('stats-incomplete').textContent).toContain('中途');
    expect(screen.getByRole('heading', { name: /賽後數據/ })).toBeTruthy();
  });

  it('weights dice totals like two six-sided dice', () => {
    expect([2, 7, 12].map(diceWays)).toEqual([1, 6, 1]);
  });
});
