/**
 * Guest identity.
 *
 * A visitor receives a random 256-bit token stored in a secure, HTTP-only
 * SameSite cookie. Only the SHA-256 hash of the token is persisted, and the
 * stable player id is derived from that row — never from a client field.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { GuestRow } from './db.ts';
import { Repository, newId } from './db.ts';
import type { Locale } from '@katan/protocol';
import { LOCALES } from '@katan/protocol';

export interface SessionIdentity {
  id: string;
  nickname: string;
  locale: Locale;
  createdAt: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createToken(): string {
  return randomBytes(32).toString('base64url');
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { secure: boolean; maxAgeSeconds?: number } = { secure: false },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.secure) parts.push('Secure');
  parts.push(`Max-Age=${options.maxAgeSeconds ?? 60 * 60 * 24 * 365}`);
  return parts.join('; ');
}

export function clearCookie(name: string, secure: boolean): string {
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function toIdentity(row: GuestRow): SessionIdentity {
  return {
    id: row.id,
    nickname: row.nickname,
    locale: (LOCALES.includes(row.locale as Locale) ? row.locale : 'zh-Hant') as Locale,
    createdAt: row.created_at,
  };
}

export class SessionService {
  constructor(
    private readonly repo: Repository,
    private readonly cookieName: string,
    private readonly cookieSecure: boolean,
    private readonly legacyCookieNames: readonly string[] = [],
  ) {}

  /** 目前名稱優先，其次依序找舊版名稱。 */
  private readToken(cookieHeader: string | undefined): string | null {
    for (const name of [this.cookieName, ...this.legacyCookieNames]) {
      const token = parseCookie(cookieHeader, name);
      if (token) return token;
    }
    return null;
  }

  /** Resolves the identity carried by the request cookie, if any. */
  async resolve(cookieHeader: string | undefined): Promise<SessionIdentity | null> {
    const token = this.readToken(cookieHeader);
    if (!token) return null;
    const row = await this.repo.findGuestByTokenHash(hashToken(token));
    return row ? toIdentity(row) : null;
  }

  /** Creates a new guest and returns the token plus its cookie header value. */
  async create(
    nickname: string,
    locale: Locale,
  ): Promise<{ identity: SessionIdentity; setCookie: string }> {
    const token = createToken();
    const now = new Date().toISOString();
    const row: GuestRow = {
      id: newId('player'),
      token_hash: hashToken(token),
      nickname,
      locale,
      created_at: now,
      updated_at: now,
      kind: 'human',
      bot_level: null,
    };
    await this.repo.insertGuest(row);
    return {
      identity: toIdentity(row),
      setCookie: serializeCookie(this.cookieName, token, { secure: this.cookieSecure }),
    };
  }

  /**
   * 把舊版 cookie 改寫成目前名稱：token 不變，只換名稱並清除舊 cookie。
   * 沒有舊 cookie 時回傳空陣列。
   */
  migrationCookies(cookieHeader: string | undefined): string[] {
    const cookies: string[] = [];
    const current = parseCookie(cookieHeader, this.cookieName);
    for (const name of this.legacyCookieNames) {
      const legacy = parseCookie(cookieHeader, name);
      if (legacy === null) continue;
      if (!current && cookies.length === 0) {
        cookies.push(serializeCookie(this.cookieName, legacy, { secure: this.cookieSecure }));
      }
      cookies.push(clearCookie(name, this.cookieSecure));
    }
    return cookies;
  }

  /** 登出時同時清除目前與舊版名稱的 cookie。 */
  clearCookies(): string[] {
    return [this.cookieName, ...this.legacyCookieNames].map((name) => clearCookie(name, this.cookieSecure));
  }

  async update(
    playerId: string,
    fields: { nickname?: string; locale?: Locale },
  ): Promise<SessionIdentity | null> {
    await this.repo.updateGuest(playerId, fields);
    const row = await this.repo.findGuest(playerId);
    return row ? toIdentity(row) : null;
  }
}
