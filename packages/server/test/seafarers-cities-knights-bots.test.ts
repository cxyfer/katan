/**
 * Seafarers + Cities & Knights 的 Bot 席位（SFCK-G，SF+CK 計畫 §5；結構比照 `seafarers-bots.test.ts` 與
 * `cities-knights-bots.test.ts`）。兩個 profile 都涵蓋：3–4 人的 `sf-ck-new-shores-2025`、5–6 人的
 * `sf-ck-new-shores-paired-2025`。
 *
 * 四類案例（策略 §4.7-5），全都經過 HTTP 與真實的 BotDriver：
 * 1. 真人房主加上 Bot 的完整對局（3 人、5 人），跑到終局有勝者，沒有非 stale 的拒絕；
 * 2. 策略拋錯或不作答時由保底代答，第一次嘗試就被接受、不必等重試：C&K 的 `pillage`、SF 的 `gold`，
 *    以及組合特有的情境（首攻之後強盜與海盜都在場，7 點的 `moveRobber`）；
 * 3. 多位 responder 的 frame 中真人與 Bot 並存：C&K 的 `scienceBonus`（Bot 等真人）、`progressDiscard`
 *    （Bot → 真人 → Bot）與 SF 的 `gold`（Bot → 真人 → Bot）；
 * 4. frame 等待真人時重啟伺服器：3–4 人的 `defenderDraw`（C&K）、5–6 人的 `gold`（SF）由已提交的狀態恢復。
 *
 * 另外確認 hard 被拒：組合的房間只提供 easy 與 standard。
 *
 * 注入的 pending 形狀照 rules 的實際建立處，`responders` 的成員與順序照 `turnOrder`；周邊狀態只補到
 * Bot 作答所需，細節見各 `open*`。
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
  GOLD_FRAME,
  RESOURCES,
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

type SfckProfileId = 'sf-ck-new-shores-2025' | 'sf-ck-new-shores-paired-2025';
const PROFILE_ID: SfckProfileId = 'sf-ck-new-shores-2025';
const PAIRED_PROFILE_ID: SfckProfileId = 'sf-ck-new-shores-paired-2025';

/** 兩個 profile 各自「一位真人加上 N 個 Bot」的最小桌（paired 至少 5 人）。 */
const TABLES = [
  { profileId: PROFILE_ID, bots: 2 },
  { profileId: PAIRED_PROFILE_ID, bots: 4 },
] as const;

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

/** 建一間 SF+CK 房：真人房主加上 `bots` 個 Bot，全員就緒後開局。 */
async function sfckGame(
  service: RunningService,
  host: TestClient,
  options: { bots: number; profileId?: SfckProfileId },
): Promise<{ roomId: string; gameId: string; botIds: string[] }> {
  const profileId = options.profileId ?? PROFILE_ID;
  let room = host.expectOk<RoomShape>(
    await host.post('/api/rooms', {
      visibility: 'private',
      capacity: options.bots + 1,
      profileId,
      // 5–6 人的 paired profile 只提供 variable 擺法。
      setupMode: profileId === PAIRED_PROFILE_ID ? 'variable' : 'fixed',
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

/**
 * 等到輪到真人且沒有待決效果。測試裡的真人不會自己行動，手牌隨產出累積；其間任何 Bot 擲出 7 時，
 * 手牌超過 7 張的真人得棄牌，否則整桌會停在 `discard`。這裡代替真人用保底棄牌，之後繼續等。
 */
async function waitForPerson(
  host: TestClient,
  gameId: string,
  service: RunningService,
  label: string,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const game = await state(gameId, service);
    if (game.pending === null && actorOf(game) === host.playerId) return;
    const pending = game.pending as { kind: string; required?: Record<string, number>; submitted?: Record<string, unknown> } | null;
    if (pending?.kind === 'discard' && pending.required?.[host.playerId!] && !(host.playerId! in (pending.submitted ?? {}))) {
      const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
      const command = fallbackPolicy.decide(snapshot.view, { selfId: host.playerId!, level: 'standard', seed: 1, offerPhases: {} });
      if (command) {
        const receipt = host.expectOk<Receipt>(
          await host.post(`/api/games/${gameId}/commands`, { commandId: id('discard'), expectedRevision: snapshot.revision, command }),
        );
        // 與 Bot 同時送出時可能落後一個 revision；下一圈重試。
        if (receipt.outcome === 'rejected') expect(receipt.error?.messageId).toBe('error.E_STALE_REVISION');
      }
    } else {
      await sleep(15);
    }
  }
  throw new Error(`timed out waiting for ${label}`);
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

/** 依序記下的 `gold.chosen` 事件：誰、拿了什麼。 */
function goldChoices(game: GameState): { playerId: string; resources: string[] }[] {
  return game.log
    .filter((event) => event.type === 'gold.chosen')
    .map((event) => ({ playerId: event.params.playerId as string, resources: event.params.resources as string[] }));
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

/** `playerId` 在 `command_id = bot:<revision>:0` 的第一次嘗試收據。 */
async function firstAttemptOutcomes(
  service: RunningService,
  gameId: string,
  playerId: string,
  opened: number,
): Promise<string[]> {
  const rows = await service.repo.db.all<{ outcome: string }>(
    `SELECT outcome FROM command_receipts WHERE game_id = ? AND player_id = ? AND command_id = ?`,
    [gameId, playerId, `bot:${opened}:0`],
  );
  return rows.map((row) => row.outcome);
}

/** 策略一呼叫就拋錯：所有欠的動作都得由保底接手。 */
const throwingPolicy: BotPolicy = {
  decide() {
    throw new Error('strategy exploded');
  },
};

/** 策略從不作答：所有欠的動作都得由保底接手。 */
const silentPolicy: BotPolicy = { decide: () => null };

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
 * 開出 `citiesKnights.pillage`：`actor` 回合的行動階段，`bot` 的建築都是城市（真實的 frame 只在
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
    // 不提高 responders 的科學等級：真實的 scienceBonus 只列入科學 3 級以上的玩家，但升到 3 級後
    // 之後每次擲骰都會再開出 frame，等不會作答的測試真人。Bot 只看 hints 與 responders，不受影響。
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

/** 開出 `seafarers.gold`：`owed` 是每位 responder 欠的張數。 */
async function openGold(
  gameId: string,
  service: RunningService,
  actor: string,
  responders: string[],
  owed: number,
): Promise<number> {
  return rewrite(gameId, service, (game) => {
    actionPhase(game, actor);
    game.pending = {
      kind: GOLD_FRAME,
      module: 'seafarers',
      responders,
      data: { picks: Object.fromEntries(responders.map((playerId) => [playerId, owed])) },
    };
  });
}

/**
 * 組合特有的 base frame：首攻之後強盜與海盜都在場（強盜在陸地、海盜在海上），`actor` 擲出 7，
 * 要移動盜賊。首攻前強盜在板外、海盜不在場，不會有這個局面；`attacks` 由 C&K 的模組狀態決定。
 */
async function openSevenMove(gameId: string, service: RunningService, actor: string): Promise<number> {
  return rewrite(gameId, service, (game) => {
    actionPhase(game, actor);
    const terrain = game.board.layout.terrain;
    game.board.robber = terrain.findIndex((kind) => kind !== 'sea' && kind !== 'desert');
    game.board.pirate = terrain.findIndex((kind) => kind === 'sea');
    (game.moduleState!.citiesKnights as { attacks: number }).attacks = 1;
    game.pending = { kind: 'moveRobber', actor, cause: 'seven', pirate: false };
  });
}

describe('Seafarers + Cities & Knights with bot seats', () => {
  // 1. 完整對局：真人座位也交給同一套策略，透過 HTTP 送指令；Bot 座位由排程器推進。
  const fullGames = [
    { profileId: PROFILE_ID, players: 3 },
    { profileId: PAIRED_PROFILE_ID, players: 5 },
  ] as const;
  for (const { profileId, players } of fullGames) {
    it(`plays a whole ${players}-player ${profileId} game to a winner`, async () => {
      const logs = captureLogs(driverDeps(harness.service));
      let disconnect: (() => Promise<void>) | null = null;
      try {
        const host = await harness.client('SfCkHost');
        const { roomId, gameId, botIds } = await sfckGame(harness.service, host, { bots: players - 1, profileId });
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
        // Bot 真的玩了 SF+CK：造過船、招募過騎士或改良過城市（setup 本來就給每人建築，
        // 建築數不能當證據）；事件從資料庫讀完整的歷史。
        const events = await allEvents(harness.service, gameId);
        const botActions = events.filter(
          (event) =>
            (event.type === 'ship.built' || event.type === 'ck.knightRecruited' || event.type === 'ck.cityImproved') &&
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

  // 2. 保底接手：策略拋錯或不作答，模組 frame 仍由保底送出合法指令，第一次嘗試就被接受。
  for (const { profileId, bots } of TABLES) {
    it(`answers a pillage frame through the fallback in ${profileId} when the strategy throws`, async () => {
      const service = harness.service;
      const deps = driverDeps(service);
      const original = deps.policyFor;
      const logs = captureLogs(deps);
      const host = await harness.client('PillageFallback');
      const { roomId, gameId, botIds } = await sfckGame(service, host, { bots, profileId });
      const [botId, other] = botIds as [string, string, ...string[]];
      const drop = await liveSocket(service, roomId, host.playerId!);
      try {
        await finishSetup(host, gameId, service);
        deps.policyFor = () => throwingPolicy;
        const opened = await openPillage(gameId, service, other, botId);
        const citiesBefore = (await state(gameId, service)).board.buildings.filter(
          (building) => building?.player === botId && building.city,
        ).length;
        expect(citiesBefore).toBeGreaterThanOrEqual(2);
        service.bots.kick(gameId);
        await waitFor(async () => (await revision(gameId, service)) > opened, 'the fallback to answer the pillage frame');

        const game = await state(gameId, service);
        expect(eventPlayers(game, 'ck.cityPillaged')).toEqual([botId]);
        expect(game.board.buildings.filter((building) => building?.player === botId && building.city)).toHaveLength(
          citiesBefore - 1,
        );
        expect(
          logs.entries.some(
            (entry) => entry.level === 'warn' && entry.message === 'bot policy threw; using fallback' && entry.meta.botId === botId,
          ),
        ).toBe(true);
        expect(await firstAttemptOutcomes(service, gameId, botId, opened)).toEqual(['accepted']);
        expect(logs.entries.filter(isRetryWarn)).toEqual([]);

        // frame 結束後 BotDriver 沒有卡住：回合繼續輪下去，直到輪到真人。
        await waitForPerson(host, gameId, service, 'the turn to reach the person');
        expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
        expect(await rejectedBotReceipts(service, gameId)).toEqual([]);
      } finally {
        deps.policyFor = original;
        logs.restore();
        await drop();
      }
    }, 30_000);

    it(`answers a gold frame through the fallback in ${profileId} when the strategy stays silent`, async () => {
      const service = harness.service;
      const deps = driverDeps(service);
      const original = deps.policyFor;
      const logs = captureLogs(deps);
      const host = await harness.client('GoldFallback');
      const { roomId, gameId, botIds } = await sfckGame(service, host, { bots, profileId });
      const [botId] = botIds as [string, ...string[]];
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
        expect(
          logs.entries.some(
            (entry) =>
              entry.message.startsWith('bot policy idle on a duty') && entry.meta.botId === botId && entry.meta.command === 'gold.choose',
          ),
        ).toBe(true);
        expect(await firstAttemptOutcomes(service, gameId, botId, opened)).toEqual(['accepted']);
        expect(logs.entries.filter(isRetryWarn)).toEqual([]);

        await waitForPerson(host, gameId, service, 'the turn to reach the person');
        expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
        expect(await rejectedBotReceipts(service, gameId)).toEqual([]);
      } finally {
        deps.policyFor = original;
        logs.restore();
        await drop();
      }
    }, 30_000);

    // 組合特有：首攻之後強盜與海盜都在場，保底要在合併後的合法集合中選一個盜賊目標（再偷牌）。
    it(`moves a bandit through the fallback in ${profileId} once the robber and the pirate are in play`, async () => {
      const service = harness.service;
      const deps = driverDeps(service);
      const original = deps.policyFor;
      const logs = captureLogs(deps);
      const host = await harness.client('BanditFallback');
      const { roomId, gameId, botIds } = await sfckGame(service, host, { bots, profileId });
      const [botId] = botIds as [string, ...string[]];
      const drop = await liveSocket(service, roomId, host.playerId!);
      try {
        await finishSetup(host, gameId, service);
        deps.policyFor = () => throwingPolicy;
        const opened = await openSevenMove(gameId, service, botId);
        const before = await state(gameId, service);
        const baseline = (await allEvents(service, gameId)).at(-1)?.seq ?? 0;
        service.bots.kick(gameId);
        await waitFor(async () => (await revision(gameId, service)) > opened, 'the fallback to move a bandit');

        // 第一次嘗試就被接受，沒有被拒絕、也不必等重試。
        expect(await firstAttemptOutcomes(service, gameId, botId, opened)).toEqual(['accepted']);
        await waitForPerson(host, gameId, service, 'the turn to reach the person');
        // 注入之後的第一個盜賊事件就是這次的保底：移動強盜或海盜其中一個，而且離開原本的格子。
        // 之後輪到的其他 Bot 擲出 7 時也會移動盜賊，所以只看第一個。
        const [move] = (await allEvents(service, gameId)).filter(
          (event) => event.seq > baseline && (event.type === 'robber.moved' || event.type === 'pirate.moved'),
        );
        expect(move?.params.playerId).toBe(botId);
        expect(move?.params.cause).toBe('seven');
        expect(move?.params.hex).not.toBe(move?.type === 'robber.moved' ? before.board.robber : before.board.pirate);
        expect((await state(gameId, service)).pending).toBeNull();
        expect(logs.entries.filter(isRetryWarn)).toEqual([]);
        expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
        expect(await rejectedBotReceipts(service, gameId)).toEqual([]);
      } finally {
        deps.policyFor = original;
        logs.restore();
        await drop();
      }
    }, 30_000);
  }

  // 3. 真人與 Bot 並存（真人加 3 個 Bot；paired 加 4 個）。responders 的成員與順序照 rules 建立 frame 的方式：
  //    - scienceBonus 依 `turnOrder`（從擲骰者起算），rules 也要求依序作答：真人排在 Bot 前面，Bot 不搶答；
  //    - progressDiscard 排除行動者（`overLimitOffTurn`），依 `turnOrder` 為 Bot → 真人 → Bot。rules 允許
  //      任何 responder 作答，等真人是 Bot 自己的做法：只有在 `responders[0]` 時才作答；
  //    - gold 依序作答：Bot → 真人 → Bot，輪到真人時 Bot 等待。
  //    座位以真人為 0 順時針編號：`before` 是真人前一座、`after` 是後一座、`across` 是再後一座
  //    （4 人桌在對面；5 人桌在 `after` 之後），三者在 `turnOrder` 中的相對順序都是 across → before → 真人 → after。
  const sharedTables = [
    { profileId: PROFILE_ID, bots: 3 },
    { profileId: PAIRED_PROFILE_ID, bots: 4 },
  ] as const;
  for (const { profileId, bots } of sharedTables) {
    it(`lets bots wait for a person in scienceBonus and answer around one in progressDiscard in ${profileId}`, async () => {
      const service = harness.service;
      const deps = driverDeps(service);
      const logs = captureLogs(deps);
      // 策略只作答 frame，沒有待決效果時由保底行動：C&K 的 standard 會主動打出進步卡，
      // 可能開出需要真人作答的 frame，測試裡的真人不會答，整局就卡住。
      const restorePolicy = frameOnlyPolicies(deps);
      let opened: { host: TestClient; gameId: string; drop: () => Promise<void> };
      try {
        const client = await harness.client('SfCkShared');
        const created = await sfckGame(service, client, { bots, profileId });
        opened = { host: client, gameId: created.gameId, drop: await liveSocket(service, created.roomId, client.playerId!) };
      } catch (error) {
        // 建局失敗時也要還原共用 BotDriverDeps 上的策略與 logger。
        restorePolicy();
        logs.restore();
        throw error;
      }
      const { host, gameId, drop } = opened;
      try {
        await finishSetup(host, gameId, service);
        const seats = (await state(gameId, service)).players.map((player) => player.id);
        const at = (offset: number): string => seats[(seats.indexOf(host.playerId!) + offset) % seats.length]!;
        const after = at(1);
        const across = at(2);
        const before = at(seats.length - 1);

        // scienceBonus：擲骰者是 before，turnOrder 為 before → 真人 → after → …；
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
        await waitForPerson(host, gameId, service, 'the turn to reach the person');

        // progressDiscard：行動者是 across，三位 responder 各欠 1 張進步卡，順序是 Bot → 真人 → Bot。
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
        await waitForPerson(host, gameId, service, 'the turn to reach the person again');
        expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
        expect(logs.entries.filter(isRetryWarn)).toEqual([]);
        expect(await rejectedBotReceipts(service, gameId)).toEqual([]);
      } finally {
        restorePolicy();
        logs.restore();
        await drop();
      }
    }, 40_000);

    it(`lets bots answer a shared gold frame in turn around a person in ${profileId}`, async () => {
      const service = harness.service;
      const deps = driverDeps(service);
      const logs = captureLogs(deps);
      const restorePolicy = frameOnlyPolicies(deps);
      let opened: { host: TestClient; gameId: string; drop: () => Promise<void> };
      try {
        const client = await harness.client('SfCkGold');
        const created = await sfckGame(service, client, { bots, profileId });
        opened = { host: client, gameId: created.gameId, drop: await liveSocket(service, created.roomId, client.playerId!) };
      } catch (error) {
        restorePolicy();
        logs.restore();
        throw error;
      }
      const { host, gameId, drop } = opened;
      try {
        await finishSetup(host, gameId, service);
        const seats = (await state(gameId, service)).players.map((player) => player.id);
        const hostSeat = seats.indexOf(host.playerId!);
        const first = seats[(hostSeat + seats.length - 1) % seats.length]!;
        const last = seats[(hostSeat + 1) % seats.length]!;
        // 擲骰者是真人前一座的 Bot，順序是 Bot → 真人 → 另一個 Bot。
        await openGold(gameId, service, first, [first, host.playerId!, last], 2);
        service.bots.kick(gameId);

        // 第一個 Bot 先答；輪到真人後 frame 停住。
        await waitFor(async () => respondersOf(await state(gameId, service))?.[0] === host.playerId, 'the first bot to answer');
        expect(goldChoices(await state(gameId, service)).map((choice) => choice.playerId)).toEqual([first]);
        const waiting = await revision(gameId, service);
        await sleep(300);
        expect(await revision(gameId, service)).toBe(waiting);
        expect(respondersOf(await state(gameId, service))).toEqual([host.playerId, last]);

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
        await waitForPerson(host, gameId, service, 'the turn to reach the person');
        expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
        expect(logs.entries.filter(isRetryWarn)).toEqual([]);
        expect(await rejectedBotReceipts(service, gameId)).toEqual([]);
      } finally {
        restorePolicy();
        logs.restore();
        await drop();
      }
    }, 40_000);
  }

  // 4. frame 等待真人時重啟：frame 與 Bot 的後續作答都由已提交的狀態恢復。
  //    3–4 人桌用 C&K 的 defenderDraw，5–6 人桌用 SF 的 gold：兩個 profile、兩個部件模組各驗一次。
  const restartFrames = {
    defenderDraw: {
      kind: CK_DEFENDER_FRAME,
      open: (gameId: string, service: RunningService, roller: string, responders: string[]) =>
        openDefenderDraw(gameId, service, roller, responders),
      command: { type: 'barbarians.chooseDeck', track: 'trade' } as BotCommand,
      // 勝利點卡（Printer、Constitution）翻開時發的是 `ck.progressVictoryPoint`，其他牌是 `ck.progressDrawn`。
      answered: (game: GameState) =>
        game.log
          .filter((event) => event.type === 'ck.progressDrawn' || event.type === 'ck.progressVictoryPoint')
          .map((event) => event.params.playerId as string),
    },
    gold: {
      kind: GOLD_FRAME,
      open: (gameId: string, service: RunningService, roller: string, responders: string[]) =>
        openGold(gameId, service, roller, responders, 1),
      command: { type: 'gold.choose', resources: ['grain'] } as BotCommand,
      answered: (game: GameState) => goldChoices(game).map((choice) => choice.playerId),
    },
  } as const;
  const restartCases = [
    { profileId: PROFILE_ID, bots: 2, frame: 'defenderDraw' },
    { profileId: PAIRED_PROFILE_ID, bots: 4, frame: 'gold' },
  ] as const;
  for (const { profileId, bots, frame } of restartCases) {
    it(`resumes a waiting ${frame} frame in ${profileId} after a restart`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'catan-sfck-bots-restart-'));
      const overrides = { port: 0, host: '127.0.0.1', sqlitePath: join(dir, 'sfck.sqlite'), bots: { ...FAST_BOTS } };
      const scenario = restartFrames[frame];
      try {
        const first = await startService(overrides, () => undefined);
        const host = createClient(`http://127.0.0.1:${first.port}`);
        host.playerId = host.expectOk<{ player: { id: string } }>(
          await host.post('/api/session', { nickname: 'SfCkRestart', locale: 'en' }),
        ).player.id;
        const { roomId, gameId, botIds } = await sfckGame(first, host, { bots, profileId });
        const drop = await liveSocket(first, roomId, host.playerId!);
        await finishSetup(host, gameId, first);
        // 擲骰者是真人前一座的 Bot；等待的是真人與順序在後的另一個 Bot：Bot 在等真人。
        const seats = (await state(gameId, first)).players.map((player) => player.id);
        const hostSeat = seats.indexOf(host.playerId!);
        const roller = seats[(hostSeat + seats.length - 1) % seats.length]!;
        const botId = seats[(hostSeat + 1) % seats.length]!;
        expect(botIds).toEqual(expect.arrayContaining([roller, botId]));
        const opened = await scenario.open(gameId, first, roller, [host.playerId!, botId]);
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
            kind: scenario.kind,
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
          // 真人的投影：自己是第一位 responder。
          expect(snapshot.view.pending).toMatchObject({ kind: scenario.kind, responders: [host.playerId, botId] });
          const answer = again.expectOk<Receipt>(
            await again.post(`/api/games/${gameId}/commands`, {
              commandId: id(frame),
              expectedRevision: snapshot.revision,
              command: scenario.command,
            }),
          );
          expect(answer.outcome).toBe('accepted');

          // 重啟後的 Bot 接著作答，frame 結束，擲骰者繼續回合直到輪到真人。
          await waitFor(async () => (await state(gameId, second)).pending === null, 'the bot to answer after the restart');
          expect(scenario.answered(await state(gameId, second))).toEqual([host.playerId, botId]);
          await waitForPerson(again, gameId, second, 'the turn to reach the person');
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
  }

  // hard 只有基本版：兩個組合 profile 都只提供 easy 與 standard，要 hard 會被拒。
  for (const { profileId } of TABLES) {
    it(`refuses a hard bot in ${profileId}`, async () => {
      const host = await harness.client('SfCkHard');
      const room = host.expectOk<RoomShape>(
        await host.post('/api/rooms', {
          visibility: 'private',
          capacity: profileId === PAIRED_PROFILE_ID ? 5 : 3,
          profileId,
          setupMode: profileId === PAIRED_PROFILE_ID ? 'variable' : 'fixed',
        }),
      );
      const profiles = host.expectOk<{ profiles: { id: string; botLevels: string[] }[] }>(await host.get('/api/profiles')).profiles;
      expect(profiles.find((profile) => profile.id === profileId)?.botLevels).toEqual(['easy', 'standard']);
      const refused = await host.post(`/api/rooms/${room.id}/bots`, { level: 'hard' });
      host.expectError(refused, 'E_INVALID_BOT');
      expect(refused.body.ok ? null : refused.body.error.params).toMatchObject({ reason: 'profileLevel', level: 'hard' });
      for (const level of ['easy', 'standard']) {
        const seated = host.expectOk<RoomShape>(await host.post(`/api/rooms/${room.id}/bots`, { level }));
        expect(seated.members.filter((member) => member.bot)).toHaveLength(level === 'easy' ? 1 : 2);
      }
    });
  }
});
