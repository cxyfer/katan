/** R-ROOM / R-POLICY: lobby lifecycle, readiness, host succession, policy votes. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomServiceDeps } from '../src/rooms.ts';
import { startHarness, startedGame, type TestHarness } from './helpers.ts';

let harness: TestHarness;

/** True when the promise has settled within `ms`; used to prove lock waiting. */
function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

interface RoomShape {
  id: string;
  code: string;
  hostId: string;
  status: string;
  capacity: number;
  orderMode: string;
  gameId: string | null;
  members: { playerId: string; seat: number; ready: boolean; connected: boolean; host: boolean; color: string }[];
  startBlockers: { messageId: string; params?: Record<string, unknown> }[];
  policy: { disconnectGraceSeconds: number; turnClockSeconds: number; allowAbandonment: boolean };
  policyRevision: number;
  pendingPolicy: { id: string; consents: string[]; after: { turnClockSeconds: number } } | null;
}

describe('R-ROOM lobby', () => {
  it('creates a private room with an unguessable code and the creator as host', async () => {
    const host = await harness.client('Host');
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    expect(room.code).toHaveLength(8);
    expect(room.status).toBe('lobby');
    expect(room.members).toHaveLength(1);
    expect(room.members[0]!.host).toBe(true);
  });

  it('lets the host choose a random game order or keep join order', async () => {
    const host = await harness.client('OrderHost');
    const defaultRoom = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    expect(defaultRoom.orderMode).toBe('join');

    const randomRoom = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
        orderMode: 'random',
      }),
    );
    expect(randomRoom.orderMode).toBe('random');

    host.expectError(
      await host.post(`/api/rooms/${randomRoom.id}/settings`, { orderMode: 'shuffle' }),
      'E_INVALID_ORDER_MODE',
    );
    const backToJoin = host.expectOk<RoomShape>(
      await host.post(`/api/rooms/${randomRoom.id}/settings`, { orderMode: 'join' }),
    );
    expect(backToJoin.orderMode).toBe('join');

    // 有送出但型別或值不合法的 orderMode 不能被當成「未指定」。
    for (const invalid of [null, 1, true]) {
      host.expectError(
        await host.post(`/api/rooms/${randomRoom.id}/settings`, { orderMode: invalid }),
        'E_INVALID_ORDER_MODE',
      );
      host.expectError(
        await host.post('/api/rooms', {
          visibility: 'private',
          capacity: 3,
          profileId: 'base-2025',
          setupMode: 'fixed',
          orderMode: invalid,
        }),
        'E_INVALID_ORDER_MODE',
      );
    }

    host.expectError(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
        orderMode: 'shuffle',
      }),
      'E_INVALID_ORDER_MODE',
    );
  });

  it('rejects unsupported combinations server-side', async () => {
    const host = await harness.client('Host2');
    host.expectError(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 5,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
      'E_UNSUPPORTED_COMBINATION',
    );
    host.expectError(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 4,
        profileId: 'sf-ck-new-shores-2025',
        setupMode: 'fixed',
      }),
      'E_UNSUPPORTED_COMBINATION',
    );
  });

  it('resolves a ruleset named by its parts to exactly one enabled profile', async () => {
    const host = await harness.client('RulesetHost');
    const reason = (response: { body: { ok: boolean; error?: { params?: Record<string, unknown> } } }) =>
      response.body.ok ? 'ok' : response.body.error?.params?.reason;

    const paired = host.expectOk<RoomShape & { profileId: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 5, setupMode: 'variable',
      ruleset: { expansions: [], scenario: null, variants: [] },
    }));
    expect(paired.profileId).toBe('base-paired-2025');

    const base = host.expectOk<RoomShape & { profileId: string }>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 4, setupMode: 'fixed', profileId: 'base-2025',
      ruleset: { expansions: [], scenario: null },
    }));
    expect(base.profileId).toBe('base-2025');

    const cases: [Record<string, unknown>, string][] = [
      [{ capacity: 4, setupMode: 'variable', ruleset: { expansions: ['seafarers'], scenario: 'new-shores' } }, 'bad-setup-mode'],
      [{ capacity: 4, ruleset: { expansions: ['citiesKnights', 'seafarers'], scenario: 'new-shores' } }, 'disabled'],
      [{ capacity: 4, ruleset: { expansions: ['seafarers', 'citiesKnights', 'tradersBarbarians'], scenario: 'new-shores' } }, 'unknown-profile'],
      [{ capacity: 4, ruleset: { expansions: ['seafarers', 'seafarers'], scenario: 'new-shores' } }, 'invalid-request'],
      [{ capacity: 4, ruleset: { expansions: [], scenario: null, variants: ['tb-event-cards'] } }, 'unknown-profile'],
      [{ capacity: 7, ruleset: { expansions: [], scenario: null } }, 'bad-player-count'],
      [{ capacity: 3, profileId: 'base-paired-2025', ruleset: { expansions: [], scenario: null } }, 'profile-mismatch'],
      [{ capacity: 3, profileId: 'no-such-profile' }, 'unknown-profile'],
    ];
    for (const [body, expected] of cases) {
      const response = await host.post('/api/rooms', { visibility: 'private', setupMode: 'fixed', ...body });
      host.expectError(response, 'E_UNSUPPORTED_COMBINATION');
      expect(reason(response), JSON.stringify(body)).toBe(expected);
    }
    const missing = await host.post('/api/rooms', { visibility: 'private', capacity: 3, setupMode: 'fixed' });
    host.expectError(missing, 'E_BAD_REQUEST');
    expect(missing.body.ok ? null : missing.body.error.messageId).toBe('error.E_MISSING_FIELD');
    host.expectError(await host.post('/api/rooms', {
      visibility: 'private', capacity: 3, setupMode: 'fixed', ruleset: { expansions: 'seafarers' },
    }), 'E_BAD_REQUEST');

    // Settings may switch rulesets by parts as well.
    const switched = host.expectOk<RoomShape & { profileId: string }>(await host.post(`/api/rooms/${paired.id}/settings`, {
      capacity: 6, ruleset: { expansions: [], scenario: null },
    }));
    expect(switched.profileId).toBe('base-paired-2025');
  });

  it('publishes registry v2 metadata for every profile', async () => {
    const guest = await harness.client('ProfileReader');
    const data = guest.expectOk<{ profiles: Record<string, unknown>[]; selectable: string[] }>(await guest.get('/api/profiles'));
    expect(data.selectable).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025']);
    expect(data.profiles.find((profile) => profile.id === 'base-paired-2025')).toMatchObject({
      expansions: [], scenario: null, variants: [], ruleVersion: 'base-2025.3',
      requiredBoxes: ['base', 'base-5-6'], playerCounts: [5, 6], enabled: true,
    });
    expect(data.profiles.find((profile) => profile.id === 'sf-ck-new-shores-2025')).toMatchObject({
      expansions: ['seafarers', 'citiesKnights'], scenario: 'new-shores', enabled: false,
    });
    for (const profile of data.profiles) expect(profile).not.toHaveProperty('modules');
  });

  it('rejects profile and capacity mismatches during lobby settings updates', async () => {
    const host = await harness.client('SettingsGuard');
    const baseRoom = host.expectOk<RoomShape>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 3, profileId: 'base-2025', setupMode: 'fixed',
    }));
    host.expectError(
      await host.post(`/api/rooms/${baseRoom.id}/settings`, { capacity: 5 }),
      'E_UNSUPPORTED_COMBINATION',
    );

    const pairedRoom = host.expectOk<RoomShape>(await host.post('/api/rooms', {
      visibility: 'private', capacity: 5, profileId: 'base-paired-2025', setupMode: 'fixed',
    }));
    host.expectError(
      await host.post(`/api/rooms/${pairedRoom.id}/settings`, { capacity: 3 }),
      'E_UNSUPPORTED_COMBINATION',
    );
  });

  it('starts verified five- and six-seat base paired rooms', async () => {
    for (const capacity of [5, 6] as const) {
      const clients = [];
      for (let index = 0; index < capacity; index++) {
        clients.push(await harness.client(`Paired${capacity}-${index}`));
      }
      const host = clients[0]!;
      const room = host.expectOk<RoomShape>(
        await host.post('/api/rooms', {
          visibility: 'private',
          capacity,
          profileId: 'base-paired-2025',
          setupMode: 'fixed',
        }),
      );
      for (const client of clients.slice(1)) {
        client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
      }
      for (const client of clients) {
        client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
      }
      const ready = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
      expect(ready.members).toHaveLength(capacity);
      expect(ready.startBlockers).toEqual([]);

      const started = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
      const snapshot = host.expectOk<{ view: { profileId: string; players: unknown[]; turn: { setup: unknown } } }>(
        await host.get(`/api/games/${started.gameId}`),
      );
      expect(snapshot.view.profileId).toBe('base-paired-2025');
      expect(snapshot.view.players).toHaveLength(capacity);
      expect(snapshot.view.turn.setup).not.toBeNull();
    }
  });

  it('starts a four-seat base room with three seated players', async () => {
    const clients = [];
    for (let index = 0; index < 3; index++) {
      clients.push(await harness.client(`ShortBase-${index}`));
    }
    const host = clients[0]!;
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'public',
        capacity: 4,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    for (const client of clients.slice(1)) {
      client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
    }
    for (const client of clients) {
      client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    }

    const view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
    expect(view.members).toHaveLength(3);
    expect(view.capacity).toBe(4);
    expect(view.startBlockers).toEqual([]);

    const started = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
    const snapshot = host.expectOk<{ view: { profileId: string; players: unknown[]; turn: { setup: unknown } } }>(
      await host.get(`/api/games/${started.gameId}`),
    );
    expect(snapshot.view.profileId).toBe('base-2025');
    expect(snapshot.view.players).toHaveLength(3);
    expect(snapshot.view.turn.setup).not.toBeNull();

    // The unoccupied fourth seat is not joinable after a short-handed start.
    const viewer = await harness.client('ShortBaseViewer');
    const list = viewer.expectOk<{
      rooms: { id: string; status: string; openSeats: number }[];
    }>(await viewer.get('/api/rooms'));
    expect(list.rooms.find((entry) => entry.id === room.id)).toMatchObject({
      status: 'playing',
      openSeats: 0,
    });
  });

  it('serialises a short-handed start against a concurrent join', async () => {
    const clients = [];
    for (let index = 0; index < 3; index++) {
      clients.push(await harness.client(`ConcurrentStart-${index}`));
    }
    const host = clients[0]!;
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 4,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    for (const client of clients.slice(1)) {
      client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
    }
    for (const client of clients) {
      client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    }
    const late = await harness.client('ConcurrentStartLate');
    const deps = (harness.service.rooms as unknown as { deps: RoomServiceDeps }).deps;
    const originalOnRoomStarted = deps.onRoomStarted;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const creating = new Promise<void>((resolve) => {
      entered = resolve;
    });
    deps.onRoomStarted = async (startedRoom, playerIds) => {
      entered();
      await gate;
      return originalOnRoomStarted(startedRoom, playerIds);
    };
    try {
      const startPromise = host.post<{ gameId: string }>(`/api/rooms/${room.id}/start`);
      await creating;
      const joinPromise = late.post('/api/rooms/join', { code: room.code });
      // The start transition is paused inside onRoomStarted; a concurrent join
      // must wait for the room lock instead of seating another player.
      expect(await settlesWithin(joinPromise, 100)).toBe(false);
      release();
      const [startResponse, joinResponse] = await Promise.all([startPromise, joinPromise]);
      const started = host.expectOk(startResponse);
      expect(joinResponse.body.ok).toBe(false);
      if (!joinResponse.body.ok) expect(joinResponse.body.error.code).toBe('E_ROOM_CLOSED');
      const view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
      expect(view.members).toHaveLength(3);
      const snapshot = host.expectOk<{ view: { players: unknown[] } }>(
        await host.get(`/api/games/${started.gameId}`),
      );
      expect(snapshot.view.players).toHaveLength(3);
    } finally {
      release();
      deps.onRoomStarted = originalOnRoomStarted;
    }
  });

  it('serialises a capacity reduction against a concurrent join', async () => {
    const host = await harness.client('ConcurrentCapacityHost');
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 4,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    for (let index = 0; index < 2; index++) {
      const client = await harness.client(`CapGuest-${index}`);
      client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
    }
    const late = await harness.client('CapLate');
    const repo = harness.service.repo;
    const originalListMemberships = repo.listMemberships.bind(repo);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const readingMembers = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let armed = true;
    repo.listMemberships = async (roomId: string) => {
      if (armed && roomId === room.id) {
        armed = false;
        entered();
        await gate;
      }
      return originalListMemberships(roomId);
    };
    try {
      const settingsPromise = host.post(`/api/rooms/${room.id}/settings`, { capacity: 3 });
      await readingMembers;
      const joinPromise = late.post('/api/rooms/join', { code: room.code });
      // The settings transition has read the seated snapshot but not applied
      // the new capacity yet; the join must wait rather than seat a fourth.
      expect(await settlesWithin(joinPromise, 100)).toBe(false);
      release();
      const [settingsResponse, joinResponse] = await Promise.all([settingsPromise, joinPromise]);
      expect(settingsResponse.body.ok).toBe(true);
      expect(joinResponse.body.ok).toBe(false);
      if (!joinResponse.body.ok) expect(joinResponse.body.error.code).toBe('E_ROOM_FULL');
      const view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
      expect(view.capacity).toBe(3);
      expect(view.members).toHaveLength(3);
    } finally {
      release();
      repo.listMemberships = originalListMemberships;
    }
  });

  it('does not retain room-lock entries after a rejected operation settles', async () => {
    const locks = (harness.service.rooms as unknown as {
      roomLocks: Map<string, Promise<unknown>>;
    }).roomLocks;
    const before = locks.size;
    const host = await harness.client('LockCleanupHost');
    host.expectError(
      await host.post(`/api/rooms/room_missing_${Date.now()}/ready`, { ready: true }),
      'E_ROOM_NOT_FOUND',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(locks.size).toBe(before);
  });

  it('starts a six-seat paired room with five seated players', async () => {
    const clients = [];
    for (let index = 0; index < 5; index++) {
      clients.push(await harness.client(`ShortPaired-${index}`));
    }
    const host = clients[0]!;
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 6,
        profileId: 'base-paired-2025',
        setupMode: 'fixed',
      }),
    );
    for (const client of clients.slice(1)) {
      client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
    }
    for (const client of clients) {
      client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    }

    const view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
    expect(view.members).toHaveLength(5);
    expect(view.capacity).toBe(6);
    expect(view.startBlockers).toEqual([]);

    const started = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
    const snapshot = host.expectOk<{ view: { profileId: string; players: unknown[]; turn: { setup: unknown } } }>(
      await host.get(`/api/games/${started.gameId}`),
    );
    expect(snapshot.view.profileId).toBe('base-paired-2025');
    expect(snapshot.view.players).toHaveLength(5);
    expect(snapshot.view.turn.setup).not.toBeNull();
  });

  it('keeps a six-seat paired room blocked until five players are seated', async () => {
    const clients = [];
    for (let index = 0; index < 4; index++) {
      clients.push(await harness.client(`ShortPairedBlocked-${index}`));
    }
    const host = clients[0]!;
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 6,
        profileId: 'base-paired-2025',
        setupMode: 'fixed',
      }),
    );
    for (const client of clients.slice(1)) {
      client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
    }
    for (const client of clients) {
      client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    }

    const view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
    expect(view.startBlockers.map((blocker) => blocker.messageId)).toContain('blocker.seats');
    host.expectError(await host.post(`/api/rooms/${room.id}/start`), 'E_START_BLOCKED');
  });

  it('changes the capacity before start without dropping below the seated count', async () => {
    const host = await harness.client('CapacityHost');
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 4,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    for (let index = 0; index < 2; index++) {
      const client = await harness.client(`CapacityGuest-${index}`);
      client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
    }

    const lowered = host.expectOk<RoomShape>(
      await host.post(`/api/rooms/${room.id}/settings`, { capacity: 3 }),
    );
    expect(lowered.capacity).toBe(3);
    const extra = await harness.client('CapacityExtra');
    extra.expectError(await extra.post('/api/rooms/join', { code: room.code }), 'E_ROOM_FULL');

    host.expectError(
      await host.post(`/api/rooms/${room.id}/settings`, { capacity: 2 }),
      'E_UNSUPPORTED_COMBINATION',
    );
  });

  it('refuses a capacity below the seated players', async () => {
    const host = await harness.client('CapacityFloorHost');
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 4,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    for (let index = 0; index < 3; index++) {
      const client = await harness.client(`CapacityFloorGuest-${index}`);
      client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
    }
    host.expectError(
      await host.post(`/api/rooms/${room.id}/settings`, { capacity: 3 }),
      'E_CAPACITY_BELOW_SEATED',
    );
  });

  it('raises the capacity within the ruleset before start', async () => {
    const host = await harness.client('CapacityRaiseHost');
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    const raised = host.expectOk<RoomShape>(
      await host.post(`/api/rooms/${room.id}/settings`, { capacity: 4 }),
    );
    expect(raised.capacity).toBe(4);
    const fourth = await harness.client('CapacityRaiseFourth');
    fourth.expectOk(await fourth.post('/api/rooms/join', { code: room.code }));
  });

  it('compacts seats when lowering capacity after a mid-seat departure', async () => {
    const clients = [];
    for (let index = 0; index < 4; index++) {
      clients.push(await harness.client(`SeatCompact-${index}`));
    }
    const host = clients[0]!;
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 4,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    for (const client of clients.slice(1)) {
      client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
    }
    // Seat 2 leaves, leaving occupied seats 0, 1 and 3.
    clients[2]!.expectOk(await clients[2]!.post(`/api/rooms/${room.id}/leave`));
    let view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
    expect(view.members.map((member) => member.seat)).toEqual([0, 1, 3]);

    view = host.expectOk<RoomShape>(
      await host.post(`/api/rooms/${room.id}/settings`, { capacity: 3 }),
    );
    expect(view.capacity).toBe(3);
    expect(view.members.map((member) => member.seat)).toEqual([0, 1, 2]);

    const remaining = [clients[0]!, clients[1]!, clients[3]!];
    for (const client of remaining) {
      client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    }
    const started = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
    const snapshot = host.expectOk<{ view: { players: unknown[] } }>(
      await host.get(`/api/games/${started.gameId}`),
    );
    expect(snapshot.view.players).toHaveLength(3);
  });

  it('enforces the deployment capacity maximum in lobby settings', async () => {
    const previous = harness.service.config.limits.roomCapacityMax;
    harness.service.config.limits.roomCapacityMax = 5;
    try {
      const host = await harness.client('MaxCapacityHost');
      const room = host.expectOk<RoomShape>(
        await host.post('/api/rooms', {
          visibility: 'private',
          capacity: 5,
          profileId: 'base-paired-2025',
          setupMode: 'fixed',
        }),
      );
      host.expectError(
        await host.post(`/api/rooms/${room.id}/settings`, { capacity: 6 }),
        'E_ROOM_CAPACITY',
      );
    } finally {
      harness.service.config.limits.roomCapacityMax = previous;
    }
  });

  it('blocks start when corrupt data leaves more seated players than the capacity', async () => {
    const clients = [];
    for (let index = 0; index < 4; index++) {
      clients.push(await harness.client(`OverCapacity-${index}`));
    }
    const host = clients[0]!;
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 4,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    for (const client of clients.slice(1)) {
      client.expectOk(await client.post('/api/rooms/join', { code: room.code }));
    }
    for (const client of clients) {
      client.expectOk(await client.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    }

    // Simulate a stale writer or an old race that bypassed settings validation.
    await harness.service.repo.updateRoom(room.id, { capacity: 3 });
    const view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
    expect(view.startBlockers.map((blocker) => blocker.messageId)).toContain('blocker.capacity');
    host.expectError(await host.post(`/api/rooms/${room.id}/start`), 'E_START_BLOCKED');
  });

  it('hides private rooms from the public list and exposes public ones', async () => {
    const host = await harness.client('Host3');
    const privateRoom = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    const publicRoom = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'public',
        capacity: 4,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    const viewer = await harness.client('Viewer');
    const list = viewer.expectOk<{ rooms: { id: string; code: string | null }[] }>(
      await viewer.get('/api/rooms'),
    );
    const ids = list.rooms.map((room) => room.id);
    expect(ids).toContain(publicRoom.id);
    expect(ids).not.toContain(privateRoom.id);
  });

  it('joins by code, assigns unique seats and colours, and refuses overflow', async () => {
    const host = await harness.client('SeatHost');
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    const second = await harness.client('Second');
    const third = await harness.client('Third');
    const fourth = await harness.client('Fourth');
    second.expectOk(await second.post('/api/rooms/join', { code: room.code }));
    third.expectOk(await third.post('/api/rooms/join', { code: room.code }));
    fourth.expectError(await fourth.post('/api/rooms/join', { code: room.code }), 'E_ROOM_FULL');

    const view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
    expect(view.members).toHaveLength(3);
    expect(new Set(view.members.map((member) => member.color)).size).toBe(3);
    expect(new Set(view.members.map((member) => member.playerId)).size).toBe(3);
  });

  it('clears readiness whenever settings change', async () => {
    const host = await harness.client('ReadyHost');
    const other = await harness.client('ReadyOther');
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 4,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    other.expectOk(await other.post('/api/rooms/join', { code: room.code }));
    host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    other.expectOk(await other.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    let view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
    expect(view.members.every((member) => member.ready)).toBe(true);

    view = host.expectOk<RoomShape>(
      await host.post(`/api/rooms/${room.id}/settings`, { capacity: 3 }),
    );
    expect(view.members.every((member) => member.ready)).toBe(false);
  });

  it('blocks start below the profile minimum, and until every seated player is connected and ready', async () => {
    const host = await harness.client('StartHost');
    const other = await harness.client('StartOther');
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    other.expectOk(await other.post('/api/rooms/join', { code: room.code }));
    let view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
    expect(view.startBlockers.map((blocker) => blocker.messageId)).toContain('blocker.seats');
    expect(view.startBlockers.find((blocker) => blocker.messageId === 'blocker.seats')?.params).toEqual({
      seated: 2,
      min: 3,
    });

    host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    other.expectOk(await other.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    host.expectError(await host.post(`/api/rooms/${room.id}/start`), 'E_START_BLOCKED');

    const third = await harness.client('StartThird');
    third.expectOk(await third.post('/api/rooms/join', { code: room.code }));
    view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
    expect(view.startBlockers.map((blocker) => blocker.messageId)).toContain('blocker.notReady');

    third.expectOk(await third.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    const started = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
    expect(started.gameId).toMatch(/^game_/);
    view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
    expect(view.status).toBe('playing');
  });

  it('refuses a non-host settings or start request', async () => {
    const host = await harness.client('AuthHost');
    const other = await harness.client('AuthOther');
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    other.expectOk(await other.post('/api/rooms/join', { code: room.code }));
    other.expectError(
      await other.post(`/api/rooms/${room.id}/settings`, { capacity: 3 }),
      'E_NOT_HOST',
    );
    other.expectError(await other.post(`/api/rooms/${room.id}/start`), 'E_NOT_HOST');
  });

  it('transfers administration to the earliest-joined remaining member when the host leaves', async () => {
    const host = await harness.client('LeaveHost');
    const second = await harness.client('LeaveSecond');
    const third = await harness.client('LeaveThird');
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 4,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    second.expectOk(await second.post('/api/rooms/join', { code: room.code }));
    third.expectOk(await third.post('/api/rooms/join', { code: room.code }));
    const result = host.expectOk<{ left: boolean; hostTransferredTo: string | null }>(
      await host.post(`/api/rooms/${room.id}/leave`),
    );
    expect(result.hostTransferredTo).toBe(second.playerId);
    const view = second.expectOk<RoomShape>(await second.get(`/api/rooms/${room.id}`));
    expect(view.hostId).toBe(second.playerId);
    expect(view.members).toHaveLength(2);
  });

  it('closes an empty pre-game lobby and keeps seats of a running game', async () => {
    const empty = await harness.client('EmptyHost');
    const emptyRoom = empty.expectOk<RoomShape>(
      await empty.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    empty.expectOk(await empty.post(`/api/rooms/${emptyRoom.id}/leave`));
    empty.expectError(await empty.get(`/api/rooms/${emptyRoom.id}`), 'E_ROOM_NOT_FOUND');

    const { clients, roomId } = await startedGame(harness, 3);
    const host = clients[0]!;
    const leaver = clients[1]!;
    const result = leaver.expectOk<{ hostTransferredTo: string | null }>(
      await leaver.post(`/api/rooms/${roomId}/leave`),
    );
    void result;
    const view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${roomId}`));
    expect(view.members).toHaveLength(3);
    const stillSeated = view.members.find((member) => member.playerId === leaver.playerId);
    expect(stillSeated).toBeDefined();
  });
});

describe('R-POLICY room policy', () => {
  it('lets the host set policy before start and clears readiness', async () => {
    const host = await harness.client('PolicyHost');
    const other = await harness.client('PolicyOther');
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    other.expectOk(await other.post('/api/rooms/join', { code: room.code }));
    host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    const view = host.expectOk<RoomShape>(
      await host.post(`/api/rooms/${room.id}/policy`, {
        policy: { turnClockSeconds: 120, disconnectGraceSeconds: 600, allowAbandonment: false },
      }),
    );
    expect(view.policy.turnClockSeconds).toBe(120);
    expect(view.policy.disconnectGraceSeconds).toBe(600);
    expect(view.policy.allowAbandonment).toBe(false);
    expect(view.members.find((member) => member.playerId === host.playerId)!.ready).toBe(false);
  });

  it('rejects policy values outside the documented bounds', async () => {
    const host = await harness.client('BoundsHost');
    const room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 3,
        profileId: 'base-2025',
        setupMode: 'fixed',
      }),
    );
    host.expectError(
      await host.post(`/api/rooms/${room.id}/policy`, {
        policy: { disconnectGraceSeconds: 1 },
      }),
      'E_INVALID_POLICY',
    );
    host.expectError(
      await host.post(`/api/rooms/${room.id}/policy`, {
        policy: { turnClockSeconds: -5 },
      }),
      'E_INVALID_POLICY',
    );
  });

  it('requires every seated player to consent after start and rejects a host-only write', async () => {
    const { clients, roomId } = await startedGame(harness, 3);
    const [host, second, third] = clients as [typeof clients[0], typeof clients[0], typeof clients[0]];

    const proposed = host.expectOk<RoomShape>(
      await host.post(`/api/rooms/${roomId}/policy`, {
        policy: { turnClockSeconds: 60 },
      }),
    );
    expect(proposed.pendingPolicy).not.toBeNull();
    expect(proposed.policy.turnClockSeconds).toBe(0);
    const proposalId = proposed.pendingPolicy!.id;
    expect(proposed.pendingPolicy!.consents).toContain(host.playerId);

    // A non-host cannot propose.
    second.expectError(
      await second.post(`/api/rooms/${roomId}/policy`, { policy: { turnClockSeconds: 90 } }),
      'E_NOT_HOST',
    );

    const afterSecond = second.expectOk<RoomShape>(
      await second.post(`/api/rooms/${roomId}/policy/consent`, { proposalId, approve: true }),
    );
    expect(afterSecond.policy.turnClockSeconds).toBe(0);
    expect(afterSecond.pendingPolicy).not.toBeNull();

    const afterThird = third.expectOk<RoomShape>(
      await third.post(`/api/rooms/${roomId}/policy/consent`, { proposalId, approve: true }),
    );
    expect(afterThird.policy.turnClockSeconds).toBe(60);
    expect(afterThird.pendingPolicy).toBeNull();
    expect(afterThird.policyRevision).toBeGreaterThan(1);
  });

  it('leaves the policy unchanged when a seat rejects', async () => {
    const { clients, roomId } = await startedGame(harness, 3);
    const [host, second] = clients as [typeof clients[0], typeof clients[0]];
    const proposed = host.expectOk<RoomShape>(
      await host.post(`/api/rooms/${roomId}/policy`, {
        policy: { disconnectGraceSeconds: 900 },
      }),
    );
    const proposalId = proposed.pendingPolicy!.id;
    const rejected = second.expectOk<RoomShape>(
      await second.post(`/api/rooms/${roomId}/policy/consent`, { proposalId, approve: false }),
    );
    expect(rejected.policy.disconnectGraceSeconds).toBe(300);
    expect(rejected.pendingPolicy).toBeNull();
  });

  it('cancels a pending proposal when the host transfers', async () => {
    const { clients, roomId } = await startedGame(harness, 3);
    const [host, second] = clients as [typeof clients[0], typeof clients[0]];
    host.expectOk(
      await host.post(`/api/rooms/${roomId}/policy`, { policy: { turnClockSeconds: 30 } }),
    );
    host.expectOk(await host.post(`/api/rooms/${roomId}/leave`));
    const view = second.expectOk<RoomShape>(await second.get(`/api/rooms/${roomId}`));
    expect(view.pendingPolicy).toBeNull();
    expect(view.hostId).toBe(second.playerId);
  });
});
