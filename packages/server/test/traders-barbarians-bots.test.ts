/**
 * Traders & Barbarians 的 Bot 席位（T&B 計畫 §6.5，S9；結構比照 `seafarers-cities-knights-bots.test.ts`）。
 *
 * 四類案例，全都經過 HTTP 與真實的 BotDriver：
 * 1. 真人房主加上 Bot 的完整對局：'tb-merchant-trains-2025'（3 人），跑到終局有勝者、沒有非 stale 的拒絕；這一局同時
 *    涵蓋回合結束時排入的投票 frame（`onEndTurn` defer）與依序作答的多 responder frame（`wagonBid`）。
 * 2. 保底接手：'tb-traders-barbarians-2025' 的 `tbWagon` frame 中，策略送出不合法的 `tb.wagonStep`，被拒後同一個
 *    revision 改由保底送 `tb.wagonStop`，對局繼續。
 * 3. 真人與 Bot 同桌處理 Trains 的投票：`wagonBid`（依序）與 `wagonAssign`（同時），真人在前、Bot 在前兩種順序。
 *    Bot 只在輪到自己時出價，分配則不必等真人；Bot 都不會擋住真人。
 * 4. Traders 車隊移動到一半（`tbWagon` frame 進行中）重啟伺服器，Bot 恢復後完成移動，回合繼續。
 *
 * 另外確認 hard 被拒：T&B 的房間只提供 easy 與 standard。
 *
 * 注入的 pending 形狀照 rules 的實際建立處（`trains/index.ts` 的 `voteFrame`、`traders/index.ts` 的 `onEndTurn`），
 * `responders` 的成員與順序照 rules：出價從行動者起依座位順序，分配是出價大於 0 的玩家。
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actionHints,
  TB_FRAME_KINDS,
  TRADERS_BARBARIANS,
  type GameEvent,
  type GameState,
  type GameView,
} from '@katan/rules';
import { createBotPolicy, fallbackPolicy, type BotCommand, type BotPolicy } from '@katan/bots';
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

const TRAINS_PROFILE = 'tb-merchant-trains-2025';
const TRADERS_PROFILE = 'tb-traders-barbarians-2025';
const TB_PROFILES = [
  'tb-friendly-robber-2025',
  'tb-harbors-2025',
  'tb-friendly-robber-harbors-2025',
  'tb-fishing-2025',
  'tb-rivers-2025',
  'tb-merchant-trains-2025',
  'tb-barbarian-attack-2025',
  'tb-traders-barbarians-2025',
] as const;

/** part 狀態的鍵（rules 的 part id）。 */
const TRAINS_PART = 'tb-merchant-trains';
const TRADERS_PART = 'tb-traders-barbarians';

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

/** rules 的投票資料（`trains/index.ts` 的 `VoteData`）。 */
interface VoteData {
  bids: Record<string, { wool: number; grain: number }>;
  assignments: Record<string, number>;
  active: string;
}

/** 車隊（`traders/index.ts` 的 `Wagon`）與移動 frame 的資料（`MoveData`）。 */
interface TradersWagon {
  vertex: number;
  level: number;
}
interface MoveData {
  mp: number;
  boosted: boolean;
  extra: number;
  drivenOff: number[];
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

function partOf<T>(game: GameState, part: string): T {
  return (game.moduleState![TRADERS_BARBARIANS] as Record<string, unknown>)[part] as T;
}

/** 直接改寫快照（比照 bots.test.ts），用來建立特定局面。 */
async function rewrite(gameId: string, service: RunningService, edit: (game: GameState) => void): Promise<number> {
  const row = await service.repo.findGame(gameId);
  const game = JSON.parse(row!.state_json) as GameState;
  edit(game);
  await service.repo.saveGame(gameId, game, row!.revision + 1, 'playing', null);
  return row!.revision + 1;
}

/** 建一間 T&B 房：真人房主加上 Bot（依 `levels` 的難度），全員就緒後開局。T&B 劇本只提供 variable 擺法。 */
async function tbGame(
  service: RunningService,
  host: TestClient,
  options: { profileId: string; levels: readonly ('easy' | 'standard')[] },
): Promise<{ roomId: string; gameId: string; botIds: string[] }> {
  let room = host.expectOk<RoomShape>(
    await host.post('/api/rooms', {
      visibility: 'private',
      capacity: options.levels.length + 1,
      profileId: options.profileId,
      setupMode: 'variable',
    }),
  );
  for (const level of options.levels) {
    room = host.expectOk<RoomShape>(await host.post(`/api/rooms/${room.id}/bots`, { level }));
  }
  host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
  const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
  expect((await state(gameId, service)).profileId).toBe(options.profileId);
  return { roomId: room.id, gameId, botIds: room.members.filter((member) => member.bot).map((member) => member.playerId) };
}

/** 以真人身分送一個指令；與 Bot 同時送出時可能落後一個 revision，其他拒絕都代表有誤。 */
async function humanSubmit(client: TestClient, gameId: string, snapshot: Snapshot, command: BotCommand): Promise<boolean> {
  const receipt = client.expectOk<Receipt>(
    await client.post(`/api/games/${gameId}/commands`, {
      commandId: id('human'),
      expectedRevision: snapshot.revision,
      command,
    }),
  );
  if (receipt.outcome === 'rejected') expect(receipt.error?.messageId).toBe('error.E_STALE_REVISION');
  return receipt.outcome === 'accepted';
}

/** 真人座位用保底策略走一步；回傳送出的指令（沒有動作時為 null）。 */
async function humanFallbackStep(client: TestClient, gameId: string): Promise<BotCommand | null> {
  const snapshot = client.expectOk<Snapshot>(await client.get(`/api/games/${gameId}`));
  const command = fallbackPolicy.decide(snapshot.view, { selfId: client.playerId!, level: 'standard', seed: 1, offerPhases: {} });
  if (!command) return null;
  return (await humanSubmit(client, gameId, snapshot, command)) ? command : null;
}

/** 走完 setup：輪到真人時以保底放置，Bot 的席位由排程器推進（需要真人在線）。 */
async function finishSetup(client: TestClient, gameId: string, service: RunningService): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const game = await state(gameId, service);
    if (game.turn.phase !== 'setup') return;
    if (actorOf(game) === client.playerId) await humanFallbackStep(client, gameId);
    else await sleep(10);
  }
  throw new Error('setup did not finish');
}

/**
 * 等到 `check` 成立。測試裡的真人不會自己行動；其間若有待決效果欠真人的動作（Bot 擲出 7 時的棄牌、Bot 回合結束時
 * 的車廂投票），這裡代替真人用保底作答，之後繼續等。
 */
async function serveUntil(
  host: TestClient,
  gameId: string,
  service: RunningService,
  check: (game: GameState) => Promise<boolean> | boolean,
  label: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const game = await state(gameId, service);
    if (await check(game)) return;
    if (game.pending === null || !(await humanFallbackStep(host, gameId))) await sleep(15);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** 等到輪到真人且沒有待決效果（欠真人的動作由保底代答）。 */
async function waitForPerson(host: TestClient, gameId: string, service: RunningService, label: string): Promise<void> {
  await serveUntil(host, gameId, service, (game) => game.pending === null && actorOf(game) === host.playerId, label);
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

/** 整局已提交的事件（`state.log` 只留最後 200 筆，完整對局要從資料庫讀）。 */
async function allEvents(service: RunningService, gameId: string): Promise<GameEvent[]> {
  const events: GameEvent[] = [];
  for (;;) {
    const page = await service.repo.listEvents(gameId, events[events.length - 1]?.seq ?? 0, 500);
    if (page.length === 0) return events;
    events.push(...page);
  }
}

/** `after` 之後、`type` 事件的 `params.playerId`，依序。 */
async function eventPlayersSince(service: RunningService, gameId: string, after: number, type: string): Promise<string[]> {
  return (await allEvents(service, gameId))
    .filter((event) => event.seq > after && event.type === type)
    .map((event) => event.params.playerId as string);
}

/** `after` 之後到第一個 `until` 事件（含）為止的事件；還沒出現時為 null。之後的回合不算進來。 */
async function eventsUntil(service: RunningService, gameId: string, after: number, until: string): Promise<GameEvent[] | null> {
  const events = (await allEvents(service, gameId)).filter((event) => event.seq > after);
  const end = events.findIndex((event) => event.type === until);
  return end < 0 ? null : events.slice(0, end + 1);
}

function playersOf(events: readonly GameEvent[], type: string): string[] {
  return events.filter((event) => event.type === type).map((event) => event.params.playerId as string);
}

async function lastSeq(service: RunningService, gameId: string): Promise<number> {
  return (await allEvents(service, gameId)).at(-1)?.seq ?? 0;
}

async function rejectedBotReceipts(service: RunningService, gameId: string): Promise<string[]> {
  const rows = await service.repo.db.all<{ error_json: string }>(
    `SELECT error_json FROM command_receipts WHERE game_id = ? AND outcome = 'rejected' AND command_id LIKE 'bot:%'`,
    [gameId],
  );
  return rows.map((row) => row.error_json).filter((error) => !error.includes('E_STALE_REVISION'));
}

/** `playerId` 在 `command_id = bot:<revision>:<attempt>` 的收據結果。 */
async function attemptOutcomes(
  service: RunningService,
  gameId: string,
  playerId: string,
  opened: number,
  attempt: number,
): Promise<string[]> {
  const rows = await service.repo.db.all<{ outcome: string }>(
    `SELECT outcome FROM command_receipts WHERE game_id = ? AND player_id = ? AND command_id = ?`,
    [gameId, playerId, `bot:${opened}:${attempt}`],
  );
  return rows.map((row) => row.outcome);
}

/** 投票 frame 的資料（rules 建立 frame 時的形狀）。 */
function votePending(kind: string, responders: string[], data: VoteData): GameState['pending'] {
  return { kind, module: TRADERS_BARBARIANS, responders, data: data as unknown as Record<string, unknown> } as GameState['pending'];
}

/** 出價的牌從手牌（沒有就從銀行）移到出價區；投票結束時 rules 把它們還給銀行，總數不變。 */
function takeBid(game: GameState, playerId: string, wool: number): void {
  const player = game.players.find((candidate) => candidate.id === playerId)!;
  const own = Math.min(player.resources.wool, wool);
  player.resources.wool -= own;
  game.bank.wool -= wool - own;
}

/** 開出 Traders 的車隊移動 frame（`onEndTurn` 的形狀）：`actor` 的行動階段，MP 是車隊等級的值。 */
async function openWagonMove(gameId: string, service: RunningService, actor: string): Promise<number> {
  return rewrite(gameId, service, (game) => {
    actionPhase(game, actor);
    const wagon = partOf<{ wagons: Record<string, TradersWagon> }>(game, TRADERS_PART).wagons[actor]!;
    expect(wagon.vertex).toBeGreaterThanOrEqual(0);
    const levels = [4, 5, 6, 7, 7];
    const data: MoveData = { mp: levels[wagon.level - 1]!, boosted: false, extra: 0, drivenOff: [] };
    game.pending = {
      kind: TB_FRAME_KINDS.tbWagon,
      module: TRADERS_BARBARIANS,
      responders: [actor],
      data: data as unknown as Record<string, unknown>,
    } as GameState['pending'];
  });
}

describe('Traders & Barbarians with bot seats', () => {
  // 1. 完整對局：真人座位也交給 standard 策略，透過 HTTP 送指令；Bot 座位（standard 與 easy）由排程器推進。
  it(`plays a whole 3-player ${TRAINS_PROFILE} game to a winner, through end-of-turn votes`, async () => {
    const logs = captureLogs(driverDeps(harness.service));
    let disconnect: (() => Promise<void>) | null = null;
    try {
      const host = await harness.client('TbHost');
      const { roomId, gameId, botIds } = await tbGame(harness.service, host, {
        profileId: TRAINS_PROFILE,
        levels: ['standard', 'easy'],
      });
      disconnect = await liveSocket(harness.service, roomId, host.playerId!);
      const policy = createBotPolicy('standard');
      const deadline = Date.now() + 150_000;
      let humanCommands = 0;
      let view: GameView | null = null;
      while (Date.now() < deadline) {
        const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
        view = snapshot.view;
        if (view.result) break;
        const command = policy.decide(view, { selfId: host.playerId!, level: 'standard', seed: snapshot.revision, offerPhases: {} });
        if (!command) {
          await sleep(5);
          continue;
        }
        if (await humanSubmit(host, gameId, snapshot, command)) humanCommands += 1;
      }
      expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
      expect(view?.result?.playerId).toBeTruthy();
      expect(humanCommands).toBeGreaterThan(10);
      const game = await state(gameId, harness.service);
      expect(game.profileId).toBe(TRAINS_PROFILE);
      expect(game.pending).toBeNull();
      expect((await harness.service.repo.findRoom(roomId))?.status).toBe('completed');
      expect(await rejectedBotReceipts(harness.service, gameId)).toEqual([]);

      // 回合結束時排入投票（`onEndTurn` defer），依序出價：同一輪投票的出價者從行動者起依座位順序，每位都出了價，
      // 包括 Bot 與真人；Bot 放過車廂。事件從資料庫讀完整的歷史。
      const events = await allEvents(harness.service, gameId);
      const seats = game.players.map((player) => player.id);
      const rounds: { active: string; bidders: string[] }[] = [];
      for (const event of events) {
        if (event.type === 'tb.wagonVoteStarted') rounds.push({ active: event.params.playerId as string, bidders: [] });
        else if (event.type === 'tb.wagonBid') rounds.at(-1)!.bidders.push(event.params.playerId as string);
      }
      const complete = rounds.filter((round) => round.bidders.length === seats.length);
      expect(complete.length).toBeGreaterThan(0);
      for (const round of complete) {
        const start = seats.indexOf(round.active);
        expect(round.bidders).toEqual(seats.map((_, step) => seats[(start + step) % seats.length]));
      }
      expect(new Set(rounds.map((round) => round.active)).size).toBeGreaterThan(1);
      expect(rounds.some((round) => botIds.includes(round.active))).toBe(true);
      expect(
        events.some((event) => event.type === 'tb.wagonPlaced' && botIds.includes(event.params.playerId as string)),
      ).toBe(true);
    } finally {
      // 逾時或斷言失敗時也要還原 logger、放掉真人連線，避免汙染共用的 BotDriverDeps。
      logs.restore();
      await disconnect?.();
    }
  }, 180_000);

  // 2. 保底接手：策略在 `tbWagon` frame 送出不合法的一步，被拒後同一個 revision 改由保底停車，第二次嘗試就被接受。
  it(`stops the wagon through the fallback in ${TRADERS_PROFILE} after a rejected step`, async () => {
    const service = harness.service;
    const deps = driverDeps(service);
    const original = deps.policyFor;
    const logs = captureLogs(deps);
    const host = await harness.client('TbWagonFallback');
    const { roomId, gameId, botIds } = await tbGame(service, host, { profileId: TRADERS_PROFILE, levels: ['standard', 'standard'] });
    const [botId] = botIds as [string, ...string[]];
    const drop = await liveSocket(service, roomId, host.playerId!);
    try {
      await finishSetup(host, gameId, service);
      // 只對這個 Bot 的 `tbWagon` frame 送一次不合法的一步（站在原地）；其他決策照常交給策略。
      let injected = false;
      deps.policyFor = (level) => {
        const strategy = original(level);
        const broken: BotPolicy = {
          decide(view, ctx) {
            if (!injected && ctx.selfId === botId && view.pending?.kind === TB_FRAME_KINDS.tbWagon) {
              injected = true;
              const parts = view.modules?.tradersBarbarians as unknown as Record<string, { wagons: Record<string, TradersWagon> }>;
              const wagons = parts[TRADERS_PART]!.wagons;
              return { type: 'tb.wagonStep', to: wagons[botId]!.vertex } as BotCommand;
            }
            return strategy.decide(view, ctx);
          },
        };
        return broken;
      };
      const opened = await openWagonMove(gameId, service, botId);
      const baseline = await lastSeq(service, gameId);
      service.bots.kick(gameId);
      await waitFor(async () => (await revision(gameId, service)) > opened, 'the fallback to stop the wagon');
      deps.policyFor = original;

      expect(injected).toBe(true);
      // 第一次嘗試被拒（站在原地不是合法的一步），同一個 revision 的第二次嘗試是保底的 `tb.wagonStop`，被接受。
      expect(await attemptOutcomes(service, gameId, botId, opened, 0)).toEqual(['rejected']);
      expect(await attemptOutcomes(service, gameId, botId, opened, 1)).toEqual(['accepted']);
      const rejected = logs.entries.filter(
        (entry) => entry.message === 'bot command rejected; using fallback' && entry.meta.botId === botId,
      );
      expect(rejected.map((entry) => [entry.meta.command, entry.meta.messageId])).toEqual([['tb.wagonStep', 'error.E_ILLEGAL_TARGET']]);
      expect(logs.entries.filter((entry) => entry.message.startsWith('bot fallback rejected'))).toEqual([]);
      // 停車就結束這一次移動，也結束回合：車隊沒有動，Bot 的回合結束。
      const turn = await eventsUntil(service, gameId, baseline, 'turn.ended');
      expect(turn?.map((event) => event.type)).toEqual(['turn.ended']);
      expect(turn?.[0]?.params.playerId).toBe(botId);

      // frame 結束後 BotDriver 沒有卡住：回合繼續輪下去，直到輪到真人。
      await waitForPerson(host, gameId, service, 'the turn to reach the person');
      expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
      // 唯一的拒絕就是注入的那一步。
      const errors = await rejectedBotReceipts(service, gameId);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('E_ILLEGAL_TARGET');
    } finally {
      deps.policyFor = original;
      logs.restore();
      await drop();
    }
  }, 30_000);

  // 3. 真人與 Bot 並存（真人加 3 個 Bot）。座位以真人為 0 順時針編號：`before` 是真人前一座、`after` 是後一座、
  //    `across` 是對面。出價依座位順序從行動者起算，rules 只接受 `responders[0]`；分配是同時的，rules 接受任何
  //    responder，Bot 不必等真人。
  const orders = ['the person first', 'a bot first'] as const;
  for (const order of orders) {
    it(`lets bots bid in turn and assign at once around a person in ${TRAINS_PROFILE}, ${order}`, async () => {
      const service = harness.service;
      const deps = driverDeps(service);
      const logs = captureLogs(deps);
      let opened: { host: TestClient; gameId: string; drop: () => Promise<void> };
      try {
        const client = await harness.client('TbVote');
        const created = await tbGame(service, client, { profileId: TRAINS_PROFILE, levels: ['standard', 'easy', 'standard'] });
        opened = { host: client, gameId: created.gameId, drop: await liveSocket(service, created.roomId, client.playerId!) };
      } catch (error) {
        logs.restore();
        throw error;
      }
      const { host, gameId, drop } = opened;
      const me = host.playerId!;
      try {
        await finishSetup(host, gameId, service);
        const seats = (await state(gameId, service)).players.map((player) => player.id);
        const at = (offset: number): string => seats[(seats.indexOf(me) + offset) % seats.length]!;
        const after = at(1);
        const across = at(2);
        const before = at(3);
        const personFirst = order === 'the person first';

        // --- wagonBid（依序） ---
        let baseline: number;
        let bidOrder: string[];
        if (personFirst) {
          // 真人是行動者：蓋過建築（收集了車廂）後結束回合，rules 在回合結束時排入投票（`onEndTurn` defer）。
          await waitForPerson(host, gameId, service, 'the person to act');
          await rewrite(gameId, service, (game) => {
            game.turn.phase = 'action';
            partOf<{ collectedWindow: number | null }>(game, TRAINS_PART).collectedWindow = game.windowId;
          });
          baseline = await lastSeq(service, gameId);
          const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
          expect(await humanSubmit(host, gameId, snapshot, { type: 'turn.end' } as BotCommand)).toBe(true);
          bidOrder = [me, after, across, before];
        } else {
          // `before` 是行動者：投票從它開始，下一位就是真人。
          await waitForPerson(host, gameId, service, 'the person to act');
          await rewrite(gameId, service, (game) => {
            actionPhase(game, before);
            game.pending = votePending(TB_FRAME_KINDS.wagonBid, [before, me, after, across], { bids: {}, assignments: {}, active: before });
          });
          baseline = await lastSeq(service, gameId);
          bidOrder = [before, me, after, across];
        }
        service.bots.kick(gameId);
        if (!personFirst) {
          await waitFor(async () => respondersOf(await state(gameId, service))?.[0] === me, 'the first bot to bid');
        }
        // 輪到真人時投票停住：之後的 Bot 不搶先出價。
        const waiting = await revision(gameId, service);
        await sleep(300);
        expect(await revision(gameId, service)).toBe(waiting);
        const pending = await state(gameId, service);
        expect(pending.pending).toMatchObject({ kind: TB_FRAME_KINDS.wagonBid, responders: bidOrder.slice(bidOrder.indexOf(me)) });
        expect(await eventPlayersSince(service, gameId, baseline, 'tb.wagonBid')).toEqual(bidOrder.slice(0, bidOrder.indexOf(me)));
        const mine = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
        const tbHints = mine.view.hints?.modules?.tradersBarbarians as unknown as Record<string, { bidTurn?: boolean }> | undefined;
        const trainsHints = tbHints?.[TRAINS_PART];
        expect(trainsHints?.bidTurn).toBe(true);
        expect(await humanSubmit(host, gameId, mine, { type: 'tb.bidWagon', wool: 0, grain: 0 } as BotCommand)).toBe(true);

        // 真人之後的 Bot 依序出價，投票（分配或放置）結束後回合才換人；欠真人的動作（例如行動者放置）由保底代答。
        await serveUntil(
          host,
          gameId,
          service,
          async () => (await eventsUntil(service, gameId, baseline, 'turn.ended')) !== null,
          'the vote to end',
        );
        const vote = (await eventsUntil(service, gameId, baseline, 'turn.ended'))!;
        expect(playersOf(vote, 'tb.wagonBid')).toEqual(bidOrder);
        expect(playersOf(vote, 'tb.wagonVoteEnded')).toEqual([bidOrder[0]]);
        expect(playersOf(vote, 'tb.wagonPlaced')).toHaveLength(1);
        expect(playersOf(vote, 'turn.ended')).toEqual([bidOrder[0]]);
        await waitForPerson(host, gameId, service, 'the turn to reach the person');

        // --- wagonAssign（同時） ---
        // 行動者是 `before`（Bot）；出價者各出 1 張 wool，沒有過半，所以由出價者分配。真人在前時出價者是真人與
        // `after`，Bot 在前時是 `before`、真人與 `after`（都依座位順序從行動者起算）。
        const bidders = personFirst ? [me, after] : [before, me, after];
        const bots = bidders.filter((playerId) => playerId !== me);
        const assignOpened = await rewrite(gameId, service, (game) => {
          actionPhase(game, before);
          const bids = Object.fromEntries(
            [before, me, after, across].map((playerId) => [playerId, { wool: bidders.includes(playerId) ? 1 : 0, grain: 0 }]),
          );
          for (const playerId of bidders) takeBid(game, playerId, 1);
          game.pending = votePending(TB_FRAME_KINDS.wagonAssign, [...bidders], { bids, assignments: {}, active: before });
        });
        const assignBaseline = await lastSeq(service, gameId);
        service.bots.kick(gameId);
        // Bot 不等真人（即使真人排在最前面）：每個 Bot 都分配了，frame 只剩真人。
        await waitFor(async () => respondersOf(await state(gameId, service))?.join() === me, 'the bots to assign');
        expect(new Set(await eventPlayersSince(service, gameId, assignBaseline, 'tb.wagonVotes'))).toEqual(new Set(bots));
        const voting = await state(gameId, service);
        expect(voting.pending).toMatchObject({ kind: TB_FRAME_KINDS.wagonAssign, responders: [me] });
        expect(await revision(gameId, service)).toBe(assignOpened + bots.length);
        const assignments = (voting.pending as unknown as { data: VoteData }).data.assignments;
        // 真人投給第一個 Bot 選的位置：那個位置的票數最多，車廂直接放在那裡，不必再開放置的 frame。
        const edge = assignments[bots[0]!]!;
        const own = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
        expect(own.view.pending).toMatchObject({ kind: TB_FRAME_KINDS.wagonAssign, responders: [me] });
        expect(await humanSubmit(host, gameId, own, { type: 'tb.assignWagon', edge } as BotCommand)).toBe(true);

        // 真人的分配讓投票結束：車廂放好，行動者的回合結束。
        const assigned = (await eventsUntil(service, gameId, assignBaseline, 'turn.ended'))!;
        expect(assigned).not.toBeNull();
        expect(playersOf(assigned, 'tb.wagonVotes').at(-1)).toBe(me);
        const placed = assigned.filter((event) => event.type === 'tb.wagonPlaced');
        expect(placed.map((event) => [event.params.playerId, event.params.edge])).toEqual([[before, edge]]);
        expect(playersOf(assigned, 'turn.ended')).toEqual([before]);
        // 回合繼續輪下去，直到再次輪到真人。
        await waitForPerson(host, gameId, service, 'the turn to reach the person again');
        expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
        expect(logs.entries.filter(isRetryWarn)).toEqual([]);
        expect(await rejectedBotReceipts(service, gameId)).toEqual([]);
      } finally {
        logs.restore();
        await drop();
      }
    }, 60_000);
  }

  // 4. 車隊移動到一半時重啟：frame 由已提交的狀態恢復，Bot 接著完成移動。
  it(`resumes a wagon move in ${TRADERS_PROFILE} after a restart`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'katan-tb-bots-restart-'));
    const overrides = { port: 0, host: '127.0.0.1', sqlitePath: join(dir, 'tb.sqlite'), bots: { ...FAST_BOTS } };
    try {
      const first = await startService(overrides, () => undefined);
      const host = createClient(`http://127.0.0.1:${first.port}`);
      host.playerId = host.expectOk<{ player: { id: string } }>(
        await host.post('/api/session', { nickname: 'TbRestart', locale: 'en' }),
      ).player.id;
      const { roomId, gameId, botIds } = await tbGame(first, host, { profileId: TRADERS_PROFILE, levels: ['standard', 'standard'] });
      const drop = await liveSocket(first, roomId, host.playerId!);
      await finishSetup(host, gameId, first);
      await waitForPerson(host, gameId, first, 'the person to act');
      // 真人離線後 Bot 停下；開出真人後一座 Bot 的車隊移動 frame，並以 Bot 的身分走第一步（不進入據點的廣場，
      // 否則這一次移動就結束了）。
      await drop();
      const seats = (await state(gameId, first)).players.map((player) => player.id);
      const botId = seats[(seats.indexOf(host.playerId!) + 1) % seats.length]!;
      expect(botIds).toContain(botId);
      const opened = await openWagonMove(gameId, first, botId);
      const before = await state(gameId, first);
      const plazas = new Set(partOf<{ sites: { plaza: number }[] }>(before, TRADERS_PART).sites.map((site) => site.plaza));
      const hints = actionHints(before, botId).modules?.tradersBarbarians as unknown as Record<string, { steps: number[] }>;
      const steps = hints[TRADERS_PART]!.steps;
      const to = steps.find((vertex) => !plazas.has(vertex));
      expect(to).toBeDefined();
      const stepped = await first.games.submit(botId, gameId, {
        commandId: `bot:${opened}:0`,
        expectedRevision: opened,
        command: { type: 'tb.wagonStep', to } as never,
      });
      expect(stepped.outcome).toBe('accepted');
      const moving = opened + 1;
      const mid = await state(gameId, first);
      const midData = (mid.pending as unknown as { data: MoveData }).data;
      expect(mid.pending).toMatchObject({ kind: TB_FRAME_KINDS.tbWagon, responders: [botId] });
      expect(midData.mp).toBeLessThan((before.pending as unknown as { data: MoveData }).data.mp);
      const cookie = host.cookie;
      await first.close();
      expect(first.bots.stats()).toMatchObject({ games: 0, timers: 0, tasks: 0 });

      const second = await startService(overrides, () => undefined);
      try {
        const logs = captureLogs(driverDeps(second));
        // frame 與剩下的 MP 原樣恢復，車隊停在第一步走到的路口。
        expect(await revision(gameId, second)).toBe(moving);
        const resumed = await state(gameId, second);
        expect(resumed.pending).toMatchObject({ kind: TB_FRAME_KINDS.tbWagon, responders: [botId], data: midData });
        expect(partOf<{ wagons: Record<string, TradersWagon> }>(resumed, TRADERS_PART).wagons[botId]!.vertex).toBe(to);
        const baseline = await lastSeq(second, gameId);
        const again = createClient(`http://127.0.0.1:${second.port}`);
        again.cookie = cookie;
        again.playerId = host.playerId;
        const dropAgain = await liveSocket(second, roomId, host.playerId!);
        try {
          // 真人重新上線後，Bot 接著作答：這一次移動結束（走到廣場或停車），回合換人。
          await waitFor(
            async () => (await eventPlayersSince(second, gameId, baseline, 'turn.ended')).includes(botId),
            'the bot to finish the wagon move after the restart',
          );
          // 重啟後第一個決策就被接受；第一個結束的回合是這個 Bot 的。
          expect(await attemptOutcomes(second, gameId, botId, moving, 0)).toEqual(['accepted']);
          expect(playersOf((await eventsUntil(second, gameId, baseline, 'turn.ended'))!, 'turn.ended')).toEqual([botId]);
          await waitForPerson(again, gameId, second, 'the turn to reach the person');
          expect(logs.entries.filter(isIdleDutyWarn)).toEqual([]);
          expect(logs.entries.filter(isRetryWarn)).toEqual([]);
          expect(await rejectedBotReceipts(second, gameId)).toEqual([]);
        } finally {
          logs.restore();
          await dropAgain();
        }
      } finally {
        await second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  // hard 只有基本版：8 個 T&B profile 都只提供 easy 與 standard，要 hard 會被拒。
  it('offers easy and standard bots in every playable T&B profile and refuses hard', async () => {
    const host = await harness.client('TbHard');
    const profiles = host.expectOk<{ profiles: { id: string; botSeats: boolean; botLevels: string[] }[] }>(
      await host.get('/api/profiles'),
    ).profiles;
    for (const profileId of TB_PROFILES) {
      expect(profiles.find((profile) => profile.id === profileId), profileId).toMatchObject({
        botSeats: true,
        botLevels: ['easy', 'standard'],
      });
      const room = host.expectOk<RoomShape>(
        await host.post('/api/rooms', { visibility: 'private', capacity: 3, profileId, setupMode: 'variable' }),
      );
      const refused = await host.post(`/api/rooms/${room.id}/bots`, { level: 'hard' });
      host.expectError(refused, 'E_INVALID_BOT');
      expect(refused.body.ok ? null : refused.body.error.params, profileId).toMatchObject({ reason: 'profileLevel', level: 'hard' });
      for (const level of ['easy', 'standard']) {
        const seated = host.expectOk<RoomShape>(await host.post(`/api/rooms/${room.id}/bots`, { level }));
        expect(seated.members.filter((member) => member.bot), `${profileId} ${level}`).toHaveLength(level === 'easy' ? 1 : 2);
      }
    }
  });
});
