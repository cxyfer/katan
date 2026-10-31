import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { HandPanel, handFanStyles } from '../src/components/HandPanel.tsx';
import { initialTableState } from '../src/state/table.ts';
import { memoryStorage } from '../src/state/session.ts';
import type { TableController } from '../src/state/useTable.ts';
import { createFakeApi } from '../src/test/fake-api.ts';
import { makeIdentity, makeSnapshot, makeView } from '../src/test/fixtures.ts';

async function open(view = makeView()) {
  const api = createFakeApi({ snapshot: makeSnapshot(view) });
  render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
  fireEvent.click(await screen.findByTestId('resume-g1'));
  await screen.findByTestId('board-svg');
  return api;
}
function pointerEnter(element: Element, type = 'mouse') {
  const event = new Event('pointerover', { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: type });
  fireEvent(element, event);
}
function touch(element: Element) {
  const event = new Event('pointerdown', { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  fireEvent(element, event);
  fireEvent.click(element);
}
function emptyHandView() {
  const view = makeView();
  Object.assign(view.players[0]!, {
    resources: { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 },
    handSize: 0,
    devCards: [],
    newDevCards: [],
    devCardCount: 0,
    newDevCardCount: 0,
  });
  return view;
}
function panelController(view: ReturnType<typeof makeView>): TableController {
  return {
    state: { ...initialTableState('en'), game: makeSnapshot(view), session: makeIdentity() },
    actions: {} as TableController['actions'],
    dispatch: () => undefined,
  };
}

describe('held card fan', () => {
  it('keeps an empty hand collapsed and removes every expand affordance', async () => {
    await open(emptyHandView());
    const hand = screen.getByTestId('hand-panel');
    expect(hand.dataset.empty).toBe('true');
    expect(hand.dataset.expanded).toBe('false');
    expect(hand.hasAttribute('tabindex')).toBe(false);
    expect(hand.getAttribute('aria-describedby')).toBeNull();
    expect(screen.getByText('No resource cards.')).toBeTruthy();

    pointerEnter(hand);
    fireEvent.focus(hand);
    fireEvent.keyDown(hand, { key: ' ' });
    touch(hand);
    fireEvent.click(hand);
    expect(hand.dataset.expanded).toBe('false');
    expect(screen.queryByRole('button', { name: 'Collapse hand' })).toBeNull();
  });

  it('collapses when the hand empties and stays collapsed when cards return', () => {
    const view = makeView();
    const { rerender } = render(<HandPanel controller={panelController(view)} />);
    const hand = screen.getByTestId('hand-panel');
    pointerEnter(hand);
    expect(hand.dataset.expanded).toBe('true');

    const empty = structuredClone(view);
    Object.assign(empty.players[0]!, {
      resources: { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 },
      handSize: 0,
      devCards: [],
      newDevCards: [],
      devCardCount: 0,
      newDevCardCount: 0,
    });
    rerender(<HandPanel controller={panelController(empty)} />);
    expect(hand.dataset.expanded).toBe('false');
    expect(hand.hasAttribute('tabindex')).toBe(false);

    // 內部展開狀態也必須重設，否則牌回來時會無故自動展開。
    rerender(<HandPanel controller={panelController(view)} />);
    expect(hand.dataset.expanded).toBe('false');
    pointerEnter(hand);
    expect(hand.dataset.expanded).toBe('true');
  });

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

  it('keeps one tab stop per kind and walks every card with the arrow, Home and End keys', async () => {
    const view = makeView();
    view.players[0]!.resources = { lumber: 2, brick: 0, wool: 1, grain: 0, ore: 0 };
    view.players[0]!.handSize = 3;
    await open(view);
    const face = (id: string) => screen.getByTestId(id).querySelector('button')!;
    expect(face('resource-card-lumber-0').tabIndex).toBe(0);
    expect(face('resource-card-lumber-1').tabIndex).toBe(-1);
    expect(face('resource-card-wool-0').tabIndex).toBe(0);
    act(() => face('resource-card-lumber-0').focus());
    fireEvent.keyDown(face('resource-card-lumber-0'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(face('resource-card-lumber-1'));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    // 最後一張是唯一的發展卡（騎士）
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Inspect Knight/ }));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(face('resource-card-lumber-0'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Inspect Knight/ }));
  });

  it('places development cards after every resource card in the fan order', async () => {
    const view = makeView();
    view.players[0]!.devCards = ['monopoly'];
    view.players[0]!.newDevCards = ['knight'];
    await open(view);
    const cards = Array.from(screen.getByTestId('hand-panel').querySelectorAll<HTMLElement>('.hand-fan__card'));
    expect(cards.map((card) => card.style.getPropertyValue('--card-index'))).toEqual(cards.map((_, index) => String(index)));
    expect(cards.slice(-2).every((card) => card.classList.contains('development-card'))).toBe(true);
    expect(cards.at(-1)!.style.getPropertyValue('--hand-position')).toBe('1');
  });

  it('draws development cards with the shared card frame, an effect line and a tag on cards bought this turn', async () => {
    const view = makeView();
    view.players[0]!.devCards = ['yearOfPlenty'];
    view.players[0]!.newDevCards = ['victoryPoint'];
    await open(view);
    const ready = screen.getByRole('button', { name: /Inspect Year of plenty/ }).closest('li')!;
    expect(ready.querySelector('.dev-card-art--yearOfPlenty')).toBeTruthy();
    expect(ready.querySelector('.development-card__pip svg')).toBeTruthy();
    expect(ready.querySelector('.development-card__effect')!.textContent).toBe('Take any 2 resources from the bank');
    expect(ready.querySelector('.development-card__tag')).toBeNull();
    const fresh = screen.getByTestId('new-devcards').querySelector('li')!;
    expect(fresh.querySelector('.development-card__tag')!.textContent).toBe('New');
    expect(fresh.querySelector('.development-card__inspect')!.getAttribute('aria-label')).toContain('Bought this turn');
  });

  it('returns an inspected resource card to the fan when focus moves to another card', async () => {
    await open();
    const lumber = screen.getByTestId('resource-card-lumber-0').querySelector('button')!;
    act(() => lumber.focus());
    fireEvent.click(lumber);
    expect(lumber.getAttribute('aria-pressed')).toBe('true');
    act(() => screen.getByTestId('resource-card-wool-0').querySelector('button')!.focus());
    expect(lumber.getAttribute('aria-pressed')).toBe('false');
  });
});
