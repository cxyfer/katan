import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../src/board/geometry.ts';
import { tbNumberTokens } from '../src/board/three/TbScenePieces.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { TradePanel } from '../src/components/TradePanel.tsx';
import { TbPanel } from '../src/components/tb/TbPanel.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { EMPTY_SELECTION } from '../src/state/table.ts';
import { tbController, tbSlot, tbState } from './tb-helpers.tsx';

const PROFILE = 'tb-rivers-2025';

describe('Rivers of Catan UI', () => {
  it('draws both rivers, the shared 2 and an arched bridge', () => {
    const state = tbState(PROFILE);
    const site = tbSlot<{ bridgeSites: number[] }>(state, 'tb-rivers').bridgeSites[0]!;
    state.board.roads[site] = { player: 'p2', ship: false, bridge: true };
    const view = tbController(state).state.game!.view;
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const { container } = render(<LocaleProvider locale="en">
      <SvgBoard svgRef={() => {}} geometry={geometry} view={view} active={null} selection={EMPTY_SELECTION} selfId="p1"
        intent={null} pan={{ x: 0, y: 0 }} zoom={1} viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} />
    </LocaleProvider>);
    expect(container.querySelectorAll('.tb-river')).toHaveLength(2);
    expect(container.querySelector(`[data-testid="road-${site}"]`)?.getAttribute('data-bridge')).toBe('true');
    expect(tbNumberTokens(geometry, view.modules, view.board).map((token) => token.value)).toEqual([2]);
  });

  it('shows gold, wealth tiles and buys a resource with gold', () => {
    const state = tbState(PROFILE);
    tbSlot<{ gold: Record<string, number> }>(state, 'tb-coins').gold = { p1: 5, p2: 1, p3: 1, p4: 0 };
    const controller = tbController(state);
    render(<LocaleProvider locale="en"><TbPanel controller={controller} /></LocaleProvider>);
    expect(screen.getByTestId('tb-gold-mine').textContent).toContain('5');
    expect(screen.getByTestId('tb-wealthiest').textContent).toContain('P1');
    expect(screen.getByTestId('tb-poor').textContent).toContain('P4');
    fireEvent.click(screen.getByTestId('tb-buy-ore'));
    expect(controller.actions.submitCommand).toHaveBeenCalledWith({ type: 'tb.buyResource', resource: 'ore' }, 'tb.coins.title');
  });

  it('adds gold to a domestic offer', () => {
    const state = tbState(PROFILE);
    tbSlot<{ gold: Record<string, number> }>(state, 'tb-coins').gold.p1 = 2;
    state.players[1]!.resources.ore = 1;
    const controller = tbController(state);
    render(<LocaleProvider locale="en"><TradePanel controller={controller} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('give-add-gold'));
    fireEvent.click(screen.getByTestId('give-add-gold'));
    expect(screen.getByTestId('give-add-gold')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByTestId('want-add-ore'));
    fireEvent.click(screen.getByTestId('create-offer'));
    expect(controller.actions.submitCommand).toHaveBeenCalledWith(
      { type: 'trade.offer', to: 'all', give: {}, want: { ore: 1 }, giveGoods: { gold: 2 } }, 'play.tradeNew');
  });
});
