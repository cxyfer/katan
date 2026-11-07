/** 電腦對手（SPEC §4.9）的前端選擇器：只讀房間成員與伺服器設定，不推算任何遊戲資訊。 */

import { BOT_LEVELS, type BotLevel, type ProfileView, type RoomView, type ServerConfigView } from '@catan/protocol';

export const DEFAULT_BOT_LEVEL: BotLevel = 'standard';

type Translate = (id: string, params?: Record<string, unknown>) => string;

/** 伺服器是否允許房主加入電腦；舊版伺服器沒有這個欄位時視為不允許。 */
export function botsEnabled(config: ServerConfigView | null | undefined): boolean {
  return config?.bots?.enabled === true;
}

/**
 * 這個規則組合能否加入電腦：Bot 只會玩它認得的規則模組（目前只有基本規則）。
 * 舊版伺服器沒有 `botSeats` 欄位時不擋，最終仍由伺服器驗證。
 */
export function profileAllowsBots(profile: ProfileView | null | undefined): boolean {
  return profile?.botSeats !== false;
}

/**
 * 伺服器提供、而且這個規則組合可選的難度（例如困難只有基本版），只保留前端認得的值。
 * 伺服器沒有提供時沿用協定清單；規則組合沒有 `botLevels`（舊版伺服器）或不能加電腦時不再過濾，
 * 後者由 `profileAllowsBots` 擋下。
 */
export function offeredBotLevels(
  config: ServerConfigView | null | undefined,
  profile?: ProfileView | null,
): BotLevel[] {
  const offered = config?.bots?.levels ?? BOT_LEVELS;
  const known = offered.filter((level): level is BotLevel => BOT_LEVELS.includes(level));
  const server = known.length > 0 ? known : [...BOT_LEVELS];
  const allowed = profile?.botLevels;
  if (!allowed || allowed.length === 0) return server;
  const narrowed = server.filter((level) => allowed.includes(level));
  return narrowed.length > 0 ? narrowed : server;
}

/** 偏好的難度不在清單中時，退回預設難度或清單第一項。 */
export function pickBotLevel(levels: readonly BotLevel[], preferred: BotLevel): BotLevel {
  if (levels.includes(preferred)) return preferred;
  if (levels.includes(DEFAULT_BOT_LEVEL)) return DEFAULT_BOT_LEVEL;
  return levels[0] ?? DEFAULT_BOT_LEVEL;
}

/** playerId → 難度；只收錄電腦座位，難度未知時為 null。 */
export function botLevelsOf(room: RoomView | null | undefined): ReadonlyMap<string, BotLevel | null> {
  const out = new Map<string, BotLevel | null>();
  for (const member of room?.members ?? []) {
    if (member.bot) out.set(member.playerId, member.botLevel ?? null);
  }
  return out;
}

/** 「電腦・標準」這類完整標籤；難度未知時只顯示「電腦」。 */
export function botBadgeLabel(t: Translate, level: BotLevel | null | undefined): string {
  return level ? t('bot.badge', { level: t(`bot.level.${level}`) }) : t('bot.badgeShort');
}
