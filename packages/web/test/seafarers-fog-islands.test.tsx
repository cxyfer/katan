/** The Fog Islands（S3）的前端：空格（迷霧）與翻開後的格在 SVG 與幾何層正確呈現，選擇 frame 在棋盤上可操作，說明與事件文字。 */

import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { actionHints, applyCommand, createGame, getTopology, projectGame, seededRng, type Command, type GameState, type GameView } from '@katan/rules';
import { buildGeometry } from '../src/board/geometry.ts';
import { boardIntent } from '../src/board/intent.ts';
import { fogChoice, seafarersFog, seafarersView } from '../src/board/seafarers.ts';
import { hexReference, viewReferenceContext } from '../src/board/references.ts';
import { describeTarget } from '../src/board/targets.ts';
import { HelpPanel } from '../src/components/HelpPanel.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { EMPTY_SELECTION, initialTableState, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeIdentity, makeSnapshot } from '../src/test/fixtures.ts';

const COLORS = ['red', 'blue', 'orange', 'white'] as const;
const PROFILE = 'sf-fog-islands-2025';

function fogState(count: 3 | 4): GameState {
  return createGame({
    profileId: PROFILE,
    players: ['p1', 'p2', 'p3', 'p4'].slice(0, count).map((id, seat) => ({ id, nickname: id.toUpperCase(), color: COLORS[seat]! })),
    setupMode: 'fixed',
    rng: seededRng(4),
  });
}

const viewOf = (state: GameState, viewer = 'p1'): GameView => projectGame(state, viewer, { hints: actionHints(state, viewer) });

/** 海邊上碰到 `count` 個空格的邊（建造船的位置）。 */
function fogEdge(state: GameState, count: number): number {
  const topology = getTopology(state.board.layout.topologyId);
  const fog = (state.moduleState as unknown as { seafarers: { fog: { hexes: number[] } } }).seafarers.fog.hexes;
  return topology.edges.findIndex((info, index) => {
    if (state.board.roads[index] || !info.hexes.every((hex) => state.board.layout.terrain[hex] === 'sea')) return false;
    return new Set(info.vertices.flatMap((vertex) => topology.vertices[vertex]!.hexes.filter((hex) => fog.includes(hex)))).size === count;
  });
}

/** 行動階段 p1 在 `edge` 一端有村落，建造那艘船。 */
function buildShip(state: GameState, edge: number, seed = 1): GameState {
  const topology = getTopology(state.board.layout.topologyId);
  state.board.buildings[topology.edges[edge]!.vertices[0]] = { player: 'p1', city: false };
  state.turn.seat = 0;
  state.turn.phase = 'action';
  state.windowId += 1;
  state.players[0]!.resources = { lumber: 1, brick: 0, wool: 1, grain: 0, ore: 0 };
  const outcome = applyCommand(state, 'p1', { type: 'build.ship', edge } as unknown as Command, seededRng(seed));
  if (!outcome.ok) throw new Error(outcome.error.code);
  return outcome.state;
}

const board = (view: GameView, locale: 'en' | 'zh-Hant' = 'en') => {
  const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
  return { geometry, ...render(<LocaleProvider locale={locale}><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
    arrivals={[]} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
    viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} /></LocaleProvider>) };
};

describe.each([[3, 'sf-fog-islands-3', 14, 8], [4, 'sf-fog-islands-4', 17, 9]] as const)('Fog Islands %i players', (count, topologyId, landHexes, harbors) => {
  it('the SVG board draws the known islands, 12 fog clouds, the harbors and the pirate on the frame', () => {
    const view = viewOf(fogState(count));
    expect(view.board.topologyId).toBe(topologyId);
    const { geometry, container } = board(view);
    // 空格在 terrain 是海，所以幾何上只有已知陸地；迷霧另外畫。
    expect(geometry.land.filter(Boolean)).toHaveLength(landHexes);
    expect(geometry.hexes).toHaveLength(42);
    expect(container.querySelectorAll('[data-testid^="sf-fog-"]')).toHaveLength(12);
    expect(container.querySelectorAll('[data-testid^="harbor-"]')).toHaveLength(harbors);
    expect(container.querySelector('[data-testid="pirate-frame"]')).not.toBeNull();
    cleanup();
  });

  it('a revealed hex loses its cloud: 11 clouds remain and the hex is drawn as its tile', () => {
    const state = fogState(count);
    const edge = fogEdge(state, 1);
    const next = buildShip(state, edge, 3);
    const view = viewOf(next);
    expect(seafarersView(view)!.fog).toHaveLength(11);
    const { container } = board(view);
    expect(container.querySelectorAll('[data-testid^="sf-fog-"]')).toHaveLength(11);
    cleanup();
  });
});

describe('Fog Islands typed view and board intent', () => {
  it('exposes the unexplored hexes only for the fog scenario', () => {
    expect(seafarersView(viewOf(fogState(3)))!.fog).toHaveLength(12);
    expect([...seafarersFog(viewOf(fogState(3)))!.values()]).toEqual(Array(12).fill('open'));
    const shores = createGame({ profileId: 'sf-new-shores-2025', players: ['p1', 'p2', 'p3'].map((id, seat) => ({ id, nickname: id, color: COLORS[seat]! })), setupMode: 'fixed', rng: seededRng(4) });
    expect(seafarersView(viewOf(shores))!.fog).toEqual([]);
    expect(seafarersFog(viewOf(shores))).toBeUndefined();
  });

  it('a multi-hex touch becomes a board choice among exactly those hexes, for the placer only', () => {
    const state = fogState(3);
    const edge = fogEdge(state, 2);
    const waiting = buildShip(state, edge);
    const mine = viewOf(waiting, 'p1');
    const candidates = (waiting.pending as unknown as { data: { hexes: number[] } }).data.hexes;
    expect(mine.pending).toMatchObject({ kind: 'seafarers.fog', responders: ['p1'], data: { hexes: candidates } });
    expect(fogChoice(mine, 'p1')).toEqual(candidates);
    expect(fogChoice(viewOf(waiting, 'p2'), 'p2')).toBeNull();
    const tableOf = (view: GameView, id: string): TableState => ({ ...initialTableState('en', 'Alex'), session: makeIdentity({ id }), game: makeSnapshot(view) });
    expect(boardIntent(tableOf(mine, 'p1'), 'p1')).toMatchObject({ kind: 'hex', commandType: 'fog.choose', targets: candidates });
    expect(boardIntent(tableOf(viewOf(waiting, 'p2'), 'p2'), 'p2')?.commandType).not.toBe('fog.choose');
  });

  it('an unexplored hex reads as unexplored when inspected', () => {
    const view = viewOf(fogState(3));
    const fog = seafarersFog(view)!;
    const hex = [...fog.keys()][0]!;
    const topology = getTopology(view.board.topologyId);
    const option = describeTarget({ locale: 'en', topology, board: view.board, nameOf: (id) => id, fog }, 'hex', hex);
    expect(option.label).toContain('Unexplored');
  });
});

describe('Fog Islands help and event wording', () => {
  function helpFor(profileId: string, locale: 'en' | 'zh-Hant') {
    const state = createGame({
      profileId,
      players: ['p1', 'p2', 'p3'].map((id, seat) => ({ id, nickname: id, color: COLORS[seat]! })),
      setupMode: 'fixed',
      rng: seededRng(4),
    });
    const view = viewOf(state);
    const controller = { state: { ...initialTableState(locale, 'Alex'), game: makeSnapshot(view) } } as unknown as TableController;
    render(<LocaleProvider locale={locale}><HelpPanel controller={controller} /></LocaleProvider>);
    return screen.getByTestId('help-seafarers');
  }

  it('explains the exploration rules in English, with the 12-point target and no island bonus', () => {
    const help = helpFor(PROFILE, 'en');
    expect(help.textContent).toContain('The Fog Islands');
    expect(help.textContent).toContain('unexplored');
    expect(help.textContent).toContain('Moving a ship never explores');
    expect(help.textContent).toContain('12 points');
    expect(help.textContent).toContain('no island bonus');
    expect(help.textContent).not.toContain('Start on the main island');
    expect(help.textContent).not.toContain('small island');
    cleanup();
  });

  it('explains the exploration rules in Traditional Chinese', () => {
    const help = helpFor(PROFILE, 'zh-Hant');
    expect(help.textContent).toContain('未知海域特殊規則');
    expect(help.textContent).toContain('移動船不會探索');
    expect(help.textContent).toContain('12 分');
    expect(help.textContent).not.toContain('從主島開始');
    cleanup();
  });

  it('keeps the New Shores help for New Shores', () => {
    const shores = helpFor('sf-new-shores-2025', 'en');
    expect(shores.textContent).toContain('Start on the main island');
    expect(shores.querySelector('[data-testid="help-fog-islands-explore"]')).toBeNull();
  });

  it('words the reveal event for land with a resource, gold and sea, in both locales', () => {
    const names = (id: string) => id.toUpperCase();
    const land = makeEvent(7, 'fog.revealed', { playerId: 'p1', hex: 9, tile: 'hills', number: 6, resource: 'brick' });
    const sea = makeEvent(8, 'fog.revealed', { playerId: 'p2', hex: 4, tile: 'sea' });
    const gold = makeEvent(9, 'fog.revealed', { playerId: 'p1', hex: 3, tile: 'gold', number: 11 });
    expect(translateEvent('en', land, names).text).toBe('P1 explored hex 9 and found Hills with the number 6 and took 1 Brick.');
    expect(translateEvent('en', sea, names).text).toBe('P2 explored hex 4 and found open sea.');
    expect(translateEvent('en', gold, names).text).toContain('Gold with the number 11');
    expect(translateEvent('zh-Hant', land, names).text).toContain('探索了第 9 格');
    expect(translateEvent('zh-Hant', sea, names).text).toBe('P2 探索了第 4 格，發現一片海洋。');
  });
});

describe('Fog Islands choice preview', () => {
  it('the confirm preview reads an unexplored hex as unexplored (same fog as the board)', () => {
    const view = viewOf(fogState(3));
    const hex = seafarersView(view)!.fog[0]!;
    const english = hexReference(viewReferenceContext('en', view), hex);
    expect(english).toContain('Unexplored');
    expect(hexReference(viewReferenceContext('zh-Hant', view), hex)).toContain('未探索');
    // 已翻開的格不再是「未探索」。
    const edge = fogEdge(fogState(3), 1);
    const next = viewOf(buildShip(fogState(3), edge, 3));
    const revealed = seafarersView(view)!.fog.find((h) => !seafarersView(next)!.fog.includes(h))!;
    expect(hexReference(viewReferenceContext('en', next), revealed)).not.toContain('Unexplored');
  });

  it('drawing the preview of a fog.choose hex shows no pirate ghost, while a pirate move on sea still does', () => {
    const view = viewOf(fogState(3));
    const hex = seafarersView(view)!.fog[0]!;
    const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
    const draw = (commandType: string) => {
      const intent = { kind: 'hex' as const, commandType, labelId: 'x', targets: [hex], fromHints: true };
      const selection = { kind: 'hex' as const, index: hex, commandType, labelId: 'x' };
      const out = render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
        arrivals={[]} selection={selection} selfId="p1" intent={intent} pan={{ x: 0, y: 0 }} zoom={1}
        viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} /></LocaleProvider>);
      const ghost = out.container.querySelector('[data-testid="board-preview-ghost"]');
      const html = ghost?.innerHTML ?? '';
      out.unmount();
      return html;
    };
    expect(draw('fog.choose')).toBe('');
    expect(draw('pending.moveRobber').length).toBeGreaterThan(0);
  });
});
