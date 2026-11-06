/** R-BOT：Bot 席位（B-ROOM）、排程生命週期（B-LIFE）與同 revision 競爭（B-RACE）。 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  RESOURCES,
  getProfile,
  registerFixtureProfile,
  registerRulesModule,
  type GameState,
  type GameView,
  type Resource,
} from '@catan/rules';
import {
  BOT_LEVELS as POLICY_BOT_LEVELS,
  botsCanPlay,
  createBotPolicy,
  fallbackPolicy,
  type BotCommand,
  type BotPolicy,
} from '@catan/bots';
import { BOT_LEVELS, type ResumableGameView } from '@catan/protocol';
import { loadConfig, type BotSettings } from '../src/config.ts';
import type { BotDriverDeps } from '../src/bot-driver.ts';
import type { Connection } from '../src/rooms.ts';
import { startService, type RunningService } from '../src/main.ts';
import { createClient, startHarness, type TestClient, type TestHarness } from './helpers.ts';

const FAST_BOTS: BotSettings = {
  ...loadConfig().bots,
  enabled: true,
  delayScale: 0,
  offerCollectMs: 50,
  offerPatienceMs: 150,
  retryMs: 50,
};

/**
 * Bot 模組不認得的 rules module。用它造出「Bot 不能玩」的 profile，以及「沒有任何 Bot 模組
 * 回答」的模組 frame；兩者都不依賴某個真實擴充的 Bot 支援進度。
 */
const UNKNOWN_MODULE = 'fixture-bots-unknown';
const UNKNOWN_SUBPHASE = 'choosing';
registerRulesModule({ id: UNKNOWN_MODULE, actionHints: () => ({ phase: UNKNOWN_SUBPHASE }) });
const UNKNOWN_PROFILE = registerFixtureProfile('fixture-bots-modules', [3, 4], { ruleModules: [UNKNOWN_MODULE] });

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness({ bots: { ...FAST_BOTS } });
});

afterAll(async () => {
  await harness.close();
});

interface Member {
  playerId: string;
  nickname: string;
  seat: number;
  color: string;
  ready: boolean;
  connected: boolean;
  host: boolean;
  bot: boolean;
  botLevel?: string;
}

interface RoomShape {
  id: string;
  code: string;
  hostId: string;
  status: string;
  members: Member[];
  startBlockers: { messageId: string }[];
  pendingPolicy: unknown;
  policy: { turnClockSeconds: number };
}

interface Snapshot {
  revision: number;
  view: GameView;
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  revision: number;
  error?: { messageId: string };
}

function id(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(15);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** 以假連線模擬真人的 live socket；Bot 只在有真人在線時推進。 */
async function liveSocket(service: RunningService, roomId: string, playerId: string): Promise<() => Promise<void>> {
  const connection: Connection = {
    id: randomUUID(),
    playerId,
    roomId,
    send() {},
    close() {},
  };
  await service.rooms.registerConnection(connection);
  return () => service.rooms.unregisterConnection(connection);
}

/**
 * 建房後再依序加入 Bot 席位。建房本身已不詢問 Bot 數量，測試沿用同一個
 * 入口，讓每個案例都走實際的房間流程。
 */
async function createRoom(client: TestClient, body: Record<string, unknown> = {}): Promise<RoomShape> {
  const { bots, botLevel, ...roomBody } = body;
  let room = client.expectOk<RoomShape>(
    await client.post('/api/rooms', {
      visibility: 'private',
      capacity: 3,
      profileId: 'base-2025',
      setupMode: 'fixed',
      ...roomBody,
    }),
  );
  for (let index = 0; index < Number(bots ?? 0); index++) {
    room = client.expectOk<RoomShape>(await client.post(`/api/rooms/${room.id}/bots`, { level: botLevel }));
  }
  return room;
}

/** 一位真人房主加上 `bots` 個 Bot 並開局。 */
async function botGame(
  bots = 2,
  options: { capacity?: number; service?: TestHarness } = {},
): Promise<{ host: TestClient; roomId: string; gameId: string; botIds: string[] }> {
  const target = options.service ?? harness;
  const host = await target.client('BotHost');
  const room = await createRoom(host, { capacity: options.capacity ?? bots + 1, bots });
  host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
  const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
  return {
    host,
    roomId: room.id,
    gameId,
    botIds: room.members.filter((member) => member.bot).map((member) => member.playerId),
  };
}

async function state(gameId: string, service: RunningService = harness.service): Promise<GameState> {
  return service.games.rawState(gameId);
}

async function revision(gameId: string, service: RunningService = harness.service): Promise<number> {
  return (await service.repo.findGame(gameId))!.revision;
}

function actorOf(game: GameState): string {
  return game.players[game.turn.seat]!.id;
}

/** 真人座位用保底策略走一步：放置、擲骰、處理強盜或結束回合。 */
async function humanStep(client: TestClient, gameId: string): Promise<BotCommand | null> {
  const snapshot = client.expectOk<Snapshot>(await client.get(`/api/games/${gameId}`));
  const command = fallbackPolicy.decide(snapshot.view, {
    selfId: client.playerId!,
    level: 'standard',
    seed: 1,
    offerPhases: {},
  });
  if (!command) return null;
  const receipt = client.expectOk<Receipt>(
    await client.post(`/api/games/${gameId}/commands`, {
      commandId: id('human'),
      expectedRevision: snapshot.revision,
      command,
    }),
  );
  expect(receipt.outcome).toBe('accepted');
  return command;
}

function botCounts(game: GameState, botId: string): { buildings: number; roads: number } {
  return {
    buildings: game.board.buildings.filter((building) => building?.player === botId).length,
    roads: game.board.roads.filter((road) => road?.player === botId).length,
  };
}

/** 直接改寫快照（比照 recovery.test.ts），用來建立特定局面。 */
async function rewrite(gameId: string, edit: (game: GameState) => void): Promise<number> {
  const row = await harness.service.repo.findGame(gameId);
  const game = JSON.parse(row!.state_json) as GameState;
  edit(game);
  await harness.service.repo.saveGame(gameId, game, row!.revision + 1, 'playing', null);
  return row!.revision + 1;
}

function grant(game: GameState, playerId: string, resource: Resource, amount: number): void {
  game.players.find((player) => player.id === playerId)!.resources[resource] += amount;
  game.bank[resource] -= amount;
}

function driverDeps(service: RunningService = harness.service): BotDriverDeps {
  return (service.bots as unknown as { deps: BotDriverDeps }).deps;
}

describe('B-ROOM bot seats', () => {
  it('keeps the wire and strategy difficulty vocabularies identical', () => {
    expect([...BOT_LEVELS]).toEqual([...POLICY_BOT_LEVELS]);
  });

  it('creates an empty room and seats bots in the room instead', async () => {
    const host = await harness.client('RoomBotHost');
    // 舊版建房捷徑已不再詢問數量；帶了也不會建立席位。
    let room = host.expectOk<RoomShape>(
      await host.post('/api/rooms', {
        visibility: 'private',
        capacity: 4,
        profileId: 'base-2025',
        setupMode: 'fixed',
        bots: 3,
        botLevel: 'easy',
      }),
    );
    expect(room.members).toHaveLength(1);
    expect(room.members[0]).toMatchObject({ playerId: host.playerId, seat: 0, host: true, bot: false });

    // 房間中的加入端點才是 Bot 席位的入口。
    for (let index = 0; index < 3; index++) {
      room = host.expectOk<RoomShape>(await host.post(`/api/rooms/${room.id}/bots`, { level: 'easy' }));
    }
    expect(room.members).toHaveLength(4);
    const [human, ...bots] = room.members;
    expect(human).toMatchObject({ playerId: host.playerId, seat: 0, host: true, bot: false });
    expect(human!.botLevel).toBeUndefined();
    for (const bot of bots) {
      expect(bot).toMatchObject({ bot: true, botLevel: 'easy', ready: true, connected: true, host: false });
    }
    expect(new Set(room.members.map((member) => member.seat)).size).toBe(4);
    expect(new Set(room.members.map((member) => member.color)).size).toBe(4);
    expect(new Set(bots.map((bot) => bot.nickname)).size).toBe(3);
    // 只有真人房主還沒就緒。
    expect(room.startBlockers.map((blocker) => blocker.messageId)).toEqual(['blocker.notReady']);
    const ready = host.expectOk<RoomShape>(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    expect(ready.startBlockers).toEqual([]);
  });

  it('offers bot seats only for profiles whose rules modules bots can play', async () => {
    const host = await harness.client('ProfileBots');
    const { profiles } = host.expectOk<{
      profiles: { id: string; expansions: string[]; variants: string[]; botSeats: boolean }[];
    }>(await host.get('/api/profiles'));
    expect(profiles.find((profile) => profile.id === 'base-2025')?.botSeats).toBe(true);
    expect(profiles.find((profile) => profile.id === 'base-paired-2025')?.botSeats).toBe(true);
    for (const profile of profiles) {
      expect(profile.botSeats).toBe(botsCanPlay(getProfile(profile.id)!));
    }
    expect(profiles.some((profile) => !profile.botSeats)).toBe(true);
  });

  it('refuses adding bot seats to Seafarers rooms and switching a room with bots to Seafarers', async () => {
    const host = await harness.client('SeafarersBots');
    const sea = await createRoom(host, { profileId: 'sf-new-shores-2025' });
    host.expectError(await host.post(`/api/rooms/${sea.id}/bots`, {}), 'E_INVALID_BOT');

    const other = await harness.client('SeafarersSwitch');
    const base = await createRoom(other, { bots: 1 });
    other.expectError(
      await other.post(`/api/rooms/${base.id}/settings`, { profileId: 'sf-new-shores-2025' }),
      'E_INVALID_BOT',
    );
  });

  it('blocks start and further bots once the profile runs modules bots cannot play', async () => {
    // Rooms refuse bot seats in such profiles, so the state is forced here.
    expect(botsCanPlay(UNKNOWN_PROFILE)).toBe(false);
    const host = await harness.client('ModuleBots');
    const room = await createRoom(host, { bots: 1 });
    host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    await harness.service.repo.updateRoom(room.id, { profile_id: UNKNOWN_PROFILE.id });

    const view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
    expect(view.startBlockers.map((blocker) => blocker.messageId)).toContain('blocker.botsUnsupported');
    host.expectError(await host.post(`/api/rooms/${room.id}/start`), 'E_START_BLOCKED');
    host.expectError(await host.post(`/api/rooms/${room.id}/bots`, {}), 'E_INVALID_BOT');
  });

  it('lets only the host add and remove bots before start', async () => {
    const host = await harness.client('LobbyHost');
    const guest = await harness.client('LobbyGuest');
    const room = await createRoom(host);
    guest.expectOk(await guest.post('/api/rooms/join', { code: room.code }));

    guest.expectError(await guest.post(`/api/rooms/${room.id}/bots`, {}), 'E_NOT_HOST');
    host.expectError(await host.post(`/api/rooms/${room.id}/bots`, { level: 'hard' }), 'E_INVALID_BOT');
    const added = host.expectOk<RoomShape>(await host.post(`/api/rooms/${room.id}/bots`, {}));
    const bot = added.members.find((member) => member.bot)!;
    expect(bot).toMatchObject({ botLevel: 'standard', seat: 2 });
    host.expectError(await host.post(`/api/rooms/${room.id}/bots`, { level: 'easy' }), 'E_ROOM_FULL');

    guest.expectError(
      await guest.request('DELETE', `/api/rooms/${room.id}/bots/${bot.playerId}`),
      'E_NOT_HOST',
    );
    host.expectError(
      await host.request('DELETE', `/api/rooms/${room.id}/bots/${guest.playerId}`),
      'E_NOT_A_BOT',
    );
    host.expectError(await host.request('DELETE', `/api/rooms/${room.id}/bots/bot_missing`), 'E_NOT_A_BOT');
    const removed = host.expectOk<RoomShape>(
      await host.request('DELETE', `/api/rooms/${room.id}/bots/${bot.playerId}`),
    );
    expect(removed.members.some((member) => member.bot)).toBe(false);
    expect(await harness.service.repo.findGuest(bot.playerId)).toBeNull();
  });

  it('names a bot from the host input and falls back to a default name', async () => {
    const host = await harness.client('NamedBotHost');
    const room = await createRoom(host, { capacity: 4 });
    const named = host.expectOk<RoomShape>(
      await host.post(`/api/rooms/${room.id}/bots`, { level: 'easy', name: '  Robo  ' }),
    );
    expect(named.members.find((member) => member.bot)).toMatchObject({
      nickname: 'Robo',
      botLevel: 'easy',
    });

    const blank = host.expectOk<RoomShape>(
      await host.post(`/api/rooms/${room.id}/bots`, { name: '   ' }),
    );
    const bots = blank.members.filter((member) => member.bot);
    expect(bots).toHaveLength(2);
    expect(bots[1]!.nickname).toMatch(/^(Ada|Bram|Cleo|Dax|Esme|Finn|Gus|Hana)$/);
  });

  it('rejects duplicate, overlong and control-character bot names', async () => {
    const host = await harness.client('NamedBotRules');
    const room = await createRoom(host, { capacity: 4 });
    host.expectOk(await host.post(`/api/rooms/${room.id}/bots`, { name: 'Robo' }));

    host.expectError(await host.post(`/api/rooms/${room.id}/bots`, { name: 'robo' }), 'E_BOT_NAME_TAKEN');
    host.expectError(
      await host.post(`/api/rooms/${room.id}/bots`, { name: 'NamedBotRules' }),
      'E_BOT_NAME_TAKEN',
    );
    host.expectError(
      await host.post(`/api/rooms/${room.id}/bots`, { name: 'x'.repeat(25) }),
      'E_INVALID_NICKNAME',
    );
    host.expectError(
      await host.post(`/api/rooms/${room.id}/bots`, { name: 'bad\u0000name' }),
      'E_INVALID_NICKNAME',
    );
  });

  it('keeps bots ready while people must confirm again', async () => {
    const host = await harness.client('ReadyHost');
    const room = await createRoom(host, { bots: 1 });
    const botId = room.members.find((member) => member.bot)!.playerId;
    host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));

    // 加入 Bot 與其他設定變更一樣清除真人的就緒。
    const withBot = host.expectOk<RoomShape>(await host.post(`/api/rooms/${room.id}/bots`, {}));
    expect(withBot.members.find((member) => member.playerId === host.playerId)!.ready).toBe(false);
    host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    const changed = host.expectOk<RoomShape>(
      await host.post(`/api/rooms/${room.id}/policy`, { policy: { turnClockSeconds: 30 } }),
    );
    expect(changed.members.find((member) => member.playerId === host.playerId)!.ready).toBe(false);
    expect(changed.members.filter((member) => member.bot).every((member) => member.ready)).toBe(true);

    // 即使 DB 旗標被清掉，Bot 仍由種類推導為就緒且在線。
    await harness.service.repo.updateMembership(room.id, botId, { ready: 0, connected: 0 });
    host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    const view = host.expectOk<RoomShape>(await host.get(`/api/rooms/${room.id}`));
    expect(view.members.find((member) => member.playerId === botId)).toMatchObject({ ready: true, connected: true });
    expect(view.startBlockers).toEqual([]);
    host.expectOk(await host.post(`/api/rooms/${room.id}/start`));
  });

  it('closes a lobby once only bots remain', async () => {
    const host = await harness.client('OnlyBotsHost');
    const room = await createRoom(host, { bots: 2 });
    const botIds = room.members.filter((member) => member.bot).map((member) => member.playerId);
    const left = host.expectOk<{ hostTransferredTo: string | null }>(await host.post(`/api/rooms/${room.id}/leave`));
    expect(left.hostTransferredTo).toBeNull();
    host.expectError(await host.get(`/api/rooms/${room.id}`), 'E_ROOM_NOT_FOUND');
    for (const botId of botIds) expect(await harness.service.repo.findGuest(botId)).toBeNull();
  });

  it('hands the lobby to a person, never to a bot that joined earlier', async () => {
    const host = await harness.client('HandHost');
    const late = await harness.client('HandLate');
    const room = await createRoom(host, { bots: 1 });
    late.expectOk(await late.post('/api/rooms/join', { code: room.code }));
    const left = host.expectOk<{ hostTransferredTo: string | null }>(await host.post(`/api/rooms/${room.id}/leave`));
    expect(left.hostTransferredTo).toBe(late.playerId);
  });

  it('never makes a bot the host of a running game', async () => {
    const { host, roomId } = await botGame(2);
    const left = host.expectOk<{ hostTransferredTo: string | null }>(await host.post(`/api/rooms/${roomId}/leave`));
    expect(left.hostTransferredTo).toBeNull();
    expect((await harness.service.repo.findRoom(roomId))!.host_id).toBe(host.playerId);
  });

  it('locks bot seats once the game starts and lists them as bots', async () => {
    const { host, roomId, gameId, botIds } = await botGame(2);
    host.expectError(await host.post(`/api/rooms/${roomId}/bots`, {}), 'E_ROOM_STARTED');
    host.expectError(await host.request('DELETE', `/api/rooms/${roomId}/bots/${botIds[0]}`), 'E_ROOM_STARTED');
    const games = host.expectOk<{ games: { gameId: string; players: { playerId: string; bot?: boolean }[] }[] }>(
      await host.get('/api/games'),
    );
    const listed = games.games.find((game) => game.gameId === gameId)!;
    expect(listed.players.filter((player) => player.bot).map((player) => player.playerId).sort()).toEqual(
      [...botIds].sort(),
    );
    expect(listed.players.find((player) => player.playerId === host.playerId)!.bot).toBeUndefined();
  });

  it('counts bots in the public room list', async () => {
    const host = await harness.client('PublicBots');
    const room = await createRoom(host, { visibility: 'public', capacity: 4, bots: 2 });
    const list = host.expectOk<{ rooms: { id: string; playerCount: number; botCount: number; openSeats: number }[] }>(
      await host.get('/api/rooms'),
    );
    expect(list.rooms.find((summary) => summary.id === room.id)).toMatchObject({
      playerCount: 3,
      botCount: 2,
      openSeats: 1,
    });
  });

  it('never resolves a session for a bot identity', async () => {
    const room = await createRoom(await harness.client('SessionBots'), { bots: 1 });
    const botId = room.members.find((member) => member.bot)!.playerId;
    const impostor = createClient(harness.base);
    impostor.cookie = `catan_session=${encodeURIComponent(`bot:${botId}`)}`;
    const session = impostor.expectOk<{ player: unknown }>(await impostor.get('/api/session'));
    expect(session.player).toBeNull();
    expect(await harness.service.repo.findGuestByTokenHash(`bot:${botId}`)).toBeNull();
  });

  it('sweeps bot guests that lost their seat', async () => {
    const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const orphanId = `bot_orphan_${randomUUID().slice(0, 8)}`;
    await harness.service.repo.insertGuest({
      id: orphanId,
      token_hash: `bot:${orphanId}`,
      nickname: 'Ada',
      locale: 'en',
      created_at: old,
      updated_at: old,
      kind: 'bot',
      bot_level: 'standard',
    });
    const seated = await createRoom(await harness.client('SweepKeeps'), { bots: 1 });
    await harness.service.rooms.sweepStaleLobbies();
    expect(await harness.service.repo.findGuest(orphanId)).toBeNull();
    const seatedBot = seated.members.find((member) => member.bot)!.playerId;
    expect(await harness.service.repo.findGuest(seatedBot)).not.toBeNull();
  });
});

describe('B-ROOM disabled deployment', () => {
  it('refuses bots when the deployment disables them', async () => {
    const disabled = await startHarness({ bots: { ...FAST_BOTS, enabled: false } });
    try {
      const host = await disabled.client('NoBots');
      const config = host.expectOk<{ bots: { enabled: boolean; levels: string[] } }>(await host.get('/api/config'));
      expect(config.bots).toEqual({ enabled: false, levels: ['easy', 'standard'] });
      const room = host.expectOk<RoomShape>(
        await host.post('/api/rooms', {
          visibility: 'private',
          capacity: 3,
          profileId: 'base-2025',
          setupMode: 'fixed',
        }),
      );
      host.expectError(await host.post(`/api/rooms/${room.id}/bots`, {}), 'E_BOTS_DISABLED');
    } finally {
      await disabled.close();
    }
  });
});

describe('B-LIFE bot scheduling', () => {
  it('plays bot turns only while a person is connected', async () => {
    const { host, roomId, gameId, botIds } = await botGame(2);
    // 固定設置順序 0,1,2,2,1,0：真人房主先放。
    await humanStep(host, gameId);
    await humanStep(host, gameId);
    const paused = await revision(gameId);
    await sleep(150);
    expect(await revision(gameId)).toBe(paused);
    expect(actorOf(await state(gameId))).toBe(botIds[0]);

    let drop = await liveSocket(harness.service, roomId, host.playerId!);
    await waitFor(async () => actorOf(await state(gameId)) === host.playerId, 'bots to finish their setup');
    const placed = await state(gameId);
    expect(placed.turn.phase).toBe('setup');
    for (const botId of botIds) expect(botCounts(placed, botId)).toEqual({ buildings: 2, roads: 2 });

    // 斷線後輪到 Bot 也不推進；重連後繼續。
    await drop();
    while ((await state(gameId)).turn.phase === 'setup' || actorOf(await state(gameId)) === host.playerId) {
      const command = await humanStep(host, gameId);
      if (!command || command.type === 'turn.end') break;
    }
    const waiting = await state(gameId);
    expect(actorOf(waiting)).toBe(botIds[0]);
    const before = await revision(gameId);
    await sleep(150);
    expect(await revision(gameId)).toBe(before);

    drop = await liveSocket(harness.service, roomId, host.playerId!);
    try {
      await waitFor(async () => {
        const game = await state(gameId);
        return actorOf(game) === host.playerId && game.turn.phase === 'preroll';
      }, 'both bots to play a turn');
      expect((await state(gameId)).stats?.turns).toBeGreaterThanOrEqual(3);
    } finally {
      await drop();
    }
  });

  it('wakes bots when a person subscribes over the WebSocket', async () => {
    const { host, roomId, gameId, botIds } = await botGame(2);
    await humanStep(host, gameId);
    await humanStep(host, gameId);
    const socket = new WebSocket(`${harness.base.replace('http', 'ws')}/ws`, {
      headers: { cookie: host.cookie! },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.send(JSON.stringify({ type: 'subscribe', payload: { roomId } }));
    try {
      await waitFor(async () => actorOf(await state(gameId)) === host.playerId, 'bots to move after a subscribe');
      for (const botId of botIds) expect(botCounts(await state(gameId), botId).buildings).toBe(2);
    } finally {
      socket.close();
    }
    await waitFor(async () => !harness.service.rooms.hasLiveConnection(roomId), 'the socket to unregister');
  });

  it('stops the bots when the person unsubscribes their socket, and resumes on resubscribe', async () => {
    const { host, roomId, gameId, botIds } = await botGame(2);
    const socket = new WebSocket(`${harness.base.replace('http', 'ws')}/ws`, {
      headers: { cookie: host.cookie! },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    try {
      socket.send(JSON.stringify({ type: 'subscribe', payload: { roomId } }));
      await waitFor(async () => harness.service.rooms.hasLiveConnection(roomId), 'the socket to register');
      // 「保存並離開」之後 client 取消訂閱：房裡沒有 live socket，Bot 不再行動。
      socket.send(JSON.stringify({ type: 'subscribe', payload: {} }));
      await waitFor(async () => !harness.service.rooms.hasLiveConnection(roomId), 'the socket to unsubscribe');
      expect((await harness.service.repo.findMembership(roomId, host.playerId!))?.connected).toBe(0);

      await humanStep(host, gameId);
      await humanStep(host, gameId);
      const frozen = await revision(gameId);
      await sleep(150);
      expect(await revision(gameId)).toBe(frozen);
      expect(actorOf(await state(gameId))).toBe(botIds[0]);

      socket.send(JSON.stringify({ type: 'subscribe', payload: { roomId } }));
      await waitFor(async () => actorOf(await state(gameId)) === host.playerId, 'bots to move after resubscribing');
      for (const botId of botIds) expect(botCounts(await state(gameId), botId).buildings).toBe(2);
    } finally {
      socket.close();
    }
    await waitFor(async () => !harness.service.rooms.hasLiveConnection(roomId), 'the socket to unregister');
  });

  it('suspends and resumes with only the person voting', async () => {
    const { host, roomId, gameId, botIds } = await botGame(2);
    await humanStep(host, gameId);
    await humanStep(host, gameId);
    host.expectOk(await host.post(`/api/games/${gameId}/suspend`, {}));
    expect((await harness.service.repo.findRoom(roomId))!.status).toBe('suspended');
    const { games } = host.expectOk<{ games: ResumableGameView[] }>(await host.get('/api/games'));
    const saved = games.find((game) => game.gameId === gameId)!;
    expect(saved.allSeatsNeeded).toBe(false);
    expect(saved.players.filter((player) => player.bot).map((player) => player.playerId)).toEqual(botIds);

    const drop = await liveSocket(harness.service, roomId, host.playerId!);
    try {
      const frozen = await revision(gameId);
      await sleep(150);
      expect(await revision(gameId)).toBe(frozen);

      const resumed = host.expectOk<{ resumed: boolean; waitingFor: string[] }>(
        await host.post(`/api/games/${gameId}/resume`, { ready: true }),
      );
      expect(resumed).toEqual({ resumed: true, waitingFor: [] });
      await waitFor(async () => actorOf(await state(gameId)) === host.playerId, 'bots to continue after resume');
      for (const botId of botIds) expect(botCounts(await state(gameId), botId).buildings).toBe(2);
    } finally {
      await drop();
    }
  });

  it('applies a post-start policy change with only the person consenting', async () => {
    const { host, roomId } = await botGame(2);
    const view = host.expectOk<RoomShape>(
      await host.post(`/api/rooms/${roomId}/policy`, { policy: { turnClockSeconds: 45 } }),
    );
    expect(view.pendingPolicy).toBeNull();
    expect(view.policy.turnClockSeconds).toBe(45);
  });

  it('lets the only person end a game against bots', async () => {
    const { host, roomId, gameId } = await botGame(2);
    host.expectOk(await host.post(`/api/games/${gameId}/abandon`, {}));
    expect((await harness.service.repo.findRoom(roomId))!.status).toBe('abandoned');
    expect((await state(gameId)).result?.reason).toBe('abandoned');
  });

  it('keeps the policy switch and never counts a bot as absent', async () => {
    const host = await harness.client('PolicyOff');
    const room = await createRoom(host, { bots: 2, policy: { allowAbandonment: false } });
    host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
    const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
    host.expectError(await host.post(`/api/games/${gameId}/abandon`, {}), 'E_ABANDON_DISABLED');

    // 兩位真人加一個 Bot：Bot 不算缺席，所以沒有人缺席就不能放棄。
    const first = await harness.client('PairOne');
    const second = await harness.client('PairTwo');
    const pair = await createRoom(first, { bots: 1 });
    second.expectOk(await second.post('/api/rooms/join', { code: pair.code }));
    first.expectOk(await first.post(`/api/rooms/${pair.id}/ready`, { ready: true }));
    second.expectOk(await second.post(`/api/rooms/${pair.id}/ready`, { ready: true }));
    const started = first.expectOk<{ gameId: string }>(await first.post(`/api/rooms/${pair.id}/start`));
    first.expectError(await first.post(`/api/games/${started.gameId}/abandon`, {}), 'E_NO_ABSENT_PLAYER');

    // 另一位真人缺席時，只需要在線的真人同意。
    await harness.service.repo.updateMembership(pair.id, second.playerId!, { connected: 0 });
    first.expectOk(await first.post(`/api/games/${started.gameId}/abandon`, {}));
    expect((await harness.service.repo.findRoom(pair.id))!.status).toBe('abandoned');
  });

  it('falls back to a legal move when the strategy misbehaves', async () => {
    const deps = driverDeps();
    const original = deps.policyFor;
    let calls = 0;
    const broken: BotPolicy = {
      decide() {
        calls += 1;
        // 交替回傳非法指令與拋出例外。
        if (calls % 2 === 0) throw new Error('strategy bug');
        return { type: 'turn.end' };
      },
    };
    deps.policyFor = () => broken;
    const { host, roomId, gameId, botIds } = await botGame(2);
    const drop = await liveSocket(harness.service, roomId, host.playerId!);
    try {
      await humanStep(host, gameId);
      await humanStep(host, gameId);
      await waitFor(async () => actorOf(await state(gameId)) === host.playerId, 'fallback setup for both bots');
      for (const botId of botIds) expect(botCounts(await state(gameId), botId)).toEqual({ buildings: 2, roads: 2 });
      const rejected = await harness.service.repo.db.all<{ command_id: string }>(
        `SELECT command_id FROM command_receipts WHERE game_id = ? AND outcome = 'rejected'`,
        [gameId],
      );
      expect(rejected.length).toBeGreaterThan(0);
      expect(rejected.every((row) => row.command_id.startsWith('bot:'))).toBe(true);
    } finally {
      deps.policyFor = original;
      await drop();
    }
  });

  it('stops a strategy that keeps answering the same offer', async () => {
    const deps = driverDeps();
    const original = deps.policyFor;
    // 規則允許重複回應同一報價，這個策略因此會無限迴圈。
    deps.policyFor = () => chattyPolicy;
    const { host, roomId, gameId, botIds } = await chattyTable();
    const drop = await liveSocket(harness.service, roomId, host.playerId!);
    try {
      await waitFor(
        async () => (await acceptedCount(gameId, botIds[0]!)) >= 40 && (await acceptedCount(gameId, botIds[1]!)) >= 40,
        'both bots to reach the per-window limit',
      );
      const settled = await revision(gameId);
      await sleep(150);
      expect(await revision(gameId)).toBe(settled);
      expect(await acceptedCount(gameId, botIds[0]!)).toBe(40);
      expect(await acceptedCount(gameId, botIds[1]!)).toBe(40);
    } finally {
      deps.policyFor = original;
      await drop();
    }
  });

  it('asks the injected limit hook for the profile of the game', async () => {
    const deps = driverDeps();
    const original = { policyFor: deps.policyFor, commandLimitFor: deps.commandLimitFor };
    const asked = new Set<string>();
    deps.policyFor = () => chattyPolicy;
    deps.commandLimitFor = (profileId) => {
      asked.add(profileId);
      return 6;
    };
    const logs = captureLogs(deps);
    const { host, roomId, gameId, botIds } = await chattyTable();
    const drop = await liveSocket(harness.service, roomId, host.playerId!);
    try {
      await waitFor(
        async () => (await acceptedCount(gameId, botIds[0]!)) >= 6 && (await acceptedCount(gameId, botIds[1]!)) >= 6,
        'both bots to reach the injected limit',
      );
      const settled = await revision(gameId);
      await sleep(150);
      // 超過上限後只走保底策略，保底對這個報價沒有動作，所以不再提交任何指令。
      expect(await revision(gameId)).toBe(settled);
      expect(await acceptedCount(gameId, botIds[0]!)).toBe(6);
      expect(await acceptedCount(gameId, botIds[1]!)).toBe(6);
      expect([...asked]).toEqual(['base-2025']);
      const reached = logs.entries.filter((entry) => entry.message.startsWith('bot command limit reached'));
      // 每次 revision 變動都會再記一筆，所以只比對有哪些 Bot 達到上限。
      expect(new Set(reached.map((entry) => entry.meta.botId))).toEqual(new Set(botIds));
      // 非行動者達到上限並不欠動作，所以不會被當成卡住。
      expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
    } finally {
      logs.restore();
      Object.assign(deps, original);
      await drop();
    }
  });

  it('waits for the collection window before settling an offer a person accepted', async () => {
    const deps = driverDeps();
    const original = deps.policyFor;
    const config = harness.service.config.bots;
    const saved = { ...config };
    config.offerCollectMs = 300;
    config.offerPatienceMs = 3000;
    deps.policyFor = () => traderPolicy;
    const logs = captureLogs(deps);
    const { host, roomId, gameId, botIds } = await botGame(2);
    await traderTable(gameId, host.playerId!, botIds[0]!);
    const drop = await liveSocket(harness.service, roomId, host.playerId!);
    try {
      const offer = await waitForOffer(gameId);
      host.expectOk(
        await host.post(`/api/games/${gameId}/commands`, {
          commandId: id('consent'),
          expectedRevision: await revision(gameId),
          command: { type: 'trade.respond', offerId: offer.id, response: 'consented' },
        }),
      );
      await waitFor(
        async () => (await state(gameId)).offers.some((candidate) => candidate.status === 'completed'),
        'the bot to settle',
      );
      const times = await eventTimes(gameId);
      expect(times['trade.completed']! - times['trade.offered']!).toBeGreaterThanOrEqual(280);
      const human = (await state(gameId)).players.find((player) => player.id === host.playerId)!;
      expect(human.resources.lumber).toBe(1);
      expect(human.resources.brick).toBe(1);
      // 收集窗內行動的 Bot 在等自己報價的回應：策略沒有動作，但不算欠動作。
      expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
    } finally {
      Object.assign(config, saved);
      logs.restore();
      deps.policyFor = original;
      await drop();
    }
  });

  it('withdraws an offer nobody accepts after the timeout', async () => {
    const deps = driverDeps();
    const original = deps.policyFor;
    deps.policyFor = () => traderPolicy;
    const { host, roomId, gameId, botIds } = await botGame(2);
    await traderTable(gameId, host.playerId!, botIds[0]!);
    const drop = await liveSocket(harness.service, roomId, host.playerId!);
    try {
      await waitForOffer(gameId);
      await waitFor(
        async () => (await state(gameId)).offers.some((offer) => offer.status === 'withdrawn'),
        'the bot to withdraw',
      );
      const times = await eventTimes(gameId);
      // 收集窗 50 ms、逾時 150 ms：沒人同意也沒人全部拒絕，撤回要等到逾時。
      expect(times['trade.withdrawn']! - times['trade.offered']!).toBeGreaterThanOrEqual(130);
      await waitFor(async () => actorOf(await state(gameId)) !== botIds[0], 'the bot to end its turn');
    } finally {
      deps.policyFor = original;
      await drop();
    }
  });
});

describe('B-LIFE pacing', () => {
  it('delays each command by its pacing entry, scaled, and uses the default for unknown types', () => {
    const deps = driverDeps();
    const config = harness.service.config.bots;
    const saved = { ...config };
    const savedNow = deps.now;
    const now = 1_000_000;
    deps.now = () => now;
    config.delayScale = 2;
    const driver = harness.service.bots as unknown as {
      delayFor(command: BotCommand, runtime: { changedAt: number; rolledAt: number | null }): number;
    };
    try {
      const runtime = { changedAt: now, rolledAt: null };
      // base 的節奏不因合併 BOT_PACING 而改變（目前沒有任何模組宣告 pacing）。
      expect(driver.delayFor({ type: 'setup.placeRoad' }, runtime)).toBe(1200);
      expect(driver.delayFor({ type: 'trade.offer' }, runtime)).toBe(2400);
      expect(driver.delayFor({ type: 'dev.playKnight' }, runtime)).toBe(2200);
      expect(driver.delayFor({ type: 'unknown.module.command' }, runtime)).toBe(1800);
      // 擲骰演出期間，任何指令都至少等到演出結束。
      expect(driver.delayFor({ type: 'trade.withdraw' }, { changedAt: now, rolledAt: now })).toBe(5600);
    } finally {
      Object.assign(config, saved);
      deps.now = savedNow;
    }
  });
});

describe('B-LIFE owed action without an answer', () => {
  const frameKind = `${UNKNOWN_MODULE}.choose`;

  /** 把局面改成 fixture profile 的模組 frame；`responders` 的第一位就是欠動作的人。 */
  async function openFrame(gameId: string, responders: string[]): Promise<number> {
    return rewrite(gameId, (game) => {
      game.profileId = UNKNOWN_PROFILE.id;
      game.turn.phase = 'action';
      game.turn.setup = null;
      game.turn.seat = 0;
      game.pending = { kind: frameKind, module: UNKNOWN_MODULE, responders, data: {} };
    });
  }

  it('warns and retries at the fixed interval while no bot module answers a frame', async () => {
    const deps = driverDeps();
    const config = harness.service.config.bots;
    const saved = { ...config };
    config.retryMs = 120;
    const logs = captureLogs(deps);
    const { host, roomId, gameId, botIds } = await botGame(2);
    const [botId] = botIds as [string, string];
    const drop = await liveSocket(harness.service, roomId, host.playerId!);
    try {
      const stuck = await openFrame(gameId, [botId]);
      harness.service.bots.kick(gameId);
      await waitFor(async () => logs.entries.filter(isIdleDutyWarn).length >= 3, 'three diagnostic warnings');

      // 每筆 warn 都說明卡在哪裡：誰欠動作、什麼 frame、回應者與模組子階段。
      const warns = logs.entries.filter(isIdleDutyWarn);
      for (const warn of warns) {
        expect(warn.meta).toMatchObject({
          gameId,
          botId,
          owed: 'frame',
          revision: stuck,
          turnPhase: 'action',
          pendingKind: frameKind,
          responders: [botId],
          retryMs: 120,
        });
        expect(warn.meta.modulePhases).toEqual({ [UNKNOWN_MODULE]: UNKNOWN_SUBPHASE });
      }
      // 只報告欠動作的那一位；另一個 Bot 不是第一位回應者。
      expect(new Set(warns.map((warn) => warn.meta.botId))).toEqual(new Set([botId]));

      // 重試由計時器固定間隔觸發：狀態沒變時相鄰兩次至少相隔 retryMs，而不是連續評估。
      const gaps = warns.slice(1).map((warn, index) => warn.at - warns[index]!.at);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(100);
      const before = warns.length;
      await sleep(500);
      // 500 ms 內最多再重試 5 次；熱迴圈會在這段時間產生數百筆。
      expect(logs.entries.filter(isIdleDutyWarn).length - before).toBeLessThanOrEqual(6);
      // 卡住期間沒有送出任何指令，狀態也沒有變。
      expect(await revision(gameId)).toBe(stuck);
      expect(await acceptedCount(gameId, botId)).toBe(0);

      // 狀態改變後，下一次重試就能接手：這裡直接改寫快照，不經過提交通知。
      const resolved = await rewrite(gameId, (game) => {
        game.pending = null;
        game.turn.seat = game.players.findIndex((player) => player.id === botId);
      });
      await waitFor(async () => (await revision(gameId)) > resolved, 'the retry to resume the bot');
      const settled = logs.entries.filter(isIdleDutyWarn).length;
      await sleep(400);
      expect(logs.entries.filter(isIdleDutyWarn).length).toBe(settled);
    } finally {
      Object.assign(config, saved);
      logs.restore();
      await drop();
    }
  });

  it('stays quiet while a person is the first responder of the frame', async () => {
    const deps = driverDeps();
    const config = harness.service.config.bots;
    const saved = { ...config };
    config.retryMs = 60;
    const logs = captureLogs(deps);
    const { host, roomId, gameId, botIds } = await botGame(2);
    const drop = await liveSocket(harness.service, roomId, host.playerId!);
    try {
      const frozen = await openFrame(gameId, [host.playerId!, botIds[0]!]);
      harness.service.bots.kick(gameId);
      await sleep(400);
      // 輪不到 Bot 回答的 frame 不是 Bot 欠的動作：不記 warn，也不改變狀態。
      expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
      expect(await revision(gameId)).toBe(frozen);
      expect(harness.service.bots.stats().timers).toBe(0);
    } finally {
      Object.assign(config, saved);
      logs.restore();
      await drop();
    }
  });
});

describe('B-RACE one revision, two actors', () => {
  it('commits exactly one of a person and a bot submitting on the same revision', async () => {
    const { host, gameId, botIds } = await botGame(2);
    await rewrite(gameId, (game) => {
      game.turn.phase = 'action';
      game.turn.setup = null;
      game.turn.seat = 0;
      grant(game, host.playerId!, 'wool', 1);
    });
    const offered = host.expectOk<Receipt>(
      await host.post(`/api/games/${gameId}/commands`, {
        commandId: id('offer'),
        expectedRevision: await revision(gameId),
        command: { type: 'trade.offer', to: 'all', give: { wool: 1 }, want: { ore: 1 } },
      }),
    );
    const offerId = (await state(gameId)).offers.at(-1)!.id;
    const at = offered.revision;
    const [human, bot] = await Promise.all([
      harness.service.games.submit(host.playerId!, gameId, {
        commandId: id('withdraw'),
        expectedRevision: at,
        command: { type: 'trade.withdraw', offerId },
      }),
      harness.service.games.submit(botIds[0]!, gameId, {
        commandId: `bot:${at}:0`,
        expectedRevision: at,
        command: { type: 'trade.respond', offerId, response: 'declined' },
      }),
    ]);
    const outcomes = [human.outcome, bot.outcome].sort();
    expect(outcomes).toEqual(['accepted', 'rejected']);
    const loser = human.outcome === 'rejected' ? human : bot;
    expect(loser.error?.messageId).toBe('error.E_STALE_REVISION');
    expect(await revision(gameId)).toBe(at + 1);
  });

  it('re-decides instead of submitting a stale bot move', async () => {
    const { host, roomId, gameId, botIds } = await botGame(2);
    const botId = botIds[0]!;
    await rewrite(gameId, (game) => {
      game.turn.phase = 'action';
      game.turn.setup = null;
      game.turn.seat = 0;
      grant(game, host.playerId!, 'lumber', 8);
      grant(game, botId, 'grain', 8);
      game.pending = { kind: 'discard', required: { [host.playerId!]: 4, [botId]: 4 }, submitted: {} };
    });
    const config = harness.service.config.bots;
    const saved = config.delayScale;
    // Bot 棄牌的思考時間約 450 ms，真人在這段時間內先送出。
    config.delayScale = 0.5;
    const drop = await liveSocket(harness.service, roomId, host.playerId!);
    try {
      expect(await humanStep(host, gameId)).toMatchObject({ type: 'pending.discard' });
      await waitFor(async () => (await state(gameId)).pending?.kind === 'moveRobber', 'the bot to discard');
      const game = await state(gameId);
      const total = (playerId: string) =>
        RESOURCES.reduce((sum, resource) => sum + game.players.find((p) => p.id === playerId)!.resources[resource], 0);
      expect(total(botId)).toBe(4);
      expect(total(host.playerId!)).toBe(4);
      const receipts = await harness.service.repo.db.all<{ outcome: string }>(
        'SELECT outcome FROM command_receipts WHERE game_id = ? AND player_id = ?',
        [gameId, botId],
      );
      expect(receipts.map((receipt) => receipt.outcome)).toEqual(['accepted']);
    } finally {
      config.delayScale = saved;
      await drop();
    }
  });
});

describe('B-LIFE restart and shutdown', () => {
  it('continues a bot table from the committed state after a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'catan-bots-restart-'));
    const sqlitePath = join(dir, 'bots.sqlite');
    const overrides = { port: 0, host: '127.0.0.1', sqlitePath, bots: { ...FAST_BOTS } };
    try {
      const first = await startService(overrides, () => undefined);
      const host = createClient(`http://127.0.0.1:${first.port}`);
      host.playerId = host.expectOk<{ player: { id: string } }>(
        await host.post('/api/session', { nickname: 'Restart', locale: 'en' }),
      ).player.id;
      const room = await createRoom(host, { bots: 2 });
      host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
      const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
      await humanStep(host, gameId);
      await humanStep(host, gameId);
      const before = await revision(gameId, first);
      await first.close();
      expect(first.bots.stats()).toMatchObject({ games: 0, timers: 0, tasks: 0 });

      const second = await startService(overrides, () => undefined);
      try {
        expect(await revision(gameId, second)).toBe(before);
        const drop = await liveSocket(second, room.id, host.playerId!);
        await waitFor(
          async () => actorOf(await state(gameId, second)) === host.playerId,
          'bots to continue after the restart',
        );
        expect(await revision(gameId, second)).toBe(before + 8);
        await drop();
      } finally {
        await second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stops every bot timer on close', async () => {
    const slow = await startHarness({ bots: { ...FAST_BOTS, delayScale: 5 } });
    let closed = false;
    try {
      const { host, roomId, gameId } = await botGame(2, { service: slow });
      await humanStep(host, gameId);
      await humanStep(host, gameId);
      const before = await revision(gameId, slow.service);
      await liveSocket(slow.service, roomId, host.playerId!);
      await waitFor(async () => slow.service.bots.stats().timers > 0, 'a pending bot move');
      // 5 倍延遲下第一步要約 4.5 秒，關閉前還沒有送出。
      expect(await revision(gameId, slow.service)).toBe(before);
      await slow.close();
      closed = true;
      expect(slow.service.bots.stats()).toEqual({ games: 0, timers: 0, busy: 0, tasks: 0 });
    } finally {
      if (!closed) await slow.close();
    }
  });
});

/** 規則允許重複回應同一報價，這個策略因此會無限迴圈。 */
const chattyPolicy: BotPolicy = {
  decide(view, ctx) {
    const offer = view.offers.find((candidate) => candidate.status === 'open' && candidate.from !== ctx.selfId);
    return offer ? { type: 'trade.respond', offerId: offer.id, response: 'declined' } : fallbackPolicy.decide(view, ctx);
  },
};

/** 真人在行動階段開一張全桌報價，兩個 Bot 都是只能回應的非行動者。 */
async function chattyTable(): Promise<{ host: TestClient; roomId: string; gameId: string; botIds: string[] }> {
  const table = await botGame(2);
  await rewrite(table.gameId, (game) => {
    game.turn.phase = 'action';
    game.turn.setup = null;
    game.turn.seat = 0;
    grant(game, table.host.playerId!, 'wool', 1);
  });
  table.host.expectOk(
    await table.host.post(`/api/games/${table.gameId}/commands`, {
      commandId: id('offer'),
      expectedRevision: await revision(table.gameId),
      command: { type: 'trade.offer', to: 'all', give: { wool: 1 }, want: { ore: 1 } },
    }),
  );
  return table;
}

async function acceptedCount(gameId: string, playerId: string): Promise<number> {
  const rows = await harness.service.repo.db.all<{ total: number }>(
    `SELECT COUNT(*) AS total FROM command_receipts WHERE game_id = ? AND player_id = ? AND outcome = 'accepted'`,
    [gameId, playerId],
  );
  return Number(rows[0]!.total);
}

interface LogEntry {
  level: string;
  message: string;
  meta: Record<string, unknown>;
  /** 記錄當下的時間（毫秒）。 */
  at: number;
}

/** 攔截排程器的記錄（仍轉交原本的 logger）；測試結束要呼叫 `restore`。 */
function captureLogs(deps: BotDriverDeps): { entries: LogEntry[]; restore(): void } {
  const original = deps.log;
  const entries: LogEntry[] = [];
  deps.log = (level, message, meta) => {
    entries.push({ level, message, meta: (meta ?? {}) as Record<string, unknown>, at: Date.now() });
    original(level, message, meta);
  };
  return {
    entries,
    restore() {
      deps.log = original;
    },
  };
}

/** 「欠動作卻沒有動作」的診斷 warn。 */
function isIdleDutyWarn(entry: LogEntry): boolean {
  return entry.level === 'warn' && entry.message.startsWith('bot owes an action');
}

/** 測試用策略：行動者開一次全桌報價，收集窗後與同意者結算，逾時則撤回。 */
const traderPolicy: BotPolicy = {
  decide(view, ctx) {
    if (view.turn.playerId !== ctx.selfId || view.turn.phase !== 'action' || view.pending) {
      return fallbackPolicy.decide(view, ctx);
    }
    const mine = view.offers.filter((offer) => offer.from === ctx.selfId && offer.windowId === view.windowId);
    const open = mine.find((offer) => offer.status === 'open');
    if (open) {
      const phase = ctx.offerPhases[open.id] ?? 'expired';
      if (phase === 'collecting') return null;
      const partner = Object.entries(open.responses).find(([, response]) => response === 'consented')?.[0];
      if (partner) return { type: 'trade.settle', offerId: open.id, counterparty: partner };
      return phase === 'expired' ? { type: 'trade.withdraw', offerId: open.id } : null;
    }
    if (mine.length === 0 && (view.players.find((p) => p.id === ctx.selfId)?.resources?.lumber ?? 0) > 0) {
      return { type: 'trade.offer', to: 'all', give: { lumber: 1 }, want: { brick: 1 } };
    }
    return { type: 'turn.end' };
  },
};

/** 讓第一個 Bot 進入行動階段，並準備好雙方要交換的資源。 */
async function traderTable(gameId: string, humanId: string, botId: string): Promise<void> {
  await rewrite(gameId, (game) => {
    game.turn.phase = 'action';
    game.turn.setup = null;
    game.turn.seat = game.players.findIndex((player) => player.id === botId);
    for (const player of game.players) {
      for (const resource of RESOURCES) {
        game.bank[resource] += player.resources[resource];
        player.resources[resource] = 0;
      }
    }
    grant(game, botId, 'lumber', 2);
    grant(game, humanId, 'brick', 2);
  });
}

async function waitForOffer(gameId: string): Promise<{ id: string }> {
  let found: { id: string } | undefined;
  await waitFor(async () => {
    found = (await state(gameId)).offers.find((offer) => offer.status === 'open');
    return !!found;
  }, 'the bot to make an offer');
  return found!;
}

/** 每種事件最後一次寫入的時間（毫秒）。 */
async function eventTimes(gameId: string): Promise<Record<string, number>> {
  const rows = await harness.service.repo.db.all<{ type: string; created_at: string }>(
    'SELECT type, created_at FROM game_events WHERE game_id = ? ORDER BY seq ASC',
    [gameId],
  );
  const out: Record<string, number> = {};
  for (const row of rows) out[row.type] = Date.parse(row.created_at);
  return out;
}

describe('B-GAME full table on the service', () => {
  it('plays a whole game with the real strategy through the command path', async () => {
    const logs = captureLogs(driverDeps());
    const { host, roomId, gameId, botIds } = await botGame(3, { capacity: 4 });
    const disconnect = await liveSocket(harness.service, roomId, host.playerId!);
    // 真人座位也交給同一套策略，透過 HTTP 送指令；Bot 座位由排程器推進。
    const policy = createBotPolicy('standard');
    const deadline = Date.now() + 90_000;
    let humanCommands = 0;
    let view: GameView | null = null;
    while (Date.now() < deadline) {
      const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
      view = snapshot.view;
      if (view.result) break;
      const command = policy.decide(view, {
        selfId: host.playerId!,
        level: 'standard',
        seed: snapshot.revision,
        offerPhases: {},
      });
      if (!command) {
        await sleep(5);
        continue;
      }
      const receipt = host.expectOk<Receipt>(
        await host.post(`/api/games/${gameId}/commands`, {
          commandId: id('human'),
          expectedRevision: snapshot.revision,
          command,
        }),
      );
      // 與 Bot 同時送出時可能落後一個 revision，其他拒絕都代表策略或伺服器有誤。
      if (receipt.outcome === 'rejected') expect(receipt.error?.messageId).toBe('error.E_STALE_REVISION');
      else humanCommands += 1;
    }
    await disconnect();
    logs.restore();
    // 正常對局中策略或保底總有動作，診斷不應該出現。
    expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
    expect(view?.result?.playerId).toBeTruthy();
    expect(humanCommands).toBeGreaterThan(10);
    const game = await state(gameId);
    // 每個 Bot 都真的蓋了東西，而不是只靠保底策略擲骰與結束回合。
    for (const botId of botIds) expect(botCounts(game, botId).buildings).toBeGreaterThanOrEqual(2);
    expect((await harness.service.repo.findRoom(roomId))?.status).toBe('completed');
    const rejectedBotReceipts = await harness.service.repo.db.all<{ error_json: string }>(
      `SELECT error_json FROM command_receipts WHERE game_id = ? AND outcome = 'rejected' AND command_id LIKE 'bot:%'`,
      [gameId],
    );
    expect(
      rejectedBotReceipts.filter((row) => !row.error_json.includes('E_STALE_REVISION')),
    ).toEqual([]);
  }, 120_000);
});
