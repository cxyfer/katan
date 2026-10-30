import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App.tsx';
import { memoryStorage } from '../src/state/session.ts';
import { createFakeApi, type FakeApi } from '../src/test/fake-api.ts';
import { makeRoomSummary } from '../src/test/fixtures.ts';

/**
 * The public room browser is the only surface that calls `GET /api/rooms`
 * (docs/SPEC.md §4.2). Opening it must show rooms that already exist, without
 * the user pressing the refresh button first.
 */
function renderHome(api: FakeApi): void {
  render(
    <App
      services={{
        api,
        storage: memoryStorage(),
        languages: ['en'],
        connectSocket: false,
      }}
    />,
  );
}

function tab(name: RegExp): HTMLElement {
  return screen.getByRole('tab', { name });
}

describe('public room browser', () => {
  it('loads the public rooms when the rooms pane opens', async () => {
    const api = createFakeApi({ rooms: [makeRoomSummary()] });
    renderHome(api);
    await screen.findByTestId('create-room');

    fireEvent.click(tab(/Public rooms/));

    const table = await screen.findByTestId('room-table');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(api.callsOf('listRooms')).toHaveLength(1);
  });

  it('refreshes the list every time the rooms pane is reopened', async () => {
    const api = createFakeApi({ rooms: [makeRoomSummary()] });
    renderHome(api);
    await screen.findByTestId('create-room');

    fireEvent.click(tab(/Public rooms/));
    await screen.findByTestId('room-table');
    fireEvent.click(tab(/Play table/));
    fireEvent.click(tab(/Public rooms/));

    await waitFor(() => expect(api.callsOf('listRooms')).toHaveLength(2));
  });
});
