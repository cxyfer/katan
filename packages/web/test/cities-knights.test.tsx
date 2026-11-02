/** Cities & Knights client: actions, knight intents, board pieces, prompts, panel, hand and text. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actionHints, createGame, projectGame, seededRng, type GameState, type GameView } from '@catan/rules';
import { boardIntent } from '../src/board/intent.ts';
import { buildGeometry, type BoardGeometry } from '../src/board/geometry.ts';
import { citiesKnightsHints, citiesKnightsPoints, citiesKnightsView, knightFollowUp, knightGhost } from '../src/board/citiesKnights.ts';
import { createKnightModel, createMetropolisModel, createToppledCityModel, createWallModel } from '../src/board/three/diorama-knights.ts';
import { createSettlementModel } from '../src/board/three/diorama-structures.ts';
import { CitiesKnightsPanel } from '../src/components/CitiesKnightsPanel.tsx';
import { CitiesKnightsPrompt } from '../src/components/CitiesKnightsPrompt.tsx';
import { DiscardPicker } from '../src/components/DiscardPicker.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { cueForEvent } from '../src/audio/cues.ts';
import { deriveActions } from '../src/state/actions.ts';
import { EMPTY_SELECTION, initialTableState, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeSnapshot } from '../src/test/fixtures.ts';

type CkSlot = {
  barbarian: number; attacks: number;
  knights: { player: string; vertex: number; level: 1 | 2 | 3; active: boolean; activatedIn?: number }[];
  walls: number[]; metropolises: Record<string, { player: string; vertex: number } | null>; toppled: number[];
};

function ckState(): { state: GameState; geometry: BoardGeometry } {
  const state = createGame({
    profileId: 'ck-2025',
    players: ['p1', 'p2', 'p3', 'p4'].map((id, seat) => ({ id, nickname: id.toUpperCase(), color: (['red', 'blue', 'orange', 'white'] as const)[seat]! })),
    setupMode: 'fixed',
    rng: seededRng(7),
  });
  state.turn.setup = null;
  state.turn.phase = 'action';
  state.turn.seat = 0;
  state.windowId += 1;
  // Start from an empty board so the fixture places every piece itself.
  state.board.buildings = state.board.buildings.map(() => null);
  state.board.roads = state.board.roads.map(() => null);
  const geometry = buildGeometry(state.board.layout.topologyId, 100, state.board.layout.terrain);
  return { state, geometry };
}

const slot = (state: GameState) => (state.moduleState as Record<string, CkSlot>).citiesKnights!;
const view = (state: GameState, viewer = 'p1'): GameView => projectGame(state, viewer, { hints: actionHints(state, viewer) });

/** A land vertex and a neighbour joined by an edge, far from other fixtures. */
function route(geometry: BoardGeometry, start: number, steps: number): { vertices: number[]; edges: number[] } {
  const vertices = [start];
  const edges: number[] = [];
  while (vertices.length <= steps) {
    const last = vertices.at(-1)!;
    const edge = geometry.topology.vertices[last]!.edges.find((candidate) => {
      const other = geometry.topology.edges[candidate]!.vertices.find((vertex) => vertex !== last)!;
      return !vertices.includes(other);
    })!;
    edges.push(edge);
    vertices.push(geometry.topology.edges[edge]!.vertices.find((vertex) => vertex !== last)!);
  }
  return { vertices, edges };
}

function tableWith(gameView: GameView, overrides: Partial<TableState> = {}): TableState {
  return {
    ...initialTableState('en', 'Alex'),
    bootstrapped: true,
    session: { id: 'p1', nickname: 'Alex', locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' },
    screen: 'game',
    connection: 'online',
    game: makeSnapshot(gameView),
    ...overrides,
  };
}

function controllerFor(gameView: GameView) {
  const submitCommand = vi.fn();
  const selectTarget = vi.fn();
  const controller = { state: tableWith(gameView), actions: { submitCommand, selectTarget, cancelSelection: vi.fn() } } as unknown as TableController;
  return { controller, submitCommand, selectTarget };
}

/** Settlement at the start of a 3-step road, a city two steps on, and resources for knights. */
function knightTable() {
  const { state, geometry } = ckState();
  const path = route(geometry, 20, 3);
  state.board.buildings[path.vertices[0]!] = { player: 'p1', city: true };
  for (const edge of path.edges) state.board.roads[edge] = { player: 'p1', ship: false };
  state.players[0]!.resources = { lumber: 0, brick: 2, wool: 2, grain: 1, ore: 2 };
  state.bank.brick -= 2; state.bank.wool -= 2; state.bank.grain -= 1; state.bank.ore -= 2;
  return { state, geometry, path };
}

describe('cities & knights client', () => {
  it('offers knight and wall actions, and no development cards, only in C&K games', () => {
    const { state, path } = knightTable();
    slot(state).knights.push({ player: 'p1', vertex: path.vertices[2]!, level: 1, active: true, activatedIn: 0 });
    const actions = deriveActions(tableWith(view(state)), 'p1');
    expect(actions.find((action) => action.id === 'knight.recruit')).toMatchObject({ enabled: true, commandType: 'knight.recruit' });
    expect(actions.find((action) => action.id === 'build.wall')).toMatchObject({ enabled: true, targetCount: 1 });
    expect(actions.find((action) => action.id === 'knight.move')).toMatchObject({ commandType: 'knight.pickMove' });
    expect(actions.some((action) => action.id === 'build.devCard')).toBe(false);
    const base = deriveActions(tableWith({ ...view(state), hints: { ...view(state).hints!, modules: undefined } }), 'p1');
    expect(base.some((action) => action.id.startsWith('knight.'))).toBe(false);
  });

  it('moves a knight in two steps: pick the knight, then its new intersection', () => {
    const { state, path } = knightTable();
    const knight = path.vertices[1]!;
    slot(state).knights.push({ player: 'p1', vertex: knight, level: 2, active: true, activatedIn: 0 });
    const gameView = view(state);
    const pick = boardIntent(tableWith(gameView, { selection: { ...EMPTY_SELECTION, kind: 'vertex', commandType: 'knight.pickMove' } }), 'p1');
    expect(pick?.targets).toEqual([knight]);
    const follow = knightFollowUp('knight.pickMove', knight)!;
    expect(follow).toMatchObject({ commandType: 'knight.move', params: { from: knight }, field: 'to' });
    const move = boardIntent(tableWith(gameView, { selection: follow }), 'p1');
    expect(move?.targets).toEqual(citiesKnightsHints(gameView)!.knights[0]!.moves);
    expect(move?.targets).toContain(path.vertices[3]);
    expect(knightGhost(citiesKnightsView(gameView), 'knight.move', path.vertices[3]!, { from: knight })).toEqual({ level: 2, active: false });
    expect(knightGhost(citiesKnightsView(gameView), 'knight.promote', knight)).toEqual({ level: 3, active: true });
    expect(knightGhost(citiesKnightsView(gameView), 'progress.treasonPlace', path.vertices[3]!, { level: 2 })).toEqual({ level: 2, active: false });
  });

  it('arms the board for a pillage and a knight retreat', () => {
    const { state, path } = knightTable();
    state.pending = { kind: 'citiesKnights.pillage', module: 'citiesKnights', responders: ['p1'], data: {} } as GameState['pending'];
    const intent = boardIntent(tableWith(view(state)), 'p1');
    expect(intent).toMatchObject({ commandType: 'barbarians.pillage', targets: [path.vertices[0]] });
  });

  it('draws knights, walls, metropolises and toppled cities, and keeps the robber off the island before the first attack', () => {
    const { state, geometry, path } = knightTable();
    const ck = slot(state);
    ck.knights.push({ player: 'p1', vertex: path.vertices[2]!, level: 3, active: false });
    ck.walls.push(path.vertices[0]!);
    ck.metropolises.science = { player: 'p1', vertex: path.vertices[0]! };
    state.board.buildings[path.vertices[3]!] = { player: 'p1', city: false };
    ck.toppled.push(path.vertices[3]!);
    const renderBoard = (gameView: GameView) => render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={gameView}
      active={null} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
      viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} /></LocaleProvider>);
    const { container, unmount } = renderBoard(view(state));
    const knight = container.querySelector(`[data-testid="knight-${path.vertices[2]}"]`);
    expect(knight?.getAttribute('data-level')).toBe('3');
    expect(knight?.getAttribute('data-active')).toBe('false');
    expect(container.querySelector(`[data-testid="wall-${path.vertices[0]}"]`)).not.toBeNull();
    expect(container.querySelector('[data-testid="metropolis-science"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="robber"]')).toBeNull();
    unmount();
    ck.attacks = 1;
    expect(renderBoard(view(state)).container.querySelector('[data-testid="robber"]')).not.toBeNull();
  });

  it('builds the 3D knight, wall and metropolis miniatures', () => {
    for (const level of [1, 2, 3] as const) {
      for (const active of [true, false]) {
        const model = createKnightModel('#c0392b', level, active, 1);
        expect(model.getAttribute('position').count).toBeGreaterThan(0);
        // A lying knight is lower than a standing one.
        if (!active) expect(model.boundingBox!.max.y).toBeLessThan(createKnightModel('#c0392b', level, true, 1).boundingBox!.max.y);
      }
    }
    expect(createWallModel('#3a6fb8').getAttribute('position').count).toBeGreaterThan(0);
    // A toppled city lies on its side: wider than tall, resting on the ground.
    const standing = createSettlementModel('#3a6fb8', true, 1);
    standing.computeBoundingBox();
    const toppled = createToppledCityModel('#3a6fb8', 1);
    expect(toppled.getAttribute('position').count).toBe(standing.getAttribute('position').count);
    expect(toppled.boundingBox!.min.y).toBeCloseTo(0, 5);
    expect(toppled.boundingBox!.max.y).toBeLessThan(standing.boundingBox!.max.y);
    expect(toppled.boundingBox!.max.x - toppled.boundingBox!.min.x).toBeGreaterThan(toppled.boundingBox!.max.y);
    for (const track of ['science', 'trade', 'politics'] as const) {
      expect(createMetropolisModel('#3a6fb8', track).boundingBox!.max.y).toBeGreaterThan(1);
    }
  });

  it('discards progress cards, picks the aqueduct resource and the defender deck', () => {
    const { state } = knightTable();
    state.players[0]!.progressCards = ['crane', 'wedding', 'mining', 'merchant', 'alchemy'];
    state.pending = { kind: 'citiesKnights.progressDiscard', module: 'citiesKnights', responders: ['p1'], data: { required: { p1: 1 } } } as GameState['pending'];
    const { controller, submitCommand } = controllerFor(view(state));
    const { unmount } = render(<LocaleProvider locale="en"><CitiesKnightsPrompt controller={controller} /></LocaleProvider>);
    const submit = screen.getByTestId('ck-progress-discard-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('ck-progress-pick-1'));
    fireEvent.click(submit);
    expect(submitCommand).toHaveBeenCalledWith({ type: 'progress.discard', cards: ['wedding'] }, 'ck.prompt.progressDiscard');
    unmount();

    state.pending = { kind: 'citiesKnights.scienceBonus', module: 'citiesKnights', responders: ['p1'], data: {} } as GameState['pending'];
    const science = controllerFor(view(state));
    const second = render(<LocaleProvider locale="en"><CitiesKnightsPrompt controller={science.controller} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('ck-science-ore'));
    expect(science.submitCommand).toHaveBeenCalledWith({ type: 'science.take', resource: 'ore' }, 'ck.prompt.science');
    fireEvent.click(screen.getByTestId('ck-science-skip'));
    expect(science.submitCommand).toHaveBeenLastCalledWith({ type: 'science.take', resource: null }, 'ck.prompt.science');
    second.unmount();

    state.pending = { kind: 'citiesKnights.defenderDraw', module: 'citiesKnights', responders: ['p1', 'p2'], data: {} } as GameState['pending'];
    const deck = controllerFor(view(state));
    render(<LocaleProvider locale="en"><CitiesKnightsPrompt controller={deck.controller} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('ck-deck-politics'));
    expect(deck.submitCommand).toHaveBeenCalledWith({ type: 'barbarians.chooseDeck', track: 'politics' }, 'ck.prompt.deck');
  });

  it('keeps the picked progress cards when another responder changes the frame sequence', () => {
    const { state } = knightTable();
    state.players[0]!.progressCards = ['crane', 'wedding', 'mining', 'merchant', 'alchemy'];
    state.pending = { kind: 'citiesKnights.progressDiscard', module: 'citiesKnights', responders: ['p1', 'p2'], data: { required: { p1: 1, p2: 1 } } } as GameState['pending'];
    const first = view(state);
    const { rerender } = render(<LocaleProvider locale="en"><CitiesKnightsPrompt controller={controllerFor(first).controller} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('ck-progress-pick-1'));
    expect(screen.getByTestId('ck-progress-pick-1').getAttribute('aria-pressed')).toBe('true');
    // p2 discards: the sequence advances, p1's frame content stays the same.
    const bumped = controllerFor({ ...first, seq: first.seq + 1 });
    rerender(<LocaleProvider locale="en"><CitiesKnightsPrompt controller={bumped.controller} /></LocaleProvider>);
    expect(screen.getByTestId('ck-progress-pick-1').getAttribute('aria-pressed')).toBe('true');
    // A changed hand is a different choice and starts clean.
    state.players[0]!.progressCards = ['crane', 'mining', 'merchant', 'alchemy', 'wedding'];
    const changed = controllerFor({ ...view(state), seq: first.seq + 2 });
    rerender(<LocaleProvider locale="en"><CitiesKnightsPrompt controller={changed.controller} /></LocaleProvider>);
    expect(screen.getByTestId('ck-progress-pick-1').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the chart, buys an improvement and arms the board when a metropolis has several sites', () => {
    const { state, geometry, path } = knightTable();
    const other = route(geometry, 40, 1).vertices[0]!;
    state.board.buildings[other] = { player: 'p1', city: true };
    state.players[0]!.commodities = { paper: 4, cloth: 1, coin: 0 };
    state.players[0]!.improvements.science = 3;
    state.players[0]!.progressCards = ['crane'];
    const { controller, submitCommand, selectTarget } = controllerFor(view(state));
    render(<LocaleProvider locale="en"><CitiesKnightsPanel controller={controller} /></LocaleProvider>);
    expect(screen.getByTestId('ck-track-science').getAttribute('data-level')).toBe('3');
    expect(screen.getByTestId('ck-card-crane').getAttribute('data-card')).toBe('crane');
    fireEvent.click(screen.getByTestId('ck-improve-trade'));
    expect(submitCommand).toHaveBeenCalledWith({ type: 'city.improve', track: 'trade' }, 'ck.panel.improve');
    fireEvent.click(screen.getByTestId('ck-improve-science'));
    expect(selectTarget).toHaveBeenCalledWith(expect.objectContaining({ commandType: 'city.improve', params: { track: 'science' }, field: 'vertex' }));
    expect((screen.getByTestId('ck-improve-politics') as HTMLButtonElement).disabled).toBe(true);
    expect(path.vertices.length).toBe(4);
  });

  it('lets a discard include commodities', () => {
    const onSubmit = vi.fn();
    render(<LocaleProvider locale="en"><DiscardPicker required={2} hand={{ ore: 1, coin: 2 }}
      kinds={['lumber', 'brick', 'wool', 'grain', 'ore', 'paper', 'cloth', 'coin']} onSubmit={onSubmit} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('discard-add-coin'));
    fireEvent.click(screen.getByTestId('discard-add-ore'));
    fireEvent.click(screen.getByTestId('discard-submit'));
    expect(onSubmit).toHaveBeenCalledWith(['ore', 'coin']);
  });

  it('scores metropolises and defender points from the public view', () => {
    const { state, path } = knightTable();
    slot(state).metropolises.trade = { player: 'p1', vertex: path.vertices[0]! };
    state.players[0]!.defenders = 1;
    expect(citiesKnightsPoints(view(state, 'p2'), 'p1')).toEqual({ metropolises: 2, defenders: 1, progress: 0 });
  });

  it('renders every C&K event in both locales and maps sound cues', () => {
    const names = (id: string) => id.toUpperCase();
    const events = [
      makeEvent(1, 'ck.eventRolled', { event: 'trade', red: 3 }),
      makeEvent(2, 'ck.barbariansAdvanced', { position: 3, length: 7 }),
      makeEvent(3, 'ck.barbariansAttack', { barbarians: 4, defenders: 3, outcome: 'barbarians' }),
      makeEvent(4, 'ck.defenderOfCatan', { playerId: 'p1' }),
      makeEvent(5, 'ck.defendersTied', { players: ['p1', 'p2'] }),
      makeEvent(6, 'ck.cityPillaged', { playerId: 'p1', vertex: 4, wallLost: true, toppled: true }),
      makeEvent(7, 'ck.robberEntered', { hex: 9 }),
      makeEvent(8, 'ck.robberIdle', {}),
      makeEvent(9, 'ck.commoditiesProduced', { total: 8, grants: { p1: { paper: 1 } } }),
      makeEvent(10, 'ck.scienceBonusOffered', { players: ['p1'] }),
      makeEvent(11, 'ck.scienceBonusTaken', { playerId: 'p1', resource: 'ore' }),
      makeEvent(12, 'ck.progressDrawn', { playerId: 'p1', track: 'science', card: 'crane' }),
      makeEvent(13, 'ck.progressVictoryPoint', { playerId: 'p1', card: 'printing' }),
      makeEvent(14, 'ck.progressDeckEmpty', { playerId: 'p1', track: 'trade' }),
      makeEvent(15, 'ck.progressDiscardRequired', { required: { p1: 1 } }),
      makeEvent(16, 'ck.progressDiscarded', { playerId: 'p1', tracks: ['science'], cards: ['crane'] }),
      makeEvent(17, 'ck.knightRecruited', { playerId: 'p1', vertex: 3 }),
      makeEvent(18, 'ck.knightActivated', { playerId: 'p1', vertex: 3, level: 1 }),
      makeEvent(19, 'ck.knightPromoted', { playerId: 'p1', vertex: 3, level: 2 }),
      makeEvent(20, 'ck.knightMoved', { playerId: 'p1', from: 3, to: 5, level: 2 }),
      makeEvent(21, 'ck.knightDisplaced', { playerId: 'p1', victim: 'p2', from: 5, to: 6, level: 2, victimLevel: 1 }),
      makeEvent(22, 'ck.knightRemoved', { playerId: 'p2', level: 1 }),
      makeEvent(23, 'ck.knightRetreated', { playerId: 'p2', from: 6, to: 7, level: 1 }),
      makeEvent(24, 'ck.knightChasedRobber', { playerId: 'p1', vertex: 6, hex: 2 }),
      makeEvent(25, 'ck.wallBuilt', { playerId: 'p1', vertex: 4 }),
      makeEvent(26, 'ck.cityImproved', { playerId: 'p1', track: 'trade', level: 2, cost: 2, commodity: 'cloth' }),
      makeEvent(27, 'ck.metropolisAwarded', { playerId: 'p1', track: 'trade', vertex: 4, from: 'p2', permanent: true }),
    ];
    for (const locale of ['en', 'zh-Hant'] as const) {
      for (const event of events) {
        const text = translateEvent(locale, event, names);
        expect(text.unknown, event.type).toBe(false);
        expect(text.text, event.type).not.toMatch(/\{\w+\}/);
      }
    }
    expect(cueForEvent(events[2]!, 'p1')).toBe('barbarians.attack');
    expect(cueForEvent(events[16]!, 'p1')).toBe('knight.act');
    expect(cueForEvent(events[24]!, 'p1')).toBe('wall.build');
  });
});
