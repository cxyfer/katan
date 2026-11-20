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

  /**
   * 依序以目前名稱、各舊版名稱的 token 查詢身分，採用第一個查得到的；只看名稱而不查資料庫，
   * 會讓過期的 `katan_session` 蓋過仍有效的舊 cookie。
   *
   * 同時回傳遷移用的 Set-Cookie：身分來自舊名稱時改寫成目前名稱；舊 cookie 只在它就是
   * 目前採用的 token、或已查不到身分時才清除，其他仍有效的舊身分保留不動。
   */
  async resolveRequest(
    cookieHeader: string | undefined,
  ): Promise<{ identity: SessionIdentity | null; cookies: string[] }> {
    const rows = new Map<string, GuestRow | null>();
    const lookup = async (token: string): Promise<GuestRow | null> => {
      if (!rows.has(token)) rows.set(token, await this.repo.findGuestByTokenHash(hashToken(token)));
      return rows.get(token)!;
    };

    const candidates: { name: string; token: string }[] = [];
    for (const name of [this.cookieName, ...this.legacyCookieNames]) {
      const token = parseCookie(cookieHeader, name);
      if (token) candidates.push({ name, token });
    }

    let chosen: { name: string; token: string; row: GuestRow } | null = null;
    for (const candidate of candidates) {
      const row = await lookup(candidate.token);
      if (row) {
        chosen = { ...candidate, row };
        break;
      }
    }

    const cookies: string[] = [];
    if (chosen && chosen.name !== this.cookieName) {
      cookies.push(serializeCookie(this.cookieName, chosen.token, { secure: this.cookieSecure }));
    }
    for (const candidate of candidates) {
      if (candidate.name === this.cookieName) continue;
      if (candidate.token === chosen?.token || !(await lookup(candidate.token))) {
        cookies.push(clearCookie(candidate.name, this.cookieSecure));
      }
    }
    return { identity: chosen ? toIdentity(chosen.row) : null, cookies };
  }

  /** Resolves the identity carried by the request cookie, if any. */
  async resolve(cookieHeader: string | undefined): Promise<SessionIdentity | null> {
    return (await this.resolveRequest(cookieHeader)).identity;
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
