import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionRail } from '../src/components/ActionRail.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { initialTableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeHints, makeIdentity, makeSnapshot, makeView } from '../src/test/fixtures.ts';

function open(phase: 'action' | 'preroll' = 'action') {
  const state = initialTableState('en');
  state.session = makeIdentity();
  state.game = makeSnapshot(makeView({
    phase,
    hints: makeHints({ canRoll: phase === 'preroll', canEndTurn: phase === 'action', legalRoads: [1] }),
  }));
  const selectTarget = vi.fn();
  const submitCommand = vi.fn();
  const controller = { state, actions: { selectTarget, submitCommand } } as unknown as TableController;
  render(<LocaleProvider locale="en"><ActionRail controller={controller} /></LocaleProvider>);
  return { rail: screen.getByTestId('action-rail'), toggle: screen.getByTestId('action-rail-toggle'), selectTarget, submitCommand };
}

function pointer(element: Element, name: 'pointerover' | 'pointerdown', pointerType = 'mouse') {
  const event = new Event(name, { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(element, event);
}

describe('action rail', () => {
  it('reveals on hover, dismisses on Escape, and preserves the same mounted actions', () => {
    const { rail, toggle, submitCommand } = open();
    const bar = screen.getByTestId('action-bar');
    const road = screen.getByTestId('action-build.road');
    expect(rail.getAttribute('data-expanded')).toBe('false');
    pointer(rail, 'pointerover', 'touch');
    expect(rail.getAttribute('data-expanded')).toBe('false');
    pointer(rail, 'pointerover');
    expect(rail.getAttribute('data-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(rail.getAttribute('data-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByTestId('action-bar')).toBe(bar);
    expect(screen.getByTestId('action-build.road')).toBe(road);
    expect(submitCommand).not.toHaveBeenCalled();
  });

  it('opens for keyboard focus and keeps the original build selection behavior', () => {
    const { rail, selectTarget } = open();
    const road = screen.getByTestId('action-build.road');
    act(() => road.focus());
    expect(rail.getAttribute('data-expanded')).toBe('true');
    fireEvent.click(road);
    expect(selectTarget).toHaveBeenCalledWith({ kind: 'edge', index: null, commandType: 'build.road', labelId: 'play.build.road' });
    fireEvent.keyDown(road, { key: 'Escape' });
    expect(rail.getAttribute('data-expanded')).toBe('false');
    expect(selectTarget).toHaveBeenCalledTimes(1);
  });

  it('reopens when focus moves from the Escape destination into an action', () => {
    const { rail, toggle, submitCommand } = open();
    const endTurn = screen.getByTestId('action-endTurn');
    act(() => endTurn.focus());
    fireEvent.keyDown(endTurn, { key: 'Escape' });
    expect(rail.getAttribute('data-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    act(() => endTurn.focus());
    expect(rail.getAttribute('data-expanded')).toBe('true');
    expect(submitCommand).not.toHaveBeenCalled();
  });

  it('reopens when focus moves into an action after closing with the toggle', () => {
    const { rail, toggle, submitCommand } = open();
    act(() => toggle.focus());
    fireEvent.click(toggle);
    expect(rail.getAttribute('data-expanded')).toBe('false');
    act(() => screen.getByTestId('action-endTurn').focus());
    expect(rail.getAttribute('data-expanded')).toBe('true');
    expect(submitCommand).not.toHaveBeenCalled();
  });

  it('consumes a collapsed touch action only once, then allows the deliberate command', () => {
    const { rail, submitCommand } = open();
    const endTurn = screen.getByTestId('action-endTurn');
    pointer(endTurn, 'pointerdown', 'touch');
    act(() => endTurn.focus());
    fireEvent.click(endTurn);
    expect(rail.getAttribute('data-expanded')).toBe('true');
    expect(submitCommand).not.toHaveBeenCalled();
    pointer(endTurn, 'pointerdown', 'touch');
    fireEvent.click(endTurn);
    expect(submitCommand).toHaveBeenCalledWith({ type: 'turn.end' }, 'play.endTurn');
  });

  it('lets touch toggle open and close despite focus opening before click', () => {
    const { rail, toggle, submitCommand } = open();
    pointer(toggle, 'pointerdown', 'touch');
    act(() => toggle.focus());
    fireEvent.click(toggle);
    expect(rail.getAttribute('data-expanded')).toBe('true');
    pointer(toggle, 'pointerdown', 'touch');
    fireEvent.click(toggle);
    expect(rail.getAttribute('data-expanded')).toBe('false');
    expect(submitCommand).not.toHaveBeenCalled();
  });

  it('retains the roll command and disabled explanations in the expanded rail', () => {
    const { submitCommand, rail } = open('preroll');
    pointer(rail, 'pointerover');
    fireEvent.click(screen.getByTestId('action-roll'));
    expect(submitCommand).toHaveBeenCalledWith({ type: 'turn.roll' }, 'play.roll');
    expect((screen.getByTestId('action-build.road') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('reason-build.road').textContent).toBeTruthy();
  });
});
