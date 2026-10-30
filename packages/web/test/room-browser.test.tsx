import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApiResult, RoomSummaryView } from '@catan/protocol';
import { App } from '../src/App.tsx';
import type { RoomQuery } from '../src/api/client.ts';
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

  it('shows a loading state until the first room list response arrives', async () => {
    const api = createFakeApi();
    let resolveRooms!: (result: ApiResult<{ rooms: RoomSummaryView[] }>) => void;
    api.listRooms = () =>
      new Promise<ApiResult<{ rooms: RoomSummaryView[] }>>((resolve) => {
        resolveRooms = resolve;
      });

    renderHome(api);
    await screen.findByTestId('create-room');
    fireEvent.click(tab(/Public rooms/));

    expect(await screen.findByTestId('rooms-loading')).toBeTruthy();
    expect(screen.queryByTestId('no-rooms')).toBeNull();

    await act(async () => {
      resolveRooms({ ok: true, data: { rooms: [makeRoomSummary()] } });
    });
    expect(await screen.findByTestId('room-table')).toBeTruthy();
    expect(screen.queryByTestId('rooms-loading')).toBeNull();
  });

  it('shows an error instead of the empty state when the list request fails', async () => {
    const api = createFakeApi();
    api.listRooms = async (): Promise<ApiResult<{ rooms: RoomSummaryView[] }>> => ({
      ok: false,
      error: { code: 'E_NETWORK', messageId: 'error.E_NETWORK' },
    });

    renderHome(api);
    await screen.findByTestId('create-room');
    fireEvent.click(tab(/Public rooms/));

    expect(await screen.findByTestId('rooms-error')).toBeTruthy();
    expect(screen.queryByTestId('no-rooms')).toBeNull();
    expect(screen.queryByTestId('rooms-loading')).toBeNull();
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

  it('reuses the active filter when the rooms pane is reopened', async () => {
    const api = createFakeApi({ rooms: [makeRoomSummary()] });
    renderHome(api);
    await screen.findByTestId('create-room');

    fireEvent.click(tab(/Public rooms/));
    await screen.findByTestId('room-table');
    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '4' } });
    await waitFor(() => expect(api.callsOf('listRooms')).toHaveLength(2));

    fireEvent.click(tab(/Play table/));
    fireEvent.click(tab(/Public rooms/));
    await waitFor(() => expect(api.callsOf('listRooms')).toHaveLength(3));

    expect(api.callsOf('listRooms')[2]!.args[0]).toEqual({ playerCount: 4 });
    expect((screen.getByLabelText('Players') as HTMLSelectElement).value).toBe('4');
  });

  it('keeps the filtered result when the older automatic request resolves last', async () => {
    const api = createFakeApi();
    const queries: Array<RoomQuery | undefined> = [];
    const pending: Array<(result: ApiResult<{ rooms: RoomSummaryView[] }>) => void> = [];
    api.listRooms = (query) => {
      queries.push(query);
      return new Promise<ApiResult<{ rooms: RoomSummaryView[] }>>((resolve) => {
        pending.push(resolve);
      });
    };

    renderHome(api);
    await screen.findByTestId('create-room');
    fireEvent.click(tab(/Public rooms/));
    await waitFor(() => expect(pending).toHaveLength(1));

    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '4' } });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(queries).toEqual([{}, { playerCount: 4 }]);

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
