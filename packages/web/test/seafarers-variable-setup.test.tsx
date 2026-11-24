/** S10a：四島群島、未知海域、穿越荒漠的 variable setup 在前端：大廳可選、SVG 渲染 variable 版圖。 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { actionHints, createGame, getProfile, projectGame, seededRng, type GameView } from '@katan/rules';
import { App } from '../src/App.tsx';
import { buildGeometry } from '../src/board/geometry.ts';
import { SvgBoard } from '../src/components/SvgBoard.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { EMPTY_SELECTION } from '../src/state/table.ts';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi } from '../src/test/fake-api.ts';
import { makeProfile, makeRoom } from '../src/test/fixtures.ts';

const COLORS = ['red', 'blue', 'orange', 'white'] as const;
const SCENARIOS = ['sf-four-islands-2025', 'sf-fog-islands-2025', 'sf-through-the-desert-2025'] as const;

function variableView(profileId: string, count: 3 | 4, mode: 'fixed' | 'variable'): GameView {
  const state = createGame({
    profileId,
    players: ['p1', 'p2', 'p3', 'p4'].slice(0, count).map((id, seat) => ({ id, nickname: id.toUpperCase(), color: COLORS[seat]! })),
    setupMode: mode,
    rng: seededRng(9),
  });
  return projectGame(state, 'p1', { hints: actionHints(state, 'p1') });
}

describe('lobby', () => {
  for (const id of SCENARIOS) {
    it(`${id}: the host can switch the setup mode to variable`, async () => {
      const profile = getProfile(id)!;
      const api = createFakeApi({
        room: makeRoom({ profileId: id, capacity: 4, setupMode: 'fixed' }),
        profiles: [makeProfile({ id, playerCounts: [3, 4], setupModes: [...profile.setupModes], expansions: ['seafarers'], scenario: profile.scenario })],
      });
      render(<App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />);
      fireEvent.change(await screen.findByTestId('join-code'), { target: { value: 'ABC123' } });
      fireEvent.click(screen.getByTestId('join-room'));
      await screen.findByTestId('room-code');
      const setup = screen.getByTestId('lobby-setup') as HTMLSelectElement;
      expect([...setup.options].map((option) => option.value)).toEqual(['fixed', 'variable']);
      fireEvent.change(setup, { target: { value: 'variable' } });
      fireEvent.click(screen.getByTestId('save-settings'));
      await waitFor(() => expect(api.callsOf('updateSettings')).toHaveLength(1));
      expect(api.callsOf('updateSettings')[0]!.args[1]).toEqual({ setupMode: 'variable' });
      cleanup();
    });
  }
});

describe.each(SCENARIOS)('%s variable board in the SVG renderer', (id) => {
  for (const count of [3, 4] as const) {
    it(`${count} players: same topology and land count as fixed, different discs, every hex drawn`, () => {
      const fixed = variableView(id, count, 'fixed');
      const view = variableView(id, count, 'variable');
      expect(view.board.topologyId).toBe(fixed.board.topologyId);
      expect(view.board.terrain.filter((tile) => tile !== 'sea')).toHaveLength(fixed.board.terrain.filter((tile) => tile !== 'sea').length);
      expect(view.board.numbers).not.toEqual(fixed.board.numbers);
      const geometry = buildGeometry(view.board.topologyId, 100, view.board.terrain);
      const { container } = render(<LocaleProvider locale="en"><SvgBoard svgRef={() => undefined} geometry={geometry} view={view}
        arrivals={[]} selection={EMPTY_SELECTION} selfId="p1" intent={null} pan={{ x: 0, y: 0 }} zoom={1}
        viewBoxCenter={{ x: 0, y: 0 }} nameResolver={(pid) => pid} /></LocaleProvider>);
      expect(container.querySelectorAll('[data-testid^="hex-"]')).toHaveLength(view.board.terrain.length);
      expect(container.querySelectorAll('[data-testid^="harbor-"]')).toHaveLength(view.board.harbors.length);
      cleanup();
    });
  }
});
