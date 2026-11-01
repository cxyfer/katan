import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { boardIntent } from '../src/board/intent.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import { PendingPrompt } from '../src/components/PendingPrompt.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { EMPTY_SELECTION } from '../src/state/table.ts';
import { tbController, tbSlot, tbState } from './tb-helpers.tsx';

const PROFILE = 'tb-barbarian-attack-2025';
type Ba = { coastal: number[]; barbarians: Record<number, number>; knights: { player: string; edge: number }[]; castle: number };

describe('Barbarian Attack UI', () => {
  it('draws barbarians, a conquered hex and knights', () => {
    const state = tbState(PROFILE);
    const ba = tbSlot<Ba>(state, 'tb-barbarian-attack');
    ba.barbarians[ba.coastal[0]!] = 3;
    ba.knights.push({ player: 'p2', edge: 5 });
    const view = tbController(state).state.game!.view;
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const { container } = render(<LocaleProvider locale="en">
      <SvgBoard svgRef={() => {}} geometry={geometry} view={view} active={null} selection={EMPTY_SELECTION} selfId="p1"
        intent={null} pan={{ x: 0, y: 0 }} zoom={1} viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} />
    </LocaleProvider>);
    // Two from setup (on the 2 and the 12) plus three on the conquered hex.
    expect(container.querySelectorAll('.tb-barbarian')).toHaveLength(5);
    expect(container.querySelector('[data-testid="tb-knight-5"]')).not.toBeNull();
  });

  it('arms the board for a knight move with that knight’s own targets', () => {
    const state = tbState(PROFILE);
    const ba = tbSlot<Ba>(state, 'tb-barbarian-attack');
    ba.knights.push({ player: 'p1', edge: 30 });
    state.pending = { kind: 'tradersBarbarians.baKnights', module: 'tradersBarbarians', responders: ['p1'], data: { moved: [] } };
    const controller = tbController(state);
    render(<LocaleProvider locale="en"><PendingPrompt controller={controller} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('tb-knight-move-30'));
    const selection = (controller.actions.selectTarget as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as Record<string, unknown>;
    expect(selection).toMatchObject({ commandType: 'tb.moveKnight', extra: { from: 30, boost: false }, field: 'to', targetsKey: 'tb.moveKnight:30:0' });
    controller.state.selection = selection as never;
    const intent = boardIntent(controller.state, 'p1')!;
    expect(intent.targets.length).toBeGreaterThan(3);
    expect(intent.targets).not.toContain(30);
  });

  it('offers victims after a 7', () => {
    const state = tbState(PROFILE);
    state.players[2]!.resources.ore = 1;
    state.pending = { kind: 'tradersBarbarians.baSteal', module: 'tradersBarbarians', responders: ['p1'], data: {} };
    const controller = tbController(state);
    render(<LocaleProvider locale="en"><PendingPrompt controller={controller} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('tb-ba-steal-p3'));
    expect(controller.actions.submitCommand).toHaveBeenCalledWith({ type: 'tb.baSteal', victim: 'p3' }, 'tb.ba.stealFrom');
  });
});
