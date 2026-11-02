/**
 * Seafarers + Cities & Knights client: the pirate chase, bandit targets per
 * chase, knights on sea intersections next to ships, the combined score
 * breakdown and the combination layer's text.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actionHints, createGame, projectGame, seededRng, type GameState, type GameView } from '@catan/rules';
import { boardIntent } from '../src/board/intent.ts';
import { buildGeometry, type BoardGeometry } from '../src/board/geometry.ts';
import { banditTargets, pirateActive, seafarersCitiesKnightsHints } from '../src/board/seafarersCitiesKnights.ts';
import { cueForEvent } from '../src/audio/cues.ts';
import { SHIP_DECK_Y, vertexBaseY, vertexTransform } from '../src/board/three/diorama-knights.ts';
import { CitiesKnightsPanel } from '../src/components/CitiesKnightsPanel.tsx';
import { PlayersPanel } from '../src/components/PlayersPanel.tsx';
import { SeafarersPrompt } from '../src/components/SeafarersPrompt.tsx';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { translateEvent } from '../src/i18n/events.ts';
import { t } from '../src/i18n/index.ts';
import { deriveActions } from '../src/state/actions.ts';
import { requiredActionFor } from '../src/state/pending.ts';
import { EMPTY_SELECTION, initialTableState, type TableState } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeEvent, makeSnapshot } from '../src/test/fixtures.ts';

// Printed 4-player New Shores map: v28 on the main island's coast, v11
// between three sea hexes, v10 on the gold field's coast.
const V28 = 28;
const V11 = 11;
const V10 = 10;

type Slot = { attacks: number; knights: { player: string; vertex: number; level: 1 | 2 | 3; active: boolean }[]; metropolises: Record<string, { player: string; vertex: number } | null>; merchant?: { player: string; hex: number } | null; progressVp: Record<string, string[]> };

function combined(): { state: GameState; geometry: BoardGeometry } {
  const state = createGame({
    profileId: 'sf-ck-new-shores-2025',
    players: ['p1', 'p2', 'p3', 'p4'].map((id, seat) => ({ id, nickname: id.toUpperCase(), color: (['red', 'blue', 'orange', 'white'] as const)[seat]! })),
    setupMode: 'fixed',
    rng: seededRng(7),
  });
  state.turn.setup = null;
  state.turn.phase = 'action';
  state.turn.seat = 0;
  state.windowId += 1;
  const geometry = buildGeometry(state.board.layout.topologyId, 100, state.board.layout.terrain);
  const edge = (a: number, b: number) => geometry.topology.vertices[a]!.edges.find((candidate) => geometry.topology.edges[candidate]!.vertices.includes(b))!;
  state.board.buildings[V28] = { player: 'p1', city: false };
  state.board.roads[edge(V28, V11)] = { player: 'p1', ship: true };
  state.board.roads[edge(V11, V10)] = { player: 'p1', ship: true };
  return { state, geometry };
}

const slot = (state: GameState) => (state.moduleState as Record<string, Slot>).citiesKnights!;
const view = (state: GameState, viewer = 'p1'): GameView => projectGame(state, viewer, { hints: actionHints(state, viewer) });

/** Pirate in play on the sea hex next to v11, a p1 knight on v11. */
function chaseTable() {
  const { state, geometry } = combined();
  slot(state).attacks = 1;
  state.board.robber = state.board.layout.robber;
  const pirate = geometry.topology.vertices[V11]!.hexes.find((hex) => geometry.topology.vertices[V10]!.hexes.includes(hex))!;
  state.board.pirate = pirate;
  slot(state).knights.push({ player: 'p1', vertex: V11, level: 1, active: true });
  return { state, geometry, pirate };
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

function controllerFor(gameView: GameView): TableController {
  return { state: tableWith(gameView), dispatch: vi.fn(), actions: { submitCommand: vi.fn(), selectTarget: vi.fn(), cancelSelection: vi.fn() } } as unknown as TableController;
}

function renderBoard(geometry: BoardGeometry, gameView: GameView) {
  return render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={gameView}
    active={null} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
    viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(id) => id} /></LocaleProvider>);
}

describe('seafarers + cities & knights client', () => {
  it('keeps both bandits off the board until the first attack', () => {
    const { state, geometry } = combined();
    const gameView = view(state);
    expect(pirateActive(gameView)).toBe(false);
    const { container } = renderBoard(geometry, gameView);
    expect(container.querySelector('[data-testid="robber"]')).toBeNull();
    // The pirate waits on the frame (CK25 p. 12: beside the barbarian track).
    expect(container.querySelector('[data-testid="pirate-frame"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pirate-hex"]')).toBeNull();
    render(<LocaleProvider locale="en"><CitiesKnightsPanel controller={controllerFor(gameView)} /></LocaleProvider>);
    expect(screen.getByTestId('sfck-pirate-status').textContent).toBe('the pirate waits for the first attack');
  });

  it('offers the pirate chase to a knight next to the pirate and arms the board on it', () => {
    const { state } = chaseTable();
    const gameView = view(state);
    expect(seafarersCitiesKnightsHints(gameView)).toMatchObject({ pirateActive: true, pirateChase: [V11] });
    const action = deriveActions(tableWith(gameView), 'p1').find((candidate) => candidate.id === 'knight.chasePirate');
    expect(action).toMatchObject({ enabled: true, commandType: 'knight.chasePirate', targetCount: 1, labelId: 'sfck.action.chasePirate' });
    const intent = boardIntent(tableWith(gameView, { selection: { ...EMPTY_SELECTION, kind: 'vertex', commandType: 'knight.chasePirate' } }), 'p1');
    expect(intent).toMatchObject({ kind: 'vertex', targets: [V11], fromHints: true });
    // Base C&K and Seafarers games have no such action.
    const plain = deriveActions(tableWith({ ...gameView, hints: { ...gameView.hints!, modules: { ...gameView.hints!.modules, seafarersCitiesKnights: undefined } } }), 'p1');
    expect(plain.some((candidate) => candidate.id === 'knight.chasePirate')).toBe(false);
  });

  it('draws a knight carried on a sea intersection with the ships, the pirate and the robber', () => {
    const { state, geometry } = chaseTable();
    const { container } = renderBoard(geometry, view(state));
    expect(container.querySelector(`[data-testid="knight-${V11}"]`)).not.toBeNull();
    expect(container.querySelector('[data-testid="pirate-hex"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="robber"]')).not.toBeNull();
  });

  it('stands a 3D knight on the ship deck at a sea intersection and on the ground on the coast', () => {
    const { geometry } = combined();
    expect(vertexBaseY(geometry, V11)).toBe(SHIP_DECK_Y);
    expect(vertexBaseY(geometry, V28)).toBe(0.005);
    expect(vertexTransform(geometry, V11)!.position[1]).toBeLessThan(0);
  });

  it('limits the bandit targets to the bandit the knight chases', () => {
    const { state, pirate } = chaseTable();
    const isSea = (hex: number) => state.board.layout.terrain[hex] === 'sea';
    // A robber chase: land hexes only, no frame button.
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'knight', pirate: false };
    const robberView = view(state);
    const robberIntent = boardIntent(tableWith(robberView), 'p1')!;
    expect(robberIntent.commandType).toBe('pending.moveRobber');
    expect(robberIntent.labelId).toBe('play.pending.moveRobber');
    expect(robberIntent.targets.length).toBeGreaterThan(0);
    expect(robberIntent.targets.every((hex) => !isSea(hex))).toBe(true);
    const { unmount } = render(<LocaleProvider locale="en"><SeafarersPrompt controller={controllerFor(robberView)} /></LocaleProvider>);
    expect(screen.getByTestId('bandit-choice-text').textContent).toMatch(/chases the robber/);
    expect(screen.queryByTestId('pirate-to-frame')).toBeNull();
    unmount();
    // A pirate chase: sea hexes only, and the frame.
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'knight', pirate: true };
    const pirateView = view(state);
    const pirateIntent = boardIntent(tableWith(pirateView), 'p1')!;
    expect(pirateIntent.targets.length).toBeGreaterThan(0);
    expect(pirateIntent.targets.every(isSea)).toBe(true);
    expect(pirateIntent.targets).not.toContain(pirate);
    // The prompt and the selection name the pirate.
    expect(pirateIntent.labelId).toBe('sfck.pending.movePirate');
    expect(requiredActionFor(tableWith(pirateView))?.messageId).toBe('sfck.pending.movePirate');
    render(<LocaleProvider locale="en"><SeafarersPrompt controller={controllerFor(pirateView)} /></LocaleProvider>);
    expect(screen.getByTestId('bandit-choice-text').textContent).toMatch(/chases the pirate/);
    expect(screen.getByTestId('pirate-to-frame')).not.toBeNull();
    // A seven after the first attack: either bandit.
    state.pending = { kind: 'moveRobber', actor: 'p1', cause: 'seven', pirate: false };
    const either = boardIntent(tableWith(view(state)), 'p1')!;
    expect(either.targets.some(isSea)).toBe(true);
    expect(either.targets.some((hex) => !isSea(hex))).toBe(true);
  });

  it('passes the Seafarers targets through outside the combined profiles', () => {
    expect(banditTargets(null, [1, 2], [3, null])).toEqual({ robber: [1, 2], pirate: [3, null] });
  });

  it('shows island bonus, metropolis, defender, merchant and Longest Trade Route together', () => {
    const { state, geometry } = chaseTable();
    state.board.buildings[V10] = { player: 'p1', city: true };
    (state.moduleState as Record<string, { islands: Record<string, number[]> }>).seafarers!.islands = { p1: [3] };
    state.players[0]!.bonusPoints = 2;
    state.players[0]!.defenders = 1;
    slot(state).metropolises.science = { player: 'p1', vertex: V10 };
    slot(state).merchant = { player: 'p1', hex: geometry.topology.vertices[V28]!.hexes.find((hex) => state.board.layout.terrain[hex] !== 'sea')! };
    state.awards.longestRoad = 'p1';
    render(<LocaleProvider locale="en"><PlayersPanel controller={controllerFor(view(state, 'p2'))} /></LocaleProvider>);
    expect(screen.getByTestId('players-islands-0').getAttribute('aria-label')).toMatch(/: 2$/);
    expect(screen.getByTestId('players-metropolis-0')).not.toBeNull();
    expect(screen.getByTestId('players-defender-0')).not.toBeNull();
    expect(screen.getByTestId('players-merchant-0')).not.toBeNull();
    expect(screen.getByTestId('players-route-0').getAttribute('aria-label')).toMatch(/Longest trade route \(\+2\)/i);
  });

  it('renders the combination events and errors in both locales', () => {
    const names = (id: string) => id.toUpperCase();
    const events = [
      makeEvent(1, 'sfck.knightChasedPirate', { playerId: 'p1', vertex: 11, hex: 8 }),
      makeEvent(2, 'ck.roadRemoved', { playerId: 'p2', owner: 'p1', edge: 11, ship: true }),
      makeEvent(3, 'ck.diplomacyRoadBuilt', { playerId: 'p1', edge: 12, ship: true }),
    ];
    for (const locale of ['en', 'zh-Hant'] as const) {
      for (const event of events) {
        const text = translateEvent(locale, event, names);
        expect(text.unknown, event.type).toBe(false);
        expect(text.text, event.type).not.toMatch(/\{\w+\}/);
      }
      expect(translateEvent(locale, events[1]!, names).messageId).toBe('event.ck.roadRemoved.ship');
      expect(t(locale, 'error.E_PIRATE_INACTIVE')).not.toBe('error.E_PIRATE_INACTIVE');
    }
    expect(translateEvent('en', events[1]!, names).text).toMatch(/open ship/);
    expect(cueForEvent(events[0]!, 'p1')).toBe('knight.act');
  });
});
