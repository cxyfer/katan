import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { DICE_ROLL_DURATION_MS } from '../src/board/animation.ts';
import { DieFace } from '../src/components/DieFace.tsx';
import { DicePresentation } from '../src/components/DicePresentation.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi } from '../src/test/fake-api.ts';
import { makeEvent, makeSnapshot, makeView } from '../src/test/fixtures.ts';

afterEach(() => vi.useRealTimers());

const faces = [
  [1, [[50, 50]]],
  [2, [[25, 25], [75, 75]]],
  [3, [[25, 25], [50, 50], [75, 75]]],
  [4, [[25, 25], [75, 25], [25, 75], [75, 75]]],
  [5, [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]]],
  [6, [[25, 25], [75, 25], [25, 50], [75, 50], [25, 75], [75, 75]]],
] as const;

function positions(face: Element) {
  return [...face.querySelectorAll('circle')].map((pip) => [
    Number(pip.getAttribute('cx')), Number(pip.getAttribute('cy')),
  ]);
}

describe('full-face pip dice', () => {
  it.each(faces)('lays out face %i in conventional positions without text or an inner die border', (value, expected) => {
    const { container } = render(<DieFace value={value} />);
    const face = container.querySelector('.die-face')!;
    expect(face.getAttribute('data-value')).toBe(String(value));
    expect(face.getAttribute('aria-hidden')).toBe('true');
    expect(positions(face)).toEqual(expected);
    expect(face.textContent).toBe('');
    expect(face.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(face.querySelector('rect')).toBeNull();
  });

  it('keeps cycling decoration hidden and unnamed until the authoritative result is revealed', () => {
    vi.useFakeTimers();
    render(<LocaleProvider locale="en"><DicePresentation dice={[2, 6]} /></LocaleProvider>);
    const focus = screen.getByTestId('dice-focus');
    const rollingDice = [...focus.querySelectorAll('.die-face')];
    expect(rollingDice).toHaveLength(2);
    for (const face of rollingDice) {
      expect(face.getAttribute('data-value')).toBeNull();
      expect(face.getAttribute('data-rolling')).toBe('true');
      expect(face.getAttribute('aria-hidden')).toBe('true');
      expect([...face.querySelectorAll('svg')].map((pattern) => pattern.getAttribute('data-pips')))
        .toEqual(['1', '2', '3', '4', '5', '6']);
      expect(face.textContent).toBe('');
    }
    expect(screen.getByTestId('dice-announcement').textContent).toBe('');
    act(() => vi.advanceTimersByTime(DICE_ROLL_DURATION_MS - 1));
    expect(focus.getAttribute('data-phase')).toBe('rolling');
    expect(screen.getByTestId('dice-announcement').textContent).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(focus.getAttribute('data-phase')).toBe('result');
    expect(screen.getByTestId('dice-announcement').textContent).toBe('Rolled 2 + 6 = 8');
    expect([...focus.querySelectorAll('.die-face')].map((face) => face.querySelectorAll('circle').length)).toEqual([2, 6]);
    expect(focus.querySelectorAll('[data-rolling]')).toHaveLength(0);
  });

  it('uses the same pip faces in the compact board and centered result while retaining the accessible result', async () => {
    const view = makeView({ events: [makeEvent(13, 'turn.rolled', { dice: [2, 6], total: 8 })] });
    view.seq = 13;
    view.turn.dice = [2, 6];
    render(<App services={{ api: createFakeApi({ snapshot: makeSnapshot(view, 13) }), storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
    fireEvent.click(await screen.findByTestId('resume-g1'));
    await screen.findByTestId('board-svg');
    const compact = screen.getByRole('img', { name: 'Dice: 2 + 6' });
    const compactFaces = [...compact.querySelectorAll('.die-face')];
    expect(compactFaces.map((face) => face.getAttribute('data-value'))).toEqual(['2', '6']);
    expect(compactFaces.map((face) => face.textContent)).toEqual(['', '']);
    expect(compact.textContent).toBe('Rolled 2 + 6 = 8');
    expect(screen.queryByTestId('dice-focus')).toBeNull();

    vi.useFakeTimers();
    render(<LocaleProvider locale="en"><DicePresentation dice={[2, 6]} /></LocaleProvider>);
    act(() => vi.advanceTimersByTime(DICE_ROLL_DURATION_MS));
    const focusedFaces = [...screen.getByTestId('dice-focus').querySelectorAll('.die-face')];
    expect(focusedFaces.map(positions)).toEqual(compactFaces.map(positions));
  });
});
