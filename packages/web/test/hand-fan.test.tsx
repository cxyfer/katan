import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { handFanStyles } from '../src/components/HandPanel.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi } from '../src/test/fake-api.ts';
import { makeSnapshot, makeView } from '../src/test/fixtures.ts';

async function open(view = makeView()) {
  const api = createFakeApi({ snapshot: makeSnapshot(view) });
  render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
  fireEvent.click(await screen.findByTestId('resume-g1'));
  await screen.findByTestId('board-svg');
  return api;
}
function touch(element: Element) {
  const event = new Event('pointerdown', { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  fireEvent(element, event);
  fireEvent.click(element);
}

describe('held card fan', () => {
  it('opens on the first touch without playing, then separates inspection from the explicit play action', async () => {
    const view = makeView();
    view.players[0]!.devCards = ['monopoly'];
    const api = await open(view);
    const hand = screen.getByTestId('hand-panel');
    const face = screen.getByRole('button', { name: /Inspect Monopoly/ });
    touch(face);
    expect(hand.dataset.expanded).toBe('true');
    expect(face.getAttribute('aria-pressed')).toBe('false');
    expect(api.callsOf('sendCommand')).toHaveLength(0);
    touch(face);
    expect(face.getAttribute('aria-pressed')).toBe('true');
    expect(api.callsOf('sendCommand')).toHaveLength(0);
    fireEvent.change(screen.getByTestId('monopoly-resource'), { target: { value: 'grain' } });
    fireEvent.click(screen.getByTestId('play-monopoly-0'));
    await waitFor(() => expect(api.callsOf('sendCommand')).toHaveLength(1));
    expect(api.callsOf('sendCommand')[0]!.args[1]).toMatchObject({ command: { type: 'dev.playMonopoly', resource: 'grain' } });
  });

  it('gathers cards with the touch close control or an outside tap and preserves the resource choice', async () => {
    const view = makeView();
    view.players[0]!.devCards = ['monopoly'];
    const api = await open(view);
    const hand = screen.getByTestId('hand-panel');
    touch(screen.getByTestId('resource-card-lumber-0').querySelector('button')!);
    fireEvent.change(screen.getByTestId('monopoly-resource'), { target: { value: 'ore' } });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse hand' }));
    expect(hand.dataset.expanded).toBe('false');
    touch(screen.getByTestId('resource-card-lumber-0').querySelector('button')!);
    expect((screen.getByTestId('monopoly-resource') as HTMLSelectElement).value).toBe('ore');
    fireEvent.pointerDown(screen.getByTestId('board-svg'));
    expect(hand.dataset.expanded).toBe('false');
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });

  it('reveals the fan from keyboard focus and returns focus to the gathered hand on Escape', async () => {
    const api = await open();
    const hand = screen.getByTestId('hand-panel');
    act(() => hand.focus());
    expect(hand.dataset.expanded).toBe('true');
    fireEvent.keyDown(hand, { key: ' ' });
    const card = screen.getByTestId('resource-card-lumber-0').querySelector('button')!;
    expect(document.activeElement).toBe(card);
    fireEvent.click(card);
    expect(card.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(hand.dataset.expanded).toBe('false');
    expect(document.activeElement).toBe(hand);
    expect(card.getAttribute('aria-pressed')).toBe('false');
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });

  it('only places the current seat private cards in the fan and keeps new and victory point cards unplayable', async () => {
    const view = makeView();
    view.players[0]!.devCards = ['victoryPoint'];
    view.players[0]!.newDevCards = ['knight'];
    view.players[1]!.devCards = ['monopoly'];
    view.players[1]!.resources = { lumber: 99, brick: 0, wool: 0, grain: 0, ore: 0 };
    await open(view);
    fireEvent.focus(screen.getByTestId('hand-panel'));
    expect(screen.queryByRole('button', { name: /Inspect Monopoly/ })).toBeNull();
    expect(screen.getByTestId('resource-lumber').textContent).toContain('2');
    expect(screen.getByTestId('resource-lumber').textContent).not.toContain('99');
    expect(screen.getByTestId('hand-panel').querySelectorAll('[data-resource="lumber"]')).toHaveLength(2);
    expect(screen.getByTestId('hand-panel').querySelectorAll('.development-card__play')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Inspect Victory point/ })).toBeTruthy();
    expect(screen.getByTestId('new-devcards').querySelector('.development-card__inspect')).toBeTruthy();
  });

  it('swipes through a dense hand without commands and leaves resource selectors to native touch handling', async () => {
    const view = makeView();
    view.players[0]!.devCards = Array.from({ length: 20 }, (_, index) => index === 0 ? 'monopoly' : 'knight');
    const api = await open(view);
    const lumber = screen.getByTestId('resource-card-lumber-0').querySelector('button')!;
    const nextLumber = screen.getByTestId('resource-card-lumber-1').querySelector('button')!;
    const swipe = (element: Element) => {
      for (const [type, x] of [['pointerdown', 220], ['pointerup', 100]] as const) {
        const event = new Event(type, { bubbles: true });
        Object.defineProperties(event, { pointerType: { value: 'touch' }, clientX: { value: x } });
        fireEvent(element, event);
      }
      fireEvent.click(element);
    };
    touch(lumber);
    swipe(lumber);
    expect(document.activeElement).toBe(nextLumber);
    swipe(nextLumber);
    const brick = screen.getByTestId('resource-card-brick-0').querySelector('button');
    expect(document.activeElement).toBe(brick);
    swipe(screen.getByTestId('monopoly-resource'));
    expect(document.activeElement).toBe(brick);
    fireEvent.change(screen.getByTestId('monopoly-resource'), { target: { value: 'ore' } });
    expect((screen.getByTestId('monopoly-resource') as HTMLSelectElement).value).toBe('ore');
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });
  it('preserves the pending-action guard when the full hand is revealed', async () => {
    const view = makeView({ pending: { kind: 'discard', required: { p1: 2 }, waitingFor: ['p1'] } });
    const api = await open(view);
    touch(screen.getByTestId('resource-card-lumber-0').querySelector('button')!);
    expect((screen.getByTestId('play-knight-0') as HTMLButtonElement).disabled).toBe(true);
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });

  it('deals one card per held resource, skips missing kinds, and tallies every kind with an icon and count', async () => {
    const view = makeView();
    view.players[0]!.resources = { lumber: 3, brick: 0, wool: 1, grain: 0, ore: 2 };
    view.players[0]!.handSize = 6;
    view.players[0]!.devCards = [];
    view.players[0]!.devCardCount = 0;
    await open(view);
    const hand = screen.getByTestId('hand-panel');
    const dealt = Array.from(hand.querySelectorAll<HTMLElement>('.hand-card')).map((card) => card.dataset.resource);
    expect(dealt).toEqual(['lumber', 'lumber', 'lumber', 'wool', 'ore', 'ore']);
    expect(hand.querySelector('[data-resource="brick"]')).toBeNull();
    expect(hand.querySelector('.hand-card .resource-tally__count')).toBeNull();
    expect(screen.getByRole('button', { name: 'Lumber, card 3 of 3; select to inspect' })).toBeTruthy();
    const tally = screen.getByTestId('resource-tally');
    expect(tally.getAttribute('aria-label')).toBe('Resource counts');
    for (const [resource, count] of [['lumber', '3'], ['brick', '0'], ['wool', '1'], ['grain', '0'], ['ore', '2']] as const) {
      const item = screen.getByTestId(`resource-${resource}`);
      expect(item.querySelector('.resource-tally__icon svg')).toBeTruthy();
      expect(item.querySelector('.resource-tally__count')!.textContent).toBe(count);
      expect(item.classList.contains('resource-tally__item--empty')).toBe(count === '0');
    }
    expect(screen.getByTestId('resource-tally-total').textContent).toContain('6');
  });

  it('keeps a small hand tight and leaves a gap between kinds in the fan layout', () => {
    expect(handFanStyles([1])).toEqual([expect.objectContaining({ '--hand-position': 0, '--hand-span': 0 })]);
    const styles = handFanStyles([2, 0, 1]) as Record<string, unknown>[];
    expect(styles.map((style) => style['--card-index'])).toEqual([0, 1, 2]);
    // 第二種資源前多留 0.6 張的間距：位置 0、1、2.6
    expect(styles[2]!['--hand-span']).toBeCloseTo(2.6);
    expect(styles[0]!['--hand-position']).toBe(-1);
    expect(styles[1]!['--hand-position']).toBeCloseTo(1 / 2.6 * 2 - 1);
    expect(styles[2]!['--hand-position']).toBe(1);
  });
});
