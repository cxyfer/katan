/**
 * Explorers & Pirates 的 Bot 席位（E&P 計畫 §5.1 E5a；結構比照 `traders-barbarians-bots.test.ts`）。
 *
 * 全都經過 HTTP 與真實的 BotDriver：
 * 1. 'ep-land-ho-2025' 的完整對局：真人座位用 standard 策略，跑到終局有勝者、沒有非 stale 的拒絕。
 * 2. 保底接手：'ep-pirate-lairs-2025' 的海盜 frame，策略送出不合法的 `ep.placePirate`／`ep.robPlayer`，
 *    被拒後同一個 revision 改由保底送出合法指令。
 * 3. 7 之後真人與 Bot 一起棄牌（base 的多 responder frame；E&P 自己的海盜 frame 只有單一 responder，D-5）。
 * 4. 海盜 frame 在 `rob` 階段重啟伺服器，Bot 恢復後作答。
 * 5. E&P 桌的每視窗指令上限為 80（base 為 40），`ep.*` 的節奏值已併入 Bot 的節奏表。
 *    節奏表本身的內容由 `packages/bots/test/support.test.ts` 與 `bots.test.ts` 驗證，這裡不重複。
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EP_PIRATE_FRAME, type GameState, type GameView } from '@katan/rules';
import { BOT_PACING, createBotPolicy, fallbackPolicy, type BotCommand, type BotPolicy } from '@katan/bots';
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

const LAND_HO = 'ep-land-ho-2025';
const LAIRS = 'ep-pirate-lairs-2025';

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
  error?: { messageId: string };
}

interface RoomShape {
  id: string;
  members: { playerId: string; bot: boolean }[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 10_000): Promise<void> {
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

const state = (gameId: string, service: RunningService): Promise<GameState> => service.games.rawState(gameId);

/** 直接改寫快照（比照 bots.test.ts），用來建立特定局面；回傳新的 revision。 */
async function rewrite(gameId: string, service: RunningService, edit: (game: GameState) => void): Promise<number> {
  const row = await service.repo.findGame(gameId);
  const game = JSON.parse(row!.state_json) as GameState;
  edit(game);
  await service.repo.saveGame(gameId, game, row!.revision + 1, 'playing', null);
  return row!.revision + 1;
}

/** 建一間 E&P 房：真人房主加上 Bot，全員就緒後開局（兩個 profile 都是 fixed 擺法，開局由 ep.setup* 指令走完）。 */
async function epGame(service: RunningService, host: TestClient, profileId: string, levels: readonly ('easy' | 'standard')[]) {
  let room = host.expectOk<RoomShape>(
    await host.post('/api/rooms', { visibility: 'private', capacity: levels.length + 1, profileId, setupMode: 'fixed' }),
  );
  for (const level of levels) room = host.expectOk<RoomShape>(await host.post(`/api/rooms/${room.id}/bots`, { level }));
  host.expectOk(await host.post(`/api/rooms/${room.id}/ready`, { ready: true }));
  const { gameId } = host.expectOk<{ gameId: string }>(await host.post(`/api/rooms/${room.id}/start`));
  expect((await state(gameId, service)).profileId).toBe(profileId);
  return { roomId: room.id, gameId, botIds: room.members.filter((member) => member.bot).map((member) => member.playerId) };
}

/** 以真人身分送一個指令；與 Bot 同時送出時可能落後一個 revision，其他拒絕都代表有誤。 */
async function humanSubmit(client: TestClient, gameId: string, snapshot: Snapshot, command: BotCommand): Promise<boolean> {
  const receipt = client.expectOk<Receipt>(
    await client.post(`/api/games/${gameId}/commands`, {
      commandId: `human-${randomUUID().slice(0, 8)}`,
      expectedRevision: snapshot.revision,
      command,
    }),
  );
  if (receipt.outcome === 'rejected') expect(receipt.error?.messageId).toBe('error.E_STALE_REVISION');
  return receipt.outcome === 'accepted';
}

/** 真人座位以保底策略走一步；沒有動作時回傳 false。 */
async function humanFallbackStep(client: TestClient, gameId: string): Promise<boolean> {
  const snapshot = client.expectOk<Snapshot>(await client.get(`/api/games/${gameId}`));
  const command = fallbackPolicy.decide(snapshot.view, { selfId: client.playerId!, level: 'standard', seed: 1, offerPhases: {} });
  return command ? humanSubmit(client, gameId, snapshot, command) : false;
}

/** 走完 setup：輪到真人時以保底放置，Bot 的席位由排程器推進。 */
async function finishSetup(client: TestClient, gameId: string, service: RunningService): Promise<void> {
  await waitFor(async () => {
    const game = await state(gameId, service);
    if (game.turn.phase !== 'setup') return true;
    if (game.players[game.turn.seat]!.id === client.playerId) await humanFallbackStep(client, gameId);
    return false;
  }, 'setup to finish', 20_000);
}

/** 把局面改成 `actor` 的行動階段，並清掉 setup 狀態。 */
function actionPhase(game: GameState, actor: string): void {
  game.turn.seat = game.players.findIndex((player) => player.id === actor);
  game.turn.phase = 'action';
  game.turn.setup = null;
}

/** 開出 `actor` 的海盜 frame（形狀照 rules 的 `pirateFrame`／`placePirate`）；`rob` 階段要給候選受害者。 */
function pirateFrame(game: GameState, actor: string, data: Record<string, unknown>): void {
  actionPhase(game, actor);
  game.pending = { kind: EP_PIRATE_FRAME, module: 'explorersPirates', responders: [actor], data } as GameState['pending'];
}

async function attemptOutcomes(service: RunningService, gameId: string, playerId: string, opened: number, attempt: number): Promise<string[]> {
  const rows = await service.repo.db.all<{ outcome: string }>(
    `SELECT outcome FROM command_receipts WHERE game_id = ? AND player_id = ? AND command_id = ?`,
    [gameId, playerId, `bot:${opened}:${attempt}`],
  );
  return rows.map((row) => row.outcome);
}

async function rejectedBotReceipts(service: RunningService, gameId: string): Promise<string[]> {
  const rows = await service.repo.db.all<{ error_json: string }>(
    `SELECT error_json FROM command_receipts WHERE game_id = ? AND outcome = 'rejected' AND command_id LIKE 'bot:%'`,
    [gameId],
  );
  return rows.map((row) => row.error_json).filter((error) => !error.includes('E_STALE_REVISION'));
}

describe('Explorers & Pirates with bot seats', () => {
  // 1. 完整對局：真人座位交給 standard 策略，Bot 座位由排程器推進。
  it(`plays a whole 3-player ${LAND_HO} game to a winner`, async () => {
    const host = await harness.client('EpHost');
    const { roomId, gameId } = await epGame(harness.service, host, LAND_HO, ['standard', 'easy']);
    const drop = await liveSocket(harness.service, roomId, host.playerId!);
    try {
      const policy = createBotPolicy('standard');
      const deadline = Date.now() + 90_000;
      let view: GameView | null = null;
      while (Date.now() < deadline) {
        const snapshot = host.expectOk<Snapshot>(await host.get(`/api/games/${gameId}`));
        view = snapshot.view;
        if (view.result) break;
        const command = policy.decide(view, { selfId: host.playerId!, level: 'standard', seed: snapshot.revision, offerPhases: {} });
        if (command) await humanSubmit(host, gameId, snapshot, command);
        else await sleep(5);
      }
      expect(view?.result?.playerId).toBeTruthy();
      expect((await harness.service.repo.findRoom(roomId))?.status).toBe('completed');
      expect(await rejectedBotReceipts(harness.service, gameId)).toEqual([]);
    } finally {
      await drop();
    }
  }, 120_000);

  // 2. 保底接手：place 與 rob 兩個階段，策略各送一次不合法的指令，被拒後同一個 revision 由保底送合法指令。
  it(`takes over a pirate frame in ${LAIRS} through the fallback after a rejected command`, async () => {
    const service = harness.service;
    const deps = driverDeps(service);
    const original = deps.policyFor;
    const host = await harness.client('EpFallback');
    const { roomId, gameId, botIds } = await epGame(service, host, LAIRS, ['standard', 'standard']);
    const [botId, otherId] = botIds as [string, string];
    const drop = await liveSocket(service, roomId, host.playerId!);
    const injected: string[] = [];
    try {
      await finishSetup(host, gameId, service);
      // 只對這個 Bot 的海盜 frame 各送一次不合法的指令；其他決策照常交給策略。
      deps.policyFor = (level) => {
        const strategy = original(level);
        const broken: BotPolicy = {
          decide(view, ctx) {
            const data = view.pending?.kind === EP_PIRATE_FRAME ? (view.pending as { data?: { stage?: string } }).data : undefined;
            if (ctx.selfId === botId && data?.stage && !injected.includes(data.stage)) {
              injected.push(data.stage);
              return (data.stage === 'place' ? { type: 'ep.placePirate', hex: -1 } : { type: 'ep.robPlayer', victim: 'nobody' }) as BotCommand;
            }
            return strategy.decide(view, ctx);
          },
        };
        return broken;
      };
      const placeAt = await rewrite(gameId, service, (game) => pirateFrame(game, botId, { stage: 'place', cause: 'seven' }));
      service.bots.kick(gameId);
      await waitFor(async () => (await attemptOutcomes(service, gameId, botId, placeAt, 1)).length > 0, 'the fallback to place the pirate');
      expect(await attemptOutcomes(service, gameId, botId, placeAt, 0)).toEqual(['rejected']);
      expect(await attemptOutcomes(service, gameId, botId, placeAt, 1)).toEqual(['accepted']);
      expect((await state(gameId, service)).moduleState!.explorersPirates).toMatchObject({ pirate: { owner: botId } });

      // rob 階段：候選受害者是另一個 Bot，先給牌，保底的 `ep.robPlayer` 才有東西可搶。
      const robAt = await rewrite(gameId, service, (game) => {
        game.players.find((player) => player.id === otherId)!.resources.lumber += 3;
        pirateFrame(game, botId, { stage: 'rob', cause: 'seven', candidates: [otherId] });
      });
      service.bots.kick(gameId);
      await waitFor(async () => (await attemptOutcomes(service, gameId, botId, robAt, 1)).length > 0, 'the fallback to rob');
      expect(await attemptOutcomes(service, gameId, botId, robAt, 0)).toEqual(['rejected']);
      expect(await attemptOutcomes(service, gameId, botId, robAt, 1)).toEqual(['accepted']);
      expect(injected).toEqual(['place', 'rob']);
      // 唯一的拒絕就是兩次注入。
      expect(await rejectedBotReceipts(service, gameId)).toHaveLength(2);
    } finally {
      deps.policyFor = original;
      await drop();
    }
  }, 40_000);

  // 3. 7 之後的棄牌是 base 的多 responder frame（D-5）：真人與 Bot 各自棄牌，E&P 桌不會卡住。
  it('lets a person and a bot discard together after a 7 in an E&P room', async () => {
    const service = harness.service;
    const host = await harness.client('EpDiscard');
    const { roomId, gameId, botIds } = await epGame(service, host, LAND_HO, ['standard', 'standard']);
    const botId = botIds[0]!;
    const handOf = (game: GameState, id: string) =>
      Object.values(game.players.find((player) => player.id === id)!.resources).reduce((sum, count) => sum + count, 0);
    const held = new Map<string, number>();
    await rewrite(gameId, service, (game) => {
      actionPhase(game, host.playerId!);
      for (const id of [host.playerId!, botId]) {
        game.players.find((player) => player.id === id)!.resources.lumber += 8;
        held.set(id, handOf(game, id));
      }
      game.pending = { kind: 'discard', required: { [host.playerId!]: 4, [botId]: 4 }, submitted: {} };
    });
    const drop = await liveSocket(service, roomId, host.playerId!);
    try {
      // Bot 與真人各自棄牌，互不等待（Bot 先送出時真人的第一次可能 stale，重試即可）；兩邊都棄完後 frame 結束。
      await waitFor(async () => {
        if ((await state(gameId, service)).pending?.kind !== 'discard') return true;
        await humanFallbackStep(host, gameId);
        return false;
      }, 'both to discard');
      const game = await state(gameId, service);
      for (const id of [host.playerId!, botId]) {
        expect(handOf(game, id)).toBe(held.get(id)! - 4);
      }
      expect(await rejectedBotReceipts(service, gameId)).toEqual([]);
    } finally {
      await drop();
    }
  }, 30_000);

  // 4. 海盜 frame 在 rob 階段重啟：frame 由已提交的狀態恢復，Bot 接著搶人。
  it(`resumes a ${LAIRS} rob stage after a restart`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'katan-ep-bots-restart-'));
    const overrides = { port: 0, host: '127.0.0.1', sqlitePath: join(dir, 'ep.sqlite'), bots: { ...FAST_BOTS } };
    try {
      const first = await startService(overrides, () => undefined);
      const host = createClient(`http://127.0.0.1:${first.port}`);
      host.playerId = host.expectOk<{ player: { id: string } }>(
        await host.post('/api/session', { nickname: 'EpRestart', locale: 'en' }),
      ).player.id;
      const { roomId, gameId, botIds } = await epGame(first, host, LAIRS, ['standard', 'standard']);
      const drop = await liveSocket(first, roomId, host.playerId!);
      await finishSetup(host, gameId, first);
      await drop();
      // 真人離線後 Bot 停下；開出 rob 階段的 frame，受害者是真人（有牌可搶）。
      const botId = botIds[0]!;
      const opened = await rewrite(gameId, first, (game) => {
        game.players.find((player) => player.id === host.playerId)!.resources.grain += 3;
        pirateFrame(game, botId, { stage: 'rob', cause: 'seven', candidates: [host.playerId!] });
      });
      await first.close();

      const second = await startService(overrides, () => undefined);
      try {
        const resumed = await state(gameId, second);
        expect((await second.repo.findGame(gameId))!.revision).toBe(opened);
        expect(resumed.pending).toMatchObject({ kind: EP_PIRATE_FRAME, responders: [botId], data: { stage: 'rob' } });
        const dropAgain = await liveSocket(second, roomId, host.playerId!);
        try {
          await waitFor(async () => (await attemptOutcomes(second, gameId, botId, opened, 0)).length > 0, 'the bot to rob after the restart');
          expect(await attemptOutcomes(second, gameId, botId, opened, 0)).toEqual(['accepted']);
          expect((await state(gameId, second)).pending?.kind).not.toBe(EP_PIRATE_FRAME);
          expect(await rejectedBotReceipts(second, gameId)).toEqual([]);
        } finally {
          await dropAgain();
        }
      } finally {
        await second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  // 5. E&P 桌的每視窗指令上限是 80，其他桌維持 base 的 40；`ep.*` 的節奏值已在 Bot 的節奏表內。
  it('uses the 80-command window for E&P tables and keeps ep pacing in the bot table', () => {
    const limitOf = (profileId: string) =>
      (harness.service.bots as unknown as { commandLimit(profileId: string): number }).commandLimit(profileId);
    expect(limitOf(LAND_HO)).toBe(80);
    expect(limitOf(LAIRS)).toBe(80);
    expect(limitOf('base-2025')).toBe(40);
    expect(BOT_PACING['ep.placePirate']).toBe(1200);
    expect(BOT_PACING['ep.robPlayer']).toBe(800);
    expect(BOT_PACING['ep.moveShip']).toBe(400);
  });
});
