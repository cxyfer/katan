/**
 * Cities & Knights 的 Bot 席位（CK-G，C&K 計畫 §6.3；結構比照 `seafarers-bots.test.ts`）。
 *
 * 四類案例，全都經過 HTTP 與真實的 BotDriver：
 * 1. 真人房主加上 Bot 的完整 `ck-2025`（3 人）與 `ck-paired-2025`（5 人）對局，跑到終局有勝者，沒有非 stale 的拒絕；
 * 2. 策略拋錯時，`citiesKnights.pillage` 由保底代答，沒有被拒絕、也不必等重試；
 * 3. 4 人房：`scienceBonus` 的 `responders[0]` 是真人時 Bot 等待，真人作答後 Bot 才答；`progressDiscard`
 *    為 Bot → 真人 → Bot，Bot 在輪到自己時作答、輪到真人時等待（策略只作答 frame，不主動打牌）；
 * 4. `defenderDraw` 等待真人時重啟伺服器，frame 與 Bot 的後續作答由已提交的狀態恢復。
 *
 * 注入的 pending 形狀照 rules 的實際建立處（`barbarians.ts`、`production.ts`、`progress.ts`）：
 * `{ kind, module, responders, data }`，`data` 的欄位與內容也一致；`responders` 的成員與順序照
 * `turnOrder`（從行動者起算）與 `overLimitOffTurn`（排除行動者），都是真實對局能走到的狀態。
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CK_DEFENDER_FRAME,
  CK_PILLAGE_FRAME,
  CK_PROGRESS_DISCARD_FRAME,
  CK_SCIENCE_FRAME,
  CITIES_KNIGHTS,
  type GameEvent,
  type GameState,
  type GameView,
} from '@catan/rules';
import { createBotPolicy, fallbackPolicy, type BotCommand, type BotPolicy } from '@catan/bots';
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

type CkProfileId = 'ck-2025' | 'ck-paired-2025';
const PROFILE_ID: CkProfileId = 'ck-2025';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness({ bots: { ...FAST_BOTS } });
});

afterAll(async () => {
  await harness.close();
});

interface Snapshot {
  revision: number;
  view: GameView;
}

interface Receipt {
  outcome: 'accepted' | 'rejected';
  revision: number;
  error?: { messageId: string };
}

interface RoomShape {
  id: string;
  members: { playerId: string; bot: boolean; seat: number }[];
}

interface LogEntry {
  level: string;
  message: string;
  meta: Record<string, unknown>;
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
  const connection: Connection = { id: randomUUID(), playerId, roomId, send() {}, close() {} };
  await service.rooms.registerConnection(connection);
  return () => service.rooms.unregisterConnection(connection);
}

function driverDeps(service: RunningService): BotDriverDeps {
  return (service.bots as unknown as { deps: BotDriverDeps }).deps;
}

/** 攔截排程器的記錄（仍轉交原本的 logger）；測試結束要呼叫 `restore`。 */
function captureLogs(deps: BotDriverDeps): { entries: LogEntry[]; restore(): void } {
  const original = deps.log;
  const entries: LogEntry[] = [];
  deps.log = (level, message, meta) => {
    entries.push({ level, message, meta: (meta ?? {}) as Record<string, unknown> });
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

/** 指令被拒、保底也被拒或送出失敗的 warn：這些都代表要等重試，不應該出現。 */
function isRetryWarn(entry: LogEntry): boolean {
  return (
    entry.level === 'warn' &&
    (entry.message.startsWith('bot command rejected') ||
      entry.message.startsWith('bot fallback rejected') ||
      entry.message.startsWith('bot submission failed'))
  );
}

async function state(gameId: string, service: RunningService): Promise<GameState> {
  return service.games.rawState(gameId);
}

async function revision(gameId: string, service: RunningService): Promise<number> {
  return (await service.repo.findGame(gameId))!.revision;
}

function actorOf(game: GameState): string {
  return game.players[game.turn.seat]!.id;
}

/** 直接改寫快照（比照 bots.test.ts），用來建立特定局面。 */
async function rewrite(gameId: string, service: RunningService, edit: (game: GameState) => void): Promise<number> {
  const row = await service.repo.findGame(gameId);
  const game = JSON.parse(row!.state_json) as GameState;
  edit(game);
  await service.repo.saveGame(gameId, game, row!.revision + 1, 'playing', null);
  return row!.revision + 1;
}

/** 建一間 C&K 房：真人房主加上 `bots` 個 Bot，全員就緒後開局。 */
async function ckGame(
  service: RunningService,
  host: TestClient,
  options: { bots: number; profileId?: CkProfileId },
): Promise<{ roomId: string; gameId: string; botIds: string[] }> {
  const profileId = options.profileId ?? PROFILE_ID;
  let room = host.expectOk<RoomShape>(
    await host.post('/api/rooms', {
      visibility: 'private',
      capacity: options.bots + 1,
      profileId,
      // 5–6 人的 paired profile 只提供 variable 擺法。
      setupMode: profileId === 'ck-paired-2025' ? 'variable' : 'fixed',
    }),
  );
  for (let index = 0; index < options.bots; index++) {
    room = host.expectOk<RoomShape>(await host.post(`/api/rooms/${room.id}/bots`, {}));
  }
  host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
  const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
  expect((await state(gameId, service)).profileId).toBe(profileId);
  return { roomId: room.id, gameId, botIds: room.members.filter((member) => member.bot).map((member) => member.playerId) };
}

/** 真人座位用保底策略走一步（放置、擲骰、結束回合）。 */
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

/** 走完 setup：輪到真人時以保底放置，Bot 的席位由排程器推進（需要真人在線）。 */
async function finishSetup(client: TestClient, gameId: string, service: RunningService): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const game = await state(gameId, service);
    if (game.turn.phase !== 'setup') return;
    if (actorOf(game) === client.playerId) await humanStep(client, gameId);
    else await sleep(10);
  }
  throw new Error('setup did not finish');
}

/** 把局面改成 `actor` 的行動階段，並清掉 setup 狀態。 */
function actionPhase(game: GameState, actor: string): void {
  game.turn.seat = game.players.findIndex((player) => player.id === actor);
  game.turn.phase = 'action';
  game.turn.setup = null;
}

/** 目前還在等的 responders；沒有待決效果時為 `undefined`。 */
function respondersOf(game: GameState): string[] | undefined {
  return (game.pending as { responders?: string[] } | null)?.responders;
}

/** 依序記下的事件：`type` 事件的 `params.playerId`。 */
function eventPlayers(game: GameState, type: string): string[] {
  return game.log.filter((event) => event.type === type).map((event) => event.params.playerId as string);
}

/** 整局已提交的事件（`state.log` 只留最後 200 筆，完整對局要從資料庫讀）。 */
async function allEvents(service: RunningService, gameId: string): Promise<GameEvent[]> {
  const events: GameEvent[] = [];
  for (;;) {
    const page = await service.repo.listEvents(gameId, events[events.length - 1]?.seq ?? 0, 500);
    if (page.length === 0) return events;
    events.push(...page);
  }
}

async function rejectedBotReceipts(service: RunningService, gameId: string): Promise<string[]> {
  const rows = await service.repo.db.all<{ error_json: string }>(
    `SELECT error_json FROM command_receipts WHERE game_id = ? AND outcome = 'rejected' AND command_id LIKE 'bot:%'`,
    [gameId],
  );
  return rows.map((row) => row.error_json).filter((error) => !error.includes('E_STALE_REVISION'));
}

/** 策略一呼叫就拋錯：所有欠的動作都得由保底接手。 */
const throwingPolicy: BotPolicy = {
  decide() {
    throw new Error('strategy exploded');
  },
};

/**
 * 策略只作答待決的 frame，沒有待決效果時改由保底行動（只擲骰與結束回合）。回傳還原函式；
 * 測試結束要呼叫，避免汙染共用的 BotDriverDeps。
 */
function frameOnlyPolicies(deps: BotDriverDeps): () => void {
  const original = deps.policyFor;
  deps.policyFor = (level) => {
    const strategy = original(level);
    return { decide: (view, ctx) => (view.pending ? strategy.decide(view, ctx) : fallbackPolicy.decide(view, ctx)) };
  };
  return () => {
    deps.policyFor = original;
  };
}

/**
 * 開出 `citiesKnights.pillage`：`actor` 回合的行動階段，`bot` 的兩座建築都是城市（真實的 frame 只在
 * 受害者有兩座以上可掠奪的城市時才出現），frame 只等 `bot`。
 */
async function openPillage(gameId: string, service: RunningService, actor: string, bot: string): Promise<number> {
  return rewrite(gameId, service, (game) => {
    actionPhase(game, actor);
    for (const building of game.board.buildings) if (building?.player === bot) building.city = true;
    game.pending = { kind: CK_PILLAGE_FRAME, module: CITIES_KNIGHTS, responders: [bot], data: {} };
  });
}

/** 開出 `citiesKnights.scienceBonus`：依序作答，`data` 為空。 */
async function openScience(gameId: string, service: RunningService, actor: string, responders: string[]): Promise<number> {
  return rewrite(gameId, service, (game) => {
    actionPhase(game, actor);
    game.pending = { kind: CK_SCIENCE_FRAME, module: CITIES_KNIGHTS, responders, data: {} };
  });
}

/** 進步卡手牌 5 張（上限 4）：每位 responder 欠 1 張。 */
const OVERFULL_HAND = ['diplomacy', 'intrigue', 'sabotage', 'treason', 'wedding'] as const;

/** 開出 `citiesKnights.progressDiscard`：每位 responder 都持有 5 張進步卡，`data.required` 為各欠 1 張。 */
async function openProgressDiscard(
  gameId: string,
  service: RunningService,
  actor: string,
  responders: string[],
): Promise<number> {
  return rewrite(gameId, service, (game) => {
    actionPhase(game, actor);
    for (const playerId of responders) {
      game.players.find((player) => player.id === playerId)!.progressCards = [...OVERFULL_HAND];
    }
    game.pending = {
      kind: CK_PROGRESS_DISCARD_FRAME,
      module: CITIES_KNIGHTS,
      responders,
      data: { required: Object.fromEntries(responders.map((playerId) => [playerId, 1])) },
    };
  });
}

/** 開出 `citiesKnights.defenderDraw`：平手的守衛者依序抽牌，`data` 為空。 */
async function openDefenderDraw(gameId: string, service: RunningService, actor: string, responders: string[]): Promise<number> {
  return rewrite(gameId, service, (game) => {
    actionPhase(game, actor);
    game.pending = { kind: CK_DEFENDER_FRAME, module: CITIES_KNIGHTS, responders, data: {} };
  });
}

describe('Cities & Knights with bot seats', () => {
  // 1. 完整對局：真人座位也交給同一套策略，透過 HTTP 送指令；Bot 座位由排程器推進。
  const fullGames = [
    { profileId: 'ck-2025', players: 3 },
    { profileId: 'ck-paired-2025', players: 5 },
  ] as const;
  for (const { profileId, players } of fullGames) {
    it(`plays a whole ${players}-player ${profileId} game to a winner`, async () => {
      const logs = captureLogs(driverDeps(harness.service));
      let disconnect: (() => Promise<void>) | null = null;
      try {
        const host = await harness.client('CkHost');
        const { roomId, gameId, botIds } = await ckGame(harness.service, host, { bots: players - 1, profileId });
        disconnect = await liveSocket(harness.service, roomId, host.playerId!);
        const policy = createBotPolicy('standard');
        const deadline = Date.now() + 150_000;
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
        expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
        expect(view?.result?.playerId).toBeTruthy();
        expect(humanCommands).toBeGreaterThan(10);
        const game = await state(gameId, harness.service);
        expect(game.profileId).toBe(profileId);
        expect(game.pending).toBeNull();
        // Bot 真的玩了 C&K：招募過騎士或改良過城市。setup 本來就給每人一座村莊與一座城市，
        // 建築數不能當證據；事件從資料庫讀完整的歷史。
        const events = await allEvents(harness.service, gameId);
        const botActions = events.filter(
          (event) =>
            (event.type === 'ck.knightRecruited' || event.type === 'ck.cityImproved') &&
            botIds.includes(event.params.playerId as string),
        );
        expect(botActions.length).toBeGreaterThan(0);
        expect((await harness.service.repo.findRoom(roomId))?.status).toBe('completed');
        expect(await rejectedBotReceipts(harness.service, gameId)).toEqual([]);
      } finally {
        // 逾時或斷言失敗時也要還原 logger、放掉真人連線，避免汙染共用的 BotDriverDeps。
        logs.restore();
        await disconnect?.();
      }
    }, 180_000);
  }

  // 2. 策略拋錯：pillage 由保底代答，第一次嘗試就被接受，沒有走到重試。
  it('answers a pillage frame through the fallback when the strategy throws', async () => {
    const service = harness.service;
    const deps = driverDeps(service);
    const original = deps.policyFor;
    const logs = captureLogs(deps);
    const host = await harness.client('PillageFallback');
    const { roomId, gameId, botIds } = await ckGame(service, host, { bots: 2 });
    const [botId, other] = botIds as [string, string];
    const drop = await liveSocket(service, roomId, host.playerId!);
    try {
      await finishSetup(host, gameId, service);
      deps.policyFor = () => throwingPolicy;
      const opened = await openPillage(gameId, service, other, botId);
      const citiesBefore = (await state(gameId, service)).board.buildings.filter(
        (building) => building?.player === botId && building.city,
      ).length;
      expect(citiesBefore).toBe(2);
      service.bots.kick(gameId);
      await waitFor(async () => (await revision(gameId, service)) > opened, 'the fallback to answer the pillage frame');

      const game = await state(gameId, service);
      expect(game.log.filter((event) => event.type === 'ck.cityPillaged').map((event) => event.params.playerId)).toEqual([botId]);
      expect(game.board.buildings.filter((building) => building?.player === botId && building.city)).toHaveLength(1);
      expect(
        logs.entries.some(
          (entry) => entry.level === 'warn' && entry.message === 'bot policy threw; using fallback' && entry.meta.botId === botId,
        ),
      ).toBe(true);
      // 第一次嘗試（attempt 0）就被接受：沒有被拒絕，也不必等重試間隔。
      const receipt = await service.repo.db.all<{ outcome: string }>(
        `SELECT outcome FROM command_receipts WHERE game_id = ? AND player_id = ? AND command_id = ?`,
        [gameId, botId, `bot:${opened}:0`],
      );
      expect(receipt.map((row) => row.outcome)).toEqual(['accepted']);
      expect(logs.entries.filter(isRetryWarn)).toEqual([]);

      // frame 結束後 BotDriver 沒有卡住：回合繼續輪下去，直到輪到真人。
      await waitFor(async () => actorOf(await state(gameId, service)) === host.playerId, 'the turn to reach the person');
      expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
      expect(await rejectedBotReceipts(service, gameId)).toEqual([]);
    } finally {
      deps.policyFor = original;
      logs.restore();
      await drop();
    }
  }, 30_000);

  // 3. 真人與 Bot 並存（4 人房：真人加 3 個 Bot）。frame 的作答順序依 rules 的實際規則：
  //    - scienceBonus 依 `turnOrder`（從擲骰者起算）：真人排在 Bot 前面，Bot 不搶答；
  //    - progressDiscard 排除行動者（`overLimitOffTurn`），依 `turnOrder` 為 Bot → 真人 → Bot。
  //    座位以真人為 0 順時針編號：`before` 是真人前一座、`after` 是後一座、`across` 在對面。
  it('lets bots wait for a person in scienceBonus and answer around one in progressDiscard', async () => {
    const service = harness.service;
    const deps = driverDeps(service);
    const logs = captureLogs(deps);
    // 策略只作答 frame，沒有待決效果時由保底行動：CK-C 之後 standard 會主動打出進步卡，
    // 可能開出需要真人作答的 frame，測試裡的真人不會答，整局就卡住。
    const restorePolicy = frameOnlyPolicies(deps);
    const host = await harness.client('CkShared');
    const { roomId, gameId } = await ckGame(service, host, { bots: 3 });
    const drop = await liveSocket(service, roomId, host.playerId!);
    try {
      await finishSetup(host, gameId, service);
      const seats = (await state(gameId, service)).players.map((player) => player.id);
      const at = (offset: number): string => seats[(seats.indexOf(host.playerId!) + offset) % seats.length]!;
      const [after, across, before] = [at(1), at(2), at(3)];

      // scienceBonus：擲骰者是 before，turnOrder 為 before → 真人 → after → across；
      // 真人與 after 沒有拿到牌，真人排在最前面，Bot 不搶答，連同回合都停住。
      const science = await openScience(gameId, service, before, [host.playerId!, after]);
      service.bots.kick(gameId);
      await sleep(300);
      expect(await revision(gameId, service)).toBe(science);
      expect(respondersOf(await state(gameId, service))).toEqual([host.playerId, after]);
      const mine = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
      expect(mine.view.pending).toMatchObject({ kind: CK_SCIENCE_FRAME, responders: [host.playerId, after] });
      const hints = mine.view.hints?.modules as { citiesKnights?: { scienceBonus?: boolean } } | undefined;
      expect(hints?.citiesKnights?.scienceBonus).toBe(true);

      // 真人放棄（明確的 null），之後 Bot 才作答，frame 結束。
      const declined = host.expectOk<Receipt>(
        await host.post(`/api/games/${gameId}/commands`, {
          commandId: id('science'),
          expectedRevision: mine.revision,
          command: { type: 'science.take', resource: null },
        }),
      );
      expect(declined.outcome).toBe('accepted');
      await waitFor(async () => (await state(gameId, service)).pending === null, 'the bot to answer the scienceBonus frame');
      expect(eventPlayers(await state(gameId, service), 'ck.scienceBonusTaken')).toEqual([host.playerId, after]);

      // 回合繼續輪下去，直到輪到真人。
      await waitFor(async () => {
        const current = await state(gameId, service);
        return current.pending === null && actorOf(current) === host.playerId;
      }, 'the turn to reach the person');

      // progressDiscard：行動者是 across，turnOrder 為 across → before → 真人 → after；
      // 行動者不在名單內，三位 responder 各欠 1 張進步卡，順序是 Bot → 真人 → Bot。
      const discard = await openProgressDiscard(gameId, service, across, [before, host.playerId!, after]);
      service.bots.kick(gameId);
      await waitFor(async () => respondersOf(await state(gameId, service))?.[0] === host.playerId, 'the first bot to discard');
      const afterFirst = await state(gameId, service);
      expect(afterFirst.players.find((player) => player.id === before)!.progressCards).toHaveLength(4);
      const waiting = await revision(gameId, service);
      expect(waiting).toBeGreaterThan(discard);
      await sleep(300);
      expect(await revision(gameId, service)).toBe(waiting);
      expect(respondersOf(await state(gameId, service))).toEqual([host.playerId, after]);

      const own = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
      expect(own.view.pending).toMatchObject({
        kind: CK_PROGRESS_DISCARD_FRAME,
        responders: [host.playerId, after],
        data: { required: { [host.playerId!]: 1, [after]: 1 } },
      });
      const answer = host.expectOk<Receipt>(
        await host.post(`/api/games/${gameId}/commands`, {
          commandId: id('discard'),
          expectedRevision: own.revision,
          command: { type: 'progress.discard', cards: ['wedding'] },
        }),
      );
      expect(answer.outcome).toBe('accepted');

      await waitFor(async () => (await state(gameId, service)).pending === null, 'the last bot to discard');
      const game = await state(gameId, service);
      expect(eventPlayers(game, 'ck.progressDiscarded')).toEqual([before, host.playerId, after]);
      // 策略不會主動打牌，frame 一結束每位 responder 都剛好在上限；行動者沒有被要求棄牌。
      for (const playerId of [before, host.playerId!, after]) {
        expect(game.players.find((player) => player.id === playerId)!.progressCards, playerId).toHaveLength(4);
      }
      expect(game.players.find((player) => player.id === across)!.progressCards).toEqual([]);
      expect(game.players.find((player) => player.id === host.playerId)!.progressCards).not.toContain('wedding');
      await waitFor(async () => {
        const current = await state(gameId, service);
        return current.pending === null && actorOf(current) === host.playerId;
      }, 'the turn to reach the person again');
      expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
      expect(logs.entries.filter(isRetryWarn)).toEqual([]);
      expect(await rejectedBotReceipts(service, gameId)).toEqual([]);
    } finally {
      restorePolicy();
      logs.restore();
      await drop();
    }
  }, 40_000);

  // 4. defenderDraw 等待真人時重啟：frame 與 Bot 的後續作答都由已提交的狀態恢復。
  it('resumes a waiting defenderDraw frame after a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'catan-ck-bots-restart-'));
    const overrides = { port: 0, host: '127.0.0.1', sqlitePath: join(dir, 'ck.sqlite'), bots: { ...FAST_BOTS } };
    try {
      const first = await startService(overrides, () => undefined);
      const host = createClient(`http://127.0.0.1:${first.port}`);
      host.playerId = host.expectOk<{ player: { id: string } }>(
        await host.post('/api/session', { nickname: 'CkRestart', locale: 'en' }),
      ).player.id;
      const { roomId, gameId, botIds } = await ckGame(first, host, { bots: 2 });
      const drop = await liveSocket(first, roomId, host.playerId!);
      await finishSetup(host, gameId, first);
      // 擲骰者是真人前一座的 Bot；平手而依序抽牌的是真人與順序在後的另一個 Bot：Bot 在等真人。
      const seats = (await state(gameId, first)).players.map((player) => player.id);
      const hostSeat = seats.indexOf(host.playerId!);
      const roller = seats[(hostSeat + seats.length - 1) % seats.length]!;
      const botId = seats[(hostSeat + 1) % seats.length]!;
      expect(new Set([roller, botId])).toEqual(new Set(botIds));
      const opened = await openDefenderDraw(gameId, first, roller, [host.playerId!, botId]);
      first.bots.kick(gameId);
      await sleep(200);
      expect(await revision(gameId, first)).toBe(opened);
      await drop();
      const cookie = host.cookie;
      await first.close();
      expect(first.bots.stats()).toMatchObject({ games: 0, timers: 0, tasks: 0 });

      const second = await startService(overrides, () => undefined);
      try {
        const logs = captureLogs(driverDeps(second));
        // frame 與等待的順序原樣恢復。
        expect(await revision(gameId, second)).toBe(opened);
        expect((await state(gameId, second)).pending).toMatchObject({
          kind: CK_DEFENDER_FRAME,
          responders: [host.playerId, botId],
        });
        const again = createClient(`http://127.0.0.1:${second.port}`);
        again.cookie = cookie;
        again.playerId = host.playerId;
        const dropAgain = await liveSocket(second, roomId, host.playerId!);
        await sleep(200);
        // 輪到真人，Bot 不搶答，也不算卡住。
        expect(await revision(gameId, second)).toBe(opened);
        expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);

        const snapshot = again.expectOk<Snapshot>(await again.get(`/api/games/${gameId}`));
        expect(snapshot.revision).toBe(opened);
        // 真人的投影：自己是第一位 responder，可以從有牌的牌組中選。
        expect(snapshot.view.pending).toMatchObject({ kind: CK_DEFENDER_FRAME, responders: [host.playerId, botId] });
        const answer = again.expectOk<Receipt>(
          await again.post(`/api/games/${gameId}/commands`, {
            commandId: id('defender'),
            expectedRevision: snapshot.revision,
            command: { type: 'barbarians.chooseDeck', track: 'trade' },
          }),
        );
        expect(answer.outcome).toBe('accepted');

        // 重啟後的 Bot 接著抽牌，frame 結束，擲骰者繼續回合直到輪到真人。
        await waitFor(async () => (await state(gameId, second)).pending === null, 'the bot to draw after the restart');
        const game = await state(gameId, second);
        // 勝利點卡（Printer、Constitution）翻開時發的是 `ck.progressVictoryPoint`，其他牌是 `ck.progressDrawn`。
        const draws = game.log.filter(
          (event) => event.type === 'ck.progressDrawn' || event.type === 'ck.progressVictoryPoint',
        );
        expect(draws.map((event) => event.params.playerId)).toEqual([host.playerId, botId]);
        await waitFor(async () => actorOf(await state(gameId, second)) === host.playerId, 'the turn to reach the person');
        expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
        expect(await rejectedBotReceipts(second, gameId)).toEqual([]);
        await dropAgain();
      } finally {
        await second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
