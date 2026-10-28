import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { confirmedPlacement, MAX_FLIGHT_ICONS, neutralThefts, productionGrants } from '../src/board/effects.ts';
import { boardEffectGroup } from '../src/board/animation.ts';
import { buildGeometry } from '../src/board/geometry.ts';
import type { BoardEffectAnchors } from '../src/board/render-contract.ts';
import { BoardEffects } from '../src/components/BoardEffects.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { makeEvent, makeView } from '../src/test/fixtures.ts';

describe('authorized aggregate presentation', () => {
  it('keeps only actual positive integer resource grants, combining aggregates without deriving a hex source', () => {
    const events = [makeEvent(1, 'production.resolved', { total: 6, grants: { p1: { lumber: 2, wool: 0, grain: -1, ore: 1.5, secret: 4 }, p2: { brick: 1 } } }),
      makeEvent(2, 'production.resolved', { total: 6, grants: { p1: { lumber: 3 } } }), makeEvent(3, 'production.starved', { hex: 1, resource: 'ore' })];
    expect(productionGrants(events)).toEqual([{ playerId: 'p1', resource: 'lumber', amount: 5 }, { playerId: 'p2', resource: 'brick', amount: 1 }]);
    expect(productionGrants([makeEvent(4, 'production.resolved', { grants: {} })])).toEqual([]);
    expect(productionGrants([makeEvent(5, 'turn.rolled', { total: 7 })])).toEqual([]);
  });

  it('strips card identity even for an authorized thief or victim', () => {
    const event = makeEvent(1, 'robber.stole', { playerId: 'p1', victim: 'p2', resource: 'ore', privateMarker: 'secret' });
    expect(neutralThefts([event])).toEqual([{ seq: 1, playerId: 'p1', victim: 'p2' }]);
  });

  it('requires matching confirmed event and current authoritative placement', () => {
    const board = makeView().board;
    board.buildings[0] = { player: 'p1', city: true };
    board.roads[0] = { player: 'p1', ship: false };
    expect(confirmedPlacement([makeEvent(1, 'build.city', { playerId: 'p1', vertex: 0 })], board, 'vertex', 0)).toBe(true);
    expect(confirmedPlacement([makeEvent(1, 'build.settlement', { playerId: 'p1', vertex: 0 })], board, 'vertex', 0)).toBe(false);
    expect(confirmedPlacement([makeEvent(1, 'build.road', { playerId: 'p2', edge: 0 })], board, 'edge', 0)).toBe(false);
    expect(confirmedPlacement([], board, 'vertex', 0)).toBe(false);
  });

  function effectAnchors(players: readonly { id: string }[]): BoardEffectAnchors {
    return {
      stage: { left: 0, top: 0, width: 1000, height: 800 },
      seats: new Map(players.map((player, seat) => [player.id, {
        left: 20, top: 100 + seat * 80, width: 160, height: 56,
      }])),
      aggregate: { left: 800, top: 20, width: 120, height: 40 },
      targets: [],
    };
  }

  function overlay(params: Record<string, unknown>, type = 'production.resolved', players = 6) {
    const view = makeView();
    view.players = Array.from({ length: players }, (_, seat) => ({ ...view.players[0]!, id: `p${seat + 1}`, seat }));
    return render(<LocaleProvider locale="en"><BoardEffects group={boardEffectGroup('g1', [makeEvent(1, type, params)])}
      geometry={buildGeometry('hex-r56')} view={view} anchors={effectAnchors(view.players)} /></LocaleProvider>);
  }

  it('bounds simultaneous flight icons at 24 while retaining complete aggregate receipt text', () => {
    const { container } = overlay({ total: 6, grants: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`p${i + 1}`, { lumber: 2, brick: 2, wool: 2, grain: 2, ore: 2 }])) });
    expect(container.querySelectorAll('[data-testid="production-flight"]')).toHaveLength(MAX_FLIGHT_ICONS);
    expect(container.querySelectorAll('.board-effects__receipt')).toHaveLength(6);
    expect(container.querySelector('[data-testid="board-effects"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('[tabindex],button,a')).toHaveLength(0);
  });

  it('does not suggest production, flights or receipts for starved / empty grants', () => {
    const { container } = overlay({ total: 6, grants: {} });
    expect(container.querySelectorAll('.board-effects__source,.board-effects__flight,.board-effects__receipt')).toHaveLength(0);
  });

  it('labels aggregate allocation in both supported locales without fallback or corrupted text', () => {
    const view = makeView();
    const group = boardEffectGroup('g1', [makeEvent(1, 'production.resolved', { grants: { p1: { lumber: 1 } } })]);
    const { container, rerender } = render(<LocaleProvider locale="zh-Hant"><BoardEffects group={group} geometry={buildGeometry('hex-r2')} view={view} anchors={effectAnchors(view.players)} /></LocaleProvider>);
    expect(container.textContent).toContain('實際彙總配發');
    rerender(<LocaleProvider locale="en"><BoardEffects group={group} geometry={buildGeometry('hex-r2')} view={view} anchors={effectAnchors(view.players)} /></LocaleProvider>);
    expect(container.textContent).toContain('Aggregate allocation');
  });

  it('renders identical neutral theft markup for three viewers and an outsider regardless of private resource', () => {
    const html: string[] = [];
    for (const resource of ['ore', 'grain', undefined, undefined]) {
      const { container, unmount } = overlay({ playerId: 'p1', victim: 'p2', ...(resource ? { resource } : {}) }, 'robber.stole', 3);
      html.push(container.innerHTML);
      expect(container.querySelectorAll('[data-testid="neutral-theft"]')).toHaveLength(1);
      expect(container.querySelector('[data-testid="neutral-theft"]')?.getAttribute('style')).not.toContain('--flight-y: 0px');
      expect(container.textContent).toBe('');
      expect(container.innerHTML).not.toMatch(/ore|grain|aria-label|title/);
      unmount();
    }
    expect(new Set(html).size).toBe(1);
  });
});
