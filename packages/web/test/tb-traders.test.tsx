import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getTopology } from '@catan/rules';
import { boardIntent } from '../src/board/intent.ts';
import { coastLoops } from '../src/board/coastline.ts';
import { buildGeometry, isCoastEdge } from '../src/board/geometry.ts';
import { PendingPrompt } from '../src/components/PendingPrompt.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { TbPanel } from '../src/components/tb/TbPanel.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { EMPTY_SELECTION } from '../src/state/table.ts';
import { tbController, tbSlot, tbState } from './tb-helpers.tsx';

const PROFILE = 'tb-traders-barbarians-2025';
type Traders = { barbarians: number[]; wagons: Record<string, { vertex: number; level: number; cargo: string | null; delivered: number }> };

describe('Traders & Barbarians scenario UI', () => {
  it('keeps interior paths off the coastline', () => {
    const topology = getTopology('tb-traders-r2');
    const geometry = buildGeometry('tb-traders-r2');
    const interior = topology.edges.map((edge, index) => (edge.interior ? index : -1)).filter((index) => index >= 0);
    expect(interior).toHaveLength(12);
    for (const edge of interior) expect(isCoastEdge(geometry, edge)).toBe(false);
    expect(coastLoops(topology)).toEqual(coastLoops(getTopology('tb-r2')));
  });

  it('draws plazas, X markers, edge barbarians and player wagons', () => {
    const state = tbState(PROFILE);
    tbSlot<Traders>(state, 'tb-traders-barbarians').wagons.p1 = { vertex: 10, level: 1, cargo: 'tools', delivered: 0 };
    const view = tbController(state).state.game!.view;
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const { container } = render(<LocaleProvider locale="en">
      <SvgBoard svgRef={() => {}} geometry={geometry} view={view} arrivals={[]} selection={EMPTY_SELECTION} selfId="p1"
        intent={null} pan={{ x: 0, y: 0 }} zoom={1} viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} />
    </LocaleProvider>);
    expect(container.querySelectorAll('[data-testid^="tb-plaza-"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-testid^="tb-x-"]')).toHaveLength(9);
    expect(container.querySelectorAll('[data-testid^="tb-edge-barbarian-"]')).toHaveLength(3);
    expect(container.querySelector('[data-testid="tb-player-wagon-p1"]')).not.toBeNull();
  });

  it('arms the board for wagon steps and offers boost, drive-off and stop', () => {
    const state = tbState(PROFILE);
    const traders = tbSlot<Traders>(state, 'tb-traders-barbarians');
    traders.wagons.p1 = { vertex: 10, level: 2, cargo: null, delivered: 0 };
    state.pending = { kind: 'tradersBarbarians.tbWagon', module: 'tradersBarbarians', responders: ['p1'], data: { mp: 4, boosted: false, extra: 0, drivenOff: [] } };
    const controller = tbController(state);
    const intent = boardIntent(controller.state, 'p1')!;
    expect(intent).toMatchObject({ kind: 'vertex', commandType: 'tb.wagonStep', field: 'to' });
    expect(intent.targets.length).toBeGreaterThan(0);
    render(<LocaleProvider locale="en"><PendingPrompt controller={controller} /></LocaleProvider>);
    expect(screen.getByTestId('tb-wagon-mp').textContent).toContain('4');
    fireEvent.click(screen.getByTestId('tb-wagon-stop'));
    expect(controller.actions.submitCommand).toHaveBeenCalledWith({ type: 'tb.wagonStop' }, 'tb.traders.stop');
  });

  it('plays a Knight by picking the barbarian, then its edge on the board', () => {
    const state = tbState(PROFILE);
    state.players[0]!.devCards = ['barbarianKnight'];
    const from = tbSlot<Traders>(state, 'tb-traders-barbarians').barbarians[0]!;
    const controller = tbController(state);
    render(<LocaleProvider locale="en"><TbPanel controller={controller} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId(`tb-knight-barbarian-${from}`));
    expect(controller.actions.selectTarget).toHaveBeenCalledWith(expect.objectContaining({
      commandType: 'tb.playKnight', extra: { from }, field: 'to', targetsKey: `tb.barbarian:${from}`,
    }));
  });
});
