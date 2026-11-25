/**
 * The Pirate Islands（S7b）的前端：海盜的位置與巡弋順序（SVG 箭頭、3D 箭頭與位置環）、贏了海盜的選牌、
 * 7 的偷牌（任一玩家、可不偷）、攻擊與偷牌的紀錄文字（zh-Hant 與 en）。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actionHints, createGame, projectGame, seededRng, type GameState, type GameView } from '@katan/rules';
import { buildGeometry } from '../src/board/geometry.ts';
import { seafarersHints, seafarersView } from '../src/board/seafarers.ts';
import { createPositionRingModel, createRouteArrowModel, routeArrows } from '../src/board/three/diorama-pirate-islands.ts';
import { SeafarersPrompt } from '../src/components/SeafarersPrompt.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { t as translate } from '../src/i18n/index.ts';
import { cueForEvent } from '../src/audio/cues.ts';
import { EMPTY_SELECTION, initialTableState, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeSnapshot } from '../src/test/fixtures.ts';

const PROFILE = 'sf-pirate-islands-2025';
const COLORS = ['red', 'blue', 'orange', 'white'] as const;

function pirateState(): GameState {
  const state = createGame({
    profileId: PROFILE,
    players: ['p1', 'p2', 'p3', 'p4'].map((id, seat) => ({ id, nickname: id.toUpperCase(), color: COLORS[seat]! })),
    setupMode: 'fixed',
    rng: seededRng(4),
  });
  state.turn.setup = null;
  state.turn.phase = 'action';
  state.turn.seat = 0;
  state.windowId += 1;
  return state;
}

const viewOf = (state: GameState, viewer = 'p1'): GameView => projectGame(state, viewer, { hints: actionHints(state, viewer) });

function tableWith(view: GameView): TableState {
  return {
    ...initialTableState('en', 'Alex'),
    bootstrapped: true,
    session: { id: 'p1', nickname: 'Alex', locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' },
    screen: 'game',
    connection: 'online',
    game: makeSnapshot(view),
  };
}

const svg = (view: GameView) => {
  const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
  return render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
    arrivals={[]} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
    viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id.toUpperCase()} /></LocaleProvider>);
};

describe('the cruising pirate on the board (SVG)', () => {
  it('shows the pirate on the route start, one clockwise arrow per leg, and where each die result would stop it', () => {
    const state = pirateState();
    const view = viewOf(state);
    const route = seafarersView(view)!.pirateIslands!.route;
    const { container } = svg(view);
    const hex = container.querySelector('[data-testid="pirate-hex"]');
    expect(hex).not.toBeNull();
    expect(container.querySelector('[data-testid="pirate-position"]')!.getAttribute('data-hex')).toBe(String(route[0]));
    const arrows = [...container.querySelectorAll('[data-testid^="pirate-route-arrow-"]')];
    expect(arrows).toHaveLength(14);
    arrows.forEach((arrow, index) => {
      expect(arrow.getAttribute('data-from')).toBe(String(route[index]));
      expect(arrow.getAttribute('data-to')).toBe(String(route[(index + 1) % 14]));
      expect(arrow.querySelector('title')!.textContent).toBe('Pirate route: the pirate sails clockwise');
    });
    for (let steps = 1; steps <= 6; steps += 1) {
      const chip = container.querySelector(`[data-testid="pirate-step-${steps}"]`)!;
      expect(chip.getAttribute('data-hex')).toBe(String(route[steps]));
      expect(chip.querySelector('text')!.textContent).toBe(String(steps));
    }
    cleanup();
  });

  it('follows the pirate’s real position, wrapping past the end of the route', () => {
    const state = pirateState();
    const route = (state.moduleState as unknown as { seafarers: { pirateIslands: { route: number[] } } }).seafarers.pirateIslands.route;
    state.board.pirate = route[11]!;
    const { container } = svg(viewOf(state));
    expect(container.querySelector('[data-testid="pirate-position"]')!.getAttribute('data-hex')).toBe(String(route[11]));
    // 前方 6 格：12、13、0、1、2、3
    [12, 13, 0, 1, 2, 3].forEach((index, offset) => {
      expect(container.querySelector(`[data-testid="pirate-step-${offset + 1}"]`)!.getAttribute('data-hex')).toBe(String(route[index]));
    });
    cleanup();
  });

  it('draws no cruise layer in other scenarios', () => {
    const state = createGame({ profileId: 'sf-cloth-for-catan-2025', players: [{ id: 'p1', nickname: 'P1', color: 'red' }, { id: 'p2', nickname: 'P2', color: 'blue' }, { id: 'p3', nickname: 'P3', color: 'orange' }], setupMode: 'fixed', rng: seededRng(4) });
    state.turn.setup = null; state.turn.phase = 'action';
    const { container } = svg(viewOf(state));
    expect(container.querySelector('[data-testid="pirate-position"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="pirate-route-arrow-"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid^="pirate-step-"]')).toHaveLength(0);
    cleanup();
  });
});

describe('the cruising pirate on the board (3D)', () => {
  it('builds one arrow per leg pointing from each route hex to the next, and the position ring', () => {
    const view = viewOf(pirateState());
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const route = seafarersView(view)!.pirateIslands!.route;
    const arrows = routeArrows(geometry, route);
    expect(arrows).toHaveLength(14);
    arrows.forEach((arrow, index) => {
      const from = geometry.hexes[route[index]!]!;
      const to = geometry.hexes[route[(index + 1) % 14]!]!;
      // 中點落在兩格中心之間
      expect(arrow.position[0]).toBeCloseTo((from.cx + to.cx) / 2 / geometry.scale, 6);
      expect(arrow.position[2]).toBeCloseTo((from.cy + to.cy) / 2 / geometry.scale, 6);
      // three.js 繞 Y 轉 θ 把 +x 轉到 (cos θ, 0, -sin θ)：要等於「從這格往下一格」的單位向量。
      const dx = (to.cx - from.cx) / geometry.scale;
      const dz = (to.cy - from.cy) / geometry.scale;
      const length = Math.hypot(dx, dz);
      expect(Math.cos(arrow.rotationY)).toBeCloseTo(dx / length, 6);
      expect(-Math.sin(arrow.rotationY)).toBeCloseTo(dz / length, 6);
    });
    for (const model of [createRouteArrowModel(), createPositionRingModel()]) expect(model.getAttribute('position').count).toBeGreaterThan(0);
    // 箭頭的尖端朝 +x：+x 側的頂點在 z 方向收窄，-x 側（底）較寬。
    const positions = createRouteArrowModel().getAttribute('position');
    const spread = (side: 1 | -1) => {
      const zs: number[] = [];
      for (let i = 0; i < positions.count; i += 1) if (positions.getX(i) * side > 0.05) zs.push(positions.getZ(i));
      return Math.max(...zs) - Math.min(...zs);
    };
    expect(spread(1)).toBeLessThan(spread(-1));
  });
});

describe('the pirate gift picker', () => {
  function giftController(edit: (state: GameState) => void = () => undefined) {
    const state = pirateState();
    state.pending = { kind: 'seafarers.pirateGift', module: 'seafarers', responders: ['p1'], data: { strength: 2 } };
    edit(state);
    const view = viewOf(state);
    const submitCommand = vi.fn();
    const controller = { state: tableWith(view), actions: { submitCommand, selectTarget: vi.fn(), cancelSelection: vi.fn() } } as unknown as TableController;
    return { controller, submitCommand, view };
  }

  it('lets the winner take one resource the supply still has, and submits it', () => {
    const { controller, submitCommand, view } = giftController((state) => { state.bank.grain = 0; });
    expect(seafarersHints(view)!.pirateGift).toEqual(['lumber', 'brick', 'wool', 'ore']);
    render(<LocaleProvider locale="en"><SeafarersPrompt controller={controller} /></LocaleProvider>);
    expect(screen.getByTestId('pirate-gift').textContent).toContain('Your fleet beat the pirate (strength 2)');
    expect((screen.getByTestId('pirate-gift-grain') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('pirate-gift-ore'));
    expect(submitCommand).toHaveBeenCalledWith({ type: 'pirate.gift', resource: 'ore' }, 'play.pending.seafarers.pirateGift');
    cleanup();
    render(<LocaleProvider locale="zh-Hant"><SeafarersPrompt controller={controller} /></LocaleProvider>);
    expect(screen.getByTestId('pirate-gift').textContent).toContain('你的艦隊勝過海盜（戰力 2）');
    cleanup();
  });

  it('shows nothing to the other players', () => {
    const state = pirateState();
    state.pending = { kind: 'seafarers.pirateGift', module: 'seafarers', responders: ['p1'], data: { strength: 2 } };
    const other = projectGame(state, 'p2', { hints: actionHints(state, 'p2') });
    const controller = { state: { ...tableWith(other), session: { id: 'p2', nickname: 'Bo', locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' } }, actions: { submitCommand: vi.fn() } } as unknown as TableController;
    render(<LocaleProvider locale="en"><SeafarersPrompt controller={controller} /></LocaleProvider>);
    expect(screen.queryByTestId('pirate-gift')).toBeNull();
    cleanup();
  });
});

describe('the 7’s steal picker', () => {
  function stealController() {
    const state = pirateState();
    state.players[1]!.resources.grain = 2;
    state.players[2]!.resources.ore = 1;
    state.pending = { kind: 'seafarers.sevenSteal', module: 'seafarers', responders: ['p1'], data: {} };
    const view = viewOf(state);
    const submitCommand = vi.fn();
    const controller = { state: tableWith(view), actions: { submitCommand, selectTarget: vi.fn(), cancelSelection: vi.fn() } } as unknown as TableController;
    return { controller, submitCommand, view };
  }

  it('offers every other player with cards (not by hex) and a way not to steal', () => {
    const { controller, submitCommand, view } = stealController();
    expect(seafarersHints(view)!.sevenSteal).toEqual(['p2', 'p3']);
    render(<LocaleProvider locale="en"><SeafarersPrompt controller={controller} /></LocaleProvider>);
    expect(screen.getAllByTestId(/^seven-steal-p/).map((node) => node.getAttribute('data-testid'))).toEqual(['seven-steal-p2', 'seven-steal-p3']);
    fireEvent.click(screen.getByTestId('seven-steal-p3'));
    expect(submitCommand).toHaveBeenLastCalledWith({ type: 'seven.steal', victim: 'p3' }, 'play.pending.seafarers.sevenSteal');
    fireEvent.click(screen.getByTestId('seven-steal-skip'));
    expect(submitCommand).toHaveBeenLastCalledWith({ type: 'seven.steal', victim: null }, 'play.pending.seafarers.sevenSteal');
    expect(screen.getByTestId('seven-steal-skip').textContent).toBe('Do not steal');
    cleanup();
    render(<LocaleProvider locale="zh-Hant"><SeafarersPrompt controller={controller} /></LocaleProvider>);
    expect(screen.getByTestId('seven-steal-skip').textContent).toBe('不偷');
    cleanup();
  });
});

describe('the pirate log lines and sounds', () => {
  const names = (id: string) => id.toUpperCase();
  const text = (locale: 'en' | 'zh-Hant', type: string, params: Record<string, unknown>) => translateEvent(locale, makeEvent(1, type, params), names);

  it('describes the cruise and the three attack outcomes in both locales', () => {
    expect(text('en', 'pirate.cruised', { from: 3, to: 9, steps: 4, dice: [4, 6] }).text).toBe('The pirate sailed 4 hex(es) along its route and stopped at hex 9.');
    expect(text('zh-Hant', 'pirate.cruised', { from: 3, to: 9, steps: 4, dice: [4, 6] }).text).toBe('海盜沿航道前進 4 格，停在第 9 格。');
    // 輸：被攻擊的人看得到棄了什麼（私有欄位），其他人只看到張數。
    const lost = { playerId: 'p1', strength: 3, warships: 0, result: 'lost', cities: 1, count: 2, owed: 2 };
    expect(text('en', 'pirate.attacked', { ...lost, resources: { lumber: 1, ore: 1 } }).text)
      .toBe('The pirate (strength 3) attacked P1 (warships: 0): the pirate is stronger: 2 card(s) discarded (1×Lumber、1×Ore).');
    expect(text('en', 'pirate.attacked', lost).text).toBe('The pirate (strength 3) attacked P1 (warships: 0): the pirate is stronger: 2 card(s) discarded.');
    expect(text('en', 'pirate.attacked', { ...lost, count: 1, owed: 2 }).text).toContain(', 2 were owed');
    expect(text('zh-Hant', 'pirate.attacked', lost).text).toBe('海盜（戰力 3）攻擊了 P1（戰船 0）：海盜較強，棄掉 2 張牌。');
    const won = { playerId: 'p1', strength: 2, warships: 3, result: 'won' };
    expect(text('en', 'pirate.attacked', won).text).toContain('the fleet is stronger');
    expect(text('zh-Hant', 'pirate.attacked', won).text).toContain('艦隊較強');
    expect(text('en', 'pirate.attacked', { ...won, result: 'tie', warships: 2 }).text).toContain('tied, nothing happens');
    expect(text('zh-Hant', 'pirate.attacked', { ...won, result: 'tie', warships: 2 }).text).toContain('平手');
    for (const entry of [text('en', 'pirate.cruised', { to: 1, steps: 1 }), text('en', 'pirate.attacked', won)]) expect(entry.unknown).toBe(false);
  });

  it('describes the supply pick and the 7’s steal or skip', () => {
    expect(text('en', 'pirate.gifted', { playerId: 'p1', resource: 'ore' }).text).toBe('P1 took 1 Ore from the supply.');
    expect(text('en', 'pirate.gifted', { playerId: 'p1', resource: null }).text).toBe('P1 found the supply empty and took nothing.');
    expect(text('zh-Hant', 'pirate.gifted', { playerId: 'p1', resource: 'ore' }).text).toContain('從供應堆拿了 1 張');
    expect(text('zh-Hant', 'pirate.gifted', { playerId: 'p1', resource: null }).text).toContain('供應堆已空');
    expect(text('en', 'seven.stole', { playerId: 'p1', victim: 'p2' }).text).toBe('P1 stole a card from P2.');
    expect(text('en', 'seven.stole', { playerId: 'p1', victim: 'p2', resource: 'grain' }).text).toBe('P1 stole a card from P2 (Grain).');
    expect(text('zh-Hant', 'seven.stole', { playerId: 'p1', victim: 'p2' }).text).toBe('P1 偷走了 P2 的一張牌。');
    expect(text('en', 'seven.stealSkipped', { playerId: 'p1' }).text).toBe('P1 chose not to steal.');
    expect(text('zh-Hant', 'seven.stealSkipped', { playerId: 'p1' }).text).toBe('P1 選擇不偷牌。');
  });

  it('has the pending prompts in both locales', () => {
    for (const locale of ['en', 'zh-Hant'] as const) {
      for (const key of ['play.pending.seafarers.pirateGift', 'play.pending.seafarers.sevenSteal', 'sf.seven.steal.pick', 'sf.pirate.gift.pick', 'sf.pirate.here', 'sf.pirate.step']) {
        expect(translate(locale, key as never, { strength: 2, steps: 2 })).not.toBe(key);
      }
    }
  });

  it('plays a sea cue for the cruise and a theft cue only for a lost attack', () => {
    expect(cueForEvent(makeEvent(1, 'pirate.cruised', { to: 1 }), 'p2')).toBe('pirate.move');
    expect(cueForEvent(makeEvent(2, 'pirate.attacked', { playerId: 'p1', result: 'lost' }), 'p1')).toBe('robber.stolenFromYou');
    expect(cueForEvent(makeEvent(3, 'pirate.attacked', { playerId: 'p2', result: 'lost' }), 'p1')).toBe('robber.steal');
    expect(cueForEvent(makeEvent(4, 'pirate.attacked', { playerId: 'p2', result: 'tie' }), 'p1')).toBeNull();
    expect(cueForEvent(makeEvent(5, 'seven.stole', { playerId: 'p1', victim: 'p2' }), 'p2')).toBe('robber.stolenFromYou');
  });
});
