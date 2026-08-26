import { randomBytes } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, verifyPassword } from './password.js';

// ─── Types ───────────────────────────────────────────────────────

export type UserRole = 'admin' | 'member';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  disabledAt: string | null;
  createdAt: string;
  aworkUserId: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  password_hash: string;
  disabled_at: string | null;
  created_at: string;
  awork_user_id: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
    aworkUserId: row.awork_user_id,
  };
}

// ─── Store ───────────────────────────────────────────────────────

export class UserStore {
  constructor(private db: DatabaseSync) {}

  create(input: { email: string; name: string; role: UserRole; password: string }): User {
    const row: UserRow = {
      id: randomBytes(8).toString('hex'),
      email: input.email.trim(),
      name: input.name.trim(),
      role: input.role,
      password_hash: hashPassword(input.password),
      disabled_at: null,
      created_at: new Date().toISOString(),
      awork_user_id: null,
    };
    this.db.prepare(
      `INSERT INTO users (id, email, name, role, password_hash, disabled_at, created_at, awork_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.email,
      row.name,
      row.role,
      row.password_hash,
      row.disabled_at,
      row.created_at,
      row.awork_user_id,
    );
    return toUser(row);
  }

  list(): User[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as unknown as UserRow[];
    return rows.map(toUser);
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    return row.n;
  }

  findById(id: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? toUser(row) : undefined;
  }

  findByEmail(email: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) as UserRow | undefined;
    return row ? toUser(row) : undefined;
  }

  /** Login-Prüfung: aktiver Nutzer + korrektes Passwort, sonst undefined. */
  verifyCredentials(email: string, password: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) as UserRow | undefined;
    if (!row || row.disabled_at !== null) return undefined;
    if (!verifyPassword(password, row.password_hash)) return undefined;
    return toUser(row);
  }

  setPassword(id: string, password: string): boolean {
    const result = this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(hashPassword(password), id);
    return result.changes > 0;
  }

  setRole(id: string, role: UserRole): boolean {
    const result = this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    return result.changes > 0;
  }

  /** Setzt/löscht das awork-Mapping. Wirft bei UNIQUE-Verletzung (awork-ID schon vergeben). */
  setAworkUserId(id: string, aworkUserId: string | null): User {
    this.db.prepare('UPDATE users SET awork_user_id = ? WHERE id = ?').run(aworkUserId, id);
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return toUser(row!);
  }

  /** Soft-Delete: deaktivierte Nutzer können sich nicht mehr anmelden. */
  disable(id: string): boolean {
    const result = this.db.prepare(
      'UPDATE users SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL',
    ).run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  enable(id: string): boolean {
    const result = this.db.prepare(
      'UPDATE users SET disabled_at = NULL WHERE id = ? AND disabled_at IS NOT NULL',
    ).run(id);
    return result.changes > 0;
  }
}
