/**
 * Heading for New Shores 的 Bot 席位（SF-4，策略 §4.7 第 5 點）。
 *
 * 四類案例，全都經過 HTTP 與真實的 BotDriver：
 * 1. 真人房主加上 Bot 的完整對局，跑到終局有勝者；
 * 2. 策略不作答的模組 frame（gold）由保底接手，送出合法的 `gold.choose`，BotDriver 不卡住；
 * 3. 多位 responder 的 gold frame 中真人與 Bot 並存：Bot 依序作答，輪到真人時等待，真人作答後繼續；
 * 4. gold frame 等待中重啟伺服器，恢復後 Bot 繼續作答，對局可以推進。
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GOLD_FRAME, RESOURCES, type GameState, type GameView } from '@catan/rules';
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

/** 建一間 Seafarers 房：真人房主加上 `bots` 個 Bot，全員就緒後開局。 */
async function seaGame(
  service: RunningService,
  host: TestClient,
  options: { bots: number; profileId?: string; capacity?: number },
): Promise<{ roomId: string; gameId: string; botIds: string[] }> {
  let room = host.expectOk<RoomShape>(
    await host.post('/api/rooms', {
      visibility: 'private',
      capacity: options.capacity ?? options.bots + 1,
      profileId: options.profileId ?? 'sf-new-shores-2025',
      // 5–6 人的 paired profile 只提供 variable 擺法。
      setupMode: options.profileId?.includes('paired') ? 'variable' : 'fixed',
    }),
  );
  for (let index = 0; index < options.bots; index++) {
    room = host.expectOk<RoomShape>(await host.post(`/api/rooms/${room.id}/bots`, {}));
  }
  host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
  const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
  expect((await state(gameId, service)).profileId).toBe(options.profileId ?? 'sf-new-shores-2025');
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

/** 把局面改成 `actor` 的行動階段，並開出一個 gold frame；`owed` 是每位 responder 欠的張數。 */
async function openGold(
  gameId: string,
  service: RunningService,
  actor: string,
  responders: string[],
  owed: number,
): Promise<number> {
  return rewrite(gameId, service, (game) => {
    game.turn.seat = game.players.findIndex((player) => player.id === actor);
    game.turn.phase = 'action';
    game.turn.setup = null;
    game.pending = {
      kind: GOLD_FRAME,
      module: 'seafarers',
      responders,
      data: { picks: Object.fromEntries(responders.map((playerId) => [playerId, owed])) },
    };
  });
}

/** gold frame 還在等的 responders；沒有待決效果時為 `undefined`。 */
function goldResponders(game: GameState): string[] | undefined {
  return (game.pending as { responders?: string[] } | null)?.responders;
}

/** 依序記下的 `gold.chosen` 事件：誰、拿了什麼。 */
function goldChoices(game: GameState): { playerId: string; resources: string[] }[] {
  return game.log
    .filter((event) => event.type === 'gold.chosen')
    .map((event) => ({ playerId: event.params.playerId as string, resources: event.params.resources as string[] }));
}

async function rejectedBotReceipts(service: RunningService, gameId: string): Promise<string[]> {
  const rows = await service.repo.db.all<{ error_json: string }>(
    `SELECT error_json FROM command_receipts WHERE game_id = ? AND outcome = 'rejected' AND command_id LIKE 'bot:%'`,
    [gameId],
  );
  return rows.map((row) => row.error_json).filter((error) => !error.includes('E_STALE_REVISION'));
}

/** 策略從不作答：所有欠的動作都得由保底接手。 */
const silentPolicy: BotPolicy = { decide: () => null };

describe('Heading for New Shores with bot seats', () => {
  // 1. 完整對局：真人座位也交給同一套策略，透過 HTTP 送指令；Bot 座位由排程器推進。
  const fullGames = [
    { profileId: 'sf-new-shores-2025', players: 3 },
    { profileId: 'sf-new-shores-2025', players: 4 },
    { profileId: 'sf-new-shores-paired-2025', players: 5 },
  ] as const;
  for (const { profileId, players } of fullGames) {
    it(`plays a whole ${players}-player ${profileId} game to a winner`, async () => {
      const logs = captureLogs(driverDeps(harness.service));
      let disconnect: (() => Promise<void>) | null = null;
      try {
        const host = await harness.client('SeaHost');
        const { roomId, gameId, botIds } = await seaGame(harness.service, host, { bots: players - 1, profileId });
        disconnect = await liveSocket(harness.service, roomId, host.playerId!);
        const policy = createBotPolicy('standard');
        const deadline = Date.now() + 100_000;
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
        // 每個 Bot 都真的蓋了東西，而不是只靠保底擲骰與結束回合。
        for (const botId of botIds) {
          const built = game.board.buildings.filter((building) => building?.player === botId).length;
          expect(built, botId).toBeGreaterThanOrEqual(2);
        }
        expect((await harness.service.repo.findRoom(roomId))?.status).toBe('completed');
        expect(await rejectedBotReceipts(harness.service, gameId)).toEqual([]);
      } finally {
        // 逾時或斷言失敗時也要還原 logger、放掉真人連線，避免汙染共用的 BotDriverDeps。
        logs.restore();
        await disconnect?.();
      }
    }, 130_000);
  }

  // 2. 保底接手模組 frame：策略不作答，gold frame 仍由保底送出合法指令。
  it('answers a gold frame through the fallback when the strategy stays silent', async () => {
    const service = harness.service;
    const deps = driverDeps(service);
    const original = deps.policyFor;
    const logs = captureLogs(deps);
    const host = await harness.client('GoldFallback');
    const { roomId, gameId, botIds } = await seaGame(service, host, { bots: 2 });
    const [botId] = botIds as [string, string];
    const drop = await liveSocket(service, roomId, host.playerId!);
    try {
      await finishSetup(host, gameId, service);
      deps.policyFor = () => silentPolicy;
      const opened = await openGold(gameId, service, botId, [botId], 2);
      service.bots.kick(gameId);
      await waitFor(async () => (await revision(gameId, service)) > opened, 'the fallback to answer the gold frame');

      const game = await state(gameId, service);
      // 保底依 RESOURCES 順序湊滿欠額，每種不超過銀行存量。
      expect(goldChoices(game)).toEqual([{ playerId: botId, resources: [RESOURCES[0], RESOURCES[0]] }]);
      expect(logs.entries.some((entry) => entry.message.startsWith('bot policy idle on a duty') && entry.meta.botId === botId && entry.meta.command === 'gold.choose')).toBe(true);
      const receipt = await service.repo.db.all<{ outcome: string }>(
        `SELECT outcome FROM command_receipts WHERE game_id = ? AND player_id = ? AND command_id = ?`,
        [gameId, botId, `bot:${opened}:0`],
      );
      expect(receipt.map((row) => row.outcome)).toEqual(['accepted']);

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

  // 3. 真人與 Bot 並存於同一個 gold frame：依序作答，輪到真人時 Bot 等待。
  it('lets bots answer a shared gold frame in turn around a person', async () => {
    const service = harness.service;
    const logs = captureLogs(driverDeps(service));
    const host = await harness.client('GoldShared');
    const { roomId, gameId, botIds } = await seaGame(service, host, { bots: 2 });
    const [first, last] = botIds as [string, string];
    const drop = await liveSocket(service, roomId, host.playerId!);
    try {
      await finishSetup(host, gameId, service);
      // 擲骰者是第一個 Bot，順序是 Bot → 真人 → 另一個 Bot。
      await openGold(gameId, service, first, [first, host.playerId!, last], 2);
      service.bots.kick(gameId);

      // 第一個 Bot 先答；輪到真人後 frame 停住。
      await waitFor(async () => goldResponders(await state(gameId, service))?.[0] === host.playerId, 'the first bot to answer');
      expect(goldChoices(await state(gameId, service)).map((choice) => choice.playerId)).toEqual([first]);
      const waiting = await revision(gameId, service);
      await sleep(300);
      expect(await revision(gameId, service)).toBe(waiting);
      expect(goldResponders(await state(gameId, service))).toEqual([host.playerId, last]);

      // 真人的投影：自己是第一位 responder，欠 2 張。
      const mine = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
      expect(mine.view.pending).toMatchObject({ kind: GOLD_FRAME, responders: [host.playerId, last] });
      const hints = mine.view.hints?.modules as { seafarers?: { goldRequired?: number } } | undefined;
      expect(hints?.seafarers?.goldRequired).toBe(2);

      const answer = host.expectOk<Receipt>(
        await host.post(`/api/games/${gameId}/commands`, {
          commandId: id('gold'),
          expectedRevision: mine.revision,
          command: { type: 'gold.choose', resources: ['ore', 'ore'] },
        }),
      );
      expect(answer.outcome).toBe('accepted');

      // 真人之後輪到最後一個 Bot；frame 結束，回合繼續到再次輪到真人。
      await waitFor(async () => (await state(gameId, service)).pending === null, 'the last bot to answer');
      const game = await state(gameId, service);
      expect(goldChoices(game).map((choice) => choice.playerId)).toEqual([first, host.playerId, last]);
      expect(goldChoices(game)[1]!.resources).toEqual(['ore', 'ore']);
      for (const choice of goldChoices(game)) expect(choice.resources).toHaveLength(2);
      await waitFor(async () => {
        const current = await state(gameId, service);
        return current.pending === null && actorOf(current) === host.playerId;
      }, 'the turn to reach the person');
      expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
      expect(await rejectedBotReceipts(service, gameId)).toEqual([]);
    } finally {
      logs.restore();
      await drop();
    }
  }, 30_000);

  // 4. gold frame 等待真人時重啟：frame 與 Bot 的後續作答都由已提交的狀態恢復。
  it('resumes a waiting gold frame after a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'catan-sea-bots-restart-'));
    const overrides = { port: 0, host: '127.0.0.1', sqlitePath: join(dir, 'sea.sqlite'), bots: { ...FAST_BOTS } };
    try {
      const first = await startService(overrides, () => undefined);
      const host = createClient(`http://127.0.0.1:${first.port}`);
      host.playerId = host.expectOk<{ player: { id: string } }>(
        await host.post('/api/session', { nickname: 'SeaRestart', locale: 'en' }),
      ).player.id;
      const { roomId, gameId, botIds } = await seaGame(first, host, { bots: 2 });
      const drop = await liveSocket(first, roomId, host.playerId!);
      await finishSetup(host, gameId, first);
      // 擲骰者是真人前一座的 Bot，欠 gold 的是順序在後的真人與另一個 Bot：Bot 在等真人。
      const seats = (await state(gameId, first)).players.map((player) => player.id);
      const hostSeat = seats.indexOf(host.playerId!);
      const roller = seats[(hostSeat + seats.length - 1) % seats.length]!;
      const botId = seats[(hostSeat + 1) % seats.length]!;
      expect(new Set([roller, botId])).toEqual(new Set(botIds));
      const opened = await openGold(gameId, first, roller, [host.playerId!, botId], 1);
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
        expect((await state(gameId, second)).pending).toMatchObject({ kind: GOLD_FRAME, responders: [host.playerId, botId] });
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
        const answer = again.expectOk<Receipt>(
          await again.post(`/api/games/${gameId}/commands`, {
            commandId: id('gold'),
            expectedRevision: snapshot.revision,
            command: { type: 'gold.choose', resources: ['grain'] },
          }),
        );
        expect(answer.outcome).toBe('accepted');

        // 重啟後的 Bot 接著作答，frame 結束，擲骰者繼續回合直到輪到真人。
        await waitFor(async () => (await state(gameId, second)).pending === null, 'the bot to answer after the restart');
        expect(goldChoices(await state(gameId, second)).map((choice) => choice.playerId)).toEqual([host.playerId, botId]);
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
