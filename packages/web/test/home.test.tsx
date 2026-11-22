import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../src/App.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi } from '../src/test/fake-api.ts';
import { makeProfile, makeRoomSummary } from '../src/test/fixtures.ts';

function renderApp(api: ReturnType<typeof createFakeApi>) {
  return render(
    <App services={{ api, storage: memoryStorage(), languages: ['en'], connectSocket: false }} />,
  );
}

describe('public room list', () => {
  it('does not offer Join for a started room with unused seats', async () => {
    const api = createFakeApi({
      rooms: [
        makeRoomSummary({ id: 'playing', status: 'playing', openSeats: 0, code: 'PLAY01' }),
        makeRoomSummary({ id: 'open', status: 'lobby', openSeats: 1, code: 'OPEN01' }),
      ],
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole('tab', { name: /public rooms/i }));
    fireEvent.click(await screen.findByRole('button', { name: /refresh room list/i }));
    const table = await screen.findByTestId('room-table');
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(2);
    const buttons = rows.map((row) => row.querySelector('button') as HTMLButtonElement);
    expect(buttons[0]!.disabled).toBe(true);
    expect(buttons[1]!.disabled).toBe(false);
  });
});

describe('scenario player-count hint', () => {
  it('names the 3–4 player limit when a narrower scenario is chosen next to a 3–6 player one', async () => {
    const api = createFakeApi({
      profiles: [
        makeProfile({ id: 'sf-new-shores-2025', labelKey: 'profile.sf-new-shores-2025', expansions: ['seafarers'], scenario: 'new-shores', playerCounts: [3, 4, 5, 6] }),
        makeProfile({ id: 'sf-four-islands-2025', labelKey: 'profile.sf-four-islands-2025', expansions: ['seafarers'], scenario: 'four-islands', playerCounts: [3, 4] }),
      ],
    });
    renderApp(api);
    fireEvent.change(await screen.findByTestId('expansion-select'), { target: { value: 'seafarers' } });
    expect(screen.queryByTestId('scenario-player-counts')).toBeNull();
    fireEvent.change(await screen.findByLabelText('Capacity'), { target: { value: '6' } });
    fireEvent.change(screen.getByTestId('scenario-select'), { target: { value: 'four-islands' } });
    expect((await screen.findByTestId('scenario-player-counts')).textContent).toBe(
      'This scenario supports 3–4 players only; the player count was changed to 3.',
    );
  });
  it('says the count was adjusted only on the switch that changed it and keeps the shown value', async () => {
    const api = createFakeApi({
      profiles: [
        makeProfile({ id: 'base-2025', playerCounts: [3, 4, 5, 6] }),
        makeProfile({ id: 'sf-four-islands-2025', labelKey: 'profile.sf-four-islands-2025', expansions: ['seafarers'], scenario: 'four-islands', playerCounts: [3, 4] }),
        makeProfile({ id: 'sf-fog-islands-2025', labelKey: 'profile.sf-fog-islands-2025', expansions: ['seafarers'], scenario: 'fog-islands', playerCounts: [3, 4] }),
      ],
    });
    renderApp(api);
    fireEvent.change(await screen.findByLabelText('Capacity'), { target: { value: '6' } });
    fireEvent.change(screen.getByTestId('expansion-select'), { target: { value: 'seafarers' } });
    expect((await screen.findByTestId('scenario-player-counts')).textContent).toContain('changed to 3');
    // 3 人沒變：換到另一個 3–4 人劇本不再說已調整。
    fireEvent.change(screen.getByTestId('scenario-select'), { target: { value: 'fog-islands' } });
    expect((await screen.findByTestId('scenario-player-counts')).textContent).toBe('This scenario supports 3–4 players only.');
    // 回基本版維持使用者看到的 3，而不是恢復 6。
    fireEvent.change(screen.getByTestId('expansion-select'), { target: { value: 'base' } });
    expect((screen.getByLabelText('Capacity') as HTMLSelectElement).value).toBe('3');
  });
});
