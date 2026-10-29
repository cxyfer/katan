import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
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
    touch(screen.getByTestId('resource-lumber').querySelector('button')!);
    fireEvent.change(screen.getByTestId('monopoly-resource'), { target: { value: 'ore' } });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse hand' }));
    expect(hand.dataset.expanded).toBe('false');
    touch(screen.getByTestId('resource-lumber').querySelector('button')!);
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
    const card = screen.getByTestId('resource-lumber').querySelector('button')!;
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
    expect(screen.getByTestId('hand-panel').querySelectorAll('.development-card__play')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Inspect Victory point/ })).toBeTruthy();
    expect(screen.getByTestId('new-devcards').querySelector('.development-card__inspect')).toBeTruthy();
  });

  it('preserves the pending-action guard when the full hand is revealed', async () => {
    const view = makeView({ pending: { kind: 'discard', required: { p1: 2 }, waitingFor: ['p1'] } });
    const api = await open(view);
    touch(screen.getByTestId('resource-lumber').querySelector('button')!);
    expect((screen.getByTestId('play-knight-0') as HTMLButtonElement).disabled).toBe(true);
    expect(api.callsOf('sendCommand')).toHaveLength(0);
  });
});
