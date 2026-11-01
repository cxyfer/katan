import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../src/board/geometry.ts';
import { tbNumberTokens } from '../src/board/three/TbScenePieces.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { PendingPrompt } from '../src/components/PendingPrompt.tsx';
import { TbPanel } from '../src/components/tb/TbPanel.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { EMPTY_SELECTION } from '../src/state/table.ts';
import { tbController, tbSlot, tbState } from './tb-helpers.tsx';

const PROFILE = 'tb-fishing-2025';

describe('Fishing on Catan UI', () => {
  it('draws six numbered fishing grounds and the lake numbers on the SVG board', () => {
    const state = tbState(PROFILE);
    const controller = tbController(state);
    const view = controller.state.game!.view;
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const { container } = render(<LocaleProvider locale="en">
      <SvgBoard svgRef={() => {}} geometry={geometry} view={view} active={null} selection={EMPTY_SELECTION} selfId="p1"
        intent={null} pan={{ x: 0, y: 0 }} zoom={1} viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} />
    </LocaleProvider>);
    expect(container.querySelectorAll('.tb-ground')).toHaveLength(6);
    expect(view.board.robber).toBe(-1);
    expect(container.querySelector('[data-testid="robber"]')).toBeNull();
    // 3D: six ground badges plus the lake's four numbers.
    expect(tbNumberTokens(geometry, view.modules).map((token) => token.value).sort((a, b) => a - b))
      .toEqual([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
  });

  it('lets the active player pick tokens and spend them on an action', () => {
    const state = tbState(PROFILE);
    tbSlot<{ hands: Record<string, number[]> }>(state, 'tb-fishing').hands.p1 = [3, 2, 1];
    const controller = tbController(state);
    render(<LocaleProvider locale="en"><TbPanel controller={controller} /></LocaleProvider>);
    expect(screen.getAllByTestId(/^tb-fish-token-/)).toHaveLength(3);
    expect(screen.getByTestId('tb-fish-action-devCard')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByTestId('tb-fish-action-takeResource'));
    // The suggestion covers the cost with the largest tokens first.
    expect(screen.getByTestId('tb-fish-token-0').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('tb-fish-token-2').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('tb-fish-submit'));
    expect(controller.actions.submitCommand).toHaveBeenCalledWith(
      { type: 'tb.spendFish', action: 'takeResource', tokens: [3, 2], resource: 'lumber' }, 'tb.fishing.action.takeResource');
  });

  it('arms the board for a free road instead of submitting', () => {
    const state = tbState(PROFILE);
    tbSlot<{ hands: Record<string, number[]> }>(state, 'tb-fishing').hands.p1 = [3, 3];
    const controller = tbController(state);
    render(<LocaleProvider locale="en"><TbPanel controller={controller} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('tb-fish-action-road'));
    fireEvent.click(screen.getByTestId('tb-fish-submit'));
    expect(controller.actions.selectTarget).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'edge', commandType: 'tb.spendFish', field: 'edge', extra: { action: 'road', tokens: [3, 3] },
    }));
  });

  it('shows other players only token counts', () => {
    const state = tbState(PROFILE);
    tbSlot<{ hands: Record<string, number[]> }>(state, 'tb-fishing').hands.p1 = [3, 2];
    render(<LocaleProvider locale="en"><TbPanel controller={tbController(state, 'p2')} /></LocaleProvider>);
    expect(screen.queryAllByTestId(/^tb-fish-token-/)).toHaveLength(0);
    expect(screen.getByText('P1: 2 token(s)')).toBeTruthy();
  });

  it('offers the swap inside the mandatory prompt', () => {
    const state = tbState(PROFILE);
    tbSlot<{ hands: Record<string, number[]> }>(state, 'tb-fishing').hands.p1 = [1, 1, 2, 2, 3, 3, 3];
    state.pending = { kind: 'tradersBarbarians.fishSwap', module: 'tradersBarbarians', responders: ['p1'], data: { queue: [] } };
    const controller = tbController(state);
    render(<LocaleProvider locale="en"><PendingPrompt controller={controller} /></LocaleProvider>);
    expect(screen.getByText(/You hold 7 fish tokens/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('tb-fish-swap-1'));
    expect(controller.actions.submitCommand).toHaveBeenCalledWith({ type: 'tb.fishSwap', token: 1 }, 'tb.fishing.swap');
  });
});
