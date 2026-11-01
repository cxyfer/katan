import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { boardIntent } from '../src/board/intent.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import { PendingPrompt } from '../src/components/PendingPrompt.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { EMPTY_SELECTION } from '../src/state/table.ts';
import { tbController, tbSlot, tbState } from './tb-helpers.tsx';

const PROFILE = 'tb-merchant-trains-2025';
type Trains = { starts: { vertex: number; edge: number }[]; wagons: { edge: number; train: number }[] };

describe('Merchant Trains UI', () => {
  it('draws wagons and the unused train starts', () => {
    const state = tbState(PROFILE);
    const trains = tbSlot<Trains>(state, 'tb-merchant-trains');
    trains.wagons.push({ edge: trains.starts[0]!.edge, train: 0 });
    const view = tbController(state).state.game!.view;
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const { container } = render(<LocaleProvider locale="en">
      <SvgBoard svgRef={() => {}} geometry={geometry} view={view} active={null} selection={EMPTY_SELECTION} selfId="p1"
        intent={null} pan={{ x: 0, y: 0 }} zoom={1} viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} />
    </LocaleProvider>);
    expect(container.querySelectorAll('.tb-wagon')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid^="tb-train-start-"]')).toHaveLength(2);
  });

  it('collects a bid in the prompt and arms the board for the placement', () => {
    const state = tbState(PROFILE);
    state.players[0]!.resources.grain = 2;
    state.pending = { kind: 'tradersBarbarians.wagonBid', module: 'tradersBarbarians', responders: ['p1', 'p2', 'p3', 'p4'], data: { bids: {}, assignments: {}, active: 'p1' } };
    const controller = tbController(state);
    render(<LocaleProvider locale="en"><PendingPrompt controller={controller} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('tb-bid-grain-add'));
    fireEvent.click(screen.getByTestId('tb-bid-submit'));
    expect(controller.actions.submitCommand).toHaveBeenCalledWith({ type: 'tb.bidWagon', wool: 0, grain: 1 }, 'tb.trains.bid');

    state.pending = { kind: 'tradersBarbarians.wagonPlace', module: 'tradersBarbarians', responders: ['p1'], data: { bids: {}, assignments: {}, active: 'p1' } };
    const placing = tbController(state);
    const intent = boardIntent(placing.state, 'p1');
    expect(intent).toMatchObject({ kind: 'edge', commandType: 'tb.placeWagon' });
    expect(intent!.targets.sort()).toEqual(tbSlot<Trains>(state, 'tb-merchant-trains').starts.map((start) => start.edge).sort());
  });
});
