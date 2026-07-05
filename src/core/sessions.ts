import { createHash, randomBytes } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { User, UserStore } from './users.js';

// ─── Session-Store (Cookie-Auth) ─────────────────────────────────
//
// Das Token wandert nur ins httpOnly-Cookie; in der DB liegt sein
// SHA-256-Hash. Ein DB-Leak gibt damit keine gültigen Sessions preis.

export const SESSION_COOKIE = 'su_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class SessionStore {
  constructor(private db: DatabaseSync, private users: UserStore) {}

  create(userId: string): { token: string; expiresAt: string } {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
    this.db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(tokenHash(token), userId, new Date(now).toISOString(), expiresAt);
    return { token, expiresAt };
  }

  /** Liefert den aktiven Nutzer zur Session – oder undefined (abgelaufen, widerrufen, deaktiviert). */
  resolve(token: string): User | undefined {
    const row = this.db.prepare(
      'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?',
    ).get(tokenHash(token)) as { user_id: string; expires_at: string } | undefined;
    if (!row) return undefined;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
      return undefined;
    }
    const user = this.users.findById(row.user_id);
    if (!user || user.disabledAt !== null) return undefined;
    return user;
  }

  delete(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  }

  /** Alle Sessions eines Nutzers beenden (z. B. nach Deaktivierung/Passwortwechsel). */
  deleteForUser(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  purgeExpired(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  }
}
