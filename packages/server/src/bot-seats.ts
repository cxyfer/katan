/**
 * Bot 席位的共用判斷與建立（SPEC §4.9）。
 *
 * 席位是不是 Bot 一律由 `guests.kind` 決定。membership 的 ready／connected
 * 旗標對 Bot 沒有意義（例如設定變更會清除 ready），讀取時一律用這裡的函式推導。
 */

import { PLAYER_COLORS, type ProfileDefinition } from '@catan/rules';
import { BOT_LEVELS, type BotLevel } from '@catan/protocol';
import { botsCanPlay, type BotLevel as PolicyBotLevel } from '@catan/bots';
import { newId, type MemberRow, type Repository } from './db.ts';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// 線上協定與策略套件各自宣告難度，兩者必須完全一致。
const LEVELS_MATCH: Same<BotLevel, PolicyBotLevel> = true;
void LEVELS_MATCH;

export const DEFAULT_BOT_LEVEL: BotLevel = 'standard';

/** 同房不重複的 Bot 名稱池；中英文介面都能直接顯示，「電腦」標示由前端徽章負責。 */
export const BOT_NAMES: readonly string[] = ['Ada', 'Bram', 'Cleo', 'Dax', 'Esme', 'Finn', 'Gus', 'Hana'];

/** 房間刪除後殘留的 Bot guest，超過這個年齡才由清理週期刪除。 */
export const ORPHAN_BOT_GUEST_AGE_MS = 60 * 60 * 1000;

export function isBotMember(member: { kind?: string | null }): boolean {
  return member.kind === 'bot';
}

export function humanMembers<T extends { kind?: string | null }>(members: readonly T[]): T[] {
  return members.filter((member) => !isBotMember(member));
}

export function parseBotLevel(value: unknown): BotLevel | null {
  return typeof value === 'string' && (BOT_LEVELS as readonly string[]).includes(value)
    ? (value as BotLevel)
    : null;
}

/** 儲存值不合法時退回預設難度。 */
export function botLevelOf(member: { bot_level?: string | null }): BotLevel {
  return parseBotLevel(member.bot_level) ?? DEFAULT_BOT_LEVEL;
}

/**
 * Bot 策略只涵蓋基本規則（含 5–6 人 paired）；設定檔的每個規則模組都必須在
 * `@catan/bots` 的 `BOT_RULE_MODULES` 之中才可加入 Bot。
 */
export function botsSupported(profile: ProfileDefinition): boolean {
  return botsCanPlay(profile);
}

/** Bot 席位永遠就緒。 */
export function effectiveReady(member: MemberRow): boolean {
  return isBotMember(member) || member.ready === 1;
}

/** Bot 席位永遠在線；它沒有 socket，也不會缺席。 */
export function effectiveConnected(member: MemberRow): boolean {
  return isBotMember(member) || member.connected === 1;
}

export function pickBotName(taken: Iterable<string>): string {
  const used = new Set([...taken].map((name) => name.toLowerCase()));
  const free = BOT_NAMES.find((name) => !used.has(name.toLowerCase()));
  if (free) return free;
  for (let index = 2; ; index++) {
    const candidate = `${BOT_NAMES[0]} ${index}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * 在最小空位建立一個 Bot 席位（guest 列＋membership）並回傳新成員。呼叫端需
 * 持有 room lock，並自行檢查權限與容量。guest 與 membership 在同一筆交易內寫入。
 */
export async function insertBotSeat(
  repo: Repository,
  roomId: string,
  members: readonly MemberRow[],
  level: BotLevel,
  now: string,
  name?: string,
): Promise<MemberRow> {
  const takenSeats = new Set(members.map((member) => member.seat));
  const takenColors = new Set(members.map((member) => member.color));
  let seat = 0;
  while (takenSeats.has(seat)) seat += 1;
  const color = PLAYER_COLORS.find((candidate) => !takenColors.has(candidate)) ?? PLAYER_COLORS[0]!;
  const id = newId('bot');
  // 房主指定的名稱優先；留空時才從名稱池挑一個同房不重複的預設名稱。
  const nickname = name ?? pickBotName(members.map((member) => member.nickname ?? ''));
  const membership = {
    room_id: roomId,
    player_id: id,
    seat,
    color,
    ready: 1,
    connected: 1,
    withdrawn: 0,
    joined_at: now,
    last_seen_at: now,
    disconnected_at: null,
    connection_id: null,
  };
  await repo.transaction(async () => {
    await repo.insertGuest({
      id,
      // 登入比對的是 64 字元 SHA-256，這個哨兵值永遠不會被比對到。
      token_hash: `bot:${id}`,
      nickname,
      locale: 'en',
      created_at: now,
      updated_at: now,
      kind: 'bot',
      bot_level: level,
    });
    await repo.insertMembership(membership);
  });
  return { ...membership, nickname, kind: 'bot', bot_level: level };
}
