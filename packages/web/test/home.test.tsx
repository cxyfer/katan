import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../src/App.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi } from '../src/test/fake-api.ts';
import { makeRoomSummary } from '../src/test/fixtures.ts';

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
