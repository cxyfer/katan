/** Runtime configuration from environment variables (see docs/OPERATIONS.md). */

import { DEFAULT_POLICY, POLICY_BOUNDS, type PolicyBounds, type RoomPolicy } from '@catan/protocol';

export interface ServerLimits {
  nicknameMaxLength: number;
  chatMaxLength: number;
  chatRatePerMinute: number;
  chatHistoryPageSize: number;
  roomCapacityMax: number;
  roomIdleTtlMinutes: number;
}

export interface ServerConfig {
  host: string;
  port: number;
  databaseUrl: string | null;
  /** Optional PostgreSQL schema; defaults to the connection's search path. */
  databaseSchema: string | null;
  sqlitePath: string;
  sessionCookieName: string;
  cookieSecure: boolean;
  webDistPath: string | null;
  /** 對外網址（如 https://catan.example.com），用於 og:image 等需絕對網址的 meta；未設定時由請求標頭推導。 */
  publicUrl: string | null;
  defaultPolicy: RoomPolicy;
  policyBounds: PolicyBounds;
  limits: ServerLimits;
  shutdownTimeoutMs: number;
  presenceSweepIntervalMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: int(env.PORT, 3000),
    databaseUrl: env.DATABASE_URL && env.DATABASE_URL !== '' ? env.DATABASE_URL : null,
    databaseSchema: env.DATABASE_SCHEMA && env.DATABASE_SCHEMA !== '' ? env.DATABASE_SCHEMA : null,
    sqlitePath: env.SQLITE_PATH ?? './.data/catan.sqlite',
    sessionCookieName: env.SESSION_COOKIE_NAME ?? 'catan_session',
    cookieSecure: bool(env.COOKIE_SECURE, env.NODE_ENV === 'production'),
    webDistPath: env.WEB_DIST_PATH ?? null,
    publicUrl: env.PUBLIC_URL && env.PUBLIC_URL !== '' ? env.PUBLIC_URL : null,
    defaultPolicy: {
      ...DEFAULT_POLICY,
      turnClockSeconds: int(env.DEFAULT_TURN_CLOCK_SECONDS, DEFAULT_POLICY.turnClockSeconds),
      disconnectGraceSeconds: int(
        env.DEFAULT_DISCONNECT_GRACE_SECONDS,
        DEFAULT_POLICY.disconnectGraceSeconds,
      ),
      allowAbandonment: bool(env.DEFAULT_ALLOW_ABANDONMENT, DEFAULT_POLICY.allowAbandonment),
    },
    policyBounds: POLICY_BOUNDS,
    limits: {
      nicknameMaxLength: int(env.NICKNAME_MAX_LENGTH, 24),
      chatMaxLength: int(env.CHAT_MAX_LENGTH, 500),
      chatRatePerMinute: int(env.CHAT_RATE_PER_MINUTE, 20),
      chatHistoryPageSize: int(env.CHAT_HISTORY_PAGE_SIZE, 50),
      roomCapacityMax: int(env.ROOM_CAPACITY_MAX, 6),
      roomIdleTtlMinutes: int(env.ROOM_IDLE_TTL_MINUTES, 720),
    },
    shutdownTimeoutMs: int(env.SHUTDOWN_TIMEOUT_MS, 10_000),
    presenceSweepIntervalMs: int(env.PRESENCE_SWEEP_INTERVAL_MS, 5_000),
    logLevel: (env.LOG_LEVEL as ServerConfig['logLevel']) ?? 'info',
  };
}

/** Validates a policy object against the documented bounds. */
export function validatePolicy(
  policy: Partial<RoomPolicy>,
  bounds: PolicyBounds,
  fallback: RoomPolicy,
): { ok: true; policy: RoomPolicy } | { ok: false; reason: string } {
  const merged: RoomPolicy = { ...fallback, ...policy, hostSuccession: 'automatic' };
  const clampCheck = (
    value: number,
    range: { min: number; max: number },
    name: string,
  ): string | null => {
    if (!Number.isInteger(value) || value < range.min || value > range.max) {
      return `${name} must be an integer between ${range.min} and ${range.max}`;
    }
    return null;
  };
  const clockError = clampCheck(merged.turnClockSeconds, bounds.turnClockSeconds, 'turnClockSeconds');
  if (clockError) return { ok: false, reason: clockError };
  const graceError = clampCheck(
    merged.disconnectGraceSeconds,
    bounds.disconnectGraceSeconds,
    'disconnectGraceSeconds',
  );
  if (graceError) return { ok: false, reason: graceError };
  if (typeof merged.allowAbandonment !== 'boolean') {
    return { ok: false, reason: 'allowAbandonment must be a boolean' };
  }
  return { ok: true, policy: merged };
}

/** Nickname validation: bounded, printable, no control characters. */
export function validateNickname(
  nickname: unknown,
  maxLength: number,
): { ok: true; nickname: string } | { ok: false; reason: string } {
  if (typeof nickname !== 'string') return { ok: false, reason: 'nickname must be a string' };
  const trimmed = nickname.trim().normalize('NFC');
  if (trimmed.length === 0) return { ok: false, reason: 'nickname must not be empty' };
  if ([...trimmed].length > maxLength) return { ok: false, reason: 'nickname too long' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(trimmed)) {
    return { ok: false, reason: 'nickname contains control characters' };
  }
  return { ok: true, nickname: trimmed };
}

/** Chat text validation: bounded length, no control characters, plain text. */
export function validateChatText(
  text: unknown,
  maxLength: number,
): { ok: true; text: string } | { ok: false; reason: string } {
  if (typeof text !== 'string') return { ok: false, reason: 'text must be a string' };
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.trim().length === 0) return { ok: false, reason: 'text must not be empty' };
  if ([...normalized].length > maxLength) return { ok: false, reason: 'text too long' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    return { ok: false, reason: 'text contains control characters' };
  }
  return { ok: true, text: normalized };
}
