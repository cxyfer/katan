import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApiResult, RoomSummaryView } from '@catan/protocol';
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

  it('keeps the filtered result when the older automatic request resolves last', async () => {
    const api = createFakeApi();
    const pending: Array<(result: ApiResult<{ rooms: RoomSummaryView[] }>) => void> = [];
    api.listRooms = () =>
      new Promise<ApiResult<{ rooms: RoomSummaryView[] }>>((resolve) => {
        pending.push(resolve);
      });

    renderHome(api);
    await screen.findByTestId('create-room');
    fireEvent.click(tab(/Public rooms/));
    await waitFor(() => expect(pending).toHaveLength(1));

    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '4' } });
    await waitFor(() => expect(pending).toHaveLength(2));

    // The filtered request answers first, then the older unfiltered one.
    await act(async () => {
      pending[1]!({ ok: true, data: { rooms: [makeRoomSummary({ id: 'filtered', capacity: 4 })] } });
    });
    expect((await screen.findByTestId('room-table')).textContent).toContain('2/4');

    await act(async () => {
      pending[0]!({ ok: true, data: { rooms: [makeRoomSummary({ id: 'stale', capacity: 3 })] } });
    });
    await waitFor(() => expect(screen.getByTestId('room-table').textContent).not.toContain('2/3'));
    expect(screen.getByTestId('room-table').textContent).toContain('2/4');
  });
});
