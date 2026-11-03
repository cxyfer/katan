import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../src/board/geometry.ts';
import { tbNumberTokens } from '../src/board/three/TbScenePieces.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { TradePanel } from '../src/components/TradePanel.tsx';
import { TbPanel } from '../src/components/tb/TbPanel.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { EMPTY_SELECTION } from '../src/state/table.ts';
import { t } from '../src/i18n/index.ts';
import type { Offer } from '@catan/rules';
import { tbController, tbSlot, tbState } from './tb-helpers.tsx';

const PROFILE = 'tb-rivers-2025';

function tradeState(profile = PROFILE) {
  const state = tbState(profile);
  state.players[0]!.resources = { lumber: 0, brick: 0, wool: 1, grain: 0, ore: 2 };
  state.offers = [{
    id: 'gold-offer', from: 'p1', to: 'p2', revision: 1, windowId: state.windowId,
    status: 'open', responses: { p2: 'consented' }, agreedWith: null, createdSeq: state.seq,
    give: { wool: 1 }, want: { ore: 1 }, giveGoods: { gold: 2 },
  } satisfies Offer];
  if (profile === PROFILE) tbSlot<{ gold: Record<string, number> }>(state, 'tb-coins').gold.p1 = 2;
  return state;
}

describe('Rivers of Catan UI', () => {
  it.each([undefined, { gold: 1 }])('revises resources and both goods sides together (want goods: %j)', (wantGoods) => {
    const state = tradeState();
    if (wantGoods) state.offers[0]!.wantGoods = wantGoods;
    const controller = tbController(state);
    render(<LocaleProvider locale="en"><TradePanel controller={controller} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('revise-gold-offer'));
    expect(controller.actions.submitCommand).toHaveBeenCalledWith({
      type: 'trade.revise', offerId: 'gold-offer', give: { ore: 1 }, want: { wool: 1 },
      wantGoods: { gold: 2 }, ...(wantGoods ? { giveGoods: wantGoods } : {}),
    }, 'play.tradeRevise');
  });

  it.each(['en', 'zh-Hant'] as const)('shows gold in the settlement confirmation in %s', (locale) => {
    const controller = tbController(tradeState());
    render(<LocaleProvider locale={locale}><TradePanel controller={controller} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('settle-gold-offer'));
    const terms = screen.getByTestId('settle-dialog-terms').textContent;
    expect(terms).toContain(`2×${t(locale, 'tb.trade.goodName.gold')}`);
    expect(terms).toContain(`1×${t(locale, 'resource.wool')}`);
    expect(terms).toContain(`1×${t(locale, 'resource.ore')}`);
    expect(terms).not.toContain('—');
  });

  it.each(['revise', 'consent'] as const)('blocks %s when the viewer cannot cover the goods they would give', (action) => {
    const state = tradeState();
    state.offers[0]!.wantGoods = { gold: 3 };
    const controller = tbController(state, action === 'consent' ? 'p2' : 'p1');
    render(<LocaleProvider locale="en"><TradePanel controller={controller} /></LocaleProvider>);
    const button = screen.getByTestId(`${action}-gold-offer`);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(controller.actions.submitCommand).not.toHaveBeenCalled();
    expect(screen.getByTestId('trade-hint-gold-offer').textContent).toContain('Gold');
  });

  it('rechecks draft goods when the player’s gold changes before submitting', () => {
    const state = tradeState();
    state.offers = [];
    const controller = tbController(state);
    const display = () => <LocaleProvider locale="en"><TradePanel controller={controller} /></LocaleProvider>;
    const { rerender } = render(display());
    fireEvent.click(screen.getByTestId('give-add-gold'));
    fireEvent.click(screen.getByTestId('give-add-gold'));
    fireEvent.click(screen.getByTestId('want-add-ore'));
    tbSlot<{ gold: Record<string, number> }>(state, 'tb-coins').gold.p1 = 1;
    controller.state.game = tbController(state).state.game;
    rerender(display());
    fireEvent.click(screen.getByTestId('create-offer'));
    expect(controller.actions.submitCommand).not.toHaveBeenCalled();
    expect(screen.getByTestId('trade-hint-builder').textContent).toContain('1×Gold');
  });

  it.each(['en', 'zh-Hant'] as const)('preserves paper/cloth/coin in revisions and confirmation in %s', (locale) => {
    const state = tradeState('ck-2025');
    state.players[0]!.commodities = { paper: 1, cloth: 2, coin: 3 };
    state.offers[0]!.give = { paper: 1 };
    state.offers[0]!.want = { cloth: 2, coin: 3 };
    delete state.offers[0]!.giveGoods;
    const controller = tbController(state);
    render(<LocaleProvider locale={locale}><TradePanel controller={controller} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('revise-gold-offer'));
    expect(controller.actions.submitCommand).toHaveBeenCalledWith({
      type: 'trade.revise', offerId: 'gold-offer', give: { cloth: 2, coin: 3 }, want: { paper: 1 },
    }, 'play.tradeRevise');
    fireEvent.click(screen.getByTestId('settle-gold-offer'));
    const terms = screen.getByTestId('settle-dialog-terms').textContent;
    for (const card of ['paper', 'cloth', 'coin']) expect(terms).toContain(t(locale, `resource.${card}`));
  });

  it('draws both rivers, the shared 2 and an arched bridge', () => {
    const state = tbState(PROFILE);
    const site = tbSlot<{ bridgeSites: number[] }>(state, 'tb-rivers').bridgeSites[0]!;
    state.board.roads[site] = { player: 'p2', ship: false, bridge: true };
    const view = tbController(state).state.game!.view;
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const { container } = render(<LocaleProvider locale="en">
      <SvgBoard svgRef={() => {}} geometry={geometry} view={view} arrivals={[]} selection={EMPTY_SELECTION} selfId="p1"
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
